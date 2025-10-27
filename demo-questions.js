'use strict';

/**
 * Demo script to show detailed examples of generated questions
 */

const { createClient } = require('redis');
const QuestionGenerator = require('./services/questionGenerator');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function demoQuestions() {
  console.log('🏏 Cricket Question Generator Demo');
  console.log('=====================================\n');
  
  let redisClient;
  let questionGenerator;

  try {
    // Connect to Redis
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    console.log('✅ Connected to Redis\n');

    // Initialize Question Generator
    questionGenerator = new QuestionGenerator(redisClient);
    await questionGenerator.start();
    console.log('✅ Question Generator started\n');

    // Create sample events with more realistic data
    console.log('📝 Creating sample cricket events...\n');
    await createRealisticEvents(redisClient);

    // Wait for processing
    console.log('⏳ Processing events and generating questions...\n');
    await sleep(3000);

    // Display detailed questions
    console.log('🎯 Generated Questions Demo:\n');
    await displayDetailedQuestions(questionGenerator);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (questionGenerator) await questionGenerator.stop();
    if (redisClient) await redisClient.quit();
    console.log('\n✅ Demo completed successfully!');
  }
}

async function createRealisticEvents(redisClient) {
  const realisticEvents = [
    // Match 1 - IPL scenario
    {
      type: 'boundary',
      matchId: 'ipl_match_1',
      batsman: 'Virat Kohli',
      bowler: 'Jasprit Bumrah',
      runs: 4,
      over: 15.3,
      timestamp: new Date().toISOString(),
      description: 'Virat Kohli hit a 4 run boundary off Jasprit Bumrah'
    },
    {
      type: 'six',
      matchId: 'ipl_match_1',
      batsman: 'Virat Kohli',
      bowler: 'Jasprit Bumrah',
      runs: 6,
      over: 15.4,
      timestamp: new Date().toISOString(),
      description: 'Virat Kohli hit a six off Jasprit Bumrah'
    },
    {
      type: 'wicket',
      matchId: 'ipl_match_1',
      batsman: 'Rohit Sharma',
      bowler: 'Mohammed Shami',
      wickets: 3,
      wicketsLost: 1,
      over: 16.1,
      timestamp: new Date().toISOString(),
      description: 'Wicket! Rohit Sharma dismissed by Mohammed Shami (3/1 wickets)'
    },
    {
      type: 'milestone',
      matchId: 'ipl_match_1',
      batsman: 'Virat Kohli',
      bowler: 'Ravindra Jadeja',
      milestone: 50,
      totalRuns: 52,
      over: 17.2,
      timestamp: new Date().toISOString(),
      description: 'Virat Kohli reached 50 runs milestone (Total: 52)'
    },
    {
      type: 'new_over',
      matchId: 'ipl_match_1',
      batsman: 'Virat Kohli',
      bowler: 'Ravindra Jadeja',
      over: 18,
      previousOver: 17,
      timestamp: new Date().toISOString(),
      description: 'New over 18 started, Ravindra Jadeja bowling to Virat Kohli'
    },
    // Match 2 - Test match scenario
    {
      type: 'boundary',
      matchId: 'test_match_1',
      batsman: 'Kane Williamson',
      bowler: 'Mitchell Starc',
      runs: 4,
      over: 45.2,
      timestamp: new Date().toISOString(),
      description: 'Kane Williamson hit a 4 run boundary off Mitchell Starc'
    },
    {
      type: 'six',
      matchId: 'test_match_1',
      batsman: 'Kane Williamson',
      bowler: 'Mitchell Starc',
      runs: 6,
      over: 45.3,
      timestamp: new Date().toISOString(),
      description: 'Kane Williamson hit a six off Mitchell Starc'
    },
    {
      type: 'milestone',
      matchId: 'test_match_1',
      batsman: 'Kane Williamson',
      bowler: 'Pat Cummins',
      milestone: 100,
      totalRuns: 102,
      over: 46.1,
      timestamp: new Date().toISOString(),
      description: 'Kane Williamson reached 100 runs milestone (Total: 102)'
    }
  ];

  // Group events by match ID
  const eventsByMatch = {};
  realisticEvents.forEach(event => {
    if (!eventsByMatch[event.matchId]) {
      eventsByMatch[event.matchId] = [];
    }
    eventsByMatch[event.matchId].push(event);
  });

  // Add events to Redis queues
  for (const [matchId, events] of Object.entries(eventsByMatch)) {
    const queueKey = `event:queue:${matchId}`;
    
    for (const event of events) {
      const eventMessage = {
        ...event,
        publishedAt: new Date().toISOString(),
        version: '1.0'
      };
      
      await redisClient.lPush(queueKey, JSON.stringify(eventMessage));
    }
    
    await redisClient.expire(queueKey, 3600);
    console.log(`📊 Added ${events.length} events for ${matchId}`);
  }
}

async function displayDetailedQuestions(questionGenerator) {
  const matchIds = ['test-match-1', 'test-match-2', 'ipl-2025-mi-vs-csk', 'world-cup-2025-ind-vs-pak'];
  
  for (const matchId of matchIds) {
    console.log(`🏏 Match: ${matchId.toUpperCase()}`);
    console.log('─'.repeat(50));
    
    const questions = await questionGenerator.getGeneratedQuestions(matchId, 20);
    const stats = await questionGenerator.getQuestionStats(matchId);
    
    console.log(`📊 Total Questions Generated: ${stats.totalQuestions}`);
    console.log(`⏰ TTL: ${Math.floor(stats.ttl / 60)} minutes remaining\n`);
    
    if (questions.length > 0) {
      // Group questions by event type
      const questionsByType = {};
      questions.forEach(q => {
        if (!questionsByType[q.eventType]) {
          questionsByType[q.eventType] = [];
        }
        questionsByType[q.eventType].push(q);
      });
      
      // Display questions by event type
      for (const [eventType, eventQuestions] of Object.entries(questionsByType)) {
        console.log(`🎯 ${eventType.toUpperCase()} Event Questions:`);
        console.log('─'.repeat(30));
        
        eventQuestions.slice(0, 3).forEach((question, index) => {
          console.log(`${index + 1}. ${question.questionText}`);
          console.log(`   🎚️  Difficulty: ${question.difficulty}`);
          console.log(`   📂 Category: ${question.category}`);
          console.log(`   🎯 Context: ${question.context}`);
          console.log(`   ⏰ Generated: ${new Date(question.timestamp).toLocaleTimeString()}`);
          console.log('');
        });
        
        if (eventQuestions.length > 3) {
          console.log(`   ... and ${eventQuestions.length - 3} more questions for this event type\n`);
        }
      }
    } else {
      console.log('❌ No questions generated for this match\n');
    }
    
    console.log('═'.repeat(50));
    console.log('');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
if (require.main === module) {
  demoQuestions().catch(console.error);
}

module.exports = { demoQuestions };
