#!/bin/bash

# Monitor questions endpoint every 5 seconds
while true; do
  clear
  echo "📊 Monitoring Questions Endpoint - $(date '+%H:%M:%S')"
  echo "============================================================"
  echo ""
  
  response=$(curl -s http://localhost:3000/api/questions/questions/active)
  question_count=$(echo "$response" | grep -o '"data":\[.*\]' | grep -o '{' | wc -l)
  
  echo "✅ Questions Generated: $question_count"
  echo ""
  echo "Full Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  
  echo ""
  echo "Press Ctrl+C to stop"
  sleep 5
done
