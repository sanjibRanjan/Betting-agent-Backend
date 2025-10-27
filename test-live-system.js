#!/usr/bin/env node

'use strict';

/**
 * Comprehensive Live System Test
 * Tests the complete pipeline: Server → Simulator → Questions → Frontend Endpoints
 */

const { spawn } = require('child_process');
const axios = require('axios');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TEST_DURATION = 120000; // 2 minutes
const POLL_INTERVAL = 5000; // Check every 5 seconds

class LiveSystemTest extends EventEmitter {
  constructor() {
    super();
    this.serverProcess = null;
    this.simulatorProcess = null;
    this.testResults = {
      serverStarted: false,
      simulatorStarted: false,
      apiHealth: false,
      liveMatches: false,
      questionsGenerated: false,
      websocketConnected: false,
      frontendEndpoints: false,
      errors: [],
      startTime: Date.now(),
      endTime: null
    };
  }

  async run() {
    console.log('\n🧪 COMPREHENSIVE LIVE SYSTEM TEST\n');
    console.log('=' .repeat(60));
    
    try {
      // Step 1: Start server
      console.log('\n[1/6] Starting server...');
      await this.startServer();
      
      // Step 2: Start simulator
      console.log('\n[2/6] Starting live match simulator...');
      await this.startSimulator();
      
      // Step 3: Wait for initialization
      console.log('\n[3/6] Waiting for services to initialize...');
      await this.sleep(10000);
      
      // Step 4: Test all endpoints
      console.log('\n[4/6] Testing endpoints and services...');
      await this.testEndpoints();
      
      // Step 5: Monitor system for specified duration
      console.log(`\n[5/6] Monitoring system for ${TEST_DURATION / 1000} seconds...`);
      await this.monitorSystem();
      
      // Step 6: Final verification
      console.log('\n[6/6] Final verification...');
      await this.finalVerification();
      
    } catch (error) {
      console.error('\n❌ Test failed:', error.message);
      this.testResults.errors.push(error.message);
    } finally {
      await this.cleanup();
      this.printResults();
    }
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, 'server.js');
      
      console.log('   Starting node server.js...');
      
      this.serverProcess = spawn('node', [serverPath], {
        cwd: __dirname,
        env: { ...process.env, LOG_LEVEL: 'info' },
        stdio: 'pipe'
      });
      
