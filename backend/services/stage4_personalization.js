const OpenAI = require("openai");
const { getDatabase } = require("../db");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stage 4: Personalization
 * Personalize the article to the user based on their holdings and profile
 * 
 * Columns filled:
 * - holding_relevance_score (0-100)
 * - profile_adjusted_score (0-100)
 * - summary_short
 * - summary_medium
 * - summary_long
 * - personalized_title
 * - personalized_teaser
 * - status = "personalized"
 */
async function processPersonalization(article, userHoldings = [], userProfile = "balanced") {
  const db = getDatabase();

  // Check if already processed - skip if profile_adjusted_score is already set
  const existing = db.prepare(`
    SELECT profile_adjusted_score, status, summary_short, summary_medium, summary_long, 
           personalized_title, personalized_teaser, profile_type_cached
    FROM articles WHERE url = ?
  `).get(article.url);
  
  // CRITICAL: Skip if article was discarded in previous stages
  if (existing && existing.status === "discarded") {
    console.log(`[Stage 4] Skipping ${article.url} - article was discarded in previous stage`);
    return {
      status: "discarded",
      skipped: true,
      reason: "Already discarded",
    };
  }
  
  // GUARDRAIL 5C: Check cache by (url, profileType) before calling LLM
  // Add proper cache by (url, profileType) using profile_type_cached and profile_adjusted_score
  if (existing && existing.profile_type_cached === userProfile && existing.profile_adjusted_score !== null) {
    // Cache hit - skip LLM, reuse cached personalization
    console.log(`[Stage 4] Using cached personalization for ${article.url} (profile: ${userProfile}, score: ${existing.profile_adjusted_score})`);
    
    return {
      status: existing.status || "personalized",
      skipped: true,
      cached: true,
      profile_adjusted_score: existing.profile_adjusted_score,
      summary_short: existing.summary_short,
      summary_medium: existing.summary_medium,
      summary_long: existing.summary_long,
      personalized_title: existing.personalized_title,
      personalized_teaser: existing.personalized_teaser,
    };
  }
  
  if (existing && existing.profile_adjusted_score !== null && existing.profile_adjusted_score !== undefined) {
    // Already processed but different profile type - will regenerate
    console.log(`[Stage 4] Article already processed for different profile: ${article.url} (cached profile: ${existing.profile_type_cached}, requested: ${userProfile})`);
  }

  // If no API key, skip LLM processing
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, skipping personalization");
    return { status: "skipped" };
  }

  // GUARDRAIL 5C: Get article data from database, including matched_holdings and impact_score
  const articleRow = db.prepare(`
    SELECT title, clean_text, impact_score, matched_holdings, matched_tickers, event_type
    FROM articles WHERE url = ?
  `).get(article.url);

  if (!articleRow) {
    return { status: "no_article" };
  }

  // GUARDRAIL 5C: Check matched_holdings and impact_score before calling LLM
  const matchedHoldings = articleRow.matched_holdings 
    ? JSON.parse(articleRow.matched_holdings) 
    : [];
  const impactScore = articleRow.impact_score || 0;
  const IMPACT_THRESHOLD = 40; // Configurable threshold

  // Skip Stage 4 LLM if matched_holdings is empty OR impact_score < threshold
  if (matchedHoldings.length === 0 || impactScore < IMPACT_THRESHOLD) {
    console.log(`[Stage 4] Skipping LLM for ${article.url} - matched_holdings: ${matchedHoldings.length}, impact_score: ${impactScore} < ${IMPACT_THRESHOLD}`);
    
    // Option B: Set status = 'discarded' if you want only high impact items in My Feed
    const status = "discarded";
    const profile_adjusted_score = Math.min(100, impactScore * 0.6); // Low score since no holding match
    
    db.prepare(`
      UPDATE articles SET
        holding_relevance_score = 0,
        profile_adjusted_score = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(profile_adjusted_score, status, article.url);
    
    return {
      status,
      skipped: true,
      reason: matchedHoldings.length === 0 
        ? "No matched holdings" 
        : `Impact score ${impactScore} < ${IMPACT_THRESHOLD}`,
      profile_adjusted_score,
    };
  }

  try {
    // Prepare holdings list
    const holdingsList = userHoldings.map((h) => ({
      ticker: h.ticker,
      label: h.label || h.ticker,
      notes: h.notes || "",
    }));

    // Parse matched holdings (already parsed above for guardrail check, but keep for consistency)
    // Note: matchedHoldings and impactScore already parsed above in guardrail check
    const matchedTickers = articleRow.matched_tickers
      ? JSON.parse(articleRow.matched_tickers)
      : [];

    // Calculate holding relevance score (0-100)
    let holding_relevance_score = 0;
    if (matchedHoldings.length > 0) {
      // Direct match = high relevance
      holding_relevance_score = Math.min(100, 60 + (matchedHoldings.length * 15));
    } else if (matchedTickers.length > 0) {
      // Indirect match = medium relevance
      holding_relevance_score = 40;
    }

    // System prompt
    const systemPrompt = `You are a personal financial news assistant that creates personalized summaries and titles for investors.
Generate personalized content based on the user's holdings and investment profile.

Create:
1. Short summary (1-2 sentences)
2. Medium summary (2-3 sentences)
3. Long summary (3-5 sentences)
4. Personalized title (more relevant to user's holdings)
5. Personalized teaser (hook that explains why this matters to them)

Always respond with valid JSON in this exact format:
{
  "summary_short": "1-2 sentence summary",
  "summary_medium": "2-3 sentence summary",
  "summary_long": "3-5 sentence summary",
  "personalized_title": "Title personalized to user",
  "personalized_teaser": "Hook explaining why this matters"
}`;

    // User prompt
    const userPrompt = `Article Title: ${articleRow.title}
Event Type: ${articleRow.event_type || "unknown"}
Impact Score: ${articleRow.impact_score || 0}/100

Article Content (excerpt):
${(articleRow.clean_text || "").substring(0, 3000)}${(articleRow.clean_text || "").length > 3000 ? "..." : ""}

User Holdings: ${holdingsList.length > 0 
  ? holdingsList.map(h => `${h.ticker} (${h.label})${h.notes ? ` - ${h.notes}` : ""}`).join(", ")
  : "None"}

Matched Holdings: ${matchedHoldings.join(", ") || "None"}
Matched Tickers: ${matchedTickers.join(", ") || "None"}

User Profile: ${userProfile} (focus/balanced/broad)

Create personalized content that highlights:
- How this news specifically affects their holdings
- Why it matters to them personally
- What they should watch for

Return ONLY valid JSON, no markdown formatting.`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5, // Slightly higher for creative personalization
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    // Parse JSON response
    const content = response.choices[0].message.content;
    let personalizationData;

    try {
      personalizationData = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        personalizationData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Invalid JSON response from LLM");
      }
    }

    // Extract fields
    const summary_short = (personalizationData.summary_short || articleRow.title || "").trim();
    const summary_medium = (personalizationData.summary_medium || summary_short || "").trim();
    const summary_long = (personalizationData.summary_long || summary_medium || "").trim();
    const personalized_title = (personalizationData.personalized_title || articleRow.title || "").trim();
    const personalized_teaser = (personalizationData.personalized_teaser || summary_short || "").trim();

    // Calculate profile_adjusted_score based on user profile
    const impact_score = articleRow.impact_score || 0;
    let profile_adjusted_score = holding_relevance_score;
    
    // Adjust based on profile type
    if (userProfile === "focus") {
      // Focus profile: Higher weight on holding relevance
      profile_adjusted_score = Math.min(100, holding_relevance_score * 1.2 + impact_score * 0.3);
    } else if (userProfile === "balanced") {
      // Balanced: Equal weight
      profile_adjusted_score = Math.min(100, holding_relevance_score * 0.6 + impact_score * 0.4);
    } else {
      // Broad: Higher weight on impact
      profile_adjusted_score = Math.min(100, holding_relevance_score * 0.4 + impact_score * 0.6);
    }

    // Determine status based on profile_adjusted_score
    let status;
    if (profile_adjusted_score >= 70) {
      status = "personalized"; // Very relevant, move to Stage 5
    } else if (profile_adjusted_score >= 40 && profile_adjusted_score < 70) {
      status = "personalized"; // Moderate relevance, candidate for feed
    } else {
      status = "discarded"; // Low relevance, discard
    }

    // Update database (cache profile type for future reuse)
    db.prepare(`
      UPDATE articles SET
        holding_relevance_score = ?,
        profile_adjusted_score = ?,
        summary_short = ?,
        summary_medium = ?,
        summary_long = ?,
        personalized_title = ?,
        personalized_teaser = ?,
        profile_type_cached = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      holding_relevance_score,
      profile_adjusted_score,
      summary_short,
      summary_medium,
      summary_long,
      personalized_title,
      personalized_teaser,
      userProfile, // Cache the profile type
      status,
      article.url
    );

    return {
      holding_relevance_score,
      profile_adjusted_score,
      summary_short,
      summary_medium,
      summary_long,
      personalized_title,
      personalized_teaser,
      status,
    };
  } catch (error) {
    console.error(`Error in Stage 4 personalization for ${article.url}:`, error.message);
    
    // On error, use fallback scores
    const impact_score = articleRow.impact_score || 0;
    const profile_adjusted_score = Math.min(100, holding_relevance_score * 0.6 + impact_score * 0.4);
    
    db.prepare(`
      UPDATE articles SET
        holding_relevance_score = ?,
        profile_adjusted_score = ?,
        status = 'personalized',
        last_error = ?,
        updated_at = datetime('now')
      WHERE url = ?
    `).run(
      holding_relevance_score,
      profile_adjusted_score,
      error.message.substring(0, 500),
      article.url
    );

    return {
      holding_relevance_score,
      profile_adjusted_score,
      status: "personalized",
      error: error.message,
    };
  }
}

module.exports = {
  processPersonalization,
};

