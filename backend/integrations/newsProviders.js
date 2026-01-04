const axios = require("axios");
const { saveArticles, getExistingArticleUrls } = require("../data/articleStorage");
const xml2js = require("xml2js");
const { promisify } = require("util");
const parseXML = promisify(xml2js.parseString);

// Rate limiting and backoff for GNews
let gnewsRateLimited = false;
let gnewsBackoffDelay = 1000; // Start with 1 second delay
const MAX_BACKOFF_DELAY = 60000; // Max 60 seconds

// Detect dev mode
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Sleep/delay utility
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reset GNews rate limit status (call at start of new ingestion run)
 */
function resetGNewsRateLimit() {
  gnewsRateLimited = false;
  gnewsBackoffDelay = 1000; // Reset to initial delay
}

/**
 * Check if GNews is rate-limited
 */
function isGNewsRateLimited() {
  return gnewsRateLimited;
}

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

// ========== Google RSS Helper Functions ==========

/**
 * Extract field from RSS item that might be array or string format
 */
function extractRSSField(field, defaultValue = "") {
  if (!field) return defaultValue;

  if (Array.isArray(field)) {
    return field[0]?._ || field[0] || defaultValue;
  }

  return field || defaultValue;
}

/**
 * Extract source name from RSS item using multiple strategies
 */
function extractRSSSourceName(rssItem, description) {
  // Method 1: Check source tag
  if (rssItem.source) {
    const source = Array.isArray(rssItem.source) ? rssItem.source[0] : rssItem.source;
    if (source?._) return source._;
    if (typeof source === 'string') return source;

    // Extract domain from source URL
    if (source?.$?.url) {
      try {
        const url = new URL(source.$.url);
        return url.hostname.replace('www.', '');
      } catch (e) {
        // Continue to next method
      }
    }
  }

  // Method 2: Check dc:creator
  if (rssItem["dc:creator"]) {
    const creator = Array.isArray(rssItem["dc:creator"])
      ? rssItem["dc:creator"][0]
      : rssItem["dc:creator"];
    if (creator?._) return creator._;
    if (typeof creator === 'string') return creator;
  }

  // Method 3: Extract from description (often contains source info)
  if (description) {
    const sourceMatch = description.match(/(?:Source|via|from|by):\s*([^<\.]+)/i);
    if (sourceMatch && sourceMatch[1]) {
      return sourceMatch[1].trim();
    }
  }

  return "Google News"; // Default fallback
}

/**
 * Extract image URL from RSS description
 */
function extractRSSImageUrl(description) {
  if (!description) return null;

  const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch ? imgMatch[1] : null;
}

/**
 * Clean HTML from description
 */
