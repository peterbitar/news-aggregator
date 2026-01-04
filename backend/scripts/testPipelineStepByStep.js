/**
 * Step-by-Step Pipeline Test
 * Runs each step separately and shows detailed results
 */

require('dotenv').config();
const { getDatabase } = require("../data/db");
const { runIngest } = require("../background/ingestJob");
const { runProcess } = require("../background/processJob");
const { runRank } = require("../background/rankJob");
const { getFeedArticles } = require("../data/articleStorage");

function showStatusSummary() {
  const db = getDatabase();
  const counts = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count
    FROM articles
    GROUP BY status
    ORDER BY count DESC
  `).all();
  
  console.log("\n📊 Status Summary:");
  counts.forEach(row => {
    console.log(`   ${row.status || 'null'}: ${row.count}`);
  });
  
  const stats = {
    total: db.prepare("SELECT COUNT(*) as count FROM articles").get().count,
    withTitleRelevance: db.prepare("SELECT COUNT(*) as count FROM articles WHERE title_relevance IS NOT NULL").get().count,
    withContent: db.prepare("SELECT COUNT(*) as count FROM articles WHERE clean_text IS NOT NULL AND clean_text != ''").get().count,
    withImpactScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE impact_score IS NOT NULL").get().count,
    withProfileScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE profile_adjusted_score IS NOT NULL").get().count,
    withRankScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE final_rank_score IS NOT NULL").get().count,
    withDedupFields: db.prepare("SELECT COUNT(*) as count FROM articles WHERE (canonical_url IS NOT NULL OR content_fingerprint IS NOT NULL)").get().count,
  };
  
  console.log("\n📈 Pipeline Progress:");
  console.log(`   Total articles: ${stats.total}`);
  console.log(`   Stage 1 (Triage): ${stats.withTitleRelevance}`);
  console.log(`   Stage 2 (Fetch): ${stats.withContent}`);
  console.log(`   Stage 3 (Classify): ${stats.withImpactScore}`);
  console.log(`   Stage 4 (Personalize): ${stats.withProfileScore}`);
  console.log(`   Stage 5 (Rank): ${stats.withRankScore}`);
  console.log(`   With dedup fields: ${stats.withDedupFields}`);
}

function showSampleArticles(stage, limit = 5) {
  const db = getDatabase();
  let query;
  
  switch(stage) {
    case 'ingested':
      query = `SELECT url, title, source_name, searched_by, status FROM articles ORDER BY published_at DESC LIMIT ?`;
      break;
    case 'triage':
      query = `SELECT url, title, title_relevance, should_fetch_full, status FROM articles WHERE title_relevance IS NOT NULL ORDER BY published_at DESC LIMIT ?`;
      break;
    case 'fetched':
      query = `SELECT url, title, content_length, canonical_url, normalized_url, status FROM articles WHERE clean_text IS NOT NULL AND clean_text != '' ORDER BY content_fetched_at DESC LIMIT ?`;
      break;
    case 'classified':
      query = `SELECT url, title, impact_score, sentiment, matched_tickers, status FROM articles WHERE impact_score IS NOT NULL ORDER BY impact_score DESC LIMIT ?`;
      break;
    case 'personalized':
      query = `SELECT url, title, profile_adjusted_score, holding_relevance_score, status FROM articles WHERE profile_adjusted_score IS NOT NULL ORDER BY profile_adjusted_score DESC LIMIT ?`;
      break;
    case 'ranked':
      query = `SELECT url, title, final_rank_score, cluster_id, status FROM articles WHERE final_rank_score IS NOT NULL ORDER BY final_rank_score DESC LIMIT ?`;
      break;
    default:
      return;
  }
  
  const articles = db.prepare(query).all(limit);
  
  if (articles.length > 0) {
    console.log(`\n📰 Sample ${stage} articles (top ${articles.length}):`);
    articles.forEach((article, idx) => {
      console.log(`\n   ${idx + 1}. ${article.title.substring(0, 70)}${article.title.length > 70 ? '...' : ''}`);
      if (article.title_relevance !== null && article.title_relevance !== undefined) {
        console.log(`      Title Relevance: ${article.title_relevance}`);
      }
      if (article.should_fetch_full !== null && article.should_fetch_full !== undefined) {
        console.log(`      Should Fetch: ${article.should_fetch_full ? 'Yes' : 'No'}`);
      }
      if (article.content_length) {
        console.log(`      Content: ${article.content_length} chars`);
      }
      if (article.canonical_url) {
        console.log(`      Canonical: ${article.canonical_url.substring(0, 50)}...`);
      }
      if (article.impact_score !== null && article.impact_score !== undefined) {
        console.log(`      Impact: ${article.impact_score.toFixed(2)}`);
      }
      if (article.profile_adjusted_score !== null && article.profile_adjusted_score !== undefined) {
        console.log(`      Profile Score: ${article.profile_adjusted_score.toFixed(2)}`);
      }
      if (article.final_rank_score !== null && article.final_rank_score !== undefined) {
        console.log(`      Rank Score: ${article.final_rank_score.toFixed(2)}`);
      }
      if (article.matched_tickers) {
        try {
          const tickers = JSON.parse(article.matched_tickers);
          console.log(`      Tickers: ${tickers.join(', ')}`);
        } catch (e) {
          // ignore
        }
      }
      console.log(`      Status: ${article.status || 'null'}`);
    });
  }
}

async function runStepByStep() {
  console.log("🚀 Step-by-Step Pipeline Test\n");
  console.log("=".repeat(80));
  
  // Initial state
  console.log("\n📊 INITIAL STATE");
  showStatusSummary();
  
  // Step 1: Ingestion
  console.log("\n" + "=".repeat(80));
  console.log("STEP 1: INGESTION");
  console.log("=".repeat(80));
  
  try {
    console.log("\n⏳ Running ingestion...");
    const count = await runIngest();
    console.log(`\n✅ Ingestion complete: ${count} articles scraped`);
    
    showStatusSummary();
    showSampleArticles('ingested', 5);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.error(`\n❌ Ingestion failed:`, error.message);
  }
  
  // Step 2: Processing
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2: PROCESSING (Stages 1-4)");
  console.log("=".repeat(80));
  
  try {
    console.log("\n⏳ Running processing...");
    const count = await runProcess();
    console.log(`\n✅ Processing complete: ${count} articles processed`);
    
    showStatusSummary();
    showSampleArticles('triage', 3);
    showSampleArticles('fetched', 3);
    showSampleArticles('classified', 3);
    showSampleArticles('personalized', 3);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.error(`\n❌ Processing failed:`, error.message);
    console.error(error.stack);
  }
  
  // Step 3: Ranking
  console.log("\n" + "=".repeat(80));
  console.log("STEP 3: RANKING (Stage 5)");
  console.log("=".repeat(80));
  
  try {
    console.log("\n⏳ Running ranking...");
    const count = await runRank();
    console.log(`\n✅ Ranking complete: ${count} articles ranked`);
    
    showStatusSummary();
    showSampleArticles('ranked', 5);
  } catch (error) {
    console.error(`\n❌ Ranking failed:`, error.message);
    console.error(error.stack);
  }
  
  // Final summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(80));
  showStatusSummary();
  
  // Test feed
  console.log("\n📰 Feed Test:");
  const feed = getFeedArticles({ limit: 10, minScore: 0 });
  console.log(`   Feed articles: ${feed.length}`);
  if (feed.length > 0) {
    console.log(`   Top article: ${feed[0].title.substring(0, 60)}...`);
  }
  
  console.log("\n✅ Test complete!\n");
}

if (require.main === module) {
  runStepByStep()
    .then(() => process.exit(0))
    .catch(error => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

module.exports = { runStepByStep };
