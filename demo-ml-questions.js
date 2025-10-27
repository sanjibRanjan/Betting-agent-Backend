'use strict';

/**
 * Enhanced Demo script using ML Prediction Service
 * Shows ML-powered question generation with confidence scores and predictions
 */

const { createClient } = require('redis');
const EnhancedQuestionGenerator = require('./services/enhancedQuestionGenerator');
const MLPredictionService = require('./services/mlPredictionService');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function demoMLQuestions() {
  console.log('🤖 ML-Enhanced Cricket Question Generator Demo');
  console.log('================================================\n');
  
  let redisClient;
  let mlPredictionService;
  let enhancedQuestionGenerator;

  try {
    // Connect to Redis
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    console.log('✅ Connected to Redis\n');

    // Initialize ML Prediction Service
    mlPredictionService = new MLPredictionService({
      mlServiceUrl: 'http://localhost:5001',
      timeout: 5000,
      retryAttempts: 3
    });

    // Check ML service health
    const mlHealth = await mlPredictionService.checkHealth();
    if (!mlHealth) {
      throw new Error('ML service is not healthy');
    }
    console.log('✅ ML Prediction Service is healthy\n');

    // Initialize Enhanced Question Generator with ML service
    enhancedQuestionGenerator = new EnhancedQuestionGenerator(redisClient, mlPredictionService);
    await enhancedQuestionGenerator.start();
    console.log('✅ Enhanced Question Generator started\n');

    // Create sample events with realistic data
    console.log('📝 Creating sample cricket events for ML analysis...\n');
    await createMLTestEvents(redisClient);

    // Wait for processing
    console.log('⏳ Processing events with ML predictions...\n');
    await sleep(5000);

    // Display ML-enhanced questions
    console.log('🎯 ML-Enhanced Questions Demo:\n');
    await displayMLEnhancedQuestions(enhancedQuestionGenerator);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('ML Service Response:', error.response.data);
    }
  } finally {
    if (enhancedQuestionGenerator) await enhancedQuestionGenerator.stop();
    if (redisClient) await redisClient.quit();
    console.log('\n✅ ML Demo completed successfully!');
  }
}

