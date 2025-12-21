# Product API

This folder contains **what the iOS app uses**. Think of it as the "public face" of the backend.

## What This Is

The Product API is the only thing the iOS app should talk to. It returns clean, safe data in a format called "Signal" - which is our way of saying "interpreted news item."

## What's In Here

- **`routes.js`** - The API endpoints the iOS app calls
  - `/v1/feed` - Get personalized news feed
  - `/v1/interpret` - Interpret a piece of text
  - `/v1/preferences` - Update user settings
  - `/v1/brief/latest` - Get daily brief (coming soon)

- **`signalMapper.js`** - Converts internal data into the Signal format the app expects

## Important Rules

- **Never returns raw data** - Everything is cleaned and interpreted
- **No advice language** - Guardrails prevent "buy/sell" recommendations
- **Rate limited** - 100 requests per minute per user
- **User-specific** - Each request includes a user ID

## Signal Format

Every response is a "Signal" - an interpreted news item that tells the user:
- **What happened** (title, source)
- **Why it matters** (why array)
- **What to do** (action - from a safe list)
- **How important** (importance_score, confidence)

## Safety

All signals go through guardrails that:
- Block advice words (buy, sell, etc.)
- Enforce safe action values
- Ensure verdicts are valid
- Clean up any problematic content



