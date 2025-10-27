#!/usr/bin/env node
'use strict';

/**
 * Inject test events directly into Redis event queues
 * This simulates what the event detector would create
 */

const { createClient } = require('redis');

async function main() {
  console.log('\n🎯 Injecting Test Events into Event Queues...\n');
  
  const redis = createClient({ url: 'redis://127.0.0.1:6379' });
  await redis.connect();
  console.log('✅ Connected to Redis\n');
  
  // Create test events for a match
  const matchId = 'test_match_001';
  const events = [
    {
      type: 'boundary',
      matchId: matchId,
      timestamp: new Date().toISOString(),
      description: 'Boundary hit by Virat Kohli',
      runs: 4,
      batsman: 'Virat Kohli',
      bowler: 'Mitchell Starc',
      over: 25.4,
      significance: 'high',
      confidence: 0.85
    },
    {
      type: 'six',
      matchId: matchId,
      timestamp: new Date().toISOString(),
      description: 'Six hit by Rohit Sharma',
      runs: 6,
      batsman: 'Rohit Sharma',
      bowler: 'Mitchell Starc',
      over: 12.3,
      significance: 'high',
      confidence: 0.90
    },
    {
      type: 'wicket',
      matchId: matchId,
      timestamp: new Date().toISOString(),
      description: 'Wicket taken by Mitchell Starc',
      wickets: 3,
      batsman: 'KL Rahul',
      bowler: 'Mitchell Starc',
      over: 24.2,
      significance: 'critical',
      confidence: 0.95
    }
  ];
  
  // Inject events into event queue (format: event:queue:matchId)
  const queueKey = `event:queue:${matchId}`;
  for (const event of events) {
    await redis.lPush(queueKey, JSON.stringify(event));
  }
  
  // Set TTL on the queue
  await redis.expire(queueKey, 3600);
  
  console.log(`✅ Injected ${events.length} events into queue: ${queueKey}`);
  console.log('   Events:', events.map(e => e.type).join(', '));
  
  // Check queue contents
  const queueLength = await redis.lLen(queueKey);
  console.log(`\n📊 Queue length: ${queueLength} events`);
  
  console.log('\n⏳ Waiting 10 seconds for question generator to process...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check if questions were generated
  const axios = require('axios');
  try {
    const response = await axios.get('http://localhost:3000/api/questions/questions/active');
    const questions = response.data.data?.questions || [];
    console.log(`📝 Questions generated: ${questions.length}`);
    
    if (questions.length > 0) {
      console.log('\n✅ System is working! Questions generated from events!\n');
      questions.slice(0, 3).forEach((q, i) => {
        console.log(`   ${i+1}. ${q.question}`);
      });
    } else {
      console.log('\n⚠️  No questions yet. Service might still be processing...\n');
    }
  } catch (error) {
    console.log('\n❌ Could not check questions:', error.message);
  }
  
  await redis.disconnect();
  console.log('✅ Done!\n');
}

main().catch(console.error);
