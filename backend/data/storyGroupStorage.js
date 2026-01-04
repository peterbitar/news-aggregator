const { getDatabase } = require('./db');

/**
 * Story Group Storage Module
 * Manages story group creation, clustering, explanation storage, and queries
 */

/**
 * Create or update a story group
 */
function createStoryGroup(scope, primaryTicker, groupTitle, impactLevel, confidenceLevel, modelVersion, pipelineVersion) {
  const db = getDatabase();
  const dateBucket = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const result = db.prepare(`
      INSERT INTO story_groups (scope, primary_ticker, group_title, impact_level, confidence_level, model_version, pipeline_version, date_bucket)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, primary_ticker, date_bucket, group_title) DO UPDATE SET
        updated_at = datetime('now')
      RETURNING id
    `).get(scope, primaryTicker, groupTitle, impactLevel, confidenceLevel, modelVersion, pipelineVersion, dateBucket);

    return result.id;
  } catch (error) {
    console.error('Error creating story group:', error);
    throw error;
  }
}

/**
 * Create or update story group explanation
 */
function createStoryGroupExplanation(
  storyGroupId, 
  whatHappened, 
  whyItHappened,
  whyItMattersNow, 
  whatToWatchNext, 
  whatThisDoesNotMean, 
  sourcesSummary, 
  causeConfidence = null, 
  causeReason = null
) {
  const db = getDatabase();

  try {
    const sourcesJson = typeof sourcesSummary === 'string' 
      ? sourcesSummary 
      : JSON.stringify(sourcesSummary || []);

    // Check and add missing columns if needed
    try {
      db.prepare(`ALTER TABLE story_group_explanations ADD COLUMN why_it_happened TEXT`).run();
    } catch (e) {
      // Column may already exist
    }
    try {
      db.prepare(`ALTER TABLE story_group_explanations ADD COLUMN cause_confidence TEXT`).run();
    } catch (e) {
      // Column may already exist
    }
    try {
      db.prepare(`ALTER TABLE story_group_explanations ADD COLUMN cause_reason TEXT`).run();
    } catch (e) {
      // Column may already exist
    }

    db.prepare(`
      INSERT OR REPLACE INTO story_group_explanations (
        story_group_id, what_happened, why_it_happened, why_it_matters_now, 
        what_to_watch_next, what_this_does_not_mean, 
        sources_summary, cause_confidence, cause_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      storyGroupId,
      whatHappened,
      whyItHappened || null,
      whyItMattersNow,
      whatToWatchNext,
      whatThisDoesNotMean,
      sourcesJson,
      causeConfidence,
      causeReason
    );

    return true;
  } catch (error) {
    console.error('Error creating story group explanation:', error);
    throw error;
  }
}

/**
 * Add article to story group
 */
function addArticleToStoryGroup(storyGroupId, articleUrl, similarityScore) {
  const db = getDatabase();

  try {
    db.prepare(`
      INSERT OR IGNORE INTO story_group_articles (story_group_id, article_id, similarity_score)
      VALUES (?, ?, ?)
    `).run(storyGroupId, articleUrl, similarityScore || null);

    return true;
  } catch (error) {
    console.error('Error adding article to story group:', error);
    throw error;
  }
}

/**
 * Add related ticker to story group
 */
function addRelatedTickerToStoryGroup(storyGroupId, ticker, relationshipType = 'related') {
  const db = getDatabase();

  try {
    db.prepare(`
      INSERT OR IGNORE INTO story_group_related_tickers (story_group_id, ticker, relationship_type)
      VALUES (?, ?, ?)
    `).run(storyGroupId, ticker, relationshipType);

    return true;
  } catch (error) {
    console.error('Error adding related ticker:', error);
    throw error;
  }
}

/**
 * Log article decision at a pipeline stage
 */
function logArticleDecision(articleUrl, stageName, accepted, reasonLlm, rankScore, impactScore, qualityScore, scope, primaryTicker) {
  const db = getDatabase();

  try {
    db.prepare(`
      INSERT INTO article_decision_log (
        article_id, stage_name, accepted, reason_llm, rank_score, impact_score, quality_score, scope, primary_ticker
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      articleUrl,
      stageName,
      accepted ? 1 : 0,
      reasonLlm || null,
      rankScore || null,
      impactScore || null,
      qualityScore || null,
      scope || null,
      primaryTicker || null
    );

    return true;
  } catch (error) {
    console.error('Error logging article decision:', error);
    throw error;
  }
}

/**
 * Get story group by ID with all details
 */
function getStoryGroupById(storyGroupId) {
  const db = getDatabase();

  try {
    const group = db.prepare(`
      SELECT * FROM story_groups WHERE id = ?
    `).get(storyGroupId);

    if (!group) return null;

    const explanation = db.prepare(`
      SELECT * FROM story_group_explanations WHERE story_group_id = ?
    `).get(storyGroupId);

    const articles = db.prepare(`
      SELECT * FROM story_group_articles WHERE story_group_id = ? ORDER BY similarity_score DESC
    `).all(storyGroupId);

    const relatedTickers = db.prepare(`
      SELECT * FROM story_group_related_tickers WHERE story_group_id = ?
    `).all(storyGroupId);

    return {
      ...group,
      explanation: explanation || null,
      articles,
      relatedTickers
    };
  } catch (error) {
    console.error('Error fetching story group:', error);
    throw error;
  }
}

/**
 * Get GLOBAL story groups for a date (top N)
 */
function getGlobalStoryGroups(date, limit = 5) {
  const db = getDatabase();

  try {
    const groups = db.prepare(`
      SELECT
        sg.id, sg.scope, sg.primary_ticker, sg.group_title, sg.impact_level, sg.confidence_level,
        sg.model_version, sg.pipeline_version, sg.date_bucket, sg.created_at, sg.updated_at,
        sge.what_happened, sge.why_it_happened, sge.why_it_matters_now,
        sge.what_to_watch_next, sge.what_this_does_not_mean, sge.sources_summary,
        sge.cause_confidence, sge.cause_reason, sge.decision_reasoning
      FROM story_groups sg
      LEFT JOIN story_group_explanations sge ON sg.id = sge.story_group_id
      WHERE sg.scope = 'GLOBAL' AND sg.date_bucket = ?
      ORDER BY
        CASE sg.impact_level
          WHEN 'High' THEN 1
          WHEN 'Moderate' THEN 2
          WHEN 'Low' THEN 3
          WHEN 'Very Low' THEN 4
          ELSE 5
        END,
        sg.created_at DESC
      LIMIT ?
    `).all(date, limit);

    return groups.map(row => enrichStoryGroupRow(row));
  } catch (error) {
    console.error('Error fetching global story groups:', error);
    throw error;
  }
}

/**
 * Get TICKER story groups for specific tickers (top M per ticker)
 */
function getTickerStoryGroups(tickers, date, limitPerTicker = 3) {
  const db = getDatabase();

  try {
    if (!tickers || tickers.length === 0) return {};

    const result = {};

    for (const ticker of tickers) {
      const groups = db.prepare(`
        SELECT
          sg.id, sg.scope, sg.primary_ticker, sg.group_title, sg.impact_level, sg.confidence_level,
          sg.model_version, sg.pipeline_version, sg.date_bucket, sg.created_at, sg.updated_at,
          sge.what_happened, sge.why_it_happened, sge.why_it_matters_now,
          sge.what_to_watch_next, sge.what_this_does_not_mean, sge.sources_summary,
          sge.cause_confidence, sge.cause_reason, sge.decision_reasoning
        FROM story_groups sg
        LEFT JOIN story_group_explanations sge ON sg.id = sge.story_group_id
        WHERE sg.scope = 'TICKER' AND sg.primary_ticker = ? AND sg.date_bucket = ?
        ORDER BY
          CASE sg.impact_level
            WHEN 'High' THEN 1
            WHEN 'Moderate' THEN 2
            WHEN 'Low' THEN 3
            WHEN 'Very Low' THEN 4
            ELSE 5
          END,
          sg.created_at DESC
        LIMIT ?
      `).all(ticker, date, limitPerTicker);

      if (groups.length > 0) {
        result[ticker] = groups.map(row => enrichStoryGroupRow(row));
      }
    }

    return result;
  } catch (error) {
    console.error('Error fetching ticker story groups:', error);
    throw error;
  }
}

/**
 * Get decision log for an article
 */
function getArticleDecisionLog(articleUrl, stageName = null) {
  const db = getDatabase();

  try {
    let query = `SELECT * FROM article_decision_log WHERE article_id = ?`;
    const params = [articleUrl];

    if (stageName) {
      query += ` AND stage_name = ?`;
      params.push(stageName);
    }

    query += ` ORDER BY created_at DESC`;

    return db.prepare(query).all(...params);
  } catch (error) {
    console.error('Error fetching article decision log:', error);
    throw error;
  }
}

/**
 * Get decision logs by stage for monitoring
 */
function getDecisionLogByStage(stageName, limit = 100, offset = 0) {
  const db = getDatabase();

  try {
    return db.prepare(`
      SELECT * FROM article_decision_log
      WHERE stage_name = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(stageName, limit, offset);
  } catch (error) {
    console.error('Error fetching decision logs by stage:', error);
    throw error;
  }
}

/**
 * Helper function to enrich story group row with articles and related tickers
 */
function enrichStoryGroupRow(row) {
  if (!row) return null;

  const db = getDatabase();

  // Extract story_group fields (filter out explanation fields)
  const storyGroupFields = {};
  const explanationFields = {};

  const explanationColumns = ['what_happened', 'why_it_happened', 'why_it_matters_now', 'what_to_watch_next', 'what_this_does_not_mean', 'sources_summary', 'cause_confidence', 'cause_reason', 'decision_reasoning'];

  for (const [key, value] of Object.entries(row)) {
    if (explanationColumns.includes(key)) {
      explanationFields[key] = value;
    } else {
      storyGroupFields[key] = value;
    }
  }

  // Fetch articles and related tickers
  const articles = db.prepare(`
    SELECT article_id, similarity_score, added_at FROM story_group_articles
    WHERE story_group_id = ? ORDER BY similarity_score DESC
  `).all(storyGroupFields.id);

  const relatedTickers = db.prepare(`
    SELECT ticker, relationship_type FROM story_group_related_tickers
    WHERE story_group_id = ?
  `).all(storyGroupFields.id);

  // Parse sources_summary JSON if it exists
  let sourcesSummary = [];
  if (explanationFields.sources_summary) {
    try {
      sourcesSummary = JSON.parse(explanationFields.sources_summary);
    } catch (e) {
      sourcesSummary = [explanationFields.sources_summary];
    }
  }

  return {
    id: storyGroupFields.id,
    scope: storyGroupFields.scope,
    primary_ticker: storyGroupFields.primary_ticker,
    group_title: storyGroupFields.group_title,
    impact_level: storyGroupFields.impact_level,
    confidence_level: storyGroupFields.confidence_level,
    article_count: articles.length,
    model_version: storyGroupFields.model_version,
    pipeline_version: storyGroupFields.pipeline_version,
    date_bucket: storyGroupFields.date_bucket,
    created_at: storyGroupFields.created_at,
    updated_at: storyGroupFields.updated_at,
    explanation: {
      what_happened: explanationFields.what_happened || null,
      why_it_happened: explanationFields.why_it_happened || null,
      why_it_matters_now: explanationFields.why_it_matters_now || null,
      what_to_watch_next: explanationFields.what_to_watch_next || null,
      what_this_does_not_mean: explanationFields.what_this_does_not_mean || null,
      sources_summary: sourcesSummary,
      cause_confidence: explanationFields.cause_confidence || null,
      cause_reason: explanationFields.cause_reason || null,
      decision_reasoning: explanationFields.decision_reasoning ? JSON.parse(explanationFields.decision_reasoning) : null
    },
    articles,
    related_tickers: relatedTickers
  };
}

/**
 * Cluster articles using Jaccard similarity on keywords
 * Returns cluster groups with similarity scores
 */
function clusterArticlesBySimilarity(articles, similarityThreshold = 0.85) {
  const clusters = [];
  const assigned = new Set();

  for (const article of articles) {
    if (assigned.has(article.url)) continue;

    const cluster = [article];
    assigned.add(article.url);

    const articleKeywords = extractKeywords(article.title, article.description);

    for (const other of articles) {
      if (assigned.has(other.url)) continue;

      const otherKeywords = extractKeywords(other.title, other.description);
      const similarity = jaccardSimilarity(articleKeywords, otherKeywords);

      if (similarity >= similarityThreshold) {
        cluster.push({ ...other, similarity_score: similarity });
        assigned.add(other.url);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Extract keywords from title and description
 */
function extractKeywords(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();

  // Simple tokenization: split on non-alphanumeric, filter short words and common stop words
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'was', 'are', 'be', 'been', 'by', 'this', 'that', 'with', 'from', 'as', 'it']);

  const words = text.match(/\b\w+\b/g) || [];
  return new Set(words.filter(w => w.length > 3 && !stopWords.has(w)));
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1, set2) {
  if (set1.size === 0 && set2.size === 0) return 1.0;
  if (set1.size === 0 || set2.size === 0) return 0.0;

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

module.exports = {
  createStoryGroup,
  createStoryGroupExplanation,
  addArticleToStoryGroup,
  addRelatedTickerToStoryGroup,
  logArticleDecision,
  getStoryGroupById,
  getGlobalStoryGroups,
  getTickerStoryGroups,
  getArticleDecisionLog,
  getDecisionLogByStage,
  clusterArticlesBySimilarity,
  extractKeywords,
  jaccardSimilarity
};
