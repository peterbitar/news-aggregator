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

  return `You are Wealthy Rabbit, a calm and insightful financial assistant. Your role is to explain market events in a personalized, educational, and non-alarmist way for NON-FINANCE PROFESSIONALS.

${holdingsText}

CRITICAL RULES FOR NON-FINANCE PROFESSIONALS:
1. PERSONALIZATION IS MANDATORY:
   - If user has holdings and event is relevant: ALWAYS mention holdings by name (e.g., "If you own AAPL..." or "This affects your Apple stock...")
   - If no direct connection: Explain WHY it matters to their portfolio anyway (sector trends, market sentiment, etc.)
   - NEVER use generic phrases like "may affect your portfolio" without specifics

2. SPECIFICITY IS REQUIRED:
   - "whatToWatch" must include SPECIFIC dates, events, or milestones (e.g., "Federal Reserve meeting on January 31st", "Apple earnings report expected in late January")
   - Use concrete examples, not vague statements
   - Include specific company names, dates, or events when available

3. EDUCATION FOR NON-PROFESSIONALS:
   - Explain ALL financial terms immediately inline: "Earnings (how much money a company made)..."
   - Use simple analogies: "Think of this like a company getting a good review..."
   - Build understanding: "This is similar to when..." or "Normally, this type of news..."
   - Add terms to "learn" array with simple definitions

4. ONLY mention tickers that are in the user's holdings list above
5. If an event mentions other tickers (e.g., BABA, META), do NOT mention them by name
6. Instead, explain indirect relations through sectors, macro trends, or say "not directly tied to your holdings"
7. NEVER use jargon like "exposure", "alpha", "beta" without immediate explanation
8. NEVER mention platform names (Robinhood, Coinbase, etc.) or exchange names (NYSE, NASDAQ) unless you explain them inline
9. Titles must be 6-12 words, SPECIFIC and COMPELLING for non-finance professionals:
   - Be SPECIFIC about what's happening: "Why Interest Rate Cuts Are Boosting Your Tech Stocks" (not "What This Means for Your Investments")
   - Create CURIOSITY: "The Fed's Next Move Could Change Everything" or "Why Apple and Google Are Riding This Wave"
   - Mention SPECIFIC companies/sectors when relevant: "Why Your Tech Stocks Are Soaring" (if user has tech holdings)
   - Use ACTION words: "boosting", "driving", "fueling", "shifting" - not passive "means" or "affects"
   - Make it IRRESISTIBLE to read - hint at the interesting part, not just "what this means"
   - Avoid generic phrases like "What This Means", "Market Update", "Investment News"
   - NO tickers, NO jargon, NO all-caps
10. Summary must be 1-2 sentences, max 280 characters
11. Use present continuous for "whyThisIsHappeningNow" and connect past context to today
12. NEVER make price predictions or use urgency language
13. "whatToExpect" should be conditional ("if this continues...") and calm
14. "bottomLine" must be clear and reassuring: "This is good news for your investments" or "This doesn't change anything for you right now" or "This creates some uncertainty, but here's why you don't need to worry"
15. "whatToWatch" should be 2-4 SPECIFIC items with FUTURE dates/events when possible (only include dates AFTER the current date provided in the prompt), NO generic "watch stock reaction", NO past dates

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
      "title": "6-12 word SPECIFIC, compelling title that creates curiosity and mentions what's actually happening (use action words like 'boosting', 'driving', 'fueling' - avoid generic 'what this means'). If user has holdings, hint at how it affects them specifically. Make it irresistible to read.",
      "summary": "1-2 sentences, max 280 chars",
      "whyThisMattersToYou": "2-4 sentences; MUST mention holdings by name if relevant; explain WHY it matters even if indirect; use simple language",
      "whyThisIsHappeningNow": "3-5 sentences; connect past → today; explain ALL hard terms inline with simple definitions",
      "whatToExpect": "2-3 sentences; conditional phrasing; no predictions or urgency; use analogies when helpful",
      "bottomLine": "1 sentence; clear and reassuring; specific to their situation",
      "whatToWatch": ["specific item with date/event if available", "specific item 2", "specific item 3"],
      "learn": [{"term": "...", "definition": "simple definition for non-professionals"}, ...]
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
  const now = new Date();
  const currentDateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const eventsText = events.map((event, idx) => {
    const rawArticles = (event.rawArticles || []).slice(0, 5);
    const articlesText = rawArticles.map((article, aIdx) => {
      return `      Article ${aIdx + 1}:
        Source: ${article.source || 'Unknown'}
        Title: ${article.title || 'No title'}
        Description: ${article.description || 'No description'}
        ${article.body ? `Body: ${article.body.substring(0, 1000)}...` : ''}`;
    }).join('\n\n');

    // Extract dates and specific events from articles
    const allText = rawArticles.map(a => `${a.title || ''} ${a.description || ''} ${a.body || ''}`).join(' ');
    const dateMatches = allText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}[,\s]+\d{4}\b/g) || [];
    const dateMatches2 = allText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [];
    const dates = [...dateMatches, ...dateMatches2].slice(0, 3);

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
  ${dates.length > 0 ? `Important Dates Found in Article: ${dates.join(', ')}` : ''}

  Raw Articles:
${articlesText || '  No articles available'}`;
  }).join('\n\n---\n\n');

  return `CURRENT DATE: ${currentDateStr}

Analyze these ${events.length} event(s) and provide personalized explanations for NON-FINANCE PROFESSIONALS. Be specific, mention holdings by name when relevant, include FUTURE dates/events in "whatToWatch" (only include dates that are AFTER ${currentDateStr}), and explain all terms simply:\n\n${eventsText}`;
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
  const warnings = [];

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

  // Check for personalization (if holdings exist)
  if (holdings.length > 0 && explanation.whyThisMattersToYou) {
    const whyMattersText = explanation.whyThisMattersToYou.toLowerCase();
    const hasGenericPhrases = whyMattersText.includes('may affect') || 
                             whyMattersText.includes('could impact') ||
                             whyMattersText.includes('might influence');
    
    // Check if any holdings are mentioned
    const holdingsSet = new Set(holdings.map(h => h.toUpperCase()));
    const mentionedHoldings = holdings.filter(h => whyMattersText.includes(h.toLowerCase()));
    
    if (hasGenericPhrases && mentionedHoldings.length === 0) {
      warnings.push('Generic language detected without specific holdings mention');
    }
  }

  // Check for specificity in whatToWatch
  if (explanation.whatToWatch && Array.isArray(explanation.whatToWatch)) {
    const genericPhrases = ['watch stock reaction', 'monitor market', 'follow developments', 'track trends'];
    const hasGeneric = explanation.whatToWatch.some(item => 
      genericPhrases.some(phrase => item.toLowerCase().includes(phrase))
    );
    if (hasGeneric) {
      warnings.push('Generic "whatToWatch" items detected - should be more specific');
    }
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
    warnings,
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

  // Generate SPECIFIC, compelling title for non-finance professionals (no tickers)
  let fallbackTitle = 'Why This Market Shift Is Happening Now';
  if (title.toLowerCase().includes('regula')) fallbackTitle = 'New Rules Are Reshaping How Companies Operate';
  else if (title.toLowerCase().includes('rate') || title.toLowerCase().includes('fed')) {
    if (holdings.length > 0) {
      fallbackTitle = 'Why Interest Rate Cuts Could Boost Your Stocks';
    } else {
      fallbackTitle = 'The Fed\'s Rate Decision Is Shaking Up Markets';
    }
  }
  else if (title.toLowerCase().includes('earning')) fallbackTitle = 'How Earnings Season Could Impact Your Portfolio';
  else if (title.toLowerCase().includes('merger') || title.toLowerCase().includes('acquisition')) fallbackTitle = 'Why Major Companies Are Joining Forces';
  else if (title.toLowerCase().includes('record') || title.toLowerCase().includes('high')) {
    if (holdings.length > 0) {
      fallbackTitle = 'Why Your Stocks Are Riding This Market Wave';
    } else {
      fallbackTitle = 'What\'s Driving Stock Markets to Record Highs';
    }
  }
  else if (impactLevel === 'high') fallbackTitle = 'Why This Market Event Is Making Headlines';

  // Generate summary
  const fallbackSummary = event.shortSummary ||
    `Market conditions are evolving based on recent developments. This may affect the broader investment landscape.`;

  // Generate whyThisMattersToYou based on holdings - IMPROVED FOR NON-PROFESSIONALS
  let whyMatters = '';
  if (holdings.length > 0) {
    const holdingsList = holdings.join(', ');
    // Try to extract company names from common tickers
    const tickerNames = {
      'AAPL': 'Apple',
      'MSFT': 'Microsoft',
      'GOOGL': 'Google',
      'AMZN': 'Amazon',
      'TSLA': 'Tesla',
      'META': 'Meta (Facebook)',
      'NVDA': 'Nvidia',
      'JPM': 'JPMorgan',
      'V': 'Visa',
      'JNJ': 'Johnson & Johnson',
    };
    
    const companyNames = holdings.map(t => tickerNames[t.toUpperCase()] || t).join(', ');
    
    whyMatters = `If you own ${companyNames} stock, this news creates a ${impactLevel === 'high' ? 'more significant' : 'moderate'} impact on the market environment. `;
    whyMatters += `Think of it like a ripple effect - even if this doesn't directly change your ${companyNames} shares, it affects the overall market mood that influences all investments. `;
    whyMatters += `Understanding these shifts helps you stay informed about what's happening in the investment world.`;
  } else {
    whyMatters = 'This development reflects broader market dynamics. Understanding these trends helps you make informed investment decisions as you build your portfolio. ' +
      `Think of it like weather patterns - even if you're not directly affected, knowing what's happening helps you plan better.`;
  }

  // Generate whyThisIsHappeningNow - IMPROVED WITH EDUCATION
  let whyNow = `This situation is unfolding as markets respond to recent announcements and changes. `;
  if (scopeType === 'regulatory') {
    whyNow += `Regulatory changes (new rules from government agencies) often create uncertainty as companies figure out how to comply. `;
  } else if (scopeType === 'macro') {
    whyNow += `Macroeconomic events (big-picture economic trends) affect the entire market, not just individual companies. `;
  } else {
    whyNow += `These types of developments typically take weeks to fully materialize as details become clearer. `;
  }
  whyNow += `The immediate reaction reflects investors processing new information and adjusting their expectations. `;
  whyNow += `This is normal market behavior - prices and sentiment change as news is digested.`;

  // Generate whatToExpect - IMPROVED WITH ANALOGIES
  const whatExpect = `If current conditions persist, you can expect continued market discussions and analysis over the coming weeks. ` +
    `Think of it like a news story that develops over time - more details will emerge, and the full picture will become clearer. ` +
    `The situation will likely evolve as more information becomes available and companies respond. ` +
    `This is normal, so you don't need to make any immediate changes to your investment strategy.`;

  // Generate bottomLine - IMPROVED TO BE MORE REASSURING AND SPECIFIC
  let bottomLine = '';
  if (holdings.length > 0) {
    if (impactLevel === 'high') {
      bottomLine = 'This creates some uncertainty in the market, but your investments are still part of a diversified portfolio that can weather these changes.';
    } else if (event.opportunitySignal === 'positive') {
      bottomLine = 'This is generally positive news for the market environment, which could be supportive for your investments over time.';
    } else if (event.opportunitySignal === 'negative') {
      bottomLine = 'This creates some headwinds, but it doesn\'t change the fundamental value of your investments - market fluctuations are normal.';
    } else {
      bottomLine = 'This doesn\'t change anything significant for your investments right now - it\'s part of normal market activity.';
    }
  } else {
    bottomLine = 'This is part of normal market dynamics - understanding these trends helps you make informed decisions as you build your portfolio.';
  }

  // Generate whatToWatch - IMPROVED TO BE MORE SPECIFIC
  const whatToWatch = [];
  
  if (scopeType === 'regulatory') {
    whatToWatch.push('Implementation timeline for new regulations (watch for specific dates)');
    whatToWatch.push('Company responses and compliance announcements');
    whatToWatch.push('Sector-wide impact as rules take effect');
  } else if (scopeType === 'macro') {
    whatToWatch.push('Upcoming economic data releases (check calendar for dates)');
    whatToWatch.push('Central bank statements and policy decisions');
    whatToWatch.push('Market sentiment indicators over the next few weeks');
  } else if (scopeType === 'earnings') {
    whatToWatch.push('Upcoming earnings reports from major companies');
    whatToWatch.push('Analyst expectations vs. actual results');
    whatToWatch.push('Company guidance for future quarters');
  } else {
    whatToWatch.push('Follow-up announcements from key institutions');
    whatToWatch.push('Broader market reaction and sector trends');
    whatToWatch.push('Industry analyst perspectives and company responses');
  }

  // Add learn terms for non-professionals
  const learn = [];
  if (scopeType === 'regulatory') {
    learn.push({ term: 'Regulatory changes', definition: 'New rules or policies from government agencies that affect how companies operate' });
  }
  if (scopeType === 'macro') {
    learn.push({ term: 'Macroeconomic events', definition: 'Big-picture economic trends that affect the entire market, not just individual companies' });
  }
  if (impactLevel === 'high') {
    learn.push({ term: 'Market volatility', definition: 'Normal ups and downs in stock prices as investors react to news' });
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
    learn: learn,
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
        content: 'IMPORTANT CORRECTIONS NEEDED:\n' +
          '1. You mentioned tickers not in the user\'s holdings list. Remove ALL mentions of tickers that are not in the holdings list.\n' +
          '2. If user has holdings, you MUST mention them by name in "whyThisMattersToYou" (e.g., "If you own AAPL..." or "This affects your Apple stock...").\n' +
          '3. Make "whatToWatch" more specific with dates/events when possible, not generic phrases.\n' +
          '4. Use simple analogies and explain all terms for non-finance professionals.\n' +
          'Return the same JSON schema with corrected, personalized explanations.',
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

    // Log warnings for quality monitoring
    validationResults.forEach((result, idx) => {
      if (result.warnings && result.warnings.length > 0) {
        console.warn(`[Rabbit] Quality warnings for event ${idx}:`, result.warnings);
      }
    });

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
