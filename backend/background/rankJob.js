/**
 * Rank Job
 * Runs final ranking and clustering (stage 5) on personalized articles
 */

const { getDatabase } = require("../data/db");
const { processRankingClustering } = require("../pipeline/stage5_rankingClustering");

/**
 * Run the rank job
 * Ranks and clusters personalized articles
 */
async function runRank() {
  console.log("[Rank Job] Starting...");
  try {
    const db = getDatabase();
    
    // Get personalized articles that need ranking (limit 50)
    const articlesToRank = db.prepare(`
      SELECT url, title, personalized_title, profile_adjusted_score, impact_score,
             published_at, event_type, matched_tickers, matched_holdings
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

    const result = await processRankingClustering(articlesToRank, 50);
    console.log(`[Rank Job] Complete: ${result.ranked || 0} articles ranked`);
    return result.ranked || 0;
  } catch (error) {
    console.error("[Rank Job] Error:", error.message);
    return 0;
  }
}

module.exports = { runRank };



