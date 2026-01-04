# Story Groups Quick Start Guide

## Overview

Story Groups is a calm, friendly explanation layer that groups related articles and provides structured context—no buy/sell language, no predictions, just facts and signals to watch.

---

## User API (iOS App)

### Get Story Groups for User

```bash
# All parameters optional
curl -H "x-user-id: 1" \
  "http://localhost:5002/v1/feed/story-groups?date=2026-01-02&limit_global=5&limit_per_ticker=3"
```

**Returns:**
- `global`: Story groups for everyone (Fed, oil prices, macro)
- `by_ticker`: Story groups for user's holdings (AAPL earnings, NVDA export controls, etc.)
- `merged_feed`: All groups sorted by impact (High → Moderate → Low → Very Low)

**Example Response Structure:**
```json
{
  "date": "2026-01-02",
  "global": [
    {
      "group_title": "Fed maintains rates...",
      "impact_level": "Moderate",
      "explanation": {
        "what_happened": "...",
        "why_it_matters_now": "...",
        "who_this_applies_to": "...",
        "what_to_watch_next": "...",
        "what_this_does_not_mean": "...",
        "sources_summary": ["Reuters", "Bloomberg"]
      },
      "articles": [{"article_id": "...", "similarity_score": 0.98}],
      "related_tickers": []
    }
  ],
  "by_ticker": {
    "AAPL": [...],
    "NVDA": [...]
  },
  "merged_feed": [...]
}
```

---

## Admin/Monitoring API

### View Decision Logs

```bash
# Set INTERNAL_API_KEY env var first
export INTERNAL_API_KEY="your-api-key"

# View all clustering decisions
curl -H "x-internal-key: $INTERNAL_API_KEY" \
  "http://localhost:5002/internal/decision-logs?stage=clustering"

# View logs for one article
curl -H "x-internal-key: $INTERNAL_API_KEY" \
  "http://localhost:5002/internal/decision-logs/https%3A%2F%2Fexample.com%2Farticle"

# View story groups summary
curl -H "x-internal-key: $INTERNAL_API_KEY" \
  "http://localhost:5002/internal/story-groups?scope=GLOBAL"
```

---

## Create Story Groups Programmatically

### 1. Populate Test Data

```bash
node backend/scripts/populateStoryGroups.js
```

Creates 4 example story groups + decision logs for testing.

### 2. Create Your Own Groups

```javascript
const storyGroupStorage = require('./backend/data/storyGroupStorage');

// 1. Create group
const groupId = storyGroupStorage.createStoryGroup(
  'GLOBAL',                        // or 'TICKER'
  null,                            // ticker symbol (null for GLOBAL)
  'Fed holds rates steady',        // group_title
  'Moderate',                      // Very Low | Low | Moderate | High
  'High',                          // Low | Medium | High
  'v1.2',                          // model_version
  'v2.1'                           // pipeline_version
);

// 2. Add explanation
storyGroupStorage.createStoryGroupExplanation(
  groupId,
  'Federal Reserve held rates at 4.0–4.25%...',
  'With inflation cooling, CPI data becomes critical...',
  'All investors and savers. Affects bond yields.',
  'Watch CPI print Thursday 10 AM ET',
  'Does not indicate imminent cuts or hikes',
  ['Reuters', 'Bloomberg', 'Federal Reserve']
);

// 3. Link articles
storyGroupStorage.addArticleToStoryGroup(groupId, 'https://example.com/fed-article1', 0.98);
storyGroupStorage.addArticleToStoryGroup(groupId, 'https://example.com/fed-article2', 0.95);

// 4. Log decision (for monitoring)
storyGroupStorage.logArticleDecision(
  'https://example.com/fed-article1',
  'clustering',
  true,
  'High similarity to Fed decision story',
  0.95,  // rank_score
  0.88,  // impact_score
  0.96   // quality_score
);
```

---

## Database Quick Reference

### See All Story Groups

```sql
SELECT id, scope, primary_ticker, group_title, impact_level, article_count
FROM story_groups;
```

### See Groups for a Specific Ticker

```sql
SELECT sg.*, COUNT(sga.article_id) as article_count
FROM story_groups sg
LEFT JOIN story_group_articles sga ON sg.id = sga.story_group_id
WHERE sg.scope = 'TICKER' AND sg.primary_ticker = 'AAPL'
GROUP BY sg.id;
```

### See Decision Logs (Rejections)

```sql
SELECT article_id, stage_name, reason_llm, impact_score, quality_score
FROM article_decision_log
WHERE accepted = 0
ORDER BY created_at DESC
LIMIT 10;
```

### See Article Clustering

```sql
SELECT sga.story_group_id, sg.group_title, COUNT(*) as article_count
FROM story_group_articles sga
JOIN story_groups sg ON sga.story_group_id = sg.id
GROUP BY sga.story_group_id
ORDER BY article_count DESC;
```

---

## Tone Constraints (What NOT to Do)

✗ **Bad:**
- "AAPL is a strong BUY" → Uses buy/sell language
- "NVDA will rise 20% due to AI boom" → Makes prediction
- "URGENT: Market crash incoming!" → Creates urgency/hype

✓ **Good:**
- "AAPL posted strong earnings; margins hold steady" → Facts only
- "Watch iPhone 18 cycle (launch signals, pre-order strength)" → Signals, no forecasts
- "Does not guarantee future beats. Macro risks persist." → Guardrails

