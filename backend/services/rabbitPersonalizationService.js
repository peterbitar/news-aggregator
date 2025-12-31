/**
 * Rabbit Personalization Service
 * Generates Wealthy Rabbit personalized explanations for news events
 *
 * Architecture:
 * 1. Batch processing (chunks of 10 events, configurable)
 * 2. Parallel batch processing for better performance
 * 3. In-memory caching to avoid regenerating explanations
 * 4. OpenAI call with structured prompts
 * 5. Validation with ticker extraction
 * 6. Retry logic if invalid tickers mentioned
 * 7. Fallback generation if LLM fails
 */

const { chatCompletionJSON, getRabbitBatchSize } = require("./openaiClient");

// In-memory cache for explanations (keyed by article URL + holdings hash)
// TTL: 1 hour (explanations are relatively stable within this timeframe)
const explanationCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Generate cache key for an explanation
 * @param {string} eventId - Event/article ID
 * @param {Array<string>} holdings - User holdings (sorted)
 * @returns {string} Cache key
 */
function getCacheKey(eventId, holdings) {
  const holdingsHash = holdings.sort().join(',');
  return `${eventId}||${holdingsHash}`;
}

/**
 * Get cached explanation if available and not expired
 * @param {string} eventId - Event/article ID
 * @param {Array<string>} holdings - User holdings
 * @returns {Object|null} Cached explanation or null
 */
function getCachedExplanation(eventId, holdings) {
  const key = getCacheKey(eventId, holdings);
  const cached = explanationCache.get(key);

  if (!cached) return null;

  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    explanationCache.delete(key);
    return null;
  }

  return cached.explanation;
}

/**
 * Cache an explanation
 * @param {string} eventId - Event/article ID
 * @param {Array<string>} holdings - User holdings
 * @param {Object} explanation - Explanation object
 */
function cacheExplanation(eventId, holdings, explanation) {
  const key = getCacheKey(eventId, holdings);
  explanationCache.set(key, {
    explanation,
    timestamp: Date.now(),
  });
}

/**
 * Clean up expired cache entries (called periodically)
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of explanationCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      explanationCache.delete(key);
    }
  }
}

// Run cache cleanup every 10 minutes
setInterval(cleanupCache, 10 * 60 * 1000);

/**
 * Chunk array into smaller arrays
 * @param {Array} array - Input array
 * @param {number} size - Chunk size
 * @returns {Array<Array>} Array of chunks
 */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Extract possible ticker symbols from text using regex
 * @param {string} text - Text to scan
 * @returns {Array<string>} Array of potential tickers found
 */
function extractTickers(text) {
  if (!text || typeof text !== 'string') return [];

  // Match 2-5 uppercase letters (common ticker format)
  const regex = /\b[A-Z]{2,5}\b/g;
  const matches = text.match(regex) || [];

  // Filter out common words that match ticker pattern
  const commonWords = new Set([
    'CEO', 'CFO', 'CTO', 'IPO', 'SEC', 'FDA', 'USA', 'USD', 'EUR', 'GBP',
    'ETF', 'NYSE', 'API', 'AI', 'IT', 'TV', 'UK', 'US', 'EU', 'GDP',
    'CPI', 'FED', 'NASDAQ', 'DOW', 'S&P', 'LLC', 'INC', 'LTD', 'CORP',
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER',
    'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW',
    'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY',
    'DID', 'DOWN', 'END', 'GOT', 'HAD', 'HOT', 'LET', 'MAN', 'OFF', 'OWN',
    'PUT', 'RAN', 'RUN', 'SAW', 'SAY', 'SHE', 'TOP', 'TRY', 'USE', 'WON', 'YES'
  ]);

  return matches.filter(ticker => !commonWords.has(ticker));
}

/**
 * Build the system prompt for Rabbit personalization
 * @param {Array<string>} holdings - User's holdings (tickers)
 * @returns {string} System prompt
 */
