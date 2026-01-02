# Explanation Audit Against Strict Standard

## Problems Identified

### 1. **"what_to_watch_next" is too VAGUE** (CRITICAL)

**Standard Requirement:**
```
Watch for X at Y time/event because it will indicate Z.
```

**Current Problem Examples:**

❌ **Group 7 (FOMC):**
```
Monitor for follow-up developments and market reaction.
Watch for official statements and analyst commentary.
```
- No specific SIGNAL
- No timing
- No meaning
- Fails: Generic hand-waving

❌ **Many groups:**
```
Watch earnings calls for management commentary.
Watch for announcements.
Watch for updates.
```
- These are too generic
- A Mom wouldn't know WHERE to look
- Doesn't explain WHAT it means if X happens

**What We Need:**
```
Watch the Federal Reserve Bank of New York website daily for repo rates.
If overnight repo rates exceed 6%, it indicates banks are struggling to get short-term cash.
This would suggest the Fed's liquidity concerns are becoming real.
```

---

### 2. **"why_it_matters_now" is sometimes TOO SHORT or GENERIC**

**Standard Requirement:**
- Explain what CHANGED in the world TODAY
- Show second-order effects
- Be specific, not abstract

**Problem Examples:**

❌ **Group 7 (FOMC):**
```
Fed officials were focused less on rate moves and more on whether
the financial system has enough cash to avoid sudden disruptions.
```
- This just restates what the Fed cares about
- Doesn't explain WHAT CHANGES for the reader
- Doesn't show second-order effects

❌ **Groups 15 & 23 (Bitcoin):**
```
You should understand that flat crypto markets are periods of
consolidation and positioning. Traders use these periods to assess
longer-term trends...
```
- IDENTICAL text for different articles
- Generic explanation for ANY flat market
- Doesn't explain WHY THIS MOMENT matters

**What We Need:**
```
Here's what changed: Your portfolio risk went up.
Not because Bitcoin will crash, but because the Federal Reserve's
attention just shifted from "Is inflation a problem?" to "Do we have
enough cash in the system?" That's a different kind of risk.

When the Fed worries about cash, markets move fast on ANY liquidity news.
A normal earnings report could trigger a 5% swing if it mentions cash concerns.
That's different from the last 6 months when moves were about inflation data.
```

---

### 3. **"who_this_applies_to" sometimes TOO BROAD**

**Current issue:**
- Many say "All market participants. Relevant to portfolio construction and risk management."
- This is LAZY
- Mom reading this doesn't know if it applies to her

**Problem Examples:**

❌ **Global groups:**
```
who_this_applies_to: "All market participants. Relevant to portfolio construction and risk management."
```
- This is a template answer, not specific
- Mom with $50K in index funds doesn't know: "Is this about me?"

❌ **GOOGL groups:**
```
who_this_applies_to: "Holders of GOOGL. Investors exposed to this sector."
```
- Better, but still vague "exposed to this sector" is hand-wavy

**What We Need:**
```
who_this_applies_to:
"This matters if you:
- Own Apple stock directly
- Have a 401(k) with a tech-heavy index fund (like QQQ)
- Own Apple through Vanguard, Fidelity, or Schwab index funds
This does NOT matter if you only own bonds, cash, or non-tech stocks."
```

---

### 4. **Plain Language could be SIMPLER**

**Current issue:**
- We define terms, but sentences are still sometimes long
- Financial jargon still creeps in

**Examples:**

❌ "Gross margin stayed flat because product mix (iPhones vs. services) remained consistent—no shift toward higher-margin products."
- "Product mix" still jargon
- Sentence too long

✅ Better:
"Profit per dollar of sales stayed the same because Apple sold roughly the same mix of products (devices + services) as before. That's good—it means costs aren't rising."

❌ "Bitcoin ETF flows are now a leading indicator of institutional sentiment."
- What's "leading indicator"?
- What's "institutional sentiment"?

✅ Better:
"When Bitcoin ETFs show big outflows, it means smart money (pension funds, banks) is selling. This is often one of the first signs that big players think prices might fall."

---

## Specific Examples: Before & After

### Example 1: Fed Rate Decision (Group 1)

**CURRENT:**
```
what_to_watch_next:
"Watch Fed speeches for mention of 'liquidity conditions' or 'financial
stability risks.' Watch for changes to the Fed's reverse repo facility
usage (published daily). Watch for spikes in overnight repo rates
(published daily on the Federal Reserve Bank of New York website)."
```

**ISSUES:**
- "reverse repo facility usage" - what's that?
- "Watch for spikes" - how much is a spike?
- Missing the "because it will indicate" part

**UPGRADED:**
```
what_to_watch_next:
"1) Visit the Federal Reserve Bank of New York website daily. Look at
the 'Reverse Repo Facility' number. If it stays above $500 billion,
it means banks are struggling to get cash—this confirms the Fed's
concern is real.

2) Watch Fed Chair Powell's next speech (late January). If he mentions
'liquidity pressure' or 'funding stress,' it means the problem is
getting worse. If he stops mentioning it, the crisis passed.

3) When earnings reports come out (January-February), listen for
executives mentioning 'funding costs' or 'cash management.' If many
companies mention this, widespread stress is starting."
```

