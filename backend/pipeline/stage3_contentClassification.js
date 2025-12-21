const OpenAI = require("openai");
const { getDatabase } = require("../data/db");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stage 3: Content classification
 * The LLM reads the full article and produces structure + impact insights
 * 
 * Columns filled:
 * - event_type
 * - impact_score (0-100)
 * - sentiment (-1 to +1)
 * - sentiment_label
 * - risk_score (0-100)
 * - opportunity_score (0-100)
 * - volatility_score (0-100)
 * - matched_tickers
 * - matched_sectors
 * - matched_holdings (based on user's list)
 * - status = "llm_processed"
 */
async function processContentClassification(article, userHoldings = []) {
  const db = getDatabase();

  // Check if already processed - skip if impact_score is already set
  const existing = db.prepare("SELECT impact_score, status FROM articles WHERE url = ?").get(article.url);
  
  // CRITICAL: Skip if article was discarded in previous stages
  if (existing && existing.status === "discarded") {
    console.log(`[Stage 3] Skipping ${article.url} - article was discarded in previous stage`);
    return {
      status: "discarded",
      skipped: true,
      reason: "Already discarded",
    };
  }
  
  if (existing && existing.impact_score !== null && existing.impact_score !== undefined) {
    console.log(`[Stage 3] Article already processed: ${article.url} (impact_score: ${existing.impact_score})`);
    return {
      status: existing.status || "llm_processed",
      skipped: true,
      impact_score: existing.impact_score,
    };
  }

  // If no API key, skip LLM processing
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, skipping content classification");
    return { status: "skipped" };
  }

  // GUARDRAIL 5B: Get article content and status from database
  const articleRow = db.prepare(`
    SELECT title, clean_text, title_ticker_matches, title_sector_matches, searched_by, 
           status, content_length
    FROM articles WHERE url = ?
  `).get(article.url);

  if (!articleRow || !articleRow.clean_text) {
    console.log(`No clean text available for ${article.url}`);
    return { status: "no_content" };
  }

  // GUARDRAIL 5B: Require status = 'content_fetched' and content_length >= 400
  if (articleRow.status !== "content_fetched") {
    console.log(`[Stage 3] Skipping ${article.url} - status is ${articleRow.status}, not 'content_fetched'`);
    return { status: "skipped", reason: `Status is ${articleRow.status}, not 'content_fetched'` };
  }

  const MIN_CONTENT_LENGTH = 400;
  const contentLength = articleRow.content_length || articleRow.clean_text.length;
  if (contentLength < MIN_CONTENT_LENGTH) {
    console.log(`[Stage 3] Skipping ${article.url} - content_length ${contentLength} < ${MIN_CONTENT_LENGTH}`);
    // Mark as discarded
    db.prepare(`
      UPDATE articles SET
        impact_score = 0,
        status = 'discarded',
        updated_at = datetime('now')
      WHERE url = ?
    `).run(article.url);
    return { status: "discarded", reason: `Content too short: ${contentLength} < ${MIN_CONTENT_LENGTH}` };
  }

  // Stage 3 is fully global and user-agnostic
  // It only identifies which tickers/sectors are mentioned (used later for scoring in Stage 4)
  // No user holdings checks or matching happens here

  try {

    // System prompt
    const systemPrompt = `You are a financial news analyst that analyzes full article content.
Analyze the article and provide:
1. Event type: earnings, m&a, guidance, macro, regulation, product_tech, industry_trend, other
2. Impact score (0-100): How significant is this news for markets?
3. Sentiment (-1 to +1): Negative to positive
4. Sentiment label: negative, neutral, or positive
5. Risk score (0-100): Potential downside risk
6. Opportunity score (0-100): Potential upside opportunity
7. Volatility score (0-100): How much volatility might this cause?
8. Matched tickers: Stock tickers mentioned (JSON array)
9. Matched sectors: Industry sectors mentioned (JSON array)

Always respond with valid JSON in this exact format:
{
  "event_type": "event_type_string",
  "impact_score": 0-100,
  "sentiment": -1.0 to 1.0,
  "sentiment_label": "negative|neutral|positive",
  "risk_score": 0-100,
  "opportunity_score": 0-100,
  "volatility_score": 0-100,
  "matched_tickers": ["TICKER1", "TICKER2"],
  "matched_sectors": ["sector1", "sector2"]
}`;

    // Add search context if available
    const searchContext = articleRow.searched_by 
      ? `\n\nIMPORTANT: This article was found by searching for: ${articleRow.searched_by}. Pay special attention to how this affects ${articleRow.searched_by}.`
      : "";

    // User prompt - Stage 3 is global and user-agnostic
    const userPrompt = `Article Title: ${articleRow.title}

Article Content:
${articleRow.clean_text.substring(0, 8000)}${articleRow.clean_text.length > 8000 ? "..." : ""}${searchContext}

Analyze this article and provide detailed classification including:
- Event type and impact${articleRow.searched_by ? ` (especially for ${articleRow.searched_by})` : ""}
- Sentiment analysis${articleRow.searched_by ? ` (how does this affect ${articleRow.searched_by}?)` : ""}
- Risk, opportunity, and volatility scores${articleRow.searched_by ? ` (for ${articleRow.searched_by})` : ""}
- All tickers and sectors mentioned${articleRow.searched_by ? ` (ensure ${articleRow.searched_by} is included if relevant)` : ""}

Return ONLY valid JSON, no markdown formatting.`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let classificationData;

    try {
      classificationData = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        classificationData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }

    // Validate and sanitize
    const event_type = classificationData.event_type || "other";
    const impact_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.impact_score) || 0)));
    const sentiment = Math.max(-1, Math.min(1, Number(classificationData.sentiment) || 0));
    const sentiment_label = classificationData.sentiment_label || "neutral";
    const risk_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.risk_score) || 0)));
    const opportunity_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.opportunity_score) || 0)));
    const volatility_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.volatility_score) || 0)));
    const matched_tickers = Array.isArray(classificationData.matched_tickers)
      ? JSON.stringify(classificationData.matched_tickers.map(t => t.toUpperCase()))
      : "[]";
    const matched_sectors = Array.isArray(classificationData.matched_sectors)
      ? JSON.stringify(classificationData.matched_sectors)
      : "[]";

    // Stage 3 is global and user-agnostic - it only identifies tickers/sectors mentioned
    // Holdings matching happens in Stage 4 (personalization)
    const matched_holdings = "[]";

    // Determine status based on impact_score
    let status;
    if (impact_score >= 40) {
      status = "llm_processed"; // Move to Stage 4
    } else if (impact_score >= 20 && impact_score < 40) {
      status = "llm_processed"; // Maybe useful, move to Stage 4
    } else {
      status = "discarded"; // Low impact, discard
    }

    // Update database
    db.prepare(`
      UPDATE articles SET
        event_type = ?,
        impact_score = ?,
        sentiment = ?,
        sentiment_label = ?,
        risk_score = ?,
        opportunity_score = ?,
        volatility_score = ?,
        matched_tickers = ?,
        matched_sectors = ?,
        matched_holdings = ?,
        llm_attempts = llm_attempts + 1,
        status = ?,
        processing_completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      event_type,
      impact_score,
      sentiment,
      sentiment_label,
      risk_score,
      opportunity_score,
      volatility_score,
      matched_tickers,
      matched_sectors,
      matched_holdings,
      status,
      article.url
    );

    return {
      event_type,
      impact_score,
      sentiment,
      sentiment_label,
      risk_score,
      opportunity_score,
      volatility_score,
      matched_tickers: JSON.parse(matched_tickers),
      matched_sectors: JSON.parse(matched_sectors),
      matched_holdings: JSON.parse(matched_holdings),
      status,
    };
  } catch (error) {
    console.error(`Error in Stage 3 content classification for ${article.url}:`, error.message);
    
    // On error, mark as failed but don't discard
    db.prepare(`
      UPDATE articles SET
        llm_attempts = llm_attempts + 1,
        last_error = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(error.message.substring(0, 500), article.url);

    return {
      status: "error",
      error: error.message,
    };
  }
}

