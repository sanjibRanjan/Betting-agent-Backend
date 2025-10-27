#!/bin/bash

echo "🚀 Starting Complete Live System Test"
echo "======================================"
echo ""

# Check if server is already running
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Server already running on port 3000"
    echo "Using existing server..."
else
    echo "📦 Starting server..."
    node server.js &
    SERVER_PID=$!
    echo "Server PID: $SERVER_PID"
    sleep 15
    echo "✅ Server started"
fi

echo ""
echo "🎮 Starting simulator in 5 seconds..."
sleep 5

# Start simulator in background
node live-match-simulator.js &
SIMULATOR_PID=$!
echo "✅ Simulator started (PID: $SIMULATOR_PID)"
echo ""

# Wait a bit for things to initialize
sleep 10

echo "📊 Current Status:"
echo "=================="
echo ""

# Check health
echo -n "Health: "
curl -s http://localhost:3000/api/health | grep -o '"status":"ok"' && echo "✅" || echo "❌"

# Check matches
echo -n "Live Matches: "
MATCHES=$(curl -s http://localhost:3000/api/live-matches | grep -o '"data":\[.*\]' | tr -d '[]' | wc -c)
echo "$MATCHES bytes"

# Check questions
echo -n "Questions: "
QUESTIONS=$(curl -s http://localhost:3000/api/questions/questions/active)
echo "$QUESTIONS" | grep -q '"data":\[]' && echo "0 (waiting for events...)" || echo "Generated!"

echo ""
echo "⏰ Monitoring for 2 minutes..."
echo "Press Ctrl+C to stop early"
echo ""

# Monitor for 2 minutes
for i in {1..24}; do
    sleep 5
    QUESTIONS=$(curl -s http://localhost:3000/api/questions/questions/active)
    question_count=$(echo "$QUESTIONS" | grep -o '"id"' | wc -l | tr -d ' ')
    
    if [ "$question_count" -gt 0 ]; then
        echo "✅ [$i/24] Questions detected: $question_count"
    else
        echo "⏳ [$i/24] Waiting for questions... ($(date '+%H:%M:%S'))"
    fi
done

echo ""
echo "📊 Final Results:"
echo "================="
echo ""
curl -s http://localhost:3000/api/questions/questions/active | jq '.data | length' 2>/dev/null || echo "0 questions generated"

echo ""
echo "🧹 Cleaning up..."
kill $SIMULATOR_PID 2>/dev/null
echo "✅ Done!"
