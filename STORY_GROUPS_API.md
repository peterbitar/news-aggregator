# Story Groups API Documentation

## Overview

The Story Groups API provides a **calm, friendly explanation layer** that:
- Groups similar articles into "story groups"
- Produces structured explanations (context + what happened + impact + what to watch)
- Supports both **global** (everyone) and **ticker-scoped** (per holding) story groups
- Includes observability through decision logs for monitoring

### Core Principles

- **No buy/sell language** - All explanations are factual and neutral
- **No predictions** - Only signals to watch, no forecasts
- **Calm tone** - No urgency, hype, or emotional language
- **No re-ranking** - Only explain and group ranked inputs

---

## User-Facing API

### GET /v1/feed/story-groups

Returns clustered story groups composed for the current user based on their holdings.

#### Request

```bash
curl -H "x-user-id: 1" \
  "http://localhost:5002/v1/feed/story-groups?date=2026-01-02&limit_global=5&limit_per_ticker=3"
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `date` | string | today | Date in YYYY-MM-DD format |
| `limit_global` | integer | 5 | Max GLOBAL groups to return |
| `limit_per_ticker` | integer | 3 | Max groups per ticker in holdings |

#### Response

```json
{
  "date": "2026-01-02",
  "user_id": 1,
  "user_holdings": ["AAPL", "NVDA"],
  "generated_at": "2026-01-02T17:02:40.007Z",

  "global": [
    {
      "id": 1,
      "scope": "GLOBAL",
      "primary_ticker": null,
      "group_title": "Fed maintains rates at 4.0–4.25%; inflation data watched",
      "impact_level": "Moderate",
      "confidence_level": "High",
      "article_count": 3,
      "model_version": "v1.2",
      "pipeline_version": "v2.1",
      "date_bucket": "2026-01-02",
      "created_at": "2026-01-02 17:02:09",
      "explanation": {
        "what_happened": "Federal Reserve held the benchmark interest rate...",
        "why_it_matters_now": "With inflation cooling but still above target...",
        "who_this_applies_to": "All investors and savers. Affects yields...",
        "what_to_watch_next": "Watch CPI print Thursday 10 AM ET...",
        "what_this_does_not_mean": "Does not indicate imminent rate cuts...",
        "sources_summary": ["Reuters", "Bloomberg", "Federal Reserve", "MarketWatch"]
      },
      "articles": [
        {
          "article_id": "https://example.com/fed-rate-decision",
          "similarity_score": 0.98,
          "added_at": "2026-01-02 17:02:09"
        }
      ],
      "related_tickers": []
    }
  ],

  "by_ticker": {
    "AAPL": [
      {
        "id": 3,
        "scope": "TICKER",
        "primary_ticker": "AAPL",
        "group_title": "AAPL posts strong earnings; margins hold steady",
        ...
      }
    ],
    "NVDA": [
      {
        "id": 4,
        "scope": "TICKER",
        "primary_ticker": "NVDA",
        "group_title": "NVDA faces expanded export controls; China revenue capped",
        ...
      }
    ]
  },

  "merged_feed": [
    {
      ...all groups sorted by impact_level DESC
    }
  ],

  "metadata": {
    "total_groups": 4,
    "total_articles_clustered": 6,
    "dedup_removed": 0,
    "cache_ttl_seconds": 3600
  }
}
```

#### Explanation Fields

Each story group includes a structured explanation with these fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `what_happened` | string | Neutral facts about the event | "Apple reported Q1 FY2026 earnings of $2.18/share..." |
| `why_it_matters_now` | string | Context and current relevance (no urgency) | "AAPL continues to balance competitive pressure..." |
| `who_this_applies_to` | string | Target audience (GLOBAL: "broad market", TICKER: "holders of {ticker}") | "Holders of AAPL. Investors with broad tech exposure." |
| `what_to_watch_next` | string | Signals/indicators to monitor (no predictions) | "iPhone 18 cycle; Services growth rate; margin guidance" |
| `what_this_does_not_mean` | string | Guardrails to prevent misinterpretation | "Does not guarantee future beats. Risks persist." |
| `sources_summary` | array | Source outlets that contributed | ["Seeking Alpha", "MarketWatch", "The Motley Fool"] |

---

## Admin/Monitoring API

### GET /internal/decision-logs

Get decision logs for monitoring pipeline decisions. **Requires x-internal-key header.**

#### Request

```bash
curl -H "x-internal-key: YOUR_API_KEY" \
  "http://localhost:5002/internal/decision-logs?stage=clustering&scope=TICKER&ticker=AAPL&limit=50&offset=0"
