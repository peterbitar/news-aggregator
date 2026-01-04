/**
 * Centralized threshold configuration for article pipeline
 * All scoring thresholds, weights, and batch sizes in one place
 * 
 * This is the single source of truth for all pipeline thresholds.
 * Replace all hardcoded values in pipeline stages with imports from this file.
 */

module.exports = {
  // Process gate thresholds (Stage 1.5)
  // Different thresholds for holdings vs macro buckets
  PROCESS_GATE_HOLDINGS: 10,  // Lower threshold for holdings-specific news
  PROCESS_GATE_MACRO: 15,       // Higher threshold for macro/market news
  // Legacy: kept for backwards compatibility, but not used
  PROCESS_GATE_THRESHOLD: 30,  // DEPRECATED: Use PROCESS_GATE_HOLDINGS/MACRO instead
  
  // Feed rank threshold (minimum score to appear in feed)
  // MVP: Lowered from 40 to 25 for low-volume scenarios
  FEED_RANK_THRESHOLD: 25,
  
  // Stage 4 minimum scores
  // MVP: Lowered from 20 to 15 to align with Stage 3 threshold
  STAGE4_MIN_SCORE: 15,
  STAGE4_MIN_IMPACT: 15,
  
  // Stage 4 holding relevance formula constants
  STAGE4_HOLDING_BASE_SCORE: 20,      // Base score for all articles
  STAGE4_HOLDING_MATCH_BONUS: 10,     // Bonus for having any match
  STAGE4_HOLDING_PER_MATCH: 5,        // Additional points per matched holding
  STAGE4_HOLDING_MAX_SCORE: 45,       // Maximum holding relevance score
  
  // Content requirements
  CONTENT_MIN_LENGTH: 400,
  CONTENT_MAX_FETCH_ATTEMPTS: 2,
  
  // Batch sizes
  STAGE1_BATCH_SIZE: 20,
  STAGE3_BATCH_SIZE: 8,
  
  // Token limits
  STAGE3_PASS1_MAX_TOKENS: 2000,
  
  // Stage 3 Pass 2 text limits
  STAGE3_PASS2_INDIVIDUAL_MAX_CHARS: 8000,  // Individual processing: full article (8000 chars)
  STAGE3_PASS2_BATCH_MAX_CHARS: 1800,       // Batch processing: intro+conclusion excerpt (1800 chars)
  
  // Deduplication
  SIMHASH_DUP_THRESHOLD: 3, // Hamming distance threshold for duplicates
  
  // Ticker evidence storage
  TICKER_EVIDENCE_STORE_THRESHOLD: 30, // Only store evidence if impact >= this
  
  // Google RSS redirect allowlist mode
  // Set STRICT_REDIRECT_ALLOWLIST=true in production (default: true)
  // Set STRICT_REDIRECT_ALLOWLIST=false in dev for testing
};
