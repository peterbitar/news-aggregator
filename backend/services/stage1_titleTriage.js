const OpenAI = require("openai");
const { getDatabase } = require("../db");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Pre-LLM hard filters: Drop low-quality articles before sending to LLM
 * This dramatically reduces LLM calls and costs
 */
function applyHardFilters(article) {
  const title = (article.title || "").toLowerCase().trim();
  const source = (article.source?.name || "").toLowerCase();
  
  // Skip empty or very short titles
  if (!title || title.length < 10) {
    return { filtered: true, reason: "Title too short or empty" };
  }
  
  // Filter out generic/low-value title patterns
  const genericPatterns = [
    /^morning\s+brief/i,
    /^market\s+wrap/i,
    /^live\s+blog/i,
    /^top\s+\d+\s+moves/i,
    /^daily\s+roundup/i,
    /^weekend\s+read/i,
    /^what\s+to\s+watch/i,
    /^stock\s+market\s+today/i,
    /^pre-market/i,
    /^after\s+hours/i,
    /^ticker\s+tape/i,
    /^newsletter/i,
    /^subscribe/i,
    /^sign\s+up/i,
    /^click\s+here/i,
    /^watch\s+now/i,
    /^video:/i,
    /^podcast:/i,
    /^photo\s+gallery/i,
    /^slideshow/i,
    /^\d+\s+photos/i,
  ];
  
  for (const pattern of genericPatterns) {
    if (pattern.test(title)) {
      return { filtered: true, reason: `Matches generic pattern: ${pattern.toString()}` };
    }
  }
  
  // Filter titles that are just numbers or single generic words
  const words = title.split(/\s+/).filter(w => w.length > 2);
  if (words.length <= 2 && !/[A-Z]{2,}/.test(title)) {
    // No ticker-like patterns, just generic words
    return { filtered: true, reason: "Title has too few meaningful words and no ticker patterns" };
  }
  
  // Filter low-quality sources (can be expanded based on your data)
  const lowQualitySources = [
    "sponsored",
    "advertisement",
    "promoted",
    "partner content",
  ];
  
  for (const lowSource of lowQualitySources) {
    if (source.includes(lowSource)) {
      return { filtered: true, reason: `Low-quality source: ${source}` };
    }
  }
  
  return { filtered: false };
}

/**
 * Stage 1: Title-only triage
 * LLM reads ONLY the title + metadata and decides if the article is worth fetching full content
 * 
 * Columns filled:
 * - title_relevance (0-3)
 * - title_event_type
 * - title_reason_short
 * - title_ticker_matches (json list)
 * - title_sector_matches (json list)
 * - should_fetch_full (boolean)
 * - status = "title_filtered"
 */
