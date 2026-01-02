# News Aggregator iOS API Documentation

**Base URL:** `http://localhost:5001` (Development) | `https://your-production-domain.com` (Production)

**Version:** 1.0
**Last Updated:** January 2, 2026

---

## Table of Contents

1. [Authentication](#authentication)
2. [API Endpoints](#api-endpoints)
3. [Data Models](#data-models)
4. [Rate Limiting](#rate-limiting)
5. [Error Handling](#error-handling)
6. [Example Implementations](#example-implementations)

---

## Authentication

### User ID Extraction
All `/v1` endpoints require a valid `user_id` to be passed. The system extracts this from the request header:

```
X-User-ID: <user_id>
```

Or as a query parameter:
```
/v1/feed?limit=20&user_id=1
```

**Default User ID (Development):** `1`

### Rate Limiting
- **Limit:** 100 requests per minute per user
- **Window:** 60 seconds
- **Response:** HTTP 429 when exceeded

---

## API Endpoints

### 1. GET `/v1/feed`
Returns ranked/interpreted signals for the user's general feed.

**Parameters:**
- `limit` (optional, int): Number of articles to return (default: 20)
- `cursor` (optional, string): Pagination cursor (not implemented in MVP)
- `user_id` (optional, string): User ID (if not in header)

**Response:**
```json
{
  "items": [
    {
      "id": "https://example.com/article",
      "url": "https://example.com/article",
      "title": "Article Title",
      "source": "News Source",
      "published_at": "2026-01-02T10:00:00Z",
      "verdict": "aware",
      "why": [
        "Relevant to market",
        "Strong signal"
      ],
      "action": "Understand the context",
      "horizon": null,
      "opportunity_type": "none",
      "opportunity_note": "",
      "confidence": 75,
      "importance_score": 75
    }
  ],
  "next_cursor": null
}
```

**Example iOS Implementation (Swift):**
```swift
import Foundation

class NewsAPIClient {
    let baseURL = "http://localhost:5001"
    var userId: String = "1"

    func fetchFeed(limit: Int = 20) async throws -> FeedResponse {
        var request = URLRequest(url: URL(string: "\(baseURL)/v1/feed?limit=\(limit)")!)
        request.setValue(userId, forHTTPHeaderField: "X-User-ID")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }

        return try JSONDecoder().decode(FeedResponse.self, from: data)
    }
}

struct FeedResponse: Codable {
    let items: [Signal]
    let next_cursor: String?
}

struct Signal: Codable {
    let id: String
    let url: String
    let title: String
    let source: String
    let published_at: String
    let verdict: String
    let why: [String]
    let action: String
    let horizon: String?
    let opportunity_type: String
    let opportunity_note: String
    let confidence: Int
    let importance_score: Int
}
```

---

### 2. GET `/v1/personalized-feed`
Returns personalized feed with **Wealthy Rabbit explanations** based on user's holdings.

**Features:**
- Fetches user's stock holdings
- Searches for news about user's holdings (70% of feed)
- Gets general ranked news for macro context (30% of feed)
- Generates AI-powered personalized explanations
- Deduplicates articles automatically

**Parameters:**
- `limit` (optional, int): Number of articles to return (default: 50)
- `user_id` (optional, string): User ID (if not in header)

**Response:**
```json
{
  "items": [
    {
      "id": "https://example.com/article",
      "title": "Article Title",
      "shortSummary": "Brief 1-2 line summary",
      "tickerSummary": "AAPL, MSFT",
      "impactLevel": "high",
      "scopeType": "company",
      "opportunitySignal": "positive",
      "relevanceType": "earnings",
      "profileTier": "high",
      "rawArticles": [
        {
          "articleNumber": 1,
          "source": "Bloomberg",
          "title": "Full article title",
          "description": "Article description",
          "body": "Article body text",
          "url": "https://example.com/article"
        }
      ],
      "explanation": {
        "headline": "Why This Matters to You",
        "impact": "Positive impact on your AAPL holding",
        "action": "Monitor quarterly results",
        "context": "Broader market implications...",
        "confidence": 0.95
      }
    }
  ],
  "next_cursor": null
}
```

**Example iOS Implementation (Swift):**
```swift
func fetchPersonalizedFeed(limit: Int = 50) async throws -> PersonalizedFeedResponse {
    var request = URLRequest(url: URL(string: "\(baseURL)/v1/personalized-feed?limit=\(limit)")!)
    request.setValue(userId, forHTTPHeaderField: "X-User-ID")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    return try JSONDecoder().decode(PersonalizedFeedResponse.self, from: data)
}

struct PersonalizedFeedResponse: Codable {
    let items: [PersonalizedSignal]
    let next_cursor: String?
}

struct PersonalizedSignal: Codable {
    let id: String
    let title: String
    let shortSummary: String
    let tickerSummary: String
    let impactLevel: String
    let scopeType: String
    let opportunitySignal: String
    let relevanceType: String
    let profileTier: String
    let rawArticles: [RawArticle]
    let explanation: Explanation?

    struct RawArticle: Codable {
        let articleNumber: Int
        let source: String
        let title: String
        let description: String
        let body: String
        let url: String
    }

    struct Explanation: Codable {
        let headline: String
        let impact: String
        let action: String
        let context: String
        let confidence: Double
    }
}
```

---

### 3. GET `/v1/feed/story-groups`
Returns clustered story groups combining **global** and **user-specific ticker** news.

**Features:**
- Fetches GLOBAL story groups (same for all users)
- Fetches TICKER-specific story groups (based on user's holdings)
- Merges and deduplicates by topic
- Sorts by impact level

**Parameters:**
- `date` (optional, string): Filter by date (YYYY-MM-DD, default: today)
- `limit_global` (optional, int): Max global groups to fetch (default: 5)
- `limit_per_ticker` (optional, int): Max groups per ticker (default: 3)
- `user_id` (optional, string): User ID (if not in header)

**Response:**
```json
{
  "date": "2026-01-02",
  "user_id": "1",
  "user_holdings": ["AAPL", "MSFT", "NVDA"],
  "generated_at": "2026-01-02T15:30:00Z",

  "global": [
    {
      "id": 1,
      "group_title": "Fed Rate Decision Expected",
      "impact_level": "High",
      "scope": "GLOBAL",
      "primary_ticker": null,
      "article_count": 12,
      "created_at": "2026-01-02T10:00:00Z"
    }
  ],

  "by_ticker": {
    "AAPL": [
      {
        "id": 2,
        "group_title": "Apple Q1 Earnings Preview",
        "impact_level": "High",
        "scope": "TICKER",
        "primary_ticker": "AAPL",
        "article_count": 8,
        "created_at": "2026-01-02T11:00:00Z"
      }
    ],
    "MSFT": [],
    "NVDA": []
  },

  "merged_feed": [
    {
      "id": 1,
      "group_title": "Fed Rate Decision Expected",
      "impact_level": "High",
      "rank_reason": "Global impact"
    },
    {
      "id": 2,
      "group_title": "Apple Q1 Earnings Preview",
      "impact_level": "High",
      "rank_reason": "User holds AAPL"
    }
  ],

  "metadata": {
    "total_groups": 15,
    "total_articles_clustered": 156,
    "dedup_removed": 3,
    "cache_ttl_seconds": 3600
  }
}
```

**Example iOS Implementation (Swift):**
```swift
func fetchStoryGroups(date: String? = nil, limitGlobal: Int = 5, limitPerTicker: Int = 3) async throws -> StoryGroupsResponse {
    var components = URLComponents(string: "\(baseURL)/v1/feed/story-groups")!
    components.queryItems = [
        URLQueryItem(name: "limit_global", value: "\(limitGlobal)"),
        URLQueryItem(name: "limit_per_ticker", value: "\(limitPerTicker)")
    ]
    if let date = date {
        components.queryItems?.append(URLQueryItem(name: "date", value: date))
    }

    var request = URLRequest(url: components.url!)
    request.setValue(userId, forHTTPHeaderField: "X-User-ID")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    return try JSONDecoder().decode(StoryGroupsResponse.self, from: data)
}
```

---

### 4. POST `/v1/interpret`
Interprets user-provided text or URL and returns a signal classification.

**Use Case:** User pastes text or URL → API analyzes and returns whether it's relevant to financial interests.

**Parameters:**
- `textOrUrl` (required, string): Text content or URL to interpret

**Request:**
```json
{
  "textOrUrl": "Apple announces new product line with innovative features"
}
```

**Response:**
```json
{
  "id": "text://1234567890",
  "url": "text://1234567890",
  "title": "Apple announces new product line with innovative features",
  "source": "User Input",
  "published_at": "2026-01-02T15:30:00Z",
  "verdict": "aware",
  "why": [
    "Content contains financial terminology",
    "Product announcement"
  ],
  "action": "Understand the context",
  "horizon": null,
  "opportunity_type": "none",
  "opportunity_note": "",
  "confidence": 65,
  "importance_score": 65
}
```

**Example iOS Implementation (Swift):**
```swift
func interpretContent(_ content: String) async throws -> Signal {
    var request = URLRequest(url: URL(string: "\(baseURL)/v1/interpret")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(userId, forHTTPHeaderField: "X-User-ID")
    request.httpBody = try JSONEncoder().encode(["textOrUrl": content])

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    return try JSONDecoder().decode(Signal.self, from: data)
}
```

---

### 5. PUT `/v1/preferences`
Updates user preferences including focus profile and stock holdings.

**Parameters:**
- `focus_profile` (optional, string): One of `"focused"`, `"balanced"`, `"broad"` (default: "balanced")
- `holdings` (optional, array): List of stock tickers or holding objects

**Request:**
```json
{
  "focus_profile": "focused",
  "holdings": [
    "AAPL",
    "MSFT",
    "NVDA",
    {
      "ticker": "TSLA",
      "label": "Tesla - Growth",
      "notes": "Tech/EV exposure"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "focus_profile": "focused",
  "holdings_count": 4
}
```

**Example iOS Implementation (Swift):**
```swift
struct Holding: Codable {
    let ticker: String
    let label: String?
    let notes: String?
}

func updatePreferences(focusProfile: String = "balanced", holdings: [String]? = nil) async throws -> PreferencesResponse {
    var body: [String: Any] = ["focus_profile": focusProfile]
    if let holdings = holdings {
        body["holdings"] = holdings
    }

    var request = URLRequest(url: URL(string: "\(baseURL)/v1/preferences")!)
    request.httpMethod = "PUT"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(userId, forHTTPHeaderField: "X-User-ID")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    return try JSONDecoder().decode(PreferencesResponse.self, from: data)
}

struct PreferencesResponse: Codable {
    let success: Bool
    let focus_profile: String
    let holdings_count: Int
}
```

---

### 6. GET `/v1/brief/latest`
Gets the latest daily brief (stub endpoint, not fully implemented in MVP).

**Response:**
```json
{
  "items": [],
  "generated_at": null
}
```

---

## Data Models

### Signal
Core data model representing a news article/event signal.

```swift
struct Signal: Codable {
    let id: String                    // Unique identifier (usually URL)
    let url: String                   // Link to original article
    let title: String                 // Article title
    let source: String                // Source name (e.g., "Bloomberg")
    let published_at: String          // ISO8601 timestamp
    let verdict: String               // "aware" or "ignore"
    let why: [String]                 // 3 reasons why user should care
    let action: String                // Recommended action
    let horizon: String?              // Time horizon ("short", "medium", "long")
    let opportunity_type: String      // "none", "positive", "negative"
    let opportunity_note: String      // Details about opportunity
    let confidence: Int               // 0-100 confidence score
    let importance_score: Int         // 0-100 importance score
}
```

### PersonalizedSignal
Extended signal with Wealthy Rabbit AI explanations.

```swift
struct PersonalizedSignal: Codable {
    let id: String
    let title: String
    let shortSummary: String          // 1-2 line summary
    let tickerSummary: String         // Relevant tickers
    let impactLevel: String           // "high", "medium", "low"
    let scopeType: String             // "company", "industry", "macro"
    let opportunitySignal: String     // "positive", "negative", "neutral"
    let relevanceType: String         // "earnings", "general", "product", etc.
    let profileTier: String           // "high", "medium", "low"
    let rawArticles: [RawArticle]
    let explanation: Explanation?

    struct Explanation: Codable {
        let headline: String          // Why this matters to you
        let impact: String            // How it impacts holdings
        let action: String            // What to do
        let context: String           // Broader context
        let confidence: Double        // 0.0-1.0
    }
}
```

### StoryGroup
Clustered group of related articles.

```swift
struct StoryGroup: Codable {
    let id: Int
    let group_title: String
    let impact_level: String          // "High", "Moderate", "Low", "Very Low"
    let scope: String                 // "GLOBAL" or "TICKER"
    let primary_ticker: String?       // Ticker if scope is TICKER
    let article_count: Int            // Number of articles in group
    let created_at: String            // ISO8601 timestamp
}
```

---

## Rate Limiting

All endpoints respect rate limiting:
- **100 requests per minute per user**
- **Window resets every 60 seconds**

**Rate Limit Headers:**
- `X-RateLimit-Limit: 100`
- `X-RateLimit-Remaining: 99`
- `X-RateLimit-Reset: 1609502400`

**When Rate Limited (429):**
```json
{
  "error": "Rate limit exceeded"
}
```

**Best Practice:** Implement exponential backoff with jitter when receiving 429 responses.

---

## Error Handling

### Standard Error Response
```json
{
  "error": "Error message",
  "details": "Additional context (if available)"
}
```

### HTTP Status Codes

| Code | Meaning | Cause |
|------|---------|-------|
| 200 | OK | Request successful |
| 400 | Bad Request | Missing or invalid parameters |
| 403 | Forbidden | Insufficient permissions or invalid API key |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |

### Common Errors

**Missing User ID:**
```json
{
  "error": "User ID is required"
}
```

**Invalid Ticker Format:**
```json
{
  "error": "Invalid ticker format. Use 1-5 letters/numbers (e.g., AAPL, NVDA)"
}
```

**Rate Limited:**
```json
{
  "error": "Rate limit exceeded"
}
```

---

## Example Implementations

### Complete Swift Implementation

```swift
import Foundation

enum APIError: Error {
    case invalidURL
    case invalidResponse
    case decodingError(String)
    case rateLimited
    case serverError(String)
}

class NewsAggregatorAPI {
    static let shared = NewsAggregatorAPI()

    private let baseURL = "http://localhost:5001"
    var userId: String = "1"

    // MARK: - Feed Endpoints

    /// Fetch general news feed
    func fetchFeed(limit: Int = 20) async throws -> [Signal] {
        let url = "\(baseURL)/v1/feed?limit=\(limit)"
        return try await makeRequest(url: url, method: "GET")
    }

    /// Fetch personalized feed with holdings and AI explanations
    func fetchPersonalizedFeed(limit: Int = 50) async throws -> [PersonalizedSignal] {
        let url = "\(baseURL)/v1/personalized-feed?limit=\(limit)"
        return try await makeRequest(url: url, method: "GET")
    }

    /// Fetch story groups (clustered news)
    func fetchStoryGroups(
        date: String? = nil,
        limitGlobal: Int = 5,
        limitPerTicker: Int = 3
    ) async throws -> StoryGroupsResponse {
        var components = URLComponents(string: "\(baseURL)/v1/feed/story-groups")!
        components.queryItems = [
            URLQueryItem(name: "limit_global", value: "\(limitGlobal)"),
            URLQueryItem(name: "limit_per_ticker", value: "\(limitPerTicker)")
        ]
        if let date = date {
            components.queryItems?.append(URLQueryItem(name: "date", value: date))
        }

        guard let url = components.url?.absoluteString else { throw APIError.invalidURL }
        return try await makeRequest(url: url, method: "GET")
    }

    // MARK: - Interpretation

    /// Interpret user-provided content
    func interpretContent(_ content: String) async throws -> Signal {
        let body = ["textOrUrl": content]
        return try await makeRequest(
            url: "\(baseURL)/v1/interpret",
            method: "POST",
            body: body
        )
    }

    // MARK: - Preferences

    /// Update user preferences and holdings
    func updatePreferences(
        focusProfile: String = "balanced",
        holdings: [String]? = nil
    ) async throws -> PreferencesResponse {
        var body: [String: Any] = ["focus_profile": focusProfile]
        if let holdings = holdings {
            body["holdings"] = holdings
        }

        return try await makeRequest(
            url: "\(baseURL)/v1/preferences",
            method: "PUT",
            body: body
        )
    }

    // MARK: - Private Methods

    private func makeRequest<T: Decodable>(
        url: String,
        method: String = "GET",
        body: Encodable? = nil
    ) async throws -> T {
        guard let url = URL(string: url) else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "X-User-ID")

        if let body = body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200...299:
            return try JSONDecoder().decode(T.self, from: data)
        case 429:
            throw APIError.rateLimited
        case 400...499:
            if let error = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw APIError.serverError(error.error)
            }
            throw APIError.serverError("Client error: \(httpResponse.statusCode)")
        case 500...:
            throw APIError.serverError("Server error: \(httpResponse.statusCode)")
        default:
            throw APIError.invalidResponse
        }
    }
}

// MARK: - Usage Example

@main
struct NewsAggregatorApp {
    static func main() async {
        let api = NewsAggregatorAPI.shared
        api.userId = "1"

        do {
            // Fetch personalized feed
            let feed = try await api.fetchPersonalizedFeed(limit: 10)
            print("Fetched \(feed.count) articles")

            // Update preferences
            let prefs = try await api.updatePreferences(
                focusProfile: "focused",
                holdings: ["AAPL", "MSFT", "NVDA"]
            )
            print("Updated preferences: \(prefs.focus_profile)")

        } catch APIError.rateLimited {
            print("Rate limit exceeded, wait before retrying")
        } catch let error as APIError {
            print("API Error: \(error)")
        } catch {
            print("Unexpected error: \(error)")
        }
    }
}

// MARK: - Supporting Types

struct ErrorResponse: Decodable {
    let error: String
    let details: String?
}

struct PreferencesResponse: Decodable {
    let success: Bool
    let focus_profile: String
    let holdings_count: Int
}

struct StoryGroupsResponse: Decodable {
    let date: String
    let user_id: String
    let user_holdings: [String]
    let global: [StoryGroup]
    let by_ticker: [String: [StoryGroup]]
    let merged_feed: [StoryGroup]
    let metadata: Metadata

    struct Metadata: Decodable {
        let total_groups: Int
        let total_articles_clustered: Int
        let dedup_removed: Int
        let cache_ttl_seconds: Int
    }
}

struct StoryGroup: Decodable {
    let id: Int
    let group_title: String
    let impact_level: String
    let scope: String
    let primary_ticker: String?
    let article_count: Int
    let created_at: String
}

struct Signal: Decodable {
    let id: String
    let url: String
    let title: String
    let source: String
    let published_at: String
    let verdict: String
    let why: [String]
    let action: String
    let horizon: String?
    let opportunity_type: String
    let opportunity_note: String
    let confidence: Int
    let importance_score: Int
}

struct PersonalizedSignal: Decodable {
    let id: String
    let title: String
    let shortSummary: String
    let tickerSummary: String
    let impactLevel: String
    let scopeType: String
    let opportunitySignal: String
    let relevanceType: String
    let profileTier: String
    let rawArticles: [RawArticle]
    let explanation: Explanation?

    struct RawArticle: Decodable {
        let articleNumber: Int
        let source: String
        let title: String
        let description: String
        let body: String
        let url: String
    }

    struct Explanation: Decodable {
        let headline: String
        let impact: String
        let action: String
        let context: String
        let confidence: Double
    }
}
```

---

## Integration Checklist

- [ ] Install URLSession (built into iOS SDK)
- [ ] Create `NewsAggregatorAPI` class (see example above)
- [ ] Set base URL to your backend server
- [ ] Implement error handling and retry logic
- [ ] Add rate limit backoff (exponential with jitter)
- [ ] Test each endpoint before deploying
- [ ] Handle network timeouts gracefully
- [ ] Cache responses when appropriate
- [ ] Log errors for debugging

---

## Support

For issues or questions:
1. Check error responses and HTTP status codes
2. Enable debug logging to see raw requests/responses
3. Review the example implementations
4. Test endpoints manually with curl or Postman

Example curl request:
```bash
curl -X GET "http://localhost:5001/v1/feed?limit=5" \
  -H "X-User-ID: 1"
```

---

**Last Updated:** January 2, 2026
**API Version:** 1.0
**Status:** Stable
