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

