# Logic Fixes Summary

## Overview
Fixed the ingestion + interpretation flow to match priorities: cost control, interpret-once reuse, and microprocess discipline.

---

## Files Changed

### 1. **NEW: `backend/decisions/decideImpactLite.js`**
   - **Purpose:** Lightweight impact guess before expensive content fetch
   - **What it does:**
     - Calculates `likely_impact` (0-100) using ONLY title + snippet + source + tags
     - Uses `PROCESS_GATE_THRESHOLD` (30) to gate expensive processing
     - Prevents content fetch for low-impact articles
   - **Key logic:**
     - Base score from title relevance (0-30)
     - Event type boost (+20 for high-impact events)
     - Ticker/sector matches boost
     - Source quality boost
     - Holdings search boost

### 2. **Modified: `backend/pipeline/articlePipeline.js`**
   - **Changes:**
     - Added Stage 1.5 (lightweight impact guess) before Stage 2 (content fetch)
     - Added `PROCESS_GATE_THRESHOLD` constant (30) for process gating
     - Added `FEED_RANK_THRESHOLD` constant (40) for feed ranking
     - Updated batch processing to include Stage 1.5
     - Updated Stage 2 prerequisites to check `likely_impact >= PROCESS_GATE_THRESHOLD`
     - Updated Stage 4 skip logic to use `FEED_RANK_THRESHOLD` instead of hardcoded 40

### 3. **Modified: `backend/pipeline/stage4_personalization.js`**
   - **Critical changes:**
     - **Removed LLM call** - no longer generates personalized summaries/titles
     - **Removed interpretation field updates** - no longer modifies verdict, why, action, summaries
     - **Only updates scoring fields:**
       - `holding_relevance_score`
       - `profile_adjusted_score`
       - `profile_type_cached`
     - Uses `FEED_RANK_THRESHOLD` (30) for ranking, not process gating
   - **Result:** Personalization now only adjusts scores, interpretation is global and reused

### 4. **Modified: `backend/data/db.js`**
   - **Added column:** `likely_impact` (REAL) to articles table
   - Used to store lightweight impact guess from Stage 1.5

### 5. **Modified: `backend/data/articleStorage.js`**
   - **Updated:** `getRankedForFeed()` to use `FEED_RANK_THRESHOLD` constant (40) instead of hardcoded value

### 6. **NEW: `backend/INGESTION_INTERPRETATION_FLOW.md`**
   - Updated step-by-step flow description
   - Includes new Stage 1.5 (lightweight impact guess)
   - Clarifies that Stage 4 only adjusts scores, doesn't generate summaries
   - Explains split thresholds (process gate vs feed rank)

---

## Key Logic Changes

### A) Lightweight Impact Guess (Stage 1.5)
- **Before:** Title triage → Content fetch → Full classification → Discard low impact
- **After:** Title triage → **Lightweight impact guess** → (only if likely_impact >= 30) → Content fetch → Full classification
- **Benefit:** Reduces scraping + token costs by gating expensive processing early

### B) Personalization No Longer Generates Summaries
- **Before:** Stage 4 called LLM to generate personalized summaries, titles, teasers
- **After:** Stage 4 only calculates score adjustments (holding_relevance_score, profile_adjusted_score)
- **Benefit:** Interpretation is global and reused across all users, reducing LLM costs and ensuring consistency

### C) Split Thresholds
- **Before:** Single threshold (40) used for both process gating and feed ranking
- **After:**
  - `PROCESS_GATE_THRESHOLD` (30): Gates expensive content fetch + deep LLM
  - `FEED_RANK_THRESHOLD` (40): Minimum score to appear in feed
- **Benefit:** Clear separation of concerns - process gating vs ranking

### D) Holdings Are Boost, Not Filter
- **Confirmed:** Holdings-related articles get +10 boost in feed ranking
- **Confirmed:** All articles meeting `FEED_RANK_THRESHOLD` appear, regardless of holdings match
- **Benefit:** Macro/market news still appears even without holdings

### E) Content Fetch Is Optional
- **Before:** All articles passing title triage fetched full content
- **After:** Only articles with `likely_impact >= PROCESS_GATE_THRESHOLD` fetch full content
- **Benefit:** Reduces scraping costs

### F) Guardrails At The End
- **Confirmed:** Guardrails applied at Stage 5 (final ranking)
- **Confirmed:** Optional second check at `/v1/feed` endpoint
- **Benefit:** Ensures no financial advice reaches users

---

## Testing

### Test Lightweight Impact Guess
```bash
# Check that articles get likely_impact score after Stage 1.5
# Articles with likely_impact < 30 should be marked "low_priority"
# Articles with likely_impact >= 30 should proceed to Stage 2
```

### Test Personalization (No LLM)
```bash
# Verify Stage 4 no longer calls LLM
# Check that only scoring fields are updated (holding_relevance_score, profile_adjusted_score)
# Verify interpretation fields (verdict, why, action) are NOT modified in Stage 4
```

### Test Thresholds
```bash
# Verify PROCESS_GATE_THRESHOLD (30) gates content fetch
# Verify FEED_RANK_THRESHOLD (40) filters feed display
# Check that macro articles (no holdings) can still appear if they meet feed threshold
```

### Test Holdings Boost
```bash
# Verify holdings-related articles get +10 boost in feed ranking
# Verify macro articles (no holdings) still appear if they meet threshold
# Check that holdings are NOT used as a filter
```

---

## Migration Notes

- **Database:** New `likely_impact` column will be added automatically on next server start
- **Existing articles:** Articles already in pipeline will continue processing normally
- **No breaking changes:** All changes are backward compatible

---

## Summary

The system now:
1. ✅ Gates expensive processing early (lightweight impact guess)
2. ✅ Interprets once globally (Stage 3), reuses across users
3. ✅ Personalizes only scores (Stage 4), not meaning
4. ✅ Uses split thresholds (process gate vs feed rank)
5. ✅ Boosts holdings but doesn't filter by them
6. ✅ Applies guardrails at the end (Stage 5)

All changes maintain backward compatibility and reduce costs while improving consistency.


