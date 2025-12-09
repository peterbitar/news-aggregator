#!/bin/bash

# Test script for /api/articles endpoint
# Make sure your backend server is running on port 5001

BASE_URL="http://localhost:5001"

echo "=========================================="
echo "Testing /api/articles Endpoint"
echo "=========================================="
echo ""

# Test 1: Basic query with NVDA and AAPL
echo "Test 1: Basic query - NVDA and AAPL"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?tickers=NVDA,AAPL&limit=10" | jq '.'
echo ""
echo ""

# Test 2: Query with minimum score filter
echo "Test 2: Query with minimum score (40)"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?tickers=NVDA,AAPL&limit=10&minScore=40" | jq '.'
echo ""
echo ""

# Test 3: Query with date range
echo "Test 3: Query with date range (last 7 days)"
echo "-----------------------------------"
FROM_DATE=$(date -u -v-7d +"%Y-%m-%d" 2>/dev/null || date -u -d "7 days ago" +"%Y-%m-%d" 2>/dev/null || echo "2025-01-01")
TO_DATE=$(date -u +"%Y-%m-%d" 2>/dev/null || echo "2025-12-31")
curl -s "${BASE_URL}/api/articles?tickers=NVDA&limit=5&from=${FROM_DATE}&to=${TO_DATE}" | jq '.'
echo ""
echo ""

# Test 4: Query with source filter
echo "Test 4: Query with source filter (gnews only)"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?tickers=NVDA&limit=5&sources=gnews" | jq '.'
echo ""
echo ""

# Test 5: Query including unprocessed articles
echo "Test 5: Query including unprocessed articles"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?tickers=NVDA&limit=5&processedOnly=false" | jq '.'
echo ""
echo ""

# Test 6: Error case - missing tickers parameter
echo "Test 6: Error case - missing tickers parameter"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?limit=10" | jq '.'
echo ""
echo ""

# Test 7: Single ticker query
echo "Test 7: Single ticker query (NVDA only)"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?tickers=NVDA&limit=5" | jq '.'
echo ""
echo ""

# Test 8: Multiple tickers with all filters
echo "Test 8: Multiple tickers with all filters"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/articles?tickers=NVDA,AAPL&limit=10&minScore=30&sources=gnews,newsapi&processedOnly=true" | jq '.'
echo ""
echo ""

echo "=========================================="
echo "All tests completed!"
echo "=========================================="