function cleanHTMLDescription(description) {
  if (!description) return null;

  return description
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Parse RSS date string to ISO format
 */
function parseRSSDate(rssItem) {
  if (!rssItem.pubDate) return new Date().toISOString();

  const dateStr = extractRSSField(rssItem.pubDate);
  if (!dateStr) return new Date().toISOString();

  try {
    const parsedDate = new Date(dateStr);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  } catch (e) {
    // Keep default date if parsing fails
  }

  return new Date().toISOString();
}

// =================================================

/**
 * Transform Google RSS article to standard Article format
 * Handles various RSS XML structures from Google News
 */
function transformGoogleRSSArticle(rssItem) {
  // Extract basic fields using helper
  const title = extractRSSField(rssItem.title);
  const link = extractRSSField(rssItem.link);
  const rawDescription = extractRSSField(rssItem.description);

  // Extract metadata using helpers
  const sourceName = extractRSSSourceName(rssItem, rawDescription);
  const imageUrl = extractRSSImageUrl(rawDescription);
  const cleanDescription = cleanHTMLDescription(rawDescription);
  const pubDate = parseRSSDate(rssItem);

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
 * Allowed domains for Google RSS redirects
 * 
 * IMPORTANT: This allowlist is for redirect safety/validation only.
 * It does NOT imply these sources are fetchable.
 * 
 * Some domains (Bloomberg, WSJ, FT) may be paywalled and not fetchable.
 * fetchableSources (used in deferredArticleEvaluator) remains separate
 * and should only include sources you have tested and confirmed work.
 * 
 * This allowlist prevents following redirects to:
 * - Tracker domains
 * - Malicious domains
 * - Unverified domains
 * 
 * But it does NOT guarantee the article is fetchable.
 */
const ALLOWED_REDIRECT_DOMAINS = [
  'reuters.com',
  'bloomberg.com',  // Paywalled, but safe for redirect validation
  'wsj.com',        // Paywalled, but safe for redirect validation
  'ft.com',         // Paywalled, but safe for redirect validation
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  'cnbc.com',
  'marketwatch.com',
  'barrons.com',
  'morningstar.com',
  'yahoo.com',
  'finance.yahoo.com',
  'cnn.com',
  'bbc.com',
  'cbsnews.com',
  'foxbusiness.com',
  'businessinsider.com',
  'euronews.com',
  'ksat.com',
  'eastidahonews.com',
  'coindesk.com',
  'ap.org',
  'apnews.com',
  // Add more trusted news domains as needed
];

/**
 * Block obvious redirect/tracker domains
 */
const BLOCKED_DOMAINS = [
  'google.com',
  'googletagmanager.com',
  'doubleclick.net',
  'google-analytics.com',
  'facebook.com',
  'twitter.com',
  'linkedin.com',
  // Add more tracker/redirect domains
];

/**
 * Check if domain is in allowlist
 */
function isAllowedDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    
    // Check against allowlist
    return ALLOWED_REDIRECT_DOMAINS.some(allowed => 
      hostname === allowed || hostname.endsWith('.' + allowed)
    );
  } catch (error) {
    return false;
  }
}

/**
 * Check if domain is blocked
 */
function isBlockedDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Explicitly allow news.google.com (legitimate Google News RSS redirect service)
    if (hostname === 'news.google.com') {
      return false;
    }

    return BLOCKED_DOMAINS.some(blocked =>
      hostname === blocked || hostname.endsWith('.' + blocked)
    );
  } catch (error) {
    return false;
  }
}

/**
 * Decode Google RSS URL to get actual article URL
 * 
 * Uses HEAD request with redirect following, falls back to GET with Range header.
 * Validates final URL against allowlist/blocklist for safety.
 * 
 * @param {string} googleRssUrl - The encoded Google RSS URL
 * @returns {Promise<string>} - The decoded article URL (or original if decode fails)
 */
