# API Endpoint Test Cases

## Endpoint: `GET /api/articles`

This endpoint allows external apps to query articles by ticker symbols.

### Base URL
- Development: `http://localhost:5001`
- Production: `https://your-production-url.com`

---

## Test Cases

### Test 1: Basic Query (NVDA and AAPL)
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA,AAPL&limit=10"
```

**Expected Response:**
- Status: 200
- Returns articles that match NVDA or AAPL in the `searched_by` field
- Maximum 10 articles
- Only processed articles (with scores) by default

---

### Test 2: Query with Minimum Score Filter
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA,AAPL&limit=10&minScore=40"
```

**Expected Response:**
- Status: 200
- Returns only articles with relevance score >= 40
- Articles ordered by score (highest first)

---

### Test 3: Query with Date Range
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA&limit=5&from=2025-01-01&to=2025-12-31"
```

**Expected Response:**
- Status: 200
- Returns articles published between the specified dates
- Date format: ISO 8601 (YYYY-MM-DD)

---

### Test 4: Query with Source Filter
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA&limit=5&sources=gnews"
```

**Expected Response:**
- Status: 200
- Returns only articles from GNews source
- Can specify multiple sources: `sources=gnews,newsapi,googlerss`

---

### Test 5: Include Unprocessed Articles
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA&limit=5&processedOnly=false"
```

**Expected Response:**
- Status: 200
- Returns all articles (processed and unprocessed)
- Still excludes discarded articles
- Ordered by publication date

---

### Test 6: Error Case - Missing Tickers Parameter
**Request:**
```bash
curl "http://localhost:5001/api/articles?limit=10"
```

**Expected Response:**
- Status: 400
- Error message: "Missing required parameter: tickers"

---

### Test 7: Single Ticker Query
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA&limit=5"
```

**Expected Response:**
- Status: 200
- Returns articles matching NVDA only
- Maximum 5 articles

---

### Test 8: Multiple Filters Combined
**Request:**
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA,AAPL&limit=10&minScore=30&sources=gnews,newsapi&processedOnly=true"
```

**Expected Response:**
- Status: 200
- Returns articles matching NVDA or AAPL
- Minimum score: 30
- Only from GNews or NewsAPI sources
- Only processed articles
- Maximum 10 articles

---

## Running the Tests

### Option 1: Using the Bash Script
```bash
chmod +x test-api-endpoint.sh
./test-api-endpoint.sh
```

**Note:** Requires `jq` to be installed for JSON formatting:
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

### Option 2: Using the Node.js Script
```bash
node test-api-endpoint.js
```

**Note:** Requires `axios` to be installed:
```bash
npm install axios
```

### Option 3: Manual Testing with curl
Copy any of the test cases above and run them in your terminal.

---

## Response Format

### Success Response (200)
```json
{
  "status": "ok",
  "query": {
    "tickers": ["NVDA", "AAPL"],
    "limit": 10,
    "minScore": 40,
    "from": null,
    "to": null,
    "sources": null,
    "processedOnly": true
  },
  "totalResults": 25,
  "articles": [
    {
      "id": "https://example.com/article",
      "title": "Article Title",
      "description": "Article description",
      "url": "https://example.com/article",
      "source": {
        "name": "Source Name",
        "id": "source-id"
      },
      "author": "Author Name",
      "publishedAt": "2025-12-03T10:00:00Z",
      "imageUrl": "https://example.com/image.jpg",
      "content": "Full article content...",
      "searchedBy": "NVDA",
      "feedSource": "gnews",
      "summary": "Article summary...",
      "whyItMatters": "Why this matters...",
      "relevanceScores": {
        "NVDA": 90,
        "AAPL": 20
      },
      "relevanceScore": 85.5,
      "finalRankScore": 88.2,
      "sentiment": {
        "score": 0.75,
        "label": "positive"
      },
      "impactScore": 8.5,
      "matchedTickers": ["NVDA", "TSMC"],
      "matchedSectors": ["Technology", "Semiconductors"],
      "status": "ranked"
    }
  ]
}
```

### Error Response (400)
```json
{
  "error": "Missing required parameter: tickers",
  "message": "Please provide ticker symbols as comma-separated values (e.g., ?tickers=NVDA,AAPL)"
}
```

---

## Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tickers` | string | Yes | - | Comma-separated ticker symbols (e.g., "NVDA,AAPL") |
| `limit` | integer | No | 50 | Maximum number of articles to return |
| `minScore` | float | No | - | Minimum relevance score (0-100) |
| `from` | string | No | - | Start date (ISO format: "2025-01-01") |
| `to` | string | No | - | End date (ISO format: "2025-12-31") |
| `sources` | string | No | - | Comma-separated sources (e.g., "gnews,newsapi") |
| `processedOnly` | boolean | No | true | Only return processed articles with scores |

---

## Example Usage in External Apps

### JavaScript/Node.js
```javascript
const axios = require('axios');

async function getArticles(tickers) {
  try {
    const response = await axios.get('http://localhost:5001/api/articles', {
      params: {
        tickers: tickers.join(','),
        limit: 20,
        minScore: 40,
        processedOnly: true
      }
    });
    return response.data.articles;
  } catch (error) {
    console.error('Error fetching articles:', error.message);
    return [];
  }
}

// Usage
const articles = await getArticles(['NVDA', 'AAPL']);
console.log(`Found ${articles.length} articles`);
```

### Python
```python
import requests

def get_articles(tickers, limit=20, min_score=40):
    url = "http://localhost:5001/api/articles"
    params = {
        "tickers": ",".join(tickers),
        "limit": limit,
        "minScore": min_score,
        "processedOnly": "true"
    }
    response = requests.get(url, params=params)
    if response.status_code == 200:
        return response.json()["articles"]
    else:
        print(f"Error: {response.status_code}")
        return []

# Usage
articles = get_articles(["NVDA", "AAPL"])
print(f"Found {len(articles)} articles")
```

### cURL
```bash
curl "http://localhost:5001/api/articles?tickers=NVDA,AAPL&limit=20&minScore=40"
```