async function processTitleTriage(article) {
  const db = getDatabase();

  // Check if already processed - skip if title_relevance is already set
  const existing = db.prepare("SELECT title_relevance, status FROM articles WHERE url = ?").get(article.url);
  if (existing && existing.title_relevance !== null && existing.title_relevance !== undefined) {
    console.log(`[Stage 1] Article already processed: ${article.url} (title_relevance: ${existing.title_relevance})`);
    return {
      title_relevance: existing.title_relevance,
      should_fetch_full: true,
      status: existing.status || "title_filtered",
      skipped: true,
    };
  }

  // If no API key, skip LLM processing
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, skipping title triage");
    return { should_fetch_full: true, status: "title_filtered" };
  }

  try {
    // Get searched_by from database if not provided
    let searchedBy = article.searchedBy;
    if (!searchedBy) {
      const articleRow = db.prepare("SELECT searched_by FROM articles WHERE url = ?").get(article.url);
      searchedBy = articleRow?.searched_by || null;
    }

    // Prepare article metadata
    const metadata = {
      title: article.title || "",
      description: article.description || "",
      source: article.source?.name || "Unknown",
      author: article.author || null,
      publishedAt: article.publishedAt || null,
      searchedBy: searchedBy,
    };

    // System prompt
    const systemPrompt = `You are a financial news analyst that triages articles based on titles and metadata only.
Analyze the article title and metadata and determine:
1. Relevance score (0-3): 0=irrelevant, 1=weak, 2=moderate, 3=high
2. Event type: earnings, m&a, guidance, macro, regulation, product_tech, industry_trend, other
3. Brief reason for relevance score
4. Any ticker symbols mentioned (as JSON array)
5. Any sectors mentioned (as JSON array)
6. Whether full content should be fetched

Always respond with valid JSON in this exact format:
{
  "title_relevance": 0-3,
  "title_event_type": "event_type_string",
  "title_reason_short": "brief reason",
  "title_ticker_matches": ["TICKER1", "TICKER2"],
  "title_sector_matches": ["sector1", "sector2"],
  "should_fetch_full": true/false
}`;

    // User prompt
    const searchContext = metadata.searchedBy 
      ? `\n\nIMPORTANT: This article was found by searching for: ${metadata.searchedBy}. Pay special attention to relevance for ${metadata.searchedBy}.`
      : "";

    const userPrompt = `Article Title: ${metadata.title}

Source: ${metadata.source}
Author: ${metadata.author || "Unknown"}
Published: ${metadata.publishedAt || "Unknown"}
Description: ${metadata.description || "None"}${searchContext}

Analyze this article title and determine:
- Relevance (0-3): How relevant is this to financial markets/investing?${metadata.searchedBy ? ` Specifically for ${metadata.searchedBy}?` : ""}
- Event type: What type of financial event is this?
- Tickers: Any stock tickers mentioned?${metadata.searchedBy ? ` (Especially ${metadata.searchedBy})` : ""}
- Sectors: Any industry sectors mentioned?
- Should fetch full content: Is this article worth reading in full?${metadata.searchedBy ? ` Given it was found searching for ${metadata.searchedBy}?` : ""}

Return ONLY valid JSON, no markdown formatting.`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let triageData;

    try {
      triageData = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        triageData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }

    // Validate and sanitize the response
    const title_relevance = Math.max(0, Math.min(3, Math.round(Number(triageData.title_relevance) || 0)));
    const title_event_type = triageData.title_event_type || "other";
    let title_reason_short = (triageData.title_reason_short || "").trim();
    const title_ticker_matches = Array.isArray(triageData.title_ticker_matches) 
      ? JSON.stringify(triageData.title_ticker_matches.map(t => t.toUpperCase()))
      : "[]";
    const title_sector_matches = Array.isArray(triageData.title_sector_matches)
      ? JSON.stringify(triageData.title_sector_matches)
      : "[]";
    const should_fetch_full = Boolean(triageData.should_fetch_full);

    // Ensure reason is always set, especially when should_fetch_full = false
    if (!title_reason_short || title_reason_short.length === 0) {
      if (title_relevance === 0) {
        title_reason_short = "Article is irrelevant to financial markets";
      } else if (title_relevance === 1 && !should_fetch_full) {
        title_reason_short = "Weak relevance and not worth fetching full content";
      } else if (!should_fetch_full) {
        title_reason_short = "Not worth fetching full content based on title analysis";
      } else {
        title_reason_short = "Relevant financial news";
      }
    }

    // Determine status based on relevance
    let status;
    if (title_relevance === 0) {
      status = "discarded"; // Irrelevant - discard immediately
    } else if (title_relevance === 1 && !should_fetch_full) {
      status = "discarded"; // Weak relevance and not worth fetching
    } else {
      status = "title_filtered"; // Continue to Stage 2
    }

    // Update database
    db.prepare(`
      UPDATE articles SET
        title_relevance = ?,
        title_event_type = ?,
        title_reason_short = ?,
        title_ticker_matches = ?,
        title_sector_matches = ?,
        should_fetch_full = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      title_relevance,
      title_event_type,
      title_reason_short,
      title_ticker_matches,
      title_sector_matches,
      should_fetch_full ? 1 : 0,
      status,
      article.url
    );

    return {
      title_relevance,
      title_event_type,
      title_reason_short,
      title_ticker_matches: JSON.parse(title_ticker_matches),
      title_sector_matches: JSON.parse(title_sector_matches),
      should_fetch_full,
      status,
    };
  } catch (error) {
    console.error(`Error in Stage 1 title triage for ${article.url}:`, error.message);
    
    // On error, default to fetching full content with error reason
    const errorReason = `Triage error: ${error.message}`;
    const db = getDatabase();
    db.prepare(`
      UPDATE articles SET
        title_relevance = 2,
        title_reason_short = ?,
        should_fetch_full = 1,
        status = 'title_filtered',
        last_error = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(errorReason, error.message.substring(0, 500), article.url);

    return {
      title_relevance: 2,
      title_reason_short: errorReason,
      should_fetch_full: true,
      status: "title_filtered",
      error: error.message,
    };
  }
}

