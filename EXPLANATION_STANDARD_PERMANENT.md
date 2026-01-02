# PERMANENT EXPLANATION STANDARD

**Effective Date:** January 2, 2026
**Version:** 1.0
**Scope:** All news story explanations in the aggregator system

---

## Purpose

The explanation layer transforms raw news events into *complete understanding* for non-finance readers.

A reader should:
- ✓ Understand what happened (facts)
- ✓ Understand WHY it happened (causal chain)
- ✓ Understand why it matters TODAY (second-order effects)
- ✓ Know specifically what to watch (concrete signals)
- ✓ Understand what NOT to believe (guardrails)
- ✓ Feel CLOSURE (no "I should Google this")

---

## Quality Standards (NON-NEGOTIABLE)

### Standard 1: Causal Clarity

**Rule:** Every explanation MUST explain the "WHY" - not just the "WHAT."

**Bad:**
```
"The Fed raised rates because inflation is high."
```
- This is obvious. Why did THIS Fed raise rates THIS time?

**Good:**
```
"The Fed raised rates because inflation exceeded 5%, which would erode savings.
However, the decision specifically reflects a shift in focus: officials are now
equally worried about financial system stability (banks having enough liquidity).
This shift happened because of stress episodes in late 2025 when liquidity tightened
unexpectedly, forcing emergency intervention."
```

**How to check:** If removing a sentence makes the explanation obviously incomplete, keep it.

---

### Standard 2: Second-Order Effects

**Rule:** "Why it matters NOW" must show what CHANGES in the world.

**Bad:**
```
"This is important for investors."
"This could affect market performance."
"Relevant for portfolio construction."
```
- Generic hand-waving. No specific change.

**Good:**
```
"Here's what changed: If rates rise further, banks will face lower deposit
competition. This means banks will cut savings account rates FASTER than expected.
Your 4.5% savings account could drop to 2.8% within 30 days instead of 90 days.
For borrowers, it means mortgage rates won't fall as fast as expected either."
```

**How to check:** Rewrite the statement to answer "Specifically, what happens differently now?"

---

### Standard 3: Concrete Signals (NOT Vague Watching)

**Rule:** Each "what to watch next" MUST follow this format:

```
"Watch for X (published WHERE, HOW OFTEN) because it will indicate Y.
- If X happens, it means Z (positive/negative implication)
- If X doesn't happen, it means W (alternative)"
```

**Bad:**
```
"Monitor for follow-up developments and market reaction."
"Watch for official statements and analyst commentary."
```
- No WHERE, HOW, or meaning.

**Good:**
```
"Watch the Federal Reserve Bank of New York website daily for SOFR
(Secured Overnight Financing Rate).

- If SOFR exceeds 6% for 3+ consecutive days, banks are struggling to get
  short-term cash and the Fed's concern is real.

- If SOFR stays below 5%, banks have plenty of cash and there's no crisis."
```

**How to check:** Can a Mom follow this and understand what it means? If not, it's too vague.

---

### Standard 4: Specific Audience

**Rule:** "Who this applies to" must be SPECIFIC, not generic.

**Bad:**
```
"All market participants."
"Relevant to portfolio construction and risk management."
```

**Good:**
```
"This applies if you:
- Own Apple stock directly
- Have a 401(k) or IRA with a tech index fund (QQQ, VGT, XLK)
- Bank with a large U.S. bank (JPMorgan, Bank of America, Wells Fargo)

This does NOT apply if you:
- Only own bonds
- Have cash in FDIC-insured savings accounts
- Own only international stocks"
```

**How to check:** Would a Mom know if it applies to her? If not, be more specific.

---

### Standard 5: Misconception Prevention

**Rule:** "What this does NOT mean" must prevent 2+ specific misreadings.

**Bad:**
```
"This is informational only and does not constitute investment advice."
```
- Legal boilerplate, not helpful.

**Good:**
```
"This does NOT mean:
- The Fed will cut rates immediately (they're monitoring, not panicking)
- A financial crisis is imminent (funding stress is quarterly and normal)
- You should sell everything (liquidity stress ≠ market crash)
- Inflation is no longer a concern (the Fed still cares about it)"
```

