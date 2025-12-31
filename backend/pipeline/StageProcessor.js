const { getDatabase } = require("../data/db");

/**
 * Tracks skip reasons for stage processing
 */
class SkipReasonTracker {
  constructor(customReasons = {}) {
    this.reasons = {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      ...customReasons
    };
  }

  increment(reason) {
    if (this.reasons.hasOwnProperty(reason)) {
      this.reasons[reason]++;
    } else {
      this.reasons[reason] = 1;
    }
  }

  getSummary() {
    return { ...this.reasons };
  }
}

/**
 * Handles common stage processing pattern
 * Eliminates duplication across pipeline stages
 */
class StageProcessor {
  constructor(config) {
    this.stageName = config.stageName;
    this.stageNumber = config.stageNumber;
    this.checkPrerequisites = config.checkPrerequisites;
    this.processBatch = config.processBatch;
    this.batchSize = config.batchSize || 1;
    this.delayBetweenBatches = config.delayBetweenBatches || 1000;
    this.customSkipReasons = config.customSkipReasons || {};
  }

  /**
   * Process articles through this stage
   * @param {Array} articles - Articles to process
   * @param {Object} context - Processing context (userHoldings, userProfile, etc.)
   * @returns {Promise<Object>} Processing results with eligible articles and skip summary
   */
  async process(articles, context = {}) {
    console.log(`\n[Pipeline Batch] ========== STAGE ${this.stageNumber}: ${this.stageName} ==========`);
    console.log(`[Pipeline Batch] Checking ${articles.length} articles for Stage ${this.stageNumber} prerequisites...`);

    const db = getDatabase();
    const eligibleArticles = [];
    const skipTracker = new SkipReasonTracker(this.customSkipReasons);
    const results = [];

    // Filter articles based on prerequisites
    for (const article of articles) {
      const existing = db.prepare(`
        SELECT * FROM articles WHERE url = ?
      `).get(article.url);

      const prerequisiteCheck = this.checkPrerequisites(existing, article, context);

      if (!prerequisiteCheck.eligible) {
        skipTracker.increment(prerequisiteCheck.reason);
        if (prerequisiteCheck.result) {
          results.push(prerequisiteCheck.result);
        }
        continue;
      }

      eligibleArticles.push(article);
    }

    console.log(`[Pipeline Batch] Stage ${this.stageNumber} Summary:`, {
      needsProcessing: eligibleArticles.length,
      skipReasons: skipTracker.getSummary()
    });

    // Process eligible articles
    if (eligibleArticles.length > 0) {
      console.log(`[Pipeline Batch] Processing ${eligibleArticles.length} articles through Stage ${this.stageNumber}${this.batchSize > 1 ? ` in batches of ${this.batchSize}` : ''}...`);

      const processResults = await this._processBatches(eligibleArticles, context);
      results.push(...processResults);

      console.log(`[Pipeline Batch] Stage ${this.stageNumber} Complete: Processed ${eligibleArticles.length} articles`);
    } else {
      console.log(`[Pipeline Batch] Stage ${this.stageNumber}: No articles need processing, skipping`);
    }

    return {
      results,
      processed: eligibleArticles.length,
      skipped: skipTracker.getSummary()
    };
  }

  /**
   * Process articles in batches
   */
  async _processBatches(articles, context) {
    const results = [];

    if (this.batchSize === 1) {
      // Individual processing (e.g., Stage 4)
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        try {
          console.log(`[Pipeline Batch] Stage ${this.stageNumber} [${i + 1}/${articles.length}]: Processing ${article.url.substring(0, 50)}...`);
          const result = await this.processBatch([article], context);
          results.push(...result);
        } catch (error) {
          console.error(`[Pipeline Batch] Error in Stage ${this.stageNumber} for ${article.url}:`, error.message);
          results.push({ status: "error", stage: this.stageNumber, error: error.message });
        }
      }
    } else {
      // Batch processing (e.g., Stage 1, 3)
      for (let i = 0; i < articles.length; i += this.batchSize) {
        const batch = articles.slice(i, i + this.batchSize);
        const batchNum = Math.floor(i / this.batchSize) + 1;

        console.log(`[Pipeline Batch] Stage ${this.stageNumber} Batch ${batchNum}: Processing ${batch.length} articles...`);
        const batchResults = await this.processBatch(batch, context);
        console.log(`[Pipeline Batch] Stage ${this.stageNumber} Batch ${batchNum}: Completed, got ${batchResults.length} results`);

        results.push(...batchResults);

        // Delay between batches if more to process
        if (i + this.batchSize < articles.length) {
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
        }
      }
    }

    return results;
  }
}

module.exports = { StageProcessor, SkipReasonTracker };
