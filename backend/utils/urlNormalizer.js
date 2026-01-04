const { JSDOM } = require("jsdom");

/**
 * Normalize URL with specific rules for deduplication
 * 
 * Rules:
 * 1. Normalize scheme (prefer https)
 * 2. Domain: lowercase, remove www.
 * 3. Path: remove trailing slash (except root)
 * 4. Query params: remove tracking params, keep essential ones
 * 5. Remove fragment
 */
function normalizeUrl(url) {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    
    // 1. Normalize scheme: keep https if present, else http
    urlObj.protocol = urlObj.protocol.toLowerCase();
    if (urlObj.protocol === 'http:' && urlObj.hostname.includes('localhost')) {
      // Keep http for localhost
    } else if (urlObj.protocol !== 'https:') {
      urlObj.protocol = 'https:'; // Prefer https
    }
    
    // 2. Domain: lowercase, remove www. (consistent rule)
    urlObj.hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    
    // 3. Remove trailing slash from path (deterministic: keep '/' for root)
    const path = urlObj.pathname;
    urlObj.pathname = (path === '/' ? '/' : path.replace(/\/$/, ''));
    
    // 4. Query params: remove tracking params, keep essential ones
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 
                           'utm_content', 'gclid', 'fbclid', 'ref', 'source', 
                           'campaign', 'medium'];
    const essentialParams = ['id', 'article_id', 'story_id']; // Sometimes essential
    
    const params = new URLSearchParams(urlObj.search);
    const newParams = new URLSearchParams();
    
    for (const [key, value] of params.entries()) {
      const lowerKey = key.toLowerCase();
      // Keep essential params
      if (essentialParams.includes(lowerKey)) {
        newParams.append(key, value);
      }
      // Remove tracking params
      else if (!trackingParams.includes(lowerKey)) {
        // Keep other params (might be essential for some sites)
        newParams.append(key, value);
      }
    }
    
    urlObj.search = newParams.toString();
    
    // 5. Remove fragment
    urlObj.hash = '';
    
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Extract canonical URL from HTML
 * Parses <link rel="canonical"> from HTML
 * 
 * @param {string} html - HTML content
 * @returns {string|null} Canonical URL or null if not found
 */
function extractCanonicalUrl(html) {
  if (!html) return null;
  
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    if (canonicalLink && canonicalLink.href) {
      return canonicalLink.href;
    }
  } catch (error) {
    // Ignore parsing errors
  }
  return null;
}

module.exports = {
  normalizeUrl,
  extractCanonicalUrl,
};
