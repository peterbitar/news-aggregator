const OpenAI = require("openai");
const { getDatabase } = require("../data/db");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stage 4: Personalization
 * Personalize the article to the user based on their holdings and profile
 * 
 * Columns filled:
 * - holding_relevance_score (0-100)
 * - profile_adjusted_score (0-100)
 * - summary_short
 * - summary_medium
 * - personalized_title
 * - personalized_teaser
 * - status = "personalized"
 */
async function processPersonalization(article, userHoldings = [], userProfile = "balanced") {
  const db = getDatabase();

  // Check if already processed - skip if profile_adjusted_score is already set
  const existing = db.prepare(`
    SELECT profile_adjusted_score, status, profile_type_cached
    FROM articles WHERE url = ?
  `).get(article.url);
  
  // CRITICAL: Skip if article was discarded in previous stages
  if (existing && existing.status === "discarded") {
    console.log(`[Stage 4] Skipping ${article.url} - article was discarded in previous stage`);
    return {
      status: "discarded",
      skipped: true,
      reason: "Already discarded",
    };
  }
  
  // GUARDRAIL 5C: Check cache by (url, profileType) before recalculating
  // Add proper cache by (url, profileType) using profile_type_cached and profile_adjusted_score
  if (existing && existing.profile_type_cached === userProfile && existing.profile_adjusted_score !== null) {
    // Cache hit - reuse cached personalization scores
    console.log(`[Stage 4] Using cached personalization for ${article.url} (profile: ${userProfile}, score: ${existing.profile_adjusted_score})`);
    
    return {
      status: existing.status || "personalized",
      skipped: true,
      cached: true,
      profile_adjusted_score: existing.profile_adjusted_score,
      // Note: No interpretation fields - those are global from Stage 3
    };
  }
  
  if (existing && existing.profile_adjusted_score !== null && existing.profile_adjusted_score !== undefined) {
    // Already processed but different profile type - will regenerate
    console.log(`[Stage 4] Article already processed for different profile: ${article.url} (cached profile: ${existing.profile_type_cached}, requested: ${userProfile})`);
  }

  // Note: We no longer use LLM in Stage 4 - only score adjustments
  // This ensures interpretation is global and reused across users

  // GUARDRAIL 5C: Get article data from database, including matched_holdings and impact_score
  const articleRow = db.prepare(`
    SELECT title, clean_text, impact_score, matched_holdings, matched_tickers, event_type
    FROM articles WHERE url = ?
  `).get(article.url);

  if (!articleRow) {
    return { status: "no_article" };
  }

  // COST-AWARE: Check impact_score before calling expensive LLM
  // Holdings are NOT required - articles without holdings can still be personalized
  // But we skip expensive LLM if impact is too low (cost optimization)
  const matchedHoldings = articleRow.matched_holdings 
    ? JSON.parse(articleRow.matched_holdings) 
    : [];
  const impactScore = articleRow.impact_score || 0;
  const IMPACT_THRESHOLD = 40; // Configurable threshold for cost control

  // Skip Stage 4 LLM if impact_score < threshold (cost optimization)
  // NOTE: This is NOT holdings-gating - it's cost-aware filtering
  // Articles without holdings can still pass if impact is high enough
  if (impactScore < IMPACT_THRESHOLD) {
    console.log(`[Stage 4] Skipping LLM for ${article.url} - impact_score: ${impactScore} < ${IMPACT_THRESHOLD} (cost optimization)`);
    
    // Set lower score but don't discard - let it through with lower priority
    const profile_adjusted_score = Math.min(100, impactScore * 0.6);
    
    db.prepare(`
      UPDATE articles SET
        holding_relevance_score = matched_holdings ? 50 : 0,
        profile_adjusted_score = ?,
        status = 'personalized',
        updated_at = datetime('now')
      WHERE url = ?
    `).run(profile_adjusted_score, article.url);
    
    return {
      status: "personalized",
      skipped: true,
      reason: `Impact score ${impactScore} < ${IMPACT_THRESHOLD} (cost optimization)`,
      profile_adjusted_score,
    };
  }
  
  // If we have holdings match, boost the score; if not, still process but with lower base score
  const hasHoldingsMatch = matchedHoldings.length > 0;

  try {
    // Prepare holdings list
    const holdingsList = userHoldings.map((h) => ({
      ticker: h.ticker,
      label: h.label || h.ticker,
      notes: h.notes || "",
    }));

    // Parse matched holdings (already parsed above for guardrail check, but keep for consistency)
    // Note: matchedHoldings and impactScore already parsed above in guardrail check
    const matchedTickers = articleRow.matched_tickers
      ? JSON.parse(articleRow.matched_tickers)
      : [];

    // Calculate holding relevance score (0-100)
    // Articles without holdings matches still get a base score (not zero)
    // Holdings boost is conservative to ensure impact remains the dominant driver
    let holding_relevance_score = 20; // Base score for all articles (ensures non-holdings articles still rank)
    if (matchedHoldings.length > 0) {
      // Direct match = conservative boost (10-25, not 60-100)
      holding_relevance_score = Math.min(45, 20 + 10 + (matchedHoldings.length * 5));
    }
    // If no match, keeps base score of 20 (ensures macro/market news still appears)

    // Calculate exposure level (low/moderate/high) for user clarity
    // Philosophy: Help user understand their personal risk/opportunity exposure
    let exposure_level = "low";
    const numMatchedHoldings = matchedHoldings.length;
    const eventType = (articleRow.event_type || "").toLowerCase();
    const isSystemicEvent = eventType.includes("macro") || eventType.includes("market") ||
                            eventType.includes("regulation") || eventType.includes("recession") ||
                            eventType.includes("fed") || eventType.includes("inflation");

    if (isSystemicEvent || numMatchedHoldings >= 3) {
      exposure_level = "high"; // Systemic events or 3+ holdings affected
    } else if (numMatchedHoldings >= 2) {
      exposure_level = "moderate"; // 2 holdings affected
    } else if (numMatchedHoldings === 1) {
      exposure_level = "low"; // Only 1 holding affected
    } else {
      // No holdings matched - check if it's macro/market news
      exposure_level = isSystemicEvent ? "moderate" : "low";
    }

    // IMPORTANT: Stage 4 Personalization does NOT generate new summaries or change meaning
    // It ONLY adjusts scoring/priority based on holdings match and user profile
    // Interpretation (verdict, why, action) is global and set in Stage 3, reused across all users
    // We do NOT call LLM here - just calculate score adjustments

    // Calculate profile_adjusted_score based on user profile
    // Holdings boost relevance, but don't gate it - all articles get a score
    const impact_score = articleRow.impact_score || 0;
    let profile_adjusted_score = holding_relevance_score;
    
    // Adjust based on profile type
    // Focus profile gives more weight to holdings, but still includes macro news
    if (userProfile === "focus") {
      // Focus profile: Higher weight on holding relevance, but still includes impact
      profile_adjusted_score = Math.min(100, holding_relevance_score * 1.2 + impact_score * 0.3);
    } else if (userProfile === "balanced") {
      // Balanced: Equal weight
      profile_adjusted_score = Math.min(100, holding_relevance_score * 0.6 + impact_score * 0.4);
    } else {
      // Broad: Higher weight on impact
      profile_adjusted_score = Math.min(100, holding_relevance_score * 0.4 + impact_score * 0.6);
    }

    // Determine status based on profile_adjusted_score
    // Stage 4 only determines if article should proceed to ranking (Stage 5)
    // FEED_RANK_THRESHOLD is applied later at feed query time, not here
    // Use a low threshold here to ensure macro/market news can still pass through
    const STAGE4_MIN_SCORE = 20; // Minimum score to proceed to Stage 5 (ranking)
    let status;
    if (profile_adjusted_score >= STAGE4_MIN_SCORE) {
      status = "personalized"; // Relevant enough, move to Stage 5
    } else {
      status = "discarded"; // Very low relevance, discard
    }

    // Update database - ONLY scoring fields, NOT interpretation fields
    // Interpretation (verdict, why, action) is set in Stage 3 and reused globally
    db.prepare(`
      UPDATE articles SET
        holding_relevance_score = ?,
        profile_adjusted_score = ?,
        profile_type_cached = ?,
        exposure_level = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      holding_relevance_score,
      profile_adjusted_score,
      userProfile, // Cache the profile type
      exposure_level,
      status,
      article.url
    );

    return {
      status,
      profile_adjusted_score,
      holding_relevance_score,
      // Note: No interpretation fields returned - those are global and set in Stage 3
    };
  } catch (error) {
    console.error(`Error in Stage 4 personalization for ${article.url}:`, error.message);
    
    // On error, use fallback scores
    const impact_score = articleRow.impact_score || 0;
    const profile_adjusted_score = Math.min(100, holding_relevance_score * 0.6 + impact_score * 0.4);
    
    db.prepare(`
      UPDATE articles SET
        holding_relevance_score = ?,
        profile_adjusted_score = ?,
        status = 'personalized',
        last_error = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      holding_relevance_score,
      profile_adjusted_score,
      error.message.substring(0, 500),
      article.url
    );

    return {
      holding_relevance_score,
      profile_adjusted_score,
      status: "personalized",
      error: error.message,
    };
  }
}

module.exports = {
  processPersonalization,
};

