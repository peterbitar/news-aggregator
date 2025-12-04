# Enrichment Process Flow Model (PFM)

## Complete Flow: From Toggle to Display

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER INTERACTION                                 │
│  User toggles "✨ AI-Enriched News" switch ON                           │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (NewsAggregator.tsx)                    │
│                                                                          │
│  1. handleEnrichedToggle(true)                                          │
│     - Sets useEnriched = true                                           │
│     - Resets page to 1                                                  │
│     - Saves to localStorage                                             │
│                                                                          │
│  2. Extract holdings tickers                                            │
│     holdingsTickers = ["AAPL", "NVDA", "MSFT"]                          │
│                                                                          │
│  3. React Query triggers fetchNews()                                    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               │ POST /api/news/holdings/enriched
                               │ Body: {
                               │   holdings: ["AAPL", "NVDA", "MSFT"],
                               │   page: 1,
                               │   scrape: false,
                               │   maxArticles: 20
                               │ }
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    BACKEND ENDPOINT (index.js)                           │
│                    POST /api/news/holdings/enriched                      │
│                                                                          │
│  Step 1: Validate Holdings                                              │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ • Check holdings array exists and is valid                 │        │
│  │ • Look up holdings in database by ticker                   │        │
│  │ • Verify holdings exist for user                           │        │
│  │ Result: holdingsFromDB = [                                 │        │
│  │   {id: 1, ticker: "AAPL", label: "Apple Inc."},           │        │
│  │   {id: 2, ticker: "NVDA", label: "Nvidia"},               │        │
│  │   {id: 3, ticker: "MSFT", label: "Microsoft"}             │        │
│  │ ]                                                          │        │
│  └────────────────────────────────────────────────────────────┘        │
│                               │                                          │
│                               ▼                                          │
│  Step 2: Fetch Articles                                                  │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ IF scrape = false:                                         │        │
│  │   → getCachedArticlesForHoldings()                         │        │
│  │   → Query database for articles matching holdings          │        │
│  │   → Apply date/source filters                              │        │
│  │   → Return cached articles                                 │        │
│  │                                                            │        │
│  │ IF scrape = true:                                          │        │
│  │   → fetchArticlesForHoldings()                             │        │
│  │   → For each holding, search:                              │        │
│  │     • "AAPL OR Apple Inc."                                 │        │
│  │     • "NVDA OR Nvidia"                                     │        │
│  │     • "MSFT OR Microsoft"                                  │        │
│  │   → Fetch from NewsAPI + GNews                             │        │
│  │   → Deduplicate articles                                   │        │
│  │   → Save to database                                       │        │
│  │                                                            │        │
│  │ Result: articles = [Article1, Article2, ..., Article20]   │        │
│  └────────────────────────────────────────────────────────────┘        │
│                               │                                          │
│                               ▼                                          │
│  Step 3: Limit Articles                                                  │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ articlesToProcess = articles.slice(0, 20)                  │        │
│  └────────────────────────────────────────────────────────────┘        │
│                               │                                          │
│                               ▼                                          │
│  Step 4: Triage Articles by Title (NEW!)                                │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ triageArticlesByTitle(articlesToProcess)                   │        │
│  │                                                            │        │
│  │ 1. Batch analyze all article titles with LLM              │        │
│  │ 2. Determine which are high-impact events                 │        │
│  │ 3. Filter out:                                            │        │
│  │    - Advertisements and sponsored content                 │        │
│  │    - Clickbait articles                                   │        │
│  │    - Generic/non-financial content                        │        │
│  │    - Low-value or duplicate articles                      │        │
│  │                                                            │        │
│  │ Scoring:                                                  │        │
│  │ - 80-100: High-impact events (earnings, mergers, etc.)    │        │
│  │ - 60-79: Significant news (partnerships, updates)         │        │
│  │ - 40-59: Moderate relevance                               │        │
│  │ - 0-39: Low value or should not enrich                    │        │
│  │                                                            │        │
│  │ 4. Save triage results to database:                       │        │
│  │    - should_enrich (0 or 1)                               │        │
│  │    - triage_reason (why filtered/kept)                    │        │
│  │    - triage_score (0-100)                                 │        │
│  │                                                            │        │
│  │ Result: Only articles with score >= 40 are enriched       │        │
│  └────────────────────────────────────────────────────────────┘        │
│                               │                                          │
│                               ▼                                          │
│  Step 5: Enrich with LLM (Only High-Value Articles)                     │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ enrichArticlesForHoldings(articlesToProcess, holdings,     │        │
│  │                          options, triageResults)            │        │
│  │                                                            │        │
│  │ - Only enriches articles that passed triage                │        │
│  │ - Articles that failed triage are returned unenriched      │        │
│  │   with triageReason and triageScore                        │        │
│  └──────────────────────────────┬─────────────────────────────┘        │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    LLM SERVICE (llmService.js)                           │
│                    enrichArticlesForHoldings()                           │
│                                                                          │
│  Process in batches of 3 articles:                                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ BATCH 1: [Article1, Article2, Article3]                    │        │
│  │                                                            │        │
│  │ For each article, call enrichArticleForHoldings():         │        │
│  │                                                            │        │
│  │ ┌──────────────────────────────────────────────────────┐  │        │
│  │ │ 1. Build OpenAI Prompt                               │  │        │
│  │ │    System: "You are a financial news analyst..."     │  │        │
│  │ │    User:                                             │  │        │
│  │ │      Article Title: "Apple Announces New iPhone"     │  │        │
│  │ │      Article Text: "Apple Inc. unveiled..."          │  │        │
│  │ │      User Holdings:                                  │  │        │
│  │ │        - AAPL (Apple Inc.)                           │  │        │
│  │ │        - NVDA (Nvidia)                               │  │        │
│  │ │        - MSFT (Microsoft)                            │  │        │
│  │ │                                                      │  │        │
│  │ │ 2. Call OpenAI API                                   │  │        │
│  │ │    Model: gpt-4o-mini                                │  │        │
│  │ │    Temperature: 0.3                                  │  │        │
│  │ │    Response Format: JSON                             │  │        │
│  │ │                                                      │  │        │
│  │ │ 3. Parse Response                                    │  │        │
│  │ │    {                                                 │  │        │
│  │ │      "summary": "Apple unveiled new iPhone...",      │  │        │
│  │ │      "whyItMatters": "This could boost Apple's...",  │  │        │
│  │ │      "relevanceScores": {                            │  │        │
│  │ │        "AAPL": 95,                                   │  │        │
│  │ │        "NVDA": 15,                                   │  │        │
│  │ │        "MSFT": 10                                    │  │        │
│  │ │      }                                               │  │        │
│  │ │    }                                                 │  │        │
│  │ │                                                      │  │        │
│  │ │ 4. Save to Database                                  │  │        │
│  │ │    UPDATE articles SET                               │  │        │
│  │ │      summary_enriched = "...",                       │  │        │
│  │ │      why_it_matters = "...",                         │  │        │
│  │ │      relevance_scores_json = '{"AAPL":95,...}',      │  │        │
│  │ │      holding_relevance_score = 40                    │  │        │
│  │ │    WHERE url = '...'                                 │  │        │
│  │ │                                                      │  │        │
│  │ │ 5. Return Enriched Article                           │  │        │
│  │ │    {                                                 │  │        │
│  │ │      ...article,                                     │  │        │
│  │ │      summary: "...",                                 │  │        │
│  │ │      whyItMatters: "...",                            │  │        │
│  │ │      relevanceScores: {AAPL: 95, NVDA: 15, MSFT: 10} │  │        │
│  │ │    }                                                 │  │        │
│  │ └──────────────────────────────────────────────────────┘  │        │
│  │                                                            │        │
│  │ Wait 1 second (rate limiting)                             │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ BATCH 2: [Article4, Article5, Article6]                    │        │
│  │ (Same process as Batch 1)                                  │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                          │
│  ... continues until all articles enriched ...                          │
│                                                                          │
│  Return: [EnrichedArticle1, EnrichedArticle2, ..., EnrichedArticle20]  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               │ Response JSON
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    BACKEND RESPONSE                                      │
│  {                                                                       │
│    status: "ok",                                                         │
│    totalResults: 20,                                                     │
│    articles: [                                                           │
│      {                                                                   │
│        title: "Apple Announces New iPhone",                              │
│        description: "...",                                               │
│        url: "...",                                                       │
│        summary: "Apple unveiled new iPhone...",                          │
│        whyItMatters: "This could boost Apple's...",                      │
│        relevanceScores: {AAPL: 95, NVDA: 15, MSFT: 10}                  │
│      },                                                                  │
│      ...                                                                 │
│    ],                                                                    │
│    holdings: [{ticker: "AAPL", label: "Apple Inc."}, ...],              │
│    cached: true                                                          │
│  }                                                                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND DISPLAY (NewsAggregator.tsx)                 │
│                                                                          │
│  For each enriched article, render:                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │ 📰 News Card                                                │        │
│  │                                                            │        │
│  │ [Article Image]                                            │        │
│  │                                                            │        │
│  │ Apple Announces New iPhone                                 │        │
│  │                                                            │        │
│  │ Source: TechCrunch  🕐 2 hours ago                         │        │
│  │                                                            │        │
│  │ ─────────────────────────────────────                      │        │
│  │ 📝 Summary:                                                │        │
│  │ Apple unveiled new iPhone with advanced AI features...     │        │
│  │                                                            │        │
│  │ [Article description...]                                   │        │
│  │                                                            │        │
│  │ ─────────────────────────────────────                      │        │
│  │ 💡 Why this matters:                                       │        │
│  │ This could boost Apple's market position and revenue...    │        │
│  │                                                            │        │
│  │ ─────────────────────────────────────                      │        │
│  │ Relevance Scores:                                          │        │
│  │ [AAPL: 95%] [NVDA: 15%] [MSFT: 10%]                       │        │
│  │ (Color-coded: Green ≥70%, Yellow ≥40%, Gray <40%)         │        │
│  │                                                            │        │
│  │ Read more →                                                │        │
│  └────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘

