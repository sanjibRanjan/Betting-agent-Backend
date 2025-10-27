#!/usr/bin/env node

/**
 * Mock Data Injection System for Testing ML Question Generation
 * This script injects mock cricket events to test the ML prediction models
 * and enhanced question generator in a controlled environment
 */

const { createClient } = require('redis');
const logger = require('./utils/loggerService');

class MockDataInjector {
  constructor() {
    this.redisClient = createClient({ url: 'redis://127.0.0.1:6379' });
    this.isConnected = false;
    this.mockMatchId = 'mock_match_12345';
    this.eventCounter = 0;
    this.mockEvents = this.generateMockEvents();
  }

  /**
   * Generate realistic mock cricket events
   * @returns {Array} Array of mock event objects
   */
  generateMockEvents() {
    return [
      // Boundary events
      {
        type: 'boundary',
        matchId: this.mockMatchId,
        batsman: 'Virat Kohli',
        bowler: 'Mitchell Starc',
        runs: 4,
        over: 5.2,
        innings: 1,
        totalRuns: 45,
        totalWickets: 1,
        runRate: 9.0,
        requiredRunRate: 8.5,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date().toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 25,
        batsmanBalls: 18,
        batsmanStrikeRate: 138.9,
        bowlerRuns: 12,
        bowlerWickets: 1,
        bowlerBalls: 12,
        bowlerEconomyRate: 6.0,
        recentRunRate: 9.5,
        wicketsInHand: 9,
        pressureIndex: 0.3,
        partnershipRuns: 35,
        partnershipBalls: 24
      },
      {
        type: 'six',
        matchId: this.mockMatchId,
        batsman: 'Rohit Sharma',
        bowler: 'Pat Cummins',
        runs: 6,
        over: 6.1,
        innings: 1,
        totalRuns: 51,
        totalWickets: 1,
        runRate: 8.5,
        requiredRunRate: 8.2,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 1000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 20,
        batsmanBalls: 15,
        batsmanStrikeRate: 133.3,
        bowlerRuns: 8,
        bowlerWickets: 0,
        bowlerBalls: 6,
        bowlerEconomyRate: 8.0,
        recentRunRate: 10.0,
        wicketsInHand: 9,
        pressureIndex: 0.2,
        partnershipRuns: 41,
        partnershipBalls: 30
      },
      // Wicket events
      {
        type: 'wicket',
        matchId: this.mockMatchId,
        batsman: 'Virat Kohli',
        bowler: 'Mitchell Starc',
        runs: 0,
        over: 7.3,
        innings: 1,
        totalRuns: 65,
        totalWickets: 2,
        runRate: 9.3,
        requiredRunRate: 7.8,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 2000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 30,
        batsmanBalls: 22,
        batsmanStrikeRate: 136.4,
        bowlerRuns: 18,
        bowlerWickets: 2,
        bowlerBalls: 18,
        bowlerEconomyRate: 6.0,
        recentRunRate: 8.5,
        wicketsInHand: 8,
        pressureIndex: 0.4,
        partnershipRuns: 0,
        partnershipBalls: 0
      },
      // New over events
      {
        type: 'new_over',
        matchId: this.mockMatchId,
        batsman: 'Suryakumar Yadav',
        bowler: 'Adam Zampa',
        runs: 0,
        over: 8.0,
        innings: 1,
        totalRuns: 65,
        totalWickets: 2,
        runRate: 8.1,
        requiredRunRate: 7.5,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 3000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 0,
        batsmanBalls: 0,
        batsmanStrikeRate: 0,
        bowlerRuns: 0,
        bowlerWickets: 0,
        bowlerBalls: 0,
        bowlerEconomyRate: 0,
        recentRunRate: 8.0,
        wicketsInHand: 8,
        pressureIndex: 0.5,
        partnershipRuns: 0,
        partnershipBalls: 0
      },
      // Milestone events
      {
        type: 'milestone',
        matchId: this.mockMatchId,
        batsman: 'Rohit Sharma',
        bowler: 'Adam Zampa',
        runs: 1,
        over: 8.2,
        innings: 1,
        totalRuns: 70,
        totalWickets: 2,
        runRate: 8.75,
        requiredRunRate: 7.2,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 4000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 25,
        batsmanBalls: 20,
        batsmanStrikeRate: 125.0,
        bowlerRuns: 5,
        bowlerWickets: 0,
        bowlerBalls: 6,
        bowlerEconomyRate: 5.0,
        recentRunRate: 8.5,
        wicketsInHand: 8,
        pressureIndex: 0.3,
        partnershipRuns: 5,
        partnershipBalls: 6,
        milestone: '50 runs'
      },
      // More boundary events
      {
        type: 'boundary',
        matchId: this.mockMatchId,
        batsman: 'Suryakumar Yadav',
        bowler: 'Adam Zampa',
        runs: 4,
        over: 8.4,
        innings: 1,
        totalRuns: 74,
        totalWickets: 2,
        runRate: 9.25,
        requiredRunRate: 6.8,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 5000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 4,
        batsmanBalls: 2,
        batsmanStrikeRate: 200.0,
        bowlerRuns: 9,
        bowlerWickets: 0,
        bowlerBalls: 12,
        bowlerEconomyRate: 4.5,
        recentRunRate: 9.0,
        wicketsInHand: 8,
        pressureIndex: 0.2,
        partnershipRuns: 9,
        partnershipBalls: 8
      },
      // Six event
      {
        type: 'six',
        matchId: this.mockMatchId,
        batsman: 'Rohit Sharma',
        bowler: 'Pat Cummins',
        runs: 6,
        over: 9.1,
        innings: 1,
        totalRuns: 80,
        totalWickets: 2,
        runRate: 8.9,
        requiredRunRate: 6.5,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 6000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 31,
        batsmanBalls: 24,
        batsmanStrikeRate: 129.2,
        bowlerRuns: 14,
        bowlerWickets: 0,
        bowlerBalls: 12,
        bowlerEconomyRate: 7.0,
        recentRunRate: 9.5,
        wicketsInHand: 8,
        pressureIndex: 0.1,
        partnershipRuns: 15,
        partnershipBalls: 12
      },
      // Wicket event
      {
        type: 'wicket',
        matchId: this.mockMatchId,
        batsman: 'Rohit Sharma',
        bowler: 'Pat Cummins',
        runs: 0,
        over: 9.4,
        innings: 1,
        totalRuns: 85,
        totalWickets: 3,
        runRate: 8.5,
        requiredRunRate: 6.2,
        venue: 'MCG, Melbourne',
        format: 'T20',
        series: 'World Cup 2024',
        timestamp: new Date(Date.now() + 7000).toISOString(),
        teamBatting: 'India',
        teamBowling: 'Australia',
        batsmanRuns: 31,
        batsmanBalls: 27,
        batsmanStrikeRate: 114.8,
        bowlerRuns: 20,
        bowlerWickets: 1,
        bowlerBalls: 18,
        bowlerEconomyRate: 6.7,
        recentRunRate: 8.0,
        wicketsInHand: 7,
        pressureIndex: 0.6,
        partnershipRuns: 0,
        partnershipBalls: 0
      }
    ];
  }

