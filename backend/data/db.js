const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Database file path
const DB_PATH = path.join(__dirname, "wealthy_rabbit.db");

/**
 * Helper function to check if a column exists in a table
 */
function columnExists(db, tableName, columnName) {
  try {
    const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return info.some((col) => col.name === columnName);
  } catch (error) {
    console.error(`Error checking column ${columnName} in ${tableName}:`, error);
    return false;
  }
}

/**
 * Helper function to add a column to a table if it doesn't exist
 */
function addColumnIfNotExists(db, tableName, columnName, columnDef) {
  if (!columnExists(db, tableName, columnName)) {
    try {
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run();
      console.log(`Added column ${columnName} to ${tableName}`);
    } catch (error) {
      console.error(`Error adding column ${columnName} to ${tableName}:`, error);
    }
  }
}

/**
 * Helper function to drop a column from a table if it exists
 * Note: Requires SQLite 3.35.0+ (better-sqlite3 11.6.0+ supports this)
 */
function dropColumnIfExists(db, tableName, columnName) {
  if (columnExists(db, tableName, columnName)) {
    try {
      db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`).run();
      console.log(`Dropped column ${columnName} from ${tableName}`);
    } catch (error) {
      // If DROP COLUMN is not supported, log warning but don't fail
      if (error.message.includes('DROP COLUMN') || error.message.includes('syntax error')) {
        console.warn(`DROP COLUMN not supported in this SQLite version. Column ${columnName} will remain but unused.`);
      } else {
        console.error(`Error dropping column ${columnName} from ${tableName}:`, error);
      }
    }
  }
}

// Initialize and configure database
function initDatabase() {
  // Create database connection
  const db = new Database(DB_PATH);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    )
  `);

  // Create holdings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      label TEXT,
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create index on user_id for faster queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holdings_user_id ON holdings(user_id)
  `);

  // Create index on ticker for faster lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings(ticker)
  `);

  // Create articles table for caching news articles
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      url TEXT PRIMARY KEY,
      source_id TEXT,
      source_name TEXT NOT NULL,
      author TEXT,
      title TEXT NOT NULL,
      description TEXT,
      url_to_image TEXT,
      published_at TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Remove unused columns from existing databases (migration)
  // These columns were removed as they were never used
  
  // Drop the unused index on id first (before dropping the column)
  try {
    db.exec(`DROP INDEX IF EXISTS idx_articles_id`);
  } catch (error) {
    // Ignore errors - index might not exist
  }
  
  // Drop indexes for columns we're removing (if they exist)
  try {
    db.exec(`DROP INDEX IF EXISTS idx_articles_hash_title`);
    db.exec(`DROP INDEX IF EXISTS idx_articles_hash_content`);
  } catch (error) {
    // Ignore errors - indexes might not exist
  }
  
  // Now drop the unused columns (canonical_url is NOT in this list - it's a necessary column)
  dropColumnIfExists(db, "articles", "hash_title");
  dropColumnIfExists(db, "articles", "hash_content");
  dropColumnIfExists(db, "articles", "readability_score");
  dropColumnIfExists(db, "articles", "language");
  dropColumnIfExists(db, "articles", "id"); // Redundant - url is already PK
  dropColumnIfExists(db, "articles", "priority");
  dropColumnIfExists(db, "articles", "is_paywalled");
  dropColumnIfExists(db, "articles", "summary_long");

  // Add all required columns if they don't exist
  addColumnIfNotExists(db, "articles", "feed_source", "TEXT");
  // raw_html is not stored (performance optimization - only clean_text is stored)
  addColumnIfNotExists(db, "articles", "clean_text", "TEXT");
  addColumnIfNotExists(db, "articles", "content_length", "INTEGER");
  addColumnIfNotExists(db, "articles", "content_fetched_at", "TEXT");
  addColumnIfNotExists(db, "articles", "status", "TEXT");
  addColumnIfNotExists(db, "articles", "fetch_attempts", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "llm_attempts", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "last_error", "TEXT");
  addColumnIfNotExists(db, "articles", "processing_started_at", "TEXT");
  addColumnIfNotExists(db, "articles", "processing_completed_at", "TEXT");
  addColumnIfNotExists(db, "articles", "title_relevance", "REAL");
  addColumnIfNotExists(db, "articles", "title_event_type", "TEXT");
  addColumnIfNotExists(db, "articles", "title_reason_short", "TEXT");
  addColumnIfNotExists(db, "articles", "should_fetch_full", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "title_sector_matches", "TEXT");
  addColumnIfNotExists(db, "articles", "title_ticker_matches", "TEXT");
  addColumnIfNotExists(db, "articles", "event_type", "TEXT");
  addColumnIfNotExists(db, "articles", "impact_score", "REAL");
  addColumnIfNotExists(db, "articles", "sentiment", "REAL");
  addColumnIfNotExists(db, "articles", "sentiment_label", "TEXT");
  addColumnIfNotExists(db, "articles", "risk_score", "REAL");
  addColumnIfNotExists(db, "articles", "opportunity_score", "REAL");
  addColumnIfNotExists(db, "articles", "volatility_score", "REAL");
  // matched_holdings is NOT stored - computed on the fly in Stage 4 (user-specific)
  addColumnIfNotExists(db, "articles", "matched_tickers", "TEXT");
  addColumnIfNotExists(db, "articles", "matched_sectors", "TEXT");
  addColumnIfNotExists(db, "articles", "holding_relevance_score", "REAL");
  // relevance_scores_json, summary_enriched, why_it_matters, summary_short, summary_medium,
  // personalized_teaser, personalized_title are not used in current implementation
  addColumnIfNotExists(db, "articles", "profile_adjusted_score", "REAL");
  addColumnIfNotExists(db, "articles", "profile_type_cached", "TEXT"); // Cache profile type for personalization reuse
  addColumnIfNotExists(db, "articles", "final_rank_score", "REAL");
  addColumnIfNotExists(db, "articles", "cluster_id", "TEXT");
  addColumnIfNotExists(db, "articles", "is_primary_in_cluster", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "shown_to_user", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "shown_timestamp", "TEXT");
  addColumnIfNotExists(db, "articles", "likely_impact", "REAL"); // Lightweight impact guess (0-100)
  addColumnIfNotExists(db, "articles", "searched_by", "TEXT"); // Ticker/keyword used to find this article (comma-separated for multiple)
  // should_enrich, triage_reason, triage_score are not used in current implementation
  addColumnIfNotExists(db, "articles", "last_scraped_at", "TEXT"); // When article was last fetched from API
  addColumnIfNotExists(db, "articles", "scrape_count", "INTEGER DEFAULT 0"); // How many times article was scraped
  
  // should_enrich, triage_reason, triage_score are not used in current implementation
  
  // Deduplication fields
  addColumnIfNotExists(db, "articles", "canonical_url", "TEXT"); // Canonical URL from HTML
  addColumnIfNotExists(db, "articles", "final_url", "TEXT"); // Decoded final URL (for Google RSS)
  addColumnIfNotExists(db, "articles", "original_url", "TEXT"); // Original URL before decoding
  addColumnIfNotExists(db, "articles", "display_domain", "TEXT"); // Domain for display
  addColumnIfNotExists(db, "articles", "content_fingerprint", "TEXT"); // SimHash fingerprint
  addColumnIfNotExists(db, "articles", "is_duplicate_of_article_id", "INTEGER"); // Foreign key to articles.id
  addColumnIfNotExists(db, "articles", "normalized_url", "TEXT"); // Normalized URL for deduplication
  addColumnIfNotExists(db, "articles", "normalized_domain", "TEXT"); // Normalized domain for candidate selection
  addColumnIfNotExists(db, "articles", "title_hash_bucket", "TEXT"); // Title hash for candidate selection
  
  // Deferred article fields
  addColumnIfNotExists(db, "articles", "deferred_reason", "TEXT"); // Reason for deferral
  addColumnIfNotExists(db, "articles", "deferred_at", "TEXT"); // When article was deferred
  addColumnIfNotExists(db, "articles", "re_evaluation_count", "INTEGER DEFAULT 0"); // How many times re-evaluated
  
  // Ticker evidence (optional, conditional storage)
  addColumnIfNotExists(db, "articles", "ticker_evidence", "TEXT"); // JSON object with ticker -> snippet mapping
  
  // Signal DTO fields
  addColumnIfNotExists(db, "articles", "verdict", "TEXT"); // "ignore", "aware", "act"
  addColumnIfNotExists(db, "articles", "why_json", "TEXT"); // JSON array of why strings (max 3)
  addColumnIfNotExists(db, "articles", "action", "TEXT"); // Allowed action from predefined set
  addColumnIfNotExists(db, "articles", "horizon", "TEXT"); // Time horizon (optional)
  addColumnIfNotExists(db, "articles", "opportunity_type", "TEXT"); // "none", "behavioral", "awareness", "allocation"
  addColumnIfNotExists(db, "articles", "opportunity_note", "TEXT"); // Optional note about opportunity
  addColumnIfNotExists(db, "articles", "confidence", "INTEGER DEFAULT 0"); // 0-100 confidence score
  addColumnIfNotExists(db, "articles", "importance_score", "REAL"); // Final importance score (alias for final_rank_score)

  // Create story_groups table for clustered explanations (global and ticker-scoped)
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK(scope IN ('GLOBAL', 'TICKER')),
      primary_ticker TEXT,
      group_title TEXT NOT NULL,
      impact_level TEXT NOT NULL CHECK(impact_level IN ('Very Low', 'Low', 'Moderate', 'High')),
      confidence_level TEXT NOT NULL CHECK(confidence_level IN ('Low', 'Medium', 'High')),
      model_version TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      date_bucket TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_story_groups_scope_date ON story_groups(scope, date_bucket)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_story_groups_scope_ticker_date ON story_groups(scope, primary_ticker, date_bucket)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_story_groups_primary_ticker ON story_groups(primary_ticker)
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS unique_story_group ON story_groups(scope, primary_ticker, date_bucket, group_title)
  `);

  // Create story_group_explanations table (one per story_group)
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_group_explanations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_group_id INTEGER NOT NULL UNIQUE,
      what_happened TEXT NOT NULL,
      why_it_matters_now TEXT NOT NULL,
      who_this_applies_to TEXT NOT NULL,
      what_to_watch_next TEXT NOT NULL,
      what_this_does_not_mean TEXT NOT NULL,
      sources_summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (story_group_id) REFERENCES story_groups(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_story_group_explanations_story_group_id ON story_group_explanations(story_group_id)
  `);

  // Add missing columns to story_group_explanations if they don't exist
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
  try {
    db.prepare(`ALTER TABLE story_group_explanations ADD COLUMN decision_reasoning TEXT`).run();
  } catch (e) {
    // Column may already exist
  }

  // Create story_group_articles join table (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_group_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_group_id INTEGER NOT NULL,
      article_id TEXT NOT NULL,
      similarity_score REAL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (story_group_id) REFERENCES story_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES articles(url)
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS unique_story_group_article ON story_group_articles(story_group_id, article_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_story_group_articles_article_id ON story_group_articles(article_id)
  `);

  // Create story_group_related_tickers table (optional related tickers for a story)
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_group_related_tickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_group_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      relationship_type TEXT DEFAULT 'related' CHECK(relationship_type IN ('affected', 'related', 'competitor')),
      FOREIGN KEY (story_group_id) REFERENCES story_groups(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS unique_story_group_ticker ON story_group_related_tickers(story_group_id, ticker)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_story_group_related_tickers_ticker ON story_group_related_tickers(ticker)
  `);

  // Create article_decision_log table (observability: pipeline stage decisions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      stage_name TEXT NOT NULL,
      accepted INTEGER NOT NULL,
      reason_llm TEXT,
      rank_score REAL,
      impact_score REAL,
      quality_score REAL,
      scope TEXT CHECK(scope IN ('GLOBAL', 'TICKER', NULL)),
      primary_ticker TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (article_id) REFERENCES articles(url)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_article_decision_log_article_stage ON article_decision_log(article_id, stage_name)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_article_decision_log_stage_created ON article_decision_log(stage_name, created_at)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_article_decision_log_decision_scope ON article_decision_log(scope, primary_ticker, created_at)
  `);

  // Create indexes for articles table
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_source_name ON articles(source_name)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at)
  `);

  // Create additional indexes for commonly queried columns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_cluster_id ON articles(cluster_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_final_rank_score ON articles(final_rank_score)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_shown_to_user ON articles(shown_to_user)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_verdict ON articles(verdict)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_importance_score ON articles(importance_score)
  `);

  // Deduplication indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles(canonical_url)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_normalized_domain ON articles(normalized_domain)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_title_hash_bucket ON articles(title_hash_bucket)
  `);

  // Ensure default user exists (id = 1)
  const defaultUser = db.prepare("SELECT * FROM users WHERE id = 1").get();
  if (!defaultUser) {
    db.prepare("INSERT INTO users (id, name) VALUES (1, 'Default User')").run();
    console.log("Created default user (id=1)");
  }

  console.log("Database initialized successfully");
  return db;
}

// Export database instance
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = initDatabase();
  }
  return dbInstance;
}

module.exports = { getDatabase, initDatabase };

