/**
 * Full Pipeline Test
 * Runs the complete scraping and processing pipeline end-to-end
 * Shows results at each step
 */

// Load environment variables
require('dotenv').config();

const { runIngest } = require("../background/ingestJob");
const { runProcess } = require("../background/processJob");
const { runRank } = require("../background/rankJob");
const { getDatabase } = require("../data/db");
const { getFeedArticles } = require("../data/articleStorage");

function getStatusCounts() {
  const db = getDatabase();
  const counts = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count
    FROM articles
    GROUP BY status
    ORDER BY count DESC
  `).all();
  
  return counts.reduce((acc, row) => {
    acc[row.status || 'null'] = row.count;
    return acc;
  }, {});
}

function getStageStats() {
  const db = getDatabase();
  
  const stats = {
    total: db.prepare("SELECT COUNT(*) as count FROM articles").get().count,
    withTitleRelevance: db.prepare("SELECT COUNT(*) as count FROM articles WHERE title_relevance IS NOT NULL").get().count,
    withContent: db.prepare("SELECT COUNT(*) as count FROM articles WHERE clean_text IS NOT NULL AND clean_text != ''").get().count,
    withImpactScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE impact_score IS NOT NULL").get().count,
    withProfileScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE profile_adjusted_score IS NOT NULL").get().count,
    withRankScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE final_rank_score IS NOT NULL").get().count,
    withDedupFields: db.prepare("SELECT COUNT(*) as count FROM articles WHERE canonical_url IS NOT NULL OR content_fingerprint IS NOT NULL").get().count,
    deferred: db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'deferred_low'").get().count,
  };
  
  return stats;
}

function showArticleSamples(stage, limit = 3) {
  const db = getDatabase();
  let query, title;
  
  switch(stage) {
    case 'ingested':
      query = `
        SELECT url, title, source_name, searched_by, status, published_at
        FROM articles
        WHERE status IS NULL OR status = '' OR status = 'pending'
        ORDER BY published_at DESC
        LIMIT ?
      `;
      title = "📰 Recently Ingested Articles";
      break;
    case 'triage':
      query = `
        SELECT url, title, title_relevance, should_fetch_full, status, source_name
        FROM articles
        WHERE title_relevance IS NOT NULL
        ORDER BY published_at DESC
        LIMIT ?
      `;
      title = "🔍 Stage 1: Title Triage Results";
      break;
    case 'fetched':
      query = `
        SELECT url, title, content_length, canonical_url, normalized_url, status
        FROM articles
        WHERE clean_text IS NOT NULL AND clean_text != ''
        ORDER BY content_fetched_at DESC
        LIMIT ?
      `;
      title = "📥 Stage 2: Content Fetch Results";
      break;
    case 'classified':
      query = `
        SELECT url, title, impact_score, sentiment, matched_tickers, status
        FROM articles
        WHERE impact_score IS NOT NULL
        ORDER BY impact_score DESC
        LIMIT ?
      `;
      title = "🤖 Stage 3: Content Classification Results";
      break;
    case 'personalized':
      query = `
        SELECT url, title, profile_adjusted_score, holding_relevance_score, status
        FROM articles
        WHERE profile_adjusted_score IS NOT NULL
        ORDER BY profile_adjusted_score DESC
        LIMIT ?
      `;
      title = "⭐ Stage 4: Personalization Results";
      break;
    case 'ranked':
      query = `
        SELECT url, title, final_rank_score, cluster_id, is_primary_in_cluster, status
        FROM articles
        WHERE final_rank_score IS NOT NULL
        ORDER BY final_rank_score DESC
        LIMIT ?
      `;
      title = "🏆 Stage 5: Ranking & Clustering Results";
      break;
    default:
      return;
  }
  
  const articles = db.prepare(query).all(limit);
  
  if (articles.length > 0) {
    console.log(`\n${title}:`);
    articles.forEach((article, idx) => {
      console.log(`\n  ${idx + 1}. ${article.title.substring(0, 60)}${article.title.length > 60 ? '...' : ''}`);
      console.log(`     URL: ${article.url.substring(0, 70)}${article.url.length > 70 ? '...' : ''}`);
      
      if (article.title_relevance !== null && article.title_relevance !== undefined) {
        console.log(`     Title Relevance: ${article.title_relevance}`);
      }
      if (article.should_fetch_full !== null && article.should_fetch_full !== undefined) {
        console.log(`     Should Fetch: ${article.should_fetch_full ? 'Yes' : 'No'}`);
      }
      if (article.content_length !== null && article.content_length !== undefined) {
        console.log(`     Content Length: ${article.content_length} chars`);
      }
      if (article.canonical_url) {
        console.log(`     Canonical URL: ${article.canonical_url.substring(0, 60)}...`);
      }
      if (article.normalized_url) {
        console.log(`     Normalized URL: ${article.normalized_url.substring(0, 60)}...`);
      }
      if (article.impact_score !== null && article.impact_score !== undefined) {
        console.log(`     Impact Score: ${article.impact_score.toFixed(2)}`);
      }
      if (article.sentiment !== null && article.sentiment !== undefined) {
        console.log(`     Sentiment: ${article.sentiment.toFixed(2)}`);
      }
      if (article.matched_tickers) {
        const tickers = JSON.parse(article.matched_tickers);
        console.log(`     Matched Tickers: ${tickers.join(', ')}`);
      }
      if (article.profile_adjusted_score !== null && article.profile_adjusted_score !== undefined) {
        console.log(`     Profile Score: ${article.profile_adjusted_score.toFixed(2)}`);
      }
      if (article.holding_relevance_score !== null && article.holding_relevance_score !== undefined) {
        console.log(`     Holding Relevance: ${article.holding_relevance_score.toFixed(2)}`);
      }
      if (article.final_rank_score !== null && article.final_rank_score !== undefined) {
        console.log(`     Final Rank Score: ${article.final_rank_score.toFixed(2)}`);
      }
      if (article.cluster_id) {
        console.log(`     Cluster ID: ${article.cluster_id}`);
      }
      if (article.is_primary_in_cluster) {
        console.log(`     Primary in Cluster: ${article.is_primary_in_cluster ? 'Yes' : 'No'}`);
      }
      console.log(`     Status: ${article.status || 'null'}`);
      console.log(`     Source: ${article.source_name || 'N/A'}`);
    });
  } else {
    console.log(`\n${title}: No articles found`);
  }
}

async function runFullPipeline() {
  console.log("🚀 Starting Full Pipeline Test\n");
  console.log("=" .repeat(80));
  
  const db = getDatabase();
  
  // Initial state
  console.log("\n📊 INITIAL STATE");
  const initialStats = getStageStats();
  const initialStatusCounts = getStatusCounts();
  console.log(`   Total articles: ${initialStats.total}`);
  console.log(`   Status breakdown:`, initialStatusCounts);
  
  // Step 1: Ingestion
  console.log("\n" + "=".repeat(80));
  console.log("STEP 1: INGESTION (Scraping Articles)");
  console.log("=".repeat(80));
  
  try {
    const ingestedCount = await runIngest();
    console.log(`\n✅ Ingestion complete: ${ingestedCount} articles scraped`);
    
    // Show results
    const afterIngestStats = getStageStats();
    const afterIngestStatusCounts = getStatusCounts();
    console.log(`\n📊 After Ingestion:`);
    console.log(`   Total articles: ${afterIngestStats.total}`);
    console.log(`   New articles: ${afterIngestStats.total - initialStats.total}`);
    console.log(`   Status breakdown:`, afterIngestStatusCounts);
    
    showArticleSamples('ingested', 5);
    
    // Wait a bit for database to settle
    await new Promise(resolve => setTimeout(resolve, 1000));
    
  } catch (error) {
    console.error(`\n❌ Ingestion failed:`, error.message);
    console.error(error.stack);
    return;
  }
  
  // Step 2: Processing (Stages 1-4)
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2: PROCESSING (Stages 1-4: Triage → Fetch → Classify → Personalize)");
  console.log("=".repeat(80));
  
  try {
    const processedCount = await runProcess();
    console.log(`\n✅ Processing complete: ${processedCount} articles processed`);
    
    // Show results
    const afterProcessStats = getStageStats();
    const afterProcessStatusCounts = getStatusCounts();
    console.log(`\n📊 After Processing:`);
    console.log(`   Total articles: ${afterProcessStats.total}`);
    console.log(`   With title relevance: ${afterProcessStats.withTitleRelevance}`);
    console.log(`   With content fetched: ${afterProcessStats.withContent}`);
    console.log(`   With impact score: ${afterProcessStats.withImpactScore}`);
    console.log(`   With profile score: ${afterProcessStats.withProfileScore}`);
    console.log(`   With dedup fields: ${afterProcessStats.withDedupFields}`);
    console.log(`   Deferred articles: ${afterProcessStats.deferred}`);
    console.log(`   Status breakdown:`, afterProcessStatusCounts);
    
    // Show samples from each stage
    showArticleSamples('triage', 3);
    showArticleSamples('fetched', 3);
    showArticleSamples('classified', 3);
    showArticleSamples('personalized', 3);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1000));
    
  } catch (error) {
    console.error(`\n❌ Processing failed:`, error.message);
    console.error(error.stack);
    return;
  }
  
  // Step 3: Ranking (Stage 5)
  console.log("\n" + "=".repeat(80));
  console.log("STEP 3: RANKING (Stage 5: Ranking & Clustering)");
  console.log("=".repeat(80));
  
  try {
    const rankedCount = await runRank();
    console.log(`\n✅ Ranking complete: ${rankedCount} articles ranked`);
    
    // Show results
    const afterRankStats = getStageStats();
    const afterRankStatusCounts = getStatusCounts();
    console.log(`\n📊 After Ranking:`);
    console.log(`   Total articles: ${afterRankStats.total}`);
    console.log(`   With rank score: ${afterRankStats.withRankScore}`);
    console.log(`   Status breakdown:`, afterRankStatusCounts);
    
    showArticleSamples('ranked', 5);
    
  } catch (error) {
    console.error(`\n❌ Ranking failed:`, error.message);
    console.error(error.stack);
    return;
  }
  
  // Final Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(80));
  
  const finalStats = getStageStats();
  const finalStatusCounts = getStatusCounts();
  
  console.log(`\n📈 Pipeline Statistics:`);
  console.log(`   Total articles: ${finalStats.total}`);
  console.log(`   Stage 1 (Triage): ${finalStats.withTitleRelevance} articles`);
  console.log(`   Stage 2 (Fetch): ${finalStats.withContent} articles`);
  console.log(`   Stage 3 (Classify): ${finalStats.withImpactScore} articles`);
  console.log(`   Stage 4 (Personalize): ${finalStats.withProfileScore} articles`);
  console.log(`   Stage 5 (Rank): ${finalStats.withRankScore} articles`);
  console.log(`   Deferred: ${finalStats.deferred} articles`);
  console.log(`   With dedup fields: ${finalStats.withDedupFields} articles`);
  
  console.log(`\n📋 Status Breakdown:`);
  Object.entries(finalStatusCounts).forEach(([status, count]) => {
    console.log(`   ${status || 'null'}: ${count}`);
  });
  
  // Test feed retrieval
  console.log(`\n📰 Feed Retrieval Test:`);
  const feedArticles = getFeedArticles({ limit: 10, minScore: 0 });
  console.log(`   Feed articles available: ${feedArticles.length}`);
  if (feedArticles.length > 0) {
    console.log(`   Top article: ${feedArticles[0].title.substring(0, 60)}...`);
    console.log(`   Top article score: ${feedArticles[0].finalRankScore || feedArticles[0].profileAdjustedScore || 'N/A'}`);
  }
  
  console.log("\n✅ Full pipeline test complete!");
  console.log("=".repeat(80) + "\n");
}

// Run if called directly
if (require.main === module) {
  runFullPipeline()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error("Unhandled error:", error);
      process.exit(1);
    });
}

module.exports = { runFullPipeline };
