# Backend Overview

This is the backend server for the news aggregator app. It's organized to be easy to understand, even if you're not a technical person.

## What This Backend Does

The backend does three main things:
1. **Serves the iOS app** - Provides clean, safe data to the mobile app
2. **Runs automatically** - Fetches news, interprets it, and ranks it in the background
3. **Makes decisions** - Uses AI to understand what news matters and why

## Folder Structure

- **`product/`** - What the iOS app uses (the public API)
- **`background/`** - Jobs that run automatically (fetching, processing)
- **`decisions/`** - The "brain" that decides what matters
- **`pipeline/`** - Internal machinery (technical processing stages)
- **`admin/`** - Debug tools and control panel
- **`data/`** - Database and storage
- **`integrations/`** - External services (news APIs, AI)
- **`core/`** - Shared utilities (middleware, auth)

## How Data Flows

1. **Background jobs** fetch news articles from external sources
2. **Pipeline** processes articles through 5 stages to understand them
3. **Decisions** determine what matters and why
4. **Product API** serves clean, safe signals to the iOS app
5. **Admin tools** let you debug and control the system

## Starting the Server

```bash
npm start
```

The server will:
- Start on port 5001 (or PORT from environment)
- Initialize the database
- Start background jobs (unless DISABLE_SCHEDULER=true)

## Environment Variables

See `.env.example` for required keys:
- `NEWS_API_KEY` - For fetching news
- `OPENAI_API_KEY` - For AI interpretation
- `INTERNAL_API_KEY` - For admin endpoints
- `DISABLE_SCHEDULER` - Set to "true" to disable automation

