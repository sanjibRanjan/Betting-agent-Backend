'use strict';

/**
 * Demo Script for Question Streaming Clients
 * 
 * This script demonstrates how to use both the Socket.IO and REST API clients
 * to connect to the Sanjib Agent question broadcasting service and display
 * dynamically generated betting questions in real-time.
 * 
 * Features demonstrated:
 * - Socket.IO real-time question streaming
 * - REST API question fetching
 * - Filtering by match ID and confidence threshold
 * - Question interaction (answering, skipping)
 * - Statistics tracking and monitoring
 * - Multiple display modes
 */

const QuestionStreamingClient = require('./question-streaming-client');
const QuestionRESTClient = require('./question-rest-client');

class QuestionClientDemo {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || 'http://localhost:5000';
    this.displayMode = options.displayMode || 'console';
    this.demoMode = options.demoMode || 'both'; // 'socket', 'rest', 'both'
    
    // Initialize clients
    this.socketClient = new QuestionStreamingClient({
      serverUrl: this.serverUrl,
      displayMode: this.displayMode,
      logToFile: false
    });
    
    this.restClient = new QuestionRESTClient({
      serverUrl: this.serverUrl,
      displayMode: this.displayMode,
      pollInterval: 30000,
      logToFile: false
    });
    
    // Demo state
    this.isRunning = false;
    this.demoStats = {
      startTime: null,
      questionsReceived: 0,
      socketEvents: 0,
      restRequests: 0,
      interactions: 0
    };
  }

  /**
   * Log demo message
   */
  log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] DEMO: ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  /**
   * Start the demo
   */
  async start() {
    this.isRunning = true;
    this.demoStats.startTime = new Date().toISOString();
    
    this.log('Starting Question Streaming Demo', {
      serverUrl: this.serverUrl,
      displayMode: this.displayMode,
      demoMode: this.demoMode
    });

    try {
      // Start Socket.IO client if enabled
      if (this.demoMode === 'socket' || this.demoMode === 'both') {
        await this.startSocketClient();
      }

      // Start REST API client if enabled
      if (this.demoMode === 'rest' || this.demoMode === 'both') {
        await this.startRestClient();
      }

      // Set up demo interactions
      this.setupDemoInteractions();

      // Start statistics reporting
      this.startStatsReporting();

      this.log('Demo started successfully! Press Ctrl+C to stop.');

    } catch (error) {
      this.log('Failed to start demo', { error: error.message });
      throw error;
    }
  }

  /**
   * Start Socket.IO client
   */
  async startSocketClient() {
    this.log('Starting Socket.IO client...');
    
    await this.socketClient.connect();
    
    // Set up filters
    this.socketClient.setFilters({
      minConfidence: 0.5, // Only show questions with >50% confidence
      mlEnhanced: true    // Only show ML-enhanced questions
    });
    
    // Subscribe to all matches (you can specify a particular match ID)
    // this.socketClient.subscribeToMatch('specific-match-id');
    
    this.log('Socket.IO client connected and configured');
  }

  /**
   * Start REST API client
   */
  async startRestClient() {
    this.log('Starting REST API client...');
    
    // Set up filters
    this.restClient.setFilters({
      minConfidence: 0.5, // Only show questions with >50% confidence
      mlEnhanced: true,    // Only show ML-enhanced questions
      limit: 20           // Limit to 20 questions per request
    });
    
    // Start polling for active questions
    this.restClient.startPolling({
      interval: 30000,    // Poll every 30 seconds
      fetchType: 'active' // Fetch all active questions
    });
    
    this.log('REST API client started and polling');
  }

  /**
   * Set up demo interactions
   */
  setupDemoInteractions() {
    // Demo: Answer some questions after 2 minutes
    setTimeout(() => {
      this.demoAnswerQuestions();
    }, 120000); // 2 minutes

    // Demo: Skip some questions after 4 minutes
    setTimeout(() => {
      this.demoSkipQuestions();
    }, 240000); // 4 minutes

    // Demo: Change filters after 6 minutes
    setTimeout(() => {
      this.demoChangeFilters();
    }, 360000); // 6 minutes

    // Demo: Fetch specific match questions after 8 minutes
    setTimeout(() => {
      this.demoFetchMatchQuestions();
    }, 480000); // 8 minutes
  }

  /**
   * Demo: Answer some questions
   */
  async demoAnswerQuestions() {
    this.log('Demo: Answering some questions...');
    
    const recentQuestions = this.socketClient.getRecentQuestions(3);
    
    for (const question of recentQuestions) {
      if (question.questionId) {
        const answer = Math.random() > 0.5 ? 'Yes' : 'No';
        const confidence = 0.7 + Math.random() * 0.3; // 70-100% confidence
        
        this.socketClient.answerQuestion(question.questionId, answer, confidence);
        this.demoStats.interactions++;
        
        this.log(`Answered question ${question.questionId}`, {
          answer,
          confidence: Math.round(confidence * 100) + '%'
        });
        
        // Small delay between answers
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Demo: Skip some questions
   */
  async demoSkipQuestions() {
    this.log('Demo: Skipping some questions...');
    
    const recentQuestions = this.restClient.getRecentQuestions(2);
    
    for (const question of recentQuestions) {
      if (question.questionId) {
        const reasons = ['Not interested', 'Too difficult', 'Unclear question'];
        const reason = reasons[Math.floor(Math.random() * reasons.length)];
        
        this.restClient.skipQuestion(question.questionId, reason);
        this.demoStats.interactions++;
        
        this.log(`Skipped question ${question.questionId}`, {
          reason
        });
        
        // Small delay between skips
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Demo: Change filters
   */
  demoChangeFilters() {
    this.log('Demo: Changing filters...');
    
    // Change to show only high-confidence questions
    const newFilters = {
      minConfidence: 0.8, // Only >80% confidence
      category: 'batting'  // Only batting questions
    };
    
    this.socketClient.setFilters(newFilters);
    this.restClient.setFilters(newFilters);
    
    this.log('Updated filters', newFilters);
  }

  /**
   * Demo: Fetch specific match questions
   */
  async demoFetchMatchQuestions() {
    this.log('Demo: Fetching questions for specific matches...');
    
    // Get some match IDs from recent questions
    const recentQuestions = this.restClient.getRecentQuestions(10);
    const matchIds = [...new Set(recentQuestions.map(q => q.matchId))].slice(0, 2);
    
    for (const matchId of matchIds) {
      if (matchId) {
        this.log(`Fetching questions for match ${matchId}`);
        
        // Fetch via REST API
        const questions = await this.restClient.fetchMatchQuestions(matchId, { limit: 10 });
        
        // Get match statistics
        const stats = await this.restClient.getMatchQuestionStats(matchId);
        
        this.log(`Match ${matchId} results`, {
          questionCount: questions.length,
          stats: stats
        });
        
        this.demoStats.restRequests++;
      }
    }
  }

  /**
   * Start statistics reporting
   */
  startStatsReporting() {
    // Report statistics every 60 seconds
    setInterval(() => {
      this.reportStats();
    }, 60000);
  }

  /**
   * Report current statistics
   */
  reportStats() {
    const socketStats = this.socketClient.getStats();
    const restStats = this.restClient.getStats();
    
    const combinedStats = {
      demo: {
        ...this.demoStats,
        uptimeSeconds: Math.floor((Date.now() - new Date(this.demoStats.startTime).getTime()) / 1000)
      },
      socket: {
        isConnected: socketStats.isConnected,
        questionsReceived: socketStats.questionsReceived,
        questionsDisplayed: socketStats.questionsDisplayed,
        subscribedMatches: socketStats.subscribedMatches.length,
        reconnectCount: socketStats.reconnectCount
      },
      rest: {
        requestsMade: restStats.requestsMade,
        requestsSuccessful: restStats.requestsSuccessful,
        requestsFailed: restStats.requestsFailed,
        questionsReceived: restStats.questionsReceived,
        questionsDisplayed: restStats.questionsDisplayed,
        averageResponseTime: Math.round(restStats.averageResponseTime),
        isPolling: restStats.isPolling
      },
      filters: {
        socket: socketStats.filters,
        rest: restStats.filters
      }
    };
    
    this.log('Demo Statistics Report', combinedStats);
  }

  /**
   * Stop the demo
   */
  async stop() {
    this.log('Stopping demo...');
    
    this.isRunning = false;
    
    // Stop clients
    this.socketClient.disconnect();
    this.restClient.stopPolling();
    
    // Final statistics
    this.reportStats();
    
    this.log('Demo stopped');
  }
}

// Export the demo class
module.exports = QuestionClientDemo;

// If running directly, start the demo
if (require.main === module) {
  const demo = new QuestionClientDemo({
    serverUrl: process.env.SERVER_URL || 'http://localhost:5000',
    displayMode: process.env.DISPLAY_MODE || 'console',
    demoMode: process.env.DEMO_MODE || 'both'
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, stopping demo...');
    await demo.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, stopping demo...');
    await demo.stop();
    process.exit(0);
  });

  // Start the demo
  (async () => {
    try {
      await demo.start();
    } catch (error) {
      console.error('Demo failed:', error.message);
      process.exit(1);
    }
  })();
}