function buildSystemPrompt(holdings) {
  const holdingsText = holdings.length > 0
    ? `User's holdings: ${holdings.join(', ')}`
    : 'User has NO holdings';

  return `You are Wealthy Rabbit, a calm and insightful financial assistant. Your role is to explain market events in a personalized, educational, and non-alarmist way.

${holdingsText}

CRITICAL RULES:
1. ONLY mention tickers that are in the user's holdings list above
2. If an event mentions other tickers (e.g., BABA, META), do NOT mention them by name
3. Instead, explain indirect relations through sectors, macro trends, or say "not directly tied to your holdings"
4. NEVER use jargon like "exposure", "alpha", "beta" without explanation
5. NEVER mention platform names (Robinhood, Coinbase, etc.) or exchange names (NYSE, NASDAQ) unless you explain them inline
6. Titles must be 6-12 words, human-relatable, NO tickers, NO jargon
7. Summary must be 1-2 sentences, max 280 characters
8. Use present continuous for "whyThisIsHappeningNow" and connect past context to today
9. NEVER make price predictions or use urgency language
10. "whatToExpect" should be conditional ("if this continues...") and calm
11. "bottomLine" is environment framing only (supportive/restrictive/uncertain/unchanged)
12. "whatToWatch" should be 2-4 structural signals, NO earnings dates, NO "watch stock reaction"

You MUST return ONLY valid JSON with this exact structure:
{
  "explanations": [
    {
      "classification": {
        "eventType": "regulatory|earnings|market|product|personnel|macro|geopolitical|industry",
        "timeHorizon": "immediate|short|medium|long",
        "marketAwareness": "high|medium|low",
        "action": "NO_ACTION|MONITOR|REVIEW"
      },
      "title": "6-12 word human-relatable title, no tickers, no jargon",
      "summary": "1-2 sentences, max 280 chars",
      "whyThisMattersToYou": "2-4 sentences; reference holdings only if relevant; if no direct relation say so simply; no defensive phrases",
      "whyThisIsHappeningNow": "3-5 sentences; connect past → today; explain hard terms inline",
      "whatToExpect": "2-3 sentences; conditional phrasing; no predictions or urgency",
      "bottomLine": "1 sentence; environment framing only",
      "whatToWatch": ["signal 1", "signal 2", "signal 3"],
      "learn": [{"term": "...", "definition": "..."}, ...]
    }
  ]
}

Return one explanation object per event in the same order as provided.`;
}

/**
 * Build the user prompt with event details
 * @param {Array} events - Array of event objects
 * @returns {string} User prompt
 */
function buildUserPrompt(events) {
  const eventsText = events.map((event, idx) => {
    const rawArticles = (event.rawArticles || []).slice(0, 5);
    const articlesText = rawArticles.map((article, aIdx) => {
      return `      Article ${aIdx + 1}:
        Source: ${article.source || 'Unknown'}
        Title: ${article.title || 'No title'}
        Description: ${article.description || 'No description'}
        ${article.body ? `Body: ${article.body.substring(0, 500)}...` : ''}`;
    }).join('\n\n');

    return `Event ${idx + 1}:
  Event ID: ${event.id || 'unknown'}
  Title: ${event.title || 'No title'}
  Short Summary: ${event.shortSummary || 'N/A'}
  Ticker Summary: ${event.tickerSummary || 'N/A'}
  Impact Level: ${event.impactLevel || 'unknown'}
  Scope Type: ${event.scopeType || 'unknown'}
  Opportunity Signal: ${event.opportunitySignal || 'N/A'}
  Relevance Type: ${event.relevanceType || 'N/A'}
  Profile Tier: ${event.profileTier || 'N/A'}

  Raw Articles:
${articlesText || '  No articles available'}`;
  }).join('\n\n---\n\n');

  return `Analyze these ${events.length} event(s) and provide personalized explanations:\n\n${eventsText}`;
}

/**
 * Validate explanation object
 * @param {Object} explanation - Explanation object from LLM
 * @param {Array<string>} holdings - User's holdings
 * @returns {Object} { valid: boolean, errors: Array<string>, invalidTickers: Array<string> }
 */