  /**
   * Connect to Redis
   * @returns {Promise<boolean>} Connection success status
   */
  async connect() {
    try {
      await this.redisClient.connect();
      this.isConnected = true;
      logger.info('MockDataInjector connected to Redis');
      return true;
    } catch (error) {
      logger.error('Failed to connect to Redis', { error: error.message });
      return false;
    }
  }

  /**
   * Disconnect from Redis
   * @returns {Promise<boolean>} Disconnection success status
   */
  async disconnect() {
    try {
      await this.redisClient.disconnect();
      this.isConnected = false;
      logger.info('MockDataInjector disconnected from Redis');
      return true;
    } catch (error) {
      logger.error('Failed to disconnect from Redis', { error: error.message });
      return false;
    }
  }

  /**
   * Inject a single mock event into the event queue
   * @param {Object} event Mock event object
   * @returns {Promise<boolean>} Success status
   */
  async injectEvent(event) {
    try {
      const queueKey = `event:queue:${event.matchId}`;
      await this.redisClient.lPush(queueKey, JSON.stringify(event));
      
      logger.info(`Injected mock event: ${event.type}`, {
        matchId: event.matchId,
        batsman: event.batsman,
        bowler: event.bowler,
        over: event.over,
        queueKey
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to inject mock event', {
        eventType: event.type,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Inject all mock events with delays to simulate real-time
   * @param {number} delayMs Delay between events in milliseconds
   * @returns {Promise<Object>} Injection results
   */
  async injectAllEvents(delayMs = 2000) {
    try {
      logger.info(`Starting mock data injection with ${delayMs}ms delay between events`);
      
      const results = {
        totalEvents: this.mockEvents.length,
        successfulInjections: 0,
        failedInjections: 0,
        errors: []
      };

      for (let i = 0; i < this.mockEvents.length; i++) {
        const event = this.mockEvents[i];
        
        try {
          const success = await this.injectEvent(event);
          if (success) {
            results.successfulInjections++;
          } else {
            results.failedInjections++;
            results.errors.push(`Failed to inject event ${i + 1}: ${event.type}`);
          }
          
          // Add delay between events (except for the last one)
          if (i < this.mockEvents.length - 1) {
            await this.sleep(delayMs);
          }
          
        } catch (error) {
          results.failedInjections++;
          results.errors.push(`Error injecting event ${i + 1}: ${error.message}`);
          logger.error('Error during event injection', {
            eventIndex: i + 1,
            eventType: event.type,
            error: error.message
          });
        }
      }

      logger.info('Mock data injection completed', results);
      return results;

    } catch (error) {
      logger.error('Failed to inject all mock events', { error: error.message });
      return {
        totalEvents: this.mockEvents.length,
        successfulInjections: 0,
        failedInjections: this.mockEvents.length,
        errors: [error.message]
      };
    }
  }

  /**
   * Inject events continuously to simulate ongoing match
   * @param {number} intervalMs Interval between event batches
   * @param {number} eventsPerBatch Number of events per batch
   * @returns {Promise<void>}
   */
  async injectEventsContinuously(intervalMs = 10000, eventsPerBatch = 2) {
    logger.info(`Starting continuous mock data injection (${eventsPerBatch} events every ${intervalMs}ms)`);
    
    let batchCount = 0;
    
    while (true) {
      try {
        batchCount++;
        logger.info(`Injecting batch ${batchCount}`);
        
        // Get random events for this batch
        const batchEvents = this.getRandomEvents(eventsPerBatch);
        
        for (const event of batchEvents) {
          await this.injectEvent(event);
          await this.sleep(1000); // 1 second between events in batch
        }
        
        await this.sleep(intervalMs);
        
      } catch (error) {
        logger.error('Error in continuous injection', { error: error.message });
        await this.sleep(intervalMs);
      }
    }
  }

  /**
   * Get random events from the mock events pool
   * @param {number} count Number of events to return
   * @returns {Array} Array of random events
   */
  getRandomEvents(count) {
    const shuffled = [...this.mockEvents].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(event => ({
      ...event,
      timestamp: new Date().toISOString(),
      over: (Math.random() * 20).toFixed(1), // Random over
      totalRuns: Math.floor(Math.random() * 200) + 50, // Random total runs
      totalWickets: Math.floor(Math.random() * 8) + 1 // Random wickets
    }));
  }

  /**
   * Clear all mock data from Redis
   * @returns {Promise<boolean>} Success status
   */
  async clearMockData() {
    try {
      const keys = await this.redisClient.keys(`event:queue:${this.mockMatchId}`);
      if (keys.length > 0) {
        await this.redisClient.del(keys);
        logger.info(`Cleared ${keys.length} mock event queues`);
      }
      
      // Clear generated questions
      const questionKeys = await this.redisClient.keys(`questions:enhanced:${this.mockMatchId}`);
      if (questionKeys.length > 0) {
        await this.redisClient.del(questionKeys);
        logger.info(`Cleared ${questionKeys.length} mock question queues`);
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to clear mock data', { error: error.message });
      return false;
    }
  }

  /**
   * Get status of mock data injection
   * @returns {Promise<Object>} Status information
   */
  async getStatus() {
    try {
      const eventQueueKey = `event:queue:${this.mockMatchId}`;
      const questionKey = `questions:enhanced:${this.mockMatchId}`;
      
      const eventCount = await this.redisClient.lLen(eventQueueKey);
      const questionCount = await this.redisClient.lLen(questionKey);
      
      return {
        connected: this.isConnected,
        mockMatchId: this.mockMatchId,
        totalMockEvents: this.mockEvents.length,
        eventsInQueue: eventCount,
        questionsGenerated: questionCount,
        eventTypes: [...new Set(this.mockEvents.map(e => e.type))],
        status: 'ready'
      };
    } catch (error) {
      logger.error('Failed to get mock data status', { error: error.message });
      return {
        connected: this.isConnected,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Sleep utility function
   * @param {number} ms Milliseconds to sleep
   * @returns {Promise} Promise that resolves after specified time
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'inject';
  
  const injector = new MockDataInjector();
  
  try {
    await injector.connect();
    
    switch (command) {
      case 'inject':
        const delay = parseInt(args[1]) || 2000;
        await injector.injectAllEvents(delay);
        break;
        
      case 'continuous':
        const interval = parseInt(args[1]) || 10000;
        const batchSize = parseInt(args[2]) || 2;
        await injector.injectEventsContinuously(interval, batchSize);
        break;
        
      case 'clear':
        await injector.clearMockData();
        console.log('✅ Mock data cleared');
        break;
        
      case 'status':
        const status = await injector.getStatus();
        console.log('📊 Mock Data Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log(`
🎯 Mock Data Injector for ML Question Generation Testing

Usage:
  node mock-data-injector.js <command> [options]

Commands:
  inject [delay]           Inject all mock events with delay (default: 2000ms)
  continuous [interval] [batch]  Inject events continuously (default: 10000ms, 2 events)
  clear                    Clear all mock data
  status                   Show current status

Examples:
  node mock-data-injector.js inject 1000
  node mock-data-injector.js continuous 5000 3
  node mock-data-injector.js clear
  node mock-data-injector.js status
        `);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await injector.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = MockDataInjector;


