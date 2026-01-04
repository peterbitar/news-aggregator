/**
 * Test Bucket 3 Only with Holdings-Specific & Macro News
 * Clears database and tests with only RSS feeds (Bucket 3)
 * Fetches both holdings-specific and macro news
 * Shows results grouped by holding/ticket
 */

require('dotenv').config();

const { cleanDatabase } = require("./cleanDatabase");
const { getDatabase, initDatabase } = require("../data/db");
const { runProcess } = require("../background/processJob");
const { runRank } = require("../background/rankJob");
const { getFeedArticles } = require("../data/articleStorage");
const {
  fetchFromCNBCRSS,
  fetchFromMarketWatchRSS,
  fetchFromCoinDeskRSS,
  fetchFromFinancialTimesRSS,
  deduplicateArticles
} = require("../integrations/newsProviders");

const DEFAULT_USER_ID = 1;
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Ingest only Bucket 3 (RSS feeds) with holdings-specific search
 */
async function ingestBucket3Only() {
  console.log("[Bucket3 Ingest] Starting Bucket 3 (RSS feeds) only ingestion...");

  const db = getDatabase();
  const allArticles = [];

  // Get holdings for targeted search
  const holdings = db.prepare(`
    SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?
  `).all(DEFAULT_USER_ID);

  if (holdings.length === 0) {
    console.log("[Bucket3 Ingest] No holdings found, cannot proceed with holdings-specific search");
    return 0;
  }

  console.log(`[Bucket3 Ingest] Found ${holdings.length} holdings to search for`);
  console.log(`[Bucket3 Ingest] Tickers: ${holdings.map(h => h.ticker).join(', ')}`);

  // Step 1: Fetch RSS feeds for each holding
  console.log(`\n[Bucket3 Ingest] STEP 1: Fetching RSS feeds for holdings...`);

  const rssLimit = isDev ? 20 : 50; // Higher limit for bucket3-only test

  console.log(`[Bucket3 Ingest] Fetching ${rssLimit} articles per RSS source...\n`);

  try {
    const [cnbcArticles, marketWatchArticles, coinDeskArticles, ftArticles] = await Promise.all([
      fetchFromCNBCRSS({ maxArticles: rssLimit }),
      fetchFromMarketWatchRSS({ maxArticles: rssLimit }),
      fetchFromCoinDeskRSS({ maxArticles: rssLimit }),
      fetchFromFinancialTimesRSS({ maxArticles: rssLimit })
    ]);

    console.log(`  CNBC RSS: ${cnbcArticles.length} articles`);
    console.log(`  MarketWatch RSS: ${marketWatchArticles.length} articles`);
    console.log(`  CoinDesk RSS: ${coinDeskArticles.length} articles`);
    console.log(`  Financial Times RSS: ${ftArticles.length} articles`);

    const rssArticles = [cnbcArticles, marketWatchArticles, coinDeskArticles, ftArticles]
      .flat()
      .map(article => ({
        ...article,
        searched_by: "RSS_BUCKET3", // Tag as Bucket 3
      }));

    allArticles.push(...rssArticles);
    console.log(`\n[Bucket3 Ingest] Total RSS articles: ${rssArticles.length}`);

    // Step 2: Search for macro/market topics in RSS (to get both holdings & macro from RSS)
    console.log(`\n[Bucket3 Ingest] STEP 2: Fetching macro topics from RSS (if available)...\n`);

    // Note: RSS feeds are current/recent news, so they naturally contain both
    // holdings-specific and macro news. We're not doing separate searches here,
    // just tagging them properly for the pipeline.

    console.log(`[Bucket3 Ingest] Total articles before dedup: ${allArticles.length}`);

    // Deduplicate
    const uniqueArticles = deduplicateArticles(allArticles);
    console.log(`[Bucket3 Ingest] Unique articles after dedup: ${uniqueArticles.length}`);

    // Save to database (the saveArticles function handles this)
    const { saveArticles } = require("../data/articleStorage");
    await saveArticles(uniqueArticles);

    console.log(`[Bucket3 Ingest] ✅ Saved ${uniqueArticles.length} articles to database`);
    return uniqueArticles.length;

  } catch (error) {
    console.error("[Bucket3 Ingest] Error:", error.message);
    throw error;
  }
}

