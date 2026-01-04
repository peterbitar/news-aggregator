/**
 * Lightweight v1 telemetry for pipeline metrics
 * Tracks per-run statistics (in-memory, logging only)
 * No database storage yet - just for monitoring and tuning
 */

let currentRunMetrics = {
  stage1: { processed: 0, discarded: 0, errors: 0 },
  stage2: { processed: 0, discarded: 0, errors: 0, duplicates: 0 },
  stage3: { processed: 0, deferred: 0, discarded: 0, errors: 0 },
  stage4: { processed: 0, discarded: 0, errors: 0 },
  stage5: { processed: 0, errors: 0 },
  dropReasons: {},
  tokenUsage: { stage1: 0, stage3: 0 },
  durations: { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 },
};

/**
 * Track stage start
 */
function trackStageStart(stage, articleCount) {
  console.log(`[Telemetry] Stage ${stage} started with ${articleCount} articles`);
}

/**
 * Track stage end with results
 */
function trackStageEnd(stage, results, duration, tokenUsage = 0) {
  if (!currentRunMetrics[stage]) {
    currentRunMetrics[stage] = { processed: 0, discarded: 0, errors: 0 };
  }
  
  const metrics = currentRunMetrics[stage];
  metrics.processed += results.length || 0;
  
  // Count statuses
  if (Array.isArray(results)) {
    results.forEach(result => {
      if (result.status === 'discarded') {
        metrics.discarded = (metrics.discarded || 0) + 1;
        if (result.reason) {
          trackDropReason(result.reason);
        }
      } else if (result.status === 'deferred_low') {
        metrics.deferred = (metrics.deferred || 0) + 1;
      } else if (result.status === 'error') {
        metrics.errors = (metrics.errors || 0) + 1;
      } else if (result.status === 'duplicate') {
        metrics.duplicates = (metrics.duplicates || 0) + 1;
      }
    });
  }
  
  if (tokenUsage > 0) {
    currentRunMetrics.tokenUsage[stage] = (currentRunMetrics.tokenUsage[stage] || 0) + tokenUsage;
  }
  
  if (duration > 0) {
    currentRunMetrics.durations[stage] = (currentRunMetrics.durations[stage] || 0) + duration;
  }
  
  console.log(`[Telemetry] Stage ${stage} complete: ${metrics.processed} processed, ${metrics.discarded || 0} discarded, ${metrics.errors || 0} errors`);
}

/**
 * Track drop reason
 */
function trackDropReason(reason) {
  if (!reason) return;
  currentRunMetrics.dropReasons[reason] = (currentRunMetrics.dropReasons[reason] || 0) + 1;
}

/**
 * Get current run metrics
 */
function getRunMetrics() {
  return JSON.parse(JSON.stringify(currentRunMetrics)); // Deep copy
}

/**
 * Reset run metrics (call at start of new run)
 */
function resetRunMetrics() {
  currentRunMetrics = {
    stage1: { processed: 0, discarded: 0, errors: 0 },
    stage2: { processed: 0, discarded: 0, errors: 0, duplicates: 0 },
    stage3: { processed: 0, deferred: 0, discarded: 0, errors: 0 },
    stage4: { processed: 0, discarded: 0, errors: 0 },
    stage5: { processed: 0, errors: 0 },
    dropReasons: {},
    tokenUsage: { stage1: 0, stage3: 0 },
    durations: { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 },
  };
}

/**
 * Log summary of current run
 */
function logRunSummary() {
  const metrics = getRunMetrics();
  console.log('\n[Telemetry] ========== RUN SUMMARY ==========');
  console.log(`Stage 1: ${metrics.stage1.processed} processed, ${metrics.stage1.discarded} discarded`);
  console.log(`Stage 2: ${metrics.stage2.processed} processed, ${metrics.stage2.discarded} discarded, ${metrics.stage2.duplicates} duplicates`);
  console.log(`Stage 3: ${metrics.stage3.processed} processed, ${metrics.stage3.deferred} deferred, ${metrics.stage3.discarded} discarded`);
  console.log(`Stage 4: ${metrics.stage4.processed} processed, ${metrics.stage4.discarded} discarded`);
  console.log(`Stage 5: ${metrics.stage5.processed} processed`);
  
  if (Object.keys(metrics.dropReasons).length > 0) {
    console.log('\nDrop Reasons:');
    Object.entries(metrics.dropReasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}`);
      });
  }
  
  if (metrics.tokenUsage.stage1 > 0 || metrics.tokenUsage.stage3 > 0) {
    console.log(`\nToken Usage: Stage 1: ${metrics.tokenUsage.stage1}, Stage 3: ${metrics.tokenUsage.stage3}`);
  }
  
  const totalDuration = Object.values(metrics.durations).reduce((a, b) => a + b, 0);
  if (totalDuration > 0) {
    console.log(`Total Duration: ${totalDuration}ms`);
  }
  
  console.log('[Telemetry] =================================\n');
}

module.exports = {
  trackStageStart,
  trackStageEnd,
  trackDropReason,
  getRunMetrics,
  resetRunMetrics,
  logRunSummary,
};