/**
 * Check if first 500 chars mention holding ticker or issuer name
 * Returns true if article should be processed, false if it should be dropped
 */
function checkMentionInFirst500Chars(first500, searchedBy, userHoldings = []) {
  // Check if searched_by ticker appears
  if (searchedBy) {
    const searchedTicker = searchedBy.toUpperCase();
    if (first500.includes(searchedTicker)) {
      return true;
    }
  }
  
  // Check if any user holding ticker or issuer name appears
  for (const holding of userHoldings) {
    const ticker = (holding.ticker || holding || "").toUpperCase();
    if (ticker && first500.includes(ticker)) {
      return true;
    }
    
    // Check issuer name (label) - simple includes check
    if (holding.label) {
      const label = holding.label.toUpperCase();
      // Only check if label is meaningful (not just the ticker itself)
      if (label !== ticker && label.length > 2) {
        if (first500.includes(label)) {
          return true;
        }
      }
    }
  }
  
  return false; // Drop if no relevant content found
}

/**
 * Pre-drop heuristics: Check if article mentions user holdings/tickers in first 500 chars
 * Returns true if article should be processed, false if it should be dropped
 */
function shouldProcessArticle(cleanText, userHoldings, searchedBy) {
  if (!cleanText || cleanText.length < 200) return false;
  
  const first500 = cleanText.substring(0, 500).toUpperCase();
  return checkMentionInFirst500Chars(first500, searchedBy, userHoldings);
}

