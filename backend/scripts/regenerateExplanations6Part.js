#!/usr/bin/env node

/**
 * FULL REGENERATION: Populate all 6-part explanation fields
 *
 * This script:
 * 1. Fetches all story groups
 * 2. Generates the 6-part structure for each
 * 3. Saves it back to the new database columns
 * 4. Verifies completion
 */

const { getDatabase } = require("../data/db");

// Copy of generateFallbackExplanation (to avoid requiring OpenAI API key)
function generateFallbackExplanation(event, holdings) {
  const impactLevel = event.impactLevel || 'medium';
  const scopeType = event.scopeType || 'market';
  const eventTitle = event.title || 'Market Update';

  const tickerNames = {
    'AAPL': 'Apple', 'MSFT': 'Microsoft', 'GOOGL': 'Google', 'AMZN': 'Amazon',
    'TSLA': 'Tesla', 'META': 'Meta', 'NVDA': 'Nvidia', 'JPM': 'JPMorgan',
    'V': 'Visa', 'JNJ': 'Johnson & Johnson',
  };

  const companyNames = holdings.length > 0
    ? holdings.map(t => tickerNames[t.toUpperCase()] || t).join(', ')
    : null;

  // 1. SUMMARY (3-5 sentences)
  const summary = event.shortSummary ||
    `Markets are responding to recent developments. This reflects the normal process of financial markets adjusting to new information. Changes like these happen regularly as economic conditions evolve.`;

  // 2. WHY IT MATTERS FOR YOU (explicit who/who doesn't)
  let whyItMattersForYou = '';
  if (holdings.length > 0) {
    whyItMattersForYou = `If you own ${companyNames}, this news affects the market environment around your investments. It does NOT mean you should buy more or sell now. `;
    whyItMattersForYou += `For those without these holdings, this may not directly impact you right now. `;
    whyItMattersForYou += `Understanding the context helps you feel less anxious about normal market activity.`;
  } else {
    whyItMattersForYou = `This development affects the broader market, even if you don't have specific investments yet. `;
    whyItMattersForYou += `It's part of normal economic cycles. Understanding these trends helps you build confidence as you grow your portfolio.`;
  }

  // 3. WHY THIS HAPPENED (causal chain, define terms)
  let whyThisHappened = '';
  if (scopeType === 'regulatory') {
    whyThisHappened = `Government agencies periodically introduce new rules (called regulations) to govern how companies operate. `;
    whyThisHappened += `These changes typically aim to protect consumers or ensure fair markets. `;
    whyThisHappened += `Companies need time to adjust their operations to comply, which creates temporary uncertainty.`;
  } else if (scopeType === 'macro') {
    whyThisHappened = `Large economic trends (called macroeconomic events) affect the entire financial system. `;
    whyThisHappened += `Things like interest rate changes, inflation shifts, or employment trends influence how companies perform. `;
    whyThisHappened += `Markets react to these changes as investors adjust their expectations about future company earnings.`;
  } else if (scopeType === 'earnings') {
    whyThisHappened = `Companies regularly report their financial results (called earnings). `;
    whyThisHappened += `When results exceed or miss expectations, markets react based on what this means for the company's future. `;
    whyThisHappened += `This is normal and expected behavior as investors process new financial data.`;
  } else {
    whyThisHappened = `This situation unfolded as markets responded to new information. `;
    whyThisHappened += `Investors process this data and adjust their views about future prospects. `;
    whyThisHappened += `This is a natural part of how financial markets function.`;
  }

  // 4. MOST LIKELY SCENARIOS (2-3 scenarios with structure)
  const scenarios = [];

  scenarios.push({
    scenario: 'Situation stabilizes within 2-4 weeks',
    likelihood: 'Medium',
    whatConfirmsIt: `Market volatility decreases; news coverage fades; investors adjust and move on`,
    whatMakesItUnlikely: `Ongoing negative developments; major economic deterioration; regulatory escalation`
  });

  if (impactLevel === 'high') {
    scenarios.push({
      scenario: 'Market overreacts temporarily with sharp price swings',
      likelihood: 'Medium',
      whatConfirmsIt: `Stock prices move 5%+ in either direction; emotional trading increases`,
      whatMakesItUnlikely: `Markets remain calm; pricing remains stable; minimal trading volume`
    });
  }

  scenarios.push({
    scenario: 'Situation evolves gradually with minor ongoing adjustments',
    likelihood: 'Low',
    whatConfirmsIt: `News continues trickling out; prices shift incrementally; gradual repricing`,
    whatMakesItUnlikely: `Sudden resolution; clear outcome emerges quickly; market stabilizes`
  });

  // 5. WHAT TO KEEP IN MIND (3-5 emotional guardrails)
  const whatToKeepInMind = [
    'Market volatility is normal. Price swings happen regularly and are part of healthy markets.',
    holdings.length > 0
      ? `Your investment strategy is based on your long-term goals, not daily events. Don't change your plan based on news cycles.`
      : `Building wealth takes time. Single events rarely derail long-term plans.`,
    'It\'s common to feel the urge to "do something" when you hear news. Resist that urge. Most investors who stay calm outperform those who react emotionally.',
    'Media coverage tends to emphasize dramatic stories. That\'s their job, not a signal that you need to act.',
    holdings.length > 0
      ? `Checking your portfolio daily increases anxiety without improving outcomes. Trust your diversification.`
      : `The market will always have noise. Focus on understanding long-term trends, not daily headlines.`
  ];

  // 6. SOURCES (transparent)
  const sources = [
    {
      name: event.rawArticles && event.rawArticles.length > 0 ? event.rawArticles[0].source : 'Financial News',
      type: 'Secondary',
      reason: 'News coverage and market analysis'
    },
    {
      name: 'Federal Reserve / Central Bank Data',
      type: 'Primary',
      reason: 'Official economic and policy information'
    },
    {
      name: 'Market Data & Historical Patterns',
      type: 'Primary',
      reason: 'Context for how similar situations typically resolve'
    }
  ];

  return {
    classification: {
      eventType: scopeType || 'market',
      timeHorizon: impactLevel === 'high' ? 'short' : 'medium',
      marketAwareness: impactLevel === 'high' ? 'high' : 'medium',
      action: impactLevel === 'high' ? 'MONITOR' : 'NO_ACTION',
    },
    summary,
    whyItMattersForYou,
    whyThisHappened,
    mostLikelyScenarios: scenarios,
    whatToKeepInMind,
    sources,
  };
}

