# Updated App Logic Explanation

## The Big Picture

The system processes news in stages, with three core priorities:
1. **Cost control:** Don't do expensive things until necessary
2. **Interpret once:** Meaning is global and reused across all users
3. **Personalization:** Adjusts priority, not meaning

---

## The Flow (7 Steps)

### Step 1: Ingestion (Every 20 Minutes)

**What happens:** The system fetches new articles from news sources.

**Two buckets:**

1. **Holdings bucket** (if user has holdings):
   - Searches for news about specific tickers (e.g., "NVDA", "AAPL")
   - Smaller limits per source (5 articles each)
   - Tags each article with the ticker that found it

2. **Macro bucket** (always runs):
   - Fetches event-driven financial/market news
   - Topics: "CPI inflation surprise", "Federal Reserve rate decision", "bond yields spike", "recession indicator", "oil prices surge", "credit spreads widening", "bank stress", "geopolitical escalation markets", "USD rallies", "gold plunges", "unemployment claims", "housing market crash"
   - **Hard cap:** Maximum 100 total macro headlines per run (distributed across all queries)
   - Tags articles as "MACRO"

**Result:** Articles are saved to the database. Duplicates are removed. Articles are marked as "pending" or "null" status.

---

### Step 2: Title Triage (Stage 1)

**What happens:** The system looks at article titles, filters junk, and scores relevance.

**Process:**
- Quick filters remove obvious junk (e.g., "Morning Brief", "Top 10 Moves", ads)
- For promising titles, the AI reads the title and determines:
  - Relevance (0-3)
  - Event type (earnings, merger, etc.)
  - Any tickers mentioned

**Result:** Articles get a `title_relevance` score. Low-quality articles are marked "discarded". Good ones are marked "title_filtered" and move forward to Stage 1.5, which decides whether to fetch full content.

---

### Step 2.5: Lightweight Impact Guess (Stage 1.5) — Cost Control Gate

**What happens:** Before fetching expensive full content, the system estimates likely impact using ONLY title + snippet + source + tags.

**Process:**
- Calculates `likely_impact` (0-100) based on:
  - Title relevance (0-30 points)
  - Event type boost (high-impact events get +20)
  - Generic asset/sector presence signal (+10): Detects generic asset/sector/macro terms in title/snippet (e.g., gold, oil, yields, banks, inflation). Does NOT map to any user holdings. Does NOT require ticker matching.
  - Source quality (+5)
  - Macro/holdings tags (indicates article type, not personalization)
- **Process Gate:** Only if `likely_impact >= 30` (PROCESS_GATE_THRESHOLD) does the article proceed to full content fetch
- Articles below threshold are marked "low_priority" but NOT discarded (may still appear in feed if other signals are strong)

**Result:** Articles get a `likely_impact` score. Only articles above the process gate threshold proceed to expensive content fetching.

**Important:** Stage 1.5 does not know or care which user holds what. Stage 1.5 is global and cheap - no personalization logic here. Personalization boosts happen only in Stage 4.

**Cost control:** This gate is designed to reduce deep processing volume by >50% by preventing expensive scraping and deep LLM processing for low-impact articles.

---

### Step 3: Content Fetching (Stage 2) — Only If Likely Impact Passes Gate

**What happens:** The system downloads and cleans the full article text (ONLY for articles that passed the process gate).

**Process:**
- Fetches the full HTML
- Removes ads, navigation, etc.
- Extracts readable text
- Checks if content is long enough (minimum length)

**Result:** Articles get `clean_text` and are marked "content_fetched". Too-short or unfetchable articles are discarded.

**Cost control:** Only articles with `likely_impact >= PROCESS_GATE_THRESHOLD` reach this expensive step.

---

### Step 4: Content Classification (Stage 3) — Global Interpretation

**What happens:** The AI reads the full article and extracts structured insights. **This interpretation is GLOBAL and reused across all users.**

**Process:**
- Analyzes the full article
- Determines:
  - Impact score (0-100)
  - Event type
  - Sentiment
  - Risk, opportunity, volatility scores
  - Which tickers/sectors are mentioned (used later for scoring)
- **Sets global interpretation fields:**
  - `verdict` ("ignore", "aware", "act")
  - `why` (array of reasons, max 3)
  - `action` (from safe list)
  - `opportunity_type`
  - `opportunity_note`

**Result:** Articles get an `impact_score` and are marked "llm_processed". All articles that passed the process gate complete this stage. Low impact affects ranking later, not processing completion.

**Important:** 
- Articles don't need to match holdings to pass. Macro news can have high impact and proceed.
- Interpretation fields (verdict, why, action) are set here and **reused globally** - they are NOT personalized per user.
- Discarding only happens in Stage 1 (junk filtering) or Stage 1.5 (process gate).

---