**How to check:** What 2-3 fear/hype conclusions might a reader jump to? Prevent those.

---

### Standard 6: Plain Language

**Rule:** Every finance term must be defined inline. Sentences must be <20 words.

**Bad:**
```
"When gross margin compression occurs due to product mix shifts,
it signals operational headwinds that could constrain earnings growth."
```
- 16 words but still uses jargon: gross margin, product mix, operational headwinds

**Good:**
```
"When profit per dollar of sales falls because the company sells more
low-margin products (phones) and fewer high-margin services, it suggests
growth is becoming harder."
```
- Simpler words. Definitions inline.

**How to check:** Read it aloud to a non-finance person. Can they understand?

---

## Required Fields

Every explanation MUST include:

1. **what_happened** (2-4 sentences)
   - Factual, specific, no analysis
   - Include: who, what, when, numbers, names
   - Expand beyond headline

2. **why_it_happened** (2-5 sentences) ⭐ CRITICAL
   - Explain the causal chain
   - Answer: "Why THIS decision instead of another?"
   - Include historical context and competing pressures
   - MUST show depth (not obvious)

3. **why_it_matters_now** (3-6 sentences)
   - Show second-order effects
   - Answer: "What changes in the world?"
   - Be specific, not abstract
   - Include both risks AND opportunities

4. **who_this_applies_to** (2-4 sentences)
   - Explicit list: "If you own X..." or "If you work in Y..."
   - Include real fund tickers (QQQ, VTI, etc.)
   - Include negatives: "This does NOT apply if..."
   - Mom should know: "That's me" or "Not me"

5. **what_to_watch_next** (3-6 specific signals)
   - MUST have: X (what), WHERE (source), MEANING (if/then)
   - Each signal should be testable
   - No vague language (monitor, keep eye on, watch)
   - Preferably: published daily/weekly/when event occurs

6. **what_this_does_not_mean** (2-4 statements)
   - Actively prevent misconceptions
   - Include both fear and hype misreadings
   - Format: "This does NOT mean..."

7. **sources_summary** (list)
   - Sources already in database
   - Do NOT add new sources
   - Format: "- Reuters, MarketWatch, Fed.gov"

8. **cause_confidence** (High / Medium / Low)
   - Justified by cause_reason
   - High = documented facts, official statements
   - Medium = reasonable inference, some uncertainty
   - Low = speculative, multiple interpretations

9. **cause_reason** (1-2 sentences)
   - Explain WHY confidence is at this level
   - Reference data quality or uncertainty

10. **decision_reasoning** (JSON)
    ```json
    {
      "accepted_because": [
        "Explains causal chain clearly",
        "Shows second-order effects",
        "Provides concrete watch signals",
        "Prevents misconceptions",
        "Reader achieves closure"
      ],
      "rejected_if_applicable": []
    }
    ```

11. **plain_summary** (1 sentence, optional but recommended)
    - For iOS headline preview
    - Should be readable and complete alone
    - 40-80 characters

---

## Quality Gate Checklist

Before saving ANY explanation, MUST pass:

- [ ] **what_happened:** Specific facts, numbers, dates (not headline repetition)
- [ ] **why_it_happened:** Causal chain, context, explains "why THIS not something else"
- [ ] **why_it_matters_now:** Shows second-order effects, not abstract importance
- [ ] **who_this_applies_to:** Mom knows if it applies to her (specific, not generic)
- [ ] **what_to_watch_next:** EVERY signal has "WHERE" and "because it means" clause
- [ ] **what_this_does_not_mean:** Prevents 2+ fear/hype conclusions
- [ ] **cause_confidence:** Matches cause_reason justification
- [ ] **Plain language:** No jargon without definition, <20 words/sentence
- [ ] **Closure test:** Non-finance reader achieves closure (no "I should Google this")

---

## Red Flag Words (AUTOMATIC FAIL)

If any explanation contains:

- "monitor developments"
- "watch for reaction"
- "keep an eye on"
- "assess performance"
- "relevant to investors"
- "important for markets"
- "could affect prices"
- "wait and see"
- "seize" (use "pressure" instead)
- "crash" (use "fall" or "decline")
- "panic" (use "stress" or "pressure")

