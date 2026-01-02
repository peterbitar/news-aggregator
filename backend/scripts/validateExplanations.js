#!/usr/bin/env node
/**
 * EXPLANATION VALIDATOR
 *
 * Checks all explanations against the STRICT STANDARD quality gates.
 * Identifies violations and generates improvement recommendations.
 */

const { getDatabase } = require('../data/db');

const RED_FLAGS = [
  'monitor developments',
  'watch for reaction',
  'watch for developments',
  'keep an eye on',
  'watch and see',
  'relevant to investors',
  'important for markets',
  'important for investors',
  'could affect prices',
  'assess performance',
  'assess risk',
  'wait and see',
  'monitor for'
];

const GREEN_FLAGS = ['because', 'if', 'then', 'means', 'indicates', 'signals'];

function validateExplanation(group) {
  const issues = [];
  const exp = group.explanation_data;

  if (!exp) return { group_id: group.id, issues: ['No explanation data'] };

  // 1. Check for RED FLAGS in what_to_watch_next
  const watch = (exp.what_to_watch_next || '').toLowerCase();
  RED_FLAGS.forEach(flag => {
    if (watch.includes(flag)) {
      issues.push(`CRITICAL: what_to_watch_next contains red flag: "${flag}"`);
    }
  });

  // 2. Check if what_to_watch_next has concrete signals (should contain numbers, websites, or specific actions)
  const hasConcreteSignals =
    watch.includes('http') ||
    watch.includes('com') ||
    watch.includes('watch for') ||
    watch.includes('listen') ||
    watch.includes('check') ||
    /\$\d+|%|day|week|month/i.test(watch);

  if (!hasConcreteSignals) {
    issues.push('CRITICAL: what_to_watch_next lacks concrete signals (no specific websites, numbers, or watch items)');
  }

  // 3. Check if signals have "because" explaining meaning
  const signalCount = (watch.match(/watch for|listen for|check|see/gi) || []).length;
  const becauseCount = (watch.match(/because|indicates|signals|means|if|then/gi) || []).length;

  if (signalCount > 0 && becauseCount < signalCount) {
    issues.push(`HIGH: what_to_watch_next has ${signalCount} signals but only ${becauseCount} explanations of meaning (need "because" for each)`);
  }

  // 4. Check why_it_matters_now length (should be substantive)
  const whyLength = (exp.why_it_matters_now || '').length;
  if (whyLength < 250) {
    issues.push(`MEDIUM: why_it_matters_now is too short (${whyLength} chars, target 300+). Likely missing second-order effects.`);
  }

  // 5. Check if why_it_matters_now shows second-order effects
  const why = (exp.why_it_matters_now || '').toLowerCase();
  if (!why.includes('means') && !why.includes('causes') && !why.includes('risk') && !why.includes('change')) {
    issues.push('HIGH: why_it_matters_now may not show second-order effects (missing "means", "causes", "risk", or "change")');
  }

  // 6. Check who_this_applies_to specificity
  const who = (exp.who_this_applies_to || '').toLowerCase();
  if (who.includes('all market participants') || who.includes('all investors')) {
    issues.push('CRITICAL: who_this_applies_to is too generic ("all market participants"). Should list specific people.');
  }

  // 7. Check what_this_does_not_mean exists and is substantial
  const doesNot = (exp.what_this_does_not_mean || '').toLowerCase();
  if (!exp.what_this_does_not_mean || doesNot.length < 150) {
    issues.push('HIGH: what_this_does_not_mean is missing or too short. Should prevent 2+ misconceptions.');
  }

  // 8. Check plain_summary for headline preview
  if (!exp.plain_summary || exp.plain_summary.length < 40) {
    issues.push('MEDIUM: plain_summary missing or too short (for iOS preview)');
  }

  // 9. Check cause_confidence is set
  if (!exp.cause_confidence || !['High', 'Medium', 'Low'].includes(exp.cause_confidence)) {
    issues.push('CRITICAL: cause_confidence not set or invalid');
  }

  // 10. Check cause_reason justifies confidence
  if (!exp.cause_reason || exp.cause_reason.length < 50) {
    issues.push('HIGH: cause_reason missing or too short (should justify why confidence is at this level)');
  }

  // 11. Check what_happened length (should not just be headline)
  const happened = (exp.what_happened || '').length;
  if (happened < 200) {
    issues.push(`MEDIUM: what_happened is short (${happened} chars). May be just headline. Should add specific facts and context.`);
  }

  // 12. Check why_it_happened length (should explain causation)
  const whyHappened = (exp.why_it_happened || '').length;
  if (whyHappened < 300) {
    issues.push(`MEDIUM: why_it_happened is short (${whyHappened} chars, target 300+). May lack causal chain and context.`);
  }

  return {
    group_id: group.id,
    group_title: group.group_title,
    severity: issues.length === 0 ? 'PASS' : issues.some(i => i.startsWith('CRITICAL')) ? 'CRITICAL' : issues.some(i => i.startsWith('HIGH')) ? 'HIGH' : 'MEDIUM',
    issues: issues
  };
}

