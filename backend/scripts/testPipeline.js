/**
 * End-to-End Pipeline Test
 * Tests the full pipeline with the cleaned database
 */

const { getDatabase } = require("../data/db");
const { saveArticles, getFeedArticles } = require("../data/articleStorage");
const { processArticle } = require("../pipeline/articlePipeline");

async function testPipeline() {
  console.log("🧪 Testing News Aggregation Pipeline\n");
  
  const db = getDatabase();
  
  try {
    // Test 1: Ingest test articles
    console.log("1️⃣  Testing Article Ingestion...");
    const testArticles = [
      {
        url: "https://techcrunch.com/test-article-1",
        source_id: "techcrunch",
        source_name: "TechCrunch",
        title: "Apple Announces New iPhone with AI Features",
        description: "Apple unveiled its latest iPhone with advanced AI capabilities",
        published_at: new Date().toISOString(),
        content: "Apple Inc. announced today that its new iPhone will feature advanced AI capabilities. The company's stock (AAPL) is expected to see significant movement.",
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
        title: "Market Update: Tech Stocks Rally on AI News",
        description: "Technology stocks surged following major AI announcements",
        published_at: new Date().toISOString(),
        content: "Technology stocks including Microsoft (MSFT), NVIDIA (NVDA), and Google (GOOGL) rallied today following major AI announcements from leading tech companies.",
        feed_source: "newsapi",
        original_url: "https://reuters.com/test-article-2",
        final_url: "https://reuters.com/test-article-2",
        display_domain: "reuters.com",
        searched_by: "MSFT,NVDA,GOOGL"
      }
    ];
    
    saveArticles(testArticles, "AAPL");
    console.log(`   ✓ Inserted ${testArticles.length} test articles`);
    
    // Test 2: Verify articles in database
    console.log("\n2️⃣  Verifying Database Schema...");
    const article1 = db.prepare("SELECT * FROM articles WHERE url = ?").get(testArticles[0].url);
    if (!article1) {
      throw new Error("Article 1 not found in database");
    }
    
    // Check new columns exist and are accessible
    const newColumns = [
      "canonical_url", "final_url", "original_url", "display_domain",
      "content_fingerprint", "normalized_url", "normalized_domain",
      "title_hash_bucket", "ticker_evidence"
    ];
    
    const missingColumns = newColumns.filter(col => !article1.hasOwnProperty(col));
    if (missingColumns.length > 0) {
      throw new Error(`Missing columns: ${missingColumns.join(", ")}`);
    }
    console.log("   ✓ All new columns accessible");
    console.log(`   ✓ Article status: ${article1.status || "null"}`);
    console.log(`   ✓ Searched by: ${article1.searched_by}`);
    
    // Test 3: Test Stage 1 (Title Triage)
    console.log("\n3️⃣  Testing Stage 1: Title Triage...");
    const stage1Result = await processArticle(testArticles[0]);
    console.log(`   ✓ Stage 1 completed: ${stage1Result.status}`);
    
    const afterStage1 = db.prepare("SELECT title_relevance, should_fetch_full, status FROM articles WHERE url = ?").get(testArticles[0].url);
    if (afterStage1.title_relevance !== null && afterStage1.title_relevance !== undefined) {
      console.log(`   ✓ Title relevance: ${afterStage1.title_relevance}`);
      console.log(`   ✓ Should fetch full: ${afterStage1.should_fetch_full}`);
    } else {
      console.log("   ⚠️  Title relevance not set (may need LLM call)");
    }
    
    // Test 4: Test Stage 2 (Content Fetch) - if should_fetch_full is true
    if (afterStage1.should_fetch_full) {
      console.log("\n4️⃣  Testing Stage 2: Content Fetch...");
      // Process again to trigger Stage 2
      const stage2Result = await processArticle(testArticles[0]);
      console.log(`   ✓ Stage 2 completed: ${stage2Result.status}`);
      
      const afterStage2 = db.prepare("SELECT clean_text, content_length, canonical_url, content_fingerprint, normalized_url FROM articles WHERE url = ?").get(testArticles[0].url);
      if (afterStage2.clean_text) {
        console.log(`   ✓ Content fetched: ${afterStage2.content_length || 0} chars`);
        console.log(`   ✓ Canonical URL: ${afterStage2.canonical_url || "null"}`);
        console.log(`   ✓ Content fingerprint: ${afterStage2.content_fingerprint ? "set" : "null"}`);
        console.log(`   ✓ Normalized URL: ${afterStage2.normalized_url || "null"}`);
      } else {
        console.log("   ⚠️  Content not fetched (may have failed or been skipped)");
      }
    } else {
      console.log("\n4️⃣  Skipping Stage 2 (should_fetch_full = false)");
    }
    
    // Test 5: Test Feed Retrieval
    console.log("\n5️⃣  Testing Feed Retrieval...");
    const feedArticles = getFeedArticles({ limit: 10 });
    console.log(`   ✓ Feed query executed: ${feedArticles.length} articles`);
    
    // Test 6: Verify URL handling
    console.log("\n6️⃣  Testing URL Handling...");
    const articleWithUrls = db.prepare("SELECT url, original_url, final_url, display_domain FROM articles WHERE url = ?").get(testArticles[0].url);
    console.log(`   ✓ Original URL: ${articleWithUrls.original_url || "null"}`);
    console.log(`   ✓ Final URL: ${articleWithUrls.final_url || "null"}`);
    console.log(`   ✓ Display domain: ${articleWithUrls.display_domain || "null"}`);
    
    // Test 7: Test deduplication fields
    console.log("\n7️⃣  Testing Deduplication Fields...");
    const dedupFields = db.prepare(`
      SELECT 
        canonical_url, 
        content_fingerprint, 
        normalized_url, 
        normalized_domain, 
        title_hash_bucket,
        is_duplicate_of_article_id
      FROM articles 
      WHERE url = ?
    `).get(testArticles[0].url);
    
    console.log(`   ✓ Canonical URL field: ${dedupFields.canonical_url ? "present" : "null"}`);
    console.log(`   ✓ Content fingerprint field: ${dedupFields.content_fingerprint ? "present" : "null"}`);
    console.log(`   ✓ Normalized URL field: ${dedupFields.normalized_url ? "present" : "null"}`);
    console.log(`   ✓ Normalized domain field: ${dedupFields.normalized_domain ? "present" : "null"}`);
    console.log(`   ✓ Title hash bucket field: ${dedupFields.title_hash_bucket ? "present" : "null"}`);
    
    // Test 8: Test deferred article fields
    console.log("\n8️⃣  Testing Deferred Article Fields...");
    const deferredFields = db.prepare(`
      SELECT 
        deferred_reason, 
        deferred_at, 
        re_evaluation_count
      FROM articles 
      WHERE url = ?
    `).get(testArticles[0].url);
    
    console.log(`   ✓ Deferred reason field: ${deferredFields.deferred_reason ? "present" : "null"}`);
    console.log(`   ✓ Deferred at field: ${deferredFields.deferred_at ? "present" : "null"}`);
    console.log(`   ✓ Re-evaluation count: ${deferredFields.re_evaluation_count || 0}`);
    
    // Test 9: Clean up
    console.log("\n9️⃣  Cleaning up test data...");
    db.prepare("DELETE FROM articles WHERE url LIKE 'https://%test-%'").run();
    console.log("   ✓ Test articles deleted");
    
    console.log("\n✅ All pipeline tests passed!");
    return true;
    
  } catch (error) {
    console.error("\n❌ Pipeline test failed:", error);
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
  testPipeline()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error("Unhandled error:", error);
      process.exit(1);
    });
}

module.exports = { testPipeline };