Then: **REWRITE the field immediately.**

---

## Green Flag Words (PREFERRED)

Use liberally:

- "Watch for X at Y because Z"
- "This means..."
- "If X happens, then..."
- "You should understand..."
- "This does NOT mean..."
- "Concrete signal: ..."
- "Specific watch: ..."
- "This applies if you..."

---

## Validation Script

Every new explanation MUST pass:

```javascript
// Check 1: No red flags
if (explanation.toLowerCase().match(/monitor developments|watch for reaction|keep an eye on/)) {
  FAIL("Red flag words detected");
}

// Check 2: Concrete signals
if (!explanation.what_to_watch_next.includes('because')) {
  FAIL("what_to_watch_next lacks meaning explanations");
}

// Check 3: Specific audience
if (explanation.who_this_applies_to.includes('all market participants')) {
  FAIL("Too generic - be specific about who");
}

// Check 4: Length signals substance
if (explanation.why_it_happened.length < 300) {
  FAIL("why_it_happened too short - likely missing causal chain");
}

// Check 5: Closure test
if (explanation.what_this_does_not_mean.length < 150) {
  FAIL("what_this_does_not_mean too short - need to prevent misconceptions");
}
```

Run: `node backend/scripts/validateExplanations.js`

---

## Process for Creating New Explanations

When a new story group is created:

1. **Write what_happened** (facts only, no analysis)
2. **Write why_it_happened** (causal chain, deepest thinking)
3. **Write why_it_matters_now** (second-order effects)
4. **Write who_this_applies_to** (specific people, not "all investors")
5. **Write what_to_watch_next** (3+ signals with WHERE and MEANING)
6. **Write what_this_does_not_mean** (prevent 2+ misconceptions)
7. **Assign cause_confidence** (High/Medium/Low with reason)
8. **Write plain_summary** (1-sentence preview)
9. **Run validator:** `node backend/scripts/validateExplanations.js`
10. **If not PASS:** Rewrite failing fields
11. **If PASS:** Commit to database

---

## Examples of GOOD Explanations

### Example 1: Federal Reserve (Macro)

```
what_happened:
"The Federal Reserve held rates at 4.0-4.25% in December 2025,
with explicit concern about liquidity in overnight funding markets.
Officials noted that repo rates spiked unexpectedly in late 2025,
and some banks had trouble accessing short-term cash around quarter-end."

why_it_happened:
"The Fed kept rates steady because inflation, while cooling, remains
above its 2% target. But deeper: Fed officials are now equally
concerned about liquidity in short-term funding markets. This shift
happened because of stress episodes in late 2025. When banks needed
to roll over loans around quarter-end, borrowing rates spiked
unexpectedly. Fed officials remember 2024, when liquidity tightened
unexpectedly, forcing emergency intervention."

why_it_matters_now:
"The Fed's attention shifted from 'Is the economy overheating?' to
'Do banks have enough cash?' This matters because the Fed acts
differently depending on what they're worried about. If inflation is
the worry, they ignore good economic news. If liquidity is the worry,
they act FAST on any sign of stress. For your portfolio: markets
might spike down 3-5% on funding news, regardless of economic data."

who_this_applies_to:
"This applies if you own stocks, have a bank account, or have a
mortgage. It does NOT matter if you only own bonds or hold only gold."

what_to_watch_next:
"1) Visit Federal Reserve Bank of New York website daily. Look for
SOFR (Secured Overnight Financing Rate). If it exceeds 6% for
2+ days, banks are struggling and the Fed's concern is real.
2) Listen to Powell's speeches. If he mentions 'stabilizing,' risk
is lower. If he says 'fragile,' risk is higher.
3) During earnings calls, count mentions of 'funding costs.' If many
companies mention this, stress is widespread."

what_this_does_not_mean:
"This does NOT mean: The Fed will cut rates immediately (monitoring,
not panicking). A financial crisis is coming (funding stress is normal).
You should sell everything (liquidity stress ≠ market crash)."

cause_confidence: "High"
cause_reason: "FOMC minutes are official. Liquidity stress events are documented.
Language shifts are explicit in Fed speeches."

plain_summary: "The Fed shifted from inflation worry to bank funding worry,
which could trigger sudden market swings."
```