/**
 * Extract intro + conclusion from article text (more relevant than middle)
 */
function extractRelevantText(text, maxLength = 2000) {
  if (text.length <= maxLength) return text;
  
  // Try to find intro (first paragraph or two)
  const introMatch = text.match(/^.{1,800}/);
  const intro = introMatch ? introMatch[0] : text.substring(0, 600);
  
  // Try to find conclusion (last paragraph)
  const conclusionMatch = text.match(/.{1,600}$/);
  const conclusion = conclusionMatch ? conclusionMatch[0] : text.substring(text.length - 600);
  
  const combined = intro + "\n\n[...content...]\n\n" + conclusion;
  return combined.substring(0, maxLength);
}

/**
 * Two-pass LLM strategy: Pass 1 - Cheap classifier
 * Quickly filters articles into buckets: low/medium/high impact
 * Only articles in medium/high buckets get full analysis (Pass 2)
 */
async function processContentClassificationPass1(articles, userHoldings = []) {
  if (!articles || articles.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) {
    return articles.map(() => ({ bucket: "medium", maybe_relevant: true }));
  }
  
  const db = getDatabase();
  // Stage 3 is global and user-agnostic - no holdings processing here
  
  // Build quick classifier prompt (much shorter, cheaper)
  const articlesList = articles.map((article, index) => {
    const articleRow = db.prepare(`
      SELECT title, clean_text, searched_by FROM articles WHERE url = ?
    `).get(article.url);
    
    if (!articleRow) return null;
    
    const content = extractRelevantText(articleRow.clean_text || "", 800); // Very short for Pass 1
    const searchContext = articleRow.searched_by ? ` (Found by: ${articleRow.searched_by})` : "";
    
    return `Article ${index + 1} (URL: ${article.url}):
Title: ${articleRow.title}
Content: ${content}${searchContext}`;
  }).filter(Boolean).join("\n\n---\n\n");
  
  const systemPrompt = `You are a fast financial news classifier. Quickly categorize articles into impact buckets.

Return JSON with this format:
{
  "results": [
    {
      "index": 0,
      "maybe_relevant": true/false,
      "impact_bucket": "low|medium|high"
    }
  ]
}

Buckets:
- "high": Clearly material events (earnings beats/misses, M&A, major guidance changes, regulatory decisions)
- "medium": Significant news (partnerships, product updates, industry trends)
- "low": Minor updates, opinion pieces, low-value content

Only mark maybe_relevant=true for medium/high buckets.`;

  // Stage 3 is global and user-agnostic - no user holdings in prompt
  const userPrompt = `Quickly classify these ${articles.length} articles:\n\n${articlesList}\n\nReturn JSON with results array.`;
  
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: Math.min(2000, articles.length * 100), // Much cheaper than full analysis
    });
    
    const content = response.choices[0].message.content;
    let pass1Data = JSON.parse(content);
    
    // Map results back to articles
    const results = articles.map((article, index) => {
      const result = pass1Data.results?.find(r => r.index === index);
      return {
        bucket: result?.impact_bucket || "medium",
        maybe_relevant: result?.maybe_relevant !== false,
      };
    });
    
    return results;
  } catch (error) {
    console.error("Error in Pass 1 classifier:", error.message);
    // Fallback: assume all are medium (will get full analysis)
    return articles.map(() => ({ bucket: "medium", maybe_relevant: true }));
  }
}

