#!/usr/bin/env node

/**
 * Script to inject sample events and generate questions for testing
 */

const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function injectSampleEvents() {
  const redisClient = createClient({ url: REDIS_URL });
  
  try {
    await redisClient.connect();
    console.log('Connected to Redis');

    // Sample match data
    const matchId = '10752';
    const eventQueueKey = `event:queue:${matchId}`;
    
    // Sample events to inject
    const sampleEvents = [
      {
        eventType: 'boundary',
        timestamp: new Date().toISOString(),
        data: {
          batsman: 'David Warner',
          runs: 4,
          ball: 1,
          over: 1,
          team: 'Australia'
        },
        matchId: matchId
      },
      {
        eventType: 'six',
        timestamp: new Date().toISOString(),
        data: {
          batsman: 'Steve Smith',
          runs: 6,
          ball: 3,
          over: 2,
          team: 'Australia'
        },
        matchId: matchId
      },
      {
        eventType: 'wicket',
        timestamp: new Date().toISOString(),
        data: {
          batsman: 'Marnus Labuschagne',
          wicketType: 'caught',
          bowler: 'Kagiso Rabada',
          ball: 2,
          over: 3,
          team: 'Australia'
        },
        matchId: matchId
      },
      {
        eventType: 'milestone',
        timestamp: new Date().toISOString(),
        data: {
          batsman: 'David Warner',
          milestone: 'fifty',
          runs: 50,
          balls: 35,
          team: 'Australia'
        },
        matchId: matchId
      },
      {
        eventType: 'boundary',
        timestamp: new Date().toISOString(),
        data: {
          batsman: 'Glenn Maxwell',
          runs: 4,
          ball: 4,
          over: 5,
          team: 'Australia'
        },
        matchId: matchId
      }
    ];

    // Clear existing events for this match
    await redisClient.del(eventQueueKey);
    console.log(`Cleared existing events for match ${matchId}`);

    // Inject sample events
    for (const event of sampleEvents) {
      await redisClient.lPush(eventQueueKey, JSON.stringify(event));
      console.log(`Injected ${event.eventType} event for ${event.data.batsman}`);
    }

    // Set TTL for the queue (1 hour)
    await redisClient.expire(eventQueueKey, 3600);
    
    console.log(`\n✅ Successfully injected ${sampleEvents.length} sample events for match ${matchId}`);
    console.log(`Event queue key: ${eventQueueKey}`);
    console.log(`TTL: 3600 seconds (1 hour)`);
    
    // Check if events were stored
    const queueLength = await redisClient.lLen(eventQueueKey);
    console.log(`\nQueue length: ${queueLength} events`);

  } catch (error) {
    console.error('Error injecting sample events:', error);
  } finally {
    await redisClient.quit();
    console.log('\nDisconnected from Redis');
  }
}

// Run the script
injectSampleEvents().catch(console.error);