function validateExplanation(explanation, holdings) {
  const errors = [];
  const invalidTickers = [];

  // Check required fields
  if (!explanation.classification) errors.push('Missing classification');
  if (!explanation.title || typeof explanation.title !== 'string') errors.push('Missing or invalid title');
  if (!explanation.summary || typeof explanation.summary !== 'string') errors.push('Missing or invalid summary');
  if (!explanation.whyThisMattersToYou) errors.push('Missing whyThisMattersToYou');
  if (!explanation.whyThisIsHappeningNow) errors.push('Missing whyThisIsHappeningNow');
  if (!explanation.whatToExpect) errors.push('Missing whatToExpect');
  if (!explanation.bottomLine) errors.push('Missing bottomLine');
  if (!explanation.whatToWatch || !Array.isArray(explanation.whatToWatch)) errors.push('Missing or invalid whatToWatch');

  // Validate summary length
  if (explanation.summary && explanation.summary.length > 280) {
    errors.push(`Summary too long (${explanation.summary.length} chars, max 280)`);
  }

  // Validate whatToWatch length
  if (explanation.whatToWatch && (explanation.whatToWatch.length < 2 || explanation.whatToWatch.length > 4)) {
    errors.push(`whatToWatch must have 2-4 items (has ${explanation.whatToWatch.length})`);
  }

  // Extract tickers from all text fields
  const allText = [
    explanation.title,
    explanation.summary,
    explanation.whyThisMattersToYou,
    explanation.whyThisIsHappeningNow,
    explanation.whatToExpect,
    explanation.bottomLine,
    ...(explanation.whatToWatch || [])
  ].filter(Boolean).join(' ');

  const foundTickers = extractTickers(allText);
  const holdingsSet = new Set(holdings.map(h => h.toUpperCase()));

  // Check if any found tickers are NOT in holdings
  for (const ticker of foundTickers) {
    if (!holdingsSet.has(ticker)) {
      invalidTickers.push(ticker);
    }
  }

  return {
    valid: errors.length === 0 && invalidTickers.length === 0,
    errors,
    invalidTickers,
  };
}

/**
 * Generate fallback explanation for an event
 * @param {Object} event - Event object
 * @param {Array<string>} holdings - User's holdings
 * @returns {Object} Fallback explanation
 */
function generateFallbackExplanation(event, holdings) {
  const impactLevel = event.impactLevel || 'medium';
  const scopeType = event.scopeType || 'market';
  const title = event.title || 'Market Update';

  // Generate human-relatable title (no tickers)
  let fallbackTitle = 'Market activity requires attention';
  if (title.toLowerCase().includes('regula')) fallbackTitle = 'New regulatory developments affecting markets';
  else if (title.toLowerCase().includes('rate') || title.toLowerCase().includes('fed')) fallbackTitle = 'Central bank policy shift in progress';
  else if (title.toLowerCase().includes('earning')) fallbackTitle = 'Corporate earnings season update';
  else if (title.toLowerCase().includes('merger') || title.toLowerCase().includes('acquisition')) fallbackTitle = 'Major corporate restructuring announced';
  else if (impactLevel === 'high') fallbackTitle = 'Significant market event underway';

  // Generate summary
  const fallbackSummary = event.shortSummary ||
    `Market conditions are evolving based on recent developments. This may affect the broader investment landscape.`;

  // Generate whyThisMattersToYou based on holdings
  let whyMatters = '';
  if (holdings.length > 0) {
    whyMatters = `This development may have indirect effects on your portfolio through ${scopeType === 'macro' ? 'broad market trends' : 'sector dynamics'}. `;
    whyMatters += `While not directly tied to ${holdings.join(', ')}, understanding these shifts helps you stay informed about the investment environment.`;
  } else {
    whyMatters = 'This development reflects broader market dynamics. Understanding these trends helps you make informed investment decisions as you build your portfolio.';
  }

  // Generate whyThisIsHappeningNow
  const whyNow = `This situation is unfolding as markets respond to recent announcements and regulatory changes. ` +
    `The immediate reaction reflects uncertainty as investors process new information. ` +
    `These types of developments typically take weeks to fully materialize as details become clearer.`;

  // Generate whatToExpect
  const whatExpect = `If current conditions persist, expect continued market discussions and analysis. ` +
    `The situation will likely evolve as more information becomes available and stakeholders respond. ` +
    `Stay informed through reliable sources and avoid making hasty decisions based on short-term volatility.`;

  // Generate bottomLine
  let bottomLine = 'The market environment remains dynamic';
  if (impactLevel === 'high') bottomLine = 'The market environment is experiencing heightened uncertainty';
  else if (impactLevel === 'low') bottomLine = 'The market environment remains largely stable';
  else if (event.opportunitySignal === 'positive') bottomLine = 'The market environment shows some supportive signals';
  else if (event.opportunitySignal === 'negative') bottomLine = 'The market environment shows some restrictive signals';

  // Generate whatToWatch
  const whatToWatch = [
    'Follow-up announcements from key institutions',
    'Broader market reaction and sector trends',
  ];

  if (scopeType === 'regulatory') {
    whatToWatch.push('Implementation timeline and compliance requirements');
  } else if (scopeType === 'macro') {
    whatToWatch.push('Economic data releases and central bank commentary');
  } else {
    whatToWatch.push('Industry analyst perspectives and company responses');
  }

  return {
    classification: {
      eventType: scopeType || 'market',
      timeHorizon: impactLevel === 'high' ? 'short' : 'medium',
      marketAwareness: impactLevel === 'high' ? 'high' : 'medium',
      action: impactLevel === 'high' ? 'MONITOR' : 'NO_ACTION',
    },
    title: fallbackTitle,
    summary: fallbackSummary.substring(0, 280),
    whyThisMattersToYou: whyMatters,
    whyThisIsHappeningNow: whyNow,
    whatToExpect: whatExpect,
    bottomLine: bottomLine,
    whatToWatch: whatToWatch,
    learn: [],
  };
}

