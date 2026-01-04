/**
 * v1 API Router for iOS app
 * All endpoints return Signal DTO format only
 */

const express = require("express");
const { extractUserId } = require("../core/middleware/auth");
const { getDatabase } = require("../data/db");
const { getRankedForFeed } = require("../data/articleStorage");
const { mapArticleRowsToSignals } = require("./signalMapper");
const { enforceSignalGuardrails } = require("../decisions/guardrails");
const { getUserHoldings } = require("../services/userHoldingsService");
const { generateRabbitExplanations, attachExplanations } = require("../services/rabbitPersonalizationService");
const { fetchArticlesForHoldings } = require("../integrations/newsProviders");
const { getGlobalStoryGroups, getTickerStoryGroups } = require("../data/storyGroupStorage");

const router = express.Router();

// Apply user ID extraction middleware to all routes
router.use(extractUserId);

// Simple in-memory rate limiting (MVP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per user

function rateLimit(req, res, next) {
  const userId = req.userId || req.ip;
  const now = Date.now();
  
  if (!rateLimitMap.has(userId)) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  const limit = rateLimitMap.get(userId);
  
  if (now > limit.resetAt) {
    // Reset window
    limit.count = 1;
    limit.resetAt = now + RATE_LIMIT_WINDOW;
    return next();
  }

  if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  limit.count++;
  next();
}

router.use(rateLimit);

/**
 * GET /v1/feed
 * Returns interpreted/ranked signals for the user's feed
 */
