#!/bin/bash

echo "🧪 WEALTHY RABBIT PERSONALIZATION TEST"
echo "======================================"
echo ""

# Check if server is running
if ! curl -s "http://localhost:5001/v1/personalized-feed?limit=1" -H "x-user-id: 1" > /dev/null 2>&1; then
    echo "❌ Server not responding on http://localhost:5001"
    echo "   Run: pm2 start ecosystem.config.js"
    exit 1
fi

echo "✅ Server is running"
echo ""

# Get holdings
echo "📋 Your Current Holdings:"
curl -s "http://localhost:5001/api/holdings" | jq -r '.[] | "  • \(.ticker) - \(.label)"'
echo ""

# Test personalized feed
echo "🎯 Fetching 3 Personalized Events..."
echo ""

response=$(curl -s "http://localhost:5001/v1/personalized-feed?limit=3" -H "x-user-id: 1")

# Show results
echo "$response" | jq -r '
.items | to_entries | map(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "📰 EVENT #\(.key + 1)\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "Title: \(.value.explanation.title)\n" +
  "Summary: \(.value.explanation.summary)\n" +
  "\n💡 Why this matters to you:\n\(.value.explanation.whyThisMattersToYou)\n" +
  "\n👀 What to watch:\n\(.value.explanation.whatToWatch | map("  • \(.)") | join("\n"))\n" +
  "\n✅ Bottom line: \(.value.explanation.bottomLine)\n" +
  "\n🏷️  Action: \(.value.explanation.classification.action)"
) | join("\n")
'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Test complete! Check the explanations above."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