```

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `stage` | string | Filter by stage name: `clustering`, `llm_filtering`, `impact_scoring`, etc. |
| `scope` | string | Filter by scope: `GLOBAL` or `TICKER` |
| `ticker` | string | Filter by primary_ticker (for TICKER scope) |
| `limit` | integer | Max results (default 100) |
| `offset` | integer | Pagination offset (default 0) |

#### Response

```json
{
  "logs": [
    {
      "id": 1,
      "article_id": "https://example.com/fed-rate-decision",
      "stage_name": "clustering",
      "accepted": 1,
      "reason_llm": "High similarity to Fed decision story; primary article",
      "rank_score": 0.95,
      "impact_score": 0.88,
      "quality_score": 0.96,
      "scope": "GLOBAL",
      "primary_ticker": null,
      "created_at": "2026-01-02 17:02:09"
    }
  ],
  "total": 8,
  "limit": 50,
  "offset": 0
}
```

---

### GET /internal/decision-logs/:articleUrl

Get all decision logs for a specific article across all pipeline stages.

#### Request

```bash
curl -H "x-internal-key: YOUR_API_KEY" \
  "http://localhost:5002/internal/decision-logs/https%3A%2F%2Fexample.com%2Ffed-rate-decision"
```

#### Response

```json
{
  "article_url": "https://example.com/fed-rate-decision",
  "logs": [
    {
      "stage_name": "clustering",
      "accepted": 1,
      "reason_llm": "High similarity to Fed decision story",
      ...
    }
  ],
  "total": 3
}
```

---

### GET /internal/story-groups

Get story groups summary for a specific date.

#### Request

```bash
curl -H "x-internal-key: YOUR_API_KEY" \
  "http://localhost:5002/internal/story-groups?date=2026-01-02&scope=GLOBAL"
```

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `date` | string | Filter by date (YYYY-MM-DD, default: today) |
| `scope` | string | Filter by scope: `GLOBAL` or `TICKER` |
| `ticker` | string | Filter by primary_ticker |

#### Response

```json
{
  "date": "2026-01-02",
  "groups": [
    {
      "id": 1,
      "scope": "GLOBAL",
      "primary_ticker": null,
      "group_title": "Fed maintains rates at 4.0–4.25%; inflation data watched",
      "impact_level": "Moderate",
      "confidence_level": "High",
      "article_count": 3,
      ...
    }
  ],
  "total": 2
}
```

---

## Database Schema

### story_groups

Core table for clustered story explanations.

```sql
CREATE TABLE story_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK(scope IN ('GLOBAL', 'TICKER')),
  primary_ticker TEXT,                 -- NULL for GLOBAL, ticker symbol for TICKER
  group_title TEXT NOT NULL,
  impact_level TEXT NOT NULL CHECK(impact_level IN ('Very Low', 'Low', 'Moderate', 'High')),
  confidence_level TEXT NOT NULL CHECK(confidence_level IN ('Low', 'Medium', 'High')),
  model_version TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  date_bucket TEXT NOT NULL,           -- YYYY-MM-DD for daily grouping
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX unique_story_group ON story_groups(scope, primary_ticker, date_bucket, group_title);
CREATE INDEX idx_story_groups_scope_date ON story_groups(scope, date_bucket);
CREATE INDEX idx_story_groups_scope_ticker_date ON story_groups(scope, primary_ticker, date_bucket);
CREATE INDEX idx_story_groups_primary_ticker ON story_groups(primary_ticker);
```

### story_group_explanations

Structured explanation text (one per story_group).

```sql
CREATE TABLE story_group_explanations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_group_id INTEGER NOT NULL UNIQUE,
  what_happened TEXT NOT NULL,
  why_it_matters_now TEXT NOT NULL,
  who_this_applies_to TEXT NOT NULL,
  what_to_watch_next TEXT NOT NULL,
  what_this_does_not_mean TEXT NOT NULL,
  sources_summary TEXT NOT NULL,       -- JSON array of outlet names
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_group_id) REFERENCES story_groups(id) ON DELETE CASCADE
);
```

### story_group_articles

Many-to-many join table linking articles to story groups (supports clustering).

```sql
CREATE TABLE story_group_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_group_id INTEGER NOT NULL,
  article_id TEXT NOT NULL,            -- References articles(url)
  similarity_score REAL,               -- 0.0-1.0, clustering confidence
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_group_id) REFERENCES story_groups(id) ON DELETE CASCADE,
  UNIQUE KEY unique_story_group_article (story_group_id, article_id)
);
```

### story_group_related_tickers

Optional: Related tickers for a story (e.g., AAPL story may affect MSFT).

```sql
CREATE TABLE story_group_related_tickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_group_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  relationship_type TEXT DEFAULT 'related' CHECK(relationship_type IN ('affected', 'related', 'competitor')),
  FOREIGN KEY (story_group_id) REFERENCES story_groups(id) ON DELETE CASCADE,
  UNIQUE KEY unique_story_group_ticker (story_group_id, ticker)
);
```

### article_decision_log

Observability: Pipeline stage decisions with LLM reasoning (not per-user).

```sql
CREATE TABLE article_decision_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id TEXT NOT NULL,            -- References articles(url)
  stage_name TEXT NOT NULL,            -- "clustering", "llm_filtering", "impact_scoring", etc.
  accepted INTEGER NOT NULL,           -- 1 (yes) or 0 (no)
  reason_llm TEXT,                     -- Short LLM explanation
  rank_score REAL,                     -- 0.0-1.0
  impact_score REAL,                   -- 0.0-1.0
  quality_score REAL,                  -- 0.0-1.0
  scope TEXT CHECK(scope IN ('GLOBAL', 'TICKER', NULL)),
  primary_ticker TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(url)
);