router.get("/feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor || null; // For pagination (not implemented in MVP)

    const db = getDatabase();
    const userId = req.userId;

    // Get ranked articles (status='ranked' and shown_to_user=1 or final_rank_score >= 40)
    const articles = getRankedForFeed({ limit, userId });

    // Map to Signal DTOs
    const signals = mapArticleRowsToSignals(articles);

    // Apply guardrails (should already be applied, but double-check)
    const cleanedSignals = signals.map(signal => enforceSignalGuardrails(signal));

    res.json({
      items: cleanedSignals,
      next_cursor: null, // Pagination not implemented in MVP
    });
  } catch (error) {
    console.error("[v1/feed] Error:", error);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

/**
 * GET /v1/personalized-feed
 * Returns personalized feed with Wealthy Rabbit explanations
 *
 * HYBRID APPROACH:
 * 1. Fetches user holdings
 * 2. Actively searches for news about user's holdings (70% of feed)
 * 3. Gets general ranked news for macro context (30% of feed)
 * 4. Combines and deduplicates articles
 * 5. Generates Wealthy Rabbit personalized explanations
 * 6. Returns articles with explanation objects attached
 */
router.get("/personalized-feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const userId = req.userId;

    console.log(`[v1/personalized-feed] Request for user ${userId}, limit: ${limit}`);

    // Step A: Fetch user holdings FIRST
    const holdings = getUserHoldings(userId);
    console.log(`[v1/personalized-feed] User has ${holdings.length} holdings: ${holdings.join(', ') || 'none'}`);

    let allArticles = [];
    const urlSet = new Set(); // For deduplication

    // Step B: If user has holdings, actively search for holdings-specific news (70% of feed)
    if (holdings.length > 0) {
      const holdingsLimit = Math.ceil(limit * 0.7);
      console.log(`[v1/personalized-feed] Searching for ${holdingsLimit} holdings-specific articles...`);
      
      try {
        // Fetch articles for each holding
        // Limit per holding to avoid too many API calls
        const articlesPerHolding = Math.max(3, Math.ceil(holdingsLimit / holdings.length));
        const holdingsArticles = await fetchArticlesForHoldings(holdings, {
          sourceLimits: { newsapi: articlesPerHolding, gnews: articlesPerHolding, googlerss: articlesPerHolding }
        });

        console.log(`[v1/personalized-feed] Found ${holdingsArticles.length} holdings-specific articles`);
        
        // Add holdings articles (deduplicate by URL)
        for (const article of holdingsArticles) {
          if (article.url && !urlSet.has(article.url)) {
            urlSet.add(article.url);
            allArticles.push({
              ...article,
              source: article.source?.name || article.source_name || 'Unknown',
              source_name: article.source?.name || article.source_name || 'Unknown',
              // Convert to database-like format for consistency
              content: article.content || article.description || '',
              // Default impact score for holdings articles (will be refined during personalization)
              impact_score: 50, // Medium impact by default for holdings-specific news
              category: 'market',
              opportunity_type: 'neutral',
              event_type: 'general',
              exposure_level: 'medium',
              searched_by: article.searchedBy || holdings.join(','),
            });
          }
        }
      } catch (error) {
        console.error(`[v1/personalized-feed] Error fetching holdings articles:`, error.message);
        // Continue with general articles if holdings search fails
      }
    }

    // Step C: Get general ranked news for macro context (30% of feed, or 100% if no holdings)
    const generalLimit = holdings.length > 0 ? Math.floor(limit * 0.3) : limit;
    const remainingNeeded = limit - allArticles.length;
    
    if (remainingNeeded > 0) {
      console.log(`[v1/personalized-feed] Fetching ${remainingNeeded} general ranked articles for macro context...`);
      const generalArticles = getRankedForFeed({ limit: remainingNeeded, userId });
      
      // Add general articles (deduplicate by URL)
      for (const article of generalArticles) {
        if (article.url && !urlSet.has(article.url)) {
          urlSet.add(article.url);
          allArticles.push(article);
        }
      }
      
      console.log(`[v1/personalized-feed] Added ${generalArticles.filter(a => urlSet.has(a.url)).length} general articles`);
    }

    // Limit to requested amount
    allArticles = allArticles.slice(0, limit);

    if (allArticles.length === 0) {
      console.log('[v1/personalized-feed] No articles found after combining holdings and general news');
      return res.json({ items: [] });
    }

    console.log(`[v1/personalized-feed] Total articles after deduplication: ${allArticles.length} (${holdings.length > 0 ? 'holdings-focused' : 'general'})`);

    // Step D: Build event objects from articles
    // Convert to event format expected by personalization service
    const events = allArticles.map(article => {
      // Parse matched_holdings if available (from database articles)
      let matchedHoldings = [];
      try {
        matchedHoldings = article.matched_holdings ? JSON.parse(article.matched_holdings) : [];
      } catch (e) {
        // If searched_by exists, use that as matched holdings
        if (article.searched_by) {
          matchedHoldings = article.searched_by.split(',').map(h => h.trim());
        }
      }

      // Build rawArticles array
      const rawArticles = [{
        articleNumber: 1,
        source: article.source_name || article.source?.name || 'Unknown',
        title: article.title || '',
        description: article.description || '',
        body: article.content ? article.content.replace(/<[^>]*>/g, '').substring(0, 2000) : (article.description || '').substring(0, 2000),
        url: article.url || '',
      }];

      return {
        id: article.url,
        title: article.personalized_title || article.title || '',
        shortSummary: article.summary_short || article.summary_enriched || article.description || '',
        tickerSummary: matchedHoldings.join(', ') || article.searched_by || '',
        impactLevel: (article.impact_score !== null && article.impact_score !== undefined) 
          ? (article.impact_score >= 70 ? 'high' : article.impact_score >= 40 ? 'medium' : 'low')
          : 'medium', // Default to medium for holdings articles
        scopeType: article.category || 'market',
        opportunitySignal: article.opportunity_type || 'neutral',
        relevanceType: article.event_type || 'general',
        profileTier: article.exposure_level || 'medium',
        rawArticles,
      };
    });

    // Step E: Generate Rabbit explanations (batched)
    const explanations = await generateRabbitExplanations(events, holdings);

    // Step F: Attach explanations to events
    const personalizedItems = attachExplanations(events, explanations);

    console.log(`[v1/personalized-feed] Returning ${personalizedItems.length} personalized items`);

    res.json({
      items: personalizedItems,
      next_cursor: null,
    });
  } catch (error) {
    console.error("[v1/personalized-feed] Error:", error);
    res.status(500).json({ error: "Failed to fetch personalized feed" });
  }
});

/**
 * POST /v1/interpret
 * Interpret a text or URL input and return a Signal
 * MVP: Treats input as text, uses existing LLM logic
 */
