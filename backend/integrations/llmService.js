const OpenAI = require("openai");
const { getDatabase } = require("../data/db");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Triage articles by title to determine which are worth enriching
 * Filters out ads, clickbait, and low-value content
 * Automatically rejects articles that don't mention user's holdings
 * @param {Array} articles - Array of article objects with title
 * @param {Array} holdings - Array of holding objects with ticker, label, notes
 * @returns {Promise<Array>} Array of triage results: {url, shouldEnrich, reason, score}
 */
async function triageArticlesByTitle(articles, holdings = []) {
  // If no API key, mark all as should enrich (fallback)
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, skipping triage - all articles will be enriched");
    return articles.map(article => ({
      url: article.url,
      shouldEnrich: true,
      reason: "Triage skipped - no API key",
      score: 50,
    }));
  }

  if (!articles || articles.length === 0) {
    return [];
  }

  try {
    // Check database for already triaged articles to prevent duplicate processing
    const db = getDatabase();
    const urls = articles.map(a => a.url);
    const placeholders = urls.map(() => "?").join(",");
    
    const existingTriage = db.prepare(`
      SELECT url, should_enrich, triage_reason, triage_score 
      FROM articles 
      WHERE url IN (${placeholders}) 
        AND (should_enrich IS NOT NULL OR triage_reason IS NOT NULL OR triage_score IS NOT NULL)
    `).all(...urls);
    
    const triageMap = new Map();
    for (const row of existingTriage) {
      triageMap.set(row.url, {
        url: row.url,
        shouldEnrich: row.should_enrich === 1,
        reason: row.triage_reason || "Already triaged",
        score: row.triage_score || 50,
        alreadyProcessed: true,
      });
    }
    
    // Separate already triaged from new articles
    const alreadyTriaged = [];
    const articlesToProcess = [];
    
    for (let i = 0; i < articles.length; i++) {
      const existing = triageMap.get(articles[i].url);
      if (existing) {
        alreadyTriaged[i] = existing;
      } else {
        articlesToProcess.push({ article: articles[i], originalIndex: i });
      }
    }
    
    if (alreadyTriaged.filter(r => r).length > 0) {
      console.log(`[Triage] Skipping ${alreadyTriaged.filter(r => r).length} articles that are already triaged`);
    }
    
    // If all articles are already triaged, return early
    if (articlesToProcess.length === 0) {
      return articles.map((article, index) => 
        alreadyTriaged[index] || {
          url: article.url,
          shouldEnrich: false,
          reason: "Not found in database",
          score: 0,
        }
      );
    }

    // Prepare holdings for matching
    const holdingsTickers = holdings.map(h => h.ticker.toUpperCase());
    const holdingsLabels = holdings.map(h => (h.label || h.ticker).toUpperCase()).filter(l => l);
    const holdingsList = holdings.map((h) => 
      `- ${h.ticker} (${h.label || h.ticker})`
    ).join("\n");

    // Prepare article titles for batch analysis (only for articles that need processing)
    const articleTitles = articlesToProcess.map(({ article, originalIndex }) => ({
      originalIndex,
      url: article.url,
      title: article.title || "",
      description: article.description || "",
      source: article.source?.name || "Unknown",
      searchedBy: article.searchedBy || null,
      publishedAt: article.publishedAt || null,
    }));

    // Pre-filter: Check if articles mention holdings or are too old
    const preFilteredResults = [];
    const articlesForLLM = [];
    const now = new Date();
    const maxAgeDays = 30; // Reject articles older than 30 days
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    for (let i = 0; i < articlesToProcess.length; i++) {
      const { article, originalIndex } = articlesToProcess[i];
      const title = (article.title || "").toUpperCase();
      const description = (article.description || "").toUpperCase();
      const searchedBy = article.searchedBy?.toUpperCase();
      
      // Check article age
      if (article.publishedAt) {
        try {
          const publishedDate = new Date(article.publishedAt);
          const ageMs = now.getTime() - publishedDate.getTime();
          if (ageMs > maxAgeMs) {
            preFilteredResults[i] = {
              url: article.url,
              shouldEnrich: false,
              reason: `Article is too old (${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days)`,
              score: 0,
              preFiltered: true
            };
            continue;
          }
        } catch (e) {
          // Invalid date, continue
        }
      }

      // Check if article has minimal content
      if (!title || title.trim().length < 10) {
        preFilteredResults[i] = {
          url: article.url,
          shouldEnrich: false,
          reason: "Article title too short or empty",
          score: 0,
          preFiltered: true
        };
        continue;
      }

      // If holdings provided, check if article mentions any holding
      if (holdings.length > 0) {
        // Check if article was found by searching for a holding (strong indicator)
        const foundByHolding = searchedBy && holdingsTickers.includes(searchedBy);
        
        // Check if title/description mentions any ticker
        const mentionsTicker = holdingsTickers.some(ticker => 
          title.includes(ticker) || 
          description.includes(ticker)
        );
        
        // Check if title/description mentions any label (company name)
        const mentionsLabel = holdingsLabels.some(label => {
          // Skip if label is just the ticker itself (already checked above)
          if (holdingsTickers.includes(label)) return false;
          
          // Check if title/description contains the label or significant parts of it
          // Split label into words and check if major words appear
          const labelWords = label.split(/\s+/).filter(w => w.length > 3); // Words longer than 3 chars
          if (labelWords.length > 0) {
            // Check if any significant word from label appears in title/description
            const hasLabelWord = labelWords.some(word => 
              title.includes(word) || description.includes(word)
            );
            if (hasLabelWord) return true;
          }
          
          // Also check full label match
          return title.includes(label) || description.includes(label);
        });
        
        // If article mentions a holding, let LLM decide
        if (foundByHolding || mentionsTicker || mentionsLabel) {
          articlesForLLM.push({ article, index: i });
          continue;
        }
        
        // No mention of holdings - still process (macro/market news is valid)
        // Don't pre-filter - let LLM decide relevance based on impact/importance
        articlesForLLM.push({ article, index: i });
      } else {
        // No holdings provided, let LLM decide
        articlesForLLM.push({ article, index: i });
      }
    }

    console.log(`[Triage] Pre-filtered: ${preFilteredResults.filter(r => r?.preFiltered).length} articles rejected, ${articlesForLLM.length} sent to LLM`);

    // If no articles left for LLM, return pre-filtered results
    if (articlesForLLM.length === 0) {
      return articles.map((article, index) => 
        preFilteredResults[index] || {
          url: article.url,
          shouldEnrich: false,
          reason: "No articles to analyze",
          score: 0,
        }
      );
    }

    // Prepare titles for LLM (only articles that passed pre-filter)
    const titlesForLLM = articlesForLLM.map(({ article, originalIndex }, idx) => ({
      index: idx,
      originalIndex,
      url: article.url,
      title: article.title || "",
      source: article.source?.name || "Unknown",
    }));

    // System prompt for triage
    const systemPrompt = `You are a financial news filter that determines which articles are worth enriching with AI analysis.
Your job is to identify high-impact financial events and filter out:
- Advertisements and sponsored content
- Clickbait articles with no real news value
- Generic lifestyle or non-financial content
- Duplicate or redundant information
- Low-quality or unreliable sources
${holdings.length > 0 ? '- Articles that do NOT relate to the user\'s holdings' : ''}

Always respond with valid JSON in this exact format:
{
  "results": [
    {
      "index": 0,
      "shouldEnrich": true/false,
      "score": 0-100,
      "reason": "Brief explanation"
    }
  ]
}

Scoring guidelines:
- 80-100: High-impact events (earnings, mergers, major product launches, regulatory changes, market-moving news)
- 60-79: Significant news (partnerships, executive changes, product updates, industry trends)
- 40-59: Moderate relevance (company updates, minor announcements)
- 20-39: Low value (opinion pieces, generic news, clickbait)
- 0-19: Should not enrich (ads, spam, irrelevant content, duplicates${holdings.length > 0 ? ', articles not related to holdings' : ''})

Only mark shouldEnrich=true for scores >= 40.`;

    // Build user prompt with all titles
    const titlesList = titlesForLLM.map((item, idx) => 
      `${item.index}. [${item.source}] ${item.title}`
    ).join("\n");

    const userPrompt = `Analyze these article titles and determine which are worth enriching.
${holdings.length > 0 ? `\nUser Holdings:\n${holdingsList}\n` : ''}
${titlesList}

For each article, determine:
1. ${holdings.length > 0 ? 'Does this article relate to ANY of the user\'s holdings listed above?' : 'Is this a high-impact financial event or significant news?'}
2. Is this a high-impact financial event or significant news?
3. Is this an ad, clickbait, or low-value content?
${holdings.length > 0 ? '4. IMPORTANT: If an article does NOT relate to any of the user\'s holdings, automatically reject it (shouldEnrich=false, score=0-19).' : ''}

Return ONLY valid JSON with results array matching the order of articles above.`;

    // Call OpenAI API for batch triage
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2, // Very low temperature for consistent filtering
      response_format: { type: "json_object" },
      max_tokens: 2000, // Enough for multiple results
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let triageData;

    try {
      triageData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse triage JSON response:", parseError);
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        triageData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from triage LLM");
      }
    }

    // Map LLM results back to articles
    const llmResults = new Map();
    if (triageData.results && Array.isArray(triageData.results)) {
      for (const result of triageData.results) {
        const score = Math.max(0, Math.min(100, Number(result.score) || 50));
        const shouldEnrich = result.shouldEnrich === true || score >= 40;
        // Always ensure a reason is provided
        let reason = result.reason || "";
        if (!reason || reason.trim().length === 0) {
          if (shouldEnrich) {
            reason = `High-impact event (score: ${score})`;
          } else {
            reason = `Low-value content (score: ${score}) - not worth enriching`;
          }
        }
        llmResults.set(result.index, {
          shouldEnrich,
          reason: reason.trim(),
          score,
        });
      }
    }

    // Combine pre-filtered and LLM results, including already triaged articles
    const results = articles.map((article, index) => {
      // First check if already triaged
      if (alreadyTriaged[index]) {
        return alreadyTriaged[index];
      }
      
      // Check if pre-filtered
      if (preFilteredResults[index]?.preFiltered) {
        return preFilteredResults[index];
      }

      // Find LLM result for this article
      const llmArticle = articlesForLLM.find(a => a.originalIndex === index);
      if (llmArticle) {
        // Find the index in titlesForLLM array
        const llmIndex = titlesForLLM.findIndex(t => t.originalIndex === index);
        const llmResult = llmResults.get(llmIndex);
        if (llmResult) {
          return {
            url: article.url,
            shouldEnrich: llmResult.shouldEnrich,
            reason: llmResult.reason,
            score: llmResult.score,
          };
        }
      }

      // Fallback if result not found - always provide a reason
      return {
        url: article.url,
        shouldEnrich: false,
        reason: "Triage result not found - defaulting to reject (no LLM analysis available)",
        score: 0,
      };
    });

    // Save triage results to database
    try {
      const db = getDatabase();
      const stmt = db.prepare(`
        UPDATE articles SET
          should_enrich = ?,
          triage_reason = ?,
          triage_score = ?,
          updated_at = datetime('now')
        WHERE url = ?
      `);

      const updateMany = db.transaction((results) => {
        for (const result of results) {
          // Ensure reason is never empty - provide default if missing
          const reason = result.reason && result.reason.trim().length > 0 
            ? result.reason.trim() 
            : (result.shouldEnrich ? "Marked for enrichment" : "Not selected for enrichment");
          
          stmt.run(
            result.shouldEnrich ? 1 : 0,
            reason,
            result.score,
            result.url
          );
        }
      });

      updateMany(results);
      console.log(`[Triage] Processed ${results.length} articles: ${results.filter(r => r.shouldEnrich).length} to enrich, ${results.filter(r => !r.shouldEnrich).length} filtered out`);
    } catch (dbError) {
      console.error(`Error saving triage results to database:`, dbError.message);
      // Continue even if save fails
    }

    return results;
  } catch (error) {
    console.error("Error triaging articles:", error.message);
    
    // Fallback: mark all as should enrich on error, but always provide reason
    const errorReason = `Triage error: ${error.message} - defaulting to enrich`;
    return articles.map(article => ({
      url: article.url,
      shouldEnrich: true,
      reason: errorReason,
      score: 50,
    }));
  }
}

