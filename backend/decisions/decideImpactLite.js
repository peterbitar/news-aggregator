/**
 * Lightweight Impact Guess (Stage 1.5)
 * Estimates likely impact using ONLY title + snippet + source + tags
 * This gate prevents expensive content fetching and deep LLM processing for low-impact articles
 * 
 * Output: likely_impact (0-100) - used as a process gate threshold
 */

const { getDatabase } = require("../data/db");

// Process gate threshold: only fetch full content if likely_impact >= this
const PROCESS_GATE_THRESHOLD = 30; // Lower than feed threshold to allow more through

/**
 * Decide likely impact from lightweight metadata only
 * Uses title, description, source, and title triage results
 * @param {Object} article - Article with url, title, description, source
 * @returns {Object} - { likely_impact: 0-100, should_fetch: boolean }
 */
function decideImpactLite(article) {
  const db = getDatabase();
  
  // Get article row with title triage results
  const articleRow = db.prepare(`
    SELECT title, description, source_name, title_relevance, title_event_type,
           title_ticker_matches, title_sector_matches, searched_by
    FROM articles WHERE url = ?
  `).get(article.url);
  
  if (!articleRow) {
    console.warn(`[decideImpactLite] Article not found: ${article.url}`);
    return { likely_impact: 0, should_fetch: false };
  }
  
  // Base score from title relevance (0-3 scale)
  let likely_impact = 0;
  
  // Title relevance contributes 0-30 points (0=0, 1=10, 2=20, 3=30)
  const titleRelevance = articleRow.title_relevance || 0;
  likely_impact += titleRelevance * 10;
  
  // Event type boost (high-impact events get boost)
  const eventType = (articleRow.title_event_type || "").toLowerCase();
  const highImpactEvents = ["earnings", "merger", "acquisition", "m&a", "ipo", "bankruptcy", "lawsuit", "regulation", "macro", "guidance", "product_tech", "industry_trend"];
  if (highImpactEvents.some(e => eventType.includes(e))) {
    likely_impact += 20;
  }
  
  // Generic asset/sector presence signal (mentions a specific asset/sector)
  // This is NOT personalization - just indicates article has specific focus
  let hasAssetMention = false;
  try {
    const tickerMatches = articleRow.title_ticker_matches 
      ? JSON.parse(articleRow.title_ticker_matches) 
      : [];
    const sectorMatches = articleRow.title_sector_matches 
      ? JSON.parse(articleRow.title_sector_matches) 
      : [];
    hasAssetMention = (tickerMatches.length > 0) || (sectorMatches.length > 0);
  } catch (e) {
    // Ignore parse errors
  }
  
  if (hasAssetMention) {
    likely_impact += 10; // Generic boost for articles mentioning specific assets/sectors
  }
  
  // Source quality boost (reputable sources get slight boost)
  const sourceName = (articleRow.source_name || "").toLowerCase();
  const reputableSources = ["reuters", "bloomberg", "wsj", "financial times", "cnbc", "marketwatch"];
  if (reputableSources.some(s => sourceName.includes(s))) {
    likely_impact += 5;
  }
  
  // Note: Stage 1.5 does not know or care which user holds what.
  // No holdings/personalization logic here - Stage 1.5 is global and cheap.
  // Personalization boosts happen only in Stage 4.
  
  // Cap at 100
  likely_impact = Math.min(100, likely_impact);
  
  // Determine bucket based on searched_by
  // If searched_by is "MACRO", it's MACRO bucket; otherwise it's HOLDINGS bucket
  const bucket = (articleRow.searched_by && articleRow.searched_by.toUpperCase() === "MACRO") ? "MACRO" : "HOLDINGS";

  // Dynamic threshold: Lower for curated daily snapshot philosophy
  // We want meaningful insights, not aggressive filtering
  const threshold = (bucket === "HOLDINGS") ? 10 : 15;
  
  // Decision: should we fetch full content?
  const should_fetch = likely_impact >= threshold;
  
  // Save likely_impact to database for tracking
  db.prepare(`
    UPDATE articles SET
      likely_impact = ?,
      updated_at = datetime('now')
    WHERE url = ?
  `).run(likely_impact, article.url);
  
  const decision = should_fetch ? "proceed" : "low_priority";
  console.log(`[Stage1.5] likely_impact=${likely_impact} threshold=${threshold} bucket=${bucket} decision=${decision} id=${article.url.substring(0, 50)}`);
  
  return {
    likely_impact,
    should_fetch,
    threshold: threshold,
    bucket: bucket,
  };
}

module.exports = {
  decideImpactLite,
  PROCESS_GATE_THRESHOLD,
};

