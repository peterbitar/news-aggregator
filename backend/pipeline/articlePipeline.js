const { getDatabase } = require("../data/db");
const { processTitleTriage } = require("./stage1_titleTriage");
const { decideImpactLite, PROCESS_GATE_THRESHOLD } = require("../decisions/decideImpactLite");
const { processContentFetch } = require("./stage2_contentFetch");
const { processContentClassification } = require("./stage3_contentClassification");
const { processPersonalization } = require("./stage4_personalization");
const { processRankingClustering } = require("./stage5_rankingClustering");
const { StageProcessor } = require("./StageProcessor");
const ThresholdConfig = require("./ThresholdConfig");
const { normalizeUrl } = require("../utils/urlNormalizer");
const { hammingDistance } = require("../utils/contentFingerprint");
const scoring = require("../config/scoring");
const {
  createStage1Config,
  createStage1_5Config,
  createStage2Config,
  createStage3Config,
  createStage4Config
} = require("./stageConfigs");

// Threshold constants (exported for backwards compatibility)
const PROCESS_GATE_THRESHOLD_VALUE = PROCESS_GATE_THRESHOLD;
const FEED_RANK_THRESHOLD = ThresholdConfig.FEED_RANK_THRESHOLD;

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

    // Continue to Stage 1.5 even if should_fetch_full is false
    // should_fetch_full is not a discard condition, only title_relevance === 0 discards

    // Stage 1.5: Lightweight impact guess (cost control gate)
    console.log(`[Pipeline] Stage 1.5: Lightweight impact guess for ${article.url}`);
    const impactGuess = decideImpactLite(article);

    if (!impactGuess.should_fetch) {
      // Get article data for logging
      const db = getDatabase();
      const articleRow = db.prepare(`
        SELECT title_relevance, title_event_type, should_fetch_full, searched_by
        FROM articles WHERE url = ?
      `).get(article.url);

      const thresholdInfo = ThresholdConfig.getThresholdInfo(articleRow?.searched_by);

      // Log with all relevant fields
      console.log(`[Stage1.5] LOW_PRIORITY id=${article.url.substring(0, 50)} title_relevance=${articleRow?.title_relevance || 'N/A'} title_event_type=${articleRow?.title_event_type || 'N/A'} should_fetch_full=${articleRow?.should_fetch_full || 'N/A'} likely_impact=${impactGuess.likely_impact} threshold=${thresholdInfo.threshold} bucket=${thresholdInfo.bucket} reason="likely_impact below threshold"`);

      // Mark as low priority but don't discard - might still appear in feed if other signals are strong
      db.prepare(`
        UPDATE articles SET
          status = 'low_priority',
          updated_at = datetime('now')
        WHERE url = ?
      `).run(article.url);
      return { status: "low_priority", stage: 1.5, likely_impact: impactGuess.likely_impact };
    }

    // Note: Stage 1.5 gate overrides should_fetch_full from Stage 1.
    // The process gate (likely_impact >= threshold) is the final decision.

    // Stage 2: Content fetching (only if likely_impact passes gate)
    console.log(`[Pipeline] Stage 2: Content fetch for ${article.url} (likely_impact: ${impactGuess.likely_impact})`);
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

    // Deduplication step: Check for duplicates before expensive Stage 3
    console.log(`[Pipeline] Deduplication check for ${article.url}`);
    const dedupResult = await this.deduplicateArticle(article);
    if (dedupResult.isDuplicate) {
      console.log(`[Pipeline] Article is duplicate of ${dedupResult.originalId}, skipping Stage 3`);
      return { status: "duplicate", stage: "dedup", originalId: dedupResult.originalId };
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
   * REFACTORED: Uses StageProcessor pattern to eliminate code duplication
   */
  async processBatch(articles, userHoldings = [], userProfile = "balanced", options = {}) {
    console.log("\n[Pipeline Batch] ========== processBatch STARTED ==========");
    console.log("[Pipeline Batch] Input:", {
      articlesCount: articles.length,
      holdingsCount: userHoldings.length,
      userProfile,
      options
    });

    const { llmBatchSize = scoring.STAGE1_BATCH_SIZE, stage3BatchSize = scoring.STAGE3_BATCH_SIZE, delayBetweenBatches = 1000 } = options;
    const results = [];

    // Processing context shared across all stages
    const context = {
      userHoldings,
      userProfile,
      delayBetweenBatches
    };

    // Create stage processors
    const stage1 = new StageProcessor(createStage1Config(llmBatchSize));
    const stage1_5 = new StageProcessor(createStage1_5Config());
    const stage2 = new StageProcessor(createStage2Config());
    const stage3 = new StageProcessor(createStage3Config(stage3BatchSize));
    const stage4 = new StageProcessor(createStage4Config());

    // Process all stages sequentially
    const stage1Result = await stage1.process(articles, context);
    results.push(...stage1Result.results);

    const stage1_5Result = await stage1_5.process(articles, context);
    results.push(...stage1_5Result.results);

    const stage2Result = await stage2.process(articles, context);
    results.push(...stage2Result.results);

    const stage3Result = await stage3.process(articles, context);
    results.push(...stage3Result.results);

    const stage4Result = await stage4.process(articles, context);
    results.push(...stage4Result.results);

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
    const { topN = 30, llmBatchSize = scoring.STAGE1_BATCH_SIZE, stage3BatchSize = scoring.STAGE3_BATCH_SIZE } = options;
    
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
   * Deduplication step after Stage 2, before Stage 3
   * Uses candidate selection to avoid expensive full comparison
   */
  async deduplicateArticle(article) {
    const db = getDatabase();
    
    // Get article data from database
    const articleRow = db.prepare(`
      SELECT id, url, canonical_url, content_fingerprint, normalized_url, 
             normalized_domain, title_hash_bucket, published_at, title
      FROM articles WHERE url = ?
    `).get(article.url);
    
    if (!articleRow) {
      return { isDuplicate: false };
    }
    
    // Step 1: Normalize URLs
    const normalizedUrl = articleRow.normalized_url || normalizeUrl(articleRow.url);
    const canonicalUrl = articleRow.canonical_url || null;
    const contentFingerprint = articleRow.content_fingerprint || null;
    
    // Step 2: Candidate selection (DB-agnostic timestamp)
    // Check how published_at is stored in DB and use matching format
    const sampleArticle = db.prepare("SELECT published_at FROM articles WHERE published_at IS NOT NULL LIMIT 1").get();
    let cutoffTimestamp;
    
    if (sampleArticle && sampleArticle.published_at) {
      const sampleValue = String(sampleArticle.published_at);
      
      // Check if it's all digits (epoch) or ISO string
      if (/^\d+$/.test(sampleValue)) {
        // It's epoch - determine if seconds or milliseconds
        const isMilliseconds = sampleValue.length >= 13; // >= 13 digits = milliseconds
        
        if (isMilliseconds) {
          // DB stores epoch in milliseconds
          cutoffTimestamp = Date.now() - 48 * 60 * 60 * 1000;
        } else {
          // DB stores epoch in seconds
          cutoffTimestamp = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
        }
      } else {
        // It's ISO string format
        cutoffTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      }
    } else {
      // Default to ISO string (most common)
      cutoffTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    }
    
    const titleHash = articleRow.title_hash_bucket || generateTitleHashBucket(articleRow.title || '');
    
    // Guard against normalizedUrl being null
    let domain = null;
    try {
      if (normalizedUrl) {
        domain = new URL(normalizedUrl).hostname.replace(/^www\./, '');
      }
    } catch (error) {
      // normalizedUrl is invalid/null, skip domain candidate logic
      console.warn(`Invalid normalizedUrl for article ${articleRow.id}, skipping domain candidate check`);
    }
    
    // Dedup runs only for articles that reached content_fetched (after Stage 2).
    // Candidates that haven't passed Stage 2 won't have canonical_url or content_fingerprint anyway.

    // Build candidate query (DB-agnostic)
    // If domain is null, skip domain-based candidate check
    // Only compare against successfully fetched articles (content_fetched or later)
    // Exclude discarded and already-marked duplicates
    const candidates = db.prepare(`
      SELECT id, url, canonical_url, content_fingerprint, normalized_url, status
      FROM articles
      WHERE (
        -- Same canonical URL
        (? IS NOT NULL AND canonical_url = ?)
        OR
        -- Same domain + recent (within 48h) - only if domain is valid
        (? IS NOT NULL AND normalized_domain = ? AND published_at >= ?)
        OR
        -- Same title hash bucket
        (title_hash_bucket = ?)
      )
      AND id != ?
      AND status != 'duplicate'
      AND status != 'discarded'
      AND (status = 'content_fetched' OR status = 'llm_processed' OR status = 'personalized' OR status = 'ranked')
      LIMIT 50
    `).all(
      canonicalUrl, canonicalUrl,
      domain, domain, cutoffTimestamp,  // domain check only if domain is not null
      titleHash,
      articleRow.id
    );
    
    // Step 3: Check duplicates by priority
    for (const candidate of candidates) {
      // Priority 1: Normalized URL match
      if (normalizedUrl) {
        const candidateNormalized = candidate.normalized_url || normalizeUrl(candidate.url);
        if (normalizedUrl === candidateNormalized) {
          // Mark as duplicate
          db.prepare(`
            UPDATE articles SET
              is_duplicate_of_article_id = ?,
              status = 'duplicate',
              updated_at = datetime('now')
            WHERE url = ?
          `).run(candidate.id, article.url);
          return { isDuplicate: true, originalId: candidate.id, reason: 'normalized_url' };
        }
      }
      
      // Priority 2: Canonical URL match
      if (canonicalUrl && candidate.canonical_url && canonicalUrl === candidate.canonical_url) {
        // Mark as duplicate
        db.prepare(`
          UPDATE articles SET
            is_duplicate_of_article_id = ?,
            status = 'duplicate',
            updated_at = datetime('now')
          WHERE url = ?
        `).run(candidate.id, article.url);
        return { isDuplicate: true, originalId: candidate.id, reason: 'canonical_url' };
      }
      
      // Priority 3: Content fingerprint similarity
      // Only compare fingerprints if candidate has successfully fetched content
      if (contentFingerprint && candidate.content_fingerprint && 
          (candidate.status === 'content_fetched' || candidate.status === 'llm_processed' || 
           candidate.status === 'personalized' || candidate.status === 'ranked')) {
        const distance = hammingDistance(contentFingerprint, candidate.content_fingerprint);
        if (distance <= scoring.SIMHASH_DUP_THRESHOLD) {
          // Mark as duplicate
          db.prepare(`
            UPDATE articles SET
              is_duplicate_of_article_id = ?,
              status = 'duplicate',
              updated_at = datetime('now')
            WHERE url = ?
          `).run(candidate.id, article.url);
          return { isDuplicate: true, originalId: candidate.id, reason: 'content_fingerprint' };
        }
      }
    }
    
    return { isDuplicate: false };
  }

  /**
   * Generate title hash bucket (first 3 words) for candidate selection
   */
  generateTitleHashBucket(title) {
    if (!title) return '';
    const words = title.toLowerCase().split(/\s+/).slice(0, 3);
    return words.join('_');
  }

  /**
   * Deduplication step after Stage 2, before Stage 3
   * Uses candidate selection to avoid expensive full comparison
   */
  async deduplicateArticle(article) {
    const db = getDatabase();
    
    // Get article data from database
    const articleRow = db.prepare(`
      SELECT id, url, canonical_url, content_fingerprint, normalized_url, 
             normalized_domain, title_hash_bucket, published_at, title
      FROM articles WHERE url = ?
    `).get(article.url);
    
    if (!articleRow) {
      return { isDuplicate: false };
    }
    
    // Step 1: Normalize URLs
    const normalizedUrl = articleRow.normalized_url || normalizeUrl(articleRow.url);
    const canonicalUrl = articleRow.canonical_url || null;
    const contentFingerprint = articleRow.content_fingerprint || null;
    
    // Step 2: Candidate selection (DB-agnostic timestamp)
    // Check how published_at is stored in DB and use matching format
    const sampleArticle = db.prepare("SELECT published_at FROM articles WHERE published_at IS NOT NULL LIMIT 1").get();
    let cutoffTimestamp;
    
    if (sampleArticle && sampleArticle.published_at) {
      const sampleValue = String(sampleArticle.published_at);
      
      // Check if it's all digits (epoch) or ISO string
      if (/^\d+$/.test(sampleValue)) {
        // It's epoch - determine if seconds or milliseconds
        const isMilliseconds = sampleValue.length >= 13; // >= 13 digits = milliseconds
        
        if (isMilliseconds) {
          // DB stores epoch in milliseconds
          cutoffTimestamp = Date.now() - 48 * 60 * 60 * 1000;
        } else {
          // DB stores epoch in seconds
          cutoffTimestamp = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
        }
      } else {
        // It's ISO string format
        cutoffTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      }
    } else {
      // Default to ISO string (most common)
      cutoffTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    }
    
    const titleHash = articleRow.title_hash_bucket || this.generateTitleHashBucket(articleRow.title || '');
    
    // Guard against normalizedUrl being null
    let domain = null;
    try {
      if (normalizedUrl) {
        domain = new URL(normalizedUrl).hostname.replace(/^www\./, '');
      }
    } catch (error) {
      // normalizedUrl is invalid/null, skip domain candidate logic
      console.warn(`Invalid normalizedUrl for article ${articleRow.id}, skipping domain candidate check`);
    }
    
    // Dedup runs only for articles that reached content_fetched (after Stage 2).
    // Candidates that haven't passed Stage 2 won't have canonical_url or content_fingerprint anyway.

    // Build candidate query (DB-agnostic)
    // If domain is null, skip domain-based candidate check
    // Only compare against successfully fetched articles (content_fetched or later)
    // Exclude discarded and already-marked duplicates
    const candidates = db.prepare(`
      SELECT id, url, canonical_url, content_fingerprint, normalized_url, status
      FROM articles
      WHERE (
        -- Same canonical URL
        (? IS NOT NULL AND canonical_url = ?)
        OR
        -- Same domain + recent (within 48h) - only if domain is valid
        (? IS NOT NULL AND normalized_domain = ? AND published_at >= ?)
        OR
        -- Same title hash bucket
        (title_hash_bucket = ?)
      )
      AND id != ?
      AND status != 'duplicate'
      AND status != 'discarded'
      AND (status = 'content_fetched' OR status = 'llm_processed' OR status = 'personalized' OR status = 'ranked')
      LIMIT 50
    `).all(
      canonicalUrl, canonicalUrl,
      domain, domain, cutoffTimestamp,  // domain check only if domain is not null
      titleHash,
      articleRow.id
    );
    
    // Step 3: Check duplicates by priority
    for (const candidate of candidates) {
      // Priority 1: Normalized URL match
      if (normalizedUrl) {
        const candidateNormalized = candidate.normalized_url || normalizeUrl(candidate.url);
        if (normalizedUrl === candidateNormalized) {
          // Mark as duplicate
          db.prepare(`
            UPDATE articles SET
              is_duplicate_of_article_id = ?,
              status = 'duplicate',
              updated_at = datetime('now')
            WHERE url = ?
          `).run(candidate.id, article.url);
          return { isDuplicate: true, originalId: candidate.id, reason: 'normalized_url' };
        }
      }
      
      // Priority 2: Canonical URL match
      if (canonicalUrl && candidate.canonical_url && canonicalUrl === candidate.canonical_url) {
        // Mark as duplicate
        db.prepare(`
          UPDATE articles SET
            is_duplicate_of_article_id = ?,
            status = 'duplicate',
            updated_at = datetime('now')
          WHERE url = ?
        `).run(candidate.id, article.url);
        return { isDuplicate: true, originalId: candidate.id, reason: 'canonical_url' };
      }
      
      // Priority 3: Content fingerprint similarity
      // Only compare fingerprints if candidate has successfully fetched content
      if (contentFingerprint && candidate.content_fingerprint && 
          (candidate.status === 'content_fetched' || candidate.status === 'llm_processed' || 
           candidate.status === 'personalized' || candidate.status === 'ranked')) {
        const distance = hammingDistance(contentFingerprint, candidate.content_fingerprint);
        if (distance <= scoring.SIMHASH_DUP_THRESHOLD) {
          // Mark as duplicate
          db.prepare(`
            UPDATE articles SET
              is_duplicate_of_article_id = ?,
              status = 'duplicate',
              updated_at = datetime('now')
            WHERE url = ?
          `).run(candidate.id, article.url);
          return { isDuplicate: true, originalId: candidate.id, reason: 'content_fingerprint' };
        }
      }
    }
    
    return { isDuplicate: false };
  }

  /**
   * Generate title hash bucket (first 3 words) for candidate selection
   */
  generateTitleHashBucket(title) {
    if (!title) return '';
    const words = title.toLowerCase().split(/\s+/).slice(0, 3);
    return words.join('_');
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

