#!/usr/bin/env node

/**
 * DATABASE MIGRATION: Add 6-Part Explanation Structure to story_group_explanations
 *
 * This migration:
 * 1. Adds new columns for the 6-part structure
 * 2. Populates them from the old columns (interim solution)
 * 3. Verifies the migration
 */

const { getDatabase } = require("../data/db");

console.log("=== MIGRATION: Add 6-Part Explanation Columns ===\n");

const db = getDatabase();

// Helper to check if column exists
function columnExists(tableName, columnName) {
  try {
    const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return info.some((col) => col.name === columnName);
  } catch (error) {
    return false;
  }
}

// Helper to add column
function addColumn(tableName, columnName, columnDef) {
  if (!columnExists(tableName, columnName)) {
    try {
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run();
      console.log(`✓ Added column: ${columnName}`);
      return true;
    } catch (error) {
      console.error(`✗ Failed to add column ${columnName}:`, error.message);
      return false;
    }
  } else {
    console.log(`✓ Column already exists: ${columnName}`);
    return true;
  }
}

// Step 1: Add new columns
console.log("📝 Step 1: Adding new 6-part columns...\n");

const newColumns = [
  { name: "summary", def: "TEXT" },
  { name: "whyItMattersForYou", def: "TEXT" },
  { name: "whyThisHappened", def: "TEXT" },
  { name: "mostLikelyScenarios", def: "JSON" },
  { name: "whatToKeepInMind", def: "JSON" },
  { name: "sources", def: "JSON" },
];

let added = 0;
for (const col of newColumns) {
  if (addColumn("story_group_explanations", col.name, col.def)) {
    added++;
  }
}

console.log(`\n✓ Added ${added}/${newColumns.length} columns\n`);

// Step 2: Verify schema
console.log("📋 Step 2: Verifying new schema...\n");

const info = db.prepare(`PRAGMA table_info(story_group_explanations)`).all();
const columnNames = info.map((col) => col.name);

console.log("Current columns in story_group_explanations:");
for (const col of info) {
  const isNew = newColumns.some((nc) => nc.name === col.name);
  const marker = isNew ? "🆕" : "📦";
  console.log(`  ${marker} ${col.name} (${col.type})`);
}

// Step 3: Populate new columns from old columns (interim solution)
console.log("\n📊 Step 3: Populating new columns from old content...\n");

try {
  // For now, map old columns to new columns:
  // summary = what_happened (truncated to 3 sentences)
  // whyItMattersForYou = why_it_matters_now
  // whyThisHappened = (will be empty - should regenerate)
  // mostLikelyScenarios = (will be empty - should regenerate)
  // whatToKeepInMind = what_this_does_not_mean (as array)
  // sources = sources_summary (as JSON array)

  const updates = db.prepare(`
    SELECT id, what_happened, why_it_matters_now, what_this_does_not_mean, sources_summary
    FROM story_group_explanations
    WHERE summary IS NULL
    LIMIT 1000
  `).all();

  console.log(`Found ${updates.length} explanations to populate...\n`);

  for (const exp of updates) {
    // Extract first 3 sentences for summary
    const summary = exp.what_happened
      ? exp.what_happened.split(".").slice(0, 3).join(".").trim() + "."
      : "";

    // whyItMattersForYou from why_it_matters_now
    const whyItMattersForYou = exp.why_it_matters_now || "";

    // whatToKeepInMind from what_this_does_not_mean as array
    const whatToKeepInMind = exp.what_this_does_not_mean
      ? [exp.what_this_does_not_mean]
      : [];

    // sources from sources_summary (parse if possible)
    const sources = [];
    if (exp.sources_summary) {
      // Try to parse as sources
      const sourceParts = exp.sources_summary.split(",").map((s) => s.trim());
      for (const source of sourceParts) {
        if (source) {
          sources.push({
            name: source,
            type: "Secondary",
            reason: "Financial news and analysis",
          });
        }
      }
    }

    db.prepare(`
      UPDATE story_group_explanations
      SET
        summary = ?,
        whyItMattersForYou = ?,
        whatToKeepInMind = ?,
        sources = ?
      WHERE id = ?
    `).run(
      summary,
      whyItMattersForYou,
      JSON.stringify(whatToKeepInMind),
      JSON.stringify(sources),
      exp.id
    );
  }

  console.log(`✓ Populated ${updates.length} explanations\n`);
} catch (error) {
  console.error("✗ Error populating columns:", error.message);
}

// Step 4: Verify population
console.log("✔️ Step 4: Verifying population...\n");

const populated = db
  .prepare(
    `
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) as has_summary,
    SUM(CASE WHEN whyItMattersForYou IS NOT NULL THEN 1 ELSE 0 END) as has_why_matters,
    SUM(CASE WHEN mostLikelyScenarios IS NOT NULL THEN 1 ELSE 0 END) as has_scenarios,
    SUM(CASE WHEN whatToKeepInMind IS NOT NULL THEN 1 ELSE 0 END) as has_keep_in_mind,
    SUM(CASE WHEN sources IS NOT NULL THEN 1 ELSE 0 END) as has_sources
  FROM story_group_explanations
`
  )
  .get();

console.log("6-Part Explanation Population Status:\n");
console.log(`  Total explanations: ${populated.total}`);
console.log(`  ✓ summary: ${populated.has_summary}/${populated.total}`);
console.log(`  ✓ whyItMattersForYou: ${populated.has_why_matters}/${populated.total}`);
console.log(
  `  ⏳ whyThisHappened: 0/${populated.total} (requires regeneration)`
);
console.log(
  `  ⏳ mostLikelyScenarios: ${populated.has_scenarios}/${populated.total} (requires regeneration)`
);
console.log(
  `  ✓ whatToKeepInMind: ${populated.has_keep_in_mind}/${populated.total}`
);
console.log(`  ✓ sources: ${populated.has_sources}/${populated.total}\n`);

console.log("✅ Migration complete!\n");
console.log("📝 IMPORTANT NEXT STEPS:\n");
console.log("1. The 6-part columns are now in the database");
console.log("2. Some fields are populated from old columns:");
console.log("   ✓ summary (from what_happened)");
console.log("   ✓ whyItMattersForYou (from why_it_matters_now)");
console.log("   ✓ whatToKeepInMind (from what_this_does_not_mean)");
console.log("   ✓ sources (from sources_summary)");
console.log("\n3. Missing fields that need regeneration:");
console.log("   ⏳ whyThisHappened (causal chain)");
console.log("   ⏳ mostLikelyScenarios (2-3 bounded paths)\n");
console.log("4. To fully complete the migration, regenerate explanations:");
console.log("   node backend/scripts/rewriteExplanationsStrict.js --all\n");
