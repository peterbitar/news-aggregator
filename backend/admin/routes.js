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
const { getDecisionLogByStage, getArticleDecisionLog } = require("../data/storyGroupStorage");

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

/**
 * GET /internal/decision-logs
 * Get decision logs for monitoring pipeline decisions
 * Query params:
 *   - stage: filter by stage_name (e.g., "clustering", "llm_filtering", "impact_scoring")
 *   - scope: filter by scope ("GLOBAL", "TICKER")
 *   - ticker: filter by primary_ticker
 *   - limit: max results (default 100)
 *   - offset: pagination (default 0)
 */
router.get("/decision-logs", (req, res) => {
  try {
    const db = getDatabase();
    const { stage, scope, ticker, limit = 100, offset = 0 } = req.query;

    let query = "SELECT * FROM article_decision_log WHERE 1=1";
    const params = [];

    if (stage) {
      query += " AND stage_name = ?";
      params.push(stage);
    }

    if (scope) {
      query += " AND scope = ?";
      params.push(scope);
    }

    if (ticker) {
      query += " AND primary_ticker = ?";
      params.push(ticker);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const logs = db.prepare(query).all(...params);

    const countQuery = query.replace(/LIMIT.*OFFSET.*$/, "").replace(/ORDER BY.*$/, "");
    const countResult = db.prepare(`SELECT COUNT(*) as total FROM (${countQuery})`).get(...params.slice(0, -2));

    res.json({
      logs,
      total: countResult?.total || 0,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (error) {
    console.error("[internal/decision-logs] Error:", error);
    res.status(500).json({ error: "Failed to fetch decision logs", details: error.message });
  }
});

/**
 * GET /internal/decision-logs/:articleUrl
 * Get decision logs for a specific article
 */
router.get("/decision-logs/:articleUrl", (req, res) => {
  try {
    const { articleUrl } = req.params;
    const decodedUrl = decodeURIComponent(articleUrl);

    const logs = getArticleDecisionLog(decodedUrl);

    res.json({
      article_url: decodedUrl,
      logs,
      total: logs.length,
    });
  } catch (error) {
    console.error("[internal/decision-logs/:articleUrl] Error:", error);
    res.status(500).json({ error: "Failed to fetch article decision logs", details: error.message });
  }
});

/**
 * GET /internal/story-groups
 * Get story groups summary for monitoring
 * Query params:
 *   - date: filter by date (YYYY-MM-DD, default: today)
 *   - scope: "GLOBAL" or "TICKER"
 *   - ticker: filter by primary_ticker
 */
router.get("/story-groups", (req, res) => {
  try {
    const db = getDatabase();
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { scope, ticker } = req.query;

    let query = "SELECT sg.*, COUNT(sga.article_id) as article_count FROM story_groups sg LEFT JOIN story_group_articles sga ON sg.id = sga.story_group_id WHERE sg.date_bucket = ?";
    const params = [date];

    if (scope) {
      query += " AND sg.scope = ?";
      params.push(scope);
    }

    if (ticker) {
      query += " AND sg.primary_ticker = ?";
      params.push(ticker);
    }

    query += " GROUP BY sg.id ORDER BY sg.impact_level, sg.created_at DESC";

    const groups = db.prepare(query).all(...params);

    res.json({
      date,
      groups,
      total: groups.length,
    });
  } catch (error) {
    console.error("[internal/story-groups] Error:", error);
    res.status(500).json({ error: "Failed to fetch story groups", details: error.message });
  }
});

module.exports = router;

