/**
 * Rank Job
 * Runs final ranking and clustering (stage 5) on personalized articles
 */

const { getDatabase } = require("../data/db");
const { processRankingClustering } = require("../pipeline/stage5_rankingClustering");

// Single-flight lock to prevent overlapping runs
let isRunning = false;

/**
 * Run the rank job
 * Ranks and clusters personalized articles
 */
async function runRank() {
  // Check if already running
  if (isRunning) {
    console.log("[Rank Job] Skipped: already running");
    return 0;
  }

  // Acquire lock
  isRunning = true;
  console.log("[Rank Job] Starting...");
  
  try {
    const db = getDatabase();
    
    // Get personalized articles that need ranking (limit 50)
    const articlesToRank = db.prepare(`
      SELECT url, title, profile_adjusted_score, impact_score,
             published_at, event_type, matched_tickers
      FROM articles
      WHERE status = 'personalized'
        AND status != 'discarded'
        AND (final_rank_score IS NULL OR final_rank_score = 0)
      ORDER BY profile_adjusted_score DESC
      LIMIT 50
    `).all();

    if (articlesToRank.length === 0) {
      console.log("[Rank Job] No articles to rank");
      return 0;
    }

    const scoring = require("../config/scoring");
    const result = await processRankingClustering(articlesToRank, scoring.FEED_RANK_THRESHOLD);
    console.log(`[Rank Job] Complete: ${result.ranked || 0} articles ranked`);
    return result.ranked || 0;
  } catch (error) {
    console.error("[Rank Job] Error:", error.message);
    return 0;
  } finally {
    // Release lock
    isRunning = false;
  }
}

module.exports = { runRank };



