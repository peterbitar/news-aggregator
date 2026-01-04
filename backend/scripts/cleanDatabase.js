/**
 * Clean Database Script
 * Clears all articles and ensures schema is up to date
 * The normal initDatabase() will add any missing necessary columns
 */

const { initDatabase } = require("../data/db");
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/wealthy_rabbit.db");

// List of columns that are actually used in the pipeline
const NECESSARY_COLUMNS = [
  // Core article fields (from ingestion)
  "url",                    // PRIMARY KEY
  "source_id",
  "source_name",
  "author",
  "title",
  "description",
  "url_to_image",
  "published_at",
  "content",
  "created_at",
  "updated_at",
  
  // Ingestion tracking
  "feed_source",
  "searched_by",
  "original_url",
  "final_url",
  "display_domain",
  "last_scraped_at",
  "scrape_count",
  
  // Stage 1: Title Triage
  "title_relevance",        // 0-3 scale
  "title_event_type",
  "title_reason_short",
  "should_fetch_full",
  "title_ticker_matches",
  "title_sector_matches",
  
  // Stage 1.5: Process Gate
  "likely_impact",
  
  // Stage 2: Content Fetch
  "clean_text",
  "content_length",
  "content_fetched_at",
  "status",
  "fetch_attempts",
  "last_error",
  "processing_started_at",
  "processing_completed_at",
  
  // Deduplication (Stage 2 output)
  "canonical_url",
  "content_fingerprint",
  "normalized_url",
  "normalized_domain",
  "title_hash_bucket",
  "is_duplicate_of_article_id",
  
  // Stage 3: Content Classification
  "event_type",
  "impact_score",
  "sentiment",
  "sentiment_label",
  "risk_score",
  "opportunity_score",
  "volatility_score",
  "matched_tickers",
  "matched_sectors",
  "ticker_evidence",
  "llm_attempts",
  
  // Deferred articles
  "deferred_reason",
  "deferred_at",
  "re_evaluation_count",
  
  // Stage 4: Personalization
  "holding_relevance_score",
  "profile_adjusted_score",
  "profile_type_cached",
  
  // Stage 5: Ranking & Clustering
  "final_rank_score",
  "cluster_id",
  "is_primary_in_cluster",
  
  // Feed tracking
  "shown_to_user",
  "shown_timestamp",
  
  // Signal DTO fields (if used)
  "verdict",
  "why_json",
  "action",
  "horizon",
  "opportunity_type",
  "opportunity_note",
  "confidence",
  "importance_score",
];

// Columns to remove (unused or deprecated)
const COLUMNS_TO_REMOVE = [
  "raw_html",              // Not stored (performance)
  "matched_holdings",      // Computed on the fly in Stage 4, not stored
  "relevance_scores_json", // Not used in current implementation
  "summary_enriched",      // Not used in current implementation
  "why_it_matters",        // Not used in current implementation
  "summary_short",         // Not used in current implementation
  "summary_medium",        // Not used in current implementation
  "personalized_teaser",   // Not used in current implementation
  "personalized_title",    // Not used in current implementation
  "should_enrich",         // Not used in current implementation
  "triage_reason",         // Not used in current implementation
  "triage_score",          // Not used in current implementation
];

function cleanDatabase() {
  console.log("Starting database cleanup...");
  
  const db = new Database(DB_PATH);
  
  try {
    // Step 1: Clear all articles
    console.log("Clearing all articles...");
    const deleteResult = db.prepare("DELETE FROM articles").run();
    console.log(`Deleted ${deleteResult.changes} articles`);
    
    // Step 2: Get current columns
    const tableInfo = db.prepare("PRAGMA table_info(articles)").all();
    const currentColumns = tableInfo.map(col => col.name);
    console.log(`Current columns: ${currentColumns.length}`);
    
    // Step 3: Remove unnecessary columns if they exist
    const columnsToRemove = COLUMNS_TO_REMOVE.filter(col => currentColumns.includes(col));
    
    if (columnsToRemove.length > 0) {
      console.log(`Removing ${columnsToRemove.length} unnecessary columns: ${columnsToRemove.join(", ")}`);
      
      // Try to drop columns (works in SQLite 3.35.0+)
      for (const colName of columnsToRemove) {
        try {
          db.prepare(`ALTER TABLE articles DROP COLUMN ${colName}`).run();
          console.log(`  Dropped column: ${colName}`);
        } catch (error) {
          console.warn(`  Could not drop column ${colName}: ${error.message}`);
          // If DROP COLUMN not supported, column will remain but unused
        }
      }
    } else {
      console.log("No unnecessary columns to remove.");
    }
    
    db.close();
    
    // Step 4: Reinitialize database to ensure all necessary columns exist
    console.log("Reinitializing database schema...");
    initDatabase();
    
    // Step 5: Verify final state
    const db2 = new Database(DB_PATH);
    const finalTableInfo = db2.prepare("PRAGMA table_info(articles)").all();
    console.log(`Final column count: ${finalTableInfo.length}`);
    console.log("Database cleanup complete!");
    db2.close();
    
  } catch (error) {
    console.error("Error cleaning database:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  cleanDatabase();
}

module.exports = { cleanDatabase };
