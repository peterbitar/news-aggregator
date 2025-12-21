# Backend Overview (Product Founder Perspective)

## What This Backend Does

Think of this backend as a **smart news assistant** that turns raw financial news into personalized, safe insights for your iOS app. It runs continuously in the background, so users always see relevant, interpreted news without any manual work.

## The Problem It Solves

Your users face four big problems:
- **Too much news**: They can't read everything that's published
- **Irrelevant content**: Most news doesn't matter to them personally
- **No context**: Articles don't explain why something matters
- **Risk of advice**: You can't give financial advice legally

This backend solves all four.

## How It Works (User Journey)

1. **User adds holdings** (e.g., NVDA, AAPL) - This helps the system understand what matters more to them
2. **System automatically**:
   - Fetches financial and market news broadly every 20 minutes
   - Analyzes articles to understand what they mean
   - Determines relevance and importance (prioritizing news related to user's holdings)
   - Ranks stories by importance
3. **User opens app** and sees:
   - Personalized feed of relevant news (ranked by what matters most to them)
   - Clear explanations of why each item matters
   - Safe action suggestions (never buy/sell advice)
   - An importance indicator used to rank what to read first

**Important**: The system monitors financial and market news broadly. Holdings are used to prioritize and rank what matters more to the user, but macro and market-wide signals still appear even if the user has no holdings.

## The "Signal" Concept

Instead of raw articles, your app receives **"Signals"** - interpreted news items that include:
- **What happened** (title, source)
- **Why it matters** (1-3 clear reasons)
- **Suggested action** (from a safe list: "Do nothing", "Understand the context", "Review allocation", "Rebalance to target")
- **An importance indicator** used to rank what to read first
- **Confidence level** in the interpretation

## Safety and Compliance

**Critical protection built in:**
- **No financial advice**: Automatically blocks words like "buy", "sell", "undervalued"
- **Safe actions only**: Uses a predefined list of safe actions
- **Automatic filtering**: Removes problematic content before it reaches users
- **Downgrades risky content**: If advice language is detected, the signal is automatically downgraded

The system is designed to inform decisions, not recommend trades.

## Automation

**Runs 24/7 without any manual steps:**
- **Every 20 minutes**: Fetches new articles from news sources
- **Every 2 minutes**: Processes pending articles to understand them
- **Every 10 minutes**: Ranks articles by importance

This means your app always has fresh, processed news ready - no manual work required.

## Key Folders (What They Do)

- **`product/`** - What the iOS app uses (the public API)
- **`background/`** - Automated jobs that keep the system running
- **`decisions/`** - Safety rules and interpretation logic
- **`pipeline/`** - Internal processing (5 stages)
- **`admin/`** - Debug tools for developers
- **`data/`** - Database storage
- **`integrations/`** - External services (news APIs, AI)

## Business Value

**Why this matters:**
- **Personalization**: Users see news that's relevant to their interests
- **Time savings**: Users don't have to read everything
- **Safety**: No financial advice means lower legal risk
- **Scalability**: Handles many users automatically
- **Quality**: AI filters and ranks content intelligently

## What Users Experience

1. **Add holdings** (e.g., NVDA, AAPL) - Helps prioritize what they see
2. **Open app** - Feed is already ready
3. **See feed** - Relevant news, ranked by importance
4. **Read explanations** - Each item explains why it matters
5. **Get safe suggestions** - Action items that never include buy/sell

## Costs to Consider

- **News APIs**: Usually free tiers with limits
- **AI (OpenAI)**: Costs per article analyzed (batching reduces cost)
- **Hosting**: Server costs for 24/7 operation

## Growth Considerations

- **Multi-user ready**: Each user gets their own personalized feed
- **Efficient processing**: Articles processed in batches
- **Rate limiting**: Prevents abuse (100 requests/minute per user)
- **Scalable**: Can add more servers as needed

## Bottom Line

Think of this backend as a **personal news assistant** that:
- Monitors financial and market news broadly
- Prioritizes content based on what matters to each user
- Explains what matters and why
- Never gives financial advice
- Runs automatically 24/7
- Delivers a personalized feed ready to display

The iOS app simply calls `/v1/feed` and receives clean, safe, personalized Signals ready to display. The system is designed to inform decisions, not recommend trades.