---

### Example 2: Bitcoin ETF Flows (Group 10)

**CURRENT:**
```
what_to_watch_next:
"Watch weekly Bitcoin ETF flow data (published by providers like
Grayscale and iShares). If inflows resume on price strength, it signals
renewed confidence. Watch Bitcoin price action around $75,000 and
$85,000—price bounces off these levels with inflows would indicate
institutional support."
```

**ISSUES:**
- "inflows resume on price strength" - vague timing
- "bounces off these levels" - not specific enough
- Assumes reader knows what "institutional support" means

**UPGRADED:**
```
what_to_watch_next:
"Every Friday, check iShares.com and Grayscale.com for the week's
Bitcoin ETF flows.

- If weekly inflows exceed $200M while Bitcoin stays above $82K,
  it means big institutional buyers believe the price is bottoming
  (good sign for holders).

- If Bitcoin bounces off $78K-$80K THREE TIMES in a week with positive
  flows, it signals a strong support level that institutions will defend
  (price likely won't fall below this).

- If flows turn negative again even as price rises, it means even a
  price bounce isn't convincing institutions—more selling could come."
```

---

### Example 3: FOMC Minutes (Group 7)

**CURRENT:**
```
what_happened:
"December FOMC minutes show the Fed is worried short-term funding
could seize up"

why_it_matters_now:
"Fed officials were focused less on rate moves and more on whether
the financial system has enough cash to avoid sudden disruptions."

what_to_watch_next:
"Monitor for follow-up developments and market reaction. Watch for
official statements and analyst commentary."
```

**CRITICAL ISSUES:**
- "what_happened" is literally the headline
- "why_it_matters_now" just restates fed focus, doesn't show impact
- "what_to_watch_next" is completely useless (vague hand-waving)

**UPGRADED:**
```
what_happened:
"The Federal Reserve's December 2025 meeting minutes revealed that
officials are now worried about liquidity (how easy it is to get cash)
in overnight funding markets. Specifically, they noted that repo rates
(overnight borrowing) spiked unexpectedly in late 2025, and some banks
had trouble accessing short-term cash. This marks a shift: the Fed is
no longer focused mainly on inflation, but on whether banks have enough
cash to operate normally."

why_it_matters_now:
"What changed: The Fed's worry switched from 'Is the economy overheating?'
to 'Do we have a cash crisis?' This is important because when the Fed
worries about cash, they act differently.

If inflation stays high, the Fed can ignore it if funding markets stress.
But if funding markets stress, the Fed will cut rates or inject cash
IMMEDIATELY, even if inflation is still a problem.

For your portfolio: This creates a new source of volatility.
Markets might spike down suddenly on funding news, regardless of good
economic data. It's a different kind of risk than we've been watching."

what_to_watch_next:
"1) Federal Reserve Bank of New York publishes daily repo rates
(search 'SOFR rates'). If overnight repo exceeds 6% for more than
2 days in a row, it signals liquidity tightening is accelerating.

2) Watch the Fed's 'Reverse Repo Facility' balance (published daily
on the Fed's website). If it exceeds $800 billion, it means banks
are desperately parking cash with the Fed instead of in markets—a
sign of stress.

3) Listen to Powell's next speech (expected late January). If he says
'liquidity is stabilizing,' the crisis is under control. If he says
'liquidity remains fragile,' more trouble could come."
```

---

## Summary of Gaps

| Field | Gap | Fix |
|-------|-----|-----|
| **what_to_watch_next** | Too vague, missing "because" clause | Add explicit signals with timing and meaning |
| **why_it_matters_now** | Too short, generic, doesn't show second-order effects | Expand to show HOW life changes |
| **who_this_applies_to** | "All market participants" cop-out | List specific people: "If you own X, or hold Y fund, then..." |
| **Plain language** | Jargon creeps in, sentences too long | Define every term, break up long sentences |
| **what_happened** | Sometimes just repeats headline | Expand with specific facts, numbers, context |

---

## Upgrade Priority

**CRITICAL (Rewrite Now):**
- Group 7 (FOMC) - what_to_watch_next is unusable
- Group 2 (Oil) - too generic
- Any group with "Monitor for developments"

**HIGH (Upgrade):**
- Groups 15, 23 (Bitcoin) - duplicate/generic text
- Any group with vague signals
- Groups where why_it_matters_now is under 150 words

**MEDIUM (Enhance):**
- All groups: Add more specific "who_this_applies_to"
- All groups: Tighten plain language

---

## Next Steps

1. Create stricter template that enforces format
2. Rewrite top 15 explanations to model the standard
3. Create validation script to catch future violations
4. Document permanent standard
