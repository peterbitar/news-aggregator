#!/usr/bin/env node
/**
 * Test script to verify all explanation fields are populated in story groups
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5002';
const USER_ID = 1;

const REQUIRED_FIELDS = [
  'what_happened',
  'why_it_happened',
  'why_it_matters_now',
  'who_this_applies_to',
  'what_to_watch_next',
  'what_this_does_not_mean',
  'sources_summary',
  'cause_confidence',
  'cause_reason',
  'decision_reasoning'
];

async function testStoryGroups() {
  try {
    console.log('🧪 Testing Story Groups Explanation Fields\n');
    console.log(`📡 Fetching from: ${BASE_URL}/v1/feed/story-groups?user_id=${USER_ID}\n`);

    const response = await axios.get(`${BASE_URL}/v1/feed/story-groups`, {
      params: { user_id: USER_ID },
      headers: { 'x-user-id': USER_ID.toString() }
    });

    const data = response.data;
    
    console.log(`✅ Response received:`);
    console.log(`   - Date: ${data.date}`);
    console.log(`   - User ID: ${data.user_id}`);
    console.log(`   - Total groups: ${data.metadata.total_groups}`);
    console.log(`   - Global groups: ${data.global.length}`);
    console.log(`   - Merged feed: ${data.merged_feed.length}`);
    console.log(`   - User holdings: ${data.user_holdings.join(', ')}\n`);

    // Test all groups in merged_feed
    const allGroups = [...data.global, ...Object.values(data.by_ticker).flat()];
    const mergedGroups = data.merged_feed;

    console.log(`\n📊 Testing ${mergedGroups.length} groups in merged_feed:\n`);

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    const failures = [];

    mergedGroups.forEach((group, index) => {
      const fullGroup = allGroups.find(g => g.id === group.id);
      if (!fullGroup || !fullGroup.explanation) {
        console.log(`❌ Group ${index + 1} (ID: ${group.id}): Missing explanation object`);
        failedTests++;
        failures.push({ group: group.id, issue: 'Missing explanation object' });
        return;
      }

      const explanation = fullGroup.explanation;
      console.log(`\n📰 Group ${index + 1}: "${group.group_title.substring(0, 60)}..."`);
      console.log(`   Scope: ${group.scope || fullGroup.scope}, Impact: ${group.impact_level || fullGroup.impact_level}`);

      REQUIRED_FIELDS.forEach(field => {
        totalTests++;
        const value = explanation[field];
        const hasValue = value !== null && value !== undefined;

        if (field === 'sources_summary') {
          const isValid = Array.isArray(value) && value.length > 0;
          if (isValid) {
            console.log(`   ✅ ${field}: [${value.length} source(s)]`);
            passedTests++;
          } else {
            console.log(`   ❌ ${field}: Missing or empty array`);
            failedTests++;
            failures.push({ group: group.id, field, issue: 'Missing or empty array' });
          }
        } else if (field === 'decision_reasoning') {
          const isValid = typeof value === 'object' && value !== null && 
                         (value.accepted_because || value.rejected_if_applicable);
          if (isValid) {
            console.log(`   ✅ ${field}: Object with reasoning`);
            passedTests++;
          } else {
            console.log(`   ❌ ${field}: Missing or invalid object`);
            failedTests++;
            failures.push({ group: group.id, field, issue: 'Missing or invalid object' });
          }
        } else {
          const isValid = hasValue && 
                         (typeof value === 'string' ? value.trim().length > 0 : true);
          if (isValid) {
            const preview = typeof value === 'string' 
              ? value.substring(0, 60).replace(/\n/g, ' ') + (value.length > 60 ? '...' : '')
              : String(value).substring(0, 60);
            console.log(`   ✅ ${field}: ${preview}`);
            passedTests++;
          } else {
            console.log(`   ❌ ${field}: Missing or empty`);
            failedTests++;
            failures.push({ group: group.id, field, issue: 'Missing or empty' });
          }
        }
      });
    });

    // Summary
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`📈 TEST SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total fields tested: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests} (${((passedTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${failedTests} (${((failedTests/totalTests)*100).toFixed(1)}%)`);

    if (failures.length > 0) {
      console.log(`\n❌ FAILURES:`);
      failures.forEach((f, i) => {
        console.log(`   ${i + 1}. Group ID ${f.group}, Field: ${f.field || 'N/A'}, Issue: ${f.issue}`);
      });
    } else {
      console.log(`\n🎉 All explanation fields are properly populated!`);
    }

    // Check field coverage
    console.log(`\n📋 FIELD COVERAGE:`);
    REQUIRED_FIELDS.forEach(field => {
      const fieldTests = mergedGroups.length;
      const fieldPasses = mergedGroups.filter(g => {
        const fullGroup = allGroups.find(gr => gr.id === g.id);
        if (!fullGroup?.explanation) return false;
        const value = fullGroup.explanation[field];
        
        if (field === 'sources_summary') {
          return Array.isArray(value) && value.length > 0;
        } else if (field === 'decision_reasoning') {
          return typeof value === 'object' && value !== null;
        } else {
          return value !== null && value !== undefined && 
                 (typeof value === 'string' ? value.trim().length > 0 : true);
        }
      }).length;
      
      const percentage = ((fieldPasses / fieldTests) * 100).toFixed(1);
      const status = fieldPasses === fieldTests ? '✅' : '⚠️';
      console.log(`   ${status} ${field}: ${fieldPasses}/${fieldTests} (${percentage}%)`);
    });

  } catch (error) {
    console.error('❌ Error testing story groups:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testStoryGroups();