async function decodeGoogleRSSUrl(googleRssUrl) {
  // Check config for strict mode (default: true in prod, false in dev)
  const STRICT_REDIRECT_ALLOWLIST = process.env.STRICT_REDIRECT_ALLOWLIST !== 'false';
  
  // Method 1: Try HEAD request
  try {
    const headResponse = await axios.head(googleRssUrl, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    
    // Extract final URL from redirect chain
    const finalUrl = headResponse.request?.res?.responseUrl || 
                    headResponse.headers?.location || 
                    googleRssUrl;
    
    // Validate domain (strict allowlist)
    if (finalUrl && finalUrl !== googleRssUrl) {
      // Reject if still on Google domain (incomplete redirect)
      const finalUrlObj = new URL(finalUrl);
      if (finalUrlObj.hostname.includes('google.com')) {
        console.warn(`Redirect chain incomplete (still on Google): ${finalUrl}, using original`);
        return googleRssUrl;
      }

      if (isBlockedDomain(finalUrl)) {
        console.warn(`Blocked redirect domain for ${googleRssUrl}, using original`);
        return googleRssUrl;
      }

      if (isAllowedDomain(finalUrl)) {
        return finalUrl;
      }

      // Not in allowlist (strict mode fallback)
      if (STRICT_REDIRECT_ALLOWLIST) {
        console.warn(`Redirect to non-allowlisted domain (strict mode): ${finalUrl}, using original`);
        return googleRssUrl; // Fallback to original in strict mode
      } else {
        // Permissive mode: log but return it
        console.log(`Redirect to non-allowlisted domain (permissive mode): ${finalUrl}`);
        return finalUrl;
      }
    }
  } catch (headError) {
    // HEAD failed, try GET with Range header (lightweight)
    console.log(`HEAD failed for ${googleRssUrl}, trying GET with Range...`);
  }
  
  // Method 2: GET with Range: bytes=0-0 (lightweight fallback)
  try {
    const getResponse = await axios.get(googleRssUrl, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Range': 'bytes=0-0', // Lightweight request
      },
    });
    
    // Extract final URL from redirect chain
    const finalUrl = getResponse.request?.res?.responseUrl || 
                    getResponse.headers?.location || 
                    googleRssUrl;
    
    // Validate domain (strict allowlist)
    if (finalUrl && finalUrl !== googleRssUrl) {
      // Reject if still on Google domain (incomplete redirect)
      const finalUrlObj = new URL(finalUrl);
      if (finalUrlObj.hostname.includes('google.com')) {
        console.warn(`Redirect chain incomplete (still on Google): ${finalUrl}, using original`);
        return googleRssUrl;
      }

      if (isBlockedDomain(finalUrl)) {
        console.warn(`Blocked redirect domain for ${googleRssUrl}, using original`);
        return googleRssUrl;
      }

      if (isAllowedDomain(finalUrl)) {
        return finalUrl;
      }

      // Not in allowlist (strict mode fallback)
      if (STRICT_REDIRECT_ALLOWLIST) {
        console.warn(`Redirect to non-allowlisted domain (strict mode): ${finalUrl}, using original`);
        return googleRssUrl; // Fallback to original in strict mode
      } else {
        // Permissive mode: log but return it
        console.log(`Redirect to non-allowlisted domain (permissive mode): ${finalUrl}`);
        return finalUrl;
      }
    }
  } catch (getError) {
    // GET with Range also failed
    console.warn(`GET with Range failed for ${googleRssUrl}`);
  }
  
  // Fallback: if all methods fail, use original
  console.warn(`Failed to decode Google RSS URL: ${googleRssUrl}, using original`);
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
    // Only log preview if it's not too long (avoid CSS/HTML noise)
    if (response.data.length < 1000) {
      console.log(`[Google RSS] Response preview: ${response.data.substring(0, 300)}`);
    }

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
      // Truncate error output to avoid CSS/HTML noise
      const errorPreview = response.data.length > 500 ? response.data.substring(0, 200) + '...' : response.data;
      console.error(`[Google RSS] Response data sample:`, errorPreview);
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
          // Decode Google RSS URL to get actual article URL
          const originalUrl = article.url;
          const finalUrl = await decodeGoogleRSSUrl(originalUrl);
          
          // Store both original and final URLs
          article.original_url = originalUrl;
          article.url = finalUrl; // Use final URL as primary
          
          // Extract display domain from final URL
          try {
            const urlObj = new URL(finalUrl);
            article.display_domain = urlObj.hostname.replace(/^www\./, '');
          } catch (e) {
            article.display_domain = null;
          }
          
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
    // Truncate error output to avoid CSS/HTML noise
    const errorData = error.response?.data;
    const errorMsg = typeof errorData === 'string' && errorData.length > 500 
      ? errorData.substring(0, 200) + '... (truncated)' 
      : errorData;
    console.error("Error fetching from Google RSS:", errorMsg || error.message);
    return [];
  }
}

// ========== Direct RSS Feed Sources ==========
/**
 * Generic direct RSS fetcher (for non-Google RSS feeds with direct publisher URLs)
 * Unlike Google RSS, these feeds provide direct article URLs without redirect chains
 */
