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

  // Add all required columns if they don't exist
  // Note: We'll keep url as PRIMARY KEY, but add id as a unique indexed column
  addColumnIfNotExists(db, "articles", "id", "INTEGER");
  
  // Create unique index on id if it doesn't exist (after column is added)
  if (columnExists(db, "articles", "id")) {
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_id ON articles(id) WHERE id IS NOT NULL`);
    } catch (error) {
      // Index might already exist, ignore
    }
  }
  addColumnIfNotExists(db, "articles", "canonical_url", "TEXT");
  addColumnIfNotExists(db, "articles", "feed_source", "TEXT");
  addColumnIfNotExists(db, "articles", "raw_html", "TEXT");
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
  addColumnIfNotExists(db, "articles", "matched_holdings", "TEXT");
  addColumnIfNotExists(db, "articles", "matched_tickers", "TEXT");
  addColumnIfNotExists(db, "articles", "matched_sectors", "TEXT");
  addColumnIfNotExists(db, "articles", "holding_relevance_score", "REAL");
  addColumnIfNotExists(db, "articles", "relevance_scores_json", "TEXT"); // Store relevanceScores as JSON: {"AAPL": 90, "NVDA": 20}
  addColumnIfNotExists(db, "articles", "summary_enriched", "TEXT"); // Store simple enrichment summary
  addColumnIfNotExists(db, "articles", "why_it_matters", "TEXT"); // Store simple enrichment whyItMatters
  addColumnIfNotExists(db, "articles", "profile_adjusted_score", "REAL");
  addColumnIfNotExists(db, "articles", "summary_short", "TEXT");
  addColumnIfNotExists(db, "articles", "summary_medium", "TEXT");
  addColumnIfNotExists(db, "articles", "summary_long", "TEXT");
  addColumnIfNotExists(db, "articles", "personalized_teaser", "TEXT");
  addColumnIfNotExists(db, "articles", "personalized_title", "TEXT");
  addColumnIfNotExists(db, "articles", "profile_type_cached", "TEXT"); // Cache profile type for personalization reuse
  addColumnIfNotExists(db, "articles", "final_rank_score", "REAL");
  addColumnIfNotExists(db, "articles", "cluster_id", "TEXT");
  addColumnIfNotExists(db, "articles", "is_primary_in_cluster", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "shown_to_user", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "shown_timestamp", "TEXT");
  addColumnIfNotExists(db, "articles", "hash_title", "TEXT");
  addColumnIfNotExists(db, "articles", "hash_content", "TEXT");
  addColumnIfNotExists(db, "articles", "priority", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "is_paywalled", "INTEGER DEFAULT 0");
  addColumnIfNotExists(db, "articles", "readability_score", "REAL");
  addColumnIfNotExists(db, "articles", "likely_impact", "REAL"); // Lightweight impact guess (0-100)
  addColumnIfNotExists(db, "articles", "language", "TEXT");
  addColumnIfNotExists(db, "articles", "searched_by", "TEXT"); // Ticker/keyword used to find this article (comma-separated for multiple)
  addColumnIfNotExists(db, "articles", "should_enrich", "INTEGER DEFAULT 1"); // Whether article should be enriched (1 = yes, 0 = no)
  addColumnIfNotExists(db, "articles", "triage_reason", "TEXT"); // Reason why article should/shouldn't be enriched
  addColumnIfNotExists(db, "articles", "triage_score", "REAL"); // Score from triage analysis (0-100)
  addColumnIfNotExists(db, "articles", "last_scraped_at", "TEXT"); // When article was last fetched from API
  addColumnIfNotExists(db, "articles", "scrape_count", "INTEGER DEFAULT 0"); // How many times article was scraped
  
  // Signal DTO fields
  addColumnIfNotExists(db, "articles", "verdict", "TEXT"); // "ignore", "aware", "act"
  addColumnIfNotExists(db, "articles", "why_json", "TEXT"); // JSON array of why strings (max 3)
  addColumnIfNotExists(db, "articles", "action", "TEXT"); // Allowed action from predefined set
  addColumnIfNotExists(db, "articles", "horizon", "TEXT"); // Time horizon (optional)
  addColumnIfNotExists(db, "articles", "opportunity_type", "TEXT"); // "none", "behavioral", "awareness", "allocation"
  addColumnIfNotExists(db, "articles", "opportunity_note", "TEXT"); // Optional note about opportunity
  addColumnIfNotExists(db, "articles", "confidence", "INTEGER DEFAULT 0"); // 0-100 confidence score
  addColumnIfNotExists(db, "articles", "importance_score", "REAL"); // Final importance score (alias for final_rank_score)

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

