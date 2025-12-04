const { getDatabase } = require("../db");
const { processTitleTriage, processTitleTriageBatch } = require("./stage1_titleTriage");
const { processContentFetch, processContentFetchBatch } = require("./stage2_contentFetch");
const { processContentClassification, processContentClassificationBatch } = require("./stage3_contentClassification");
const { processPersonalization } = require("./stage4_personalization");
const { processRankingClustering } = require("./stage5_rankingClustering");

/**
 * Main pipeline orchestrator
 * Processes articles through all 5 stages
 */
class ArticlePipeline {
  /**
   * Process a new article through the pipeline
   * @param {Object} article - Article object with url, title, description, etc.
   * @param {Array} userHoldings - User's holdings for personalization
   * @param {string} userProfile - User profile type: "focus", "balanced", "broad"
   */
  async processArticle(article, userHoldings = [], userProfile = "balanced") {
    const db = getDatabase();

    // Ensure article exists in database first
    const existing = db.prepare("SELECT url, status FROM articles WHERE url = ?").get(article.url);
    
    if (!existing) {
      // Article doesn't exist, save it first
      await this.saveArticleToDatabase(article);
    }

    // Stage 1: Title-only triage
    console.log(`[Pipeline] Stage 1: Title triage for ${article.url}`);
    const stage1Result = await processTitleTriage(article);
    
    // Skip if already processed
    if (stage1Result.skipped) {
      console.log(`[Pipeline] Stage 1 already completed for ${article.url}, continuing...`);
    }
    
    if (stage1Result.status === "discarded") {
      console.log(`[Pipeline] Article discarded at Stage 1: ${article.url}`);
      return { status: "discarded", stage: 1 };
    }

    if (!stage1Result.should_fetch_full) {
      console.log(`[Pipeline] Article marked as low priority: ${article.url}`);
      return { status: "low_priority", stage: 1 };
    }

    // Stage 2: Content fetching
    console.log(`[Pipeline] Stage 2: Content fetch for ${article.url}`);
    const stage2Result = await processContentFetch(article);
    
    if (stage2Result.status === "discarded" || stage2Result.status === "max_attempts_reached") {
      console.log(`[Pipeline] Article discarded at Stage 2: ${article.url}`);
      return { status: "discarded", stage: 2 };
    }

    if (stage2Result.status === "content_too_short") {
      console.log(`[Pipeline] Article content too short: ${article.url}`);
      return { status: "discarded", stage: 2 };
    }

    if (stage2Result.status !== "content_fetched") {
      console.log(`[Pipeline] Content fetch failed for ${article.url}, will retry later`);
      return { status: "fetch_pending", stage: 2 };
    }

    // Stage 3: Content classification
    console.log(`[Pipeline] Stage 3: Content classification for ${article.url}`);
    const stage3Result = await processContentClassification(article, userHoldings);
    
    // Skip if already processed
    if (stage3Result.skipped) {
      console.log(`[Pipeline] Stage 3 already completed for ${article.url}, continuing...`);
    }
    
    if (stage3Result.status === "discarded") {
      console.log(`[Pipeline] Article discarded at Stage 3 (low impact): ${article.url}`);
      return { status: "discarded", stage: 3 };
    }

    if (stage3Result.status !== "llm_processed" && !stage3Result.skipped) {
      console.log(`[Pipeline] Classification failed for ${article.url}`);
      return { status: "error", stage: 3 };
    }

    // Stage 4: Personalization
    console.log(`[Pipeline] Stage 4: Personalization for ${article.url}`);
    const stage4Result = await processPersonalization(article, userHoldings, userProfile);
    
    // Skip if already processed
    if (stage4Result.skipped) {
      console.log(`[Pipeline] Stage 4 already completed for ${article.url}`);
      return {
        status: "personalized",
        stage: 4,
        skipped: true,
        data: {
          profile_adjusted_score: stage4Result.profile_adjusted_score,
        },
      };
    }
    
    if (stage4Result.status === "discarded") {
      console.log(`[Pipeline] Article discarded at Stage 4 (low relevance): ${article.url}`);
      return { status: "discarded", stage: 4 };
    }

    if (stage4Result.status !== "personalized") {
      console.log(`[Pipeline] Personalization failed for ${article.url}`);
      return { status: "error", stage: 4 };
    }

    // Stage 5: Ranking & Clustering (batch process, not per article)
    // This is handled separately in processBatchRanking()

    console.log(`[Pipeline] Article processed successfully: ${article.url}`);
    return {
      status: "personalized",
      stage: 4,
      data: {
        impact_score: stage3Result.impact_score,
        profile_adjusted_score: stage4Result.profile_adjusted_score,
      },
    };
  }

