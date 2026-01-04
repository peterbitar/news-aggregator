const { processTitleTriageBatch } = require("./stage1_titleTriage");
const { decideImpactLite } = require("../decisions/decideImpactLite");
const { processContentFetchBatch } = require("./stage2_contentFetch");
const { processContentClassificationBatch } = require("./stage3_contentClassification");
const { processPersonalization } = require("./stage4_personalization");
const { getDatabase } = require("../data/db");
const ThresholdConfig = require("./ThresholdConfig");

/**
 * Stage 1: Title Triage
 * Prerequisites: Article exists in DB, status IS NULL or "pending", title_relevance IS NULL
 */
function createStage1Config(llmBatchSize) {
  return {
    stageName: "Title Triage",
    stageNumber: 1,
    batchSize: llmBatchSize || scoring.STAGE1_BATCH_SIZE,
    customSkipReasons: {
      alreadyProcessed: 0,
      alreadyDiscarded: 0
    },
    checkPrerequisites: (existing, article, context) => {
      if (existing && existing.status === "discarded") {
        return {
          eligible: false,
          reason: "alreadyDiscarded",
          result: { status: "discarded", stage: 0, reason: "Already discarded" }
        };
      }

      if (existing && existing.title_relevance !== null && existing.title_relevance !== undefined) {
        return {
          eligible: false,
          reason: "alreadyProcessed"
        };
      }

      return { eligible: true };
    },
    processBatch: async (batch, context) => {
      const stage1Results = await processTitleTriageBatch(batch, context.userHoldings);
      const results = [];

      for (let j = 0; j < batch.length; j++) {
        const stage1Result = stage1Results[j];
        if (stage1Result.status === "discarded" || !stage1Result.should_fetch_full) {
          results.push({ status: "discarded", stage: 1 });
        }
      }

      return results;
    }
  };
}

/**
 * Stage 1.5: Lightweight Impact Guess
 * Prerequisites: status = "title_filtered", likely_impact IS NULL
 */
function createStage1_5Config() {
  return {
    stageName: "Lightweight Impact Guess",
    stageNumber: 1.5,
    batchSize: 1,
    delayBetweenBatches: 0,
    customSkipReasons: {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      alreadyGuessed: 0
    },
    checkPrerequisites: (existing, article, context) => {
      const db = getDatabase();

      if (!existing) {
        return { eligible: false, reason: "notFound" };
      }

      if (existing.status === "discarded") {
        return { eligible: false, reason: "discarded" };
      }

      if (existing.status !== "title_filtered") {
        return { eligible: false, reason: "wrongStatus" };
      }

      // Check if already guessed
      if (existing.likely_impact !== null && existing.likely_impact !== undefined) {
        const thresholdInfo = ThresholdConfig.getThresholdInfo(existing.searched_by);

        if (existing.likely_impact >= thresholdInfo.threshold) {
          // Will proceed to Stage 2
          return { eligible: false, reason: "alreadyGuessed" };
        } else {
          // Below threshold, mark as low_priority
          const articleRow = db.prepare(`
            SELECT title_relevance, title_event_type, should_fetch_full
            FROM articles WHERE url = ?
          `).get(article.url);

          console.log(`[Stage1.5] LOW_PRIORITY id=${article.url.substring(0, 50)} title_relevance=${articleRow?.title_relevance || 'N/A'} title_event_type=${articleRow?.title_event_type || 'N/A'} should_fetch_full=${articleRow?.should_fetch_full || 'N/A'} likely_impact=${existing.likely_impact} threshold=${thresholdInfo.threshold} bucket=${thresholdInfo.bucket} reason="likely_impact below threshold"`);

          db.prepare(`UPDATE articles SET status = 'low_priority' WHERE url = ?`).run(article.url);

          return {
            eligible: false,
            reason: "alreadyGuessed",
            result: { status: "low_priority", stage: 1.5, likely_impact: existing.likely_impact }
          };
        }
      }

      return { eligible: true };
    },
    processBatch: async (batch, context) => {
      const db = getDatabase();
      const results = [];

      for (const article of batch) {
        const impactGuess = decideImpactLite(article);

        if (!impactGuess.should_fetch) {
          const articleRow = db.prepare(`
            SELECT title_relevance, title_event_type, should_fetch_full
            FROM articles WHERE url = ?
          `).get(article.url);

          console.log(`[Stage1.5] LOW_PRIORITY id=${article.url.substring(0, 50)} title_relevance=${articleRow?.title_relevance || 'N/A'} title_event_type=${articleRow?.title_event_type || 'N/A'} should_fetch_full=${articleRow?.should_fetch_full || 'N/A'} likely_impact=${impactGuess.likely_impact} threshold=${impactGuess.threshold} bucket=${impactGuess.bucket || 'N/A'} reason="likely_impact below threshold"`);

          db.prepare(`UPDATE articles SET status = 'low_priority' WHERE url = ?`).run(article.url);

          results.push({ status: "low_priority", stage: 1.5, likely_impact: impactGuess.likely_impact });
        }
      }

      return results;
    }
  };
}

/**
 * Stage 2: Content Fetch
 * Prerequisites: status = "title_filtered", should_fetch_full = 1, likely_impact >= threshold, clean_text IS NULL
 */
