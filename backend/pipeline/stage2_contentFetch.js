const axios = require("axios");
const { getDatabase } = require("../data/db");
const { JSDOM } = require("jsdom");
const { extractCanonicalUrl } = require("../utils/urlNormalizer");
const { generateSimHash } = require("../utils/contentFingerprint");
const { normalizeUrl } = require("../utils/urlNormalizer");
const { decodeGoogleRSSUrl } = require("../integrations/newsProviders");

// Note: JSDOM needs to be installed: npm install jsdom

/**
 * Stage 2: Content fetching
 * Fetch the full article, clean it, extract readable text
 * 
 * Columns filled:
 * - raw_html
 * - clean_text
 * - content_length
 * - content_fetched_at
 * - status = "content_fetched"
 */
async function processContentFetch(article) {
  const db = getDatabase();

  // Check if article was discarded in previous stage - do not process
  const articleRow = db.prepare("SELECT should_fetch_full, fetch_attempts, status FROM articles WHERE url = ?").get(article.url);
  
  if (!articleRow) {
    console.log(`Article not found in database: ${article.url}`);
    return { status: "error", reason: "Article not found" };
  }
  
  // CRITICAL: Skip if article was discarded in Stage 1
  if (articleRow.status === "discarded") {
    console.log(`Skipping content fetch for ${article.url} - article was discarded in previous stage`);
    return { status: "skipped", reason: "Already discarded" };
  }
  
  if (!articleRow.should_fetch_full) {
    console.log(`Skipping content fetch for ${article.url} - should_fetch_full is false`);
    return { status: "skipped", reason: "should_fetch_full is false" };
  }

  // Check fetch attempts
  const scoring = require("../config/scoring");
  const fetchAttempts = (articleRow.fetch_attempts || 0);
  if (fetchAttempts >= scoring.CONTENT_MAX_FETCH_ATTEMPTS) {
    console.log(`Max fetch attempts reached for ${article.url}`);
    db.prepare(`
      UPDATE articles SET
        status = 'discarded',
        updated_at = datetime('now')
      WHERE url = ?
    `).run(article.url);
    return { status: "max_attempts_reached" };
  }

  try {
    // Increment fetch attempts
    // Retry behavior: Max 2 attempts total; current implementation does one fetch per run.
    // If it fails, the next attempt happens on the next processJob tick; no backoff.
    db.prepare(`
      UPDATE articles SET
        fetch_attempts = fetch_attempts + 1,
        processing_started_at = datetime('now'),
        updated_at = datetime('now')
      WHERE url = ?
    `).run(article.url);

    // Check if URL is Google RSS redirect and decode if needed
    let fetchUrl = article.url;
    const articleRow = db.prepare("SELECT original_url, final_url FROM articles WHERE url = ?").get(article.url);
    if (articleRow && articleRow.original_url && !articleRow.final_url) {
      // Decode Google RSS URL if not already decoded
      fetchUrl = await decodeGoogleRSSUrl(articleRow.original_url);
      // Update final_url in database
      if (fetchUrl !== articleRow.original_url) {
        db.prepare("UPDATE articles SET final_url = ? WHERE url = ?").run(fetchUrl, article.url);
      }
    } else if (articleRow && articleRow.final_url) {
      // Use already decoded final_url
      fetchUrl = articleRow.final_url;
    }

    // Fetch the article with shorter timeout (reduced from 10s to 5s)
    const response = await axios.get(fetchUrl, {
      timeout: 5000, // 5 second timeout - faster failure for slow sites
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      maxRedirects: 3, // Reduced from 5 to 3
    });

    const rawHtml = response.data;

    // Extract canonical URL from HTML
    const canonicalUrl = extractCanonicalUrl(rawHtml);

    // Clean and extract text
    const cleanText = extractCleanText(rawHtml);
    const contentLength = cleanText.length;

    // Generate content fingerprint
    const contentFingerprint = generateSimHash(cleanText);

    // Generate normalized URL and domain for deduplication
    const normalizedUrl = normalizeUrl(article.url);
    let normalizedDomain = null;
    try {
      if (normalizedUrl) {
        const urlObj = new URL(normalizedUrl);
        normalizedDomain = urlObj.hostname.replace(/^www\./, '');
      }
    } catch (error) {
      // Invalid URL, skip domain extraction
    }

    // Generate title hash bucket (first 3 words)
    const articleTitle = db.prepare("SELECT title FROM articles WHERE url = ?").get(article.url)?.title || '';
    const titleHashBucket = generateTitleHashBucket(articleTitle);

    // Check if content is too short or mostly boilerplate
    const MIN_CONTENT_FOR_FETCH = 200; // Minimum before checking quality
    const isLowQuality = contentLength < MIN_CONTENT_FOR_FETCH || isBoilerplate(cleanText);
    
    if (isLowQuality) {
      const reason = contentLength < MIN_CONTENT_FOR_FETCH ? `Content too short: ${contentLength} chars` : "Content is mostly boilerplate";
      console.log(`${reason} for ${article.url}`);
      db.prepare(`
        UPDATE articles SET
          clean_text = ?,
          content_length = ?,
          content_fetched_at = datetime('now'),
          status = 'discarded',
          updated_at = datetime('now')
        WHERE url = ?
      `).run(
        cleanText.substring(0, 1000), // Store truncated text only
        contentLength,
        article.url
      );
      return { status: "content_too_short", contentLength, reason };
    }

    // Success - update database with canonical URL, fingerprint, and deduplication fields
    db.prepare(`
      UPDATE articles SET
        clean_text = ?,
        content_length = ?,
        canonical_url = ?,
        content_fingerprint = ?,
        normalized_url = ?,
        normalized_domain = ?,
        title_hash_bucket = ?,
        content_fetched_at = datetime('now'),
        status = 'content_fetched',
        last_error = NULL,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      cleanText,
      contentLength,
      canonicalUrl,
      contentFingerprint,
      normalizedUrl,
      normalizedDomain,
      titleHashBucket,
      article.url
    );

    return {
      status: "content_fetched",
      contentLength,
    };
  } catch (error) {
    console.error(`Error fetching content for ${article.url}:`, error.message);
    
    // Update with error
    const errorMessage = error.message.substring(0, 500);
    db.prepare(`
      UPDATE articles SET
        last_error = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(errorMessage, article.url);

    // Check if we've reached max attempts
    if (fetchAttempts + 1 >= scoring.CONTENT_MAX_FETCH_ATTEMPTS) {
      db.prepare(`
        UPDATE articles SET
          status = 'discarded',
          updated_at = datetime('now')
        WHERE url = ?
      `).run(article.url);
      return { status: "max_attempts_reached", error: errorMessage };
    }

    return { status: "fetch_failed", error: errorMessage, fetchAttempts: fetchAttempts + 1 };
  }
}

/**
 * Extract clean text from HTML with better boilerplate detection
 */
function extractCleanText(html) {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Remove script and style elements
    const scripts = document.querySelectorAll("script, style, nav, header, footer, aside, .ad, .advertisement, .sidebar, .cookie, .popup, .modal");
    scripts.forEach((el) => el.remove());

    // Try to find main content
    const mainContent = document.querySelector("article, .article, .content, main, .post, .entry-content, .story-body");
    const contentElement = mainContent || document.body;

    // Get text content
    let text = contentElement.textContent || "";

    // Clean up whitespace
    text = text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();

    // Early exit: Check if text is mostly boilerplate
    if (isBoilerplate(text)) {
      return text.substring(0, 500); // Return truncated to mark as low quality
    }

    return text;
  } catch (error) {
    console.error("Error extracting clean text:", error.message);
    // Fallback: strip HTML tags using regex (less accurate but works)
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/**
 * Check if text is mostly boilerplate (menus, navigation, etc.)
 */
function isBoilerplate(text) {
  if (!text || text.length < 100) return false;
  
  const lowerText = text.toLowerCase();
  const boilerplatePatterns = [
    /subscribe\s+to\s+our\s+newsletter/i,
    /sign\s+up\s+for\s+updates/i,
    /click\s+here\s+to\s+/i,
    /read\s+more/i,
    /cookie\s+policy/i,
    /privacy\s+policy/i,
    /terms\s+of\s+service/i,
  ];
  
  // Check ratio of boilerplate phrases
  let boilerplateCount = 0;
  for (const pattern of boilerplatePatterns) {
    const matches = lowerText.match(pattern);
    if (matches) boilerplateCount += matches.length;
  }
  
  // If more than 3 boilerplate phrases per 500 chars, likely boilerplate
  const boilerplateDensity = (boilerplateCount / (text.length / 500));
  return boilerplateDensity > 3;
}

/**
 * Generate title hash bucket (first 3 words) for candidate selection
 */
function generateTitleHashBucket(title) {
  if (!title) return '';
  const words = title.toLowerCase().split(/\s+/).slice(0, 3);
  return words.join('_');
}

/**
 * Process multiple articles in parallel with concurrency limit
 * @param {Array} articles - Array of article objects
 * @param {number} concurrency - Maximum concurrent fetches (default: 8)
 * @returns {Promise<Array>} Array of results in same order as input
 */
async function processContentFetchBatch(articles, concurrency = 8) {
  if (!articles || articles.length === 0) return [];
  
  const db = getDatabase();
  
  // Pre-filter: Remove articles that are already discarded
  const articlesToProcess = [];
  const articleIndices = [];
  
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const existing = db.prepare("SELECT status FROM articles WHERE url = ?").get(article.url);
    
    // CRITICAL: Skip discarded articles before processing
    if (existing && existing.status === "discarded") {
      continue; // Skip discarded articles
    }
    
    articlesToProcess.push(article);
    articleIndices.push(i);
  }
  
  if (articlesToProcess.length === 0) {
    return articles.map(() => ({ status: "skipped", reason: "Already discarded" }));
  }
  
  const results = new Array(articles.length);
  let currentIndex = 0;
  
  async function processBatch() {
    while (currentIndex < articlesToProcess.length) {
      const batchIndex = currentIndex++;
      const article = articlesToProcess[batchIndex];
      const originalIndex = articleIndices[batchIndex];
      
      try {
        const result = await processContentFetch(article);
        results[originalIndex] = result;
      } catch (error) {
        results[originalIndex] = { status: "error", error: error.message };
      }
    }
  }
  
  // Start concurrent workers
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, articles.length); i++) {
    workers.push(processBatch());
  }
  
  await Promise.all(workers);
  return results;
}

module.exports = {
  processContentFetch,
  processContentFetchBatch,
};