### Example 2: Stock Earnings (Micro)

```
what_happened:
"Apple reported Q1 2026 earnings of $2.18 per share, beating
analyst consensus of $2.05 (+6% beat). Gross margin held steady
at 47.5%. iPhone unit sales met guidance. Revenue came in as
expected. No major upside surprise."

why_it_happened:
"Apple beat because actual spending held steady despite analyst
fears about consumer pullback. However, the beat was modest—only 6%
above consensus, not dramatic. Gross margin stayed flat because
Apple sold the same mix of products (devices + services) as expected.
There was no shift toward higher-margin offerings."

why_it_matters_now:
"This changes expectations: Apple is not growing faster than expected,
but it IS holding its ground despite macro headwinds. Profit-per-sale
(margin) is stable, so pricing pressure hasn't appeared yet. This means
Apple's valuation depends on whether macro conditions stay stable or
weaken. If consumer spending slows further in Q2, Apple could miss."

who_this_applies_to:
"This applies if you own Apple stock or hold tech index funds (QQQ, VGT).
It does NOT apply if you only own bonds or Apple doesn't represent
your investment thesis."

what_to_watch_next:
"1) iPhone 18 pre-order numbers (Apple sometimes mentions in calls).
If weak, demand is softening. If strong, holiday momentum continues.
2) Services revenue growth in next quarter. Higher growth than device
sales would signal better margins coming.
3) China demand discussion in earnings call. If management sounds
worried about China, stock could fall."

what_this_does_not_mean:
"This does NOT mean: Apple will beat again next quarter (Q2 is typically
softer). The stock will rise (good earnings are often priced in). Consumers
are spending strongly (a beat doesn't mean explosion). Apple is immune
to recession (weakness could hit in Q2)."

cause_confidence: "High"
cause_reason: "Earnings results are factual. Guidance is from management. Growth
rates are documented. These are verifiable numbers, not opinions."

plain_summary: "Apple held steady but didn't beat dramatically, suggesting
stable demand without strong growth."
```

---

## How This Works at Scale

When iOS fetches `/v1/feed/story-groups` for user 1:

1. API returns 13 story groups (5 GLOBAL + 8 TICKER-specific)
2. Each group has a complete explanation with all 11 fields
3. iOS can:
   - Show **plain_summary** as headline preview
   - Display **what_happened** + **why_it_happened** as main explanation
   - Show **what_to_watch_next** as expandable signals
   - Include **plain_summary** in search results
4. Reader gets FULL CLOSURE without needing secondary sources
5. No Googling required

---

## Maintenance & Updates

### Review Cycle
- Monthly: Run validation script, fix any violations
- Quarterly: Audit explanation quality, identify patterns
- Annually: Update standard based on user feedback

### Feedback Loop
- Track which explanations get re-reads (user engages with explanation)
- Track which explanations get Googled (signal: explanation lacks closure)
- Improve templates based on patterns

### Escalation
- If validation fails: Rewrite immediately
- If user feedback indicates lack of closure: Update explanation
- If new story type appears: Create new template

---

## References

- `/backend/scripts/rewriteExplanationsStrict.js` - Strict rewrite examples
- `/backend/scripts/validateExplanations.js` - Validator script
- `/STRICT_EXPLANATION_TEMPLATE.md` - Detailed template with examples
- `/EXPLANATION_AUDIT_GAPS.md` - Audit of current gaps

---

## Commitment

This standard is **PERMANENT** and **NON-NEGOTIABLE**.

Every explanation must:
- ✓ Explain causation (not just facts)
- ✓ Show second-order effects
- ✓ Provide concrete, testable signals
- ✓ Prevent misconceptions
- ✓ Achieve closure

**If it doesn't pass validation, it's not ready for production.**

---

**Standard Owner:** Engineering Team
**Last Updated:** January 2, 2026
**Next Review:** April 2, 2026
