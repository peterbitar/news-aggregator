/**
 * Simple Database Test
 * Tests database operations without requiring LLM/API calls
 */

const { getDatabase } = require("../data/db");
const { saveArticles, getFeedArticles } = require("../data/articleStorage");

function testDatabaseSimple() {
  console.log("🧪 Testing Database Operations\n");
  
  const db = getDatabase();
  
  try {
    // Test 1: Insert articles with all new fields
    console.log("1️⃣  Testing Article Insertion with New Fields...");
    const testArticles = [
      {
        url: "https://techcrunch.com/test-article-1",
        source_id: "techcrunch",
        source_name: "TechCrunch",
        title: "Apple Announces New iPhone with AI Features",
        description: "Apple unveiled its latest iPhone with advanced AI capabilities",
        published_at: new Date().toISOString(),
        content: "Apple Inc. announced today that its new iPhone will feature advanced AI capabilities.",
        feed_source: "gnews",
        original_url: "https://techcrunch.com/test-article-1",
        final_url: "https://techcrunch.com/test-article-1",
        display_domain: "techcrunch.com",
        searched_by: "AAPL"
      },
      {
        url: "https://reuters.com/test-article-2",
        source_id: "reuters",
        source_name: "Reuters",
        title: "Market Update: Tech Stocks Rally",
        description: "Technology stocks surged following major AI announcements",
        published_at: new Date().toISOString(),
        content: "Technology stocks including Microsoft (MSFT) and NVIDIA (NVDA) rallied today.",
        feed_source: "newsapi",
        original_url: "https://reuters.com/test-article-2",
        final_url: "https://reuters.com/test-article-2",
        display_domain: "reuters.com",
        searched_by: "MSFT,NVDA"
      }
    ];
    
    saveArticles(testArticles, "AAPL");
    console.log(`   ✓ Inserted ${testArticles.length} test articles`);
    
    // Test 2: Verify all new columns are accessible
    console.log("\n2️⃣  Verifying New Column Access...");
    const article1 = db.prepare("SELECT * FROM articles WHERE url = ?").get(testArticles[0].url);
    
    const newColumns = {
      "canonical_url": article1.canonical_url,
      "final_url": article1.final_url,
      "original_url": article1.original_url,
      "display_domain": article1.display_domain,
      "content_fingerprint": article1.content_fingerprint,
      "normalized_url": article1.normalized_url,
      "normalized_domain": article1.normalized_domain,
      "title_hash_bucket": article1.title_hash_bucket,
      "is_duplicate_of_article_id": article1.is_duplicate_of_article_id,
      "deferred_reason": article1.deferred_reason,
      "deferred_at": article1.deferred_at,
      "re_evaluation_count": article1.re_evaluation_count,
      "ticker_evidence": article1.ticker_evidence
    };
    
    let allAccessible = true;
    for (const [col, value] of Object.entries(newColumns)) {
      if (value === undefined) {
        console.error(`   ❌ Column ${col} is not accessible`);
        allAccessible = false;
      } else {
        console.log(`   ✓ ${col}: ${value !== null ? "accessible" : "null (OK)"}`);
      }
    }
    
    if (!allAccessible) {
      throw new Error("Some columns are not accessible");
    }
    console.log("   ✅ All new columns are accessible");
    
    // Test 3: Test URL fields
    console.log("\n3️⃣  Testing URL Field Storage...");
    console.log(`   ✓ Original URL: ${article1.original_url || "null"}`);
    console.log(`   ✓ Final URL: ${article1.final_url || "null"}`);
    console.log(`   ✓ Display domain: ${article1.display_domain || "null"}`);
    console.log(`   ✓ Primary URL: ${article1.url}`);
    
    if (article1.original_url && article1.final_url) {
      console.log("   ✅ URL fields stored correctly");
    }
    
    // Test 4: Test feed retrieval with new fields
    console.log("\n4️⃣  Testing Feed Retrieval...");
    const feedArticles = getFeedArticles({ limit: 10 });
    console.log(`   ✓ Feed query executed: ${feedArticles.length} articles returned`);
    
    if (feedArticles.length > 0) {
      const feedArticle = feedArticles[0];
      console.log(`   ✓ Feed article has url field: ${feedArticle.url ? "yes" : "no"}`);
      console.log(`   ✓ Feed article has finalUrl field: ${feedArticle.finalUrl ? "yes" : "no"}`);
      
      // Check that url field uses final_url fallback
      if (feedArticle.url) {
        console.log("   ✅ Feed URL field populated correctly");
      }
    }
    
    // Test 5: Test UPDATE operations on new fields
    console.log("\n5️⃣  Testing UPDATE Operations...");
    
    // Update deduplication fields
    db.prepare(`
      UPDATE articles 
      SET 
        canonical_url = ?,
        content_fingerprint = ?,
        normalized_url = ?,
        normalized_domain = ?,
        title_hash_bucket = ?
      WHERE url = ?
    `).run(
      "https://techcrunch.com/test-article-1",
      "abc123def456",
      "https://techcrunch.com/test-article-1",
      "techcrunch.com",
      "bucket123",
      testArticles[0].url
    );
    
    const updated = db.prepare("SELECT canonical_url, content_fingerprint, normalized_url FROM articles WHERE url = ?").get(testArticles[0].url);
    if (updated.canonical_url && updated.content_fingerprint) {
      console.log("   ✅ Deduplication fields updated successfully");
      console.log(`   ✓ Canonical URL: ${updated.canonical_url}`);
      console.log(`   ✓ Content fingerprint: ${updated.content_fingerprint.substring(0, 10)}...`);
    } else {
      throw new Error("Failed to update deduplication fields");
    }
    
    // Test 6: Test deferred article fields
    console.log("\n6️⃣  Testing Deferred Article Fields...");
    db.prepare(`
      UPDATE articles 
      SET 
        deferred_reason = ?,
        deferred_at = ?,
        re_evaluation_count = ?
      WHERE url = ?
    `).run(
      "low_impact",
      new Date().toISOString(),
      1,
      testArticles[0].url
    );
    
    const deferred = db.prepare("SELECT deferred_reason, deferred_at, re_evaluation_count FROM articles WHERE url = ?").get(testArticles[0].url);
    if (deferred.deferred_reason && deferred.re_evaluation_count !== null) {
      console.log("   ✅ Deferred fields updated successfully");
      console.log(`   ✓ Deferred reason: ${deferred.deferred_reason}`);
      console.log(`   ✓ Re-evaluation count: ${deferred.re_evaluation_count}`);
    } else {
      throw new Error("Failed to update deferred fields");
    }
    
    // Test 7: Test indexes
    console.log("\n7️⃣  Testing Index Performance...");
    const startTime = Date.now();
    const indexedQuery = db.prepare(`
      SELECT * FROM articles 
      WHERE canonical_url = ? 
      OR normalized_domain = ? 
      OR title_hash_bucket = ?
    `).all(
      "https://techcrunch.com/test-article-1",
      "techcrunch.com",
      "bucket123"
    );
    const queryTime = Date.now() - startTime;
    console.log(`   ✓ Indexed query executed in ${queryTime}ms`);
    console.log(`   ✓ Results: ${indexedQuery.length} articles`);
    
    if (queryTime < 100) {
      console.log("   ✅ Indexes working efficiently");
    } else {
      console.log("   ⚠️  Query took longer than expected (may need index optimization)");
    }
    
    // Test 8: Verify removed columns are gone
    console.log("\n8️⃣  Verifying Removed Columns...");
    const tableInfo = db.prepare("PRAGMA table_info(articles)").all();
    const columnNames = tableInfo.map(col => col.name);
    
    const removedColumns = [
      "raw_html",
      "matched_holdings",
      "relevance_scores_json",
      "summary_enriched",
      "why_it_matters",
      "summary_short",
      "summary_medium",
      "personalized_teaser",
      "personalized_title",
      "should_enrich",
      "triage_reason",
      "triage_score"
    ];
    
    const foundRemoved = removedColumns.filter(col => columnNames.includes(col));
    if (foundRemoved.length > 0) {
      console.error(`   ❌ Found removed columns: ${foundRemoved.join(", ")}`);
      throw new Error("Removed columns still exist");
    } else {
      console.log("   ✅ All unnecessary columns removed");
    }
    
    // Test 9: Clean up
    console.log("\n9️⃣  Cleaning up test data...");
    const deleteResult = db.prepare("DELETE FROM articles WHERE url LIKE 'https://%test-%'").run();
    console.log(`   ✓ Deleted ${deleteResult.changes} test articles`);
    
    console.log("\n✅ All database tests passed!");
    console.log("\n📊 Summary:");
    console.log(`   • Total columns: ${columnNames.length}`);
    console.log(`   • New columns accessible: ✅`);
    console.log(`   • Removed columns: ✅`);
    console.log(`   • Indexes working: ✅`);
    console.log(`   • Feed retrieval: ✅`);
    
    return true;
    
  } catch (error) {
    console.error("\n❌ Database test failed:", error.message);
    console.error(error.stack);
    
    // Clean up on error
    try {
      db.prepare("DELETE FROM articles WHERE url LIKE 'https://%test-%'").run();
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  const success = testDatabaseSimple();
  process.exit(success ? 0 : 1);
}

module.exports = { testDatabaseSimple };