async function validateAllExplanations() {
  try {
    const db = getDatabase();

    console.log('\n=== EXPLANATION VALIDATION REPORT ===\n');

    const groups = db.prepare(`
      SELECT
        sg.id,
        sg.group_title,
        sge.what_happened,
        sge.why_it_happened,
        sge.why_it_matters_now,
        sge.who_this_applies_to,
        sge.what_to_watch_next,
        sge.what_this_does_not_mean,
        sge.cause_confidence,
        sge.cause_reason,
        sge.plain_summary
      FROM story_groups sg
      LEFT JOIN story_group_explanations sge ON sg.id = sge.story_group_id
    `).all();

    let passed = 0;
    let criticalIssues = [];
    let highIssues = [];
    let mediumIssues = [];

    for (const group of groups) {
      const exp = {
        what_happened: group.what_happened,
        why_it_happened: group.why_it_happened,
        why_it_matters_now: group.why_it_matters_now,
        who_this_applies_to: group.who_this_applies_to,
        what_to_watch_next: group.what_to_watch_next,
        what_this_does_not_mean: group.what_this_does_not_mean,
        cause_confidence: group.cause_confidence,
        cause_reason: group.cause_reason,
        plain_summary: group.plain_summary
      };

      const result = validateExplanation({ ...group, explanation_data: exp });

      if (result.severity === 'PASS') {
        passed++;
      } else if (result.severity === 'CRITICAL') {
        criticalIssues.push(result);
      } else if (result.severity === 'HIGH') {
        highIssues.push(result);
      } else {
        mediumIssues.push(result);
      }
    }

    // Summary
    console.log(`SUMMARY:`);
    console.log(`✓ PASSING: ${passed}/${groups.length}`);
    console.log(`✗ CRITICAL: ${criticalIssues.length} issues`);
    console.log(`⚠ HIGH: ${highIssues.length} issues`);
    console.log(`ℹ MEDIUM: ${mediumIssues.length} issues\n`);

    // Show critical issues
    if (criticalIssues.length > 0) {
      console.log('=== CRITICAL ISSUES (FIX IMMEDIATELY) ===\n');
      criticalIssues.slice(0, 10).forEach(result => {
        console.log(`Group ${result.group_id}: "${result.group_title.substring(0, 60)}..."`);
        result.issues.filter(i => i.startsWith('CRITICAL')).forEach(issue => {
          console.log(`  ✗ ${issue}`);
        });
        console.log();
      });
    }

    // Show high issues
    if (highIssues.length > 0) {
      console.log('=== HIGH PRIORITY ISSUES ===\n');
      highIssues.slice(0, 5).forEach(result => {
        console.log(`Group ${result.group_id}: "${result.group_title.substring(0, 60)}..."`);
        result.issues.filter(i => i.startsWith('HIGH')).forEach(issue => {
          console.log(`  ⚠ ${issue}`);
        });
        console.log();
      });
    }

    // List passing explanations
    console.log(`\n=== PASSING EXPLANATIONS (${passed}) ===\n`);
    const passingGroups = groups.filter((g, i) => {
      const exp = {
        what_happened: g.what_happened,
        why_it_happened: g.why_it_happened,
        why_it_matters_now: g.why_it_matters_now,
        who_this_applies_to: g.who_this_applies_to,
        what_to_watch_next: g.what_to_watch_next,
        what_this_does_not_mean: g.what_this_does_not_mean,
        cause_confidence: g.cause_confidence,
        cause_reason: g.cause_reason,
        plain_summary: g.plain_summary
      };
      return validateExplanation({ ...g, explanation_data: exp }).severity === 'PASS';
    });

    passingGroups.forEach(g => {
      console.log(`✓ Group ${g.id}: "${g.group_title.substring(0, 70)}..."`);
    });

    console.log(`\n=== VALIDATION COMPLETE ===`);
    console.log(`Next: Rewrite remaining issues using STRICT_EXPLANATION_TEMPLATE.md`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

validateAllExplanations();