async function fetchFromDirectRSS(rssUrl, sourceName, options = {}) {
  const { maxArticles = 10 } = options;

  console.log(`[${sourceName}] Fetching from RSS feed: ${rssUrl}`);

  try {
    const response = await axios.get(rssUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!response.data) {
      console.error(`[${sourceName}] Empty response from RSS feed`);
      return [];
    }

    // Parse XML RSS feed
    const parsed = await parseXML(response.data, {
      explicitArray: true,
      mergeAttrs: false,
      explicitRoot: true,
      ignoreAttrs: false,
      trim: true,
      normalize: true,
      normalizeTags: false,
    });

    // Extract channel and items
    let channel = null;
    let items = [];

    if (parsed.rss && parsed.rss.channel) {
      channel = Array.isArray(parsed.rss.channel) ? parsed.rss.channel[0] : parsed.rss.channel;
    } else if (parsed.feed) {
      channel = Array.isArray(parsed.feed) ? parsed.feed[0] : parsed.feed;
    }

    if (!channel) {
      console.error(`[${sourceName}] Invalid RSS structure`);
      return [];
    }

    if (channel.item) {
      items = Array.isArray(channel.item) ? channel.item : [channel.item];
    } else if (channel.entry) {
      items = Array.isArray(channel.entry) ? channel.entry : [channel.entry];
    }

    if (!items || items.length === 0) {
      console.log(`[${sourceName}] No items in RSS feed`);
      return [];
    }

    console.log(`[${sourceName}] RSS feed returned ${items.length} items, processing ${Math.min(items.length, maxArticles)}`);

    // Transform items to standard format
    const articles = [];
    for (const item of items.slice(0, maxArticles)) {
      try {
        const title = extractRSSField(item.title);
        const link = extractRSSField(item.link);
        const description = extractRSSField(item.description);
        const pubDate = parseRSSDate(item);

        if (link && title) {
          articles.push({
            source: { id: null, name: sourceName },
            author: null,
            title: title.trim(),
            description: description || null,
            url: link.trim(),
            urlToImage: null,
            publishedAt: pubDate,
            content: description || null,
            feedSource: sourceName.toLowerCase().replace(/\s+/g, ''),
          });
        }
      } catch (error) {
        console.error(`[${sourceName}] Error transforming article:`, error.message);
      }
    }

    console.log(`[${sourceName}] Successfully fetched ${articles.length} articles`);
    return articles;
  } catch (error) {
    console.error(`[${sourceName}] Error fetching RSS:`, error.message);
    return [];
  }
}

/**
 * CNBC RSS Feed - Direct publisher URLs, no redirect chains
 */
async function fetchFromCNBCRSS(options = {}) {
  const rssUrl = 'https://www.cnbc.com/id/100003114/device/rss/rss.html'; // Top News
  return fetchFromDirectRSS(rssUrl, 'CNBC', options);
}

/**
 * MarketWatch RSS Feed - Direct publisher URLs
 */
async function fetchFromMarketWatchRSS(options = {}) {
  const rssUrl = 'https://www.marketwatch.com/rss/topstories'; // Top Stories
  return fetchFromDirectRSS(rssUrl, 'MarketWatch', options);
}

/**
 * CoinDesk RSS Feed - Direct publisher URLs (crypto news)
 */
async function fetchFromCoinDeskRSS(options = {}) {
  const rssUrl = 'https://www.coindesk.com/arc/outboundfeeds/rss/'; // All articles
  return fetchFromDirectRSS(rssUrl, 'CoinDesk', options);
}

/**
 * Reuters RSS Feed - Direct publisher URLs (business news)
 * Note: Reuters RSS feeds may require authentication or have been restricted
 * This is a fallback implementation that may need updates
 */
async function fetchFromReutersRSS(options = {}) {
  const rssUrl = 'https://www.reuters.com/arc/outboundfeeds/news/?outputType=xml'; // General news feed
  return fetchFromDirectRSS(rssUrl, 'Reuters', options);
}