/**
 * Show articles by holding/ticker
 */
function showArticlesByHolding(stageName, stageCheck) {
  const db = getDatabase();
  const holdings = db.prepare(`
    SELECT id, ticker, label FROM holdings WHERE user_id = ?
  `).all(DEFAULT_USER_ID);

  console.log(`\n${"=".repeat(80)}`);
  console.log(`RESULTS BY HOLDING: ${stageName}`);
  console.log("=".repeat(80));

  holdings.forEach(holding => {
    // Find articles matching this holding's ticker
    const articles = db.prepare(`
      SELECT
        url,
        title,
        matched_tickers,
        ${stageCheck.scoreField ? stageCheck.scoreField + ',' : ''}
        source_name,
        published_at
      FROM articles
      WHERE matched_tickers LIKE ?
      ${stageCheck.whereClause || ''}
      ORDER BY ${stageCheck.orderBy || 'published_at'} DESC
      LIMIT 10
    `).all(`%"${holding.ticker}"%`);

    if (articles.length > 0) {
      console.log(`\n📌 ${holding.label} (${holding.ticker}): ${articles.length} articles`);
      console.log("-".repeat(80));

      articles.forEach((article, idx) => {
        console.log(`\n  ${idx + 1}. ${article.title.substring(0, 65)}${article.title.length > 65 ? '...' : ''}`);
        console.log(`     URL: ${article.url.substring(0, 70)}${article.url.length > 70 ? '...' : ''}`);
        console.log(`     Source: ${article.source_name || 'Unknown'}`);
        console.log(`     Published: ${new Date(article.published_at).toLocaleString()}`);

        if (stageCheck.scoreField && article[stageCheck.scoreField]) {
          console.log(`     ${stageCheck.scoreLabel}: ${(article[stageCheck.scoreField]).toFixed(2)}`);
        }

        if (article.matched_tickers) {
          const tickers = JSON.parse(article.matched_tickers);
          console.log(`     Tickers: ${tickers.join(', ')}`);
        }
      });
    } else {
      console.log(`\n📌 ${holding.label} (${holding.ticker}): No articles found`);
    }
  });
}

/**
 * Show overall statistics
 */
function showStats(label) {
  const db = getDatabase();

  const stats = {
    total: db.prepare("SELECT COUNT(*) as count FROM articles").get().count,
    withTitleRelevance: db.prepare("SELECT COUNT(*) as count FROM articles WHERE title_relevance IS NOT NULL").get().count,
    withContent: db.prepare("SELECT COUNT(*) as count FROM articles WHERE clean_text IS NOT NULL AND clean_text != ''").get().count,
    withImpactScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE impact_score IS NOT NULL").get().count,
    withProfileScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE profile_adjusted_score IS NOT NULL").get().count,
    withRankScore: db.prepare("SELECT COUNT(*) as count FROM articles WHERE final_rank_score IS NOT NULL").get().count,
  };

  console.log(`\n📊 ${label}:`);
  console.log(`   Total articles: ${stats.total}`);
  console.log(`   With title relevance: ${stats.withTitleRelevance}`);
  console.log(`   With content: ${stats.withContent}`);
  console.log(`   With impact score: ${stats.withImpactScore}`);
  console.log(`   With profile score: ${stats.withProfileScore}`);
  console.log(`   With rank score: ${stats.withRankScore}`);
}

/**
 * Main test function
 */
