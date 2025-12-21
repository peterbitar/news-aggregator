# Enrichment Validation Fix

## Problem

Articles were being marked as "enriched" in the UI even though they weren't actually enriched. The database showed that `summary_enriched` contained HTML content (the full article HTML) instead of an actual summary.

## Root Cause

The enrichment check in `articleStorage.js` was too simple:
```javascript
const hasEnrichment = row.summary_enriched || row.why_it_matters || Object.keys(relevanceScores).length > 0;
```

This check only verified that `summary_enriched` was truthy (non-empty), but didn't validate that it was actually a valid summary. If the field contained HTML content (which is truthy), the article would be incorrectly marked as enriched.

## Solution

Added a `hasValidEnrichment()` helper function that validates enrichment data:

1. **Validates `summary_enriched`**:
   - Must exist and be non-empty
   - Must be less than 2000 characters (reasonable summary length)
   - Must NOT contain HTML tags (`<!DOCTYPE`, `<html`, or start with `<`)
   
2. **Validates `why_it_matters`**:
   - Same validation as summary (non-empty, reasonable length, no HTML)

3. **Validates `relevance_scores_json`**:
   - Must be valid JSON
   - Must contain at least one relevance score

4. **Enrichment Logic**:
   - Article is considered enriched if it has a valid summary
   - OR if it has both valid `why_it_matters` AND valid relevance scores

## Files Changed

- `backend/articleStorage.js`:
  - Added `hasValidEnrichment()` function
  - Updated all three places where `hasEnrichment` was checked to use the new validation function

## Impact

- Articles with HTML in `summary_enriched` will no longer be marked as enriched
- Only articles with actual enrichment data will show as enriched in the UI
- Existing bad data will be filtered out automatically

## Next Steps (Optional)

To clean up existing bad data in the database, you could run:

```sql
-- Clear invalid enrichment data (HTML content)
UPDATE articles 
SET summary_enriched = NULL, why_it_matters = NULL
WHERE summary_enriched LIKE '<!DOCTYPE%' 
   OR summary_enriched LIKE '<html%'
   OR summary_enriched LIKE '<%'
   OR LENGTH(summary_enriched) > 2000;
```

This will clear the invalid enrichment data so articles can be re-enriched properly.

