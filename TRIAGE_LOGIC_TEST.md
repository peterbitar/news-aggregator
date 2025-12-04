# Triage Logic Test Cases

## Test Scenarios

### Scenario 1: Article mentions ticker directly
- **Holdings**: AAPL (ticker: "AAPL", label: "Apple Inc.")
- **Article**: "AAPL stock rises 5% after earnings"
- **searchedBy**: "AAPL"
- **Expected**: ✅ PASS (mentionsTicker = true, foundByHolding = true)

### Scenario 2: Article mentions company name
- **Holdings**: AAPL (ticker: "AAPL", label: "Apple Inc.")
- **Article**: "Apple announces new iPhone model"
- **searchedBy**: null
- **Expected**: ✅ PASS (mentionsLabel = true - "Apple" in label "Apple Inc.")

### Scenario 3: Article doesn't mention holdings
- **Holdings**: AAPL (ticker: "AAPL", label: "Apple Inc.")
- **Article**: "Microsoft releases new Windows update"
- **searchedBy**: null
- **Expected**: ❌ REJECT (no mention of AAPL or Apple)

### Scenario 4: Article found by searching for holding
- **Holdings**: AAPL (ticker: "AAPL", label: "Apple Inc.")
- **Article**: "Tech sector shows growth"
- **searchedBy**: "AAPL"
- **Expected**: ✅ PASS (foundByHolding = true, even if title doesn't mention it)

### Scenario 5: Article too old
- **Holdings**: AAPL
- **Article**: "Apple stock news" (published 35 days ago)
- **Expected**: ❌ REJECT (age > 30 days)

### Scenario 6: Article title too short
- **Holdings**: AAPL
- **Article**: "News" (title < 10 chars)
- **Expected**: ❌ REJECT (title too short)

### Scenario 7: False positive ticker match
- **Holdings**: IT (ticker: "IT")
- **Article**: "Company reports profit"
- **Expected**: ⚠️ POTENTIAL ISSUE - "profit" contains "it", but this is acceptable as pre-filter is meant to be inclusive

### Scenario 8: Label matching edge case
- **Holdings**: AAPL (ticker: "AAPL", label: "Apple")
- **Article**: "Apple Inc announces earnings"
- **Expected**: ✅ PASS (label "Apple" matches "Apple" in title)

### Scenario 9: Multiple holdings
- **Holdings**: AAPL, MSFT
- **Article**: "Microsoft and Apple compete in AI"
- **Expected**: ✅ PASS (mentions both MSFT and Apple)

### Scenario 10: No holdings provided
- **Holdings**: []
- **Article**: "Any financial news"
- **Expected**: ✅ PASS to LLM (no pre-filtering when no holdings)

## Logic Flow Verification

### Pre-filtering Steps (in order):
1. ✅ Check article age (< 30 days)
2. ✅ Check title length (>= 10 chars)
3. ✅ If holdings provided:
   - Check if `searchedBy` matches a holding ticker
   - Check if title/description contains any ticker
   - Check if title/description contains any label (company name)
   - If none match → REJECT
4. ✅ If no holdings → PASS to LLM

### LLM Analysis:
- Only articles that passed pre-filter are sent to LLM
- LLM checks for:
  - High-impact financial events
  - Ads/clickbait
  - Relevance to holdings (if provided)
  - Quality assessment

## Potential Issues Found

### ✅ Fixed Issues:
1. **Missing `searchedBy` field**: Fixed in enrichment endpoint when getting all articles

### ⚠️ Potential Edge Cases:
1. **Ticker substring matches**: "IT" in "profit" - acceptable, pre-filter should be inclusive
2. **Label matching**: Works correctly, checks for company names
3. **Case sensitivity**: All comparisons use `.toUpperCase()` - ✅ correct

### ✅ Verified Correct:
1. Index mapping between articles and LLM results
2. Pre-filtered results are properly combined with LLM results
3. Holdings are passed correctly to triage function
4. `searchedBy` field is used as strong indicator

## Conclusion

The logic appears sound. The pre-filtering will:
- ✅ Automatically reject articles that don't mention holdings
- ✅ Reject old articles (>30 days)
- ✅ Reject articles with very short titles
- ✅ Use `searchedBy` as a strong relevance indicator
- ✅ Pass relevant articles to LLM for quality assessment

The only minor concern is potential false positives from ticker substring matches (e.g., "IT" in "profit"), but this is acceptable as the pre-filter is meant to be inclusive - the LLM will filter out false positives.

