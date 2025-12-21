/**
 * Signal mapper service
 * Maps database article rows to Signal DTO format
 */

/**
 * Map database article row to Signal DTO
 * @param {Object} row - Database row from articles table
 * @returns {Object} - Signal DTO object
 */
function mapArticleRowToSignal(row) {
  if (!row) return null;

  // Parse why_json if it exists
  let why = [];
  if (row.why_json) {
    try {
      const parsed = JSON.parse(row.why_json);
      why = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      // If parsing fails, try to extract from other fields
      if (row.why_it_matters) {
        why = [row.why_it_matters];
      } else if (row.personalized_teaser) {
        why = [row.personalized_teaser];
      }
    }
  } else {
    // Fallback to other fields
    if (row.why_it_matters) {
      why = [row.why_it_matters];
    } else if (row.personalized_teaser) {
      why = [row.personalized_teaser];
    } else if (row.summary_short) {
      why = [row.summary_short];
    }
  }

  // Ensure why is an array and limit to 3 items
  if (!Array.isArray(why)) {
    why = why ? [why] : [];
  }
  why = why.slice(0, 3);

  // Get importance score (prefer final_rank_score, fallback to profile_adjusted_score)
  const importance_score = row.final_rank_score !== null && row.final_rank_score !== undefined
    ? row.final_rank_score
    : (row.profile_adjusted_score !== null && row.profile_adjusted_score !== undefined
      ? row.profile_adjusted_score
      : (row.impact_score || 0));

  // Build Signal DTO
  const signal = {
    id: row.url, // Use URL as unique identifier
    url: row.url,
    title: row.personalized_title || row.title || "",
    source: row.source_name || "Unknown",
    published_at: row.published_at || new Date().toISOString(),
    
    // Signal-specific fields (with defaults if not set)
    verdict: row.verdict || "aware",
    why: why,
    action: row.action || "Do nothing",
    horizon: row.horizon || null,
    opportunity_type: row.opportunity_type || "none",
    opportunity_note: row.opportunity_note || "",
    confidence: row.confidence !== null && row.confidence !== undefined ? row.confidence : 0,
    importance_score: importance_score,
  };

  return signal;
}

/**
 * Map multiple article rows to Signal DTOs
 * @param {Array} rows - Array of database rows
 * @returns {Array} - Array of Signal DTOs
 */
function mapArticleRowsToSignals(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(mapArticleRowToSignal)
    .filter(signal => signal !== null);
}

module.exports = {
  mapArticleRowToSignal,
  mapArticleRowsToSignals,
};

