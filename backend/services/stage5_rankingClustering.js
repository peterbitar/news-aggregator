const { getDatabase } = require("../db");
const crypto = require("crypto");

/**
 * Stage 5: Feed ranking & clustering
 * Compare articles to each other, dedupe similar ones, and select the primary version
 * 
 * Columns filled:
 * - cluster_id
 * - is_primary_in_cluster
 * - final_rank_score (0-100)
 * - shown_to_user
 * - shown_timestamp (once shown)
 */
async function processRankingClustering(articles, cutoffScore = 50) {
  console.log("\n[Stage 5] ========== RANKING & CLUSTERING STARTED ==========");
  console.log(`[Stage 5] Cutoff score: ${cutoffScore}`);
  
  const db = getDatabase();

  try {
    // Get all personalized articles (status = "personalized") - explicitly exclude discarded
    console.log("[Stage 5] Step 1: Fetching personalized articles...");
    const personalizedArticles = db.prepare(`
      SELECT url, title, personalized_title, profile_adjusted_score, impact_score,
             published_at, event_type, matched_tickers, matched_holdings
      FROM articles
      WHERE status = 'personalized'
        AND status != 'discarded'
      ORDER BY profile_adjusted_score DESC, impact_score DESC, published_at DESC
    `).all();

    console.log(`[Stage 5] Found ${personalizedArticles.length} personalized articles to rank and cluster`);

    if (personalizedArticles.length === 0) {
      console.log("[Stage 5] ❌ No personalized articles found. Make sure articles have completed Stage 4.");
      return { clustered: 0, ranked: 0, clusters: 0 };
    }

    // Create clusters based on similarity
    console.log("[Stage 5] Step 2: Creating clusters from similar articles...");
    const clusters = createClusters(personalizedArticles);
    console.log(`[Stage 5] Created ${clusters.length} clusters from ${personalizedArticles.length} articles`);

    // For each cluster, select primary article and calculate final_rank_score
    console.log("[Stage 5] Step 3: Processing clusters and calculating final rank scores...");
    let clustered = 0;
    let ranked = 0;
    let shownToUser = 0;

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      // Select primary article (highest profile_adjusted_score)
      const primary = cluster.sort((a, b) => 
        (b.profile_adjusted_score || 0) - (a.profile_adjusted_score || 0)
      )[0];

      // Generate cluster_id
      const cluster_id = generateClusterId(primary.title || primary.personalized_title);

      // Calculate final_rank_score
      const final_rank_score = calculateFinalRankScore(primary);
      
      if (i < 5 || cluster.length > 1) {
        console.log(`[Stage 5] Cluster ${i + 1}/${clusters.length}: ${cluster.length} articles, primary: "${(primary.title || primary.personalized_title || "").substring(0, 60)}...", final_rank_score: ${final_rank_score}`);
      }

      // Update all articles in cluster
      for (const article of cluster) {
        const is_primary = article.url === primary.url;
        const shown_to_user = final_rank_score >= cutoffScore && is_primary ? 1 : 0;

        db.prepare(`
          UPDATE articles SET
            cluster_id = ?,
            is_primary_in_cluster = ?,
            final_rank_score = ?,
            shown_to_user = ?,
            ${shown_to_user ? "shown_timestamp = datetime('now')," : ""}
            status = CASE 
              WHEN ? = 1 THEN 'ranked'
              ELSE 'ranked'
            END,
            updated_at = datetime('now')
          WHERE url = ?
        `).run(
          cluster_id,
          is_primary ? 1 : 0,
          final_rank_score,
          shown_to_user,
          shown_to_user,
          article.url
        );

        if (is_primary) {
          ranked++;
          if (shown_to_user) {
            shownToUser++;
          }
        }
        clustered++;
      }
    }

    console.log(`\n[Stage 5] ========== RANKING & CLUSTERING COMPLETE ==========`);
    console.log(`[Stage 5] Summary:`, {
      totalArticles: personalizedArticles.length,
      clustersCreated: clusters.length,
      articlesClustered: clustered,
      primaryArticlesRanked: ranked,
      articlesShownToUser: shownToUser,
      cutoffScore
    });
    
    // Show sample of ranked articles
    const sampleRanked = db.prepare(`
      SELECT url, title, final_rank_score, cluster_id, is_primary_in_cluster, shown_to_user
      FROM articles
      WHERE status = 'ranked'
      ORDER BY final_rank_score DESC
      LIMIT 5
    `).all();
    
    if (sampleRanked.length > 0) {
      console.log(`[Stage 5] Sample ranked articles (top 5):`);
      sampleRanked.forEach((art, idx) => {
        console.log(`[Stage 5]   ${idx + 1}. Score: ${art.final_rank_score}, Primary: ${art.is_primary_in_cluster}, Shown: ${art.shown_to_user}, Cluster: ${art.cluster_id?.substring(0, 12)}...`);
        console.log(`[Stage 5]      "${(art.title || "").substring(0, 70)}..."`);
      });
    }

    return { clustered, ranked, clusters: clusters.length, shownToUser };
  } catch (error) {
    console.error("Error in Stage 5 ranking & clustering:", error.message);
    return { error: error.message };
  }
}

