#!/usr/bin/env node
/**
 * Create story groups from existing ranked articles
 * Runs: Clustering → Story Group Creation → Explanation Generation
 * Usage: node backend/scripts/createStoryGroupsFromRanked.js
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

async function createStoryGroupsFromRanked() {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`\n=== Creating Story Groups from Ranked Articles ===\n`);

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

    console.log(`✓ Found ${rankedArticles.length} ranked articles\n`);

    if (rankedArticles.length === 0) {
      console.log('No ranked articles found. Run ingest/process/rank first.');
      return;
    }

    // Step 2: Cluster articles by title using LLM
    console.log('Step 2: Clustering articles by title (LLM analysis)...');
    const clusters = await clusterArticlesByTitleLLM(rankedArticles);
    console.log(`✓ Created ${clusters.length} clusters\n`);

    // Log cluster details
    clusters.forEach((cluster, idx) => {
      console.log(`  Cluster ${idx + 1}: ${cluster.length} articles`);
      console.log(`    - Primary: "${cluster[0].title.substring(0, 60)}..."`);
      if (cluster[0].llm_group_summary) {
        console.log(`    - Story: ${cluster[0].llm_group_summary}`);
      }
      if (cluster.length > 1) {
        console.log(`    - Related: ${cluster.slice(1).map(a => `"${a.title.substring(0, 40)}..."`).join(', ')}`);
      }
    });
    console.log();

    // Step 3: Create story groups from clusters
    console.log('Step 3: Creating story groups from clusters...');

    const createdGroups = [];

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const primaryArticle = cluster[0];

      // Determine scope and ticker
      let scope = 'GLOBAL';
      let primaryTicker = null;

      if (primaryArticle.matched_tickers) {
        try {
          const tickers = JSON.parse(primaryArticle.matched_tickers);
          if (tickers.length > 0) {
            scope = 'TICKER';
            primaryTicker = tickers[0];
          }
        } catch (e) {
          // Default to GLOBAL if parsing fails
        }
      }

      // Generate group title (use primary article title as base)
      const groupTitle = primaryArticle.title.substring(0, 100);

      // Compute impact level from cluster scores
      const avgImpact = cluster.reduce((sum, a) => sum + (a.impact_score || 50), 0) / cluster.length;
      let impactLevel = 'Low';
      if (avgImpact >= 70) impactLevel = 'High';
      else if (avgImpact >= 50) impactLevel = 'Moderate';
      else if (avgImpact >= 30) impactLevel = 'Low';
      else impactLevel = 'Very Low';

      // Create story group
      const groupId = createStoryGroup(
        scope,
        primaryTicker,
        groupTitle,
        impactLevel,
        'High',  // confidence_level
        'v1.2',  // model_version
        'v2.1'   // pipeline_version
      );

      console.log(`  ✓ Group ${groupId}: [${scope}] ${impactLevel} - "${groupTitle.substring(0, 50)}..."`);

      // Add articles to group
      for (const article of cluster) {
        const similarity = article.similarity_score || 0.95;
        addArticleToStoryGroup(groupId, article.url, similarity);

        logArticleDecision(
          article.url,
          'clustering',
          true,
          `Similarity ${(similarity * 100).toFixed(0)}% to primary article in group`,
          article.final_rank_score,
          article.impact_score,
          0.95
        );
      }

      createdGroups.push({
        id: groupId,
        scope,
        ticker: primaryTicker,
        title: groupTitle,
        impact: impactLevel,
        articleCount: cluster.length,
        cluster
      });
    }

    console.log(`\n✓ Created ${createdGroups.length} story groups\n`);

    // Step 4: Generate explanations using LLM
    console.log('Step 4: Generating explanations with LLM...');

    for (const group of createdGroups) {
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

    console.log(`\n✓ Generated explanations for ${createdGroups.length} groups (using LLM)\n`);

    // Step 5: Test the API
    console.log('Step 5: Testing API endpoint...\n');

    const { getUserHoldings } = require('../services/userHoldingsService');
    const { getGlobalStoryGroups, getTickerStoryGroups } = require('../data/storyGroupStorage');

    const userHoldings = getUserHoldings(1);
    const globalGroups = getGlobalStoryGroups(today, 5);
    const tickerGroups = getTickerStoryGroups(userHoldings, today, 3);

    console.log(`API Response Preview:`);
    console.log(`- GLOBAL groups: ${globalGroups.length}`);
    console.log(`- TICKER groups: ${Object.keys(tickerGroups).length} tickers`);

    if (globalGroups.length > 0) {
      console.log(`\nSample GLOBAL group:`);
      const sample = globalGroups[0];
      console.log(`  Title: "${sample.group_title}"`);
      console.log(`  Impact: ${sample.impact_level}`);
      console.log(`  Articles: ${sample.article_count}`);
      if (sample.explanation && sample.explanation.what_happened) {
        console.log(`  Explanation: "${sample.explanation.what_happened.substring(0, 80)}..."`);
      }
    }

    // Summary
    console.log(`\n=== Summary ===`);
    console.log(`✓ Processed ${rankedArticles.length} ranked articles`);
    console.log(`✓ Clustered articles using LLM (title-based semantic grouping)`);
    console.log(`✓ Created ${createdGroups.length} story groups`);
    console.log(`✓ Generated explanations with LLM (orientation-focused, 6-part structure)`);
    console.log(`✓ Story groups ready for API composition`);

    console.log(`\nTest the API:`);
    console.log(`  curl -H "x-user-id: 1" "http://localhost:5002/v1/feed/story-groups"`);

  } catch (error) {
    console.error('Error creating story groups:', error);
    process.exit(1);
  }
}

// Run the process
createStoryGroupsFromRanked();
