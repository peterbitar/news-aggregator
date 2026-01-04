#!/usr/bin/env node
/**
 * Complete story group explanations for groups that don't have them yet
 * Usage: node backend/scripts/completeStoryGroupExplanations.js
 */

require('dotenv').config();
const { getDatabase } = require('../data/db');
const {
  createStoryGroupExplanation,
} = require('../data/storyGroupStorage');
const { generateStoryGroupExplanation } = require('../integrations/llmService');

async function completeExplanations() {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    console.log(`\n=== Completing Story Group Explanations ===\n`);

    // Find story groups without complete explanations
    const incompleteGroups = db.prepare(`
      SELECT 
        sg.id,
        sg.group_title,
        sg.scope,
        sg.primary_ticker,
        sg.impact_level,
        CASE WHEN sge.why_it_happened IS NULL OR sge.why_it_happened = '' THEN 1 ELSE 0 END as needs_explanation
      FROM story_groups sg
      LEFT JOIN story_group_explanations sge ON sg.id = sge.story_group_id
      WHERE sg.date_bucket = ?
        AND (sge.why_it_happened IS NULL OR sge.why_it_happened = '')
      ORDER BY sg.id
    `).all(today);

    if (incompleteGroups.length === 0) {
      console.log('✓ All story groups already have complete explanations!\n');
      return;
    }

    console.log(`Found ${incompleteGroups.length} groups needing explanations\n`);

    for (const group of incompleteGroups) {
      try {
        // Get articles for this story group
        const articles = db.prepare(`
          SELECT 
            a.url,
            a.title,
            a.description,
            a.source_name,
            a.published_at
          FROM articles a
          JOIN story_group_articles sga ON a.url = sga.article_id
          WHERE sga.story_group_id = ?
          ORDER BY a.published_at DESC
        `).all(group.id);

        if (articles.length === 0) {
          console.log(`  ⚠ Group ${group.id}: No articles found, skipping`);
          continue;
        }

        console.log(`  Processing Group ${group.id}: "${group.group_title.substring(0, 60)}..." (${articles.length} articles)`);

        // Generate LLM explanation
        const explanation = await generateStoryGroupExplanation(
          articles,
          group.group_title,
          group.scope,
          group.primary_ticker,
          group.impact_level
        );

        if (explanation) {
          createStoryGroupExplanation(
            group.id,
            explanation.what_happened,
            explanation.why_it_happened,
            explanation.why_it_matters_now,
            explanation.what_to_watch_next,
            explanation.what_this_does_not_mean,
            explanation.sources_summary,
            explanation.cause_confidence,
            explanation.cause_reason
          );
          console.log(`    ✓ LLM explanation generated`);
        } else {
          // Fallback
          const article = articles[0];
          createStoryGroupExplanation(
            group.id,
            article.title,
            null,
            article.description || 'Development reported by ' + article.source_name,
            'Monitor for follow-up developments.',
            'This is informational only and does not constitute investment advice.',
            [article.source_name]
          );
          console.log(`    ⚠ Fallback explanation (LLM failed)`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.log(`    ⚠ Error: ${error.message}`);
      }
    }

    console.log(`\n✓ Completed explanations for ${incompleteGroups.length} groups\n`);

  } catch (error) {
    console.error('Error completing explanations:', error);
    process.exit(1);
  }
}

completeExplanations();
