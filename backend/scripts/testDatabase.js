/**
 * Test Database Script
 * Verifies that the cleaned database works correctly
 */

const { getDatabase } = require("../data/db");
const { saveArticles } = require("../data/articleStorage");

function testDatabase() {
  console.log("Testing database...");
  
  const db = getDatabase();
  
  try {
    // Test 1: Check schema
    console.log("\n1. Checking schema...");
    const tableInfo = db.prepare("PRAGMA table_info(articles)").all();
    const columns = tableInfo.map(col => col.name);
    console.log(`   Found ${columns.length} columns`);
    
    // Verify key columns exist
    const requiredColumns = [
      "url", "title", "source_name", "published_at",
      "status", "title_relevance", "impact_score",
      "canonical_url", "final_url", "content_fingerprint",
      "matched_tickers", "profile_adjusted_score", "final_rank_score"
    ];
    
    const missingColumns = requiredColumns.filter(col => !columns.includes(col));
    if (missingColumns.length > 0) {
      console.error(`   ERROR: Missing required columns: ${missingColumns.join(", ")}`);
      return false;
    }
    console.log("   ✓ All required columns present");
    
    // Verify unnecessary columns are gone
    const unnecessaryColumns = [
      "raw_html", "matched_holdings", "relevance_scores_json",
      "summary_enriched", "why_it_matters", "summary_short",
      "summary_medium", "personalized_teaser", "personalized_title",
      "should_enrich", "triage_reason", "triage_score"
    ];
    
    const foundUnnecessary = unnecessaryColumns.filter(col => columns.includes(col));
    if (foundUnnecessary.length > 0) {
      console.warn(`   WARNING: Found unnecessary columns: ${foundUnnecessary.join(", ")}`);
    } else {
      console.log("   ✓ No unnecessary columns found");
    }
    
    // Test 2: Insert test article
    console.log("\n2. Testing article insertion...");
    const testArticle = {
      url: "https://test.example.com/article1",
      source_id: "test",
      source_name: "Test Source",
      title: "Test Article",
      description: "This is a test article",
      published_at: new Date().toISOString(),
      content: "Test content",
      feed_source: "test",
      original_url: "https://test.example.com/article1",
      final_url: "https://test.example.com/article1",
      display_domain: "test.example.com",
      searched_by: "TEST"
    };
    
    saveArticles([testArticle], "TEST");
    console.log("   ✓ Article inserted successfully");
    
    // Test 3: Query article
    console.log("\n3. Testing article query...");
    const article = db.prepare("SELECT * FROM articles WHERE url = ?").get(testArticle.url);
    if (!article) {
      console.error("   ERROR: Could not retrieve inserted article");
      return false;
    }
    console.log(`   ✓ Article retrieved: ${article.title}`);
    console.log(`   ✓ Status: ${article.status || "null"}`);
    console.log(`   ✓ Searched by: ${article.searched_by}`);
    
    // Test 4: Verify columns are accessible
    console.log("\n4. Testing column access...");
    const testFields = [
      "canonical_url", "final_url", "original_url", "display_domain",
      "content_fingerprint", "normalized_url", "normalized_domain",
      "title_hash_bucket", "deferred_reason", "ticker_evidence"
    ];
    
    const accessibleFields = testFields.filter(field => article.hasOwnProperty(field));
    console.log(`   ✓ ${accessibleFields.length}/${testFields.length} new fields accessible`);
    
    // Test 5: Clean up
    console.log("\n5. Cleaning up test data...");
    db.prepare("DELETE FROM articles WHERE url = ?").run(testArticle.url);
    console.log("   ✓ Test article deleted");
    
    // Test 6: Check indexes
    console.log("\n6. Checking indexes...");
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='articles'
    `).all();
    console.log(`   Found ${indexes.length} indexes`);
    const indexNames = indexes.map(idx => idx.name);
    const requiredIndexes = [
      "idx_articles_published_at",
      "idx_articles_status",
      "idx_articles_canonical_url"
    ];
    const missingIndexes = requiredIndexes.filter(idx => !indexNames.includes(idx));
    if (missingIndexes.length > 0) {
      console.warn(`   WARNING: Missing indexes: ${missingIndexes.join(", ")}`);
    } else {
      console.log("   ✓ Key indexes present");
    }
    
    console.log("\n✅ All database tests passed!");
    return true;
    
  } catch (error) {
    console.error("\n❌ Database test failed:", error);
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  const success = testDatabase();
  process.exit(success ? 0 : 1);
}

module.exports = { testDatabase };
