/**
 * Test script for /api/articles endpoint
 * Run with: node test-api-endpoint.js
 * Make sure your backend server is running on port 5001
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5001';

// Helper function to make requests and display results
async function testEndpoint(name, url) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Test: ${name}`);
  console.log(`URL: ${url}`);
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(url);
    console.log(`Status: ${response.status}`);
    console.log(`Total Results: ${response.data.totalResults}`);
    console.log(`Articles Returned: ${response.data.articles?.length || 0}`);
    
    if (response.data.articles && response.data.articles.length > 0) {
      console.log('\nFirst Article:');
      const first = response.data.articles[0];
      console.log(`  Title: ${first.title}`);
      console.log(`  Source: ${first.source?.name}`);
      console.log(`  Published: ${first.publishedAt}`);
      console.log(`  Searched By: ${first.searchedBy}`);
      if (first.relevanceScore) {
        console.log(`  Relevance Score: ${first.relevanceScore}`);
      }
      if (first.finalRankScore) {
        console.log(`  Final Rank Score: ${first.finalRankScore}`);
      }
    }
    
    return response.data;
  } catch (error) {
    console.error(`Error: ${error.response?.status || error.message}`);
    if (error.response?.data) {
      console.error(`Response:`, JSON.stringify(error.response.data, null, 2));
    }
    return null;
  }
}

async function runTests() {
  console.log('\n==========================================');
  console.log('Testing /api/articles Endpoint');
  console.log('==========================================\n');

  // Test 1: Basic query with NVDA and AAPL
  await testEndpoint(
    'Basic query - NVDA and AAPL',
    `${BASE_URL}/api/articles?tickers=NVDA,AAPL&limit=10`
  );

  // Test 2: Query with minimum score filter
  await testEndpoint(
    'Query with minimum score (40)',
    `${BASE_URL}/api/articles?tickers=NVDA,AAPL&limit=10&minScore=40`
  );

  // Test 3: Query with date range
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  const toDate = new Date();
  await testEndpoint(
    'Query with date range (last 7 days)',
    `${BASE_URL}/api/articles?tickers=NVDA&limit=5&from=${fromDate.toISOString().split('T')[0]}&to=${toDate.toISOString().split('T')[0]}`
  );

  // Test 4: Query with source filter
  await testEndpoint(
    'Query with source filter (gnews only)',
    `${BASE_URL}/api/articles?tickers=NVDA&limit=5&sources=gnews`
  );

  // Test 5: Query including unprocessed articles
  await testEndpoint(
    'Query including unprocessed articles',
    `${BASE_URL}/api/articles?tickers=NVDA&limit=5&processedOnly=false`
  );

  // Test 6: Error case - missing tickers parameter
  await testEndpoint(
    'Error case - missing tickers parameter',
    `${BASE_URL}/api/articles?limit=10`
  );

  // Test 7: Single ticker query
  await testEndpoint(
    'Single ticker query (NVDA only)',
    `${BASE_URL}/api/articles?tickers=NVDA&limit=5`
  );

  // Test 8: Multiple tickers with all filters
  await testEndpoint(
    'Multiple tickers with all filters',
    `${BASE_URL}/api/articles?tickers=NVDA,AAPL&limit=10&minScore=30&sources=gnews,newsapi&processedOnly=true`
  );

  console.log('\n==========================================');
  console.log('All tests completed!');
  console.log('==========================================\n');
}

// Run tests
runTests().catch(console.error);