```

## Example: Real-World Scenario

### User Setup
- **Holdings**: AAPL, NVDA, MSFT
- **Action**: Toggles "AI-Enriched News" ON

### Flow Execution

1. **Article Fetching**
   - Searches: "AAPL OR Apple Inc.", "NVDA OR Nvidia", "MSFT OR Microsoft"
   - Finds 20 articles from NewsAPI/GNews
   - Articles saved to database

2. **Triage Process** (Batch Analysis of All Titles)
   
   **Input:** 20 article titles
   
   **LLM Batch Analysis:**
   ```json
   {
     "results": [
       {
         "index": 0,
         "shouldEnrich": true,
         "score": 95,
         "reason": "High-impact: Nvidia earnings announcement"
       },
       {
         "index": 1,
         "shouldEnrich": false,
         "score": 15,
         "reason": "Advertisement: Sponsored content about trading apps"
       },
       {
         "index": 2,
         "shouldEnrich": true,
         "score": 75,
         "reason": "Significant: Apple announces new product partnership"
       },
       {
         "index": 3,
         "shouldEnrich": false,
         "score": 25,
         "reason": "Clickbait: Generic market prediction article"
       }
       // ... 16 more articles
     ]
   }
   ```
   
   **Result:** 12 articles pass triage, 8 are filtered out
   - Saved to database: `should_enrich`, `triage_reason`, `triage_score`

3. **Enrichment Process** (Only for Articles That Passed Triage)

   **Input Article:**
   ```
   Title: "Nvidia Stock Surges on AI Chip Demand"
   Content: "Nvidia's stock price jumped 8% after reporting strong demand..."
   ```

   **LLM Analysis:**
   ```json
   {
     "summary": "Nvidia's stock surged 8% due to strong AI chip demand, 
                 driven by increased enterprise adoption of AI technologies.",
     "whyItMatters": "This reflects growing market confidence in Nvidia's 
                      AI leadership and could signal continued growth in 
                      the semiconductor sector.",
     "relevanceScores": {
       "AAPL": 25,  // Indirect - Apple uses AI chips
       "NVDA": 95,  // Direct - Article is about Nvidia
       "MSFT": 30   // Indirect - Microsoft partners with Nvidia
     }
   }
   ```

3. **Database Storage**
   ```sql
   UPDATE articles SET
     summary_enriched = "Nvidia's stock surged 8%...",
     why_it_matters = "This reflects growing market confidence...",
     relevance_scores_json = '{"AAPL":25,"NVDA":95,"MSFT":30}',
     holding_relevance_score = 50  -- Average: (25+95+30)/3
   WHERE url = 'https://...'
   ```

4. **Frontend Display**
   - Shows article with summary
   - Displays "Why this matters" section
   - Shows relevance badges: **NVDA: 95%** (green), **MSFT: 30%** (gray), **AAPL: 25%** (gray)

## Key Features

- **Batch Processing**: 3 articles at a time with 1-second delays
- **Error Handling**: Falls back to unenriched article if LLM fails
- **Caching**: Enrichment data saved to database for future requests
- **Rate Limiting**: Respects OpenAI API limits
- **Smart Scoring**: Relevance based on direct mentions, industry impact, indirect connections