/**
 * Check if article mentions holding ticker or issuer name in title/description
 * Returns true if article should be processed, false if it should be discarded
 */
function mentionsHoldingInTitleOrDescription(article, searchedBy, holdingsFromDB = []) {
  if (!searchedBy) return true; // If no searched_by, allow through (will be filtered by LLM)
  
  const title = (article.title || "").toUpperCase();
  const description = (article.description || "").toUpperCase();
  const searchText = title + " " + description;
  
  // Check if searched_by ticker appears
  const searchedTicker = searchedBy.toUpperCase();
  if (searchText.includes(searchedTicker)) {
    return true;
  }
  
  // Check if any holding's ticker or issuer name appears
  for (const holding of holdingsFromDB) {
    const ticker = (holding.ticker || "").toUpperCase();
    if (searchText.includes(ticker)) {
      return true;
    }
    
    // Check issuer name (label) - simple includes check
    if (holding.label) {
      const label = holding.label.toUpperCase();
      // Only check if label is meaningful (not just the ticker itself)
      if (label !== ticker && label.length > 2) {
        if (searchText.includes(label)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Batch process multiple articles through Stage 1 (title triage)
 * Processes up to 20 articles in a single LLM call for efficiency (increased from 10)
 * OPTIMIZED: Batches all database queries, applies hard filters before LLM, stricter prompts
 * @param {Array} articles - Array of article objects
 * @param {Array} userHoldings - User's holdings (optional, for guardrails)
 * @returns {Promise<Array>} Array of results for each article
 */
async function processTitleTriageBatch(articles, userHoldings = []) {
  if (!articles || articles.length === 0) return [];
  
  const db = getDatabase();
  const startTime = Date.now();
  
  // OPTIMIZATION 1: Batch check for already processed articles (single query for all)
  const urls = articles.map(a => a.url);
  if (urls.length === 0) return [];
  
  const placeholders = urls.map(() => "?").join(",");
  const existingArticles = db.prepare(`
    SELECT url, title_relevance, status FROM articles 
    WHERE url IN (${placeholders})
  `).all(...urls);
  
  // Create a map for O(1) lookup
  const existingMap = new Map(existingArticles.map(row => [row.url, row]));
  
  // Filter out already processed articles
  const articlesToProcess = [];
  const skippedResults = [];
  
  for (const article of articles) {
    const existing = existingMap.get(article.url);
    if (existing && existing.title_relevance !== null && existing.title_relevance !== undefined) {
      skippedResults.push({ skipped: true, article });
    } else {
      articlesToProcess.push(article);
    }
  }
  
  if (articlesToProcess.length === 0) {
    console.log(`[Stage 1 Batch] All ${articles.length} articles already processed (${Date.now() - startTime}ms)`);
    return articles.map(() => ({ skipped: true }));
  }
  
  // If no API key, skip LLM processing
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, skipping batch title triage");
    return articlesToProcess.map(() => ({ should_fetch_full: true, status: "title_filtered" }));
  }
  
  try {
    // OPTIMIZATION 2: Batch fetch searched_by for all articles that need it (single query)
    const articlesNeedingContext = articlesToProcess.filter(a => !a.searchedBy);
    const urlsNeedingContext = articlesNeedingContext.map(a => a.url);
    
    let contextMap = new Map();
    if (urlsNeedingContext.length > 0) {
      const contextPlaceholders = urlsNeedingContext.map(() => "?").join(",");
      const contextRows = db.prepare(`
        SELECT url, searched_by FROM articles 
        WHERE url IN (${contextPlaceholders})
      `).all(...urlsNeedingContext);
      
      contextMap = new Map(contextRows.map(row => [row.url, row.searched_by]));
    }
    
    // Build articles with context (no database queries in loop)
    const articlesWithContext = articlesToProcess.map(article => ({
      ...article,
      searchedBy: article.searchedBy || contextMap.get(article.url) || null,
    }));
    
    // GUARDRAIL 5A: Get holdings from DB if searched_by is a ticker
    // Load all holdings to check issuer names
    const DEFAULT_USER_ID = 1;
    let holdingsFromDB = userHoldings;
    if (holdingsFromDB.length === 0) {
      // Load all holdings from DB for guardrail checks
      holdingsFromDB = db.prepare(`
        SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?
      `).all(DEFAULT_USER_ID);
    }
    
    // OPTIMIZATION: Apply hard filters before LLM (filters out generic/low-quality articles)
    const preFiltered = [];
    const hardFiltered = [];
    
    for (const article of articlesWithContext) {
      const filterResult = applyHardFilters(article);
      if (filterResult.filtered) {
        // Save to database as discarded without LLM call
        hardFiltered.push({
          article,
          reason: filterResult.reason,
        });
        continue;
      }
      
      // GUARDRAIL 5A: Check if article mentions holding ticker or issuer name
      // If searched_by is a holding ticker and article doesn't mention it, discard without LLM
      if (article.searchedBy && holdingsFromDB.length > 0) {
        const mentionsHolding = mentionsHoldingInTitleOrDescription(article, article.searchedBy, holdingsFromDB);
        if (!mentionsHolding) {
          // Mark as low relevance without LLM
          hardFiltered.push({
            article,
            reason: "No mention of holding in title/description",
          });
          continue;
        }
      }
      
      preFiltered.push(article);
    }
    
    // Save hard-filtered articles as discarded
    if (hardFiltered.length > 0) {
      const filterStmt = db.prepare(`
        UPDATE articles SET
          title_relevance = 0,
          title_reason_short = ?,
          should_fetch_full = 0,
          status = 'discarded',
          updated_at = datetime('now')
        WHERE url = ?
      `);
      
      const filterTransaction = db.transaction((filtered) => {
        for (const item of filtered) {
          // GUARDRAIL 5A: Set specific reason for holding mention check
          const reason = item.reason === "No mention of holding in title/description"
            ? "No mention of holding in title/description"
            : item.reason;
          filterStmt.run(reason, item.article.url);
        }
      });
      
      filterTransaction(hardFiltered);
      console.log(`[Stage 1 Batch] Hard-filtered ${hardFiltered.length} articles without LLM call (including ${hardFiltered.filter(h => h.reason === "No mention of holding in title/description").length} with no holding mention)`);
    }
    
    if (preFiltered.length === 0) {
      console.log(`[Stage 1 Batch] All articles filtered by hard filters (${Date.now() - startTime}ms)`);
      // Return hard-filtered results plus skipped ones
      const allResults = [];
      for (const item of hardFiltered) {
        allResults.push({
          title_relevance: 0,
          title_reason_short: item.reason,
          should_fetch_full: false,
          status: "discarded",
          filtered: true,
        });
      }
      for (let i = 0; i < skippedResults.length; i++) {
        allResults.push({ skipped: true });
      }
      return allResults;
    }
    
    // Build batch prompt (only for pre-filtered articles)
    const articlesList = preFiltered.map((article, index) => {
      const searchContext = article.searchedBy ? ` (Found by searching for: ${article.searchedBy})` : "";
      return `Article ${index + 1}:
Title: ${article.title || ""}
Source: ${article.source?.name || "Unknown"}
Description: ${article.description || "None"}${searchContext}
URL: ${article.url}`;
    }).join("\n\n");
    
    const systemPrompt = `You are a financial news analyst that triages articles based on titles and metadata only.

IMPORTANT: Be STRICT and CONSERVATIVE. Default to relevance 0 or 1 unless the title clearly signals a material, specific financial event.

Relevance guidelines:
- 0: Completely irrelevant to financial markets/investing, generic content, clickbait
- 1: Weak relevance - mentions financial terms but no specific event, generic market commentary
- 2: Moderate relevance - specific event mentioned but not clearly material (minor product updates, general trends)
- 3: High relevance - clearly material events (earnings beats/misses, M&A announcements, major guidance changes, regulatory decisions, significant product launches)

Only set relevance >= 2 for clearly material, specific events that would affect stock prices or investment decisions.

Analyze each article and determine for EACH one:
1. Relevance score (0-3): BE STRICT - default to 0 or 1 unless clearly material
2. Event type: earnings, m&a, guidance, macro, regulation, product_tech, industry_trend, other
3. Brief reason for relevance score
4. Any ticker symbols mentioned (as JSON array)
5. Any sectors mentioned (as JSON array)
6. Whether full content should be fetched (ONLY true for relevance >= 2)

Return a JSON object where keys are article URLs and values are the analysis:
{
  "URL1": {
    "title_relevance": 0-3,
    "title_event_type": "event_type_string",
    "title_reason_short": "brief reason",
    "title_ticker_matches": ["TICKER1"],
    "title_sector_matches": ["sector1"],
    "should_fetch_full": true/false
  },
  "URL2": { ... }
}`;
    
    const userPrompt = `Analyze the following ${preFiltered.length} articles (already filtered for basic quality). BE STRICT - only high relevance (2-3) should have should_fetch_full = true:\n\n${articlesList}\n\nReturn a JSON object with analysis for each article URL.`;
    
    // Call OpenAI API with timeout
    const apiStartTime = Date.now();
    const timeoutMs = 30000; // 30 second timeout
    
    let response;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`OpenAI API timeout after ${timeoutMs}ms`)), timeoutMs);
      });
      
      response = await Promise.race([
        openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          response_format: { type: "json_object" },
          max_tokens: Math.min(6000, preFiltered.length * 400), // Scale tokens with batch size (increased for larger batches)
        }),
        timeoutPromise,
      ]);
      
      console.log(`[Stage 1 Batch] LLM API call took ${Date.now() - apiStartTime}ms`);
    } catch (apiError) {
      console.error(`[Stage 1 Batch] OpenAI API error:`, apiError.message);
      throw apiError;
    }
    
    // Parse JSON response
    const content = response.choices[0].message.content;
    let batchResults;
    
    try {
      batchResults = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        batchResults = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }
    
    // OPTIMIZATION 3: Process results and prepare batch updates
    const updateData = [];
    const results = [];
    
    // Add hard-filtered results first
    for (const item of hardFiltered) {
      results.push({
        title_relevance: 0,
        title_reason_short: item.reason,
        should_fetch_full: false,
        status: "discarded",
        filtered: true,
      });
    }
    
    for (const article of preFiltered) {
      const triageData = batchResults[article.url];
      
      if (!triageData) {
        console.warn(`No triage data for ${article.url}, using defaults`);
        // Default to moderate relevance with reason
        const defaultReason = "No triage data available - defaulting to fetch";
        updateData.push({
          url: article.url,
          title_relevance: 2,
          title_event_type: "other",
          title_reason_short: defaultReason,
          title_ticker_matches: "[]",
          title_sector_matches: "[]",
          should_fetch_full: 1,
          status: "title_filtered",
        });
        results.push({ 
          title_relevance: 2, 
          title_reason_short: defaultReason, 
          should_fetch_full: true, 
          status: "title_filtered" 
        });
        continue;
      }
      
      // Validate and sanitize
      const title_relevance = Math.max(0, Math.min(3, Math.round(Number(triageData.title_relevance) || 0)));
      const title_event_type = triageData.title_event_type || "other";
      let title_reason_short = (triageData.title_reason_short || "").trim();
      const title_ticker_matches = Array.isArray(triageData.title_ticker_matches) 
        ? JSON.stringify(triageData.title_ticker_matches.map(t => t.toUpperCase()))
        : "[]";
      const title_sector_matches = Array.isArray(triageData.title_sector_matches)
        ? JSON.stringify(triageData.title_sector_matches)
        : "[]";
      const should_fetch_full = Boolean(triageData.should_fetch_full);
      
      // Ensure reason is always set, especially when should_fetch_full = false
      if (!title_reason_short || title_reason_short.length === 0) {
        if (title_relevance === 0) {
          title_reason_short = "Article is irrelevant to financial markets";
        } else if (title_relevance === 1 && !should_fetch_full) {
          title_reason_short = "Weak relevance and not worth fetching full content";
        } else if (!should_fetch_full) {
          title_reason_short = "Not worth fetching full content based on title analysis";
        } else {
          title_reason_short = "Relevant financial news";
        }
      }
      
      // Determine status
      let status;
      if (title_relevance === 0) {
        status = "discarded";
      } else if (title_relevance === 1 && !should_fetch_full) {
        status = "discarded";
      } else {
        status = "title_filtered";
      }
      
      // Store update data for batch update
      updateData.push({
        url: article.url,
        title_relevance,
        title_event_type,
        title_reason_short,
        title_ticker_matches,
        title_sector_matches,
        should_fetch_full: should_fetch_full ? 1 : 0,
        status,
      });
      
      results.push({
        title_relevance,
        title_event_type,
        title_reason_short,
        title_ticker_matches: JSON.parse(title_ticker_matches),
        title_sector_matches: JSON.parse(title_sector_matches),
        should_fetch_full,
        status,
      });
    }
    
    // OPTIMIZATION 4: Batch update all articles in a single transaction
    if (updateData.length > 0) {
      const updateStartTime = Date.now();
      const updateStmt = db.prepare(`
        UPDATE articles SET
          title_relevance = ?,
          title_event_type = ?,
          title_reason_short = ?,
          title_ticker_matches = ?,
          title_sector_matches = ?,
          should_fetch_full = ?,
          status = ?,
          updated_at = datetime('now')
        WHERE url = ?
      `);
      
      // Use transaction for faster batch updates
      const transaction = db.transaction((updates) => {
        for (const data of updates) {
          updateStmt.run(
            data.title_relevance,
            data.title_event_type,
            data.title_reason_short,
            data.title_ticker_matches,
            data.title_sector_matches,
            data.should_fetch_full,
            data.status,
            data.url
          );
        }
      });
      
      transaction(updateData);
      console.log(`[Stage 1 Batch] Batch updated ${updateData.length} articles in ${Date.now() - updateStartTime}ms`);
    }
    
    // Add skipped results for already-processed articles
    const skippedCount = articles.length - articlesToProcess.length;
    for (let i = 0; i < skippedCount; i++) {
      results.push({ skipped: true });
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[Stage 1 Batch] Processed ${articlesToProcess.length} articles in 1 LLM call (${skippedCount} skipped) - Total time: ${totalTime}ms`);
    return results;
    
  } catch (error) {
    console.error(`Error in Stage 1 batch title triage:`, error.message);
    // Fallback: process individually
    console.log(`Falling back to individual processing for ${articlesToProcess.length} articles`);
    const fallbackResults = await Promise.all(
      articlesToProcess.map(article => processTitleTriage(article).catch(() => ({
        title_relevance: 2,
        should_fetch_full: true,
        status: "title_filtered",
      })))
    );
    return fallbackResults;
  }
}

module.exports = {
  processTitleTriage,
  processTitleTriageBatch,
};

