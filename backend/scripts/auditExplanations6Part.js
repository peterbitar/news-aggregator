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
        sge.summary,
        sge.whyItMattersForYou,
        sge.whyThisHappened,
        sge.mostLikelyScenarios,
        sge.whatToKeepInMind,
        sge.sources,
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

  // Check all 6 parts are present
  if (!exp.summary || exp.summary.trim() === "") {
    issues.push("Missing summary");
  } else if (exp.summary.length < 50) {
    warnings.push("Summary too short (< 50 chars)");
  }

  if (!exp.whyItMattersForYou || exp.whyItMattersForYou.trim() === "") {
    issues.push("Missing whyItMattersForYou");
  } else if (
    !exp.whyItMattersForYou.toLowerCase().includes("does not") &&
    !exp.whyItMattersForYou.toLowerCase().includes("don't") &&
    !exp.whyItMattersForYou.toLowerCase().includes("does not")
  ) {
    warnings.push("Missing explicit 'who this does NOT affect' statement");
  }

  if (!exp.whyThisHappened || exp.whyThisHappened.trim() === "") {
    issues.push("Missing whyThisHappened");
  }

  if (!exp.mostLikelyScenarios || exp.mostLikelyScenarios.trim() === "") {
    issues.push("Missing mostLikelyScenarios");
  } else {
    try {
      const scenarios = JSON.parse(exp.mostLikelyScenarios);
      if (!Array.isArray(scenarios) || scenarios.length < 2 || scenarios.length > 3) {
        issues.push(
          `mostLikelyScenarios has invalid count (${
            Array.isArray(scenarios) ? scenarios.length : "not array"
          }, expected 2-3)`
        );
      }
    } catch (e) {
      issues.push("mostLikelyScenarios is not valid JSON");
    }
  }

  if (!exp.whatToKeepInMind || exp.whatToKeepInMind.trim() === "") {
    issues.push("Missing whatToKeepInMind");
  } else {
    try {
      const items = JSON.parse(exp.whatToKeepInMind);
      if (!Array.isArray(items) || items.length < 3 || items.length > 5) {
        warnings.push(
          `whatToKeepInMind has ${
            Array.isArray(items) ? items.length : "invalid"
          } items (expected 3-5)`
        );
      }
    } catch (e) {
      issues.push("whatToKeepInMind is not valid JSON");
    }
  }

  if (!exp.sources || exp.sources.trim() === "") {
    issues.push("Missing sources");
  } else {
    try {
      const sources = JSON.parse(exp.sources);
      if (!Array.isArray(sources) || sources.length === 0) {
        issues.push(
          `sources invalid (${
            Array.isArray(sources) ? "empty array" : "not array"
          })`
        );
      }
    } catch (e) {
      issues.push("sources is not valid JSON");
    }
  }

  // Check for urgency language (FAIL)
  const allText = [
    exp.summary,
    exp.whyItMattersForYou,
    exp.whyThisHappened,
    exp.whatToKeepInMind,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

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
