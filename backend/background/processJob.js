/**
 * Process Job
 * Runs articles through the interpretation pipeline (stages 1-4)
 */

const { getDatabase } = require("../data/db");
const articlePipeline = require("../pipeline/articlePipeline");
const { shouldReEvaluate } = require("../utils/deferredArticleEvaluator");
const { processContentClassificationPass1 } = require("../pipeline/stage3_contentClassification");

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
    // Also include deferred_low articles that should be re-evaluated
    const articlesToProcess = db.prepare(`
      SELECT url, title, description, source_name, author, published_at, searched_by, status,
             scrape_count, re_evaluation_count
      FROM articles
      WHERE (
        status IS NULL 
        OR status = '' 
        OR status = 'null'
        OR status = 'pending' 
        OR status = 'title_filtered'
        OR (status = 'content_fetched' AND impact_score IS NULL)
        OR (status = 'llm_processed' AND profile_adjusted_score IS NULL)
        OR (status = 'deferred_low' AND re_evaluation_count < 3)
      )
      AND (status IS NULL OR status != 'discarded')
      ORDER BY published_at DESC
      LIMIT 50
    `).all();
    
    // Filter deferred_low articles - only re-evaluate if shouldReEvaluate returns true
    const articlesToReEvaluate = [];
    const regularArticles = [];
    
    for (const article of articlesToProcess) {
      if (article.status === 'deferred_low') {
        if (shouldReEvaluate(article)) {
          articlesToReEvaluate.push(article);
        }
      } else {
        regularArticles.push(article);
      }
    }
    
    // Re-evaluate deferred articles by running Pass 1 again
    if (articlesToReEvaluate.length > 0) {
      console.log(`[Process Job] Re-evaluating ${articlesToReEvaluate.length} deferred articles`);
      const deferredArticles = articlesToReEvaluate.map(row => ({
        url: row.url,
        title: row.title,
        description: row.description,
        source: { name: row.source_name },
        author: row.author,
        publishedAt: row.published_at,
        searchedBy: row.searched_by,
      }));
      
      // Run Pass 1 classifier again
      const pass1Results = await processContentClassificationPass1(deferredArticles, []);
      
      // Update re_evaluation_count and check if should proceed to Pass 2
      for (let i = 0; i < deferredArticles.length; i++) {
        const article = deferredArticles[i];
        const pass1Result = pass1Results[i];
        
        // Increment re_evaluation_count
        db.prepare(`
          UPDATE articles SET
            re_evaluation_count = re_evaluation_count + 1,
            updated_at = datetime('now')
          WHERE url = ?
        `).run(article.url);
        
        // If Pass 1 now says maybe_relevant, proceed to full processing
        if (pass1Result.maybe_relevant && pass1Result.bucket !== 'low') {
          // Clear deferred status and proceed
          db.prepare(`
            UPDATE articles SET
              status = 'content_fetched',
              deferred_reason = NULL,
              updated_at = datetime('now')
            WHERE url = ?
          `).run(article.url);
          regularArticles.push(articlesToReEvaluate[i]);
        }
      }
    }
    
    // Process regular articles (including re-evaluated ones)
    const articles = regularArticles.map(row => ({
      url: row.url,
      title: row.title,
      description: row.description,
      source: { name: row.source_name },
      author: row.author,
      publishedAt: row.published_at,
      searchedBy: row.searched_by,
    }));

    if (articles.length === 0) {
      console.log("[Process Job] No articles to process");
      return 0;
    }

    const scoring = require("../config/scoring");
    const results = await articlePipeline.processBatch(articles, holdings, "balanced", {
      llmBatchSize: scoring.STAGE1_BATCH_SIZE,
      stage3BatchSize: scoring.STAGE3_BATCH_SIZE,
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