/**
 * Generate explanations for a batch of events using OpenAI
 * @param {Array} events - Array of event objects (max 5)
 * @param {Array<string>} holdings - User's holdings
 * @param {boolean} isRetry - Whether this is a retry attempt
 * @returns {Promise<Array>} Array of explanation objects
 */
async function generateExplanationsForBatch(events, holdings, isRetry = false) {
  try {
    const systemPrompt = buildSystemPrompt(holdings);
    const userPrompt = buildUserPrompt(events);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    if (isRetry) {
      messages.push({
        role: 'user',
        content: 'IMPORTANT: You mentioned tickers not in the user\'s holdings list. Please remove ALL mentions of tickers that are not in the holdings list. Use sector names or macro trends instead. Return the same JSON schema with corrected explanations.',
      });
    }

    const response = await chatCompletionJSON(messages, {
      temperature: isRetry ? 0.4 : 0.6,
      max_tokens: 4000,
    });

    if (!response.explanations || !Array.isArray(response.explanations)) {
      throw new Error('Invalid response format: missing explanations array');
    }

    if (response.explanations.length !== events.length) {
      console.warn(`[Rabbit] Expected ${events.length} explanations, got ${response.explanations.length}`);
    }

    return response.explanations;
  } catch (error) {
    console.error('[Rabbit] Error generating explanations:', error.message);
    throw error;
  }
}

/**
 * Generate explanations with validation and retry
 * @param {Array} events - Array of event objects (max 5)
 * @param {Array<string>} holdings - User's holdings
 * @returns {Promise<Array>} Array of explanation objects
 */
async function generateExplanationsWithValidation(events, holdings) {
  try {
    // First attempt
    let explanations = await generateExplanationsForBatch(events, holdings, false);

    // Validate each explanation
    const validationResults = explanations.map(exp => validateExplanation(exp, holdings));
    const hasInvalidTickers = validationResults.some(result => result.invalidTickers.length > 0);

    // If invalid tickers found, retry once
    if (hasInvalidTickers && !process.env.SKIP_RETRY) {
      const invalidTickersList = validationResults
        .flatMap(r => r.invalidTickers)
        .filter((v, i, a) => a.indexOf(v) === i); // unique

      console.warn(`[Rabbit] Invalid tickers found: ${invalidTickersList.join(', ')}. Retrying...`);

      explanations = await generateExplanationsForBatch(events, holdings, true);

      // Validate again
      const retryValidation = explanations.map(exp => validateExplanation(exp, holdings));
      const stillInvalid = retryValidation.some(result => result.invalidTickers.length > 0);

      if (stillInvalid) {
        console.error('[Rabbit] Still invalid after retry, using fallbacks');
        // Use fallbacks for invalid explanations
        return events.map((event, idx) => {
          const validation = retryValidation[idx];
          if (validation && validation.invalidTickers.length === 0) {
            return explanations[idx];
          }
          return generateFallbackExplanation(event, holdings);
        });
      }
    }

    // Check for other validation errors
    const hasOtherErrors = validationResults.some(result => result.errors.length > 0);
    if (hasOtherErrors) {
      console.warn('[Rabbit] Validation errors found, using fallbacks for invalid items');
      return events.map((event, idx) => {
        const validation = validationResults[idx];
        if (validation && validation.valid) {
          return explanations[idx];
        }
        console.warn(`[Rabbit] Event ${idx} validation errors:`, validation?.errors);
        return generateFallbackExplanation(event, holdings);
      });
    }

    return explanations;
  } catch (error) {
    console.error('[Rabbit] Error in generateExplanationsWithValidation:', error.message);
    // Return all fallbacks on complete failure
    return events.map(event => generateFallbackExplanation(event, holdings));
  }
}

