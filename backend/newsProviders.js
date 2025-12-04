const axios = require("axios");
const { saveArticles, getExistingArticleUrls } = require("./articleStorage");
const xml2js = require("xml2js");
const { promisify } = require("util");
const parseXML = promisify(xml2js.parseString);

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
 * Transform Google RSS article to standard Article format
 * Handles various RSS XML structures from Google News
 */
function transformGoogleRSSArticle(rssItem) {
  // Extract title - handle both array and string formats
  const title = Array.isArray(rssItem.title) 
    ? (rssItem.title[0]?._ || rssItem.title[0] || "") 
    : (rssItem.title || "");
  
  // Extract link - handle both array and string formats
  const link = Array.isArray(rssItem.link) 
    ? (rssItem.link[0]?._ || rssItem.link[0] || rssItem.link[0]?.$?.href || "") 
    : (rssItem.link || "");
  
  // Extract description - handle both array and string formats
  let description = null;
  if (rssItem.description) {
    description = Array.isArray(rssItem.description)
      ? (rssItem.description[0]?._ || rssItem.description[0] || "")
      : rssItem.description;
  }
  
  // Extract published date - handle various formats
  let pubDate = new Date().toISOString();
  if (rssItem.pubDate) {
    const dateStr = Array.isArray(rssItem.pubDate) 
      ? (rssItem.pubDate[0]?._ || rssItem.pubDate[0] || "")
      : rssItem.pubDate;
    
    if (dateStr) {
      try {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          pubDate = parsedDate.toISOString();
        }
      } catch (e) {
        // Keep default date if parsing fails
      }
    }
  }
  
  // Extract source name - try multiple methods
  let sourceName = "Google News";
  
  // Method 1: Check source tag
  if (rssItem.source) {
    const source = Array.isArray(rssItem.source) ? rssItem.source[0] : rssItem.source;
    if (source?._) {
      sourceName = source._;
    } else if (typeof source === 'string') {
      sourceName = source;
    } else if (source?.$?.url) {
      // Extract domain from source URL
      try {
        const url = new URL(source.$.url);
        sourceName = url.hostname.replace('www.', '');
      } catch (e) {
        // Keep default
      }
    }
  }
  
  // Method 2: Check dc:creator
  if (sourceName === "Google News" && rssItem["dc:creator"]) {
    const creator = Array.isArray(rssItem["dc:creator"]) 
      ? rssItem["dc:creator"][0] 
      : rssItem["dc:creator"];
    if (creator?._) {
      sourceName = creator._;
    } else if (typeof creator === 'string') {
      sourceName = creator;
    }
  }
  
  // Method 3: Try to extract from description (often contains source info)
  if (sourceName === "Google News" && description) {
    // Look for patterns like "Source: ..." or "via ..." or "from ..."
    const sourceMatch = description.match(/(?:Source|via|from|by):\s*([^<\.]+)/i);
    if (sourceMatch && sourceMatch[1]) {
      sourceName = sourceMatch[1].trim();
    }
  }
  
  // Extract image URL if available (Google RSS sometimes includes it in description)
  let imageUrl = null;
  if (description) {
    const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1]) {
      imageUrl = imgMatch[1];
    }
  }
  
  // Clean description of HTML tags for better storage
  let cleanDescription = description;
  if (description) {
    cleanDescription = description
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  return {
    source: {
      id: null,
      name: sourceName,
    },
    author: null,
    title: title.trim(),
    description: cleanDescription || null,
    url: link.trim(),
    urlToImage: imageUrl || null,
    publishedAt: pubDate,
    content: cleanDescription || null, // Use cleaned description as content
    feedSource: "googlerss", // Tag articles from Google RSS
  };
}

