#!/usr/bin/env node

'use strict';

/**
 * Server Lifecycle Management CLI Tool
 * Provides command-line interface for server lifecycle operations
 */

const ServerLifecycleService = require('./utils/serverLifecycleService');
const logger = require('./utils/loggerService');

class ServerLifecycleCLI {
  constructor() {
    this.lifecycleService = null;
    this.commands = {
      start: this.start.bind(this),
      stop: this.stop.bind(this),
      restart: this.restart.bind(this),
      status: this.status.bind(this),
      health: this.health.bind(this),
      monitor: this.monitor.bind(this),
      help: this.help.bind(this)
    };
  }

  /**
   * Initialize the lifecycle service
   */
  initializeService(options = {}) {
    this.lifecycleService = new ServerLifecycleService({
      port: process.env.PORT || 3000,
      host: 'localhost',
      healthEndpoint: '/api/health',
      healthTimeout: 10000,
      startupTimeout: 30000,
      maxRetries: 3,
      retryDelay: 2000,
      monitoringInterval: 60000,
      projectPath: process.cwd(),
      startCommand: 'npm start',
      ...options
    });
  }

  /**
   * Start the server
   */
  async start() {
    try {
      console.log('🚀 Starting backend server...');
      
      const result = await this.lifecycleService.startServer();
      
      if (result.success) {
        console.log('✅ Server started successfully!');
        console.log(`   🆔 PID: ${result.pid}`);
        console.log(`   🌐 Port: ${result.port}`);
        console.log(`   ⏱️  Startup Time: ${result.startupTime}ms`);
        console.log(`   ❤️  Health Check: ${result.healthCheck.success ? 'PASSED' : 'FAILED'}`);
        
        if (result.healthCheck.success) {
          console.log(`   📊 Status: ${result.healthCheck.data?.status || 'Unknown'}`);
          console.log(`   ⏰ Uptime: ${result.healthCheck.data?.uptimeSeconds || 0}s`);
        }
        
        console.log('');
        console.log('🎯 Server is ready to serve API requests!');
        console.log(`   🌐 Health Check: http://localhost:${result.port}/api/health`);
        console.log(`   📊 Live Matches: http://localhost:${result.port}/api/live-matches`);
        console.log(`   📈 Monitoring: http://localhost:${result.port}/monitoring/status`);
        
        return result;
      } else {
        console.error('❌ Failed to start server');
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error starting server:', error.message);
      process.exit(1);
    }
  }

  /**
   * Stop the server
   */
  async stop() {
    try {
      console.log('🛑 Stopping server...');
      
      const result = await this.lifecycleService.stopServer();
      
      if (result.success) {
        console.log('✅ Server stopped successfully');
        console.log(`   ⏱️  Shutdown Time: ${result.shutdownTime}ms`);
        console.log(`   🔧 Force: ${result.force ? 'YES' : 'NO'}`);
      } else {
        console.log('ℹ️  No server process to stop');
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error stopping server:', error.message);
      process.exit(1);
    }
  }

  /**
   * Restart the server
   */
  async restart() {
    try {
      console.log('🔄 Restarting server...');
      
      const result = await this.lifecycleService.restartServer();
      
      if (result.success) {
        console.log('✅ Server restarted successfully!');
        console.log(`   🆔 PID: ${result.pid}`);
        console.log(`   🌐 Port: ${result.port}`);
        console.log(`   ⏱️  Startup Time: ${result.startupTime}ms`);
        console.log(`   🔄 Restart Count: ${result.restartCount}`);
        console.log(`   ❤️  Health Check: ${result.healthCheck.success ? 'PASSED' : 'FAILED'}`);
        
        return result;
      } else {
        console.error('❌ Failed to restart server');
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error restarting server:', error.message);
      process.exit(1);
    }
  }

  /**
   * Get server status
   */
  async status() {
    try {
      console.log('📋 Server Status:');
      
      const status = await this.lifecycleService.getDetailedStatus();
      
      console.log(`   🏃 Running: ${status.isRunning ? 'YES' : 'NO'}`);
      console.log(`   🚀 Starting: ${status.isStarting ? 'YES' : 'NO'}`);
      console.log(`   🛑 Shutting Down: ${status.isShuttingDown ? 'YES' : 'NO'}`);
      console.log(`   🆔 PID: ${status.pid || 'N/A'}`);
      console.log(`   🌐 Port: ${status.port}`);
      console.log(`   ⏰ Uptime: ${status.uptime ? this.formatDuration(status.uptime) : 'N/A'}`);
      console.log(`   🔄 Restart Count: ${status.restartCount}`);
      console.log(`   📊 Monitoring: ${status.monitoring ? 'ACTIVE' : 'INACTIVE'}`);
      
      if (status.portStatus) {
        console.log(`   🔌 Port Status: ${status.portStatus.inUse ? 'IN USE' : 'AVAILABLE'}`);
        if (status.portStatus.processes.length > 0) {
          console.log(`   🔍 Processes on Port: ${status.portStatus.processes.length}`);
        }
      }
      
      if (status.healthCheck) {
        console.log(`   ❤️  Health Check: ${status.healthCheck.success ? 'PASSED' : 'FAILED'}`);
        if (status.healthCheck.success) {
          console.log(`   📊 Status: ${status.healthCheck.data?.status || 'Unknown'}`);
          console.log(`   ⏱️  Response Time: ${status.healthCheck.duration}ms`);
        } else {
          console.log(`   ❌ Error: ${status.healthCheck.error}`);
        }
      }
      
      console.log(`   📅 Last Updated: ${status.timestamp}`);
      
      return status;
    } catch (error) {
      console.error('❌ Error getting status:', error.message);
      process.exit(1);
    }
  }

  /**
   * Perform health check
   */
  async health() {
    try {
      console.log('❤️  Performing health check...');
      
      const result = await this.lifecycleService.performHealthCheck();
      
      if (result.success) {
        console.log('✅ Health check passed!');
        console.log(`   📊 Status: ${result.data?.status || 'Unknown'}`);
        console.log(`   ⏱️  Response Time: ${result.duration}ms`);
        console.log(`   🔢 Status Code: ${result.statusCode}`);
        console.log(`   ⏰ Server Uptime: ${result.data?.uptimeSeconds || 0}s`);
        console.log(`   🏷️  Service: ${result.data?.service || 'Unknown'}`);
      } else {
        console.log('❌ Health check failed!');
        console.log(`   ❌ Error: ${result.error}`);
        console.log(`   ⏱️  Duration: ${result.duration}ms`);
        if (result.statusCode) {
          console.log(`   🔢 Status Code: ${result.statusCode}`);
        }
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error performing health check:', error.message);
      process.exit(1);
    }
  }

  /**
   * Start monitoring
   */
  async monitor() {
    try {
      console.log('🔍 Starting server monitoring...');
      
      this.lifecycleService.startMonitoring();
      
      console.log('✅ Monitoring started');
      console.log(`   📊 Interval: ${this.lifecycleService.config.monitoringInterval}ms`);
      console.log(`   🌐 Health Endpoint: ${this.lifecycleService.config.healthEndpoint}`);
      console.log('');
      console.log('Press Ctrl+C to stop monitoring');
      
      // Keep the process alive
      process.on('SIGINT', () => {
        console.log('\n🛑 Stopping monitoring...');
        this.lifecycleService.stopMonitoring();
        console.log('✅ Monitoring stopped');
        process.exit(0);
      });
      
      // Keep alive
      setInterval(() => {
        // Just keep the process alive
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error starting monitoring:', error.message);
      process.exit(1);
    }
  }

  /**
   * Show help
   */
  help() {
    console.log('🔄 Server Lifecycle Management CLI');
    console.log('==================================');
    console.log('');
    console.log('Usage: node server-lifecycle.js <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  start     Start the backend server');
    console.log('  stop      Stop the backend server');
    console.log('  restart   Restart the backend server');
    console.log('  status    Show server status');
    console.log('  health    Perform health check');
    console.log('  monitor   Start server monitoring');
    console.log('  help      Show this help message');
    console.log('');
    console.log('Environment Variables:');
    console.log('  PORT                    Server port (default: 3000)');
    console.log('  SPORTMONKS_API_TOKEN   SportMonks API token');
    console.log('  CRICKET_API_KEY        Cricket API key (legacy)');
    console.log('');
    console.log('Examples:');
    console.log('  node server-lifecycle.js start');
    console.log('  node server-lifecycle.js status');
    console.log('  PORT=3000 node server-lifecycle.js restart');
    console.log('');
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Run the CLI
   */
  async run() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    
    if (!this.commands[command]) {
      console.error(`❌ Unknown command: ${command}`);
      console.log('Use "help" to see available commands');
      process.exit(1);
    }
    
    // Initialize service for all commands except help
    if (command !== 'help') {
      this.initializeService();
    }
    
    try {
      await this.commands[command]();
    } catch (error) {
      console.error('❌ Command failed:', error.message);
      process.exit(1);
    }
  }
}

// Run the CLI if this file is executed directly
if (require.main === module) {
  const cli = new ServerLifecycleCLI();
  cli.run().catch(error => {
    console.error('❌ CLI Error:', error);
    process.exit(1);
  });
}

module.exports = ServerLifecycleCLI;