/**
 * Financial Times RSS Feed - Direct publisher URLs (business/finance news)
 */
async function fetchFromFinancialTimesRSS(options = {}) {
  const rssUrl = 'https://www.ft.com/?format=rss'; // Main feed
  return fetchFromDirectRSS(rssUrl, 'Financial Times', options);
}

/**
 * Fetch news from GNews.io
 * Implements rate limiting, exponential backoff, and dev mode limits
 */
async function fetchFromGNews(query, options = {}) {
  const { category, page = 1, from, to, maxArticles = 10 } = options;
  const API_KEY = process.env.GNEWS_API_KEY;
  
  // Check if GNews is rate-limited (skip for rest of run)
  if (gnewsRateLimited) {
    console.log(`[GNews] Skipped: rate-limited (disabled for this run)`);
    return [];
  }

  if (!API_KEY) {
    console.warn("GNEWS_API_KEY not configured, skipping GNews");
    return [];
  }

  // Add delay before request (rate limiting)
  if (gnewsBackoffDelay > 1000) {
    console.log(`[GNews] Waiting ${gnewsBackoffDelay}ms before request (backoff delay)`);
    await delay(gnewsBackoffDelay);
  } else {
    // Small delay between requests even when not backing off
    await delay(500);
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

    // Success - reset backoff delay
    gnewsBackoffDelay = 1000;

    if (response.data && response.data.articles) {
      const articles = response.data.articles.map(transformGNewsArticle);
      console.log(`[GNews] API returned ${articles.length} articles`);
      return articles;
    }

    console.log(`[GNews] No articles in response`);
    return [];
  } catch (error) {
    // Check for rate limit errors
    const statusCode = error.response?.status;
    const errorData = error.response?.data;
    
    // GNews rate limit typically returns 429 or 403
    if (statusCode === 429 || statusCode === 403 || 
        (errorData && (errorData.message?.toLowerCase().includes('rate limit') || 
                       errorData.error?.toLowerCase().includes('rate limit')))) {
      console.error(`[GNews] Rate limit detected (status: ${statusCode}). Disabling GNews for rest of run.`);
      gnewsRateLimited = true;
      return [];
    }

    // For other errors, implement exponential backoff
    if (statusCode >= 500 || statusCode === 429) {
      // Exponential backoff: double the delay, cap at max
      gnewsBackoffDelay = Math.min(gnewsBackoffDelay * 2, MAX_BACKOFF_DELAY);
      console.warn(`[GNews] Server error (${statusCode}), increasing backoff delay to ${gnewsBackoffDelay}ms`);
    }

    // Truncate error output to avoid CSS/HTML noise
    const errorMsg = typeof errorData === 'string' && errorData.length > 500 
      ? errorData.substring(0, 200) + '... (truncated)' 
      : errorData;
    console.error("Error fetching from GNews:", errorMsg || error.message);
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

    // Truncate response data to avoid CSS/HTML noise
    const responsePreview = typeof response.data === 'string' && response.data.length > 500
      ? response.data.substring(0, 200) + '... (truncated)'
      : (typeof response.data === 'object' ? JSON.stringify(response.data).substring(0, 200) + '...' : response.data);
    console.log(`[NewsAPI] No articles in response, response data:`, responsePreview);
    return [];
  } catch (error) {
    // Truncate error output to avoid CSS/HTML noise
    const errorData = error.response?.data;
    const errorMsg = typeof errorData === 'string' && errorData.length > 500 
      ? errorData.substring(0, 200) + '... (truncated)' 
      : errorData;
    console.error("Error fetching from NewsAPI:", errorMsg || error.message);
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
  const { category, page, from, to, sortBy, sources, searchedBy, sourceLimits } = options;
  
  // Default source limits if not provided
  const limits = sourceLimits || { newsapi: 10, gnews: 10, googlerss: 10 };

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
    const gnewsLimit = limits.gnews || 10;
    console.log(`[fetchNewsFromMultipleSources] ✅ Fetching from GNews (limit: ${gnewsLimit})...`);
    fetchPromises.push(fetchFromGNews(query, { category, page, from, to, maxArticles: gnewsLimit }));
  } else {
    console.log(`[fetchNewsFromMultipleSources] ❌ Skipping GNews (not in sources: ${JSON.stringify(normalizedSources)})`);
    fetchPromises.push(Promise.resolve([]));
  }
  
  if (fetchNewsAPI) {
    const newsapiLimit = limits.newsapi || 10;
    console.log(`[fetchNewsFromMultipleSources] ✅ Fetching from NewsAPI (limit: ${newsapiLimit})...`);
    fetchPromises.push(fetchFromNewsAPI(query, { category, page, from, to, sortBy, maxArticles: newsapiLimit }));
  } else {
    console.log(`[fetchNewsFromMultipleSources] ❌ Skipping NewsAPI (not in sources: ${JSON.stringify(normalizedSources)})`);
    fetchPromises.push(Promise.resolve([]));
  }
  
  if (fetchGoogleRSS && limits.googlerss > 0) {
    const googlerssLimit = limits.googlerss;
    console.log(`[fetchNewsFromMultipleSources] ✅ Fetching from Google RSS (limit: ${googlerssLimit})...`);
    fetchPromises.push(fetchFromGoogleRSS(query, { maxArticles: googlerssLimit, from, to }));
  } else {
    const skipReason = !fetchGoogleRSS
      ? `not in sources: ${JSON.stringify(normalizedSources)}`
      : `limit is 0 (disabled)`;
    console.log(`[fetchNewsFromMultipleSources] ❌ Skipping Google RSS (${skipReason})`);
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
      // Import saveArticles here to avoid circular dependency
      const { saveArticles } = require("../data/articleStorage");
      
      // Tag articles with the search context (ticker/keyword/MACRO)
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

  const { page = 1, from, to, sources, sourceLimits } = options;

  // Build contextual search queries for each holding
  // Philosophy: Add financial/business context to filter out noise
  // Examples: "AAPL" matches "Apple TV show" → Add "stock OR earnings OR revenue"
  const searchQueries = holdings.map((holding) => {
    const ticker = holding.ticker ? holding.ticker.toUpperCase() : holding.toUpperCase();
    const label = typeof holding === 'object' && holding.label ? holding.label : '';

    // Build base query with ticker and label
    const baseParts = [ticker];
    if (label) {
      baseParts.push(label);
    }

    // Add company name variations from notes
    if (typeof holding === 'object' && holding.notes) {
      const noteWords = holding.notes.split(/\s+/).filter(w => w.length > 3);
      if (noteWords.length > 0 && noteWords.length <= 3) {
        baseParts.push(noteWords.join(" "));
      }
    }

    // Add ONE financial context keyword to help filter noise
    // Philosophy: Keep it simple - most providers don't support complex boolean
    // Just add "stock" to filter out entertainment/celebrity news
    const baseQuery = baseParts.join(" OR ");
    const query = `${baseQuery} stock`;

    console.log(`[fetchArticlesForHoldings] Built contextual query for ${ticker}: "${query}"`);
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
      sourceLimits: sourceLimits, // Pass source limits to control articles per source
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
  fetchFromCNBCRSS,
  fetchFromMarketWatchRSS,
  fetchFromCoinDeskRSS,
  fetchFromReutersRSS,
  fetchFromFinancialTimesRSS,
  fetchNewsFromMultipleSources,
  fetchArticlesForHoldings,
  deduplicateArticles,
  deduplicateArticlesWithSearchContext,
  sortArticlesByDate,
  decodeGoogleRSSUrl, // Exported for future implementation
  resetGNewsRateLimit, // Export for resetting rate limit at start of runs
  isGNewsRateLimited, // Export for checking rate limit status
};

