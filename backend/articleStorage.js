const { getDatabase } = require("./db");
// NOTE: articlePipeline removed - pipeline processing should only be triggered via /api/articles/process endpoint

/**
 * Save articles to database (insert or update if exists)
 * @param {Array} articles - Array of article objects
 * @param {string} searchedBy - Optional: ticker/keyword that was used to find these articles
 */
function saveArticles(articles, searchedBy = null) {
  if (!articles || articles.length === 0) return;
  
  const db = getDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO articles (
      url, source_id, source_name, author, title, description,
      url_to_image, published_at, content, searched_by, feed_source, 
      last_scraped_at, scrape_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(url) DO UPDATE SET
      -- Only update basic fields that might change
      source_id = excluded.source_id,
      source_name = excluded.source_name,
      author = excluded.author,
      title = excluded.title,
      -- Only update description if new one is not empty
      description = CASE 
        WHEN excluded.description IS NOT NULL AND excluded.description != '' 
        THEN excluded.description 
        ELSE articles.description 
      END,
      url_to_image = excluded.url_to_image,
      -- Preserve original published_at (don't overwrite with potentially older date)
      published_at = CASE
        WHEN excluded.published_at IS NOT NULL AND excluded.published_at != ''
          AND (articles.published_at IS NULL OR excluded.published_at < articles.published_at)
        THEN excluded.published_at
        ELSE articles.published_at
      END,
      -- Only update content if new one is not empty
      content = CASE 
        WHEN excluded.content IS NOT NULL AND excluded.content != '' 
        THEN excluded.content 
        ELSE articles.content 
      END,
      -- Merge searched_by to support multiple tickers (comma-separated)
      searched_by = CASE 
        WHEN excluded.searched_by IS NOT NULL AND excluded.searched_by != '' THEN
          CASE 
            WHEN articles.searched_by IS NULL OR articles.searched_by = '' 
            THEN excluded.searched_by
            WHEN articles.searched_by NOT LIKE '%' || excluded.searched_by || '%' 
            THEN articles.searched_by || ',' || excluded.searched_by
            ELSE articles.searched_by
          END
        ELSE articles.searched_by
      END,
      -- Preserve feed_source if already set
      feed_source = CASE
        WHEN excluded.feed_source IS NOT NULL AND excluded.feed_source != ''
          AND (articles.feed_source IS NULL OR articles.feed_source = '')
        THEN excluded.feed_source
        ELSE articles.feed_source
      END,
      -- Update scrape tracking
      last_scraped_at = datetime('now'),
      scrape_count = articles.scrape_count + 1,
      updated_at = datetime('now')
      -- Note: We do NOT update enrichment fields (summary_enriched, why_it_matters, relevance_scores_json)
      -- or triage fields (should_enrich, triage_reason, triage_score) to preserve processed data
  `);

  const insertMany = db.transaction((articles) => {
    let savedCount = 0;
    let skippedCount = 0;
    
    for (const article of articles) {
      // Validate article before saving
      if (!article.url || typeof article.url !== 'string' || article.url.trim().length === 0) {
        skippedCount++;
        continue; // Skip articles without valid URL
      }
      
      // Validate title (required field)
      if (!article.title || typeof article.title !== 'string' || article.title.trim().length === 0) {
        skippedCount++;
        console.warn(`Skipping article with invalid title: ${article.url}`);
        continue;
      }
      
      // Validate published date format
      let publishedAt = article.publishedAt || new Date().toISOString();
      try {
        // Ensure it's a valid ISO date string
        new Date(publishedAt);
      } catch (e) {
        publishedAt = new Date().toISOString();
      }
      
      try {
        stmt.run(
          article.url.trim(),
          article.source?.id || null,
          (article.source?.name || "Unknown").trim(),
          article.author ? article.author.trim() : null,
          article.title.trim(),
          article.description ? article.description.trim() : null,
          article.urlToImage ? article.urlToImage.trim() : null,
          publishedAt,
          article.content ? article.content.trim() : null,
          searchedBy || article.searchedBy || null,
          article.feedSource || null,
          now, // last_scraped_at
          // scrape_count is set in SQL (1 for new, +1 for existing)
        );
        savedCount++;
      } catch (error) {
        skippedCount++;
        console.error(`Error saving article ${article.url}:`, error.message);
      }
    }
    
    if (skippedCount > 0) {
      console.log(`[saveArticles] Saved ${savedCount} articles, skipped ${skippedCount} invalid articles`);
    }
  });

  insertMany(articles);

  // NOTE: Pipeline processing has been removed from saveArticles
  // Articles are now only saved to the database here
  // Pipeline processing should only be triggered via /api/articles/process endpoint
}

/**
 * Check if an article has valid enrichment data
 * Validates that summary_enriched is not HTML and is a reasonable length
 */
function hasValidEnrichment(row) {
  // Check if summary_enriched exists and is valid (not HTML, reasonable length)
  const hasValidSummary = row.summary_enriched && 
    row.summary_enriched.trim().length > 0 &&
    row.summary_enriched.trim().length < 2000 && // Reasonable summary length
    !row.summary_enriched.includes('<!DOCTYPE') && // Not HTML
    !row.summary_enriched.includes('<html') && // Not HTML
    !row.summary_enriched.startsWith('<'); // Not HTML tag
  
  // Check if why_it_matters exists and is valid
  const hasValidWhyItMatters = row.why_it_matters && 
    row.why_it_matters.trim().length > 0 &&
    row.why_it_matters.trim().length < 2000 &&
    !row.why_it_matters.includes('<!DOCTYPE') &&
    !row.why_it_matters.includes('<html') &&
    !row.why_it_matters.startsWith('<');
  
  // Check if relevance_scores_json exists and has valid scores
  let hasValidScores = false;
  if (row.relevance_scores_json) {
    try {
      const scores = JSON.parse(row.relevance_scores_json);
      hasValidScores = typeof scores === 'object' && Object.keys(scores).length > 0;
    } catch (e) {
      hasValidScores = false;
    }
  }
  
  // Article is enriched if it has at least a valid summary OR (why_it_matters AND relevance scores)
  return hasValidSummary || (hasValidWhyItMatters && hasValidScores);
}

/**
 * Check which articles already exist in database by URLs
 * Returns a Set of existing URLs
 */
function getExistingArticleUrls(urls) {
  if (!urls || urls.length === 0) return new Set();
  
  const db = getDatabase();
  const placeholders = urls.map(() => "?").join(",");
  
  try {
    const existing = db
      .prepare(`SELECT url FROM articles WHERE url IN (${placeholders})`)
      .all(...urls);
    
    return new Set(existing.map(row => row.url));
  } catch (error) {
    console.error("Error checking existing articles:", error.message);
    return new Set();
  }
}

/**
 * Get articles from database by URLs
 */
function getArticlesFromDatabase(urls) {
  if (!urls || urls.length === 0) return [];
  
  const db = getDatabase();
  const placeholders = urls.map(() => "?").join(",");
  
  try {
    const rows = db
      .prepare(`SELECT * FROM articles WHERE url IN (${placeholders})`)
      .all(...urls);
    
    return rows.map(row => {
      // Parse relevance scores from JSON if available
      let relevanceScores = {};
      if (row.relevance_scores_json) {
        try {
          relevanceScores = JSON.parse(row.relevance_scores_json);
        } catch (e) {
          console.error(`Error parsing relevance_scores_json for ${row.url}:`, e.message);
        }
      }

      const article = {
        source: {
          id: row.source_id,
          name: row.source_name,
        },
        author: row.author,
        title: row.title,
        description: row.description,
        url: row.url,
        urlToImage: row.url_to_image,
        publishedAt: row.published_at,
        content: row.content,
        feedSource: row.feed_source || null,
      };

      // Add enrichment data if available (validate it's actually enrichment, not HTML)
      const hasEnrichment = hasValidEnrichment(row);
      
      // Add triage information if available
      const triageInfo = {};
      if (row.should_enrich !== null && row.should_enrich !== undefined) {
        triageInfo.shouldEnrich = row.should_enrich === 1;
      }
      if (row.triage_reason) {
        triageInfo.triageReason = row.triage_reason;
      }
      if (row.triage_score !== null && row.triage_score !== undefined) {
        triageInfo.triageScore = row.triage_score;
      }

      if (hasEnrichment) {
        return {
          ...article,
          summary: row.summary_enriched || row.summary_short || "",
          whyItMatters: row.why_it_matters || row.personalized_teaser || "",
          relevanceScores: relevanceScores,
          ...triageInfo,
        };
      }

      // Return article with triage info even if not enriched
      return {
        ...article,
        ...triageInfo,
      };
    });
  } catch (error) {
    console.error("Error getting articles from database:", error.message);
    return [];
  }
}

/**
 * Get articles from database matching query criteria
 * This can be used for searching cached articles
 */
function getArticlesFromDatabaseByQuery(query, options = {}) {
  const { from, to, limit = 500, sources } = options; // Removed category, increased default limit
  const db = getDatabase();
  
  let sql = "SELECT * FROM articles WHERE 1=1";
  const params = [];
  
  // Only filter by search query if provided (don't filter by category - return all articles)
  if (query && query.trim()) {
    sql += " AND (title LIKE ? OR description LIKE ?)";
    const searchTerm = `%${query.trim()}%`;
    params.push(searchTerm, searchTerm);
  }
  
  // Note: We removed category filtering because it was too restrictive
  // Category is just used for API calls, not for database queries
  
  // Filter by feed_source if sources are specified
  if (sources && Array.isArray(sources) && sources.length > 0) {
    const placeholders = sources.map(() => "?").join(",");
    sql += ` AND feed_source IN (${placeholders})`;
    params.push(...sources);
  }
  
  if (from) {
    sql += " AND published_at >= ?";
    params.push(from);
  }
  
  if (to) {
    sql += " AND published_at <= ?";
    params.push(to);
  }
  
  sql += " ORDER BY published_at DESC LIMIT ?";
  params.push(limit);
  
  try {
    const rows = db.prepare(sql).all(...params);
    
    return rows.map(row => {
      // Parse relevance scores from JSON if available
      let relevanceScores = {};
      if (row.relevance_scores_json) {
        try {
          relevanceScores = JSON.parse(row.relevance_scores_json);
        } catch (e) {
          console.error(`Error parsing relevance_scores_json for ${row.url}:`, e.message);
        }
      }

      const article = {
        source: {
          id: row.source_id,
          name: row.source_name,
        },
        author: row.author,
        title: row.title,
        description: row.description,
        url: row.url,
        urlToImage: row.url_to_image,
        publishedAt: row.published_at,
        content: row.content,
        feedSource: row.feed_source || null,
      };

      // Add enrichment data if available (validate it's actually enrichment, not HTML)
      const hasEnrichment = hasValidEnrichment(row);
      
      // Add triage information if available
      const triageInfo = {};
      if (row.should_enrich !== null && row.should_enrich !== undefined) {
        triageInfo.shouldEnrich = row.should_enrich === 1;
      }
      if (row.triage_reason) {
        triageInfo.triageReason = row.triage_reason;
      }
      if (row.triage_score !== null && row.triage_score !== undefined) {
        triageInfo.triageScore = row.triage_score;
      }

      if (hasEnrichment) {
        return {
          ...article,
          summary: row.summary_enriched || row.summary_short || "",
          whyItMatters: row.why_it_matters || row.personalized_teaser || "",
          relevanceScores: relevanceScores,
          ...triageInfo,
        };
      }

      // Return article with triage info even if not enriched
      return {
        ...article,
        ...triageInfo,
      };
    });
  } catch (error) {
    console.error("Error querying articles from database:", error.message);
    return [];
  }
}

/**
 * Get cached articles for holdings (tickers)
 */
function getCachedArticlesForHoldings(holdings, options = {}) {
  const { from, to, limit = 1000, sources } = options; // Increased default limit
  const db = getDatabase();
  
  if (!holdings || holdings.length === 0) {
    return [];
  }
  
  // Build search for tickers
  const tickers = holdings.map(h => h.ticker.toUpperCase());
  const placeholders = tickers.map(() => "?").join(",");
  
  let sql = `SELECT * FROM articles WHERE searched_by IN (${placeholders})`;
  const params = [...tickers];
  
  // Filter by feed_source if sources are specified
  if (sources && Array.isArray(sources) && sources.length > 0) {
    const sourcePlaceholders = sources.map(() => "?").join(",");
    sql += ` AND feed_source IN (${sourcePlaceholders})`;
    params.push(...sources);
  }
  
  if (from) {
    sql += " AND published_at >= ?";
    params.push(from);
  }
  
  if (to) {
    sql += " AND published_at <= ?";
    params.push(to);
  }
  
  sql += " ORDER BY published_at DESC LIMIT ?";
  params.push(limit);
  
  try {
    const rows = db.prepare(sql).all(...params);
    
    return rows.map(row => {
      // Parse relevance scores from JSON if available
      let relevanceScores = {};
      if (row.relevance_scores_json) {
        try {
          relevanceScores = JSON.parse(row.relevance_scores_json);
        } catch (e) {
          console.error(`Error parsing relevance_scores_json for ${row.url}:`, e.message);
        }
      }

      const article = {
        source: {
          id: row.source_id,
          name: row.source_name,
        },
        author: row.author,
        title: row.title,
        description: row.description,
        url: row.url,
        urlToImage: row.url_to_image,
        publishedAt: row.published_at,
        content: row.content,
        feedSource: row.feed_source || null,
        searchedBy: row.searched_by || null,
      };

      // Add enrichment data if available (validate it's actually enrichment, not HTML)
      const hasEnrichment = hasValidEnrichment(row);
      
      // Add triage information if available
      const triageInfo = {};
      if (row.should_enrich !== null && row.should_enrich !== undefined) {
        triageInfo.shouldEnrich = row.should_enrich === 1;
      }
      if (row.triage_reason) {
        triageInfo.triageReason = row.triage_reason;
      }
      if (row.triage_score !== null && row.triage_score !== undefined) {
        triageInfo.triageScore = row.triage_score;
      }

      if (hasEnrichment) {
        return {
          ...article,
          summary: row.summary_enriched || row.summary_short || "",
          whyItMatters: row.why_it_matters || row.personalized_teaser || "",
          relevanceScores: relevanceScores,
          ...triageInfo,
        };
      }

      // Return article with triage info even if not enriched
      return {
        ...article,
        ...triageInfo,
      };
    });
  } catch (error) {
    console.error("Error querying cached articles for holdings:", error.message);
    return [];
  }
}

/**
 * Remove articles older than specified days
 * Returns number of deleted articles
 */
function cleanupOldArticles(daysToKeep = 30) {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString();
  
  try {
    const result = db.prepare("DELETE FROM articles WHERE published_at < ?").run(cutoff);
    return result.changes; // Number of deleted articles
  } catch (error) {
    console.error("Error cleaning up old articles:", error.message);
    return 0;
  }
}

/**
 * Get count of articles in database
 */
function getArticleCount() {
  const db = getDatabase();
  try {
    const result = db.prepare("SELECT COUNT(*) as count FROM articles").get();
    return result.count;
  } catch (error) {
    console.error("Error getting article count:", error.message);
    return 0;
  }
}

/**
 * Clear all articles from database
 * Returns number of deleted articles
 */
function clearAllArticles() {
  const db = getDatabase();
  try {
    const result = db.prepare("DELETE FROM articles").run();
    return result.changes; // Number of deleted articles
  } catch (error) {
    console.error("Error clearing articles:", error.message);
    throw error;
  }
}

/**
 * Get articles that have completed all processing stages and are ready for the feed
 * These are articles that have been personalized and ranked, and are marked to be shown to the user
 * IMPORTANT: Only returns articles relevant to the user's holdings
 * @param {Object} options - Options for filtering (limit, from, to, sources, minScore, holdings)
 * @param {Array} options.holdings - Array of holding objects with ticker property (REQUIRED for filtering)
 * @returns {Array} Array of article objects with all enrichment data
 */
function getFeedArticles(options = {}) {
  const { limit = 100, from, to, sources, minScore = 40, holdings } = options;
  const db = getDatabase();
  
  // Show articles that are personalized (Stage 4 complete) or ranked (Stage 5 complete)
  // CRITICAL: Only show articles that:
  // 1. Match holdings in searched_by field
  // 2. Have a relevance score (profile_adjusted_score or final_rank_score)
  let sql = `
    SELECT * FROM articles
    WHERE (status = 'personalized' OR status = 'ranked')
      AND status != 'discarded'
      AND (
        -- Must have a relevance score (either profile_adjusted_score or final_rank_score)
        profile_adjusted_score IS NOT NULL 
        OR final_rank_score IS NOT NULL
      )
      AND (
        -- Score must meet minimum threshold
        COALESCE(final_rank_score, profile_adjusted_score) >= ?
      )
  `;
  const params = [minScore];
  
  // Filter by holdings - article must be searched by one of the user's tickers
  // ONLY check searched_by field (exact match or comma-separated)
  if (holdings && holdings.length > 0) {
    const tickers = holdings.map(h => (typeof h === 'string' ? h : h.ticker).toUpperCase());
    
    // Build conditions for each ticker to check ONLY in searched_by field
    const tickerConditions = tickers.map(ticker => {
      // Check if ticker appears in searched_by (exact match or comma-separated)
      return `(
        searched_by = ? 
        OR searched_by LIKE ? || ',%'
        OR searched_by LIKE '%,' || ? || ',%'
        OR searched_by LIKE '%,' || ?
      )`;
    }).join(' OR ');
    
    sql += ` AND (${tickerConditions})`;
    
    // Add parameters for each ticker (4 params per ticker: exact + 3 LIKE patterns)
    for (const ticker of tickers) {
      params.push(ticker, ticker, ticker, ticker);
    }
    
    console.log(`[getFeedArticles] Filtering feed by ${tickers.length} holdings in searched_by: ${tickers.join(', ')}`);
  } else {
    console.warn(`[getFeedArticles] WARNING: No holdings provided - feed may show irrelevant articles`);
  }
  
  // Filter by feed_source if sources are specified
  if (sources && Array.isArray(sources) && sources.length > 0) {
    const placeholders = sources.map(() => "?").join(",");
    sql += ` AND feed_source IN (${placeholders})`;
    params.push(...sources);
  }
  
  if (from) {
    sql += " AND published_at >= ?";
    params.push(from);
  }
  
  if (to) {
    sql += " AND published_at <= ?";
    params.push(to);
  }
  
  // Order by final_rank_score if available, otherwise by profile_adjusted_score
  sql += " ORDER BY COALESCE(final_rank_score, profile_adjusted_score) DESC, profile_adjusted_score DESC, published_at DESC LIMIT ?";
  params.push(limit);
  
  try {
    const rows = db.prepare(sql).all(...params);
    
    return rows.map(row => {
      // Parse relevance scores from JSON if available
      let relevanceScores = {};
      if (row.relevance_scores_json) {
        try {
          relevanceScores = JSON.parse(row.relevance_scores_json);
        } catch (e) {
          console.error(`Error parsing relevance_scores_json for ${row.url}:`, e.message);
        }
      }
      
      const article = {
        source: {
          id: row.source_id,
          name: row.source_name,
        },
        author: row.author,
        title: row.personalized_title || row.title, // Use personalized title if available
        description: row.description,
        url: row.url,
        urlToImage: row.url_to_image,
        publishedAt: row.published_at,
        content: row.content,
        feedSource: row.feed_source || null,
      };
      
      // Add all enrichment data
      return {
        ...article,
        summary: row.summary_short || row.summary_medium || row.summary_long || row.summary_enriched || "",
        whyItMatters: row.why_it_matters || row.personalized_teaser || "",
        relevanceScores: relevanceScores,
        // Add pipeline metadata
        impactScore: row.impact_score,
        profileAdjustedScore: row.profile_adjusted_score,
        finalRankScore: row.final_rank_score,
        eventType: row.event_type,
        sentiment: row.sentiment,
        sentimentLabel: row.sentiment_label,
        riskScore: row.risk_score,
        opportunityScore: row.opportunity_score,
        volatilityScore: row.volatility_score,
        matchedTickers: row.matched_tickers ? JSON.parse(row.matched_tickers) : [],
        matchedSectors: row.matched_sectors ? JSON.parse(row.matched_sectors) : [],
        matchedHoldings: row.matched_holdings ? JSON.parse(row.matched_holdings) : [],
        isPrimaryInCluster: row.is_primary_in_cluster === 1,
        clusterId: row.cluster_id,
      };
    });
  } catch (error) {
    console.error("Error getting feed articles from database:", error.message);
    return [];
  }
}

module.exports = {
  saveArticles,
  getExistingArticleUrls,
  getArticlesFromDatabase,
  getArticlesFromDatabaseByQuery,
  getCachedArticlesForHoldings,
  cleanupOldArticles,
  getArticleCount,
  clearAllArticles,
  getFeedArticles,
};

