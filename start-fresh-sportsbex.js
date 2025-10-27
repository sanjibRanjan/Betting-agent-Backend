#!/usr/bin/env node

/**
 * Fresh Sportsbex API Integration Startup Script
 * This script provides a clean restart of the system with Sportsbex API
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Fresh Sportsbex API Integration...\n');

// Kill any existing processes
console.log('🔄 Stopping existing processes...');
const killProcesses = () => {
  return new Promise((resolve) => {
    const kill = spawn('pkill', ['-f', 'node.*server'], { stdio: 'inherit' });
    kill.on('close', () => {
      setTimeout(resolve, 2000); // Wait 2 seconds for processes to stop
    });
  });
};

// Clean up old backup files
const cleanupBackups = () => {
  console.log('🧹 Cleaning up old backup files...');
  const backupFiles = [
    'core/cricketService.js.sportmonks.backup',
    'services/dataProcessor.js.sportmonks.backup',
    'utils/rateLimiter.js.sportmonks.backup'
  ];
  
  backupFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`   ✅ Removed ${file}`);
    }
  });
};

// Set fresh environment variables
const setFreshEnvironment = () => {
  console.log('⚙️  Setting fresh environment variables...');
  process.env.SPORTSBEX_API_BASE_URL = 'https://trial.sportbex.com/live-score/cricket';
  process.env.SPORTSBEX_API_TIMEOUT = '10000';
  process.env.SPORTSBEX_MAX_CALLS_PER_HOUR = '5000';
  process.env.CACHE_TTL_LIVE_MATCHES = '10';
  process.env.CACHE_TTL_BALL_BY_BALL = '5';
  process.env.CACHE_TTL_FINISHED_MATCHES = '3600';
  process.env.POLL_INTERVAL_MS = '10000';
  process.env.NODE_ENV = 'development';
  process.env.LOG_LEVEL = 'info';
  console.log('   ✅ Environment variables set');
};

// Start the server
const startServer = () => {
  console.log('🎯 Starting server with fresh Sportsbex API integration...\n');
  
  const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SPORTSBEX_API_BASE_URL: 'https://trial.sportbex.com/live-score/cricket',
      SPORTSBEX_API_TIMEOUT: '10000',
      SPORTSBEX_MAX_CALLS_PER_HOUR: '5000',
      CACHE_TTL_LIVE_MATCHES: '10',
      CACHE_TTL_BALL_BY_BALL: '5',
      CACHE_TTL_FINISHED_MATCHES: '3600',
      POLL_INTERVAL_MS: '10000',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info'
    }
  });

  server.on('error', (error) => {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  });

  server.on('close', (code) => {
    console.log(`\n🛑 Server exited with code ${code}`);
    process.exit(code);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    server.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    server.kill('SIGTERM');
  });
};

// Main execution
const main = async () => {
  try {
    await killProcesses();
    cleanupBackups();
    setFreshEnvironment();
    startServer();
  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    process.exit(1);
  }
};

main();