CREATE INDEX idx_article_decision_log_article_stage ON article_decision_log(article_id, stage_name);
CREATE INDEX idx_article_decision_log_stage_created ON article_decision_log(stage_name, created_at);
CREATE INDEX idx_article_decision_log_decision_scope ON article_decision_log(scope, primary_ticker, created_at);
```

---

## Story Group Creation

### Backend Storage Module

The `storyGroupStorage.js` module provides core functions:

```javascript
const {
  createStoryGroup,
  createStoryGroupExplanation,
  addArticleToStoryGroup,
  addRelatedTickerToStoryGroup,
  logArticleDecision,
  getStoryGroupById,
  getGlobalStoryGroups,
  getTickerStoryGroups,
  getArticleDecisionLog,
  clusterArticlesBySimilarity
} = require('../data/storyGroupStorage');
```

### Example: Create a Story Group

```javascript
const storyGroupStorage = require('../backend/data/storyGroupStorage');

// 1. Create the story group
const groupId = storyGroupStorage.createStoryGroup(
  'GLOBAL',                    // scope
  null,                         // primary_ticker
  'Fed maintains rates',       // group_title
  'Moderate',                  // impact_level
  'High',                      // confidence_level
  'v1.2',                      // model_version
  'v2.1'                       // pipeline_version
);

// 2. Add explanation
storyGroupStorage.createStoryGroupExplanation(
  groupId,
  'Federal Reserve held the benchmark rate at 4.0–4.25%...',  // what_happened
  'With inflation cooling but still above target...',         // why_it_matters_now
  'All investors and savers. Affects yields...',              // who_this_applies_to
  'Watch CPI print Thursday 10 AM ET...',                     // what_to_watch_next
  'Does not indicate imminent rate cuts...',                  // what_this_does_not_mean
  ['Reuters', 'Bloomberg', 'Federal Reserve']                 // sources_summary
);

// 3. Add articles
storyGroupStorage.addArticleToStoryGroup(groupId, 'https://example.com/article1', 0.98);
storyGroupStorage.addArticleToStoryGroup(groupId, 'https://example.com/article2', 0.95);

// 4. Log decision (for monitoring)
storyGroupStorage.logArticleDecision(
  'https://example.com/article1',
  'clustering',
  true,
  'High similarity to Fed decision story',
  0.95,  // rank_score
  0.88,  // impact_score
  0.96,  // quality_score
  'GLOBAL'
);
```

---

## Clustering Strategy

### Jaccard Similarity

The API uses **Jaccard similarity** on article keywords to cluster similar articles:

```
similarity = |set_intersection| / |set_union|

Threshold: similarity > 0.85 → same cluster
```

### Example

- Article A: "Fed holds rates at 4% amid inflation concerns"
- Article B: "Federal Reserve maintains benchmark rate unchanged"
- Common keywords (after stopword removal): {federal, reserve, rate, holds, inflation}
- Similarity ≈ 0.92 → clustered together ✓

### Richer Clustering (Optional)

For production, integrate a lightweight embedding model:

```javascript
// Example: OpenAI text-embedding-3-small
const embedding = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: article.title + " " + article.description
});

// Cosine similarity > 0.85 → same cluster
```

---

## Caching Strategy

### Redis TTL

| Cache Key | TTL | Invalidation |
|-----------|-----|--------------|
| `story_groups:{date}:GLOBAL` | 60 min | Manual on new GLOBAL group |
| `story_groups:{date}:TICKER:{ticker}` | 60 min | Manual on new TICKER group |
| `feed:{user_id}:{date}` | 30 min | User holdings change, new group |
| `explanation:{story_group_id}` | 12 hours | Manual update |

### Client-Side Caching (iOS)

iOS app should cache the response for 30 minutes:

```swift
// Pseudo-code
let response = APIManager.get("/v1/feed/story-groups")
UserDefaults.standard.set(response, forKey: "story_groups_\(date)")
UserDefaults.standard.set(Date(), forKey: "story_groups_\(date)_cached_at")

