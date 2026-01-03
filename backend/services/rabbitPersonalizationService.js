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

  return `You are Wealthy Rabbit, a calm and insightful financial assistant for non-finance professionals.

Your ONLY goal: Help users understand what's happening, whether it matters to them, and what usually happens next.
Result: Users walk away CALMER, not more alert or reactive.

${holdingsText}

MANDATORY 6-PART EXPLANATION STRUCTURE (EXACT ORDER):

1. SUMMARY (3-5 sentences, plain English, <15 sec read)
   - What is this about, in simple terms?
   - NO jargon, NO interpretation
   - Readable in under 15 seconds

2. WHY IT MATTERS FOR YOU (1-2 paragraphs)
   - Explicitly state who this affects and who it doesn't
   - Personal framing tied to holdings
   - Avoid vague phrases like "important for investors"
   - Answer: "Should I care? In what way does this touch my life or peace of mind?"

3. WHY THIS HAPPENED (1-2 paragraphs)
   - Clear causal chain
   - Step-by-step logic, no speculation
   - If technical term appears → define it immediately
   - Use everyday examples when possible
   - Goal: "I understand why this exists, not just that it exists"

4. MOST LIKELY SCENARIOS (2-3 scenarios with this structure for EACH)
   - "scenario": Short description
   - "likelihood": "Low" / "Medium" / "High" (NO percentages)
   - "whatConfirmsIt": Signal to watch for
   - "whatMakesItUnlikely": Counter-signals
   - Tone: "Here are the paths this type of situation usually takes"
   - NO price targets framed as advice
   - NO urgency
   - NO "this will happen"

5. WHAT TO KEEP IN MIND (3-5 bullets)
   - Emotional guardrails and cognitive closure
   - Common misunderstandings
   - Why people overreact to this type of news
   - Goal: Actively lower stress
   - Examples: "One good quarter doesn't guarantee future performance", "This doesn't change your investment strategy"

6. SOURCES (transparent, no urgency)
   - Array of source objects with: name, type (Primary/Secondary), reason
   - User-facing context: "Listed so you know where info comes from — not because you need to read them"

HARD RULES:
- No buy/sell advice
- No price targets framed as guidance
- No urgency language ("breaking", "urgent", "must")
- No emotional manipulation
- No assumption of financial sophistication
- Only mention holdings that are in the user's list above
- Short sentences (aim <20 words)
- Define finance terms instantly
- Calm tone
- If reader still has "so what?" questions → explanation is incomplete

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
      "summary": "3-5 sentences, plain English, <15 sec read",
      "whyItMattersForYou": "1-2 paragraphs; explicit: who affects, who doesn't; personal framing",
      "whyThisHappened": "1-2 paragraphs; causal chain; define terms inline; use everyday examples",
      "mostLikelyScenarios": [
        {
          "scenario": "Short description",
          "likelihood": "Low|Medium|High",
          "whatConfirmsIt": "Signal to watch for",
          "whatMakesItUnlikely": "Counter-signals"
        }
      ],
      "whatToKeepInMind": ["guardrail 1", "guardrail 2", "guardrail 3"],
      "sources": [
        {
          "name": "Source name",
          "type": "Primary|Secondary",
          "reason": "Why this source matters"
        }
      ]
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

  // Check required fields (6-part structure)
  if (!explanation.classification) errors.push('Missing classification');
  if (!explanation.summary || typeof explanation.summary !== 'string') errors.push('Missing or invalid summary');
  if (!explanation.whyItMattersForYou) errors.push('Missing whyItMattersForYou');
  if (!explanation.whyThisHappened) errors.push('Missing whyThisHappened');
  if (!explanation.mostLikelyScenarios || !Array.isArray(explanation.mostLikelyScenarios)) errors.push('Missing or invalid mostLikelyScenarios');
  if (!explanation.whatToKeepInMind || !Array.isArray(explanation.whatToKeepInMind)) errors.push('Missing or invalid whatToKeepInMind');
  if (!explanation.sources || !Array.isArray(explanation.sources)) errors.push('Missing or invalid sources');

  // Validate scenarios structure
  if (explanation.mostLikelyScenarios && Array.isArray(explanation.mostLikelyScenarios)) {
    if (explanation.mostLikelyScenarios.length < 2 || explanation.mostLikelyScenarios.length > 3) {
      errors.push(`mostLikelyScenarios must have 2-3 items (has ${explanation.mostLikelyScenarios.length})`);
    }
    for (let i = 0; i < explanation.mostLikelyScenarios.length; i++) {
      const scenario = explanation.mostLikelyScenarios[i];
      if (!scenario.scenario) errors.push(`Scenario ${i+1}: missing scenario description`);
      if (!['Low', 'Medium', 'High'].includes(scenario.likelihood)) errors.push(`Scenario ${i+1}: invalid likelihood (must be Low/Medium/High)`);
      if (!scenario.whatConfirmsIt) errors.push(`Scenario ${i+1}: missing whatConfirmsIt`);
      if (!scenario.whatMakesItUnlikely) errors.push(`Scenario ${i+1}: missing whatMakesItUnlikely`);
    }
  }

  // Validate whatToKeepInMind length
  if (explanation.whatToKeepInMind && (explanation.whatToKeepInMind.length < 3 || explanation.whatToKeepInMind.length > 5)) {
    warnings.push(`whatToKeepInMind should have 3-5 items (has ${explanation.whatToKeepInMind.length})`);
  }

  // Validate sources
  if (explanation.sources && Array.isArray(explanation.sources)) {
    if (explanation.sources.length < 1) {
      errors.push('Must include at least 1 source');
    }
    for (let i = 0; i < explanation.sources.length; i++) {
      const source = explanation.sources[i];
      if (!source.name) errors.push(`Source ${i+1}: missing name`);
      if (!['Primary', 'Secondary'].includes(source.type)) errors.push(`Source ${i+1}: invalid type (must be Primary/Secondary)`);
      if (!source.reason) errors.push(`Source ${i+1}: missing reason`);
    }
  }

  // Check for calm tone (detect urgency language)
  const urgencyWords = ['breaking', 'urgent', 'must', 'immediately', 'critical', 'emergency'];
  const allText = [
    explanation.summary,
    explanation.whyItMattersForYou,
    explanation.whyThisHappened,
    ...(explanation.whatToKeepInMind || [])
  ].filter(Boolean).join(' ').toLowerCase();

  for (const word of urgencyWords) {
    if (allText.includes(word)) {
      errors.push(`Urgency language detected: "${word}" (should be calm tone)`);
    }
  }

  // Extract tickers from all text fields
  const textToCheck = [
    explanation.summary,
    explanation.whyItMattersForYou,
    explanation.whyThisHappened,
    ...(explanation.whatToKeepInMind || [])
  ].filter(Boolean).join(' ');

  const foundTickers = extractTickers(textToCheck);
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
 * @returns {Object} Fallback explanation (6-part structure)
 */
function generateFallbackExplanation(event, holdings) {
  const impactLevel = event.impactLevel || 'medium';
  const scopeType = event.scopeType || 'market';
  const eventTitle = event.title || 'Market Update';

  const tickerNames = {
    'AAPL': 'Apple', 'MSFT': 'Microsoft', 'GOOGL': 'Google', 'AMZN': 'Amazon',
    'TSLA': 'Tesla', 'META': 'Meta', 'NVDA': 'Nvidia', 'JPM': 'JPMorgan',
    'V': 'Visa', 'JNJ': 'Johnson & Johnson',
  };

  const companyNames = holdings.length > 0
    ? holdings.map(t => tickerNames[t.toUpperCase()] || t).join(', ')
    : null;

  // 1. SUMMARY (3-5 sentences)
  const summary = event.shortSummary ||
    `Markets are responding to recent developments. This reflects the normal process of financial markets adjusting to new information. Changes like these happen regularly as economic conditions evolve.`;

  // 2. WHY IT MATTERS FOR YOU (explicit who/who doesn't)
  let whyItMattersForYou = '';
  if (holdings.length > 0) {
    whyItMattersForYou = `If you own ${companyNames}, this news affects the market environment around your investments. It does NOT mean you should buy more or sell now. `;
    whyItMattersForYou += `For those without these holdings, this may not directly impact you right now. `;
    whyItMattersForYou += `Understanding the context helps you feel less anxious about normal market activity.`;
  } else {
    whyItMattersForYou = `This development affects the broader market, even if you don't have specific investments yet. `;
    whyItMattersForYou += `It's part of normal economic cycles. Understanding these trends helps you build confidence as you grow your portfolio.`;
  }

  // 3. WHY THIS HAPPENED (causal chain, define terms)
  let whyThisHappened = '';
  if (scopeType === 'regulatory') {
    whyThisHappened = `Government agencies periodically introduce new rules (called regulations) to govern how companies operate. `;
    whyThisHappened += `These changes typically aim to protect consumers or ensure fair markets. `;
    whyThisHappened += `Companies need time to adjust their operations to comply, which creates temporary uncertainty.`;
  } else if (scopeType === 'macro') {
    whyThisHappened = `Large economic trends (called macroeconomic events) affect the entire financial system. `;
    whyThisHappened += `Things like interest rate changes, inflation shifts, or employment trends influence how companies perform. `;
    whyThisHappened += `Markets react to these changes as investors adjust their expectations about future company earnings.`;
  } else if (scopeType === 'earnings') {
    whyThisHappened = `Companies regularly report their financial results (called earnings). `;
    whyThisHappened += `When results exceed or miss expectations, markets react based on what this means for the company's future. `;
    whyThisHappened += `This is normal and expected behavior as investors process new financial data.`;
  } else {
    whyThisHappened = `This situation unfolded as markets responded to new information. `;
    whyThisHappened += `Investors process this data and adjust their views about future prospects. `;
    whyThisHappened += `This is a natural part of how financial markets function.`;
  }

  // 4. MOST LIKELY SCENARIOS (2-3 scenarios with structure)
  const scenarios = [];

  scenarios.push({
    scenario: 'Situation stabilizes within 2-4 weeks',
    likelihood: 'Medium',
    whatConfirmsIt: `Market volatility decreases; news coverage fades; investors adjust and move on`,
    whatMakesItUnlikely: `Ongoing negative developments; major economic deterioration; regulatory escalation`
  });

  if (impactLevel === 'high') {
    scenarios.push({
      scenario: 'Market overreacts temporarily with sharp price swings',
      likelihood: 'Medium',
      whatConfirmsIt: `Stock prices move 5%+ in either direction; emotional trading increases`,
      whatMakesItUnlikely: `Markets remain calm; pricing remains stable; minimal trading volume`
    });
  }

  scenarios.push({
    scenario: 'Situation evolves gradually with minor ongoing adjustments',
    likelihood: 'Low',
    whatConfirmsIt: `News continues trickling out; prices shift incrementally; gradual repricing`,
    whatMakesItUnlikely: `Sudden resolution; clear outcome emerges quickly; market stabilizes`
  });

  // 5. WHAT TO KEEP IN MIND (3-5 emotional guardrails)
  const whatToKeepInMind = [
    'Market volatility is normal. Price swings happen regularly and are part of healthy markets.',
    holdings.length > 0
      ? `Your investment strategy is based on your long-term goals, not daily events. Don't change your plan based on news cycles.`
      : `Building wealth takes time. Single events rarely derail long-term plans.`,
    'It\'s common to feel the urge to "do something" when you hear news. Resist that urge. Most investors who stay calm outperform those who react emotionally.',
    'Media coverage tends to emphasize dramatic stories. That\'s their job, not a signal that you need to act.',
    holdings.length > 0
      ? `Checking your portfolio daily increases anxiety without improving outcomes. Trust your diversification.`
      : `The market will always have noise. Focus on understanding long-term trends, not daily headlines.`
  ];

  // 6. SOURCES (transparent)
  const sources = [
    {
      name: event.rawArticles && event.rawArticles.length > 0 ? event.rawArticles[0].source : 'Financial News',
      type: 'Secondary',
      reason: 'News coverage and market analysis'
    },
    {
      name: 'Federal Reserve / Central Bank Data',
      type: 'Primary',
      reason: 'Official economic and policy information'
    },
    {
      name: 'Market Data & Historical Patterns',
      type: 'Primary',
      reason: 'Context for how similar situations typically resolve'
    }
  ];

  return {
    classification: {
      eventType: scopeType || 'market',
      timeHorizon: impactLevel === 'high' ? 'short' : 'medium',
      marketAwareness: impactLevel === 'high' ? 'high' : 'medium',
      action: impactLevel === 'high' ? 'MONITOR' : 'NO_ACTION',
    },
    summary,
    whyItMattersForYou,
    whyThisHappened,
    mostLikelyScenarios: scenarios,
    whatToKeepInMind,
    sources,
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