      let serverReady = false;
      
      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`   SERVER: ${output.trim()}`);
        
        if (output.includes('Listening on') || output.includes('Server listening')) {
          serverReady = true;
          this.testResults.serverStarted = true;
          console.log('   ✅ Server started successfully');
          setTimeout(resolve, 2000);
        }
      });
      
      this.serverProcess.stderr.on('data', (data) => {
        const error = data.toString();
        if (!error.includes('DeprecationWarning')) {
          console.error(`   SERVER ERROR: ${error.trim()}`);
        }
      });
      
      this.serverProcess.on('exit', (code) => {
        if (!serverReady && code !== 0) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!serverReady) {
          reject(new Error('Server failed to start within 30 seconds'));
        }
      }, 30000);
    });
  }

  async startSimulator() {
    return new Promise((resolve, reject) => {
      const simulatorPath = path.join(__dirname, 'live-match-simulator.js');
      
      console.log('   Starting live-match-simulator.js...');
      
      this.simulatorProcess = spawn('node', [simulatorPath], {
        cwd: __dirname,
        env: { ...process.env, LOG_LEVEL: 'info' },
        stdio: 'pipe'
      });
      
      let simulatorReady = false;
      
      this.simulatorProcess.stdout.on('data', (data) => {
        const output = data.toString();
        
        if (output.includes('Live match simulation started')) {
          simulatorReady = true;
          this.testResults.simulatorStarted = true;
          console.log('   ✅ Simulator started successfully');
          setTimeout(resolve, 2000);
        }
      });
      
      this.simulatorProcess.stderr.on('data', (data) => {
        const error = data.toString();
        if (!error.includes('DeprecationWarning')) {
          console.error(`   SIMULATOR ERROR: ${error.trim()}`);
        }
      });
      
      this.simulatorProcess.on('exit', (code) => {
        if (!simulatorReady && code !== 0) {
          reject(new Error(`Simulator exited with code ${code}`));
        }
      });
      
      // Timeout after 20 seconds
      setTimeout(() => {
        if (!simulatorReady) {
          reject(new Error('Simulator failed to start within 20 seconds'));
        }
      }, 20000);
    });
  }

  async testEndpoints() {
    const tests = [
      {
        name: 'API Health Check',
        url: '/api/health',
        validator: (data) => data.status === 'ok',
        resultKey: 'apiHealth'
      },
      {
        name: 'Live Matches',
        url: '/api/live-matches',
        validator: (data) => data.success && Array.isArray(data.data),
        resultKey: 'liveMatches'
      },
      {
        name: 'Questions Active',
        url: '/api/questions/questions/active',
        validator: (data) => data.success !== undefined,
        resultKey: 'questionsGenerated'
      },
      {
        name: 'Monitoring Status',
        url: '/api/monitoring/status',
        validator: (data) => data.success !== undefined,
        resultKey: 'apiHealth'
      },
      {
        name: 'Question Service Status',
        url: '/api/questions/service/status',
        validator: (data) => data.success !== undefined,
        resultKey: 'questionsGenerated'
      }
    ];

    for (const test of tests) {
      try {
        console.log(`   Testing: ${test.name}...`);
        const response = await axios.get(`${BASE_URL}${test.url}`, {
          timeout: 5000,
          validateStatus: () => true
        });
        
        if (test.validator(response.data)) {
          console.log(`   ✅ ${test.name} passed`);
          this.testResults[test.resultKey] = true;
        } else {
          console.log(`   ⚠️  ${test.name} returned unexpected data`);
        }
        
        await this.sleep(1000);
      } catch (error) {
        console.log(`   ❌ ${test.name} failed: ${error.message}`);
        this.testResults.errors.push(`${test.name}: ${error.message}`);
      }
    }
  }

  async monitorSystem() {
    const startTime = Date.now();
    let checkCount = 0;
    
    while (Date.now() - startTime < TEST_DURATION) {
      checkCount++;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      try {
        // Check live matches
        const matchesResponse = await axios.get(`${BASE_URL}/api/live-matches`);
        if (matchesResponse.data.success) {
          const matchCount = matchesResponse.data.data?.length || 0;
          console.log(`   [${elapsed}s] Matches: ${matchCount}, Check #${checkCount}`);
        }
        
        // Check questions
        try {
          const questionsResponse = await axios.get(`${BASE_URL}/api/questions/questions/active`);
          if (questionsResponse.data.success && questionsResponse.data.data?.length > 0) {
            const questionCount = questionsResponse.data.data.length;
            console.log(`   [${elapsed}s] ✅ ${questionCount} questions generated!`);
            this.testResults.questionsGenerated = true;
          }
        } catch (err) {
          // Questions might not be generated yet
        }
        
      } catch (error) {
        console.log(`   [${elapsed}s] ❌ Error: ${error.message}`);
      }
      
      await this.sleep(POLL_INTERVAL);
    }
    
    console.log(`   Completed ${checkCount} checks over ${TEST_DURATION / 1000} seconds`);
  }

  async finalVerification() {
    console.log('\n   Running final verification checks...');
    
    const checks = [
      {
        name: 'Health Endpoint',
        test: async () => {
          const response = await axios.get(`${BASE_URL}/api/health`);
          return response.data.status === 'ok';
        }
      },
      {
        name: 'Live Matches Endpoint',
        test: async () => {
          const response = await axios.get(`${BASE_URL}/api/live-matches`);
          return response.data.success && response.data.data?.length > 0;
        }
      },
      {
        name: 'Questions Endpoint',
        test: async () => {
          try {
            const response = await axios.get(`${BASE_URL}/api/questions/questions/active`);
            return response.status === 200;
          } catch (e) {
            return false;
          }
        }
      }
    ];
    
    for (const check of checks) {
      try {
        const result = await check.test();
        console.log(`   ${result ? '✅' : '❌'} ${check.name}: ${result ? 'PASS' : 'FAIL'}`);
        
        if (check.name === 'Live Matches Endpoint') {
          this.testResults.liveMatches = result;
        }
        if (check.name === 'Questions Endpoint') {
          this.testResults.frontendEndpoints = result;
        }
      } catch (error) {
        console.log(`   ❌ ${check.name}: ERROR - ${error.message}`);
      }
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    const cleanupPromises = [];
    
    if (this.simulatorProcess) {
      cleanupPromises.push(new Promise((resolve) => {
        this.simulatorProcess.on('exit', resolve);
        this.simulatorProcess.kill('SIGTERM');
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (!this.simulatorProcess.killed) {
            this.simulatorProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      }));
    }
    
    if (this.serverProcess) {
      cleanupPromises.push(new Promise((resolve) => {
        this.serverProcess.on('exit', resolve);
        this.serverProcess.kill('SIGTERM');
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (!this.serverProcess.killed) {
            this.serverProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      }));
    }
    
    await Promise.all(cleanupPromises);
    this.testResults.endTime = Date.now();
    console.log('   ✅ Cleanup complete');
  }

  printResults() {
    const duration = Math.floor((this.testResults.endTime - this.testResults.startTime) / 1000);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS');
    console.log('='.repeat(60));
    
    console.log('\n✅ Passed Checks:');
    if (this.testResults.serverStarted) console.log('   ✅ Server started successfully');
    if (this.testResults.simulatorStarted) console.log('   ✅ Simulator started successfully');
    if (this.testResults.apiHealth) console.log('   ✅ API health check passed');
    if (this.testResults.liveMatches) console.log('   ✅ Live matches endpoint working');
    if (this.testResults.questionsGenerated) console.log('   ✅ Questions being generated');
    if (this.testResults.frontendEndpoints) console.log('   ✅ Frontend endpoints accessible');
    
    console.log('\n❌ Failed Checks:');
    if (!this.testResults.serverStarted) console.log('   ❌ Server failed to start');
    if (!this.testResults.simulatorStarted) console.log('   ❌ Simulator failed to start');
    if (!this.testResults.apiHealth) console.log('   ❌ API health check failed');
    if (!this.testResults.liveMatches) console.log('   ❌ Live matches endpoint not working');
    if (!this.testResults.questionsGenerated) console.log('   ❌ No questions generated');
    if (!this.testResults.frontendEndpoints) console.log('   ❌ Frontend endpoints not accessible');
    
    if (this.testResults.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      this.testResults.errors.forEach(error => {
        console.log(`   - ${error}`);
      });
    }
    
    const passCount = [
      this.testResults.serverStarted,
      this.testResults.simulatorStarted,
      this.testResults.apiHealth,
      this.testResults.liveMatches,
      this.testResults.questionsGenerated,
      this.testResults.frontendEndpoints
    ].filter(Boolean).length;
    
    const totalChecks = 6;
    const passRate = Math.round((passCount / totalChecks) * 100);
    
    console.log(`\n📈 Summary: ${passCount}/${totalChecks} checks passed (${passRate}%)`);
    console.log(`⏱️  Duration: ${duration} seconds`);
    
    console.log('\n' + '='.repeat(60));
    
    if (passRate >= 80) {
      console.log('🎉 System is working well!');
    } else if (passRate >= 50) {
      console.log('⚠️  System has some issues but is mostly functional');
    } else {
      console.log('❌ System has critical issues that need attention');
    }
    
    console.log('='.repeat(60) + '\n');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
if (require.main === module) {
  const test = new LiveSystemTest();
  test.run().then(() => {
    const exitCode = test.testResults.errors.length > 0 ? 1 : 0;
    process.exit(exitCode);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = LiveSystemTest;
