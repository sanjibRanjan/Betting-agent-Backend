#!/usr/bin/env node

'use strict';

/**
 * Simple Usage Example for Question Streaming Clients
 * 
 * This script demonstrates the basic usage of both clients with minimal configuration.
 * Perfect for getting started quickly.
 */

const QuestionStreamingClient = require('./question-streaming-client');
const QuestionRESTClient = require('./question-rest-client');

async function runSimpleExample() {
  console.log('🚀 Sanjib Agent Question Streaming - Simple Example');
  console.log('=' .repeat(60));
  
  const serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
  
  try {
    // Example 1: Socket.IO Real-time Streaming
    console.log('\n📡 Starting Socket.IO Real-time Streaming...');
    
    const socketClient = new QuestionStreamingClient({
      serverUrl: serverUrl,
      displayMode: 'console'
    });
    
    await socketClient.connect();
    
    // Set basic filters
    socketClient.setFilters({
      minConfidence: 0.6,  // Only show questions with >60% confidence
      mlEnhanced: true      // Only ML-enhanced questions
    });
    
    console.log('✅ Socket.IO client connected! Listening for questions...');
    
    // Example 2: REST API Polling
    console.log('\n🔄 Starting REST API Polling...');
    
    const restClient = new QuestionRESTClient({
      serverUrl: serverUrl,
      displayMode: 'console',
      pollInterval: 20000  // Poll every 20 seconds
    });
    
    // Set same filters
    restClient.setFilters({
      minConfidence: 0.6,
      mlEnhanced: true,
      limit: 10  // Limit to 10 questions per request
    });
    
    // Start polling
    restClient.startPolling({
      fetchType: 'active'
    });
    
    console.log('✅ REST API client started! Polling every 20 seconds...');
    
    // Example 3: Show statistics every 30 seconds
    console.log('\n📊 Statistics will be displayed every 30 seconds...');
    console.log('Press Ctrl+C to stop\n');
    
    const statsInterval = setInterval(() => {
      console.log('\n' + '-'.repeat(40));
      console.log('📊 CURRENT STATISTICS');
      console.log('-'.repeat(40));
      
      const socketStats = socketClient.getStats();
      const restStats = restClient.getStats();
      
      console.log(`Socket.IO Client:`);
      console.log(`  Connected: ${socketStats.isConnected ? '✅' : '❌'}`);
      console.log(`  Questions Received: ${socketStats.questionsReceived}`);
      console.log(`  Questions Displayed: ${socketStats.questionsDisplayed}`);
      console.log(`  Uptime: ${socketStats.uptimeSeconds}s`);
      
      console.log(`\nREST API Client:`);
      console.log(`  Requests Made: ${restStats.requestsMade}`);
      console.log(`  Success Rate: ${restStats.requestsSuccessful}/${restStats.requestsMade} (${Math.round(restStats.requestsSuccessful/restStats.requestsMade*100)}%)`);
      console.log(`  Questions Received: ${restStats.questionsReceived}`);
      console.log(`  Average Response Time: ${Math.round(restStats.averageResponseTime)}ms`);
      
      console.log(`\nFilters Applied:`);
      console.log(`  Min Confidence: ${socketStats.filters.minConfidence * 100}%`);
      console.log(`  ML Enhanced: ${socketStats.filters.mlEnhanced ? 'Yes' : 'No'}`);
      console.log(`  Category: ${socketStats.filters.category || 'All'}`);
      console.log(`  Difficulty: ${socketStats.filters.difficulty || 'All'}`);
      
    }, 30000);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down gracefully...');
      
      clearInterval(statsInterval);
      socketClient.disconnect();
      restClient.stopPolling();
      
      console.log('✅ Shutdown complete. Goodbye!');
      process.exit(0);
    });
    
    // Keep the process running
    await new Promise(() => {});
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 Make sure the Sanjib Agent server is running on', serverUrl);
    console.log('   You can start it with: npm start');
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  runSimpleExample();
}

module.exports = { runSimpleExample };