function createStage2Config() {
  return {
    stageName: "Content Fetch",
    stageNumber: 2,
    batchSize: 8,
    customSkipReasons: {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      shouldNotFetch: 0,
      alreadyHasContent: 0,
      maxAttempts: 0,
      belowThreshold: 0
    },
    checkPrerequisites: (existing, article, context) => {
      if (!existing) {
        return { eligible: false, reason: "notFound" };
      }

      if (existing.status === "discarded" || existing.status === "low_priority") {
        return { eligible: false, reason: "discarded" };
      }

      if (existing.status !== "title_filtered") {
        return { eligible: false, reason: "wrongStatus" };
      }

      if (existing.should_fetch_full !== 1) {
        return { eligible: false, reason: "shouldNotFetch" };
      }

      // Check likely_impact threshold
      if (existing.likely_impact === null || existing.likely_impact === undefined) {
        return { eligible: false, reason: "belowThreshold" };
      }

      const thresholdInfo = ThresholdConfig.getThresholdInfo(existing.searched_by);
      if (existing.likely_impact < thresholdInfo.threshold) {
        return { eligible: false, reason: "belowThreshold" };
      }

      if (existing.clean_text && existing.clean_text.length > 0 && existing.content_length >= ThresholdConfig.CONTENT.MIN_LENGTH) {
        return { eligible: false, reason: "alreadyHasContent" };
      }

      if (existing.fetch_attempts >= ThresholdConfig.CONTENT.MAX_FETCH_ATTEMPTS) {
        return { eligible: false, reason: "maxAttempts" };
      }

      return { eligible: true };
    },
    processBatch: async (batch, context) => {
      const stage2Results = await processContentFetchBatch(batch, 8);
      const results = [];

      for (let i = 0; i < batch.length; i++) {
        const stage2Result = stage2Results[i];
        if (stage2Result && stage2Result.status === "content_fetched") {
          // Success, no result to add
        } else {
          results.push({ status: stage2Result?.status || "error", stage: 2 });
        }
      }

      return results;
    }
  };
}

/**
 * Stage 3: Content Classification
 * Prerequisites: status = "content_fetched", clean_text IS NOT NULL, content_length >= 400, impact_score IS NULL
 */
function createStage3Config(stage3BatchSize) {
  return {
    stageName: "Content Classification",
    stageNumber: 3,
    batchSize: stage3BatchSize || scoring.STAGE3_BATCH_SIZE,
    customSkipReasons: {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      noContent: 0,
      contentTooShort: 0,
      alreadyProcessed: 0
    },
    checkPrerequisites: (existing, article, context) => {
      if (!existing) {
        return { eligible: false, reason: "notFound" };
      }

      if (existing.status === "discarded") {
        return { eligible: false, reason: "discarded" };
      }

      if (existing.status !== "content_fetched") {
        return { eligible: false, reason: "wrongStatus" };
      }

      if (!existing.clean_text || existing.clean_text.length === 0) {
        return { eligible: false, reason: "noContent" };
      }

      if (!existing.content_length || existing.content_length < ThresholdConfig.CONTENT.MIN_LENGTH) {
        return { eligible: false, reason: "contentTooShort" };
      }

      if (existing.impact_score !== null && existing.impact_score !== undefined) {
        return { eligible: false, reason: "alreadyProcessed" };
      }

      return { eligible: true };
    },
    processBatch: async (batch, context) => {
      const stage3Results = await processContentClassificationBatch(batch, context.userHoldings);
      const results = [];

      for (let j = 0; j < batch.length; j++) {
        const stage3Result = stage3Results[j];
        if (stage3Result.status === "discarded") {
          results.push({ status: "discarded", stage: 3 });
        }
      }

      return results;
    }
  };
}

/**
 * Stage 4: Personalization
 * Prerequisites: status = "llm_processed", impact_score IS NOT NULL
 */
function createStage4Config() {
  return {
    stageName: "Personalization",
    stageNumber: 4,
    batchSize: 1,
    delayBetweenBatches: 0,
    customSkipReasons: {
      notFound: 0,
      discarded: 0,
      wrongStatus: 0,
      noImpactScore: 0,
      lowImpact: 0,
      invalidJSON: 0,
      alreadyCached: 0
    },
    checkPrerequisites: (existing, article, context) => {
      if (!existing) {
        return { eligible: false, reason: "notFound" };
      }

      if (existing.status === "discarded") {
        return { eligible: false, reason: "discarded" };
      }

      if (existing.status !== "llm_processed") {
        return { eligible: false, reason: "wrongStatus" };
      }

      if (existing.impact_score === null || existing.impact_score === undefined) {
        return { eligible: false, reason: "noImpactScore" };
      }

      if (existing.impact_score < ThresholdConfig.STAGE4_MIN_IMPACT) {
        return { eligible: false, reason: "lowImpact" };
      }

      // Parse matched_holdings (not required - articles without holdings can still be personalized)
      try {
        const matchedHoldings = existing.matched_holdings ? JSON.parse(existing.matched_holdings) : [];
      } catch (e) {
        return { eligible: false, reason: "invalidJSON" };
      }

      // Check cache: if already personalized for this profile, skip
      if (existing.profile_type_cached === context.userProfile && existing.profile_adjusted_score !== null) {
        return {
          eligible: false,
          reason: "alreadyCached",
          result: { status: "personalized", stage: 4, skipped: true, cached: true }
        };
      }

      return { eligible: true };
    },
    processBatch: async (batch, context) => {
      const results = [];

      for (const article of batch) {
        try {
          const stage4Result = await processPersonalization(article, context.userHoldings, context.userProfile);

          if (stage4Result.status === "personalized") {
            results.push({ status: "personalized", stage: 4 });
          } else if (stage4Result.status === "discarded") {
            results.push({ status: "discarded", stage: 4 });
          } else {
            results.push({ status: stage4Result.status || "error", stage: 4 });
          }
        } catch (error) {
          console.error(`[Stage 4] Error processing ${article.url}:`, error.message);
          results.push({ status: "error", stage: 4, error: error.message });
        }
      }

      return results;
    }
  };
}

module.exports = {
  createStage1Config,
  createStage1_5Config,
  createStage2Config,
  createStage3Config,
  createStage4Config
};
