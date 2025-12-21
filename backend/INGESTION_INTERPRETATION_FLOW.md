# Ingestion + Interpretation Flow (Step by Step)

## Overview
The system runs automatically every few minutes. It fetches news, interprets it once globally, and prepares it for personalized feeds.

---

## Step 1: Ingestion (Every 20 Minutes)

**What happens:** The system fetches new articles from news sources.

**Two buckets:**

1. **Holdings bucket** (if user has holdings):
   - Searches for news about specific tickers (e.g., "NVDA", "AAPL")
   - Smaller limits per source (5 articles each)
   - Tags each article with the ticker that found it

2. **Macro bucket** (always runs):
   - Fetches event-driven financial/market news
   - Topics: "CPI inflation surprise", "Federal Reserve rate decision", "bond yields spike", "recession indicator", "oil prices surge", "credit spreads widening", "bank stress", "geopolitical escalation markets", "USD rallies", "gold plunges", "unemployment claims", "housing market crash"
   - Hard cap: Maximum 100 total macro headlines per run (distributed across all queries)
   - Tags articles as "MACRO"

**Result:** Articles are saved to the database. Duplicates are removed. Articles are marked as "pending" or "null" status.

---

## Step 2: Title Triage (Stage 1) — Part of Processing

**What happens:** The system looks at article titles and decides which ones are worth reading in full.

**Process:**
- Quick filters remove obvious junk (e.g., "Morning Brief", "Top 10 Moves", ads)
- For promising titles, the AI reads the title and decides:
  - Relevance (0-3)
  - Event type (earnings, merger, etc.)
  - Whether to fetch full content
  - Any tickers mentioned

**Result:** Articles get a `title_relevance` score. Low-quality articles are marked "discarded". Good ones are marked "title_filtered" and move forward.

**Cost control:** Only promising articles proceed to expensive steps.

---

## Step 2.5: Lightweight Impact Guess (Stage 1.5) — NEW COST CONTROL GATE

**What happens:** Before fetching expensive full content, the system estimates likely impact using ONLY title + snippet + source + tags.

**Process:**
- Calculates `likely_impact` (0-100) based on:
  - Title relevance (0-30 points)
  - Event type boost (high-impact events get +20)
  - Ticker matches (+15)
  - Sector matches (+10)
  - Source quality (+5)
  - Macro/holdings tags (indicates article type, not personalization)
- **Process Gate:** Only if `likely_impact >= 30` (PROCESS_GATE_THRESHOLD) does the article proceed to full content fetch
- Articles below threshold are marked "low_priority" but NOT discarded (may still appear in feed if other signals are strong)
- **Note:** Stage 1.5 is global and cheap - no personalization logic here. Personalization boosts happen only in Stage 4.

**Result:** Articles get a `likely_impact` score. Only articles above the process gate threshold proceed to expensive content fetching.

**Cost control:** This gate prevents expensive scraping and deep LLM processing for low-impact articles.

---

## Step 3: Content Fetching (Stage 2) — Only If Likely Impact Passes Gate

**What happens:** The system downloads and cleans the full article text (ONLY for articles that passed the process gate).

**Process:**
- Fetches the full HTML
- Removes ads, navigation, etc.
- Extracts readable text
- Checks if content is long enough (minimum length)

**Result:** Articles get `clean_text` and are marked "content_fetched". Too-short or unfetchable articles are discarded.

**Cost control:** Only articles with `likely_impact >= PROCESS_GATE_THRESHOLD` reach this expensive step.

---

## Step 4: Content Classification (Stage 3) — Global Interpretation

**What happens:** The AI reads the full article and extracts structured insights. **This interpretation is GLOBAL and reused across all users.**

**Process:**
- Analyzes the full article
- Determines:
  - Impact score (0-100)
  - Event type
  - Sentiment
  - Risk, opportunity, volatility scores
  - Which tickers/sectors are mentioned
  - Whether it matches user holdings (for scoring, not gating)
- **Sets global interpretation fields:**
  - `verdict` ("ignore", "aware", "act")
  - `why` (array of reasons, max 3)
  - `action` (from safe list)
  - `opportunity_type`
  - `opportunity_note`

**Result:** Articles get an `impact_score` and are marked "llm_processed". Low-impact articles (<30) are discarded.

**Important:** 
- Articles don't need to match holdings to pass. Macro news can have high impact and proceed.
- Interpretation fields (verdict, why, action) are set here and **reused globally** - they are NOT personalized per user.

---

## Step 5: Personalization (Stage 4) — Score Adjustments Only

**What happens:** The system adjusts scoring/priority based on user's holdings and profile. **It does NOT generate new summaries or change meaning.**

**Process:**
- **Does NOT call LLM** - only calculates score adjustments
- Calculates `holding_relevance_score`:
  - Base score: 20 (all articles get this, ensures macro news appears)
  - Holdings match: +60 to +100
  - Ticker match: +40
- Calculates `profile_adjusted_score` based on:
  - Holdings relevance
  - Impact score
  - User profile (focus/balanced/broad)
- Uses minimum score (20) to determine if article should proceed to Stage 5 (ranking)

**Result:** Articles get a `profile_adjusted_score` and are marked "personalized".

**Important:** 
- **Stage 4 does NOT modify interpretation fields** (verdict, why, action, summaries)
- Interpretation is global and set in Stage 3, reused across all users
- Personalization only adjusts scoring/priority
- Articles without holdings matches still get base score (20) so they can appear in feed

---

## Step 6: Ranking & Clustering (Stage 5) — Every 10 Minutes

**What happens:** The system ranks articles and groups similar ones.

**Process:**
- Groups similar articles (same story from different sources)
- Picks the best article from each group
- Calculates final rank score based on:
  - Personalization score
  - Impact score
  - Recency
- **Applies safety guardrails** (removes advice language)
- Marks top articles as "shown_to_user"

**Result:** Articles get a `final_rank_score` and are marked "ranked". They're ready for the feed.

**Guardrails:** Applied here to ensure no financial advice reaches users.

---

## Step 7: Feed Delivery

**What happens:** When the user opens the app, the feed is ready.

**Process:**
- Fetches ranked articles (status = "ranked")
- Uses `FEED_RANK_THRESHOLD` (40) to filter what appears
- Prioritizes holdings-related articles (boosts their score by +10)
- **But includes all articles that meet the threshold** - holdings are a boost, not a filter
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

1. **Two-bucket ingestion:** Holdings-specific + macro news (always)
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

The system ensures users see relevant news, with holdings-related content prioritized, while still including important macro and market signals. All interpretation is done once globally and reused, while personalization only adjusts scoring.

