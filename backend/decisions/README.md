# Decisions

This folder contains the **"brain" of the app** - the logic that decides what news matters and why.

## What This Is

Think of this as the intelligence layer. Each file answers one simple question:
- Is this news important?
- Does this change anything for the user?
- Should the user see this?
- What should the user do about it?

## What's In Here

- **`guardrails.js`** - Safety rules that prevent bad advice
  - Blocks words like "buy" or "sell"
  - Ensures actions are from a safe list
  - Downgrades signals that contain advice language

## How Decisions Work

1. **Input**: Raw news article or text
2. **Process**: Decision logic analyzes it
3. **Output**: Clean, safe interpretation (Signal)

## Safety First

All decisions go through guardrails to ensure:
- No financial advice is given
- Actions are safe and appropriate
- Verdicts are valid (ignore/aware/act)
- Content is cleaned of problematic language

## Why This Exists

Users need to understand news, but we can't give financial advice. This folder ensures every interpretation is:
- **Helpful** - Explains what matters
- **Safe** - Never tells users what to do with their money
- **Clear** - Uses simple language

## Future Decisions

As the app grows, we might add:
- `decideRelevance.js` - Is this relevant to the user?
- `decideMeaning.js` - What does this news actually mean?
- `decideImpact.js` - How big is the impact?
- `adjustForUser.js` - How does this relate to user's holdings?
- `decideSurface.js` - Should this appear in the feed?

These would break down the decision-making into smaller, clearer pieces.