router.post("/interpret", async (req, res) => {
  try {
    const { textOrUrl } = req.body;

    if (!textOrUrl || typeof textOrUrl !== 'string') {
      return res.status(400).json({ error: "textOrUrl is required" });
    }

    const userId = req.userId;
    const db = getDatabase();

    // For MVP, treat as text and use title triage + classification logic
    // Create a minimal article object
    const article = {
      url: textOrUrl.startsWith('http') ? textOrUrl : `text://${Date.now()}`,
      title: textOrUrl.length > 200 ? textOrUrl.substring(0, 200) : textOrUrl,
      description: textOrUrl,
      source: { name: "User Input" },
      publishedAt: new Date().toISOString(),
    };

    // For MVP, use simplified interpretation without full pipeline
    // Just analyze the text and return a basic signal
    // TODO: Integrate with full pipeline stages if needed
    
    // Simple analysis: check if text is meaningful
    const textLength = textOrUrl.length;
    const hasFinancialTerms = /stock|market|ticker|earnings|revenue|profit|loss|ipo|merger|acquisition|dividend|share/i.test(textOrUrl);
    
    // Build basic signal
    const impactScore = hasFinancialTerms ? 50 : 20;
    const verdict = impactScore >= 50 ? "aware" : "ignore";
    
    const why = [];
    if (hasFinancialTerms) {
      why.push("Content contains financial terminology");
    } else {
      why.push("Content analyzed for relevance");
    }

    const signal = {
      id: article.url,
      url: article.url,
      title: article.title,
      source: "User Input",
      published_at: article.publishedAt,
      verdict: verdict,
      why: why.slice(0, 3),
      action: impactScore >= 50 ? "Understand the context" : "Do nothing",
      horizon: null,
      opportunity_type: "none",
      opportunity_note: "",
      confidence: Math.min(100, Math.max(0, impactScore)),
      importance_score: impactScore,
    };

    // Apply guardrails and return
    res.json(enforceSignalGuardrails(signal));
  } catch (error) {
    console.error("[v1/interpret] Error:", error);
    res.status(500).json({ error: "Failed to interpret content" });
  }
});

/**
 * PUT /v1/preferences
 * Update user preferences (focus profile and holdings)
 */