/**
 * Decode Google RSS URL to get actual article URL
 * 
 * DOCUMENTATION: Google RSS feeds return encoded URLs that need to be decoded.
 * The following Python code shows how to decode them (NOT YET IMPLEMENTED):
 * 
 * ```python
 * import requests
 * import json
 * from bs4 import BeautifulSoup
 * 
 * google_rss_url = 'https://news.google.com/rss/articles/CBMiWkFVX3lxTE1qZ1V2bUVCeXlNbElxeFI2WWVLeVVUM3pBaGhmWHlpWThlZ2…'
 * 
 * resp = requests.get(google_rss_url)
 * data = BeautifulSoup(resp.text, 'html.parser').select_one('c-wiz[data-p]').get('data-p')
 * obj = json.loads(data.replace('%.@.', '["garturlreq",'))
 * 
 * payload = {
 *     'f.req': json.dumps([[['Fbv4je', json.dumps(obj[:-6] + obj[-2:]), 'null', 'generic']]])
 * }
 * 
 * headers = {
 *   'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
 *   'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
 * }
 * 
 * url = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
 * response = requests.post(url, headers=headers, data=payload)
 * array_string = json.loads(response.text.replace(")]}'", ""))[0][2]
 * article_url = json.loads(array_string)[1]
 * 
 * print(article_url)
 * ```
 * 
 * TODO: Implement this decoding logic in JavaScript/Node.js
 * For now, we use the RSS link directly (which may be a Google redirect URL)
 * 
 * @param {string} googleRssUrl - The encoded Google RSS URL
 * @returns {Promise<string>} - The decoded article URL (currently returns input URL)
 */
async function decodeGoogleRSSUrl(googleRssUrl) {
  // TODO: Implement URL decoding logic
  // For now, return the URL as-is
  return googleRssUrl;
}

/**
 * Fetch news from Google RSS
 * Fetches articles from Google News RSS feeds and maps them to the database format.
 * 
 * Database mapping:
 * - url: Google RSS link (encoded URL, decoding not yet implemented)
 * - source_name: Extracted from RSS source tag, dc:creator, or description
 * - title: From RSS title
 * - description: Cleaned HTML from RSS description
 * - published_at: Parsed from RSS pubDate
 * - feed_source: Set to "googlerss" for tracking
 * - content: Uses cleaned description as content
 * 
 * @param {string} query - Search query or topic (e.g., "NVDA", "Nvidia stock")
 * @param {object} options - Options including maxArticles, from, to
 * @param {number} options.maxArticles - Maximum articles to fetch (default: 10)
 * @param {string} options.from - Start date filter (not yet implemented)
 * @param {string} options.to - End date filter (not yet implemented)
 * @returns {Promise<Array>} Array of article objects in standard format
 */
