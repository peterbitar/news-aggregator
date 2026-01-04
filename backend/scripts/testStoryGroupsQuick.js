#!/usr/bin/env node
/**
 * Quick test script for story groups with new prompts
 * - Clears all existing story groups and explanations
 * - Runs clustering
 * - Creates story groups
 * - Generates explanations for only the first 5 groups (fast test)
 * Usage: node backend/scripts/testStoryGroupsQuick.js
 */

require('dotenv').config();
const { getDatabase } = require('../data/db');
const {
  createStoryGroup,
  createStoryGroupExplanation,
  addArticleToStoryGroup,
  clusterArticlesBySimilarity,
  logArticleDecision
} = require('../data/storyGroupStorage');
const { clusterArticlesByTitleLLM, generateStoryGroupExplanation } = require('../integrations/llmService');

async function testStoryGroupsQuick() {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`\n=== Quick Test: Story Groups with New Prompts ===\n`);

    // Step 0: Clear existing data
    console.log('Step 0: Clearing existing story groups and explanations...');
    db.prepare('DELETE FROM story_groups').run();
    const deletedCount = db.prepare('SELECT changes()').get();
    console.log(`✓ Cleared all story groups and explanations\n`);

    // Step 1: Fetch ranked articles
    console.log('Step 1: Fetching ranked articles...');
    const rankedArticles = db.prepare(`
      SELECT
        url,
        title,
        description,
        source_name,
        event_type,
        impact_score,
        final_rank_score,
        matched_tickers,
        matched_sectors,
        published_at
      FROM articles
      WHERE final_rank_score IS NOT NULL AND final_rank_score > 0
      ORDER BY final_rank_score DESC
      LIMIT 50
    `).all();

    if (rankedArticles.length === 0) {
      console.log('✗ No ranked articles found for today');
      return;
    }

    console.log(`✓ Found ${rankedArticles.length} ranked articles\n`);

    // Step 2: Cluster articles by title using LLM
    console.log('Step 2: Clustering articles by title (LLM analysis)...');
    const clusters = await clusterArticlesByTitleLLM(rankedArticles);
    console.log(`✓ Created ${clusters.length} clusters\n`);

    // Log cluster details
    clusters.slice(0, 5).forEach((cluster, idx) => {
      console.log(`  Cluster ${idx + 1}: ${cluster.length} articles`);
      console.log(`    - Primary: "${cluster[0].title.substring(0, 60)}..."`);
      if (cluster[0].llm_group_summary) {
        console.log(`    - Story: ${cluster[0].llm_group_summary}`);
      }
      if (cluster.length > 1) {
        console.log(`    - Related: ${cluster.slice(1).map(a => `"${a.title.substring(0, 40)}..."`).join(', ')}`);
      }
    });
    if (clusters.length > 5) {
      console.log(`  ... and ${clusters.length - 5} more clusters`);
    }
    console.log();

    // Step 3: Create story groups from clusters
    console.log('Step 3: Creating story groups from clusters...');

    const createdGroups = [];

    for (const cluster of clusters) {
      if (cluster.length === 0) continue;

      const article = cluster[0];
      
      // Extract tickers from matched_tickers
      const tickers = cluster
        .flatMap(a => {
          try {
            return a.matched_tickers ? JSON.parse(a.matched_tickers) : [];
          } catch {
            return [];
          }
        })
        .filter(Boolean);

      // Determine scope and primary ticker
      let scope = 'GLOBAL';
      let primaryTicker = null;

      if (tickers.length > 0) {
        scope = 'TICKER';
        // Use most common ticker
        const tickerCounts = {};
        tickers.forEach(t => {
          tickerCounts[t] = (tickerCounts[t] || 0) + 1;
        });
        primaryTicker = Object.keys(tickerCounts).sort((a, b) => tickerCounts[b] - tickerCounts[a])[0];
      }

      // Determine impact level from impact_score
      let impactLevel = 'High';
      const impactScores = cluster
        .map(a => a.impact_score)
        .filter(score => score !== null && score !== undefined);
      
      if (impactScores.length > 0) {
        const avgImpact = impactScores.reduce((sum, score) => sum + score, 0) / impactScores.length;
        if (avgImpact >= 0.7) impactLevel = 'High';
        else if (avgImpact >= 0.5) impactLevel = 'Moderate';
        else if (avgImpact >= 0.3) impactLevel = 'Low';
        else impactLevel = 'Very Low';
      }

      try {
        const groupId = createStoryGroup(
          scope,
          primaryTicker,
          article.title,
          impactLevel,
          'High',
          'v1.2',
          'v2.1',
          today
        );

        // Add articles to group
        for (const clusterArticle of cluster) {
          const similarity = clusterArticle.similarity_score || 0.85;
          addArticleToStoryGroup(groupId, clusterArticle.url, similarity);
        }

        createdGroups.push({
          id: groupId,
          title: article.title,
          scope,
          ticker: primaryTicker,
          impact: impactLevel,
          cluster
        });

        console.log(`  ✓ Group ${groupId}: [${scope}] ${impactLevel} - "${article.title.substring(0, 50)}..."`);
      } catch (error) {
        console.log(`  ⚠ Could not create group for "${article.title.substring(0, 50)}..." - ${error.message}`);
      }
    }

    console.log(`\n✓ Created ${createdGroups.length} story groups\n`);

    // Step 4: Generate explanations using LLM (ONLY FIRST 5 FOR QUICK TEST)
    console.log('Step 4: Generating explanations with LLM (first 5 groups only for quick test)...');
    const groupsToExplain = createdGroups.slice(0, 5);
    console.log(`  Testing ${groupsToExplain.length} groups with new prompts...\n`);

    for (const group of groupsToExplain) {
      try {
        // Use LLM to generate explanation
        const explanation = await generateStoryGroupExplanation(
          group.cluster,
          group.title,
          group.scope,
          group.ticker,
          group.impact
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
          console.log(`  ✓ Group ${group.id}: LLM explanation generated`);
          
          // Show a preview of the explanation
          const preview = explanation.why_it_happened || explanation.what_happened || '';
          if (preview) {
            const previewText = preview.substring(0, 100).replace(/\n/g, ' ');
            console.log(`    Preview: "${previewText}..."`);
          }
        } else {
          // Fallback to basic explanation
          const article = group.cluster[0];
          createStoryGroupExplanation(
            group.id,
            article.title,
            null, // why_it_happened
            article.description || 'Development reported by ' + article.source_name,
            'Monitor for follow-up developments.',
            'This is informational only and does not constitute investment advice.',
            [article.source_name]
          );
          console.log(`  ⚠ Group ${group.id}: Fallback explanation (LLM failed or not configured)`);
        }
      } catch (error) {
        console.log(`  ⚠ Group ${group.id}: Could not add explanation - ${error.message}`);
      }
    }

    console.log(`\n✓ Generated explanations for ${groupsToExplain.length} groups (using new prompts)\n`);

    // Summary
    console.log(`=== Quick Test Summary ===`);
    console.log(`✓ Cleared all existing data`);
    console.log(`✓ Processed ${rankedArticles.length} ranked articles`);
    console.log(`✓ Clustered articles using LLM (title-based semantic grouping)`);
    console.log(`✓ Created ${createdGroups.length} story groups`);
    console.log(`✓ Generated explanations with new prompts for ${groupsToExplain.length} groups`);
    console.log(`✓ Test complete! Check the first ${groupsToExplain.length} groups to verify new prompt format\n`);

  } catch (error) {
    console.error('\n✗ Error in quick test:', error);
    process.exit(1);
  }
}

testStoryGroupsQuick();
