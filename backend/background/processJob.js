/**
 * Process Job
 * Runs articles through the interpretation pipeline (stages 1-4)
 */

const { getDatabase } = require("../data/db");
const articlePipeline = require("../pipeline/articlePipeline");

const DEFAULT_USER_ID = 1;

// Single-flight lock to prevent overlapping runs
let isRunning = false;

/**
 * Run the process job
 * Processes pending articles through pipeline stages 1-4
 */
async function runProcess() {
  // Check if already running
  if (isRunning) {
    console.log("[Process Job] Skipped: already running");
    return 0;
  }

  // Acquire lock
  isRunning = true;
  console.log("[Process Job] Starting...");
  
  try {
    const db = getDatabase();
    const holdings = db.prepare(`
      SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?
    `).all(DEFAULT_USER_ID);

    // Get articles that need processing (limit 25-50)
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
      LIMIT 50
    `).all();

    if (articlesToProcess.length === 0) {
      console.log("[Process Job] No articles to process");
      return 0;
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

    const results = await articlePipeline.processBatch(articles, holdings, "balanced", {
      llmBatchSize: 20,
      stage3BatchSize: 8,
      delayBetweenBatches: 1000,
    });

    const processed = results.filter(r => r.status === "personalized").length;
    console.log(`[Process Job] Complete: ${processed} articles processed`);
    return processed;
  } catch (error) {
    console.error("[Process Job] Error:", error.message);
    return 0;
  } finally {
    // Release lock
    isRunning = false;
  }
}

module.exports = { runProcess };