async function fetchFromGoogleRSS(query, options = {}) {
  const { maxArticles = 10, from, to } = options;
  
  console.log(`[Google RSS] Fetching articles - query: "${query}", max: ${maxArticles}`);

  try {
    // Build Google RSS URL
    // Google News RSS format: https://news.google.com/rss/search?q={query}&hl=en&gl=US&ceid=US:en
    let rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
    
    // Add date filters if provided (Google RSS uses when:1d, 7d, etc.)
    // For now, we'll use the basic query format
    if (from || to) {
      // TODO: Implement date filtering for Google RSS
      console.log(`[Google RSS] Date filtering not yet implemented for RSS feeds`);
    }

    console.log(`[Google RSS] Making RSS request to: ${rssUrl}`);
    const response = await axios.get(rssUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    // Check if response is valid
    if (!response.data) {
      console.error(`[Google RSS] Empty response from RSS feed`);
      return [];
    }

    console.log(`[Google RSS] Received response, length: ${response.data.length} chars`);
    console.log(`[Google RSS] Response preview (first 300 chars): ${response.data.substring(0, 300)}`);

    // Parse XML RSS feed with proper options
    let parsed;
    try {
      parsed = await parseXML(response.data, {
        explicitArray: true, // Always return arrays
        mergeAttrs: false, // Keep attributes separate
        explicitRoot: true, // Include root element to see structure
        ignoreAttrs: false, // Include attributes
        trim: true, // Trim whitespace
        normalize: true, // Normalize whitespace
        normalizeTags: false, // Don't lowercase tags
      });
    } catch (parseError) {
      console.error(`[Google RSS] XML parsing error:`, parseError.message);
      console.error(`[Google RSS] Response data sample:`, response.data.substring(0, 500));
      return [];
    }
    
    // Debug: Log parsed structure
    console.log(`[Google RSS] Parsed XML root keys:`, Object.keys(parsed || {}));
    
    if (!parsed) {
      console.error(`[Google RSS] Parsed result is null or undefined`);
      return [];
    }
    
    // Handle different RSS structures
    let channel = null;
    let items = [];
    
    // Try standard RSS structure: rss.channel
    if (parsed.rss) {
      console.log(`[Google RSS] Found RSS root element`);
      if (parsed.rss.channel) {
        channel = Array.isArray(parsed.rss.channel) ? parsed.rss.channel[0] : parsed.rss.channel;
        console.log(`[Google RSS] Found RSS channel structure`);
      } else {
        console.error(`[Google RSS] RSS element found but no channel. RSS keys:`, Object.keys(parsed.rss));
      }
    }
    // Try alternative structure: feed (Atom format)
    else if (parsed.feed) {
      channel = Array.isArray(parsed.feed) ? parsed.feed[0] : parsed.feed;
      console.log(`[Google RSS] Found Atom feed structure`);
    }
    // Try direct channel
    else if (parsed.channel) {
      channel = Array.isArray(parsed.channel) ? parsed.channel[0] : parsed.channel;
      console.log(`[Google RSS] Found direct channel structure`);
    }
    
    if (!channel) {
      console.error(`[Google RSS] Invalid RSS feed structure - no channel found`);
      console.error(`[Google RSS] Available keys in parsed object:`, Object.keys(parsed));
      if (parsed.rss) {
        console.error(`[Google RSS] RSS object keys:`, Object.keys(parsed.rss));
      }
      return [];
    }
    
    // Extract items - handle both RSS and Atom formats
    if (channel.item) {
      items = Array.isArray(channel.item) ? channel.item : [channel.item];
    } else if (channel.entry) {
      // Atom format uses 'entry' instead of 'item'
      items = Array.isArray(channel.entry) ? channel.entry : [channel.entry];
      console.log(`[Google RSS] Using Atom format entries`);
    }
    
    if (!items || items.length === 0) {
      console.log(`[Google RSS] No items in RSS feed`);
      return [];
    }

    console.log(`[Google RSS] RSS feed returned ${items.length} items`);

    // Transform RSS items to standard article format
    // Limit to maxArticles (default: 10) to match other sources
    const articles = [];
    const itemsToProcess = items.slice(0, maxArticles);
    console.log(`[Google RSS] Processing ${itemsToProcess.length} items (limited from ${items.length})`);
    
    for (const item of itemsToProcess) {
      try {
        const article = transformGoogleRSSArticle(item);
        
        // Validate article before adding
        if (article.url && article.title) {
          // TODO: Decode Google RSS URL to get actual article URL
          // For now, we use the RSS link directly
          // article.url = await decodeGoogleRSSUrl(article.url);
          
          articles.push(article);
        } else {
          console.warn(`[Google RSS] Skipping invalid article: missing url or title`);
        }
      } catch (error) {
        console.error(`[Google RSS] Error transforming article:`, error.message);
      }
    }

    console.log(`[Google RSS] Successfully transformed ${articles.length} articles`);
    return articles;
  } catch (error) {
    console.error("Error fetching from Google RSS:", error.response?.data || error.message);
    return [];
  }
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

  console.log(`[fetchNewsFromMultipleSources] Sources parameter:`, sources, `Type:`, typeof sources, `IsArray:`, Array.isArray(sources), `Stringified:`, JSON.stringify(sources));

  // Determine which sources to fetch from
  // If sources is provided (array with length > 0), only fetch from those sources
  // If sources is null/undefined/empty array, fetch from all sources
  const hasSources = sources && Array.isArray(sources) && sources.length > 0;
  
  // Normalize sources array to lowercase strings for comparison
  // Handle both array and string inputs
  let normalizedSources = [];
  if (hasSources) {
    normalizedSources = sources.map(s => String(s).toLowerCase().trim()).filter(s => s);
    console.log(`[fetchNewsFromMultipleSources] Normalized from array:`, normalizedSources);
  } else if (sources && typeof sources === 'string') {
    // Handle string input (comma-separated)
    normalizedSources = sources.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
    console.log(`[fetchNewsFromMultipleSources] Normalized from string:`, normalizedSources);
  } else {
    console.log(`[fetchNewsFromMultipleSources] No valid sources provided, will fetch from all sources`);
  }
  
  const hasNormalizedSources = normalizedSources.length > 0;
  
  // Only fetch from sources that are explicitly included in the sources array
  // If hasNormalizedSources is false (null/undefined/empty), fetch from all sources
  const fetchGNews = !hasNormalizedSources || normalizedSources.includes('gnews');
  const fetchNewsAPI = !hasNormalizedSources || normalizedSources.includes('newsapi');
  const fetchGoogleRSS = !hasNormalizedSources || normalizedSources.includes('googlerss');
  
  console.log(`[fetchNewsFromMultipleSources] Source flags - hasSources: ${hasSources}, hasNormalizedSources: ${hasNormalizedSources}, normalizedSources: ${JSON.stringify(normalizedSources)}, GNews: ${fetchGNews}, NewsAPI: ${fetchNewsAPI}, GoogleRSS: ${fetchGoogleRSS}`);
  
  // CRITICAL: Verify the logic is working correctly
  if (hasNormalizedSources) {
    console.log(`[fetchNewsFromMultipleSources] ⚠️ SOURCES FILTERING ACTIVE - Only fetching from: ${normalizedSources.join(', ')}`);
  } else {
    console.log(`[fetchNewsFromMultipleSources] ⚠️ NO SOURCES FILTER - Fetching from ALL sources (GNews, NewsAPI, GoogleRSS)`);
  }

  // Fetch from enabled sources in parallel
  const fetchPromises = [];
  
  if (fetchGNews) {
    console.log(`[fetchNewsFromMultipleSources] ✅ Fetching from GNews...`);
    fetchPromises.push(fetchFromGNews(query, { category, page, from, to }));
  } else {
    console.log(`[fetchNewsFromMultipleSources] ❌ Skipping GNews (not in sources: ${JSON.stringify(normalizedSources)})`);
    fetchPromises.push(Promise.resolve([]));
  }
  
  if (fetchNewsAPI) {
    console.log(`[fetchNewsFromMultipleSources] ✅ Fetching from NewsAPI...`);
    fetchPromises.push(fetchFromNewsAPI(query, { category, page, from, to, sortBy }));
  } else {
    console.log(`[fetchNewsFromMultipleSources] ❌ Skipping NewsAPI (not in sources: ${JSON.stringify(normalizedSources)})`);
    fetchPromises.push(Promise.resolve([]));
  }

  if (fetchGoogleRSS) {
    console.log(`[fetchNewsFromMultipleSources] ✅ Fetching from Google RSS...`);
    // Limit Google RSS to 10 articles to match other sources
    fetchPromises.push(fetchFromGoogleRSS(query, { maxArticles: 10, from, to }));
  } else {
    console.log(`[fetchNewsFromMultipleSources] ❌ Skipping Google RSS (not in sources: ${JSON.stringify(normalizedSources)})`);
    fetchPromises.push(Promise.resolve([]));
  }

  const [gnewsArticles, newsapiArticles, googleRSSArticles] = await Promise.all(fetchPromises);
  
  console.log(`[fetchNewsFromMultipleSources] Received ${gnewsArticles.length} articles from GNews, ${newsapiArticles.length} from NewsAPI, ${googleRSSArticles.length} from Google RSS`);

  // Tag articles with their source before merging
  const taggedGNewsArticles = gnewsArticles.map(article => ({
    ...article,
    feedSource: article.feedSource || "gnews",
  }));
  
  const taggedNewsAPIArticles = newsapiArticles.map(article => ({
    ...article,
    feedSource: article.feedSource || "newsapi",
  }));

  const taggedGoogleRSSArticles = googleRSSArticles.map(article => ({
    ...article,
    feedSource: article.feedSource || "googlerss",
  }));

  // Merge articles from all sources
  const allArticles = [...taggedGNewsArticles, ...taggedNewsAPIArticles, ...taggedGoogleRSSArticles];
  
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
  console.log(`[fetchArticlesForHoldings] Sources parameter:`, sources, `Type:`, typeof sources, `IsArray:`, Array.isArray(sources), `Stringified:`, JSON.stringify(sources));
  
  // Ensure sources is passed correctly - if it's null/undefined, pass null explicitly
  const sourcesToPass = (sources && Array.isArray(sources) && sources.length > 0) ? sources : 
                        (sources && typeof sources === 'string' && sources.trim()) ? sources : null;
  console.log(`[fetchArticlesForHoldings] Sources to pass:`, sourcesToPass, `Type:`, typeof sourcesToPass);
  
  const fetchPromises = holdings.map((holding, index) => {
    const query = searchQueries[index];
    // Handle both object format {ticker, label} and string format "NVDA"
    const ticker = typeof holding === 'object' ? holding.ticker.toUpperCase() : holding.toUpperCase();
    
    console.log(`[fetchArticlesForHoldings] Fetching for ticker: ${ticker}, query: "${query}", sources:`, sourcesToPass);
    
    return fetchNewsFromMultipleSources(query, {
      page,
      from,
      to,
      sources: sourcesToPass,
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
  fetchFromGoogleRSS,
  fetchNewsFromMultipleSources,
  fetchArticlesForHoldings,
  deduplicateArticles,
  deduplicateArticlesWithSearchContext,
  sortArticlesByDate,
  decodeGoogleRSSUrl, // Exported for future implementation
};