async function createMLTestEvents(redisClient) {
  const mlTestEvents = [
    // Match 1 - High-scoring T20 scenario
    {
      type: 'boundary',
      matchId: 'ml-test-t20-1',
      batsman: 'Virat Kohli',
      bowler: 'Jasprit Bumrah',
      runs: 4,
      over: 15.3,
      timestamp: new Date().toISOString(),
      description: 'Virat Kohli hit a 4 run boundary off Jasprit Bumrah',
      // ML context data
      currentScore: 145,
      wickets: 2,
      ballsRemaining: 27,
      runRate: 8.5,
      requiredRunRate: 9.2,
      batsmanRuns: 45,
      batsmanBalls: 32,
      bowlerOvers: 3.3,
      bowlerRuns: 28,
      bowlerWickets: 1
    },
    {
      type: 'six',
      matchId: 'ml-test-t20-1',
      batsman: 'Virat Kohli',
      bowler: 'Jasprit Bumrah',
      runs: 6,
      over: 15.4,
      timestamp: new Date().toISOString(),
      description: 'Virat Kohli hit a six off Jasprit Bumrah',
      currentScore: 151,
      wickets: 2,
      ballsRemaining: 26,
      runRate: 8.8,
      requiredRunRate: 9.0,
      batsmanRuns: 51,
      batsmanBalls: 33,
      bowlerOvers: 3.4,
      bowlerRuns: 34,
      bowlerWickets: 1
    },
    {
      type: 'wicket',
      matchId: 'ml-test-t20-1',
      batsman: 'Rohit Sharma',
      bowler: 'Mohammed Shami',
      wickets: 3,
      wicketsLost: 1,
      over: 16.1,
      timestamp: new Date().toISOString(),
      description: 'Wicket! Rohit Sharma dismissed by Mohammed Shami',
      currentScore: 155,
      wickets: 3,
      ballsRemaining: 23,
      runRate: 8.6,
      requiredRunRate: 9.1,
      batsmanRuns: 25,
      batsmanBalls: 18,
      bowlerOvers: 2.1,
      bowlerRuns: 15,
      bowlerWickets: 2
    },
    // Match 2 - ODI scenario
    {
      type: 'boundary',
      matchId: 'ml-test-odi-1',
      batsman: 'Kane Williamson',
      bowler: 'Mitchell Starc',
      runs: 4,
      over: 35.2,
      timestamp: new Date().toISOString(),
      description: 'Kane Williamson hit a 4 run boundary off Mitchell Starc',
      currentScore: 180,
      wickets: 4,
      ballsRemaining: 88,
      runRate: 5.1,
      requiredRunRate: 5.8,
      batsmanRuns: 65,
      batsmanBalls: 78,
      bowlerOvers: 7.2,
      bowlerRuns: 35,
      bowlerWickets: 2
    },
    {
      type: 'milestone',
      matchId: 'ml-test-odi-1',
      batsman: 'Kane Williamson',
      bowler: 'Pat Cummins',
      milestone: 50,
      totalRuns: 52,
      over: 36.1,
      timestamp: new Date().toISOString(),
      description: 'Kane Williamson reached 50 runs milestone',
      currentScore: 185,
      wickets: 4,
      ballsRemaining: 83,
      runRate: 5.2,
      requiredRunRate: 5.7,
      batsmanRuns: 52,
      batsmanBalls: 80,
      bowlerOvers: 6.1,
      bowlerRuns: 28,
      bowlerWickets: 1
    }
  ];

  // Group events by match ID
  const eventsByMatch = {};
  mlTestEvents.forEach(event => {
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
        version: '2.0',
        mlContext: {
          currentScore: event.currentScore,
          wickets: event.wickets,
          ballsRemaining: event.ballsRemaining,
          runRate: event.runRate,
          requiredRunRate: event.requiredRunRate,
          batsmanRuns: event.batsmanRuns,
          batsmanBalls: event.batsmanBalls,
          bowlerOvers: event.bowlerOvers,
          bowlerRuns: event.bowlerRuns,
          bowlerWickets: event.bowlerWickets
        }
      };
      
      await redisClient.lPush(queueKey, JSON.stringify(eventMessage));
    }
    
    await redisClient.expire(queueKey, 3600);
    console.log(`📊 Added ${events.length} ML-enhanced events for ${matchId}`);
  }
}

async function displayMLEnhancedQuestions(enhancedQuestionGenerator) {
  const matchIds = ['ml-test-t20-1', 'ml-test-odi-1'];
  
  for (const matchId of matchIds) {
    console.log(`🏏 Match: ${matchId.toUpperCase()}`);
    console.log('─'.repeat(60));
    
    const questions = await enhancedQuestionGenerator.getGeneratedQuestions(matchId, 20);
    const stats = await enhancedQuestionGenerator.getQuestionStats(matchId);
    
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
        console.log(`🎯 ${eventType.toUpperCase()} Event Questions (ML-Enhanced):`);
        console.log('─'.repeat(40));
        
        eventQuestions.slice(0, 3).forEach((question, index) => {
          console.log(`${index + 1}. ${question.questionText}`);
          console.log(`   🎚️  Difficulty: ${question.difficulty}`);
          console.log(`   📂 Category: ${question.category}`);
          console.log(`   🎯 Context: ${question.context}`);
          
          // Display ML-specific data
          if (question.mlPrediction) {
            console.log(`   🤖 ML Prediction: ${question.mlPrediction.prediction}`);
            console.log(`   📈 Confidence: ${question.mlPrediction.confidence}%`);
            if (question.mlPrediction.features) {
              console.log(`   🔍 Key Features: ${Object.keys(question.mlPrediction.features).join(', ')}`);
            }
          }
          
          console.log(`   ⏰ Generated: ${new Date(question.timestamp).toLocaleTimeString()}`);
          console.log('');
        });
        
        if (eventQuestions.length > 3) {
          console.log(`   ... and ${eventQuestions.length - 3} more ML-enhanced questions for this event type\n`);
        }
      }
    } else {
      console.log('❌ No ML-enhanced questions generated for this match\n');
    }
    
    console.log('═'.repeat(60));
    console.log('');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
if (require.main === module) {
  demoMLQuestions().catch(console.error);
}

module.exports = { demoMLQuestions };
