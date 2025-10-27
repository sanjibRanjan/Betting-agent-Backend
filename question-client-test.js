'use strict';

/**
 * Test Script for Question Streaming Clients
 * 
 * This script tests the functionality of both the Socket.IO and REST API clients
 * to ensure they can connect to the Sanjib Agent question broadcasting service
 * and handle questions correctly.
 */

const QuestionStreamingClient = require('./question-streaming-client');
const QuestionRESTClient = require('./question-rest-client');

class QuestionClientTester {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || 'http://localhost:5000';
    this.testTimeout = options.testTimeout || 30000; // 30 seconds
    this.results = {
      socketClient: { passed: 0, failed: 0, tests: [] },
      restClient: { passed: 0, failed: 0, tests: [] },
      overall: { passed: 0, failed: 0, startTime: null, endTime: null }
    };
  }

  /**
   * Log test message
   */
  log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] TEST: ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  /**
   * Run all tests
   */
  async runTests() {
    this.results.overall.startTime = new Date().toISOString();
    this.log('Starting Question Client Tests', {
      serverUrl: this.serverUrl,
      testTimeout: this.testTimeout
    });

    try {
      // Test Socket.IO client
      await this.testSocketClient();
      
      // Test REST API client
      await this.testRestClient();
      
      // Generate test report
      this.generateReport();
      
    } catch (error) {
      this.log('Test suite failed', { error: error.message });
      this.results.overall.failed++;
    } finally {
      this.results.overall.endTime = new Date().toISOString();
    }
  }

  /**
   * Test Socket.IO client functionality
   */
  async testSocketClient() {
    this.log('Testing Socket.IO Client...');
    
    const client = new QuestionStreamingClient({
      serverUrl: this.serverUrl,
      displayMode: 'json',
      autoReconnect: false // Disable auto-reconnect for testing
    });

    // Test 1: Connection
    await this.testSocketConnection(client);
    
    // Test 2: Filtering
    await this.testSocketFiltering(client);
    
    // Test 3: Event Handling
    await this.testSocketEvents(client);
    
    // Test 4: Statistics
    await this.testSocketStatistics(client);
    
    // Cleanup
    client.disconnect();
  }

  /**
   * Test Socket.IO connection
   */
  async testSocketConnection(client) {
    const testName = 'Socket.IO Connection';
    
    try {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 10000)
        )
      ]);
      
      if (client.isConnected) {
        this.addTestResult('socketClient', testName, true, 'Connected successfully');
      } else {
        this.addTestResult('socketClient', testName, false, 'Connection failed');
      }
    } catch (error) {
      this.addTestResult('socketClient', testName, false, error.message);
    }
  }

  /**
   * Test Socket.IO filtering
   */
  async testSocketFiltering(client) {
    const testName = 'Socket.IO Filtering';
    
    try {
      // Test filter setting
      client.setFilters({
        minConfidence: 0.7,
        category: 'batting',
        mlEnhanced: true
      });
      
      const stats = client.getStats();
      
      if (stats.filters.minConfidence === 0.7 && 
          stats.filters.category === 'batting' && 
          stats.filters.mlEnhanced === true) {
        this.addTestResult('socketClient', testName, true, 'Filters set correctly');
      } else {
        this.addTestResult('socketClient', testName, false, 'Filters not set correctly');
      }
    } catch (error) {
      this.addTestResult('socketClient', testName, false, error.message);
    }
  }

  /**
   * Test Socket.IO event handling
   */
  async testSocketEvents(client) {
    const testName = 'Socket.IO Event Handling';
    
    try {
      // Test subscription
      const subscribeResult = client.subscribeToMatch('test-match-id');
      
      if (subscribeResult) {
        this.addTestResult('socketClient', testName, true, 'Event subscription successful');
      } else {
        this.addTestResult('socketClient', testName, false, 'Event subscription failed');
      }
    } catch (error) {
      this.addTestResult('socketClient', testName, false, error.message);
    }
  }

  /**
   * Test Socket.IO statistics
   */
  async testSocketStatistics(client) {
    const testName = 'Socket.IO Statistics';
    
    try {
      const stats = client.getStats();
      
      if (stats && typeof stats === 'object' && 
          typeof stats.isConnected === 'boolean' &&
          typeof stats.questionsReceived === 'number') {
        this.addTestResult('socketClient', testName, true, 'Statistics available');
      } else {
        this.addTestResult('socketClient', testName, false, 'Statistics incomplete');
      }
    } catch (error) {
      this.addTestResult('socketClient', testName, false, error.message);
    }
  }

  /**
   * Test REST API client functionality
   */
  async testRestClient() {
    this.log('Testing REST API Client...');
    
    const client = new QuestionRESTClient({
      serverUrl: this.serverUrl,
      displayMode: 'json',
      timeout: 5000
    });

    // Test 1: Active Questions Fetch
    await this.testRestActiveQuestions(client);
    
    // Test 2: Filtering
    await this.testRestFiltering(client);
    
    // Test 3: Service Status
    await this.testRestServiceStatus(client);
    
    // Test 4: Statistics
    await this.testRestStatistics(client);
    
    // Test 5: Error Handling
    await this.testRestErrorHandling(client);
  }

  /**
   * Test REST API active questions fetch
   */
  async testRestActiveQuestions(client) {
    const testName = 'REST API Active Questions';
    
    try {
      const questions = await client.fetchActiveQuestions({ limit: 5 });
      
      if (Array.isArray(questions)) {
        this.addTestResult('restClient', testName, true, `Fetched ${questions.length} questions`);
      } else {
        this.addTestResult('restClient', testName, false, 'Invalid response format');
      }
    } catch (error) {
      this.addTestResult('restClient', testName, false, error.message);
    }
  }

  /**
   * Test REST API filtering
   */
  async testRestFiltering(client) {
    const testName = 'REST API Filtering';
    
    try {
      client.setFilters({
        minConfidence: 0.6,
        category: 'batting',
        limit: 10
      });
      
      const stats = client.getStats();
      
      if (stats.filters.minConfidence === 0.6 && 
          stats.filters.category === 'batting' && 
          stats.filters.limit === 10) {
        this.addTestResult('restClient', testName, true, 'Filters set correctly');
      } else {
        this.addTestResult('restClient', testName, false, 'Filters not set correctly');
      }
    } catch (error) {
      this.addTestResult('restClient', testName, false, error.message);
    }
  }

  /**
   * Test REST API service status
   */
  async testRestServiceStatus(client) {
    const testName = 'REST API Service Status';
    
    try {
      const status = await client.getServiceStatus();
      
      if (status && typeof status === 'object') {
        this.addTestResult('restClient', testName, true, 'Service status retrieved');
      } else {
        this.addTestResult('restClient', testName, false, 'Service status unavailable');
      }
    } catch (error) {
      this.addTestResult('restClient', testName, false, error.message);
    }
  }

  /**
   * Test REST API statistics
   */
  async testRestStatistics(client) {
    const testName = 'REST API Statistics';
    
    try {
      const stats = client.getStats();
      
      if (stats && typeof stats === 'object' && 
          typeof stats.requestsMade === 'number' &&
          typeof stats.isPolling === 'boolean') {
        this.addTestResult('restClient', testName, true, 'Statistics available');
      } else {
        this.addTestResult('restClient', testName, false, 'Statistics incomplete');
      }
    } catch (error) {
      this.addTestResult('restClient', testName, false, error.message);
    }
  }

  /**
   * Test REST API error handling
   */
  async testRestErrorHandling(client) {
    const testName = 'REST API Error Handling';
    
    try {
      // Test with invalid match ID
      const questions = await client.fetchMatchQuestions('invalid-match-id');
      
      if (Array.isArray(questions)) {
        this.addTestResult('restClient', testName, true, 'Error handled gracefully');
      } else {
        this.addTestResult('restClient', testName, false, 'Error handling failed');
      }
    } catch (error) {
      this.addTestResult('restClient', testName, false, error.message);
    }
  }

  /**
   * Add test result
   */
  addTestResult(clientType, testName, passed, message) {
    const result = {
      testName,
      passed,
      message,
      timestamp: new Date().toISOString()
    };
    
    this.results[clientType].tests.push(result);
    
    if (passed) {
      this.results[clientType].passed++;
      this.results.overall.passed++;
      this.log(`✓ ${testName}: ${message}`);
    } else {
      this.results[clientType].failed++;
      this.results.overall.failed++;
      this.log(`✗ ${testName}: ${message}`);
    }
  }

  /**
   * Generate test report
   */
  generateReport() {
    const duration = this.results.overall.endTime ? 
      new Date(this.results.overall.endTime).getTime() - 
      new Date(this.results.overall.startTime).getTime() : 0;

    const report = {
      summary: {
        totalTests: this.results.overall.passed + this.results.overall.failed,
        passed: this.results.overall.passed,
        failed: this.results.overall.failed,
        successRate: this.results.overall.passed / (this.results.overall.passed + this.results.overall.failed) * 100,
        duration: Math.round(duration / 1000) + 's'
      },
      socketClient: {
        passed: this.results.socketClient.passed,
        failed: this.results.socketClient.failed,
        tests: this.results.socketClient.tests
      },
      restClient: {
        passed: this.results.restClient.passed,
        failed: this.results.restClient.failed,
        tests: this.results.restClient.tests
      },
      timestamp: new Date().toISOString()
    };

    this.log('Test Report Generated', report);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('QUESTION CLIENT TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${report.summary.totalTests}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`Duration: ${report.summary.duration}`);
    console.log('='.repeat(60));

    if (report.summary.failed === 0) {
      console.log('🎉 All tests passed!');
    } else {
      console.log('❌ Some tests failed. Check the detailed report above.');
    }

    return report;
  }
}

// Export the tester class
module.exports = QuestionClientTester;

// If running directly, run the tests
if (require.main === module) {
  const tester = new QuestionClientTester({
    serverUrl: process.env.SERVER_URL || 'http://localhost:5000',
    testTimeout: parseInt(process.env.TEST_TIMEOUT) || 30000
  });

  // Run tests
  (async () => {
    try {
      await tester.runTests();
      process.exit(0);
    } catch (error) {
      console.error('Test suite failed:', error.message);
      process.exit(1);
    }
  })();
}