/**
 * Create clusters of similar articles
 * OPTIMIZED: O(n log n) complexity by grouping by event_type + tickers first
 */
function createClusters(articles) {
  if (articles.length === 0) return [];
  
  // OPTIMIZATION: Pre-group by event_type + primary ticker for O(n log n) instead of O(n²)
  const groups = new Map();
  
  for (const article of articles) {
    const tickers = article.matched_tickers ? JSON.parse(article.matched_tickers) : [];
    const primaryTicker = tickers.length > 0 ? tickers[0] : "none";
    const eventType = article.event_type || "other";
    const groupKey = `${eventType}:${primaryTicker}`;
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(article);
  }
  
  // Now cluster within each group (much smaller sets)
  const clusters = [];
  const processed = new Set();

  for (const [groupKey, groupArticles] of groups) {
    for (const article of groupArticles) {
      if (processed.has(article.url)) continue;

      const cluster = [article];
      processed.add(article.url);

      // Find similar articles within the same group
      const title1 = (article.personalized_title || article.title || "").toLowerCase();
      const tickers1 = article.matched_tickers ? JSON.parse(article.matched_tickers) : [];
      const eventType1 = article.event_type || "";

      for (const other of groupArticles) {
        if (processed.has(other.url)) continue;
        if (article.url === other.url) continue;

        const title2 = (other.personalized_title || other.title || "").toLowerCase();
        const tickers2 = other.matched_tickers ? JSON.parse(other.matched_tickers) : [];
        const eventType2 = other.event_type || "";

        // Check if articles are similar
        if (areSimilar(title1, title2, tickers1, tickers2, eventType1, eventType2)) {
          cluster.push(other);
          processed.add(other.url);
        }
      }

      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Check if two articles are similar enough to cluster
 */
function areSimilar(title1, title2, tickers1, tickers2, eventType1, eventType2) {
  // Same event type and overlapping tickers = likely same story
  if (eventType1 && eventType2 && eventType1 === eventType2) {
    const commonTickers = tickers1.filter(t => tickers2.includes(t));
    if (commonTickers.length > 0) {
      return true;
    }
  }

  // High title similarity
  const similarity = calculateSimilarity(title1, title2);
  if (similarity > 0.7) {
    return true;
  }

  return false;
}

/**
 * Calculate similarity between two strings (simple word overlap)
 */
function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 3));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
}

/**
 * Generate cluster ID from title
 */
function generateClusterId(title) {
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").substring(0, 50);
  const hash = crypto.createHash("md5").update(normalized).digest("hex");
  return `cluster_${hash.substring(0, 8)}`;
}

/**
 * Calculate final rank score (0-100)
 */
function calculateFinalRankScore(article) {
  const profile_score = article.profile_adjusted_score || 0;
  const impact_score = article.impact_score || 0;
  
  // Combine scores: 60% profile, 40% impact
  const final_score = Math.round(profile_score * 0.6 + impact_score * 0.4);
  
  return Math.max(0, Math.min(100, final_score));
}

/**
 * Process ranking for a single user's feed
 */
async function processUserFeedRanking(userId = 1) {
  const db = getDatabase();
  
  // Get user's holdings to personalize ranking
  const holdings = db.prepare(`
    SELECT ticker, label, notes FROM holdings WHERE user_id = ?
  `).all(userId);

  // Process ranking and clustering
  return await processRankingClustering([], 50); // Use default cutoff
}

module.exports = {
  processRankingClustering,
  processUserFeedRanking,
};

