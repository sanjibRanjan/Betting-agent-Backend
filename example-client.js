#!/usr/bin/env node

/**
 * Example Socket.IO Client Usage for Sanjib Agent
 * 
 * This script demonstrates how to use the CricketSocketClient
 * with various configurations and event handling.
 */

const CricketSocketClient = require('./socket-client');

// Example 1: Basic client with default settings
async function basicExample() {
  console.log('=== Basic Client Example ===');
  
  const client = new CricketSocketClient({
    serverUrl: 'http://localhost:3000'
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully!');
    
    // Subscribe to live updates
    client.subscribeToLiveMatches();
    
    // Request current matches
    client.requestCurrentMatches();
    
    // Keep running for 30 seconds
    setTimeout(async () => {
      console.log('📊 Final Statistics:');
      console.log(JSON.stringify(client.getStats(), null, 2));
      await client.shutdown();
    }, 30000);

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
  }
}

// Example 2: Advanced client with custom configuration
async function advancedExample() {
  console.log('\n=== Advanced Client Example ===');
  
  const client = new CricketSocketClient({
    serverUrl: 'http://localhost:3000',
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectDelay: 2000,
    logToFile: true,
    logFilePath: './example-client.log'
  });

  try {
    await client.connect();
    console.log('✅ Advanced client connected!');
    
    // Subscribe to live updates
    client.subscribeToLiveMatches();
    
    // Request current matches
    client.requestCurrentMatches();
    
    // Log statistics every 10 seconds
    const statsInterval = setInterval(() => {
      const stats = client.getStats();
      console.log('📈 Current Stats:', {
        eventsReceived: stats.eventsReceived,
        questionsReceived: stats.questionsReceived,
        averageLatency: Math.round(stats.averageLatency),
        isConnected: stats.isConnected,
        uptimeSeconds: stats.uptimeSeconds
      });
    }, 10000);
    
    // Stop after 60 seconds
    setTimeout(async () => {
      clearInterval(statsInterval);
      console.log('📊 Final Statistics:');
      console.log(JSON.stringify(client.getStats(), null, 2));
      await client.shutdown();
    }, 60000);

  } catch (error) {
    console.error('❌ Advanced client failed:', error.message);
  }
}

// Example 3: Custom event handler
class CustomCricketClient extends CricketSocketClient {
  constructor(options) {
    super(options);
    this.questionCount = 0;
    this.matchUpdateCount = 0;
  }

  handleQuestionEvent(data) {
    this.questionCount++;
    console.log(`🎯 Question #${this.questionCount}:`, {
      question: data.question,
      difficulty: data.difficulty,
      category: data.category,
      matchId: data.matchId
    });
    
    // Call parent handler for logging
    super.handleQuestionEvent(data);
  }

  handleMatchUpdate(data) {
    this.matchUpdateCount++;
    console.log(`🏏 Match Update #${this.matchUpdateCount}:`, {
      matchCount: data.count,
      source: data.source,
      changeType: data.changeType || 'update'
    });
    
    // Call parent handler for logging
    super.handleMatchUpdate(data);
  }

  getCustomStats() {
    return {
      ...this.getStats(),
      customQuestionCount: this.questionCount,
      customMatchUpdateCount: this.matchUpdateCount
    };
  }
}

async function customHandlerExample() {
  console.log('\n=== Custom Handler Example ===');
  
  const client = new CustomCricketClient({
    serverUrl: 'http://localhost:3000'
  });

  try {
    await client.connect();
    console.log('✅ Custom client connected!');
    
    client.subscribeToLiveMatches();
    client.requestCurrentMatches();
    
    // Log custom stats every 15 seconds
    const statsInterval = setInterval(() => {
      const stats = client.getCustomStats();
      console.log('🎯 Custom Stats:', {
        eventsReceived: stats.eventsReceived,
        questionsReceived: stats.customQuestionCount,
        matchUpdates: stats.customMatchUpdateCount,
        averageLatency: Math.round(stats.averageLatency)
      });
    }, 15000);
    
    // Stop after 45 seconds
    setTimeout(async () => {
      clearInterval(statsInterval);
      console.log('📊 Final Custom Statistics:');
      console.log(JSON.stringify(client.getCustomStats(), null, 2));
      await client.shutdown();
    }, 45000);

  } catch (error) {
    console.error('❌ Custom client failed:', error.message);
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting Socket.IO Client Examples\n');
  
  // Run examples sequentially
  try {
    await basicExample();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    await advancedExample();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    await customHandlerExample();
    
    console.log('\n✅ All examples completed successfully!');
    
  } catch (error) {
    console.error('❌ Example execution failed:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, exiting...');
  process.exit(0);
});

// Start the examples
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Main execution failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  basicExample,
  advancedExample,
  customHandlerExample,
  CustomCricketClient
};