/**
 * Enrich an article for specific holdings using LLM
 * @param {Object} article - Article object
 * @param {Array} holdings - Array of holding objects with ticker, label, notes
 * @returns {Promise<Object>} EnrichedArticle with summary, whyItMatters, and relevanceScores
 */
async function enrichArticleForHoldings(article, holdings) {
  // If no API key, return article without enrichment
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, returning unenriched article");
    return {
      ...article,
      summary: "",
      whyItMatters: "",
      relevanceScores: {},
    };
  }

  // If no holdings, return article without enrichment
  if (!holdings || holdings.length === 0) {
    return {
      ...article,
      summary: "",
      whyItMatters: "",
      relevanceScores: {},
    };
  }

  try {
    // Build holdings list for prompt
    const holdingsList = holdings.map((h) => ({
      ticker: h.ticker,
      label: h.label || h.ticker,
      notes: h.notes || "",
    }));

    // Prepare article text (use content if available, otherwise description)
    const articleText = article.content || article.description || article.title || "";

    // System prompt
    const systemPrompt = `You are a financial news analyst that helps investors understand how news articles relate to their stock holdings. 
Analyze articles and provide:
1. A concise summary (2-3 sentences)
2. Why this matters to investors (2-3 sentences)
3. Relevance scores (0-100) for each holding ticker mentioned

Always respond with valid JSON in this exact format:
{
  "summary": "string",
  "whyItMatters": "string",
  "relevanceScores": {
    "TICKER1": 0-100,
    "TICKER2": 0-100
  }
}`;

    // User prompt
    const userPrompt = `Article Title: ${article.title}

Article Text: ${articleText}

User Holdings:
${holdingsList.map((h) => `- ${h.ticker} (${h.label})${h.notes ? ` - ${h.notes}` : ""}`).join("\n")}

Analyze this article and provide:
1. A concise summary
2. Why this matters to investors
3. Relevance scores (0-100) for each holding. Score based on:
   - Direct mention or obvious connection: 80-100
   - Related industry/sector impact: 40-79
   - Indirect or minimal connection: 1-39
   - No connection: 0

Return ONLY valid JSON, no markdown formatting or explanations.`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3, // Lower temperature for more consistent analysis
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let enrichmentData;

    try {
      enrichmentData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse LLM JSON response:", parseError);
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        enrichmentData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }

    // Validate and sanitize the response
    const summary = enrichmentData.summary || "";
    const whyItMatters = enrichmentData.whyItMatters || "";
    const relevanceScores = enrichmentData.relevanceScores || {};

    // Ensure relevance scores are numbers in 0-100 range
    const sanitizedScores = {};
    for (const holding of holdings) {
      const ticker = holding.ticker.toUpperCase();
      let score = relevanceScores[ticker] || relevanceScores[holding.ticker] || 0;
      
      // Ensure it's a number and in valid range
      score = Math.max(0, Math.min(100, Number(score) || 0));
      sanitizedScores[ticker] = score;
    }

    // Calculate average relevance score for holding_relevance_score column
    const scores = Object.values(sanitizedScores);
    const avgRelevance = scores.length > 0 
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // Save enrichment data to database
    try {
      const db = getDatabase();
      db.prepare(`
        UPDATE articles SET
          summary_enriched = ?,
          why_it_matters = ?,
          relevance_scores_json = ?,
          holding_relevance_score = COALESCE(holding_relevance_score, ?),
          summary_short = COALESCE(summary_short, ?),
          summary_medium = COALESCE(summary_medium, ?),
          personalized_teaser = COALESCE(personalized_teaser, ?),
          updated_at = datetime('now')
        WHERE url = ?
      `).run(
        summary.trim(),
        whyItMatters.trim(),
        JSON.stringify(sanitizedScores),
        avgRelevance,
        summary.trim(),
        summary.trim(),
        whyItMatters.trim(),
        article.url
      );
      console.log(`[LLM Service] Saved enrichment data to database for ${article.url}`);
    } catch (dbError) {
      console.error(`Error saving enrichment to database for ${article.url}:`, dbError.message);
      // Continue even if save fails
    }

    return {
      ...article,
      summary: summary.trim(),
      whyItMatters: whyItMatters.trim(),
      relevanceScores: sanitizedScores,
    };
  } catch (error) {
    console.error("Error enriching article:", error.message);
    
    // Fallback: return article without enrichment
    return {
      ...article,
      summary: "",
      whyItMatters: "",
      relevanceScores: holdings.reduce((acc, h) => {
        acc[h.ticker.toUpperCase()] = 0;
        return acc;
      }, {}),
    };
  }
}

