#!/usr/bin/env node

/**
 * AUDIT: Check all story group explanations against the NEW 6-Part Standard
 *
 * The 6-part structure is:
 * 1. summary
 * 2. whyItMattersForYou
 * 3. whyThisHappened
 * 4. mostLikelyScenarios (JSON array)
 * 5. whatToKeepInMind (array)
 * 6. sources (JSON array with name, type, reason)
 *
 * Old structure (what we're migrating from):
 * - what_happened
 * - why_it_matters_now
 * - who_this_applies_to
 * - what_to_watch_next
 * - what_this_does_not_mean
 * - sources_summary
 *
 * This script:
 * 1. Identifies all story group explanations in the database
 * 2. Checks if they conform to the NEW 6-part structure
 * 3. Identifies gaps and provides migration recommendations
 * 4. Generates a report of what needs to be updated
 */

const { getDatabase } = require("../data/db");

console.log("=== EXPLANATION AUDIT: 6-PART STANDARD ===\n");

const db = getDatabase();

// Check if new columns exist
function columnsExist() {
  try {
    const info = db.prepare(`PRAGMA table_info(story_group_explanations)`).all();
    const columnNames = info.map((col) => col.name);

    const newColumns = [
      "summary",
      "whyItMattersForYou",
      "whyThisHappened",
      "mostLikelyScenarios",
      "whatToKeepInMind",
      "sources",
    ];

    const oldColumns = [
      "what_happened",
      "why_it_matters_now",
      "who_this_applies_to",
      "what_to_watch_next",
      "what_this_does_not_mean",
      "sources_summary",
    ];

    const hasNewColumns = newColumns.filter((col) => columnNames.includes(col));
    const hasOldColumns = oldColumns.filter((col) => columnNames.includes(col));

    return {
      columnNames,
      hasNewColumns,
      hasOldColumns,
      newColumnsCount: hasNewColumns.length,
      oldColumnsCount: hasOldColumns.length,
    };
  } catch (error) {
    console.error("Error checking columns:", error);
    return null;
  }
}

// Get all explanations
function getExplanations() {
  try {
    return db
      .prepare(
        `
      SELECT
        sge.id,
        sg.id as story_group_id,
        sg.group_title,
        sg.scope,
        sg.primary_ticker,
        sg.date_bucket,
        sge.what_happened,
        sge.why_it_matters_now,
        sge.who_this_applies_to,
        sge.what_to_watch_next,
        sge.what_this_does_not_mean,
        sge.sources_summary,
        sge.created_at
      FROM story_group_explanations sge
      JOIN story_groups sg ON sge.story_group_id = sg.id
      ORDER BY sg.date_bucket DESC, sg.created_at DESC
    `
      )
      .all();
  } catch (error) {
    console.error("Error fetching explanations:", error);
    return [];
  }
}