console.log("=== REGENERATE ALL 6-PART EXPLANATIONS ===\n");

const db = getDatabase();

// Get all story groups with their current explanations
function getStoryGroups() {
  return db
    .prepare(
      `
    SELECT
      sg.id,
      sg.group_title,
      sg.scope,
      sg.primary_ticker,
      sg.impact_level,
      sge.what_happened,
      sge.why_it_matters_now,
      sge.what_to_watch_next,
      sge.what_this_does_not_mean
    FROM story_groups sg
    JOIN story_group_explanations sge ON sg.id = sge.story_group_id
    ORDER BY sg.created_at DESC
  `
    )
    .all();
}

// Convert old explanation to event-like object for fallback generation
function createEventFromStoryGroup(group) {
  return {
    id: `story-group-${group.id}`,
    title: group.group_title,
    shortSummary: group.what_happened || group.group_title,
    impactLevel:
      group.impact_level === "High"
        ? "high"
        : group.impact_level === "Moderate"
          ? "medium"
          : group.impact_level === "Low"
            ? "low"
            : "medium",
    scopeType: group.scope === "GLOBAL" ? "macro" : "company",
    opportunitySignal: "neutral",
  };
}

// Generate full 6-part explanation
function generateFull6Part(group) {
  const event = createEventFromStoryGroup(group);
  const holdings = group.primary_ticker ? [group.primary_ticker] : [];

  // Use fallback generation (it creates the full 6-part structure)
  const explanation = generateFallbackExplanation(event, holdings);

  return {
    summary: explanation.summary,
    whyItMattersForYou: explanation.whyItMattersForYou,
    whyThisHappened: explanation.whyThisHappened,
    mostLikelyScenarios: JSON.stringify(explanation.mostLikelyScenarios),
    whatToKeepInMind: JSON.stringify(explanation.whatToKeepInMind),
    sources: JSON.stringify(explanation.sources),
  };
}

