# Integrations

This folder contains **connections to external services** - like APIs and AI services.

## What This Is

Integrations handle talking to services outside our app:
- News APIs (NewsAPI, GNews, Google RSS)
- AI services (OpenAI for interpretation)

## What's In Here

- **`newsProviders.js`** - Fetches news from multiple sources
  - NewsAPI.org
  - GNews.io
  - Google News RSS
  - Merges results and removes duplicates

- **`llmService.js`** - Talks to OpenAI for AI interpretation
  - Sends articles to AI for analysis
  - Handles batching to save costs
  - Manages rate limiting

## Costs

**Be aware of API costs:**
- News APIs: Usually free tier with limits
- OpenAI: Costs per request (batching reduces costs)

## Why This Exists

External services provide:
- **News APIs** - Fresh news articles we can't generate ourselves
- **AI Services** - Intelligence to understand news

This folder keeps all external service code in one place, making it easy to:
- Switch providers
- Monitor costs
- Handle errors
- Add new services

## Important

**Always check API keys are set** in `.env`:
- `NEWS_API_KEY`
- `GNEWS_API_KEY`
- `OPENAI_API_KEY`

Without these, the integrations won't work.