---

## Integration Points

### Linking to Existing Pipeline

If you want to **auto-generate explanations** from article content:

```javascript
// After Stage 5 (ranking/clustering), call:
const { generateGroupTitle, generateExplanations } = require('./backend/services/explanationGenerator');

for (const cluster of clusters) {
  const groupTitle = await generateGroupTitle(cluster.articles);  // Use LLM
  const explanation = await generateExplanations(cluster);        // Use LLM

  const groupId = storyGroupStorage.createStoryGroup(
    scope, ticker, groupTitle, impactLevel, confidenceLevel, v1, v2
  );

  storyGroupStorage.createStoryGroupExplanation(
    groupId,
    explanation.whatHappened,
    explanation.whyItMatters,
    // ... etc
  );
}
```

### Logging Decisions from Pipeline

Add to each pipeline stage:

```javascript
// In stage3_contentClassification.js, stage4_personalization.js, etc:
const { logArticleDecision } = require('../data/storyGroupStorage');

if (!passedThreshold) {
  logArticleDecision(
    article.url,
    'stage3_classification',
    false,  // rejected
    `Impact score ${impactScore} below threshold of ${threshold}`,
    rankScore,
    impactScore,
    qualityScore,
    scope,
    ticker
  );
}
```

---

## Performance & Caching

### Database Indexes (Already Created)

```sql
-- Fast by scope and date
idx_story_groups_scope_date
idx_story_groups_scope_ticker_date

-- Fast article lookups
idx_story_group_articles_article_id

-- Decision log analysis
idx_article_decision_log_stage_created
idx_article_decision_log_decision_scope
```

### Recommended Redis Cache Keys

```
story_groups:{date}:GLOBAL         → 60 min TTL
story_groups:{date}:TICKER:{ticker} → 60 min TTL
feed:{user_id}:{date}              → 30 min TTL
```

### iOS App Caching

Recommend caching response for **30 minutes**:

```swift
let cacheKey = "story_groups_\(dateString)"
UserDefaults.standard.set(response, forKey: cacheKey)
```

---

## Troubleshooting

### API returns empty groups

**Check:**
1. Are there articles in the database? `SELECT COUNT(*) FROM articles`
2. Is the date correct? Use `date_bucket LIKE '2026-01-02'`
3. Does the user have holdings? `SELECT * FROM holdings WHERE user_id = 1`

### Decision logs not appearing

**Check:**
1. Is `INTERNAL_API_KEY` environment variable set?
2. Is the header correct? `-H "x-internal-key: $INTERNAL_API_KEY"`
3. Run: `sqlite3 wealthy_rabbit.db "SELECT COUNT(*) FROM article_decision_log"`

### Articles not clustering together

**Check:**
1. Are titles/descriptions similar? Inspect: `extractKeywords(title, description)`
2. Is similarity score > 0.85? Lower threshold: `clusterArticlesBySimilarity(articles, 0.80)`
3. Add more articles: `addArticleToStoryGroup(groupId, articleUrl, 0.92)`

---

## Files You Need to Know

### Core Files

| File | Purpose |
|------|---------|
| `backend/data/db.js` | Database schema + table creation |
| `backend/data/storyGroupStorage.js` | Core CRUD operations |
| `backend/product/routes.js` | User API endpoint `/v1/feed/story-groups` |
| `backend/admin/routes.js` | Admin endpoints `/internal/decision-logs`, etc. |

### Documentation

| File | Purpose |
|------|---------|
| `STORY_GROUPS_API.md` | Full API documentation |
| `STORY_GROUPS_IMPLEMENTATION_SUMMARY.md` | Implementation details + architecture |
| `STORY_GROUPS_QUICK_START.md` | This file |

### Testing

| File | Purpose |
|------|---------|
| `backend/scripts/populateStoryGroups.js` | Create test data |

---

## Next Steps

### For iOS Integration

1. **Fetch story groups:** Call `GET /v1/feed/story-groups?date=...`
2. **Parse response:** Extract `global`, `by_ticker`, and `merged_feed`
3. **Display groups:** Show title + explanation fields
4. **Link articles:** Show clustered articles under each group
5. **Cache response:** Store for 30 minutes to reduce API calls

### For Backend Enhancement

1. **Generate titles:** Use LLM to auto-generate `group_title` from articles
2. **Generate explanations:** Use LLM to auto-generate explanation fields
3. **Log decisions:** Integrate decision logging into existing pipeline stages
4. **Monitor:** Set up alerts for failed decisions (accepted = 0)

### For Analytics

1. **Track coverage:** Which stories appear? How many articles per story?
2. **Track user engagement:** Do users read explanation fields?
3. **Track feedback:** Which explanations are helpful vs. confusing?

---

## Support

- **API Issues?** Check `STORY_GROUPS_API.md` for detailed response schemas
- **Integration Questions?** See `STORY_GROUPS_IMPLEMENTATION_SUMMARY.md`
- **Test Data?** Run `node backend/scripts/populateStoryGroups.js`
- **Decision Logs?** Query `/internal/decision-logs` with proper auth key

---

**You're ready to go! 🚀**

Start with:
```bash
curl -H "x-user-id: 1" "http://localhost:5002/v1/feed/story-groups"
```

Expected: ~3-4 story groups with all explanation fields populated.