/**
 * Generate Rabbit explanations for all events (with batching)
 * OPTIMIZED: Checks cache first, processes batches in parallel for better performance
 * @param {Array} events - Array of event objects
 * @param {Array<string>} holdings - User's holdings
 * @returns {Promise<Array>} Array of explanation objects (same length as events)
 */
async function generateRabbitExplanations(events, holdings) {
  if (!events || events.length === 0) {
    return [];
  }

  // Check cache for each event
  const explanations = new Array(events.length);
  const uncachedEvents = [];
  const uncachedIndices = [];

  let cacheHits = 0;
  for (let i = 0; i < events.length; i++) {
    const cached = getCachedExplanation(events[i].id, holdings);
    if (cached) {
      explanations[i] = cached;
      cacheHits++;
    } else {
      uncachedEvents.push(events[i]);
      uncachedIndices.push(i);
    }
  }

  if (cacheHits > 0) {
    console.log(`[Rabbit] Cache hit: ${cacheHits}/${events.length} explanations (${Math.round(cacheHits/events.length*100)}%)`);
  }

  // If all cached, return immediately
  if (uncachedEvents.length === 0) {
    console.log(`[Rabbit] All ${events.length} explanations served from cache`);
    return explanations;
  }

  // Generate explanations for uncached events
  const batchSize = getRabbitBatchSize();
  const chunks = chunk(uncachedEvents, batchSize);

  console.log(`[Rabbit] Generating ${uncachedEvents.length} new explanations in ${chunks.length} batches (size: ${batchSize}) - PARALLEL MODE`);

  // Process all batches in parallel using Promise.all
  const batchPromises = chunks.map(async (chunkEvents, i) => {
    console.log(`[Rabbit] Starting batch ${i + 1}/${chunks.length} (${chunkEvents.length} events)`);

    try {
      const batchExplanations = await generateExplanationsWithValidation(chunkEvents, holdings);
      console.log(`[Rabbit] ✓ Batch ${i + 1}/${chunks.length} complete`);
      return batchExplanations;
    } catch (error) {
      console.error(`[Rabbit] Error processing batch ${i + 1}:`, error.message);
      // Use fallbacks for entire batch on error
      const fallbacks = chunkEvents.map(event => generateFallbackExplanation(event, holdings));
      return fallbacks;
    }
  });

  // Wait for all batches to complete
  const batchResults = await Promise.all(batchPromises);

  // Flatten results into single array
  const newExplanations = batchResults.flat();

  // Insert new explanations into correct positions and cache them
  for (let i = 0; i < uncachedIndices.length; i++) {
    const explanation = newExplanations[i];
    const originalIndex = uncachedIndices[i];
    explanations[originalIndex] = explanation;

    // Cache the new explanation
    cacheExplanation(uncachedEvents[i].id, holdings, explanation);
  }

  console.log(`[Rabbit] Complete: ${newExplanations.length} generated, ${cacheHits} from cache, ${explanations.length} total`);
  return explanations;
}

/**
 * Attach explanations to events
 * @param {Array} events - Array of event objects
 * @param {Array} explanations - Array of explanation objects
 * @returns {Array} Events with explanation field attached
 */
function attachExplanations(events, explanations) {
  return events.map((event, idx) => ({
    ...event,
    explanation: explanations[idx] || generateFallbackExplanation(event, []),
  }));
}

module.exports = {
  generateRabbitExplanations,
  attachExplanations,
  generateFallbackExplanation,
};
