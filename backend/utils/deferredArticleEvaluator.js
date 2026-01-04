/**
 * Deferred Article Evaluator
 * Determines if deferred articles should be re-evaluated
 * Uses GLOBAL signals only (no user holdings)
 */

/**
 * High-quality fetchable sources (tested and confirmed working)
 * Only include sources you have tested via your fetcher
 * 
 * IMPORTANT: This is separate from redirect allowlist.
 * Redirect allowlist (in newsProviders.js) is for URL safety.
 * This list is for re-evaluation - only include sources that actually work.
 */
const FETCHABLE_HIGH_QUALITY_SOURCES = [
  'Associated Press',
  'AP',
  'AP News',
  // Add more only after testing fetch success rate
  // Do NOT include paywalled sources like Bloomberg, WSJ, FT unless you've tested them
];

/**
 * Normalize searched_by to count unique search contexts
 * Parses comma-separated values, normalizes, and deduplicates
 */
function normalizeSearchContexts(searchedBy) {
  if (!searchedBy) return new Set();
  
  // Parse comma-separated values, normalize, deduplicate
  const contexts = searchedBy.split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length > 0);
  
  return new Set(contexts);
}

/**
 * Determine if deferred article should be re-evaluated
 * Uses GLOBAL signals only (no user holdings)
 * 
 * Re-evaluation triggers:
 * - Multi-source count (searched_by has multiple unique values)
 * - High-quality fetchable source (tested sources only)
 * - Recency (published within last 24 hours)
 * - Repeated appearance (same article found multiple times)
 * 
 * @param {Object} article - Article object with searched_by, source_name, published_at, scrape_count
 * @returns {boolean} True if should re-evaluate
 */
function shouldReEvaluate(article) {
  // Check multi-source count
  const searchContexts = normalizeSearchContexts(article.searched_by);
  const multiSource = searchContexts.size >= 2;
  
  // Check high-quality fetchable source (only tested sources)
  const sourceName = (article.source_name || '').toLowerCase();
  const isHighQualitySource = FETCHABLE_HIGH_QUALITY_SOURCES.some(source => 
    sourceName.includes(source.toLowerCase())
  );
  
  // Check recency (published within last 24 hours)
  let isRecent = false;
  if (article.published_at) {
    try {
      const publishedAt = new Date(article.published_at);
      const hoursSincePublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
      isRecent = hoursSincePublished <= 24;
    } catch (error) {
      // Invalid date, skip recency check
    }
  }
  
  // Check repeated appearance (same article found multiple times)
  const isRepeated = (article.scrape_count || 0) >= 2;
  
  // Re-evaluate if any condition is true
  return multiSource || isHighQualitySource || isRecent || isRepeated;
}

module.exports = {
  shouldReEvaluate,
  normalizeSearchContexts,
};