/**
 * Batch process multiple articles through Stage 3 (content classification)
 * OPTIMIZED: Pre-drop heuristics, shorter text (1500-2000 chars), two-pass strategy, larger batches (8)
 * @param {Array} articles - Array of article objects
 * @param {Array} userHoldings - User's holdings
 * @returns {Promise<Array>} Array of results for each article
 */
async function processContentClassificationBatch(articles, userHoldings = []) {
  if (!articles || articles.length === 0) return [];
  
  const db = getDatabase();
  
  // Filter out already processed articles and get their content
  const articlesToProcess = [];
  const articleData = [];
  
  for (const article of articles) {
    const existing = db.prepare("SELECT impact_score, clean_text, status, content_length FROM articles WHERE url = ?").get(article.url);
    
    // CRITICAL: Skip if article was discarded in previous stages
    if (existing && existing.status === "discarded") {
      continue; // Skip discarded articles
    }
    
    if (existing && existing.impact_score !== null && existing.impact_score !== undefined) {
      continue; // Skip already processed
    }
    
    if (!existing || !existing.clean_text) {
      continue; // Skip if no content
    }
    
    // GUARDRAIL 5B: Require status = 'content_fetched' and content_length >= 400
    if (existing.status !== "content_fetched") {
      continue; // Skip if not in correct status
    }
    
    const MIN_CONTENT_LENGTH = 400;
    const contentLength = existing.content_length || existing.clean_text.length;
    if (contentLength < MIN_CONTENT_LENGTH) {
      // Mark as discarded
      db.prepare(`
        UPDATE articles SET
          impact_score = 0,
          status = 'discarded',
          updated_at = datetime('now')
        WHERE url = ?
      `).run(article.url);
      continue; // Skip if content too short
    }
    
    const articleRow = db.prepare(`
      SELECT title, clean_text, title_ticker_matches, title_sector_matches, searched_by, status, content_length
      FROM articles WHERE url = ?
    `).get(article.url);
    
    // CRITICAL: Double-check status before processing
    if (articleRow && articleRow.clean_text && articleRow.status === "content_fetched") {
      articlesToProcess.push(article);
      articleData.push(articleRow);
    }
  }
  
  if (articlesToProcess.length === 0) {
    return articles.map(() => ({ skipped: true }));
  }
  
  // If no API key, skip LLM processing
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, skipping batch content classification");
    return articlesToProcess.map(() => ({ status: "skipped" }));
  }
  
  // Declare variables outside try block so they're accessible in catch block
  let articlesForPass2 = [];
  let pass1Dropped = [];
  
  try {
    // Stage 3 is global and user-agnostic - no holdings processing here
    
    // Stage 3 is fully global and user-agnostic
    // All articles that passed the process gate proceed to processing
    const preFiltered = articlesToProcess.map((article, i) => ({
      article,
      data: articleData[i],
      index: i
    }));
    
    // TWO-PASS STRATEGY: Pass 1 - Quick cheap classifier
    console.log(`[Stage 3 Batch] Pass 1: Quick classifier for ${preFiltered.length} articles`);
    const pass1Results = await processContentClassificationPass1(
      preFiltered.map(item => item.article),
      [] // Stage 3 is user-agnostic, pass empty array
    );
    
    // Filter: Only process medium/high bucket articles in Pass 2 (full analysis)
    articlesForPass2 = [];
    pass1Dropped = [];
    
    for (let i = 0; i < preFiltered.length; i++) {
      const item = preFiltered[i];
      const pass1Result = pass1Results[i];
      
      if (!pass1Result.maybe_relevant || pass1Result.bucket === "low") {
        // Drop low bucket articles without full analysis
        pass1Dropped.push({
          article: item.article,
          data: item.data,
          reason: `Pass 1 classifier: ${pass1Result.bucket} impact bucket`,
        });
      } else {
        articlesForPass2.push(item);
      }
    }
    
    // Save Pass 1 dropped articles
    if (pass1Dropped.length > 0) {
      const dropStmt = db.prepare(`
        UPDATE articles SET
          impact_score = 15,
          event_type = 'other',
          status = 'discarded',
          updated_at = datetime('now')
        WHERE url = ?
      `);
      const dropTransaction = db.transaction((dropped) => {
        for (const item of dropped) {
          dropStmt.run(item.article.url);
        }
      });
      dropTransaction(pass1Dropped);
      console.log(`[Stage 3 Batch] Pass 1 dropped ${pass1Dropped.length} articles (low bucket), ${articlesForPass2.length} proceed to Pass 2`);
    }
    
    if (articlesForPass2.length === 0) {
      // All articles dropped in Pass 1 - map results back to original order
      const resultMap = new Map();
      for (const item of pass1Dropped) {
        resultMap.set(item.article.url, {
          impact_score: 15,
          event_type: "other",
          status: "discarded",
          pass1Dropped: true,
        });
      }
      // Map back to original article order
      return articles.map(article => resultMap.get(article.url) || { skipped: true });
    }
    
    // Pass 2: Full analysis only on medium/high bucket articles
    console.log(`[Stage 3 Batch] Pass 2: Full analysis for ${articlesForPass2.length} articles`);
    
    // Build batch prompt with optimized text extraction (intro + conclusion, max 1800 chars)
    const articlesList = articlesForPass2.map((item, index) => {
      const { article, data } = item;
      const content = extractRelevantText(data.clean_text, 1800); // Reduced from 3000 to 1800
      const searchContext = data.searched_by ? ` (Found by searching for: ${data.searched_by})` : "";
      return `Article ${index + 1} (URL: ${article.url}):
Title: ${data.title}
Content: ${content}${searchContext}`;
    }).join("\n\n---\n\n");
    
    const systemPrompt = `You are a financial news analyst that analyzes full article content.
Analyze each article and provide for EACH one:
1. Event type: earnings, m&a, guidance, macro, regulation, product_tech, industry_trend, other
2. Impact score (0-100): How significant is this news for markets?
3. Sentiment (-1 to +1): Negative to positive
4. Sentiment label: negative, neutral, or positive
5. Risk score (0-100): Potential downside risk
6. Opportunity score (0-100): Potential upside opportunity
7. Volatility score (0-100): How much volatility might this cause?
8. Matched tickers: Stock tickers mentioned (JSON array)
9. Matched sectors: Industry sectors mentioned (JSON array)

Return a JSON object where keys are article URLs and values are the analysis:
{
  "URL1": {
    "event_type": "event_type_string",
    "impact_score": 0-100,
    "sentiment": -1.0 to 1.0,
    "sentiment_label": "negative|neutral|positive",
    "risk_score": 0-100,
    "opportunity_score": 0-100,
    "volatility_score": 0-100,
    "matched_tickers": ["TICKER1"],
    "matched_sectors": ["sector1"]
  },
  "URL2": { ... }
}`;
    
    // Stage 3 is global and user-agnostic - no user holdings in prompt
    const userPrompt = `Analyze the following ${articlesForPass2.length} articles (pre-filtered and Pass 1 classified as medium/high impact):

${articlesList}

Return a JSON object with analysis for each article URL.`;
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: Math.min(6000, articlesForPass2.length * 600), // Scale with batch size (increased for larger batches)
    });
    
    // Parse and process results (similar to individual processing)
    const content = response.choices[0].message.content;
    let batchResults;
    
    try {
      batchResults = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        batchResults = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }
    
    // Process results and update database (similar to individual function)
    // Create a map to track which articles were processed and their results
    const resultMap = new Map();
    
    // Mark Pass 1 dropped articles
    for (const item of pass1Dropped) {
      resultMap.set(item.article.url, {
        impact_score: 15,
        event_type: "other",
        status: "discarded",
        pass1Dropped: true,
      });
    }
    
    // Process Pass 2 results (full analysis)
    for (const item of articlesForPass2) {
      const article = item.article;
      const data = item.data;
      const classificationData = batchResults[article.url];
      
      if (!classificationData) {
        console.warn(`No classification data for ${article.url}, using defaults`);
        results.push({ status: "error" });
        continue;
      }
      
      // Validate and sanitize (same as individual processing)
      const event_type = classificationData.event_type || "other";
      const impact_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.impact_score) || 0)));
      const sentiment = Math.max(-1, Math.min(1, Number(classificationData.sentiment) || 0));
      const sentiment_label = classificationData.sentiment_label || "neutral";
      const risk_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.risk_score) || 0)));
      const opportunity_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.opportunity_score) || 0)));
      const volatility_score = Math.max(0, Math.min(100, Math.round(Number(classificationData.volatility_score) || 0)));
      const matched_tickers = Array.isArray(classificationData.matched_tickers)
        ? JSON.stringify(classificationData.matched_tickers.map(t => t.toUpperCase()))
        : "[]";
      const matched_sectors = Array.isArray(classificationData.matched_sectors)
        ? JSON.stringify(classificationData.matched_sectors)
        : "[]";
      
      // Stage 3 is global and user-agnostic - it only identifies tickers/sectors mentioned
      // Holdings matching happens in Stage 4 (personalization)
      const matched_holdings = "[]";
      
      // Determine status
      let status;
      if (impact_score >= 40) {
        status = "llm_processed";
      } else if (impact_score >= 20 && impact_score < 40) {
        status = "llm_processed";
      } else {
        status = "discarded";
      }
      
      // Update database
      db.prepare(`
        UPDATE articles SET
          event_type = ?,
          impact_score = ?,
          sentiment = ?,
          sentiment_label = ?,
          risk_score = ?,
          opportunity_score = ?,
          volatility_score = ?,
          matched_tickers = ?,
          matched_sectors = ?,
          matched_holdings = ?,
          llm_attempts = llm_attempts + 1,
          status = ?,
          processing_completed_at = datetime('now'),
          updated_at = datetime('now')
        WHERE url = ?
      `).run(
        event_type,
        impact_score,
        sentiment,
        sentiment_label,
        risk_score,
        opportunity_score,
        volatility_score,
        matched_tickers,
        matched_sectors,
        matched_holdings,
        status,
        article.url
      );
      
      resultMap.set(article.url, {
        event_type,
        impact_score,
        sentiment,
        sentiment_label,
        risk_score,
        opportunity_score,
        volatility_score,
        matched_tickers: JSON.parse(matched_tickers),
        matched_sectors: JSON.parse(matched_sectors),
        matched_holdings: JSON.parse(matched_holdings),
        status,
      });
    }
    
    // Map results back to original article order
    const results = articles.map(article => {
      return resultMap.get(article.url) || { skipped: true };
    });
    
    console.log(`[Stage 3 Batch] Pass 2: Processed ${articlesForPass2.length} articles in 1 LLM call (${pass1Dropped.length} Pass 1 dropped)`);
    return results;
    
  } catch (error) {
    console.error(`Error in Stage 3 batch content classification:`, error.message);
    // Fallback to individual processing
    if (articlesForPass2 && articlesForPass2.length > 0) {
      console.log(`Falling back to individual processing for ${articlesForPass2.length} articles`);
      const fallbackResults = await Promise.all(
        articlesForPass2.map(item => processContentClassification(item.article, userHoldings).catch(() => ({
          status: "error",
        })))
      );
      return fallbackResults;
    } else {
      // If articlesForPass2 is empty or not initialized, return error status for all articles
      console.log(`No articles to process in fallback, returning error status for all articles`);
      return articles.map(() => ({ status: "error" }));
    }
  }
}

module.exports = {
  processContentClassification,
  processContentClassificationBatch,
};

