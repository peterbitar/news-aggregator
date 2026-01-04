# LLM Integration for Story Groups - Implementation Summary

## ✅ Changes Implemented

### 1. **LLM-Based Title Clustering** (`backend/integrations/llmService.js`)

**New Function:** `clusterArticlesByTitleLLM(articles)`

- **What it does:** Analyzes all article titles at once using LLM
- **How it works:**
  1. Sends all titles to OpenAI in a single API call
  2. LLM groups titles by story (same event/announcement)
  3. Returns clusters with story summaries
- **Benefits:**
  - Better semantic understanding (not just keywords)
  - Handles different wording for same story
  - Faster than pairwise comparisons
  - Provides story summaries for each cluster

**Prompt:** LLM receives all titles and returns JSON with groups and story summaries.

---

### 2. **LLM-Based Explanation Generation** (`backend/integrations/llmService.js`)

**New Function:** `generateStoryGroupExplanation(articles, groupTitle, scope, primaryTicker, impactLevel)`

- **What it does:** Generates complete 6-part explanations using your exact prompt
- **Uses your strict prompt structure:**
  - Orientation-focused (not trading advice)
  - 6 required sections in exact order
  - Plain language (grade 6-8)
  - Calm tone, reduces anxiety
  - No hype, no urgency, no predictions

**Output Structure:**
1. **Summary** (3-6 sentences, plain English)
2. **Why this matters for you** (personalized, explains feed relevance)
3. **Why this happened** (3-step causal chain, terms translated)
4. **Most likely scenarios** (2-3 scenarios with likelihood)
5. **What to keep in mind** (misunderstandings + calm reframes)
6. **Sources** (transparent source list)

---

### 3. **Updated Database Schema** (`backend/data/db.js`)

**Added columns to `story_group_explanations`:**
- `why_it_happened` (TEXT)
- `cause_confidence` (TEXT)
- `cause_reason` (TEXT)
- `decision_reasoning` (TEXT)

Columns are added automatically if they don't exist.

---

### 4. **Updated Story Group Creation** (`backend/scripts/createStoryGroupsFromRanked.js`)

**Step 2 - Clustering:**
- **Before:** Keyword-based Jaccard similarity
- **After:** LLM title analysis (semantic grouping)

**Step 4 - Explanations:**
- **Before:** Basic fallback (title + description)
- **After:** LLM-generated explanations with fallback

**Process:**
1. Fetch ranked articles
2. **LLM clusters by title** → Groups semantically similar articles
3. Create story groups from clusters
4. **LLM generates explanations** → Full 6-part structure
5. Store in database

---

## 🔧 Configuration

**API Key:** Configure in `backend/.env`:
```
OPENAI_API_KEY=your_api_key_here
```

**Model:** Uses `gpt-4o-mini` (configurable via `OPENAI_MODEL` env var)

---

## 🚀 How to Use

### Generate Story Groups with LLM:

```bash
cd backend
node scripts/createStoryGroupsFromRanked.js
```

**What happens:**
1. Fetches top 50 ranked articles
2. **LLM analyzes all titles** and groups them by story
3. Creates story groups from clusters
4. **LLM generates explanations** for each group (6-part structure)
5. Stores everything in database

**Output:**
- Better clustering (semantic understanding)
- High-quality explanations (calm, orientation-focused)
- All 6 explanation parts populated
- Story summaries for each cluster

---

## 📊 What Changed in the Process

### Before:
```
Ranked Articles
    ↓
Keyword Clustering (Jaccard similarity)
    ↓
Story Groups
    ↓
Basic Explanations (title + description)
```

### After:
```
Ranked Articles
    ↓
LLM Title Analysis (semantic grouping)
    ↓
Story Groups (with story summaries)
    ↓
LLM Explanation Generation (6-part structure)
    ↓
High-Quality Explanations (calm, orientation-focused)
```

---

## 🎯 Key Improvements

1. **Better Clustering:**
   - Understands meaning, not just keywords
   - Groups "Fed raises rates" with "Federal Reserve increases interest rates"
   - Provides story summaries

2. **Better Explanations:**
   - Complete 6-part structure
   - Calm, orientation-focused tone
   - Plain language (grade 6-8)
   - Reduces anxiety, provides closure
   - No hype, no urgency, no trading advice

3. **LLM Used in 2 Steps:**
   - **Clustering:** Title-based semantic grouping
   - **Explanations:** Full 6-part explanation generation

---

## ⚠️ Fallback Behavior

If LLM fails or API key is missing:
- **Clustering:** Falls back to keyword-based Jaccard similarity
- **Explanations:** Falls back to basic (title + description)

System continues to work even if LLM is unavailable.

---

## 🧪 Testing

Test the new LLM-based story groups:

```bash
# Generate story groups with LLM
cd backend
node scripts/createStoryGroupsFromRanked.js

# Test the API endpoint
curl -H "x-user-id: 1" "http://localhost:5002/v1/feed/story-groups"
```

**Expected Results:**
- Better grouped articles (semantic similarity)
- High-quality explanations with all 6 parts
- Calm, orientation-focused tone
- Plain language, no jargon
- Complete closure (reader doesn't need to Google)

---

## 📝 Files Modified

1. `backend/integrations/llmService.js`
   - Added `clusterArticlesByTitleLLM()`
   - Added `generateStoryGroupExplanation()`

2. `backend/data/storyGroupStorage.js`
   - Updated `createStoryGroupExplanation()` to support `why_it_happened`

3. `backend/data/db.js`
   - Added missing columns to `story_group_explanations` table

4. `backend/scripts/createStoryGroupsFromRanked.js`
   - Updated Step 2: Uses LLM for clustering
   - Updated Step 4: Uses LLM for explanations

---

## ✅ Status

**All changes implemented and ready to use!**

The system now uses LLM for:
- ✅ Title-based semantic clustering
- ✅ High-quality explanation generation (6-part structure)
- ✅ Your exact prompt structure (orientation-focused, calm tone)

Run `node backend/scripts/createStoryGroupsFromRanked.js` to generate story groups with LLM!
