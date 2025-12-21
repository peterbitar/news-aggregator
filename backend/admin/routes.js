/**
 * Internal API Router for admin/automation
 * Protected by INTERNAL_API_KEY
 */

const express = require("express");
const { requireInternalKey } = require("../core/middleware/auth");
const { getDatabase } = require("../data/db");
const { fetchNewsFromMultipleSources, fetchArticlesForHoldings } = require("../integrations/newsProviders");
const { saveArticles } = require("../data/articleStorage");
const articlePipeline = require("../pipeline/articlePipeline");
const { processRankingClustering } = require("../pipeline/stage5_rankingClustering");

const router = express.Router();

// All routes require internal API key
router.use(requireInternalKey);

/**
 * POST /internal/ingest
 * Ingest news articles from multiple sources
 */
router.post("/ingest", async (req, res) => {
  try {
    const { query, category, sources, sourceLimits, holdings } = req.body;

    const searchQuery = query || category || "business";
    const parsedSourceLimits = sourceLimits || { newsapi: 10, gnews: 10, googlerss: 10 };

    let articles = [];

    if (holdings && Array.isArray(holdings) && holdings.length > 0) {
      // Fetch for specific holdings
      const holdingsFromDB = holdings.map(h => 
        typeof h === 'string' ? { ticker: h.toUpperCase() } : h
      );
      articles = await fetchArticlesForHoldings(holdingsFromDB, {
        sources: sources,
        sourceLimits: parsedSourceLimits,
      });
    } else {
      // Fetch general news
      articles = await fetchNewsFromMultipleSources(searchQuery, {
        category: category || "business",
        sources: sources,
        sourceLimits: parsedSourceLimits,
      });
    }

    res.json({
      success: true,
      fetched: articles.length,
      articles: articles.slice(0, 10), // Return sample
    });
  } catch (error) {
    console.error("[internal/ingest] Error:", error);
    res.status(500).json({ error: "Failed to ingest articles", details: error.message });
  }
});

/**
 * POST /internal/process
 * Process articles through pipeline stages 1-4
 */
router.post("/process", async (req, res) => {
  try {
    const { limit = 50, userProfile = "balanced" } = req.body;
    const db = getDatabase();
    const DEFAULT_USER_ID = 1;

    // Get all holdings from database
    const holdings = db.prepare(`
      SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?
    `).all(DEFAULT_USER_ID);

    // Get articles that need processing
    const articlesToProcess = db.prepare(`
      SELECT url, title, description, source_name, author, published_at, searched_by, status
      FROM articles
      WHERE (
        status IS NULL 
        OR status = '' 
        OR status = 'null'
        OR status = 'pending' 
        OR status = 'title_filtered'
        OR (status = 'content_fetched' AND impact_score IS NULL)
        OR (status = 'llm_processed' AND profile_adjusted_score IS NULL)
      )
      AND (status IS NULL OR status != 'discarded')
      ORDER BY published_at DESC
      LIMIT ?
    `).all(limit);

    if (articlesToProcess.length === 0) {
      return res.json({
        success: true,
        processed: 0,
        message: "No articles need processing",
      });
    }

    const articles = articlesToProcess.map(row => ({
      url: row.url,
      title: row.title,
      description: row.description,
      source: { name: row.source_name },
      author: row.author,
      publishedAt: row.published_at,
      searchedBy: row.searched_by,
    }));

    const results = await articlePipeline.processBatch(articles, holdings, userProfile, {
      llmBatchSize: 20,
      stage3BatchSize: 8,
      delayBetweenBatches: 1000,
    });

    const processed = results.filter(r => r.status === "personalized").length;
    const discarded = results.filter(r => r.status === "discarded").length;
    const errors = results.filter(r => r.status === "error").length;

    res.json({
      success: true,
      processed,
      discarded,
      errors,
      total: articles.length,
    });
  } catch (error) {
    console.error("[internal/process] Error:", error);
    res.status(500).json({ error: "Failed to process articles", details: error.message });
  }
});

/**
 * POST /internal/rank
 * Run stage 5 ranking and clustering
 */
router.post("/rank", async (req, res) => {
  try {
    const { cutoffScore = 50, limit = 50 } = req.body;

    // Get personalized articles to rank
    const db = getDatabase();
    const articlesToRank = db.prepare(`
      SELECT url, title, personalized_title, profile_adjusted_score, impact_score,
             published_at, event_type, matched_tickers, matched_holdings
      FROM articles
      WHERE status = 'personalized'
        AND status != 'discarded'
        AND (final_rank_score IS NULL OR final_rank_score = 0)
      ORDER BY profile_adjusted_score DESC
      LIMIT ?
    `).all(limit);

    if (articlesToRank.length === 0) {
      return res.json({
        success: true,
        ranked: 0,
        message: "No articles need ranking",
      });
    }

    const result = await processRankingClustering(articlesToRank, cutoffScore);

    res.json({
      success: true,
      ranked: result.ranked || 0,
      clustered: result.clustered || 0,
      clusters: result.clusters || 0,
    });
  } catch (error) {
    console.error("[internal/rank] Error:", error);
    res.status(500).json({ error: "Failed to rank articles", details: error.message });
  }
});

/**
 * GET /internal/health
 * Health check with counts
 */
router.get("/health", (req, res) => {
  try {
    const db = getDatabase();

    const rawCount = db.prepare(`
      SELECT COUNT(*) as count FROM articles WHERE status IS NULL OR status = '' OR status = 'pending'
    `).get();

    const interpretedCount = db.prepare(`
      SELECT COUNT(*) as count FROM articles WHERE status = 'personalized'
    `).get();

    const rankedCount = db.prepare(`
      SELECT COUNT(*) as count FROM articles WHERE status = 'ranked'
    `).get();

    res.json({
      status: "ok",
      counts: {
        raw: rawCount?.count || 0,
        interpreted: interpretedCount?.count || 0,
        ranked: rankedCount?.count || 0,
      },
    });
  } catch (error) {
    console.error("[internal/health] Error:", error);
    res.status(500).json({ error: "Health check failed", details: error.message });
  }
});

module.exports = router;

