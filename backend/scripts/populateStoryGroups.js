#!/usr/bin/env node
/**
 * Test script to populate story groups with example data
 * Usage: node backend/scripts/populateStoryGroups.js
 */

const { getDatabase } = require('../data/db');
const {
  createStoryGroup,
  createStoryGroupExplanation,
  addArticleToStoryGroup,
  addRelatedTickerToStoryGroup,
  logArticleDecision
} = require('../data/storyGroupStorage');

function populateStoryGroups() {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`\n=== Populating Story Groups for ${today} ===\n`);

    // First, ensure we have some test articles
    console.log('Creating test articles...');
    const testArticles = [
      {
        url: 'https://example.com/fed-rate-decision',
        title: 'Federal Reserve holds rates steady at 4.0-4.25%',
        description: 'Fed maintained benchmark rate amid mixed inflation signals',
        source_name: 'Reuters'
      },
      {
        url: 'https://example.com/fed-rate-analysis',
        title: 'What Fed rate hold means for 2026',
        description: 'Market implications and rate outlook analysis',
        source_name: 'Bloomberg'
      },
      {
        url: 'https://example.com/fed-speaker',
        title: 'Fed Chair comments on inflation trends',
        description: 'Latest remarks from Federal Reserve leadership',
        source_name: 'MarketWatch'
      },
      {
        url: 'https://example.com/oil-supply',
        title: 'Oil climbs 3% on Middle East supply concerns',
        description: 'WTI crude rises amid geopolitical tensions',
        source_name: 'Bloomberg'
      },
      {
        url: 'https://example.com/aapl-earnings',
        title: 'Apple beats earnings expectations, maintains margins',
        description: 'AAPL reports strong Q1 FY2026 results',
        source_name: 'Seeking Alpha'
      },
      {
        url: 'https://example.com/aapl-guidance',
        title: 'AAPL provides 2026 guidance amid AI investments',
        description: 'Apple outlines strategy for upcoming fiscal year',
        source_name: 'The Motley Fool'
      },
      {
        url: 'https://example.com/nvda-export-controls',
        title: 'NVDA faces new export restrictions to China',
        description: 'Advanced chip exports limited effective Q2 2026',
        source_name: 'Reuters'
      },
      {
        url: 'https://example.com/nvda-revenue-impact',
        title: 'NVDA revises China revenue forecast downward',
        description: 'Company updates guidance due to regulatory changes',
        source_name: 'WSJ'
      }
    ];

    // Insert test articles
    const insertArticle = db.prepare(`
      INSERT OR IGNORE INTO articles (url, source_name, title, description, published_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const article of testArticles) {
      insertArticle.run(article.url, article.source_name, article.title, article.description, now, now);
    }
    console.log(`✓ Created/verified ${testArticles.length} test articles\n`);

    // === GLOBAL GROUP 1: Fed Rate Decision ===
    console.log('Creating GLOBAL group 1: Fed Rate Decision...');
    const globalGroup1Id = createStoryGroup(
      'GLOBAL',
      null,
      'Fed maintains rates at 4.0–4.25%; inflation data watched',
      'Moderate',
      'High',
      'v1.2',
      'v2.1'
    );

    createStoryGroupExplanation(
      globalGroup1Id,
      'Federal Reserve held the benchmark interest rate at 4.0–4.25% following its December meeting, with no signal of near-term policy change.',
      'With inflation cooling but still above target, focus now shifts to upcoming January CPI data and Fed messaging for 2026. Market pricing may shift post-data.',
      'All investors and savers. Affects yields on savings accounts, bonds, mortgages, and dividend expectations.',
      'Watch CPI print Thursday 10 AM ET; watch Fed speakers this week for inflation commentary.',
      'Does not indicate imminent rate cuts or hikes. Fed remains in data-dependent mode and data can surprise.',
      JSON.stringify(['Reuters', 'Bloomberg', 'Federal Reserve', 'MarketWatch'])
    );

    addArticleToStoryGroup(globalGroup1Id, 'https://example.com/fed-rate-decision', 0.98);
    addArticleToStoryGroup(globalGroup1Id, 'https://example.com/fed-rate-analysis', 0.95);
    addArticleToStoryGroup(globalGroup1Id, 'https://example.com/fed-speaker', 0.91);

    logArticleDecision('https://example.com/fed-rate-decision', 'clustering', true, 'High similarity to Fed decision story; primary article', 0.95, 0.88, 0.96, 'GLOBAL', null);
    logArticleDecision('https://example.com/fed-rate-analysis', 'clustering', true, 'Similarity 0.95 to Fed decision story', 0.85, 0.78, 0.92, 'GLOBAL', null);
    logArticleDecision('https://example.com/fed-speaker', 'clustering', true, 'Similarity 0.91 to Fed decision story', 0.80, 0.72, 0.88, 'GLOBAL', null);

    console.log(`✓ Created global group 1 (ID: ${globalGroup1Id})\n`);

    // === GLOBAL GROUP 2: Oil Supply ===
    console.log('Creating GLOBAL group 2: Oil Supply...');
    const globalGroup2Id = createStoryGroup(
      'GLOBAL',
      null,
      'Oil climbs 3% on Middle East supply concerns',
      'Low',
      'Medium',
      'v1.2',
      'v2.1'
    );

    createStoryGroupExplanation(
      globalGroup2Id,
      'WTI crude oil rose 3% to $78.50/barrel on reports of supply disruptions in a key producing region.',
      'Higher energy costs can feed into inflation expectations and hurt corporate margins in energy-dependent industries.',
      'All equity holders, especially those exposed to energy or transportation. Oil-importing economies.',
      'OPEC+ meeting next week; geopolitical developments in key oil-producing regions; inventory reports.',
      'Does not signal a sustained energy crisis. Short-term supply shocks often reverse within weeks.',
      JSON.stringify(['Bloomberg', 'Reuters', 'Oil Price'])
    );

    addArticleToStoryGroup(globalGroup2Id, 'https://example.com/oil-supply', 0.97);

    logArticleDecision('https://example.com/oil-supply', 'clustering', true, 'Similarity 0.97 to oil supply story; only article in cluster', 0.92, 0.65, 0.94, 'GLOBAL', null);

    console.log(`✓ Created global group 2 (ID: ${globalGroup2Id})\n`);

    // === TICKER GROUP 1: AAPL Earnings ===
    console.log('Creating TICKER group 1: AAPL Earnings...');
    const tickerGroup1Id = createStoryGroup(
      'TICKER',
      'AAPL',
      'AAPL posts strong earnings; margins hold steady',
      'Moderate',
      'High',
      'v1.2',
      'v2.1'
    );

    createStoryGroupExplanation(
      tickerGroup1Id,
      'Apple reported Q1 FY2026 earnings of $2.18/share, beating consensus of $2.05. Gross margin guidance of 47.5% matched expectations, signaling maintained pricing power.',
      'AAPL continues to balance competitive pressure with premium positioning. Margins are closely watched as AI investment could pressure profitability.',
      'Holders of AAPL. Investors with broad tech exposure.',
      'iPhone 18 cycle (launch signals, pre-order strength); Services growth rate; next margin guidance.',
      'Does not guarantee future beats. Macro headwinds, competitive intensity, and geopolitical risks persist.',
      JSON.stringify(['Seeking Alpha', 'MarketWatch', 'The Motley Fool'])
    );

    addArticleToStoryGroup(tickerGroup1Id, 'https://example.com/aapl-earnings', 0.99);
    addArticleToStoryGroup(tickerGroup1Id, 'https://example.com/aapl-guidance', 0.92);
    addRelatedTickerToStoryGroup(tickerGroup1Id, 'MSFT', 'competitor');
    addRelatedTickerToStoryGroup(tickerGroup1Id, 'NVDA', 'related');

    logArticleDecision('https://example.com/aapl-earnings', 'clustering', true, 'High similarity to AAPL earnings story; primary article', 0.99, 0.88, 0.98, 'TICKER', 'AAPL');
    logArticleDecision('https://example.com/aapl-guidance', 'clustering', true, 'Similarity 0.92 to AAPL earnings story', 0.92, 0.85, 0.91, 'TICKER', 'AAPL');

    console.log(`✓ Created ticker group 1 (ID: ${tickerGroup1Id})\n`);

    // === TICKER GROUP 2: NVDA Export Controls ===
    console.log('Creating TICKER group 2: NVDA Export Controls...');
    const tickerGroup2Id = createStoryGroup(
      'TICKER',
      'NVDA',
      'NVDA faces expanded export controls; China revenue capped',
      'High',
      'High',
      'v1.2',
      'v2.1'
    );

    createStoryGroupExplanation(
      tickerGroup2Id,
      'U.S. government announced additional export restrictions on advanced GPU shipments to China, effective Q2 2026. NVDA revised 2026 China revenue forecast down 15%.',
      'China accounted for ~20% of NVDA FY2025 revenue. This limits growth in a key market, though U.S. and allied chip demand remains strong.',
      'NVDA shareholders. Semiconductor and AI infrastructure investors.',
      'Further geopolitical developments; NVDA FY2026 guidance revision; alternative markets (EU, India, allied nations) adoption.',
      'Does not end NVDA\'s AI opportunity. U.S. and allied-nation demand for advanced chips remains robust.',
      JSON.stringify(['Reuters', 'WSJ', 'CNBC'])
    );

    addArticleToStoryGroup(tickerGroup2Id, 'https://example.com/nvda-export-controls', 0.98);
    addArticleToStoryGroup(tickerGroup2Id, 'https://example.com/nvda-revenue-impact', 0.95);
    addRelatedTickerToStoryGroup(tickerGroup2Id, 'AMD', 'competitor');
    addRelatedTickerToStoryGroup(tickerGroup2Id, 'TSMC', 'related');

    logArticleDecision('https://example.com/nvda-export-controls', 'impact_scoring', true, 'Material revenue impact (15% China forecast reduction); High confidence', 0.98, 0.88, 0.97, 'TICKER', 'NVDA');
    logArticleDecision('https://example.com/nvda-revenue-impact', 'clustering', true, 'Similarity 0.95 to NVDA export controls story', 0.95, 0.85, 0.93, 'TICKER', 'NVDA');

    console.log(`✓ Created ticker group 2 (ID: ${tickerGroup2Id})\n`);

    // === Summary ===
    console.log('=== Summary ===');
    console.log(`✓ Created 2 GLOBAL story groups`);
    console.log(`✓ Created 2 TICKER story groups (AAPL, NVDA)`);
    console.log(`✓ Linked 8 test articles to groups`);
    console.log(`✓ Added decision logs for monitoring`);
    console.log(`\nTest data populated successfully!`);
    console.log(`\nTry the API endpoint:`);
    console.log(`  GET /v1/feed/story-groups`);
    console.log(`  GET /v1/feed/story-groups?limit_global=10&limit_per_ticker=5`);

  } catch (error) {
    console.error('Error populating story groups:', error);
    process.exit(1);
  }
}

// Run the population
populateStoryGroups();