async function runBucket3Test() {
  console.log("🧪 BUCKET 3 ONLY TEST: Holdings-Specific & Macro News from RSS Feeds\n");
  console.log("=".repeat(80));

  try {
    // Step 0: Clean Database
    console.log("\n🗑️  STEP 0: CLEANING DATABASE");
    console.log("=".repeat(80));
    cleanDatabase();
    console.log("✅ Database cleaned");

    // Step 1: Ingest Bucket 3 Only
    console.log("\n" + "=".repeat(80));
    console.log("🚀 STEP 1: INGESTION (Bucket 3 RSS Feeds Only)");
    console.log("=".repeat(80));

    const ingestedCount = await ingestBucket3Only();
    console.log(`\n✅ Ingestion complete: ${ingestedCount} articles`);

    showStats("After Ingestion");
    showArticlesByHolding("After Ingestion", {
      orderBy: 'published_at',
      scoreField: null
    });

    // Step 2: Processing (Stages 1-4)
    console.log("\n" + "=".repeat(80));
    console.log("⚙️  STEP 2: PROCESSING (Stages 1-4)");
    console.log("=".repeat(80));

    const processedCount = await runProcess();
    console.log(`\n✅ Processing complete: ${processedCount} articles processed`);

    showStats("After Processing");
    showArticlesByHolding("After Processing (Profile Score)", {
      orderBy: 'profile_adjusted_score DESC',
      scoreField: 'profile_adjusted_score',
      scoreLabel: 'Profile Score',
      whereClause: 'AND profile_adjusted_score IS NOT NULL'
    });

    // Step 3: Ranking (Stage 5)
    console.log("\n" + "=".repeat(80));
    console.log("🏆 STEP 3: RANKING (Stage 5)");
    console.log("=".repeat(80));

    const rankedCount = await runRank();
    console.log(`\n✅ Ranking complete: ${rankedCount} articles ranked`);

    showStats("After Ranking");
    showArticlesByHolding("After Ranking (Final Score)", {
      orderBy: 'final_rank_score DESC',
      scoreField: 'final_rank_score',
      scoreLabel: 'Final Rank Score',
      whereClause: 'AND final_rank_score IS NOT NULL'
    });

    // Final Summary
    console.log("\n" + "=".repeat(80));
    console.log("📋 FINAL SUMMARY: Bucket 3 Only Test Complete");
    console.log("=".repeat(80));

    const db = getDatabase();
    const finalStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN final_rank_score IS NOT NULL THEN 1 ELSE 0 END) as ranked,
        SUM(CASE WHEN holding_relevance_score > 0 THEN 1 ELSE 0 END) as with_holding_match
      FROM articles
    `).get();

    console.log(`\n📈 Pipeline Results:`);
    console.log(`   Total articles ingested: ${finalStats.total}`);
    console.log(`   Articles ranked: ${finalStats.ranked}`);
    console.log(`   Articles matching holdings: ${finalStats.with_holding_match}`);

    // Show top articles per holding by final rank score
    console.log(`\n🏅 TOP ARTICLES BY HOLDING (Final Rank Score):`);
    const holdings = db.prepare(`
      SELECT id, ticker, label FROM holdings WHERE user_id = ?
    `).all(DEFAULT_USER_ID);

    holdings.forEach(holding => {
      const topArticles = db.prepare(`
        SELECT
          title,
          final_rank_score,
          holding_relevance_score,
          profile_adjusted_score
        FROM articles
        WHERE matched_tickers LIKE ?
        AND final_rank_score IS NOT NULL
        ORDER BY final_rank_score DESC
        LIMIT 3
      `).all(`%"${holding.ticker}"%`);

      if (topArticles.length > 0) {
        console.log(`\n  ${holding.label} (${holding.ticker}):`);
        topArticles.forEach((article, idx) => {
          console.log(`    ${idx + 1}. ${article.title.substring(0, 70)}...`);
          console.log(`       Rank: ${article.final_rank_score.toFixed(2)} | Holding: ${article.holding_relevance_score.toFixed(2)} | Profile: ${article.profile_adjusted_score.toFixed(2)}`);
        });
      }
    });

    console.log("\n✅ Test complete!");
    console.log("=".repeat(80) + "\n");

  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runBucket3Test()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error("Unhandled error:", error);
      process.exit(1);
    });
}

module.exports = { runBucket3Test, ingestBucket3Only };