// Analyze explanation for compliance
function analyzeExplanation(exp) {
  const issues = [];
  const warnings = [];

  // Check summary (what_happened)
  if (!exp.what_happened) {
    issues.push("Missing summary (what_happened)");
  } else if (exp.what_happened.length < 50) {
    warnings.push("Summary too short (what_happened < 50 chars)");
  }

  // Check whyItMattersForYou (why_it_matters_now)
  if (!exp.why_it_matters_now) {
    issues.push("Missing whyItMattersForYou (why_it_matters_now)");
  } else if (
    !exp.why_it_matters_now.toLowerCase().includes("does not") &&
    !exp.why_it_matters_now.toLowerCase().includes("don't")
  ) {
    warnings.push("Missing explicit 'who this does NOT affect' statement");
  }

  // Check whyThisHappened (missing - would need data migration)
  if (!exp.why_it_matters_now) {
    issues.push(
      "Missing whyThisHappened section (requires data migration/regeneration)"
    );
  }

  // Check mostLikelyScenarios (missing - would need data migration)
  issues.push("Missing mostLikelyScenarios (requires data migration)");

  // Check whatToKeepInMind (what_to_watch_next converted)
  if (!exp.what_to_watch_next) {
    issues.push("Missing whatToKeepInMind (what_to_watch_next)");
  } else {
    const hasWatch = exp.what_to_watch_next.toLowerCase().includes("watch");
    if (!hasWatch) {
      warnings.push("what_to_watch_next may not have specific signals");
    }
  }

  // Check sources
  if (!exp.sources_summary) {
    issues.push("Missing sources (sources_summary)");
  }

  // Check for 6-part structure indicators
  const allText = [
    exp.what_happened,
    exp.why_it_matters_now,
    exp.who_this_applies_to,
    exp.what_to_watch_next,
    exp.what_this_does_not_mean,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Check for urgency language (FAIL)
  const urgencyWords = [
    "breaking",
    "urgent",
    "critical",
    "must",
    "immediately",
    "emergency",
  ];
  for (const word of urgencyWords) {
    if (allText.includes(word)) {
      issues.push(`Contains urgency language: "${word}"`);
    }
  }

  return { issues, warnings };
}

// Main audit
const columnStatus = columnsExist();

console.log("📋 COLUMN STATUS:");
if (columnStatus) {
  console.log(`  New 6-Part Columns: ${columnStatus.newColumnsCount}/6 present`);
  console.log(
    `  Old Columns: ${columnStatus.oldColumnsCount}/6 present (legacy)`
  );
  if (columnStatus.newColumnsCount === 0) {
    console.log(
      "  ⚠️  Database not yet migrated to new structure. Explanations will be generated with new structure."
    );
  }
} else {
  console.log("  ❌ Error checking column status");
}

const explanations = getExplanations();
console.log(`\n📚 TOTAL EXPLANATIONS: ${explanations.length}\n`);

if (explanations.length === 0) {
  console.log("✅ No explanations found to audit. Database is clean.\n");
} else {
  // Categorize by status
  let passed = 0;
  let warnings_count = 0;
  let failed = 0;

  const issues_map = new Map();
  const by_type = new Map();

  for (const exp of explanations) {
    const { issues, warnings } = analyzeExplanation(exp);

    const story_type = `${exp.scope}${
      exp.primary_ticker ? `-${exp.primary_ticker}` : ""
    }`;
    if (!by_type.has(story_type)) {
      by_type.set(story_type, []);
    }
    by_type.get(story_type).push(exp);

    if (issues.length > 0) {
      failed++;
      for (const issue of issues) {
        if (!issues_map.has(issue)) {
          issues_map.set(issue, 0);
        }
        issues_map.set(issue, issues_map.get(issue) + 1);
      }
    } else if (warnings.length > 0) {
      warnings_count++;
    } else {
      passed++;
    }
  }

  console.log(`✅ PASSED: ${passed}/${explanations.length}`);
  console.log(`⚠️  WARNINGS: ${warnings_count}/${explanations.length}`);
  console.log(`❌ FAILED: ${failed}/${explanations.length}\n`);

  if (issues_map.size > 0) {
    console.log("🔴 COMMON ISSUES:\n");
    const sortedIssues = Array.from(issues_map.entries()).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [issue, count] of sortedIssues) {
      console.log(`  [${count}x] ${issue}`);
    }
  }

  console.log("\n📊 BY STORY TYPE:\n");
  for (const [type, stories] of by_type) {
    const type_issues = stories.filter(
      (s) => analyzeExplanation(s).issues.length > 0
    ).length;
    const type_warnings = stories.filter(
      (s) =>
        analyzeExplanation(s).issues.length === 0 &&
        analyzeExplanation(s).warnings.length > 0
    ).length;
    console.log(
      `  ${type}: ${stories.length} total (${type_issues} issues, ${type_warnings} warnings)`
    );
  }
}

console.log("\n🎯 NEXT STEPS:\n");
console.log("1. ✅ New 6-part structure is implemented in code");
console.log("2. ⏳ Database columns will be added when explanations are regenerated");
console.log(
  "3. 📝 All NEW explanations will automatically use the 6-part structure"
);
console.log("4. 🔄 Existing explanations should be reviewed/regenerated:");
console.log(
  "   - Run: node backend/scripts/rewriteExplanationsStrict.js [date]"
);
console.log("5. ✔️  Validate all explanations with: node scripts/validateExplanations.js\n");