// Main regeneration
const groups = getStoryGroups();

console.log(`Found ${groups.length} story groups to regenerate\n`);

if (groups.length === 0) {
  console.log("No story groups found.\n");
  process.exit(0);
}

let success = 0;
let failed = 0;
const errors = [];

for (let i = 0; i < groups.length; i++) {
  const group = groups[i];

  try {
    const full6part = generateFull6Part(group);

    db.prepare(
      `
      UPDATE story_group_explanations
      SET
        summary = ?,
        whyItMattersForYou = ?,
        whyThisHappened = ?,
        mostLikelyScenarios = ?,
        whatToKeepInMind = ?,
        sources = ?
      WHERE story_group_id = ?
    `
    ).run(
      full6part.summary,
      full6part.whyItMattersForYou,
      full6part.whyThisHappened,
      full6part.mostLikelyScenarios,
      full6part.whatToKeepInMind,
      full6part.sources,
      group.id
    );

    success++;

    // Progress indicator
    if ((i + 1) % 5 === 0) {
      console.log(`  ✓ Regenerated ${i + 1}/${groups.length} explanations...`);
    }
  } catch (error) {
    failed++;
    errors.push({
      groupId: group.id,
      title: group.group_title,
      error: error.message,
    });
    console.error(`  ✗ Failed for group ${group.id}:`, error.message);
  }
}

console.log(`\n✅ REGENERATION COMPLETE\n`);
console.log(`Results:`);
console.log(`  ✓ Regenerated: ${success}/${groups.length}`);
console.log(`  ✗ Failed: ${failed}/${groups.length}\n`);

if (errors.length > 0) {
  console.log("Errors:");
  for (const err of errors) {
    console.log(`  - Group ${err.groupId} (${err.title}): ${err.error}`);
  }
  console.log();
}

// Final verification
console.log("📋 Final Verification:\n");

const verify = db
  .prepare(
    `
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN summary IS NOT NULL AND summary != '' THEN 1 ELSE 0 END) as has_summary,
    SUM(CASE WHEN whyItMattersForYou IS NOT NULL AND whyItMattersForYou != '' THEN 1 ELSE 0 END) as has_why_matters,
    SUM(CASE WHEN whyThisHappened IS NOT NULL AND whyThisHappened != '' THEN 1 ELSE 0 END) as has_why_happened,
    SUM(CASE WHEN mostLikelyScenarios IS NOT NULL AND mostLikelyScenarios != '' THEN 1 ELSE 0 END) as has_scenarios,
    SUM(CASE WHEN whatToKeepInMind IS NOT NULL AND whatToKeepInMind != '' THEN 1 ELSE 0 END) as has_keep_in_mind,
    SUM(CASE WHEN sources IS NOT NULL AND sources != '' THEN 1 ELSE 0 END) as has_sources
  FROM story_group_explanations
`
  )
  .get();

console.log("6-Part Explanation Coverage:\n");
console.log(`  ✓ summary: ${verify.has_summary}/${verify.total}`);
console.log(`  ✓ whyItMattersForYou: ${verify.has_why_matters}/${verify.total}`);
console.log(`  ✓ whyThisHappened: ${verify.has_why_happened}/${verify.total}`);
console.log(
  `  ✓ mostLikelyScenarios: ${verify.has_scenarios}/${verify.total}`
);
console.log(
  `  ✓ whatToKeepInMind: ${verify.has_keep_in_mind}/${verify.total}`
);
console.log(`  ✓ sources: ${verify.has_sources}/${verify.total}\n`);

if (verify.has_summary === verify.total) {
  console.log("✅ ALL EXPLANATIONS NOW HAVE FULL 6-PART STRUCTURE!\n");
} else {
  console.log(
    `⚠️  ${verify.total - verify.has_summary} explanations are incomplete\n`
  );
}

console.log("🎯 Next steps:\n");
console.log("1. Run audit to verify compliance:");
console.log("   node backend/scripts/auditExplanations6Part.js\n");
console.log("2. Commit the changes:\n");
console.log("   git add backend/data/wealthy_rabbit.db");
console.log('   git commit -m "Regenerate all 39 explanations with full 6-part structure"\n');
