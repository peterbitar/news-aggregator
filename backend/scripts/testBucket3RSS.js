/**
 * Test Bucket 3 RSS Feeds
 * Tests only the direct RSS feed sources to see what articles we get
 */

require('dotenv').config();

const {
  fetchFromCNBCRSS,
  fetchFromMarketWatchRSS,
  fetchFromCoinDeskRSS,
  fetchFromReutersRSS,
  fetchFromFinancialTimesRSS,
  deduplicateArticles
} = require("../integrations/newsProviders");

async function testBucket3() {
  console.log("🧪 Testing Bucket 3: Direct RSS Feeds\n");
  console.log("=" .repeat(80));

  const rssLimit = 10; // Fetch 10 articles per feed for testing

  console.log(`\n📡 Fetching from 5 RSS sources (${rssLimit} articles each)...\n`);

  try {
    const rssResults = await Promise.all([
      fetchFromCNBCRSS({ maxArticles: rssLimit }),
      fetchFromMarketWatchRSS({ maxArticles: rssLimit }),
      fetchFromCoinDeskRSS({ maxArticles: rssLimit }),
      fetchFromReutersRSS({ maxArticles: rssLimit }),
      fetchFromFinancialTimesRSS({ maxArticles: rssLimit })
    ]);

    // Show results from each source
    const [cnbcArticles, marketWatchArticles, coinDeskArticles, reutersArticles, ftArticles] = rssResults;

    console.log("=" .repeat(80));
    console.log("\n📊 RESULTS BY SOURCE:\n");
    console.log(`  CNBC: ${cnbcArticles.length} articles`);
    console.log(`  MarketWatch: ${marketWatchArticles.length} articles`);
    console.log(`  CoinDesk: ${coinDeskArticles.length} articles`);
    console.log(`  Reuters: ${reutersArticles.length} articles`);
    console.log(`  Financial Times: ${ftArticles.length} articles`);

    // Show sample articles from each source
    console.log("\n" + "=" .repeat(80));
    console.log("\n📰 SAMPLE ARTICLES:\n");

    showSampleArticles("CNBC", cnbcArticles, 5);
    showSampleArticles("MarketWatch", marketWatchArticles, 5);
    showSampleArticles("CoinDesk", coinDeskArticles, 5);
    showSampleArticles("Reuters", reutersArticles, 5);
    showSampleArticles("Financial Times", ftArticles, 5);

    // Deduplicate and show totals
    const allArticles = rssResults.flat();
    const uniqueArticles = deduplicateArticles(allArticles);

    console.log("\n" + "=" .repeat(80));
    console.log("\n📈 SUMMARY:\n");
    console.log(`  Total articles fetched: ${allArticles.length}`);
    console.log(`  Unique articles (after dedup): ${uniqueArticles.length}`);
    console.log(`  Duplicates removed: ${allArticles.length - uniqueArticles.length}`);

    console.log("\n✅ Test complete!");
    console.log("=" .repeat(80) + "\n");

  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error.stack);
  }
}

function showSampleArticles(sourceName, articles, limit) {
  console.log(`\n${sourceName} (showing ${Math.min(articles.length, limit)} of ${articles.length}):`);
  console.log("-".repeat(80));

  if (articles.length === 0) {
    console.log("  No articles found");
    return;
  }

  articles.slice(0, limit).forEach((article, idx) => {
    console.log(`\n  ${idx + 1}. ${article.title.substring(0, 70)}${article.title.length > 70 ? '...' : ''}`);
    console.log(`     URL: ${article.url.substring(0, 70)}${article.url.length > 70 ? '...' : ''}`);
    console.log(`     Published: ${new Date(article.publishedAt).toLocaleString()}`);
    if (article.description) {
      console.log(`     Description: ${article.description.substring(0, 100)}${article.description.length > 100 ? '...' : ''}`);
    }
  });
}

// Run if called directly
if (require.main === module) {
  testBucket3()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error("Unhandled error:", error);
      process.exit(1);
    });
}

module.exports = { testBucket3 };
