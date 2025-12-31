const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();
const { getDatabase } = require("./data/db");
const { fetchNewsFromMultipleSources, fetchArticlesForHoldings } = require("./integrations/newsProviders");
const { enrichArticlesForHoldings, triageArticlesByTitle } = require("./integrations/llmService");
const { requireInternalKey } = require("./core/middleware/auth");
const v1Router = require("./product/routes");
const internalRouter = require("./admin/routes");
const { startScheduler } = require("./background/scheduler");

const app = express();
const net = require('net');

// Helper function to check if a port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    server.on('error', () => resolve(false));
  });
}

// Helper function to find an available port
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Could not find an available port starting from ${startPort}`);
}

// Get port from environment or use default
const DEFAULT_PORT = process.env.PORT || 5001;

// Initialize database
getDatabase();

// Override console methods to truncate large outputs (prevents CSS/HTML spam)
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const truncateLargeOutput = (args) => {
  return args.map(arg => {
    if (typeof arg === 'string' && arg.length > 500) {
      // Check if it looks like CSS or HTML
      if (arg.includes('{') && arg.includes('}') && arg.includes(';') && arg.length > 1000) {
        return arg.substring(0, 200) + '... (truncated - ' + (arg.length - 200) + ' chars)';
      }
      if (arg.length > 2000) {
        return arg.substring(0, 200) + '... (truncated - ' + (arg.length - 200) + ' chars)';
      }
    }
    return arg;
  });
};

console.log = (...args) => originalLog(...truncateLargeOutput(args));
console.error = (...args) => originalError(...truncateLargeOutput(args));
console.warn = (...args) => originalWarn(...truncateLargeOutput(args));

// ✅ Fix: CORS to allow frontend
app.use(
  cors({
    origin: process.env.NODE_ENV === "production"
      ? ["https://news-aggregator-fe.onrender.com"]
      : ["http://localhost:3000", "http://localhost:3001"], // Allow localhost in development
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json()); // Allows JSON body parsing

// Mount v1 router (iOS endpoints)
app.use("/v1", v1Router);

// Mount internal router (protected by INTERNAL_API_KEY)
app.use("/internal", internalRouter);

// Default user ID (until authentication is added)
const DEFAULT_USER_ID = 1;

// ==================== ADMIN UI ENDPOINTS (Legacy - kept for admin UI) ====================
// These endpoints are kept for the existing admin UI but protected or moved to /internal

// ✅ Route to fetch news articles from multiple sources (NewsAPI + GNews)
// PROTECTED: Only allow scraping if internal key provided, otherwise return cached
app.get("/api/news", async (req, res) => {
  const { category, search, page, from, to, sortBy, sources, scrape, sourceLimits } = req.query;
  // Standardize scrape parameter: accept boolean, "true", "1", or "false"/"0"
  const shouldScrape = scrape === true || scrape === "true" || scrape === "1";
  
  // Debug logging
  console.log(`[Regular News] Received request - scrape parameter: ${JSON.stringify(scrape)}, shouldScrape: ${shouldScrape}, category: ${category}`);

  try {
    // Parse sources parameter (comma-separated: "newsapi,gnews" or single: "newsapi")
    let sourceArray = null;
    if (sources) {
      sourceArray = String(sources).split(',').map(s => s.trim().toLowerCase()).filter(s => s);
      console.log(`[Regular News] Parsed sources array:`, sourceArray);
    } else {
      console.log(`[Regular News] No sources parameter provided - will fetch from all sources`);
    }
    
    // Parse source limits
    let parsedSourceLimits = { newsapi: 10, gnews: 10, googlerss: 10 }; // Default limits
    if (sourceLimits) {
      try {
        parsedSourceLimits = typeof sourceLimits === 'string' ? JSON.parse(sourceLimits) : sourceLimits;
        console.log(`[Regular News] Parsed source limits:`, parsedSourceLimits);
      } catch (e) {
        console.warn(`[Regular News] Failed to parse sourceLimits, using defaults:`, e.message);
      }
    }

    // If scrape=false or not provided, return cached articles from database
    if (!shouldScrape) {
      console.log(`[Regular News] Returning cached articles (scrape=false)`);
      const { getArticlesFromDatabaseByQuery } = require("./data/articleStorage");
      // Don't pass category - it's only for API calls, not database queries
      // Increase limit to get more articles for pagination
      const pageNum = parseInt(page) || 1;
      const pageSize = 20;
      const cachedArticles = getArticlesFromDatabaseByQuery(search || "", {
        from: from || undefined,
        to: to || undefined,
        limit: pageNum * pageSize + 100, // Get enough articles for pagination (with buffer)
        sources: sourceArray,
      });
      
      console.log(`[Regular News] Found ${cachedArticles.length} cached articles in database`);
      
      // Apply pagination
      const startIndex = (pageNum - 1) * pageSize;
      const paginatedArticles = cachedArticles.slice(startIndex, startIndex + pageSize);
      
      return res.json({
        status: "ok",
        totalResults: cachedArticles.length,
        articles: paginatedArticles,
        cached: true,
      });
    }

    // If scrape=true, require internal API key for security
    const providedKey = req.headers['x-internal-key'];
    const expectedKey = process.env.INTERNAL_API_KEY;
    
    if (!providedKey || providedKey !== expectedKey) {
      console.warn(`[Regular News] Scraping attempted without valid internal key from ${req.ip}`);
      return res.status(403).json({ 
        error: "Scraping requires internal API key. Use /internal/ingest endpoint or provide x-internal-key header." 
      });
    }

    // If scrape=true, fetch from APIs
    // Check if at least one API key is configured
    const hasNewsAPI = !!process.env.NEWS_API_KEY;
    const hasGNews = !!process.env.GNEWS_API_KEY;

    if (!hasNewsAPI && !hasGNews) {
      return res.status(500).json({ 
        error: "No news API keys configured. Please set NEWS_API_KEY or GNEWS_API_KEY in backend/.env file" 
      });
    }

    // Fetch from multiple sources and merge results
    // Note: fetchNewsFromMultipleSources will automatically save all fetched articles to the database
    console.log(`[Regular News] SCRAPING: Fetching NEW articles from APIs (scrape=true)...`);
    console.log(`[Regular News] Query params - search: "${search}", category: "${category}", page: ${page}, sources: ${sourceArray ? sourceArray.join(',') : 'all'}`);
    
    // Use category as query if no search term provided
    const queryForAPI = search || category || "general";
    console.log(`[Regular News] Using query: "${queryForAPI}" for API call`);
    
    const articles = await fetchNewsFromMultipleSources(queryForAPI, {
      category: category || "business",
      page: parseInt(page) || 1,
      sourceLimits: parsedSourceLimits,
      from: from || undefined,
      to: to || undefined,
      sortBy: sortBy || "publishedAt",
      sources: sourceArray,
    });
    
    console.log(`[Regular News] SCRAPING COMPLETE: Fetched ${articles.length} NEW articles from APIs (saved to database)`);
    if (articles.length > 0) {
      console.log(`[Regular News] Sample article URLs:`, articles.slice(0, 3).map(a => a.url));
    }

    // Return in NewsAPI-compatible format
    res.json({
      status: "ok",
      totalResults: articles.length,
      articles: articles,
      cached: false,
    });
  } catch (error) {
    // Truncate error output to avoid CSS/HTML noise
    const errorData = error.response?.data;
    const errorMsg = typeof errorData === 'string' && errorData.length > 500 
      ? errorData.substring(0, 200) + '... (truncated)' 
      : errorData;
    console.error("Error fetching news:", errorMsg || error.message);
    const errorMessage = error.response?.data?.message || error.message || "Unknown error";
    res.status(500).json({ 
      error: "Failed to fetch news",
      details: errorMessage
    });
  }
});

// ==================== Holdings CRUD Endpoints ====================

// GET /api/holdings - Get all holdings for default user
app.get("/api/holdings", (req, res) => {
  try {
    const db = getDatabase();
    const holdings = db
      .prepare("SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?")
      .all(DEFAULT_USER_ID);

    res.json(holdings);
  } catch (error) {
    console.error("Error fetching holdings:", error);
    res.status(500).json({ error: "Failed to fetch holdings" });
  }
});

// POST /api/holdings - Create a new holding for default user
app.post("/api/holdings", (req, res) => {
  try {
    const { ticker, label, notes } = req.body;

    // Validation
    if (!ticker || typeof ticker !== "string" || ticker.trim().length === 0) {
      return res.status(400).json({ error: "Ticker is required and must be a non-empty string" });
    }

    // Normalize ticker (uppercase, trim)
    const normalizedTicker = ticker.trim().toUpperCase();

    // Validate ticker format (1-5 alphanumeric characters)
    if (!/^[A-Z0-9]{1,5}$/.test(normalizedTicker)) {
      return res.status(400).json({ error: "Invalid ticker format. Use 1-5 letters/numbers (e.g., AAPL, NVDA)" });
    }

    const db = getDatabase();

    // Check for duplicate ticker for this user
    const existing = db
      .prepare("SELECT id FROM holdings WHERE user_id = ? AND ticker = ?")
      .get(DEFAULT_USER_ID, normalizedTicker);

    if (existing) {
      return res.status(409).json({ error: "This ticker is already in your holdings" });
    }

    // Insert new holding
    const result = db
      .prepare(
        "INSERT INTO holdings (user_id, ticker, label, notes) VALUES (?, ?, ?, ?)"
      )
      .run(
        DEFAULT_USER_ID,
        normalizedTicker,
        label && typeof label === "string" ? label.trim() || null : null,
        notes && typeof notes === "string" ? notes.trim() || null : null
      );

    // Return the created holding
    const newHolding = db
      .prepare("SELECT id, ticker, label, notes FROM holdings WHERE id = ?")
      .get(result.lastInsertRowid);

    res.status(201).json(newHolding);
  } catch (error) {
    console.error("Error creating holding:", error);
    res.status(500).json({ error: "Failed to create holding" });
  }
});

// DELETE /api/holdings/:id - Delete a holding by ID for default user
app.delete("/api/holdings/:id", (req, res) => {
  try {
    const holdingId = parseInt(req.params.id, 10);

    if (isNaN(holdingId)) {
      return res.status(400).json({ error: "Invalid holding ID" });
    }

    const db = getDatabase();

    // Check if holding exists and belongs to default user
    const holding = db
      .prepare("SELECT id FROM holdings WHERE id = ? AND user_id = ?")
      .get(holdingId, DEFAULT_USER_ID);

    if (!holding) {
      return res.status(404).json({ error: "Holding not found" });
    }

    // Delete the holding
    db.prepare("DELETE FROM holdings WHERE id = ? AND user_id = ?").run(
      holdingId,
      DEFAULT_USER_ID
    );

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting holding:", error);
    res.status(500).json({ error: "Failed to delete holding" });
  }
});

// ==================== Feed Endpoints ====================

// GET /api/feed - Get articles that have completed all processing stages and are ready for the feed
app.get("/api/feed", (req, res) => {
  try {
    const { from, to, sources, limit, minScore } = req.query;
    
    // Get user's holdings from database (required for feed filtering)
    const db = getDatabase();
    const holdingsFromDB = db
      .prepare("SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?")
      .all(DEFAULT_USER_ID);
    
    // Holdings are used for prioritization, not filtering
    // Feed should show articles even if user has no holdings (macro/market news)
    if (holdingsFromDB.length > 0) {
      console.log(`[Feed] Using ${holdingsFromDB.length} holdings for prioritization: ${holdingsFromDB.map(h => h.ticker).join(', ')}`);
    } else {
      console.log(`[Feed] No holdings found - showing all articles ranked by score`);
    }
    
    // Parse sources parameter
    let sourceArray = null;
    if (sources) {
      sourceArray = Array.isArray(sources) 
        ? sources 
        : sources.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
    }
    
    const { getFeedArticles } = require("./data/articleStorage");
    const articles = getFeedArticles({
      from: from || undefined,
      to: to || undefined,
      sources: sourceArray,
      limit: limit ? parseInt(limit) : 100,
      minScore: minScore ? parseFloat(minScore) : 40,
      holdings: holdingsFromDB, // Pass holdings for prioritization (not filtering)
    });
    
    console.log(`[Feed] Returning ${articles.length} articles for feed`);
    
    res.json({
      status: "ok",
      totalResults: articles.length,
      articles,
    });
  } catch (error) {
    console.error("Error fetching feed articles:", error);
    res.status(500).json({ 
      error: "Failed to fetch feed articles",
      details: error.message
    });
  }
});

// GET /api/snapshot - Get curated daily snapshot (3-8 articles)
// Philosophy: Calm, curated insights not overwhelming feeds
app.get("/api/snapshot", (req, res) => {
  try {
    const db = getDatabase();

    // Get user's holdings
    const holdingsFromDB = db
      .prepare("SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?")
      .all(DEFAULT_USER_ID);

    // Get top articles from last 24 hours, limit to 8
    // Prioritize: high exposure first, then by score
    // For testing: relaxed time filter (7 days instead of 24 hours)
    // Include LLM-generated fields for proper formatting
    const articles = db.prepare(`
      SELECT
        url, title, description, source_name, published_at, url_to_image,
        profile_adjusted_score, exposure_level, category, event_type,
        matched_holdings, impact_score, feed_source, searched_by,
        personalized_title, personalized_teaser, why_it_matters,
        summary_enriched, summary_short, summary_medium
      FROM articles
      WHERE status = 'ranked'
        AND profile_adjusted_score >= 25
        AND datetime(published_at) >= datetime('now', '-7 days')
      ORDER BY
        CASE exposure_level
          WHEN 'high' THEN 1
          WHEN 'moderate' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        profile_adjusted_score DESC,
        published_at DESC
      LIMIT 8
    `).all();

    // Determine if "all clear" state
    const allClear = articles.length === 0 ||
                     (articles.length > 0 && articles.every(a => a.exposure_level === 'low' && a.profile_adjusted_score < 35));

    // Format articles for calm display
    const formattedArticles = articles.map(a => {
      let matchedHoldings = [];
      try {
        matchedHoldings = a.matched_holdings ? JSON.parse(a.matched_holdings) : [];
      } catch (e) {
        // Ignore parse errors
      }

      return {
        url: a.url,
        title: a.personalized_title || a.title, // Use LLM-generated personalized title if available
        description: a.description,
        source: { name: a.source_name },
        publishedAt: a.published_at,
        urlToImage: a.url_to_image,
        feedSource: a.feed_source,
        searchedBy: a.searched_by,

        // Wealthy Rabbit specific fields
        exposureLevel: a.exposure_level || 'low',
        category: a.category || 'company',
        eventType: a.event_type,
        impactScore: a.impact_score,
        profileAdjustedScore: a.profile_adjusted_score,
        matchedHoldings,
        
        // LLM-generated formatted fields
        personalizedTitle: a.personalized_title || null,
        personalizedTeaser: a.personalized_teaser || null,
        whyItMatters: a.why_it_matters || null,
        summaryEnriched: a.summary_enriched || a.summary_medium || a.summary_short || null,
      };
    });

    // Group by category for better organization
    const grouped = {
      macro: formattedArticles.filter(a => a.category === 'macro'),
      industry: formattedArticles.filter(a => a.category === 'industry'),
      company: formattedArticles.filter(a => a.category === 'company'),
    };

    res.json({
      status: "ok",
      allClear,
      message: allClear
        ? "Nothing significant requires your attention today. Your holdings are stable."
        : `${articles.length} meaningful updates for you today.`,
      snapshot: formattedArticles,
      grouped,
      metadata: {
        holdings: holdingsFromDB.map(h => h.ticker),
        timeWindow: "24 hours",
        maxArticles: 8,
      },
    });
  } catch (error) {
    console.error("Error fetching snapshot:", error);
    res.status(500).json({
      error: "Failed to fetch daily snapshot",
      details: error.message
    });
  }
});

// GET /api/feed/debug - Debug endpoint to see what articles exist and their status
app.get("/api/feed/debug", (req, res) => {
  try {
    const db = getDatabase();
    
    // Get all articles with their processing status
    const allArticles = db.prepare(`
      SELECT 
        url,
        title,
        status,
        profile_adjusted_score,
        final_rank_score,
        shown_to_user,
        searched_by,
        published_at
      FROM articles
      ORDER BY published_at DESC
      LIMIT 50
    `).all();
    
    // Get personalized articles count
    const personalizedCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM articles
      WHERE status = 'personalized' AND status != 'discarded'
    `).get();
    
    // Get ranked articles count
    const rankedCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM articles
      WHERE status = 'ranked' OR shown_to_user = 1
    `).get();
    
    // Get articles for NVDA and AAPL
    const nvdaArticles = db.prepare(`
      SELECT COUNT(*) as count, status
      FROM articles
      WHERE searched_by IN ('NVDA', 'NVIDIA')
      GROUP BY status
    `).all();
    
    const aaplArticles = db.prepare(`
      SELECT COUNT(*) as count, status
      FROM articles
      WHERE searched_by IN ('AAPL', 'APPLE')
      GROUP BY status
    `).all();
    
    res.json({
      status: "ok",
      stats: {
        totalArticles: allArticles.length,
        personalizedCount: personalizedCount?.count || 0,
        rankedCount: rankedCount?.count || 0,
        nvdaArticles,
        aaplArticles,
      },
      sampleArticles: allArticles.slice(0, 10),
    });
  } catch (error) {
    console.error("Error in feed debug:", error);
    res.status(500).json({ 
      error: "Failed to get debug info",
      details: error.message
    });
  }
});

// ==================== Enriched News Endpoints ====================

// POST /api/news/holdings/enriched - Scrape news articles for holdings (upstream only, no pipeline)
// This is the "Scrape New Articles" button - only does fetching, no LLM/pipeline processing
// PROTECTED: Requires internal key for scraping
app.post("/api/news/holdings/enriched", async (req, res) => {
  try {
    const { holdings: holdingsArray, page, from, to, sources, scrape, sourceLimits } = req.body;
    // Standardize scrape parameter: accept boolean, "true", or "1"
    const shouldScrape = scrape === true || scrape === "true" || scrape === "1";

    console.log(`[Enriched News] Received request - sources:`, sources, `Type:`, typeof sources, `IsArray:`, Array.isArray(sources));
    
    // Parse sources parameter
    let sourceArray = null;
    if (sources) {
      if (Array.isArray(sources)) {
        sourceArray = sources.map(s => String(s).toLowerCase().trim()).filter(s => s);
      } else if (typeof sources === 'string') {
        sourceArray = sources.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
      }
      // Only set sourceArray if it has valid values
      if (sourceArray && sourceArray.length === 0) {
        sourceArray = null;
      }
      console.log(`[Enriched News] Parsed sources array:`, sourceArray);
    } else {
      console.log(`[Enriched News] No sources parameter provided - will fetch from all sources`);
    }
    
    // Parse source limits
    let parsedSourceLimits = { newsapi: 10, gnews: 10, googlerss: 10 }; // Default limits
    if (sourceLimits) {
      parsedSourceLimits = typeof sourceLimits === 'object' ? sourceLimits : (typeof sourceLimits === 'string' ? JSON.parse(sourceLimits) : parsedSourceLimits);
      console.log(`[Enriched News] Parsed source limits:`, parsedSourceLimits);
    }

    // If no holdings provided, fetch all articles from database
    if (!holdingsArray || !Array.isArray(holdingsArray) || holdingsArray.length === 0) {
      // Fetch all articles from database (no holdings filter)
      if (!shouldScrape) {
        const db = getDatabase();
        let sql = "SELECT * FROM articles WHERE 1=1";
        const params = [];
        
        if (from) {
          sql += " AND published_at >= ?";
          params.push(from);
        }
        if (to) {
          sql += " AND published_at <= ?";
          params.push(to);
        }
        if (sourceArray && sourceArray.length > 0) {
          const placeholders = sourceArray.map(() => "?").join(",");
          sql += ` AND feed_source IN (${placeholders})`;
          params.push(...sourceArray);
        }
        
        sql += " ORDER BY published_at DESC LIMIT 1000";
        const rows = db.prepare(sql).all(...params);
        
        const articles = rows.map(row => ({
          source: { id: row.source_id, name: row.source_name },
          author: row.author,
          title: row.title,
          description: row.description,
          url: row.url,
          urlToImage: row.url_to_image,
          publishedAt: row.published_at,
          content: row.content,
          feedSource: row.feed_source || null,
          searchedBy: row.searched_by || null,
        }));
        
        return res.json({
          status: "ok",
          totalResults: articles.length,
          articles: articles,
          cached: true,
        });
      } else {
        // Can't scrape without holdings (need to know what to search for)
      return res.status(400).json({ 
          error: "Holdings array is required for scraping. For cached articles, leave holdings empty." 
      });
      }
    }

    // Normalize tickers
    const tickers = holdingsArray.map(t => String(t).toUpperCase().trim()).filter(t => t);
    
    if (tickers.length === 0) {
      return res.status(400).json({ 
        error: "Invalid holdings array. Expected array of ticker strings."
      });
    }
    
    // Load holdings from DB
    const db = getDatabase();
    const placeholders = tickers.map(() => "?").join(",");
    const holdingsFromDB = db
      .prepare(`SELECT id, ticker, label, notes FROM holdings WHERE user_id = ? AND ticker IN (${placeholders})`)
      .all(DEFAULT_USER_ID, ...tickers);

    if (holdingsFromDB.length === 0) {
      return res.status(404).json({ 
        error: "No holdings found for the provided tickers. Please add holdings first."
      });
    }

    // If scrape=false or not provided, return cached articles from database
    if (!shouldScrape) {
      const { getCachedArticlesForHoldings } = require("./data/articleStorage");
      const articles = getCachedArticlesForHoldings(holdingsFromDB, {
        from: from || undefined,
        to: to || undefined,
        limit: 1000,
        sources: sourceArray,
      });
      
      return res.json({
        status: "ok",
        totalResults: articles.length,
        articles: articles,
        cached: true,
      });
    }

    // If scrape=true, require internal API key
    const providedKey = req.headers['x-internal-key'];
    const expectedKey = process.env.INTERNAL_API_KEY;
    
    if (!providedKey || providedKey !== expectedKey) {
      console.warn(`[Enriched News] Scraping attempted without valid internal key from ${req.ip}`);
      return res.status(403).json({ 
        error: "Scraping requires internal API key. Use /internal/ingest endpoint or provide x-internal-key header." 
      });
    }

    // If scrape=true, fetch from APIs (upstream scraping only, no pipeline)
    console.log(`[Enriched News] SCRAPING: Fetching articles from APIs for ${holdingsFromDB.length} holdings...`);
    
    // fetchArticlesForHoldings will:
    // - Call fetchNewsFromMultipleSources for each holding (GNews + NewsAPI)
    // - Merge + deduplicate
    // - Call saveArticles(allArticles, searchedByTicker)
    // - NOT call any LLMs
    // - NOT fetch full HTML (no JSDOM)
    const uniqueArticles = await fetchArticlesForHoldings(holdingsFromDB, {
      page: parseInt(page) || 1,
      from: from || undefined,
      to: to || undefined,
      sources: sourceArray,
      sourceLimits: parsedSourceLimits,
    });

    console.log(`[Enriched News] SCRAPING COMPLETE: Fetched ${uniqueArticles.length} articles (saved to database)`);
    
    // Return articles after scraping (frontend expects articles array)
    res.json({
      status: "ok",
      message: "Scrape completed",
      fetched: uniqueArticles.length,
      totalResults: uniqueArticles.length,
      articles: uniqueArticles,
      cached: false,
    });
  } catch (error) {
    console.error("Error scraping articles:", error);
    res.status(500).json({ 
      error: "Failed to scrape articles",
      details: error.message
    });
  }
});

// ==================== Legacy Enrichment Endpoints - REMOVED ====================
// Old triage/enrich endpoints removed - use /internal/process instead

// DELETE /api/articles/clear - Clear all articles from database
app.delete("/api/articles/clear", (req, res) => {
  try {
    const { clearAllArticles } = require("./data/articleStorage");
    const deletedCount = clearAllArticles();
    res.json({
      status: "ok",
      message: `Cleared ${deletedCount} articles from database`,
      deleted: deletedCount,
    });
  } catch (error) {
    console.error("Error clearing articles:", error);
    res.status(500).json({
      error: "Failed to clear articles",
      details: error.message,
    });
  }
});

// ==================== Article Processing Pipeline Endpoints ====================
// Legacy /api/articles/process and /api/articles/rank endpoints removed
// Use /internal/process and /internal/rank instead

// GET /api/articles - Public API endpoint for external apps to query articles by ticker symbols
// Example: /api/articles?tickers=NVDA,AAPL&limit=50&minScore=40
app.get("/api/articles", (req, res) => {
  try {
    const { 
      tickers,           // Required: comma-separated ticker symbols (e.g., "NVDA,AAPL")
      limit = 50,        // Optional: max number of articles to return (default: 50)
      minScore,          // Optional: minimum relevance score (default: no filter)
      from,              // Optional: start date (ISO format: "2025-01-01")
      to,                // Optional: end date (ISO format: "2025-12-31")
      sources,           // Optional: comma-separated sources (e.g., "gnews,newsapi")
      processedOnly = "true" // Optional: only return processed articles with scores (default: true)
    } = req.query;

    console.log(`[API /api/articles] Query received - tickers: ${tickers}, limit: ${limit}, minScore: ${minScore}, processedOnly: ${processedOnly}`);

    const db = getDatabase();
    
    // If tickers not provided, try to get from user's holdings
    let tickersToUse = tickers;
    if (!tickersToUse) {
      const holdingsFromDB = db
        .prepare("SELECT ticker FROM holdings WHERE user_id = ?")
        .all(DEFAULT_USER_ID);
      
      if (holdingsFromDB.length > 0) {
        tickersToUse = holdingsFromDB.map(h => h.ticker).join(',');
        console.log(`[API /api/articles] No tickers provided, using holdings from database: ${tickersToUse}`);
      } else {
        return res.status(400).json({
          error: "Missing required parameter: tickers",
          message: "Please provide ticker symbols as comma-separated values (e.g., ?tickers=NVDA,AAPL) or add holdings to your account"
        });
      }
    }
    
    // Parse tickers (uppercase, trim, filter empty)
    const tickerArray = tickersToUse
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0);

    if (tickerArray.length === 0) {
      return res.status(400).json({
        error: "Invalid tickers parameter",
        message: "Please provide at least one valid ticker symbol"
      });
    }

    console.log(`[API /api/articles] Parsed tickers: ${tickerArray.join(', ')}`);

    // Build SQL query
    let sql = "SELECT * FROM articles WHERE 1=1";
    const params = [];

    // Filter by tickers in searched_by field (exact match or comma-separated)
    const tickerConditions = tickerArray.map(ticker => {
      return `(
        searched_by = ? 
        OR searched_by LIKE ? || ',%'
        OR searched_by LIKE '%,' || ? || ',%'
        OR searched_by LIKE '%,' || ?
      )`;
    }).join(' OR ');
    
    sql += ` AND (${tickerConditions})`;
    
    // Add parameters for each ticker (4 params per ticker)
    for (const ticker of tickerArray) {
      params.push(ticker, ticker, ticker, ticker);
    }

    // Filter by processed status if requested
    if (processedOnly === "true" || processedOnly === true) {
      sql += ` AND (
        (status = 'personalized' OR status = 'ranked')
        AND status != 'discarded'
        AND (profile_adjusted_score IS NOT NULL OR final_rank_score IS NOT NULL)
      )`;
    } else {
      // Exclude discarded articles even if processedOnly is false
      sql += ` AND status != 'discarded'`;
    }

    // Filter by minimum score if provided
    if (minScore) {
      const score = parseFloat(minScore);
      if (!isNaN(score)) {
        sql += ` AND COALESCE(final_rank_score, profile_adjusted_score, 0) >= ?`;
        params.push(score);
      }
    }

    // Filter by sources if provided
    if (sources) {
      const sourceArray = sources
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
      
      if (sourceArray.length > 0) {
        const placeholders = sourceArray.map(() => "?").join(",");
        sql += ` AND feed_source IN (${placeholders})`;
        params.push(...sourceArray);
      }
    }

    // Filter by date range
    if (from) {
      sql += " AND published_at >= ?";
      params.push(from);
    }
    
    if (to) {
      sql += " AND published_at <= ?";
      params.push(to);
    }

    // Order by relevance score (if available) or by date
    if (processedOnly === "true" || processedOnly === true) {
      sql += " ORDER BY COALESCE(final_rank_score, profile_adjusted_score) DESC, published_at DESC";
    } else {
      sql += " ORDER BY published_at DESC";
    }

    // Apply limit
    sql += " LIMIT ?";
    params.push(parseInt(limit) || 50);

    console.log(`[API /api/articles] Executing query with ${params.length} parameters`);

    // Execute query
    const rows = db.prepare(sql).all(...params);

    console.log(`[API /api/articles] Found ${rows.length} articles`);

    // Transform rows to clean JSON format
    const articles = rows.map(row => {
      // Parse relevance scores from JSON if available
      let relevanceScores = {};
      if (row.relevance_scores_json) {
        try {
          relevanceScores = JSON.parse(row.relevance_scores_json);
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Build clean article object
      const article = {
        id: row.url, // Use URL as unique identifier
        title: row.title,
        description: row.description,
        url: row.url,
        source: {
          name: row.source_name,
          id: row.source_id || null,
        },
        author: row.author || null,
        publishedAt: row.published_at,
        imageUrl: row.url_to_image || null,
        content: row.content || null,
        searchedBy: row.searched_by || null,
        feedSource: row.feed_source || null,
      };

      // Add enrichment data if available
      if (row.summary_enriched || row.summary_short) {
        article.summary = row.summary_enriched || row.summary_short || "";
      }

      if (row.why_it_matters || row.personalized_teaser) {
        article.whyItMatters = row.why_it_matters || row.personalized_teaser || "";
      }

      // Add relevance scores
      if (Object.keys(relevanceScores).length > 0) {
        article.relevanceScores = relevanceScores;
      }

      // Add processing scores if available
      if (row.profile_adjusted_score !== null) {
        article.relevanceScore = row.profile_adjusted_score;
      }
      
      if (row.final_rank_score !== null) {
        article.finalRankScore = row.final_rank_score;
      }

      // Add sentiment and impact data if available
      if (row.sentiment !== null) {
        article.sentiment = {
          score: row.sentiment,
          label: row.sentiment_label || null,
        };
      }

      if (row.impact_score !== null) {
        article.impactScore = row.impact_score;
      }

      // Add matched tickers/sectors if available
      if (row.matched_tickers) {
        try {
          article.matchedTickers = JSON.parse(row.matched_tickers);
        } catch (e) {
          article.matchedTickers = row.matched_tickers.split(',').map(t => t.trim());
        }
      }

      if (row.matched_sectors) {
        try {
          article.matchedSectors = JSON.parse(row.matched_sectors);
        } catch (e) {
          article.matchedSectors = row.matched_sectors.split(',').map(s => s.trim());
        }
      }

      // Add status
      article.status = row.status || null;

      return article;
    });

    // Return response
    res.json({
      status: "ok",
      query: {
        tickers: tickerArray,
        limit: parseInt(limit) || 50,
        minScore: minScore ? parseFloat(minScore) : null,
        from: from || null,
        to: to || null,
        sources: sources ? sources.split(',').map(s => s.trim()) : null,
        processedOnly: processedOnly === "true" || processedOnly === true,
      },
      totalResults: articles.length,
      articles: articles,
    });

  } catch (error) {
    console.error("Error querying articles:", error);
    res.status(500).json({
      error: "Failed to query articles",
      details: error.message
    });
  }
});

// GET /api/articles/discarded - Get discarded articles with their discard reasons
// PROTECTED: Requires internal key (admin only)
app.get("/api/articles/discarded", requireInternalKey, (req, res) => {
  try {
    const { limit = 100, from, to, sources, holdings } = req.query;
    const db = getDatabase();
    
    let sql = `SELECT 
      url, title, description, source_name, source_id, author, 
      published_at, url_to_image, feed_source, searched_by,
      status, title_reason_short, title_relevance, title_event_type,
      impact_score, event_type, created_at, updated_at
      FROM articles 
      WHERE status = 'discarded'`;
    const params = [];
    
    // Filter by date range
    if (from) {
      sql += " AND published_at >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND published_at <= ?";
      params.push(to);
    }
    
    // Filter by sources
    if (sources) {
      const sourceArray = String(sources).split(',').map(s => s.trim().toLowerCase());
      const placeholders = sourceArray.map(() => "?").join(",");
      sql += ` AND feed_source IN (${placeholders})`;
      params.push(...sourceArray);
    }
    
    // Filter by holdings (searched_by)
    if (holdings) {
      const holdingsArray = String(holdings).split(',').map(h => h.trim().toUpperCase());
      const placeholders = holdingsArray.map(() => "?").join(",");
      sql += ` AND searched_by IN (${placeholders})`;
      params.push(...holdingsArray);
    }
    
    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(parseInt(limit) || 100);
    
    const rows = db.prepare(sql).all(...params);
    
    const articles = rows.map(row => ({
      url: row.url,
      title: row.title,
      description: row.description,
      source: {
        name: row.source_name,
        id: row.source_id || null,
      },
      author: row.author || null,
      publishedAt: row.published_at,
      urlToImage: row.url_to_image || null,
      feedSource: row.feed_source || null,
      searchedBy: row.searched_by || null,
      status: row.status,
      discardReason: row.title_reason_short || "No reason provided",
      titleRelevance: row.title_relevance,
      titleEventType: row.title_event_type,
      impactScore: row.impact_score,
      eventType: row.event_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    res.json({
      status: "ok",
      totalResults: articles.length,
      articles: articles,
    });
  } catch (error) {
    console.error("Error fetching discarded articles:", error);
    res.status(500).json({
      error: "Failed to fetch discarded articles",
      details: error.message
    });
  }
});

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught Exception:', error.message);
  console.error(error.stack);
  // Don't exit - let the server try to continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let the server try to continue
});

// Start the server with automatic port finding
async function startServer() {
  let PORT = DEFAULT_PORT;
  
  // In development, try to find an available port if default is taken
  if (process.env.NODE_ENV !== 'production' && !process.env.PORT) {
    const available = await isPortAvailable(PORT);
    if (!available) {
      console.log(`[Info] Port ${PORT} is in use, searching for available port...`);
      try {
        PORT = await findAvailablePort(PORT);
        console.log(`[Info] Using port ${PORT} instead`);
      } catch (error) {
        console.error(`[Error] ${error.message}`);
        console.error(`[Error] Please free up a port or set PORT environment variable`);
        process.exit(1);
      }
    }
  }
  
  const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`[Server] v1 endpoints available at /v1/*`);
    console.log(`[Server] Internal endpoints available at /internal/* (requires x-internal-key header)`);
    console.log(`[Server] API base URL: http://localhost:${PORT}`);
    
    // Start scheduler (if not disabled)
    startScheduler();
  });

  // Handle server errors (like port already in use)
  server.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      // In production or when PORT is explicitly set, fail fast
      if (process.env.PORT || process.env.NODE_ENV === 'production') {
        console.error(`[Error] Port ${PORT} is already in use. Please stop the existing server or use a different port.`);
        console.error(`[Error] To find and kill the process: lsof -ti:${PORT} | xargs kill`);
        process.exit(1);
      } else {
        // In development, try to find another port
        console.log(`[Info] Port ${PORT} is in use, trying alternative port...`);
        try {
          PORT = await findAvailablePort(PORT + 1);
          console.log(`[Info] Retrying on port ${PORT}...`);
          // Restart server on new port
          const newServer = app.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`[Server] API base URL: http://localhost:${PORT}`);
            startScheduler();
          });
          newServer.on('error', (err) => {
            console.error('[Error] Failed to start server:', err);
            process.exit(1);
          });
        } catch (err) {
          console.error(`[Error] Could not find available port: ${err.message}`);
          process.exit(1);
        }
      }
    } else {
      console.error('[Error] Server error:', error);
      throw error;
    }
  });
  
  return server;
}

// Start the server
startServer().catch((error) => {
  console.error('[Fatal] Failed to start server:', error);
  process.exit(1);
});
