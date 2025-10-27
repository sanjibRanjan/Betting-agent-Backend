#!/usr/bin/env node

'use strict';

const axios = require('axios');

/**
 * Quick System Validation Test
 * Tests core functionality without ML service dependency
 */
class QuickSystemValidation {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.results = [];
  }

  async runValidation() {
    console.log('🔍 Quick System Validation');
    console.log('=' .repeat(40));
    
    const tests = [
      { name: 'Health Check', test: () => this.testHealthCheck() },
      { name: 'Live Matches API', test: () => this.testLiveMatchesAPI() },
      { name: 'Monitoring Status', test: () => this.testMonitoringStatus() },
      { name: 'Question Service', test: () => this.testQuestionService() },
      { name: 'Error Handling', test: () => this.testErrorHandling() },
      { name: 'Performance Check', test: () => this.testPerformance() }
    ];

    for (const test of tests) {
      await this.runTest(test);
    }

    this.generateSummary();
  }

  async runTest(test) {
    const startTime = Date.now();
    console.log(`  🔍 ${test.name}...`);
    
    try {
      const result = await test.test();
      const duration = Date.now() - startTime;
      
      const success = result.success !== false;
      const status = success ? '✅' : '❌';
      
      console.log(`    ${status} ${result.message || 'Test completed'} (${duration}ms)`);
      
      this.results.push({
        name: test.name,
        success,
        duration,
        message: result.message,
        data: result.data
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`    ❌ Test failed: ${error.message} (${duration}ms)`);
      
      this.results.push({
        name: test.name,
        success: false,
        duration,
        error: error.message
      });
    }
  }

  async testHealthCheck() {
    const response = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
    
    return {
      success: response.status === 200,
      message: `Health check: ${response.data.status}`,
      data: {
        status: response.data.status,
        uptime: response.data.uptimeSeconds,
        checks: response.data.checks
      }
    };
  }

  async testLiveMatchesAPI() {
    const response = await axios.get(`${this.baseUrl}/api/live-matches`, { timeout: 10000 });
    
    if (response.data.success) {
      const matches = response.data.data.matches;
      const liveMatches = matches.filter(m => m.status === 'Live' || m.status === 'INPLAY');
      
      return {
        success: true,
        message: `Live matches: ${matches.length} total, ${liveMatches.length} live`,
        data: {
          totalMatches: matches.length,
          liveMatches: liveMatches.length,
          source: response.data.data.source,
          timestamp: response.data.data.timestamp
        }
      };
    } else {
      throw new Error('API returned unsuccessful response');
    }
  }

  async testMonitoringStatus() {
    const response = await axios.get(`${this.baseUrl}/monitoring/status`, { timeout: 5000 });
    
    if (response.data.success) {
      const status = response.data.data;
      
      return {
        success: true,
        message: `Monitoring: ${status.health.overall} system health`,
        data: {
          health: status.health.overall,
          uptime: status.uptimeFormatted,
          metrics: {
            polling: status.metrics.polling.successRate,
            api: status.metrics.api.successRate,
            cache: status.metrics.cache.hitRate
          }
        }
      };
    } else {
      throw new Error('Monitoring status check failed');
    }
  }

  async testQuestionService() {
    const response = await axios.get(`${this.baseUrl}/api/questions/service/status`, { timeout: 5000 });
    
    if (response.data.success) {
      const status = response.data.data;
      
      return {
        success: true,
        message: `Question service: ${status.questionGenerator?.status || 'Unknown'}`,
        data: {
          questionGenerator: status.questionGenerator?.status,
          broadcasting: status.broadcasting?.status,
          mlServiceHealthy: status.questionGenerator?.mlServiceHealthy
        }
      };
    } else {
      throw new Error('Question service status check failed');
    }
  }

  async testErrorHandling() {
    // Test invalid endpoint
    const response = await axios.get(`${this.baseUrl}/api/invalid/endpoint`, {
      timeout: 5000,
      validateStatus: () => true
    });
    
    return {
      success: response.status === 404,
      message: `Error handling: ${response.status === 404 ? 'Proper 404 response' : 'Unexpected status'}`,
      data: {
        status: response.status,
        hasError: response.data.success === false
      }
    };
  }

  async testPerformance() {
    const endpoints = [
      '/health',
      '/api/live-matches',
      '/monitoring/status'
    ];

    const results = [];
    
    for (const endpoint of endpoints) {
      const startTime = Date.now();
      try {
        const response = await axios.get(`${this.baseUrl}${endpoint}`, { timeout: 10000 });
        const duration = Date.now() - startTime;
        
        results.push({
          endpoint,
          duration,
          success: response.status === 200
        });
      } catch (error) {
        results.push({
          endpoint,
          duration: Date.now() - startTime,
          success: false,
          error: error.message
        });
      }
    }

    const successfulTests = results.filter(r => r.success);
    const averageResponseTime = successfulTests.length > 0 
      ? successfulTests.reduce((sum, r) => sum + r.duration, 0) / successfulTests.length 
      : 0;

    return {
      success: averageResponseTime < 5000, // Under 5 seconds
      message: `Performance: ${averageResponseTime.toFixed(0)}ms average response time`,
      data: {
        averageResponseTime,
        successfulTests: successfulTests.length,
        totalTests: results.length,
        results
      }
    };
  }

  generateSummary() {
    console.log('\n📊 Validation Summary');
    console.log('=' .repeat(40));
    
    const successful = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const successRate = (successful / total) * 100;
    
    console.log(`  Tests Passed: ${successful}/${total} (${successRate.toFixed(1)}%)`);
    
    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / total;
    console.log(`  Average Response Time: ${avgDuration.toFixed(0)}ms`);
    
    const failedTests = this.results.filter(r => !r.success);
    if (failedTests.length > 0) {
      console.log('\n❌ Failed Tests:');
      failedTests.forEach(test => {
        console.log(`  • ${test.name}: ${test.error || test.message}`);
      });
    }
    
    console.log('\n✅ System Status:');
    if (successRate >= 80) {
      console.log('  🟢 System is operational and healthy');
    } else if (successRate >= 60) {
      console.log('  🟡 System is operational with some issues');
    } else {
      console.log('  🔴 System has significant issues');
    }
    
    // Generate recommendations
    console.log('\n💡 Recommendations:');
    if (successRate < 100) {
      console.log('  • Address failed tests to improve system reliability');
    }
    if (avgDuration > 3000) {
      console.log('  • Consider performance optimization for slow endpoints');
    }
    console.log('  • Monitor system health regularly');
    console.log('  • Check logs for any recurring issues');
  }
}

// Run validation
async function main() {
  const validator = new QuickSystemValidation();
  await validator.runValidation();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = QuickSystemValidation;
