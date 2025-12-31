# Background Jobs

This folder contains **things that run automatically** - like a robot assistant that works 24/7.

## What This Is

Background jobs are tasks that happen without anyone clicking a button. They keep the system running smoothly by:
- Fetching new news articles
- Processing articles to understand them
- Ranking articles by importance

## What's In Here

- **`scheduler.js`** - The coordinator that runs jobs on a schedule
  - Every 20 minutes: Fetch new articles
  - Every 2 minutes: Process pending articles
  - Every 10 minutes: Rank articles

- **`ingestJob.js`** - Fetches news from external APIs
  - Looks for news about user's stock holdings
  - Saves articles to the database

- **`processJob.js`** - Runs articles through the interpretation pipeline
  - Determines what articles are relevant
  - Understands what each article means

- **`rankJob.js`** - Ranks and clusters articles
  - Decides which articles are most important
  - Groups similar articles together

## How It Works

1. Scheduler starts when the server starts
2. Jobs run on their schedules automatically
3. Each job does its work and logs what happened
4. If a job fails, it logs an error and tries again next time

## Disabling Automation

Set `DISABLE_SCHEDULER=true` in your `.env` file if you want to run jobs manually instead.

## Why This Exists

Without background jobs, you'd have to manually:
- Click "fetch news" every 20 minutes
- Click "process" every 2 minutes
- Click "rank" every 10 minutes

Background jobs do this automatically so the app always has fresh, processed news ready.









