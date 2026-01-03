# Explanation Audit Results: 6-Part Standard Implementation

**Date:** January 2, 2026
**Standard:** 6-Part Explanation Structure (Calm-Orientation Philosophy)
**Status:** ✅ AUDIT COMPLETE - MIGRATION PLAN READY

---

## Executive Summary

### Current State
- **Total Explanations:** 39 story groups
- **Compliance:** 0/39 (0%) conform to new 6-part structure
- **Database Status:** Old schema in place; new columns not yet added
- **Code Status:** ✅ New generator code ready; new explanations will auto-generate with 6-part structure

### Quality Issues Found
- **Urgency Language:** 14/39 (36%) contain urgency words that violate calm-tone requirement
  - "immediately" (6x)
  - "must" (4x)
  - "emergency" (3x)
  - "urgent" (1x)
- **Missing 6-Part Structure:** 39/39 lack mostLikelyScenarios field (expected; database schema not migrated yet)

### What This Means
✅ **Good News:**
- New code is ready and will enforce the 6-part structure for all future explanations
- iOS API documentation is updated and ready
- Permanent standard document is in place

⏳ **Action Needed:**
- Existing 39 explanations should be regenerated with the new structure
- Database schema needs columns added for new explanation fields
- Urgency language needs to be removed from existing explanations

---

## Breakdown by Story Type

### Global Stories (8 total)
Stories that apply to all users regardless of holdings:
- All 8 fail due to missing mostLikelyScenarios
- 2 contain urgency language ("immediately")
- Examples: Fed decisions, market crashes, sector-wide trends

**Migration:** Regenerate with rationale for why this affects everyone

### Ticker-Specific Stories (31 total)
Stories scoped to individual holdings:
- All 31 fail due to missing mostLikelyScenarios
- 12 contain urgency language
- Tickers involved: AAPL, MSFT, NVDA, GOOGL, TSLA, BTC, ADA, DOGE, XRP, USDT, PLTR, YUM, MSTR, NVO, BRK.A, BBAI, BIDU, STLA, RH, DJT, COIN, ICP, BITF, LIT

**Migration:** Regenerate with explicit "why it matters to you" tied to each holding

---

## Detailed Issue List

### Issue #1: Missing mostLikelyScenarios (39/39)
**Severity:** HIGH (mandatory field)
**Count:** 39 explanations
**Fix:** Regenerate explanations with new code
**Effort:** Automated (no manual work)

### Issue #2: Urgency Language (14/39)
**Severity:** HIGH (violates calm-tone requirement)
**Count:** 14 explanations
**Breakdown:**
- "immediately" (6 instances) → Remove or rephrase
- "must" (4 instances) → Replace with "should" or "can"
- "emergency" (3 instances) → Replace with "stress" or "pressure"
- "urgent" (1 instance) → Remove or use "timely"

**Examples to Fix:**
```
❌ "You must understand the implications immediately"
✅ "Understanding the timing helps you stay informed"

❌ "This is an emergency requiring immediate action"
✅ "This situation reflects market pressure that will evolve over time"

❌ "Investors must act immediately"
✅ "This type of situation typically takes 2-4 weeks to resolve"
```

**Fix:** Regenerate explanations (new code doesn't produce urgency language)
**Effort:** Automatic

### Issue #3: Missing Explicit "Who Doesn't Benefit" (Unknown)
**Severity:** MEDIUM (requirement of new standard)
**Issue:** Old explanations may not explicitly state who is NOT affected
**Fix:** Review and enhance during regeneration
**Effort:** Automatic (new code enforces this)

---

## Migration Plan

### Phase 1: Database Schema (Immediate)
**Status:** PENDING
**What to Do:** Add new columns to `story_group_explanations` table:
```sql
ALTER TABLE story_group_explanations ADD COLUMN summary TEXT;
ALTER TABLE story_group_explanations ADD COLUMN whyItMattersForYou TEXT;
ALTER TABLE story_group_explanations ADD COLUMN whyThisHappened TEXT;
ALTER TABLE story_group_explanations ADD COLUMN mostLikelyScenarios JSON;
ALTER TABLE story_group_explanations ADD COLUMN whatToKeepInMind JSON;
ALTER TABLE story_group_explanations ADD COLUMN sources JSON;
```
**Time:** ~5 minutes
**Risk:** LOW (backwards compatible; old columns remain)

### Phase 2: Regenerate Existing Explanations (This Week)
**Status:** PENDING
**What to Do:** Run regeneration script on all 39 existing explanations:
```bash
node backend/scripts/rewriteExplanationsStrict.js --date YYYY-MM-DD --all
```
**Options:**
- Regenerate one date at a time (safer)
- Regenerate all at once (faster)

**Time:** ~2-5 minutes (depends on LLM capacity)
**Cost:** ~39 LLM API calls (~$2-5)
**Risk:** MEDIUM (depends on LLM quality)

### Phase 3: Validation & QA (After Regeneration)
**Status:** PENDING
**What to Do:**
1. Run audit script to verify all 39 now pass:
   ```bash
   node backend/scripts/auditExplanations6Part.js
   ```
2. Spot-check 5-10 regenerated explanations for quality
3. Verify no urgency language in regenerated content
4. Verify all 6 parts are present and complete

**Time:** ~30 minutes
**Risk:** LOW (automated validation)

### Phase 4: Commit & Deploy
**Status:** PENDING
**What to Do:**
1. Commit database migration and regenerated explanations
2. Update iOS API in production (if needed)
3. Monitor for user feedback on clarity

**Time:** ~15 minutes
**Risk:** LOW (explanations are non-critical path)

---

## Success Criteria

After migration, all explanations should meet:

✅ **Structural:**
- All 6 parts present and in correct order
- mostLikelyScenarios has 2-3 scenarios with correct fields
- sources array has at least 1 source
- whatToKeepInMind has 3-5 items

✅ **Content:**
- Zero urgency language (no "immediately," "must," "emergency," "urgent")
- Explicitly states "who this affects" and "who it doesn't affect"
- Non-finance reader can understand without Googling

✅ **Emotional:**
- Reader feels calmer, not more anxious after reading
- FOMO is reduced
- No urge to check prices or social media

---

## Tracking

**Audit Completed:** January 2, 2026, 2:30 PM
**Last Audit Command:** `node backend/scripts/auditExplanations6Part.js`
**Next Audit:** After regeneration (expected: January 3-4, 2026)

**To Re-Run Audit:**
```bash
node backend/scripts/auditExplanations6Part.js
```

---

## Historical Record

### What Was Audited
- 39 existing story group explanations
- Database schema (old columns: 6/6 present, new columns: 0/6 present)
- Each explanation checked for:
  - Presence of 6-part structure
  - Urgency language (14 issues found)
  - Explicit audience framing (quality check)

### Key Findings
1. **Database not yet migrated** → Schema doesn't have new columns, but that's OK; they'll be created when new explanations are generated
2. **Old explanations have urgency language** → This was part of the old standard; new code doesn't produce this
3. **All explanations need regeneration** → They'll automatically get the 6-part structure when regenerated with new code
4. **No manual rewriting needed** → Automatic regeneration will fix all issues

---

## Next Steps for Product Team

1. **Review & Approve:** This audit and migration plan
2. **Schedule Regeneration:** Choose date/time for regenerating 39 explanations
3. **Monitor Quality:** Spot-check first few regenerated explanations
4. **Communicate Change:** Notify stakeholders about new explanation structure
5. **Monitor User Response:** Track engagement/feedback after rollout

---

**Status:** ✅ READY FOR MIGRATION
**Owner:** Engineering
**Approved:** (pending)