### Step 5: Personalization (Stage 4) — Score Adjustments Only

**What happens:** The system adjusts scoring/priority based on user's holdings and profile. **It does NOT generate new summaries or change meaning.**

**Process:**
- **Does NOT call LLM** - only calculates score adjustments
- Calculates `holding_relevance_score`:
  - Base score: 20 (all articles get this, ensures macro news appears)
  - Holdings match: +10 to +25 (conservative boost, impact remains dominant driver)
- Calculates `profile_adjusted_score` based on:
  - Holdings relevance (conservative boost)
  - Impact score (dominant driver)
  - User profile (focus/balanced/broad)
- Uses minimum score (20) to determine if article should proceed to Stage 5 (ranking)

**Result:** Articles get a `profile_adjusted_score` and are marked "personalized".

**Important:** 
- **Stage 4 does NOT modify interpretation fields** (verdict, why, action, summaries)
- Interpretation is global and set in Stage 3, reused across all users
- Personalization only adjusts scoring/priority
- Articles without holdings matches still get base score (20) so they can appear in feed

---

### Step 6: Ranking & Clustering (Stage 5) — Every 10 Minutes

**What happens:** The system ranks articles and optionally groups similar ones.

**Process:**
- Optionally groups duplicate stories (same story from different sources)
- If clustering succeeds: picks the best article from each group
- If clustering fails or is skipped: treats each article individually (graceful degradation)
- Calculates final rank score based on:
  - Personalization score
  - Impact score
  - Recency
- **Applies safety guardrails** (removes advice language)

**Result:** Articles get a `final_rank_score` and are marked "ranked". They're ready for the feed. Ranking always completes even if clustering fails. User-specific "shown" state (if needed) is handled at feed delivery or later, not in this stage.

**Guardrails:** Applied here to ensure no financial advice reaches users.

---

### Step 7: Feed Delivery

**What happens:** When the user opens the app, the feed is ready.

**Process:**
- Fetches ranked articles (status = "ranked")
- **Uses `FEED_RANK_THRESHOLD` (40) to filter what appears** - this is the ONLY place this threshold is applied
- Orders articles by `final_rank_score` (which already includes holdings boost from Stage 4)
- **Includes all articles that meet the threshold** - holdings boost was applied in Stage 4, not here
- Applies guardrails one more time (optional safety check)
- Returns clean "Signals" to the app

**Result:** User sees a personalized feed with:
- Holdings-related news prioritized (boosted)
- Macro/market news included (if they meet threshold)
- All content safe (no financial advice)

---

## Timeline Summary

- **Every 20 minutes:** Fetch new articles (holdings + macro)
- **Every 2 minutes:** Process pending articles (Stages 1-4)
- **Every 10 minutes:** Rank and cluster articles (Stage 5)
- **On demand:** User opens app → sees ready feed

---

## Key Points

1. **Two-bucket ingestion:** Holdings-specific + event-driven macro news (always)
2. **Cost-aware:** Lightweight impact guess (Stage 1.5) gates expensive processing
3. **Interpret once:** Stage 3 sets global interpretation, reused across all users
4. **Personalization is scoring only:** Stage 4 adjusts scores, does NOT rewrite meaning
5. **Split thresholds:**
   - `PROCESS_GATE_THRESHOLD` (30): Gates expensive content fetch + deep LLM (used at Stage 1.5)
   - `FEED_RANK_THRESHOLD` (40): Minimum score to appear in feed (used only at feed query time)
6. **Not holdings-gated:** All relevant articles appear, holdings just boost priority
7. **Safety:** Guardrails remove advice language at Stage 5

---

## Thresholds Explained

- **PROCESS_GATE_THRESHOLD (30):** Gates expensive processing (content fetch + deep LLM). Used at Stage 1.5 to decide if article should proceed to full content fetch. Articles below this are marked "low_priority" but not discarded.

- **FEED_RANK_THRESHOLD (40):** Minimum score to appear in feed. Applied only at feed query time (Step 7), not during processing stages. This is for ranking/display, not process gating. Macro items can show even if they aren't holdings-related.

---

## What Users Experience

1. Holdings-related news appears first (boosted)
2. Macro/market news still appears (if it meets threshold)
3. All content is safe (no financial advice)
4. Interpretation is consistent (same verdict/action for same article)
5. Feed is always ready (processed in background)

---

## Bottom Line

The system is:
- **Cost-efficient:** Gates expensive processing early (designed to reduce deep processing volume by >50%)
- **Consistent:** Interprets once, reuses globally
- **Personalized:** Adjusts priority, not meaning
- **Complete:** Shows holdings news + macro signals
- **Safe:** Removes advice language automatically

This reduces costs, improves consistency, and ensures users see relevant news with holdings prioritized, while still including important macro and market signals.

