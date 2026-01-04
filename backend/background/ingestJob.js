/**
 * Ingest Job
 * Fetches news articles from external APIs and saves them to the database
 */

const {
  fetchNewsFromMultipleSources,
  fetchArticlesForHoldings,
  resetGNewsRateLimit,
  fetchFromCNBCRSS,
  fetchFromMarketWatchRSS,
  fetchFromCoinDeskRSS,
  fetchFromReutersRSS,
  fetchFromFinancialTimesRSS
} = require("../integrations/newsProviders");
const { getDatabase } = require("../data/db");

const DEFAULT_USER_ID = 1;

// Detect dev mode
const isDev = process.env.NODE_ENV !== 'production';

// Single-flight lock to prevent overlapping runs
let isRunning = false;

/**
 * Run the ingest job
 * Implements TWO-BUCKET ingestion:
 * 1. HOLDINGS BUCKET: Targeted news for user's specific tickers
 * 2. MACRO BUCKET: Broad financial/market news (always fetched)
 */
async function runIngest() {
  // Check if already running
  if (isRunning) {
    console.log("[Ingest Job] Skipped: already running");
    return 0;
  }

  // Acquire lock
  isRunning = true;
  console.log("[Ingest Job] Starting two-bucket ingestion...");
  
  // Reset GNews rate limit at start of each run
  resetGNewsRateLimit();
  
  try {
    const db = getDatabase();
    const holdings = db.prepare(`
      SELECT id, ticker, label, notes FROM holdings WHERE user_id = ?
    `).all(DEFAULT_USER_ID);

    const allArticles = [];
    
    // BUCKET 1: Holdings-specific news (targeted)
    if (holdings.length > 0) {
      console.log(`[Ingest Job] BUCKET 1: Fetching targeted news for ${holdings.length} holdings`);
      // Dev mode: use lower limits (2-3 per source)
      // MVP: Google RSS disabled due to redirect failures (85% failure rate)
      const holdingsSourceLimits = isDev
        ? { newsapi: 3, gnews: 2, googlerss: 0 }
        : { newsapi: 5, gnews: 5, googlerss: 0 };
      const holdingsArticles = await fetchArticlesForHoldings(holdings, {
        sourceLimits: holdingsSourceLimits,
      });
      allArticles.push(...holdingsArticles);
      console.log(`[Ingest Job] BUCKET 1: Fetched ${holdingsArticles.length} holdings-specific articles`);
    } else {
      console.log(`[Ingest Job] BUCKET 1: No holdings found, skipping targeted bucket`);
    }

    // BUCKET 2: Macro/market news (event-driven, always fetched)
    console.log(`[Ingest Job] BUCKET 2: Fetching event-driven macro/market news`);
    
    // Dev mode: use fewer macro queries (3-4 instead of 12)
    const allMacroQueries = [
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
    
    // In dev, use only first 3-4 queries to reduce load
    const macroQueries = isDev 
      ? allMacroQueries.slice(0, 3)
      : allMacroQueries;
    
    console.log(`[Ingest Job] BUCKET 2: Using ${macroQueries.length} macro queries${isDev ? ' (dev mode: reduced)' : ''}`);
    
    // Hard cap: max 100 total macro headlines per run (production), 30 in dev
    const MACRO_CAP = isDev ? 30 : 100;
    const articlesPerQuery = Math.ceil(MACRO_CAP / macroQueries.length);
    
    // Dev mode: lower per-source limits (2-3 instead of 10)
    // MVP: Google RSS disabled due to redirect failures (85% failure rate)
    const sourceLimitsPerQuery = isDev
      ? {
          newsapi: Math.min(articlesPerQuery, 3),
          gnews: Math.min(articlesPerQuery, 2),
          googlerss: 0
        }
      : {
          newsapi: Math.min(articlesPerQuery, 10),
          gnews: Math.min(articlesPerQuery, 10),
          googlerss: 0
        };
    
    console.log(`[Ingest Job] BUCKET 2: Source limits per query:`, sourceLimitsPerQuery);
    
    // Fetch from multiple macro topics (limit per topic to control cost)
    // Add delay between queries in dev mode to avoid rate limits
    const macroResults = [];
    for (let i = 0; i < macroQueries.length; i++) {
      const query = macroQueries[i];
      if (i > 0 && isDev) {
        // Add 1 second delay between queries in dev mode
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const articles = await fetchNewsFromMultipleSources(query, {
        category: "business",
        sourceLimits: sourceLimitsPerQuery,
        searchedBy: "MACRO", // Tag as macro news
      });
      macroResults.push(articles);
    }
    
    let macroArticles = macroResults.flat();
    
    // Enforce hard cap: take first 100 articles
    if (macroArticles.length > MACRO_CAP) {
      macroArticles = macroArticles.slice(0, MACRO_CAP);
      console.log(`[Ingest Job] BUCKET 2: Capped at ${MACRO_CAP} macro articles (had ${macroResults.flat().length})`);
    }
    
    allArticles.push(...macroArticles);
    console.log(`[Ingest Job] BUCKET 2: Fetched ${macroArticles.length} macro/market articles`);

    // BUCKET 3: Direct RSS Feeds (free sources with direct publisher URLs)
    console.log(`[Ingest Job] BUCKET 3: Fetching from direct RSS feeds (CNBC, MarketWatch, CoinDesk, Financial Times)`);

    const rssLimit = isDev ? 5 : 10; // Fetch 5 articles per feed in dev, 10 in prod
    const rssResults = await Promise.all([
      fetchFromCNBCRSS({ maxArticles: rssLimit }),
      fetchFromMarketWatchRSS({ maxArticles: rssLimit }),
      fetchFromCoinDeskRSS({ maxArticles: rssLimit }),
      // fetchFromReutersRSS({ maxArticles: rssLimit }), // Reuters RSS feeds are restricted/require auth
      fetchFromFinancialTimesRSS({ maxArticles: rssLimit })
    ]);

    const rssArticles = rssResults.flat().map(article => ({
      ...article,
      searched_by: "RSS", // Tag as RSS source
    }));

    allArticles.push(...rssArticles);
    console.log(`[Ingest Job] BUCKET 3: Fetched ${rssArticles.length} articles from direct RSS feeds`);

    // Deduplicate across all buckets
    const { deduplicateArticles } = require("../integrations/newsProviders");
    const uniqueArticles = deduplicateArticles(allArticles);
    
    console.log(`[Ingest Job] Complete: ${uniqueArticles.length} unique articles from ${allArticles.length} total (deduplicated)`);
    return uniqueArticles.length;
  } catch (error) {
    console.error("[Ingest Job] Error:", error.message);
    return 0;
  } finally {
    // Release lock
    isRunning = false;
  }
}

module.exports = { runIngest };