/**
 * Enrich multiple articles in a single batch LLM call (much faster and cheaper)
 * @param {Array} articles - Array of article objects to enrich
 * @param {Array} holdings - Array of holding objects
 * @returns {Promise<Array>} Array of enrichment results: {url, summary, whyItMatters, relevanceScores}
 */
async function enrichArticlesBatch(articles, holdings) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, returning empty enrichments");
    return articles.map(article => ({
      url: article.url,
      summary: "",
      whyItMatters: "",
      relevanceScores: {},
    }));
  }

  if (!holdings || holdings.length === 0 || !articles || articles.length === 0) {
    return articles.map(article => ({
      url: article.url,
      summary: "",
      whyItMatters: "",
      relevanceScores: {},
    }));
  }

  try {
    // Build holdings list for prompt
    const holdingsList = holdings.map((h) => 
      `- ${h.ticker} (${h.label || h.ticker})${h.notes ? ` - ${h.notes}` : ""}`
    ).join("\n");

    // Prepare articles for batch analysis
    const articlesForLLM = articles.map((article, index) => ({
      index,
      url: article.url,
      title: article.title || "",
      text: article.content || article.description || article.title || "",
      searchedBy: article.searchedBy || null,
    }));

    // System prompt for batch enrichment
    const systemPrompt = `You are a financial news analyst that helps investors understand how news articles relate to their stock holdings.
Analyze multiple articles and provide for each:
1. A concise summary (2-3 sentences)
2. Why this matters to investors (2-3 sentences)
3. Relevance scores (0-100) for each holding ticker mentioned

Always respond with valid JSON in this exact format:
{
  "results": [
    {
      "index": 0,
      "summary": "string",
      "whyItMatters": "string",
      "relevanceScores": {
        "TICKER1": 0-100,
        "TICKER2": 0-100
      }
    }
  ]
}`;

    // Build user prompt with all articles
    const articlesList = articlesForLLM.map((item) => 
      `[${item.index}] ${item.title}\n${item.text.substring(0, 1000)}${item.text.length > 1000 ? '...' : ''}`
    ).join("\n\n---\n\n");

    const userPrompt = `User Holdings:
${holdingsList}

Articles to analyze:
${articlesList}

For each article, provide:
1. A concise summary (2-3 sentences)
2. Why this matters to investors (2-3 sentences)
3. Relevance scores (0-100) for each holding. Score based on:
   - Direct mention or obvious connection: 80-100
   - Related industry/sector impact: 40-79
   - Indirect or minimal connection: 1-39
   - No connection: 0

Return ONLY valid JSON with results array matching the order of articles above.`;

    // Call OpenAI API for batch enrichment
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 4000, // Increased for batch processing
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let batchData;

    try {
      batchData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse batch enrichment JSON response:", parseError);
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        batchData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from batch enrichment LLM");
      }
    }

    // Map LLM results back to articles
    const results = [];
    const resultsMap = new Map();
    
    if (batchData.results && Array.isArray(batchData.results)) {
      for (const result of batchData.results) {
        const article = articlesForLLM[result.index];
        if (!article) continue;

        // Validate and sanitize relevance scores
        const relevanceScores = result.relevanceScores || {};
        const sanitizedScores = {};
        for (const holding of holdings) {
          const ticker = holding.ticker.toUpperCase();
          let score = relevanceScores[ticker] || relevanceScores[holding.ticker] || 0;
          score = Math.max(0, Math.min(100, Number(score) || 0));
          sanitizedScores[ticker] = score;
        }

        resultsMap.set(article.url, {
          url: article.url,
          summary: (result.summary || "").trim(),
          whyItMatters: (result.whyItMatters || "").trim(),
          relevanceScores: sanitizedScores,
        });
      }
    }

    // Return results in same order as input articles
    return articles.map(article => 
      resultsMap.get(article.url) || {
        url: article.url,
        summary: "",
        whyItMatters: "",
        relevanceScores: {},
      }
    );
  } catch (error) {
    console.error("Error in batch enrichment:", error.message);
    // Fallback: return empty enrichments
    return articles.map(article => ({
      url: article.url,
      summary: "",
      whyItMatters: "",
      relevanceScores: {},
    }));
  }
}

