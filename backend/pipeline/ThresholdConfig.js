/**
 * Centralized threshold configuration for article pipeline
 * All scoring thresholds and processing gates in one place
 */

class ThresholdConfig {
  /**
   * Process gate thresholds by bucket type
   * Philosophy: Curated daily snapshot, not aggressive filtering
   * We want meaningful insights, not volume reduction
   */
  static PROCESS_GATE = {
    HOLDINGS: 10,  // Lower - user wants to see what matters for their holdings
    MACRO: 15      // Lower - macro context is important for calm understanding
  };

  /**
   * Minimum score to appear in user feed (daily snapshot)
   * Philosophy: Quality curation, not volume filtering
   * We'll show 3-8 cards per day, so threshold can be lower
   */
  static FEED_RANK_THRESHOLD = 25;

  /**
   * Minimum impact score to proceed to personalization stage
   * Philosophy: Let more through to Stage 4 where we can assess exposure
   */
  static STAGE4_MIN_IMPACT = 15;

  /**
   * Minimum content length requirements
   */
  static CONTENT = {
    MIN_LENGTH: 400,      // Minimum characters for full content
    MAX_FETCH_ATTEMPTS: 2 // Maximum retries for content fetching
  };

  /**
   * Get process gate threshold for a given bucket type
   * @param {string} bucket - "HOLDINGS" or "MACRO"
   * @returns {number} Threshold value
   */
  static getProcessGate(bucket) {
    return this.PROCESS_GATE[bucket] || this.PROCESS_GATE.HOLDINGS;
  }

  /**
   * Determine bucket type from article metadata
   * @param {string} searchedBy - Value from articles.searched_by column
   * @returns {string} "HOLDINGS" or "MACRO"
   */
  static getBucket(searchedBy) {
    return (searchedBy && searchedBy.toUpperCase() === "MACRO") ? "MACRO" : "HOLDINGS";
  }

  /**
   * Check if article passes process gate threshold
   * @param {number} likelyImpact - Impact score from Stage 1.5
   * @param {string} searchedBy - Bucket type indicator
   * @returns {boolean} True if should proceed to expensive processing
   */
  static shouldProcess(likelyImpact, searchedBy) {
    const bucket = this.getBucket(searchedBy);
    const threshold = this.getProcessGate(bucket);
    return likelyImpact >= threshold;
  }

  /**
   * Get threshold info for logging
   * @param {string} searchedBy - Bucket type indicator
   * @returns {Object} Bucket name and threshold value
   */
  static getThresholdInfo(searchedBy) {
    const bucket = this.getBucket(searchedBy);
    const threshold = this.getProcessGate(bucket);
    return { bucket, threshold };
  }
}

module.exports = ThresholdConfig;
