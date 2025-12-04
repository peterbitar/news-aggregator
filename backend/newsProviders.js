const axios = require("axios");
const { saveArticles, getExistingArticleUrls } = require("./articleStorage");

/**
 * Transform GNews article to standard Article format
 */
function transformGNewsArticle(gnewsArticle) {
  return {
    source: {
      id: null,
      name: gnewsArticle.source?.name || "Unknown",
    },
    author: null,
    title: gnewsArticle.title || "",
    description: gnewsArticle.description || null,
    url: gnewsArticle.url || "",
    urlToImage: gnewsArticle.image || null,
    publishedAt: gnewsArticle.publishedAt || new Date().toISOString(),
    content: gnewsArticle.content || null,
    feedSource: "gnews", // Tag articles from GNews
  };
}

/**
 * Transform NewsAPI article to standard Article format (already in correct format, but ensure consistency)
 */
function transformNewsAPIArticle(newsapiArticle) {
  return {
    source: {
      id: newsapiArticle.source?.id || null,
      name: newsapiArticle.source?.name || "Unknown",
    },
    author: newsapiArticle.author || null,
    title: newsapiArticle.title || "",
    description: newsapiArticle.description || null,
    url: newsapiArticle.url || "",
    urlToImage: newsapiArticle.urlToImage || null,
    publishedAt: newsapiArticle.publishedAt || new Date().toISOString(),
    content: newsapiArticle.content || null,
    feedSource: "newsapi", // Tag articles from NewsAPI
  };
}

/**
 * Fetch news from GNews.io
 */
async function fetchFromGNews(query, options = {}) {
  const { category, page = 1, from, to, maxArticles = 10 } = options;
  const API_KEY = process.env.GNEWS_API_KEY;
  
  console.log(`[GNews] Fetching articles - query: "${query}", category: ${category}, page: ${page}`);

  if (!API_KEY) {
    console.warn("GNEWS_API_KEY not configured, skipping GNews");
    return [];
  }

  try {
    // Build query string
    let searchQuery = query || "";
    if (category && !searchQuery) {
      searchQuery = category;
    }
    if (!searchQuery) {
      searchQuery = "finance business";
    }

    // Build URL
    let url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(searchQuery)}&token=${API_KEY}&lang=en&max=${maxArticles}`;

    // Add date filters if provided
    if (from) {
      url += `&from=${from}`;
    }
    if (to) {
      url += `&to=${to}`;
    }

    // Add page parameter (GNews uses offset/limit)
    const limit = 10;
    const offset = (page - 1) * limit;
    if (offset > 0) {
      url += `&page=${page}`;
    }

    console.log(`[GNews] Making API call to: ${url.replace(API_KEY, '***')}`);
    const response = await axios.get(url, {
      timeout: 10000,
    });

    if (response.data && response.data.articles) {
      const articles = response.data.articles.map(transformGNewsArticle);
      console.log(`[GNews] API returned ${articles.length} articles`);
      return articles;
    }

    console.log(`[GNews] No articles in response`);
    return [];
  } catch (error) {
    console.error("Error fetching from GNews:", error.response?.data || error.message);
    return [];
  }
}

/**
 * Fetch news from NewsAPI.org
 */
async function fetchFromNewsAPI(query, options = {}) {
  const { category, page = 1, from, to, sortBy = "publishedAt", maxArticles = 10 } = options;
  const API_KEY = process.env.NEWS_API_KEY;
  
  console.log(`[NewsAPI] Fetching articles - query: "${query}", category: ${category}, page: ${page}, maxArticles: ${maxArticles}`);

  if (!API_KEY) {
    console.warn("NEWS_API_KEY not configured, skipping NewsAPI");
    return [];
  }

  try {
    let url = "";
    const pageNum = page || 1;
    const pageSize = maxArticles || 10; // Limit to 10 articles per request

    // If date filters are provided, use /everything endpoint
    if (from || to || query) {
      let searchQuery = query || "";
      
      if (!searchQuery && category) {
        searchQuery = category;
      } else if (!searchQuery && !category) {
        searchQuery = "finance OR business OR stocks OR markets";
      }
      
      url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&page=${pageNum}&pageSize=${pageSize}&sortBy=${sortBy}&apiKey=${API_KEY}`;
      
      if (from) {
        url += `&from=${from}`;
      }
      if (to) {
        url += `&to=${to}`;
      }
      
      url += "&language=en";
    } else {
      // Use top-headlines for category-only queries
      url = `https://newsapi.org/v2/top-headlines?category=${category || "business"}&country=us&page=${pageNum}&pageSize=${pageSize}&apiKey=${API_KEY}`;
    }

    console.log(`[NewsAPI] Making API call to: ${url.replace(API_KEY, '***')}`);
    const response = await axios.get(url, {
      timeout: 10000,
    });

    if (response.data && response.data.articles) {
      const articles = response.data.articles.map(transformNewsAPIArticle);
      // Limit to maxArticles (in case API returns more)
      const limitedArticles = articles.slice(0, pageSize);
      console.log(`[NewsAPI] API returned ${articles.length} articles, limited to ${limitedArticles.length}`);
      if (limitedArticles.length > 0) {
        console.log(`[NewsAPI] Sample URLs: ${limitedArticles.slice(0, 3).map(a => a.url).join(', ')}`);
      }
      return limitedArticles;
    }

    console.log(`[NewsAPI] No articles in response, response data:`, response.data);
    return [];
  } catch (error) {
    console.error("Error fetching from NewsAPI:", error.response?.data || error.message);
    return [];
  }
}

