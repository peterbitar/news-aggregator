# Data Storage

This folder contains **where and how data is stored**. Think of it as the filing cabinet.

## What This Is

Data storage handles:
- Saving articles to the database
- Retrieving articles for the feed
- Managing user preferences
- Storing interpreted signals

## What's In Here

- **`db.js`** - Database setup and initialization
  - Creates tables
  - Sets up indexes
  - Handles schema changes

- **`articleStorage.js`** - Functions for saving and retrieving articles
  - `saveArticles()` - Save new articles
  - `getRankedForFeed()` - Get articles for the feed
  - `getCachedArticlesForHoldings()` - Get articles for specific stocks

## Database

We use SQLite - a simple file-based database. The database file is `wealthy_rabbit.db` in the backend folder.

## What's Stored

- **Articles** - News articles with all their metadata
- **Holdings** - User's stock tickers
- **Signals** - Interpreted articles (verdict, action, why, etc.)
- **Processing status** - Which stage each article is at

## Why This Exists

Every app needs to store data. This folder:
- Keeps all storage logic in one place
- Makes it easy to change storage later
- Provides clean functions for reading/writing data

## Important

**Don't access the database directly from other folders.**

Use the functions in `articleStorage.js` instead. This keeps the code clean and makes it easier to change storage later.