router.put("/preferences", async (req, res) => {
  try {
    const { focus_profile, holdings } = req.body;
    const userId = req.userId;
    const db = getDatabase();

    // Validate focus_profile
    const allowedProfiles = ["focused", "balanced", "broad"];
    const profile = allowedProfiles.includes(focus_profile) ? focus_profile : "balanced";

    // Store profile in users table (add column if needed)
    // For MVP, we'll use a simple approach: store in a user_preferences table or reuse existing
    // Since we have holdings table, we'll add a user_preferences table
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY,
        focus_profile TEXT DEFAULT 'balanced',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.prepare(`
      INSERT INTO user_preferences (user_id, focus_profile, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        focus_profile = excluded.focus_profile,
        updated_at = datetime('now')
    `).run(userId, profile);

    // Update holdings if provided
    if (Array.isArray(holdings)) {
      // Clear existing holdings for user
      db.prepare("DELETE FROM holdings WHERE user_id = ?").run(userId);

      // Insert new holdings
      const insertHolding = db.prepare(`
        INSERT INTO holdings (user_id, ticker, label, notes)
        VALUES (?, ?, ?, ?)
      `);

      for (const holding of holdings) {
        const ticker = typeof holding === 'string' ? holding.toUpperCase().trim() : holding.ticker?.toUpperCase().trim();
        const label = typeof holding === 'object' ? holding.label : null;
        const notes = typeof holding === 'object' ? holding.notes : null;

        if (ticker && /^[A-Z0-9]{1,5}$/.test(ticker)) {
          insertHolding.run(userId, ticker, label || null, notes || null);
        }
      }
    }

    res.json({
      success: true,
      focus_profile: profile,
      holdings_count: holdings ? holdings.length : 0,
    });
  } catch (error) {
    console.error("[v1/preferences] Error:", error);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

/**
 * GET /v1/feed/story-groups
 * Returns clustered story groups (global + ticker-scoped)
 *
 * COMPOSITION LOGIC:
 * 1. Fetch user holdings
 * 2. Fetch GLOBAL story groups (top N, same for everyone)
 * 3. Fetch TICKER story groups (top M per ticker in holdings)
 * 4. Merge and deduplicate
 * 5. Return with merged_feed sorted by impact
 */
router.get("/feed/story-groups", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const limitGlobal = parseInt(req.query.limit_global) || 5;
    const limitPerTicker = parseInt(req.query.limit_per_ticker) || 3;
    const userId = req.userId;

    console.log(`[v1/feed/story-groups] Request for user ${userId}, date: ${date}`);

    // Step 1: Get user holdings
    const userHoldings = getUserHoldings(userId);
    console.log(`[v1/feed/story-groups] User holdings: ${userHoldings.join(', ') || 'none'}`);

    // Step 2: Fetch GLOBAL story groups
    const globalGroups = getGlobalStoryGroups(date, limitGlobal);
    console.log(`[v1/feed/story-groups] Fetched ${globalGroups.length} global groups`);

    // Step 3: Fetch TICKER story groups
    const tickerGroupsByTicker = getTickerStoryGroups(userHoldings, date, limitPerTicker);
    console.log(`[v1/feed/story-groups] Fetched ticker groups for ${Object.keys(tickerGroupsByTicker).length} tickers`);

    // Step 4: Merge into merged_feed, deduplicating by group_title
    const mergedFeed = [];
    const seenTitles = new Set();

    // Add global groups first (they apply to everyone)
    for (const group of globalGroups) {
      if (!seenTitles.has(group.group_title)) {
        mergedFeed.push({
          ...group,
          rank_reason: "Global impact"
        });
        seenTitles.add(group.group_title);
      }
    }

    // Add ticker groups (in order of impact level)
    for (const ticker of userHoldings) {
      const tickerGroups = tickerGroupsByTicker[ticker] || [];
      for (const group of tickerGroups) {
        if (!seenTitles.has(group.group_title)) {
          mergedFeed.push({
            ...group,
            rank_reason: `User holds ${ticker}`
          });
          seenTitles.add(group.group_title);
        }
      }
    }

    // Sort by impact level (High > Moderate > Low > Very Low)
    const impactOrder = { 'High': 0, 'Moderate': 1, 'Low': 2, 'Very Low': 3 };
    mergedFeed.sort((a, b) => {
      const impactDiff = (impactOrder[a.impact_level] || 999) - (impactOrder[b.impact_level] || 999);
      if (impactDiff !== 0) return impactDiff;
      // Secondary sort by created_at DESC
      return new Date(b.created_at) - new Date(a.created_at);
    });

    // Step 5: Build response
    const response = {
      date,
      user_id: userId,
      user_holdings: userHoldings,
      generated_at: new Date().toISOString(),

      global: globalGroups,

      by_ticker: tickerGroupsByTicker,

      merged_feed: mergedFeed,

      metadata: {
        total_groups: globalGroups.length + Object.values(tickerGroupsByTicker).reduce((sum, arr) => sum + arr.length, 0),
        total_articles_clustered: globalGroups.reduce((sum, g) => sum + g.article_count, 0) +
                                   Object.values(tickerGroupsByTicker)
                                     .reduce((sum, groups) => sum + groups.reduce((s, g) => s + g.article_count, 0), 0),
        dedup_removed: globalGroups.length + Object.values(tickerGroupsByTicker).reduce((sum, arr) => sum + arr.length, 0) - mergedFeed.length,
        cache_ttl_seconds: 3600
      }
    };

    console.log(`[v1/feed/story-groups] Returning ${mergedFeed.length} groups (${response.metadata.total_articles_clustered} articles)`);
    res.json(response);

  } catch (error) {
    console.error("[v1/feed/story-groups] Error:", error);
    res.status(500).json({ error: "Failed to fetch story groups" });
  }
});

/**
 * GET /v1/brief/latest
 * Stub endpoint for daily brief (not implemented in MVP)
 */
router.get("/brief/latest", (req, res) => {
  res.json({
    items: [],
    generated_at: null,
  });
});

module.exports = router;