/**
 * Deduplicate articles by URL
 */
function deduplicateArticles(articles) {
  const seen = new Set();
  const unique = [];

  for (const article of articles) {
    if (article.url && !seen.has(article.url)) {
      seen.add(article.url);
      unique.push(article);
    }
  }

  return unique;
}

/**
 * Deduplicate articles by URL, preserving search context
 * If an article appears multiple times (found by different tickers), combine the search contexts
 */
function deduplicateArticlesWithSearchContext(articles) {
  const articleMap = new Map();
  
  for (const article of articles) {
    const url = article.url;
    if (!url) continue;
    
    if (articleMap.has(url)) {
      // Article already seen - merge search contexts
      const existing = articleMap.get(url);
      const existingSearchedBy = existing.searchedBy || "";
      const newSearchedBy = article.searchedBy || "";
      
      // Combine searched_by values (comma-separated if different)
      if (newSearchedBy && !existingSearchedBy.includes(newSearchedBy)) {
        existing.searchedBy = existingSearchedBy 
          ? `${existingSearchedBy},${newSearchedBy}`
          : newSearchedBy;
      }
    } else {
      articleMap.set(url, { ...article });
    }
  }
  
  return Array.from(articleMap.values());
}

/**
 * Deduplicate articles by URL, preserving search context
 * If an article appears multiple times (found by different tickers), combine the search contexts
 */
function deduplicateArticlesWithSearchContext(articles) {
  const articleMap = new Map();
  
  for (const article of articles) {
    const url = article.url;
    if (!url) continue;
    
    if (articleMap.has(url)) {
      // Article already seen - merge search contexts
      const existing = articleMap.get(url);
      const existingSearchedBy = existing.searchedBy || "";
      const newSearchedBy = article.searchedBy || "";
      
      // Combine searched_by values (comma-separated if different)
      if (newSearchedBy && !existingSearchedBy.includes(newSearchedBy)) {
        existing.searchedBy = existingSearchedBy 
          ? `${existingSearchedBy},${newSearchedBy}`
          : newSearchedBy;
      }
    } else {
      articleMap.set(url, { ...article });
    }
  }
  
  return Array.from(articleMap.values());
}

/**
 * Sort articles by published date (newest first)
 */
function sortArticlesByDate(articles) {
  return articles.sort((a, b) => {
    const dateA = new Date(a.publishedAt);
    const dateB = new Date(b.publishedAt);
    return dateB - dateA;
  });
}

/**
 * Fetch news from multiple providers and merge results
 * @param {string} query - Search query
 * @param {object} options - Options including category, page, from, to, sortBy, sources, searchedBy
 * @param {string[]} options.sources - Array of source names to fetch from: ['newsapi', 'gnews'] or null for all
 * @param {string} options.searchedBy - Optional: ticker/keyword that was used to find these articles
 */
