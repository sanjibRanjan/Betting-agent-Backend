#!/usr/bin/env node
'use strict';

/**
 * Inject test match data directly into Redis
 * This simulates what would happen when the external API returns data
 */

const { createClient } = require('redis');

async function main() {
  console.log('\n📥 Injecting Test Match Data into Redis...\n');
  
  const redis = createClient({ url: 'redis://127.0.0.1:6379' });
  await redis.connect();
  console.log('✅ Connected to Redis\n');
  
  // Create realistic test data with ball-by-ball info
  const testMatches = [
    {
      id: 'test_match_001',
      title: 'India vs Australia - 1st ODI',
      teams: { home: 'India', away: 'Australia' },
      status: 'Live',
      score: 'India 145/3 (25.4) | Australia 0/0',
      venue: 'MCA Stadium, Pune',
      startTime: new Date().toISOString(),
      format: 'ODI',
      ballByBall: {
        totalBalls: 154,
        lastBall: {
          ball: '25.4',
          runs: 2,
          batsman: 'Virat Kohli',
          bowler: 'Mitchell Starc'
        },
        recentBalls: [
          { ball: '25.1', runs: 1, batsman: 'Virat Kohli', bowler: 'Mitchell Starc' },
          { ball: '25.2', runs: 4, batsman: 'Rohit Sharma', bowler: 'Mitchell Starc' },
          { ball: '25.3', runs: 0, batsman: 'Rohit Sharma', bowler: 'Mitchell Starc' },
          { ball: '25.4', runs: 2, batsman: 'Virat Kohli', bowler: 'Mitchell Starc' }
        ]
      },
      lastUpdated: new Date().toISOString()
    },
    {
      id: 'test_match_002',
      title: 'England vs New Zealand - 2nd T20I',
      teams: { home: 'England', away: 'New Zealand' },
      status: 'Live',
      score: 'England 98/2 (12.3) | New Zealand 0/0',
      venue: "Lord's, London",
      startTime: new Date().toISOString(),
      format: 'T20I',
      ballByBall: {
        totalBalls: 75,
        lastBall: {
          ball: '12.3',
          runs: 6,
          batsman: 'Jos Buttler',
          bowler: 'Trent Boult'
        },
        recentBalls: [
          { ball: '12.0', runs: 1, batsman: 'Jos Buttler', bowler: 'Trent Boult' },
          { ball: '12.1', runs: 4, batsman: 'Jonny Bairstow', bowler: 'Trent Boult' },
          { ball: '12.2', runs: 0, batsman: 'Jonny Bairstow', bowler: 'Trent Boult' },
          { ball: '12.3', runs: 6, batsman: 'Jos Buttler', bowler: 'Trent Boult' }
        ]
      },
      lastUpdated: new Date().toISOString()
    }
  ];
  
  // Store in Redis with same key as server uses
  await redis.set('live:cricket:matches', JSON.stringify(testMatches), { EX: 60 });
  console.log('✅ Injected 2 test matches into Redis');
  console.log('   - Match 1: India vs Australia (Live)');
  console.log('   - Match 2: England vs New Zealand (Live)\n');
  
  // Check current data
  const cached = await redis.get('live:cricket:matches');
  const matches = JSON.parse(cached);
  console.log('📊 Current cached data:');
  console.log(`   Total matches: ${matches.length}`);
  matches.forEach((match, i) => {
    console.log(`   ${i+1}. ${match.title} - ${match.status}`);
  });
  
  console.log('\n⏳ Waiting 5 seconds for system to process...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Check if questions were generated
  const axios = require('axios');
  try {
    const response = await axios.get('http://localhost:3000/api/questions/questions/active');
    const count = response.data.data?.questions?.length || 0;
    console.log(`📝 Questions generated: ${count}`);
    
    if (count > 0) {
      console.log('\n✅ System is working! Questions are being generated from match data.\n');
    } else {
      console.log('\n⚠️  No questions yet. This might take 1-2 minutes for events to process.\n');
    }
  } catch (error) {
    console.log('\n❌ Could not check questions endpoint:', error.message);
  }
  
  await redis.disconnect();
  console.log('✅ Done!\n');
}

main().catch(console.error);
