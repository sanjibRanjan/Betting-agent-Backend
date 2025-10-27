#!/usr/bin/env node
'use strict';

/**
 * Inject simulated match data directly into Redis
 * This bypasses the external API and tests the entire pipeline
 */

const { createClient } = require('redis');
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('\n🧪 Testing with Direct Redis Injection\n');
  
  // Connect to Redis
  const redis = createClient({ url: 'redis://127.0.0.1:6379' });
  await redis.connect();
  console.log('✅ Connected to Redis\n');
  
  // Simulated match data
  const mockMatches = [
    {
      id: 'sim_match_001',
      title: 'India vs Australia - 1st ODI',
      teams: { home: 'India', away: 'Australia' },
      status: 'Live',
      score: 'India 87/2 (12.3) | Australia 0/0',
      venue: 'MCA Stadium, Pune',
      startTime: new Date().toISOString(),
      format: 'ODI',
      lastUpdated: new Date().toISOString()
    },
    {
      id: 'sim_match_002',
      title: 'England vs New Zealand - 2nd T20I',
      teams: { home: 'England', away: 'New Zealand' },
      status: 'Live',
      score: 'England 72/1 (8.5) | New Zealand 0/0',
      venue: "Lord's, London",
      startTime: new Date().toISOString(),
      format: 'T20I',
      lastUpdated: new Date().toISOString()
    }
  ];
  
  // Inject into Redis using the same key as server
  await redis.set('live:cricket:matches', JSON.stringify(mockMatches), { EX: 60 });
  console.log('✅ Injected 2 mock matches into Redis\n');
  
  // Test endpoints
  console.log('Testing endpoints...\n');
  
  try {
    const health = await axios.get(`${BASE_URL}/api/health`);
    console.log('✅ Health:', health.data.status);
  } catch (e) {
    console.log('❌ Health failed:', e.message);
  }
  
  try {
    const matches = await axios.get(`${BASE_URL}/api/live-matches`);
    console.log('✅ Live Matches:', matches.data.data?.length || 0, 'matches');
  } catch (e) {
    console.log('❌ Live Matches failed:', e.message);
  }
  
  try {
    const questions = await axios.get(`${BASE_URL}/api/questions/questions/active`);
    console.log('✅ Questions:', questions.data.data?.length || 0, 'questions');
  } catch (e) {
    console.log('⚠️  No questions yet (this is expected initially)');
  }
  
  console.log('\n✅ Test complete!\n');
  await redis.disconnect();
}

main().catch(console.error);