async function fetchNewsFromMultipleSources(query, options = {}) {
  const { category, page, from, to, sortBy, sources, searchedBy } = options;

  // Determine which sources to fetch from
  const fetchGNews = !sources || sources.includes('gnews');
  const fetchNewsAPI = !sources || sources.includes('newsapi');

  // Fetch from enabled sources in parallel
  const fetchPromises = [];
  
  if (fetchGNews) {
    fetchPromises.push(fetchFromGNews(query, { category, page, from, to }));
  } else {
    fetchPromises.push(Promise.resolve([]));
  }
  
  if (fetchNewsAPI) {
    fetchPromises.push(fetchFromNewsAPI(query, { category, page, from, to, sortBy }));
  } else {
    fetchPromises.push(Promise.resolve([]));
  }

  const [gnewsArticles, newsapiArticles] = await Promise.all(fetchPromises);
  
  console.log(`[fetchNewsFromMultipleSources] Received ${gnewsArticles.length} articles from GNews, ${newsapiArticles.length} from NewsAPI`);

  // Tag articles with their source before merging
  const taggedGNewsArticles = gnewsArticles.map(article => ({
    ...article,
    feedSource: article.feedSource || "gnews",
  }));
  
  const taggedNewsAPIArticles = newsapiArticles.map(article => ({
    ...article,
    feedSource: article.feedSource || "newsapi",
  }));

  // Merge articles from all sources
  const allArticles = [...taggedGNewsArticles, ...taggedNewsAPIArticles];
  
  // Deduplicate articles BEFORE saving (in case same article came from multiple sources)
  // This prevents saving duplicate articles to database
  const uniqueArticles = deduplicateArticles(allArticles);
  
  // Save deduplicated articles to database when scraping (both new and existing)
  // The ON CONFLICT DO UPDATE clause will update existing articles with fresh data
  if (uniqueArticles.length > 0) {
    try {
      // Tag articles with the search context (ticker/keyword)
      saveArticles(uniqueArticles, searchedBy);
      
      // Log save results (we can't easily determine new vs updated without querying, so just log total)
      console.log(`[fetchNewsFromMultipleSources] Saved ${uniqueArticles.length} unique article(s) to database${searchedBy ? ` (searched by: ${searchedBy})` : ''} (deduplicated from ${allArticles.length} total)`);
    } catch (error) {
      console.error("Error saving articles to database:", error.message);
      // Continue even if save fails - we still return the articles
    }
  }
  
  // Sort by date (newest first)
  const sortedArticles = sortArticlesByDate(uniqueArticles);

  return sortedArticles;
}

/**
 * Fetch articles for specific holdings (tickers)
 * Constructs search queries for each ticker and merges results
 * @param {Array} holdings - Array of holding objects with ticker, label, notes
 * @param {Object} options - Options for fetching (page, from, to, sources)
 */
async function fetchArticlesForHoldings(holdings, options = {}) {
  if (!holdings || holdings.length === 0) {
    return [];
  }

  const { page = 1, from, to, sources } = options;

  // Build search queries for each holding
  // Format: "NVDA OR Nvidia" for ticker + label
  const searchQueries = holdings.map((holding) => {
    const ticker = holding.ticker ? holding.ticker.toUpperCase() : holding.toUpperCase();
    const parts = [ticker];
    
    // If holding is an object, add label and notes
    if (typeof holding === 'object' && holding.label) {
      parts.push(holding.label);
    }
    
    // Add company name variations if in notes
    if (typeof holding === 'object' && holding.notes) {
      // Extract potential company names from notes
      const noteWords = holding.notes.split(/\s+/).filter(w => w.length > 3);
      if (noteWords.length > 0 && noteWords.length <= 3) {
        parts.push(noteWords.join(" "));
      }
    }
    
    const query = parts.join(" OR ");
    console.log(`[fetchArticlesForHoldings] Built query for holding: "${query}"`);
    return query;
  });

  // Fetch news for all holdings in parallel
  // Tag each article with the ticker that found it
  console.log(`[fetchArticlesForHoldings] Processing ${holdings.length} holdings with queries:`, searchQueries);
  
  const fetchPromises = holdings.map((holding, index) => {
    const query = searchQueries[index];
    // Handle both object format {ticker, label} and string format "NVDA"
    const ticker = typeof holding === 'object' ? holding.ticker.toUpperCase() : holding.toUpperCase();
    
    console.log(`[fetchArticlesForHoldings] Fetching for ticker: ${ticker}, query: "${query}"`);
    
    return fetchNewsFromMultipleSources(query, {
      page,
      from,
      to,
      sources,
      sortBy: "publishedAt",
      searchedBy: ticker, // Tag articles with the ticker that found them
    }).then(articles => {
      console.log(`[fetchArticlesForHoldings] Found ${articles.length} articles for ${ticker}`);
      // Add searchedBy metadata to each article for tracking
      return articles.map(article => ({
        ...article,
        searchedBy: ticker,
      }));
    });
  });

  const allResults = await Promise.all(fetchPromises);

  // Flatten and deduplicate all articles
  const allArticles = allResults.flat();
  console.log(`[fetchArticlesForHoldings] Total articles before deduplication: ${allArticles.length}`);
  
  // When deduplicating, preserve the searchedBy from the first occurrence
  const uniqueArticles = deduplicateArticlesWithSearchContext(allArticles);
  const sortedArticles = sortArticlesByDate(uniqueArticles);

  return sortedArticles;
}

module.exports = {
  fetchFromGNews,
  fetchFromNewsAPI,
  fetchNewsFromMultipleSources,
  fetchArticlesForHoldings,
  deduplicateArticles,
  deduplicateArticlesWithSearchContext,
  sortArticlesByDate,
};