/**
 * Enrich multiple articles with rate limiting and error handling
 * Now uses batch processing for much better performance
 * Only enriches articles that have shouldEnrich=true (from triage)
 * @param {Array} articles - Array of article objects
 * @param {Array} holdings - Array of holding objects
 * @param {Object} options - Options for rate limiting
 * @param {Array} triageResults - Optional: Array of triage results from triageArticlesByTitle
 * @returns {Promise<Array>} Array of enriched articles (unenriched articles are returned as-is)
 */
async function enrichArticlesForHoldings(articles, holdings, options = {}, triageResults = null) {
  const { batchSize = 20, delayBetweenBatches = 1000 } = options; // Increased default batch size for batch LLM calls
  const enrichedArticles = [];

  // If triage results provided, filter articles to only enrich those that passed
  // Otherwise, check database for should_enrich flag
  // Also check if articles are already enriched to avoid re-processing
  let articlesToEnrich = articles;
  let triageMap = null;
  let alreadyEnrichedMap = new Map();

  // First, check database for already enriched articles
  try {
    const db = getDatabase();
    const urls = articles.map(a => a.url);
    if (urls.length > 0) {
      const placeholders = urls.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT url, summary_enriched, why_it_matters, relevance_scores_json, should_enrich, triage_reason, triage_score 
        FROM articles 
        WHERE url IN (${placeholders})
      `).all(...urls);

      // Build map of already enriched articles
      for (const row of rows) {
        const isEnriched = row.summary_enriched && row.summary_enriched.trim().length > 0;
        alreadyEnrichedMap.set(row.url, {
          isEnriched,
          summary: row.summary_enriched,
          whyItMatters: row.why_it_matters,
          relevanceScores: row.relevance_scores_json ? JSON.parse(row.relevance_scores_json) : {},
        });
      }
    }
  } catch (dbError) {
    console.error("Error checking enrichment status from database:", dbError.message);
    // Continue if database check fails
  }

  // Filter out already enriched articles
  const alreadyEnriched = articles.filter(article => {
    const enriched = alreadyEnrichedMap.get(article.url);
    return enriched && enriched.isEnriched;
  });

  if (alreadyEnriched.length > 0) {
    console.log(`[Enrichment] Skipping ${alreadyEnriched.length} articles that are already enriched`);
  }

  // Now filter by triage results
  if (triageResults && Array.isArray(triageResults)) {
    // Use provided triage results
    triageMap = new Map(triageResults.map(r => [r.url, r]));
    articlesToEnrich = articles.filter(article => {
      // Skip if already enriched
      if (alreadyEnrichedMap.get(article.url)?.isEnriched) {
        return false;
      }
      // Check triage
      const triage = triageMap.get(article.url);
      return triage && triage.shouldEnrich;
    });
    console.log(`[Enrichment] Filtering: ${articles.length} total, ${alreadyEnriched.length} already enriched, ${articlesToEnrich.length} to enrich, ${articles.length - alreadyEnriched.length - articlesToEnrich.length} skipped`);
  } else {
    // Check database for should_enrich flag
    try {
      const db = getDatabase();
      const urls = articles.map(a => a.url);
      if (urls.length > 0) {
        const placeholders = urls.map(() => "?").join(",");
        const rows = db.prepare(`
          SELECT url, should_enrich, triage_reason, triage_score 
          FROM articles 
          WHERE url IN (${placeholders})
        `).all(...urls);

        const dbTriageMap = new Map(rows.map(r => [r.url, {
          shouldEnrich: r.should_enrich === 1,
          reason: r.triage_reason,
          score: r.triage_score,
        }]));

        articlesToEnrich = articles.filter(article => {
          // Skip if already enriched
          if (alreadyEnrichedMap.get(article.url)?.isEnriched) {
            return false;
          }
          // Check triage
          const triage = dbTriageMap.get(article.url);
          // If no triage data, default to enriching (backward compatibility)
          return !triage || triage.shouldEnrich !== false;
        });

        const skipped = articles.length - alreadyEnriched.length - articlesToEnrich.length;
        if (skipped > 0 || alreadyEnriched.length > 0) {
          console.log(`[Enrichment] Filtering: ${articles.length} total, ${alreadyEnriched.length} already enriched, ${articlesToEnrich.length} to enrich, ${skipped} skipped (from database)`);
        }
      }
    } catch (dbError) {
      console.error("Error checking triage from database:", dbError.message);
      // Continue with all articles if database check fails
    }
  }

  // Process articles in batches using batch LLM calls (much faster and cheaper)
  for (let i = 0; i < articlesToEnrich.length; i += batchSize) {
    const batch = articlesToEnrich.slice(i, i + batchSize);
    
    try {
      // Enrich entire batch in a single LLM call
      const batchEnrichments = await enrichArticlesBatch(batch, holdings);
      
      // Apply enrichments to articles
      const batchResults = batch.map((article, idx) => {
        const enrichment = batchEnrichments[idx];
        if (!enrichment) {
          return {
            ...article,
            summary: "",
            whyItMatters: "",
            relevanceScores: {},
          };
        }

        // Calculate average relevance score
        const scores = Object.values(enrichment.relevanceScores);
        const avgRelevance = scores.length > 0 
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

        // Save enrichment data to database
        try {
          const db = getDatabase();
          db.prepare(`
            UPDATE articles SET
              summary_enriched = ?,
              why_it_matters = ?,
              relevance_scores_json = ?,
              holding_relevance_score = COALESCE(holding_relevance_score, ?),
              summary_short = COALESCE(summary_short, ?),
              summary_medium = COALESCE(summary_medium, ?),
              personalized_teaser = COALESCE(personalized_teaser, ?),
              updated_at = datetime('now')
            WHERE url = ?
          `).run(
            enrichment.summary,
            enrichment.whyItMatters,
            JSON.stringify(enrichment.relevanceScores),
            avgRelevance,
            enrichment.summary,
            enrichment.summary,
            enrichment.whyItMatters,
            article.url
          );
        } catch (dbError) {
          console.error(`Error saving batch enrichment to database for ${article.url}:`, dbError.message);
        }

        return {
          ...article,
          summary: enrichment.summary,
          whyItMatters: enrichment.whyItMatters,
          relevanceScores: enrichment.relevanceScores,
        };
      });

      enrichedArticles.push(...batchResults);
      console.log(`[Enrichment Batch] Processed ${batch.length} articles in single LLM call`);

      // Delay between batches to respect rate limits
      if (i + batchSize < articlesToEnrich.length) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
      }
    } catch (error) {
      console.error(`Error enriching batch starting at index ${i}:`, error.message);
      // Fallback: return unenriched articles for this batch
      const fallbackResults = batch.map(article => ({
        ...article,
        summary: "",
        whyItMatters: "",
        relevanceScores: {},
      }));
      enrichedArticles.push(...fallbackResults);
    }
  }

  // Add already enriched articles and unenriched articles back to results
  const enrichedUrls = new Set(enrichedArticles.map(a => a.url));
  
  // Add already enriched articles from database
  const alreadyEnrichedArticles = alreadyEnriched.map(article => {
    const enriched = alreadyEnrichedMap.get(article.url);
    return {
      ...article,
      summary: enriched.summary || "",
      whyItMatters: enriched.whyItMatters || "",
      relevanceScores: enriched.relevanceScores || {},
    };
  });
  
  // Add unenriched articles (not already enriched, not newly enriched)
  const unenrichedArticles = articles
    .filter(article => !enrichedUrls.has(article.url) && !alreadyEnrichedMap.get(article.url)?.isEnriched)
    .map(article => {
      const triage = triageMap?.get(article.url);
      return {
        ...article,
        summary: "",
        whyItMatters: "",
        relevanceScores: {},
        triageReason: triage?.reason || "Not selected for enrichment",
        triageScore: triage?.score || null,
      };
    });

  // Combine all: newly enriched, already enriched, and unenriched, maintaining original order
  const allArticles = articles.map(article => {
    // Check newly enriched first
    const newlyEnriched = enrichedArticles.find(a => a.url === article.url);
    if (newlyEnriched) return newlyEnriched;
    
    // Check already enriched
    const alreadyEnriched = alreadyEnrichedMap.get(article.url);
    if (alreadyEnriched && alreadyEnriched.isEnriched) {
      return {
        ...article,
        summary: alreadyEnriched.summary || "",
        whyItMatters: alreadyEnriched.whyItMatters || "",
        relevanceScores: alreadyEnriched.relevanceScores || {},
      };
    }
    
    // Check unenriched
    const unenriched = unenrichedArticles.find(a => a.url === article.url);
    if (unenriched) return unenriched;
    
    // Fallback to original article
    return article;
  });

  return allArticles;
}

/**
 * Cluster articles by title using LLM
 * LLM analyzes all titles at once and groups them by story
 * @param {Array} articles - Array of article objects
 * @returns {Promise<Array>} Array of clusters (each cluster is array of articles)
 */
async function clusterArticlesByTitleLLM(articles) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, falling back to keyword clustering");
    const { clusterArticlesBySimilarity } = require('../data/storyGroupStorage');
    return clusterArticlesBySimilarity(articles, 0.85);
  }

  try {
    // Prepare titles list for LLM
    const titlesList = articles.map((article, index) => 
      `${index + 1}. ${article.title}`
    ).join('\n');

    // System prompt
    const systemPrompt = `You are a news analyst that groups articles by story.

Your job: Analyze the article titles below and group them by which ones are about the SAME story or event.

Rules:
- Articles are about the SAME story if they report the same event, announcement, or development
- Different angles on the same story = SAME group
- Different sources reporting the same news = SAME group
- Related but separate events = DIFFERENT groups
- Follow-up articles about the same story = SAME group

Return JSON in this exact format:
{
  "groups": [
    {
      "group_id": 1,
      "article_indices": [1, 3, 5],
      "story_summary": "Brief description of what this story is about"
    },
    {
      "group_id": 2,
      "article_indices": [2, 4],
      "story_summary": "Brief description of what this story is about"
    }
  ],
  "ungrouped": [6, 7]
}

Important:
- article_indices are 1-based (first article is 1, not 0)
- Each article can only be in ONE group
- If an article doesn't match any others, put it in "ungrouped"
- Create groups only if 2+ articles are about the same story`;

    // User prompt
    const userPrompt = `Analyze these ${articles.length} article titles and group them by story:

${titlesList}

Return JSON with groups. Each group should contain articles that are about the SAME story.`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });

    // Parse response
    const content = response.choices[0].message.content;
    let groupingData;
    
    try {
      groupingData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse LLM grouping response:", parseError);
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        groupingData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }

    // Convert LLM groups to article clusters
    const clusters = [];
    const assigned = new Set();

    // Process groups
    if (groupingData.groups && Array.isArray(groupingData.groups)) {
      for (const group of groupingData.groups) {
        if (!group.article_indices || !Array.isArray(group.article_indices)) continue;

        const cluster = [];
        for (const index of group.article_indices) {
          const articleIndex = index - 1; // Convert 1-based to 0-based
          if (articleIndex >= 0 && articleIndex < articles.length) {
            const article = articles[articleIndex];
            if (!assigned.has(article.url)) {
              cluster.push({
                ...article,
                similarity_score: 0.95,
                llm_group_summary: group.story_summary || ''
              });
              assigned.add(article.url);
            }
          }
        }

        if (cluster.length > 0) {
          clusters.push(cluster);
        }
      }
    }

    // Process ungrouped articles (each becomes its own cluster)
    if (groupingData.ungrouped && Array.isArray(groupingData.ungrouped)) {
      for (const index of groupingData.ungrouped) {
        const articleIndex = index - 1;
        if (articleIndex >= 0 && articleIndex < articles.length) {
          const article = articles[articleIndex];
          if (!assigned.has(article.url)) {
            clusters.push([article]);
            assigned.add(article.url);
          }
        }
      }
    }

    // Add any articles that weren't included in LLM response
    for (let i = 0; i < articles.length; i++) {
      if (!assigned.has(articles[i].url)) {
        clusters.push([articles[i]]);
      }
    }

    console.log(`✓ LLM grouped ${articles.length} articles into ${clusters.length} clusters`);
    return clusters;

  } catch (error) {
    console.error("Error clustering articles by title with LLM:", error.message);
    // Fallback to keyword clustering
    const { clusterArticlesBySimilarity } = require('../data/storyGroupStorage');
    return clusterArticlesBySimilarity(articles, 0.85);
  }
}

/**
 * Generate story group explanation using LLM with strict orientation-focused prompt
 * @param {Array} articles - Array of clustered article objects
 * @param {String} groupTitle - Story group title
 * @param {String} scope - 'GLOBAL' or 'TICKER'
 * @param {String} primaryTicker - Ticker symbol if TICKER scope
 * @param {String} impactLevel - 'High', 'Moderate', 'Low', 'Very Low'
 * @returns {Promise<Object>} Explanation object with all 6 required parts
 */
async function generateStoryGroupExplanation(articles, groupTitle, scope, primaryTicker, impactLevel) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, using fallback");
    return null;
  }

  try {
    // Prepare article context
    const articleTexts = articles.map((a, idx) => 
      `Article ${idx + 1}:
Title: ${a.title}
${a.description ? `Description: ${a.description}` : ''}
Source: ${a.source_name}
${a.published_at ? `Published: ${a.published_at}` : ''}`
    ).join('\n\n---\n\n');

    const sources = articles.map(a => ({
      publisher: a.source_name,
      title: a.title,
      published_date: a.published_at || 'N/A',
      url: a.url
    }));

    // System prompt (exact prompt from user)
    const systemPrompt = `You are an orientation-focused explanation engine, not a trading assistant.

Your job is to help readers understand what is happening, why it happened, and what it means for them, in a way that reduces anxiety, avoids hype, and creates closure.

You do not:

Predict prices

Recommend buying, selling, or reallocating

Create urgency, fear, or excitement

Use hype language, speculation, or social sentiment

You do:

Explain calmly

Translate finance into plain language

Respect the reader's intelligence

Leave the reader feeling oriented, not activated

🎯 CORE GOAL (NON-NEGOTIABLE)

When the reader finishes, they should:

Feel calmer than when they started

Understand the story without Googling further

Know what signals matter and which ones don't

Decide for themselves whether to care or ignore

If the explanation increases urgency, confusion, or FOMO — it fails.

👤 AUDIENCE

You are writing for non-finance professionals:

Curious adults

Parents

Busy professionals

Long-term investors

Assume no finance background.

Grade level: 6–8
Sentence length: short
Tone: calm, grounded, human

🧩 REQUIRED OUTPUT STRUCTURE

You MUST follow this order exactly.
All sections are required. No extra sections.

1️⃣ Summary

Length:

High impact: 4–6 short sentences

Moderate impact: 3–4 short sentences

Rules:

Plain English

No jargon unless immediately explained

Readable in under 20 seconds

No conclusions yet

2️⃣ Why this matters for you

Rules:

Make it more interpretive, less informational

Answer: Why should I mentally care about this?

Use the user's portfolio if relevant (we know their holdings, so be direct)

Focus on interpretation, not consequence

IMPORTANT: Use "Since you hold [TICKER]..." NOT "If you hold..." - we know the user's holdings, so be direct and confident

Avoid phrases like "this may affect your investments" or "this is important for investors"

No action framing

Avoid generic phrases like "market participants" or "portfolio construction"

Good:
"Since you hold Bitcoin, these discussions about its price and market activity are relevant to your interests."
"Since you hold GOOGL stock, the company's recent success and advancements in AI are directly relevant to your interests."

Bad:
"If you hold Bitcoin..." (don't use conditional - we know they hold it)
"This is important for investors and markets."
"This may affect your investments."

3️⃣ How this unfolded

MANDATORY: a 3-part causal narrative

Format as 3 short paragraphs (1–2 sentences each)

Each paragraph = one causal beat

No numbering, no bullets, no labels (no "Step 1", "Step 2", "Step 3")

Causality must remain clear and chronological

Rules:

No speculation

If the cause is unclear, say so plainly

Translate all finance terms inline

Example translation style:

"Liquidity" → "how easily people can get cash"

"Funding markets" → "the short-term borrowing banks use day to day"

Read like a calm story, not instructions

Never leave this section empty.

4️⃣ Most likely scenarios

Provide 2–3 bounded scenarios.

Each scenario MUST include:

A short title

Likelihood: Low / Medium / High

What would make it more likely

Rules:

These are paths, not predictions

Do NOT include price targets

Do NOT use words like "bullish", "bearish", "soon", "set to"

5️⃣ What to keep in mind

This is the emotional guardrail section.

Include EXACTLY:

2 common misunderstandings people may have

Calm reframes that reduce overreaction

Optional: One grounding analogy if helpful (weather, traffic, routines)

Goal: prevent spiraling or false conclusions

End this section with a sense of closure, not a warning

Ensure the reader feels oriented and calm, not anxious or pressured.

6️⃣ Sources

List real sources transparently.

Format:

Publisher

Article title

Published date

URL

Rules:

No urgency language

No commentary

Sources are for trust, not persuasion

🗣 LANGUAGE RULES (STRICT)

You MUST:

Use short sentences (one idea per sentence)

Prefer common words over technical ones

Explain every finance term inline

Explain why things connect, not just that they do

Prefer examples over abstractions (but no metaphors in "How this unfolded")

Avoid drama, metaphors of collapse, or hero narratives

You MUST NOT:

Use "bullish", "bearish", "reclaim", "set to", "explodes", "crashes"

Use "investors", "market participants", "risk management"

Use second-person pressure ("you should", "you must", "watch closely")

Use action framing ("this may affect your investments", "this could impact your portfolio")

🧪 SUCCESS TEST (SELF-CHECK)

Before finalizing, ask yourself:

Would a non-finance reader understand this fully?

Does this reduce anxiety rather than create it?

Is the reader free to ignore this without fear?

Is there a clear sense of closure at the end?

If any answer is "no", rewrite.

⛔ HARD FAIL CONDITIONS

The output is invalid if:

Any section is missing

Causes are vague or generic

Language creates urgency or fear

It sounds like advice or prediction

It assumes financial expertise

✅ FINAL REMINDER

You are not here to make the reader act.
You are here to help the reader orient themselves calmly.

Write accordingly.`;

    // User prompt
    const userPrompt = `Story Group Title: "${groupTitle}"

Impact Level: ${impactLevel}
Scope: ${scope}
${primaryTicker ? `Primary Ticker: ${primaryTicker} (user holds this stock)` : 'Global story (affects all market participants)'}

Clustered Articles (${articles.length} articles about the same story):
${articleTexts}

Generate a complete explanation following the 5-part structure exactly:

1. Summary (${impactLevel === 'High' ? '4-6' : '3-4'} short sentences, plain English, explain connections not just facts)
2. Why this matters for you (interpretive, answer "Why should I mentally care?", use "Since you hold [TICKER]..." format - we know their holdings, no action framing)
3. How this unfolded (3 short paragraphs, 1-2 sentences each, narrative causal chain, no numbering/bullets/labels, chronological)
4. Most likely scenarios (2-3 scenarios, each with title, likelihood, what makes it likely) - KEEP EXACTLY AS-IS
5. What to keep in mind (2 misunderstandings + calm reframes + optional analogy, end with closure not warning)
6. Sources (list all sources from articles above)

Return ONLY valid JSON in this exact format:
{
  "summary": "string",
  "why_this_matters_for_you": "string",
  "how_this_unfolded": "string (3 short paragraphs, narrative format, no numbering)",
  "most_likely_scenarios": [
    {
      "title": "string",
      "likelihood": "Low|Medium|High",
      "what_makes_it_likely": "string"
    }
  ],
  "what_to_keep_in_mind": "string",
  "sources": [
    {
      "publisher": "string",
      "title": "string",
      "published_date": "string",
      "url": "string"
    }
  ]
}

CRITICAL: Follow all language rules. No hype, no urgency, no predictions, no trading advice.`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 2500,
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let explanationData;
    
    try {
      explanationData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse LLM JSON response:", parseError);
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        explanationData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }

    // Map to database format
    return {
      what_happened: explanationData.summary || '',
      why_it_happened: explanationData.how_this_unfolded || explanationData.why_this_happened || '',
      why_it_matters_now: explanationData.why_this_matters_for_you || '',
      what_to_watch_next: explanationData.most_likely_scenarios 
        ? explanationData.most_likely_scenarios.map((s, i) => 
            `${i + 1}) ${s.title} (${s.likelihood} likelihood): ${s.what_makes_it_likely}`
          ).join('\n\n')
        : '',
      what_this_does_not_mean: explanationData.what_to_keep_in_mind || '',
      sources_summary: explanationData.sources || sources,
      cause_confidence: 'High',
      cause_reason: 'Analysis based on multiple news sources and verifiable facts.'
    };

  } catch (error) {
    console.error("Error generating story group explanation:", error.message);
    return null;
  }
}

module.exports = {
  enrichArticleForHoldings,
  enrichArticlesForHoldings,
  triageArticlesByTitle,
  clusterArticlesByTitleLLM,
  generateStoryGroupExplanation,
};