// Check cache before making request
if let cached = UserDefaults.standard.data(forKey: "story_groups_\(date)") {
  if Date().timeIntervalSince(cachedAt) < 30 * 60 {
    return cached
  }
}
```

---

## Testing

### Populate Example Data

```bash
node backend/scripts/populateStoryGroups.js
```

Creates:
- 2 GLOBAL story groups (Fed, Oil)
- 2 TICKER story groups (AAPL, NVDA)
- 8 linked articles
- Decision logs for monitoring

### Test API Endpoint

```bash
# Test user feed composition
curl -H "x-user-id: 1" \
  "http://localhost:5002/v1/feed/story-groups"

# Verify decision logs
curl -H "x-internal-key: YOUR_KEY" \
  "http://localhost:5002/internal/decision-logs?stage=clustering"
```

---

## Integration with Existing Pipeline

### Decision Logging in Stages

Each pipeline stage can log decisions:

```javascript
// In stage3_contentClassification.js or any stage:
const { logArticleDecision } = require('../data/storyGroupStorage');

logArticleDecision(
  article.url,
  'impact_scoring',          // stage_name
  impactScore >= threshold,  // accepted
  `Impact score ${impactScore}; ${impactScore >= threshold ? 'accepted' : 'below threshold'}`,
  rankScore,
  impactScore,
  qualityScore,
  scope,                     // 'GLOBAL', 'TICKER', or null
  ticker                     // if scope is 'TICKER'
);
```

### Creating Story Groups from Clusters

After stage 5 ranking/clustering:

```javascript
// In stage5_rankingClustering.js or batch job:
const { createStoryGroup, createStoryGroupExplanation, addArticleToStoryGroup } = require('../data/storyGroupStorage');

for (const cluster of clusters) {
  // Determine if GLOBAL or TICKER scope based on articles
  const scope = cluster.tickers.length > 0 ? 'TICKER' : 'GLOBAL';
  const primaryTicker = cluster.tickers[0] || null;

  const groupId = createStoryGroup(
    scope,
    primaryTicker,
    generateGroupTitle(cluster),  // AI-generated
    computeImpactLevel(cluster),   // from article scores
    'High',                        // confidence
    'v1.2',
    'v2.1'
  );

  createStoryGroupExplanation(
    groupId,
    generateWhatHappened(cluster),       // LLM
    generateWhyItMatters(cluster),       // LLM
    generateWhoThisAppliesto(scope, primaryTicker),
    generateWhatToWatchNext(cluster),    // LLM
    generateWhatThisDoesNotMean(cluster),// LLM
    extractSources(cluster.articles)
  );

  for (const article of cluster.articles) {
    addArticleToStoryGroup(groupId, article.url, article.similarity_score);
  }
}
```

---

## Tone & Safety Constraints

### Automatic Enforcement

```javascript
// Regex filters
const hasBuySell = /\b(buy|sell|hold|outperform|underperform|rating)\b/i.test(text);
const hasPrediction = /\b(will|expect|likely|should rise|gain|forecast)\b/i.test(text);

// LLM veto
if (hasBuySell || hasPrediction) {
  return reject("Tone constraint violated");
}
```

### Guidelines for Explanation Fields

- ✓ "AAPL continues to balance competitive pressure with premium positioning"
- ✗ "AAPL is a strong buy due to margin expansion"
- ✓ "Watch iPhone 18 cycle (launch signals, pre-order strength)"
- ✗ "iPhone 18 will likely drive 20% revenue growth"
- ✓ "Does not guarantee future beats"
- ✗ "Almost certainly beat again next quarter"

---

## Deployment

### Environment Variables

```bash
# .env
INTERNAL_API_KEY=your-secure-api-key-here

# Optional (for OpenAI embeddings)
OPENAI_API_KEY=sk-...
```

### Database Migrations

New tables are created automatically on server startup via `backend/data/db.js`.

### Monitoring

Monitor decision logs regularly:

```bash
curl -H "x-internal-key: $INTERNAL_API_KEY" \
  "http://localhost:5002/internal/decision-logs?stage=clustering&limit=50" \
  | jq '.logs | map(select(.accepted == 0))' # Failed decisions
```

---

## Future Enhancements

1. **LLM-Generated Titles**: Use GPT-4 to generate group_title from articles
2. **Richer Embeddings**: Integrate OpenAI text-embedding-3-small for cosine similarity
3. **User Feedback Loop**: Track which explanations users find helpful
4. **Multi-Language**: Generate explanations in multiple languages
5. **Real-Time Updates**: WebSocket subscription to new story groups
6. **Historical Trending**: Track how story groups and sentiment evolve over days/weeks