  /**
   * Process multiple articles in batch using batch LLM calls for efficiency
   * Uses batch processing for Stage 1 and Stage 3 to reduce API calls and costs
   * IMPROVED: Column-based prerequisites ensure stages only run when ready
   */
  async processBatch(articles, userHoldings = [], userProfile = "balanced", options = {}) {
    console.log("\n[Pipeline Batch] ========== processBatch STARTED ==========");
    console.log("[Pipeline Batch] Input:", {
      articlesCount: articles.length,
      holdingsCount: userHoldings.length,
      userProfile,
      options
    });
    
    const { llmBatchSize = 20, stage3BatchSize = 8, delayBetweenBatches = 1000 } = options;
    const db = getDatabase();
    const results = [];

    // ========== STAGE 1: Title Triage ==========
    // Prerequisites: Article exists in DB, status IS NULL or "pending", title_relevance IS NULL
    console.log(`\n[Pipeline Batch] ========== STAGE 1: Title Triage ==========`);
    console.log(`[Pipeline Batch] Checking ${articles.length} articles for Stage 1 prerequisites...`);
    
    const articlesForStage1 = [];
    let skippedStage1 = 0;
    let alreadyDiscarded = 0;
    
    for (const article of articles) {
      const existing = db.prepare(`
        SELECT status, title_relevance, should_fetch_full 
        FROM articles WHERE url = ?
      `).get(article.url);
      
      // Only process if: not discarded, and title_relevance not set
      if (existing && existing.status === "discarded") {
        alreadyDiscarded++;
        results.push({ status: "discarded", stage: 0, reason: "Already discarded" });
        continue;
      }
      
      if (existing && existing.title_relevance !== null && existing.title_relevance !== undefined) {
        // Already processed Stage 1, will be checked for Stage 2 later
        skippedStage1++;
        continue;
      } else {
        // Needs Stage 1 processing
        articlesForStage1.push(article);
      }
    }
    
    console.log(`[Pipeline Batch] Stage 1 Summary:`, {
      needsProcessing: articlesForStage1.length,
      alreadyProcessed: skippedStage1,
      alreadyDiscarded: alreadyDiscarded
    });

    // Process Stage 1 in batches
    if (articlesForStage1.length > 0) {
      console.log(`[Pipeline Batch] Processing ${articlesForStage1.length} articles through Stage 1 in batches of ${llmBatchSize}...`);
      for (let i = 0; i < articlesForStage1.length; i += llmBatchSize) {
        const batch = articlesForStage1.slice(i, i + llmBatchSize);
        console.log(`[Pipeline Batch] Stage 1 Batch ${Math.floor(i / llmBatchSize) + 1}: Processing ${batch.length} articles...`);
        const stage1Results = await processTitleTriageBatch(batch, userHoldings);
        console.log(`[Pipeline Batch] Stage 1 Batch ${Math.floor(i / llmBatchSize) + 1}: Completed, got ${stage1Results.length} results`);
        
        for (let j = 0; j < batch.length; j++) {
          const stage1Result = stage1Results[j];
          if (stage1Result.status === "discarded" || !stage1Result.should_fetch_full) {
            results.push({ status: "discarded", stage: 1 });
          }
        }
        
        if (i + llmBatchSize < articlesForStage1.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }
      console.log(`[Pipeline Batch] Stage 1 Complete: Processed ${articlesForStage1.length} articles`);
    } else {
      console.log(`[Pipeline Batch] Stage 1: No articles need processing, skipping`);
    }

    // ========== STAGE 2: Content Fetch ==========
    // Prerequisites: status = "title_filtered", should_fetch_full = 1, clean_text IS NULL
    console.log(`\n[Pipeline Batch] ========== STAGE 2: Content Fetch ==========`);
    console.log(`[Pipeline Batch] Checking ${articles.length} articles for Stage 2 prerequisites...`);
    
    const articlesForStage2 = [];
    let skippedStage2 = 0;
    const skipReasons = {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      shouldNotFetch: 0,
      alreadyHasContent: 0,
      maxAttempts: 0
    };
    
    for (const article of articles) {
      const existing = db.prepare(`
        SELECT status, should_fetch_full, clean_text, content_length, fetch_attempts
        FROM articles WHERE url = ?
      `).get(article.url);
      
      // Check prerequisites for Stage 2
      if (!existing) {
        skipReasons.notFound++;
        continue;
      }
      if (existing.status === "discarded") {
        skipReasons.discarded++;
        continue;
      }
      if (existing.status !== "title_filtered") {
        skipReasons.wrongStatus++;
        continue;
      }
      if (existing.should_fetch_full !== 1) {
        skipReasons.shouldNotFetch++;
        continue;
      }
      if (existing.clean_text && existing.clean_text.length > 0 && existing.content_length >= 400) {
        // Already has content, skip to Stage 3
        skipReasons.alreadyHasContent++;
        continue;
      }
      if (existing.fetch_attempts >= 2) {
        // Max attempts reached, skip
        skipReasons.maxAttempts++;
        continue;
      }
      
      articlesForStage2.push(article);
    }
    
    console.log(`[Pipeline Batch] Stage 2 Summary:`, {
      needsProcessing: articlesForStage2.length,
      skipped: skippedStage2,
      skipReasons
    });

    if (articlesForStage2.length > 0) {
      console.log(`[Pipeline Batch] Processing ${articlesForStage2.length} articles through Stage 2...`);
      const stage2Results = await processContentFetchBatch(articlesForStage2, 8);
      console.log(`[Pipeline Batch] Stage 2: Got ${stage2Results.length} results`);
      
      let stage2Success = 0;
      let stage2Failed = 0;
      for (let i = 0; i < articlesForStage2.length; i++) {
        const stage2Result = stage2Results[i];
        if (stage2Result && stage2Result.status === "content_fetched") {
          stage2Success++;
        } else {
          stage2Failed++;
          results.push({ status: stage2Result?.status || "error", stage: 2 });
        }
      }
      console.log(`[Pipeline Batch] Stage 2 Complete: ${stage2Success} succeeded, ${stage2Failed} failed`);
    } else {
      console.log(`[Pipeline Batch] Stage 2: No articles need processing, skipping`);
    }

    // ========== STAGE 3: Content Classification ==========
    // Prerequisites: status = "content_fetched", clean_text IS NOT NULL, content_length >= 400, impact_score IS NULL
    console.log(`\n[Pipeline Batch] ========== STAGE 3: Content Classification ==========`);
    console.log(`[Pipeline Batch] Checking ${articles.length} articles for Stage 3 prerequisites...`);
    
    const articlesForStage3 = [];
    const stage3SkipReasons = {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      noContent: 0,
      contentTooShort: 0,
      alreadyProcessed: 0
    };
    
    for (const article of articles) {
      const existing = db.prepare(`
        SELECT status, clean_text, content_length, impact_score, matched_holdings
        FROM articles WHERE url = ?
      `).get(article.url);
      
      // Check prerequisites for Stage 3
      if (!existing) {
        stage3SkipReasons.notFound++;
        continue;
      }
      if (existing.status === "discarded") {
        stage3SkipReasons.discarded++;
        continue;
      }
      if (existing.status !== "content_fetched") {
        stage3SkipReasons.wrongStatus++;
        continue;
      }
      if (!existing.clean_text || existing.clean_text.length === 0) {
        stage3SkipReasons.noContent++;
        continue;
      }
      if (!existing.content_length || existing.content_length < 400) {
        stage3SkipReasons.contentTooShort++;
        continue;
      }
      if (existing.impact_score !== null && existing.impact_score !== undefined) {
        // Already processed, skip to Stage 4
        stage3SkipReasons.alreadyProcessed++;
        continue;
      }
      
      articlesForStage3.push(article);
    }
    
    console.log(`[Pipeline Batch] Stage 3 Summary:`, {
      needsProcessing: articlesForStage3.length,
      skipReasons: stage3SkipReasons
    });

    if (articlesForStage3.length > 0) {
      console.log(`[Pipeline Batch] Processing ${articlesForStage3.length} articles through Stage 3 in batches of ${stage3BatchSize}...`);
      for (let i = 0; i < articlesForStage3.length; i += stage3BatchSize) {
        const batch = articlesForStage3.slice(i, i + stage3BatchSize);
        console.log(`[Pipeline Batch] Stage 3 Batch ${Math.floor(i / stage3BatchSize) + 1}: Processing ${batch.length} articles...`);
        const stage3Results = await processContentClassificationBatch(batch, userHoldings);
        console.log(`[Pipeline Batch] Stage 3 Batch ${Math.floor(i / stage3BatchSize) + 1}: Completed, got ${stage3Results.length} results`);
        
        let batchDiscarded = 0;
        for (let j = 0; j < batch.length; j++) {
          const stage3Result = stage3Results[j];
          if (stage3Result.status === "discarded") {
            batchDiscarded++;
            results.push({ status: "discarded", stage: 3 });
          }
        }
        console.log(`[Pipeline Batch] Stage 3 Batch ${Math.floor(i / stage3BatchSize) + 1}: ${batchDiscarded} discarded`);
        
        if (i + stage3BatchSize < articlesForStage3.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }
      console.log(`[Pipeline Batch] Stage 3 Complete: Processed ${articlesForStage3.length} articles`);
    } else {
      console.log(`[Pipeline Batch] Stage 3: No articles need processing, skipping`);
    }

    // ========== STAGE 4: Personalization ==========
    // Prerequisites: status = "llm_processed", impact_score IS NOT NULL, matched_holdings IS NOT NULL
    // Process for ALL user holdings
    console.log(`\n[Pipeline Batch] ========== STAGE 4: Personalization ==========`);
    console.log(`[Pipeline Batch] Checking ${articles.length} articles for Stage 4 prerequisites...`);
    console.log(`[Pipeline Batch] User holdings count: ${userHoldings.length}, Profile: ${userProfile}`);
    
    const articlesForStage4 = [];
    const stage4SkipReasons = {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      noImpactScore: 0,
      lowImpact: 0,
      noMatchedHoldings: 0,
      emptyMatchedHoldings: 0,
      invalidJSON: 0,
      alreadyCached: 0
    };
    
    for (const article of articles) {
      const existing = db.prepare(`
        SELECT status, impact_score, matched_holdings, profile_adjusted_score, profile_type_cached
        FROM articles WHERE url = ?
      `).get(article.url);
      
      // Check prerequisites for Stage 4
      if (!existing) {
        stage4SkipReasons.notFound++;
        continue;
      }
      if (existing.status === "discarded") {
        stage4SkipReasons.discarded++;
        continue;
      }
      if (existing.status !== "llm_processed") {
        stage4SkipReasons.wrongStatus++;
        continue;
      }
      if (existing.impact_score === null || existing.impact_score === undefined) {
        stage4SkipReasons.noImpactScore++;
        continue;
      }
      if (existing.impact_score < 40) {
        stage4SkipReasons.lowImpact++;
        continue; // Guardrail: skip low impact
      }
      if (!existing.matched_holdings) {
        stage4SkipReasons.noMatchedHoldings++;
        continue; // Guardrail: skip if no matched holdings
      }
      
      // Parse matched_holdings to check if it's empty
      let matchedHoldings = [];
      try {
        matchedHoldings = existing.matched_holdings ? JSON.parse(existing.matched_holdings) : [];
      } catch (e) {
        stage4SkipReasons.invalidJSON++;
        continue; // Invalid JSON, skip
      }
      
      if (matchedHoldings.length === 0) {
        stage4SkipReasons.emptyMatchedHoldings++;
        continue; // Guardrail: skip if empty
      }
      
      // Check cache: if already personalized for this profile, skip
      if (existing.profile_type_cached === userProfile && existing.profile_adjusted_score !== null) {
        stage4SkipReasons.alreadyCached++;
        results.push({ status: "personalized", stage: 4, skipped: true, cached: true });
        continue;
      }
      
      articlesForStage4.push(article);
    }
    
    console.log(`[Pipeline Batch] Stage 4 Summary:`, {
      needsProcessing: articlesForStage4.length,
      skipReasons: stage4SkipReasons
    });

    // Process Stage 4 for all articles (individual processing)
    if (articlesForStage4.length > 0) {
      console.log(`[Pipeline Batch] Processing ${articlesForStage4.length} articles through Stage 4...`);
      let stage4Success = 0;
      let stage4Discarded = 0;
      let stage4Errors = 0;
      
      for (let i = 0; i < articlesForStage4.length; i++) {
        const article = articlesForStage4[i];
        try {
          console.log(`[Pipeline Batch] Stage 4 [${i + 1}/${articlesForStage4.length}]: Processing ${article.url.substring(0, 50)}...`);
          const stage4Result = await processPersonalization(article, userHoldings, userProfile);
          if (stage4Result.status === "personalized") {
            stage4Success++;
            results.push({ status: "personalized", stage: 4 });
          } else if (stage4Result.status === "discarded") {
            stage4Discarded++;
            results.push({ status: "discarded", stage: 4 });
          } else {
            results.push({ status: stage4Result.status || "error", stage: 4 });
          }
        } catch (error) {
          stage4Errors++;
          console.error(`[Pipeline Batch] Error in Stage 4 for ${article.url}:`, error.message);
          results.push({ status: "error", stage: 4, error: error.message });
        }
      }
      console.log(`[Pipeline Batch] Stage 4 Complete: ${stage4Success} personalized, ${stage4Discarded} discarded, ${stage4Errors} errors`);
    } else {
      console.log(`[Pipeline Batch] Stage 4: No articles need processing, skipping`);
    }

    console.log(`\n[Pipeline Batch] ========== processBatch COMPLETE ==========`);
    console.log(`[Pipeline Batch] Final results:`, {
      total: results.length,
      personalized: results.filter(r => r.status === "personalized").length,
      discarded: results.filter(r => r.status === "discarded").length,
      errors: results.filter(r => r.status === "error").length
    });
    
    return results;
  }

  /**
   * Process articles incrementally: process top N first, return immediately, continue rest in background
   * This provides faster perceived performance by showing results quickly
   * @param {Array} articles - Array of article objects
   * @param {Array} userHoldings - User's holdings
   * @param {string} userProfile - User profile type
   * @param {Object} options - Options including topN (default: 30)
   * @returns {Promise<Object>} Object with immediateResults and backgroundPromise
   */
  async processBatchIncremental(articles, userHoldings = [], userProfile = "balanced", options = {}) {
    const { topN = 30, llmBatchSize = 20, stage3BatchSize = 8 } = options;
    
    if (!articles || articles.length === 0) {
      return {
        immediateResults: [],
        backgroundPromise: Promise.resolve([]),
        total: 0,
        processed: 0,
        remaining: 0,
      };
    }
    
    // Sort articles by priority: newest first, then by title_relevance if available
    const db = getDatabase();
    const sortedArticles = articles.sort((a, b) => {
      // First, try to get title_relevance from database
      const aRow = db.prepare("SELECT title_relevance, published_at FROM articles WHERE url = ?").get(a.url);
      const bRow = db.prepare("SELECT title_relevance, published_at FROM articles WHERE url = ?").get(b.url);
      
      // Higher title_relevance first
      if (aRow?.title_relevance && bRow?.title_relevance) {
        if (aRow.title_relevance !== bRow.title_relevance) {
          return bRow.title_relevance - aRow.title_relevance;
        }
      }
      
      // Then by published_at (newest first)
      const aDate = aRow?.published_at || a.publishedAt || "";
      const bDate = bRow?.published_at || b.publishedAt || "";
      return bDate.localeCompare(aDate);
    });
    
    const topArticles = sortedArticles.slice(0, topN);
    const remainingArticles = sortedArticles.slice(topN);
    
    console.log(`[Pipeline Incremental] Processing ${topArticles.length} top articles immediately, ${remainingArticles.length} will be processed in background`);
    
    // Process top N articles synchronously (this will block until complete)
    const immediateResults = await this.processBatch(topArticles, userHoldings, userProfile, {
      llmBatchSize,
      stage3BatchSize,
      delayBetweenBatches: 1000,
    });
    
    // Process remaining articles in background (fire and forget, but return promise for tracking)
    const backgroundPromise = remainingArticles.length > 0
      ? this.processBatch(remainingArticles, userHoldings, userProfile, {
          llmBatchSize,
          stage3BatchSize,
          delayBetweenBatches: 1000,
        }).then(results => {
          console.log(`[Pipeline Incremental] Background processing complete: ${results.length} articles processed`);
          return results;
        }).catch(error => {
          console.error(`[Pipeline Incremental] Background processing error:`, error.message);
          return [];
        })
      : Promise.resolve([]);
    
    return {
      immediateResults,
      backgroundPromise,
      total: articles.length,
      processed: topArticles.length,
      remaining: remainingArticles.length,
    };
  }

  /**
   * Run Stage 5 ranking and clustering on all personalized articles
   */
  async processBatchRanking(cutoffScore = 50) {
    console.log("[Pipeline] Stage 5: Batch ranking & clustering");
    return await processRankingClustering([], cutoffScore);
  }

  /**
   * Save article to database (initial save before processing)
   */
  async saveArticleToDatabase(article) {
    const db = getDatabase();

    db.prepare(`
      INSERT INTO articles (
        url, source_id, source_name, author, title, description,
        url_to_image, published_at, content, searched_by, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
      ON CONFLICT(url) DO NOTHING
    `).run(
      article.url,
      article.source?.id || null,
      article.source?.name || "Unknown",
      article.author || null,
      article.title || "",
      article.description || null,
      article.urlToImage || null,
      article.publishedAt || new Date().toISOString(),
      article.content || null,
      article.searchedBy || null
    );
  }

  /**
   * Get articles that need processing (retry failed stages)
   */
  getPendingArticles() {
    const db = getDatabase();
    
    // Articles that failed fetching but haven't reached max attempts
    const pendingFetch = db.prepare(`
      SELECT url, title, description, source_name, published_at
      FROM articles
      WHERE status = 'title_filtered'
        AND should_fetch_full = 1
        AND fetch_attempts < 3
        AND (raw_html IS NULL OR raw_html = '')
      LIMIT 50
    `).all();

    return {
      pendingFetch: pendingFetch.map(row => ({
        url: row.url,
        title: row.title,
        description: row.description,
        source: { name: row.source_name },
        publishedAt: row.published_at,
      })),
    };
  }

  /**
   * Process pending articles (retry failed stages)
   */
  async processPendingArticles(userHoldings = [], userProfile = "balanced") {
    const pending = this.getPendingArticles();
    const results = [];

    // Process pending fetches
    if (pending.pendingFetch.length > 0) {
      console.log(`[Pipeline] Processing ${pending.pendingFetch.length} pending content fetches`);
      const fetchResults = await this.processBatch(pending.pendingFetch, userHoldings, userProfile);
      results.push(...fetchResults);
    }

    return results;
  }
}

module.exports = new ArticlePipeline();

