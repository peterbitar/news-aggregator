/**
 * Ingest Job
 * Fetches news articles from external APIs and saves them to the database
 */

const { fetchNewsFromMultipleSources, fetchArticlesForHoldings } = require("../integrations/newsProviders");
const { getDatabase } = require("../data/db");

const DEFAULT_USER_ID = 1;

/**
 * Run the ingest job
 * Implements TWO-BUCKET ingestion:
 * 1. HOLDINGS BUCKET: Targeted news for user's specific tickers
 * 2. MACRO BUCKET: Broad financial/market news (always fetched)
 */
async function runIngest() {
  console.log("[Ingest Job] Starting two-bucket ingestion...");
  try {
    const db = getDatabase();
    const holdings = db.prepare(`
      SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?
    `).all(DEFAULT_USER_ID);

    const allArticles = [];
    
    // BUCKET 1: Holdings-specific news (targeted)
    if (holdings.length > 0) {
      console.log(`[Ingest Job] BUCKET 1: Fetching targeted news for ${holdings.length} holdings`);
      const holdingsArticles = await fetchArticlesForHoldings(holdings, {
        sourceLimits: { newsapi: 5, gnews: 5, googlerss: 5 }, // Smaller limits for targeted
      });
      allArticles.push(...holdingsArticles);
      console.log(`[Ingest Job] BUCKET 1: Fetched ${holdingsArticles.length} holdings-specific articles`);
    } else {
      console.log(`[Ingest Job] BUCKET 1: No holdings found, skipping targeted bucket`);
    }

    // BUCKET 2: Macro/market news (event-driven, always fetched)
    console.log(`[Ingest Job] BUCKET 2: Fetching event-driven macro/market news`);
    const macroQueries = [
      "CPI inflation surprise",
      "Federal Reserve rate decision",
      "bond yields spike",
      "recession indicator",
      "oil prices surge",
      "credit spreads widening",
      "bank stress",
      "geopolitical escalation markets",
      "USD rallies",
      "gold plunges",
      "unemployment claims",
      "housing market crash"
    ];
    
    // Hard cap: max 100 total macro headlines per run
    const MACRO_CAP = 100;
    const articlesPerQuery = Math.ceil(MACRO_CAP / macroQueries.length);
    const sourceLimitsPerQuery = {
      newsapi: Math.min(articlesPerQuery, 10),
      gnews: Math.min(articlesPerQuery, 10),
      googlerss: Math.min(articlesPerQuery, 10)
    };
    
    // Fetch from multiple macro topics (limit per topic to control cost)
    const macroPromises = macroQueries.map(query => 
      fetchNewsFromMultipleSources(query, {
        category: "business",
        sourceLimits: sourceLimitsPerQuery,
        searchedBy: "MACRO", // Tag as macro news
      })
    );
    
    const macroResults = await Promise.all(macroPromises);
    let macroArticles = macroResults.flat();
    
    // Enforce hard cap: take first 100 articles
    if (macroArticles.length > MACRO_CAP) {
      macroArticles = macroArticles.slice(0, MACRO_CAP);
      console.log(`[Ingest Job] BUCKET 2: Capped at ${MACRO_CAP} macro articles (had ${macroResults.flat().length})`);
    }
    
    allArticles.push(...macroArticles);
    console.log(`[Ingest Job] BUCKET 2: Fetched ${macroArticles.length} macro/market articles`);

    // Deduplicate across both buckets
    const { deduplicateArticles } = require("../integrations/newsProviders");
    const uniqueArticles = deduplicateArticles(allArticles);
    
    console.log(`[Ingest Job] Complete: ${uniqueArticles.length} unique articles from ${allArticles.length} total (deduplicated)`);
    return uniqueArticles.length;
  } catch (error) {
    console.error("[Ingest Job] Error:", error.message);
    return 0;
  }
}

module.exports = { runIngest };


