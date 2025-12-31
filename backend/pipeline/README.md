# Pipeline

This folder contains the **internal machinery** that processes articles. Think of it as the factory floor.

## What This Is

The pipeline is a 5-stage process that takes raw news articles and turns them into interpreted signals. It's technical, but here's what each stage does:

## The 5 Stages

1. **Stage 1: Title Triage** - Quick check: Is this article worth reading?
2. **Stage 2: Content Fetch** - Download the full article text
3. **Stage 3: Content Classification** - Understand what the article is about
4. **Stage 4: Personalization** - Adjust for the user's holdings and preferences
5. **Stage 5: Ranking & Clustering** - Rank by importance and group similar articles

## What's In Here

- **`articlePipeline.js`** - The orchestrator that runs all 5 stages
- **`stage1_titleTriage.js`** - Quick filtering by title
- **`stage2_contentFetch.js`** - Downloads full article content
- **`stage3_contentClassification.js`** - AI analysis of content
- **`stage4_personalization.js`** - User-specific adjustments
- **`stage5_rankingClustering.js`** - Final ranking and grouping

## Important Note

**Product code should NOT import from pipeline directly.**

The pipeline is internal machinery. The Product API only consumes the final results (ranked articles in the database).

## Why This Exists

Processing articles is complex. The pipeline breaks it into stages so:
- Each stage can be tested independently
- Failures are isolated to one stage
- The process is easier to understand and debug

## How It Works

1. Background jobs or admin tools trigger the pipeline
2. Pipeline processes articles through all 5 stages
3. Final results are saved to the database
4. Product API reads the final results

Think of it like a factory: raw materials go in, finished products come out.









