'use strict';

const { spawn, exec } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const logger = require('./loggerService');

/**
 * Comprehensive Server Lifecycle Management Service
 * Handles server detection, startup, health checks, and monitoring
 */
class ServerLifecycleService {
  constructor(options = {}) {
    this.config = {
      port: options.port || process.env.PORT || 5000,
      host: options.host || 'localhost',
      healthEndpoint: options.healthEndpoint || '/api/health',
      healthTimeout: options.healthTimeout || 10000,
      startupTimeout: options.startupTimeout || 30000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 2000,
      monitoringInterval: options.monitoringInterval || 60000,
      projectPath: options.projectPath || process.cwd(),
      startCommand: options.startCommand || 'npm start',
      pidFile: options.pidFile || path.join(process.cwd(), '.server.pid'),
      logFile: options.logFile || path.join(process.cwd(), 'logs', 'server-lifecycle.log'),
      ...options
    };

    this.serverProcess = null;
    this.monitoringInterval = null;
    this.isStarting = false;
    this.isShuttingDown = false;
    this.startTime = null;
    this.restartCount = 0;
    this.maxRestartAttempts = 5;
    this.restartWindow = 300000; // 5 minutes
    this.restartHistory = [];

    // Ensure log directory exists
    this.ensureLogDirectory();

    logger.info('Server Lifecycle Service initialized', {
      config: {
        port: this.config.port,
        host: this.config.host,
        healthEndpoint: this.config.healthEndpoint,
        projectPath: this.config.projectPath,
        startCommand: this.config.startCommand
      }
    });
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    const logDir = path.dirname(this.config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Check if port is in use
   * @param {number} port Port to check
   * @param {string} host Host to check
   * @returns {Promise<boolean>} True if port is in use
   */
  async isPortInUse(port, host = 'localhost') {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, host, () => {
        server.once('close', () => {
          resolve(false);
        });
        server.close();
      });
      
      server.on('error', () => {
        resolve(true);
      });
    });
  }

  /**
   * Find processes using the specified port
   * @param {number} port Port to check
   * @returns {Promise<Array>} Array of process information
   */
  async findProcessesOnPort(port) {
    return new Promise((resolve) => {
      const command = process.platform === 'win32' 
        ? `netstat -ano | findstr :${port}`
        : `lsof -ti:${port}`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          logger.debug('No processes found on port', { port, error: error.message });
          resolve([]);
          return;
        }

        const processes = [];
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (process.platform === 'win32') {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parts[4];
              if (pid && pid !== '0') {
                processes.push({ pid: parseInt(pid), platform: 'win32' });
              }
            }
          } else {
            const pid = parseInt(line.trim());
            if (!isNaN(pid)) {
              processes.push({ pid, platform: 'unix' });
            }
          }
        }

        resolve(processes);
      });
    });
  }

  /**
   * Get process information
   * @param {number} pid Process ID
   * @returns {Promise<Object>} Process information
   */
  async getProcessInfo(pid) {
    return new Promise((resolve) => {
      const command = process.platform === 'win32'
        ? `tasklist /FI "PID eq ${pid}" /FO CSV`
        : `ps -p ${pid} -o pid,ppid,cmd`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ pid, exists: false, error: error.message });
          return;
        }

        const lines = stdout.trim().split('\n');
        if (lines.length < 2) {
          resolve({ pid, exists: false });
          return;
        }

        if (process.platform === 'win32') {
          const csvLine = lines[1];
          const parts = csvLine.split(',').map(part => part.replace(/"/g, ''));
          resolve({
            pid,
            exists: true,
            name: parts[0],
            command: parts[0]
          });
        } else {
          const parts = lines[1].trim().split(/\s+/);
          resolve({
            pid,
            exists: true,
            command: parts.slice(2).join(' ')
          });
        }
      });
    });
  }

  /**
   * Gracefully terminate a process
   * @param {number} pid Process ID
   * @param {number} timeout Timeout in milliseconds
   * @returns {Promise<boolean>} True if terminated successfully
   */
  async terminateProcess(pid, timeout = 10000) {
    return new Promise((resolve) => {
      logger.info('Terminating process', { pid });

      // Try graceful termination first
      try {
        if (process.platform === 'win32') {
          exec(`taskkill /PID ${pid}`, (error) => {
            if (error) {
              logger.warn('Graceful termination failed, trying force kill', { pid, error: error.message });
              exec(`taskkill /F /PID ${pid}`, (error2) => {
                resolve(!error2);
              });
            } else {
              resolve(true);
            }
          });
        } else {
          process.kill(pid, 'SIGTERM');
          
          // Wait for graceful termination
          setTimeout(() => {
            try {
              process.kill(pid, 'SIGKILL');
              logger.warn('Force killed process after timeout', { pid });
            } catch (err) {
              // Process already terminated
            }
            resolve(true);
          }, timeout);
        }
      } catch (error) {
        logger.error('Failed to terminate process', { pid, error: error.message });
        resolve(false);
      }
    });
  }

  /**
   * Detect and terminate conflicting server instances
   * @returns {Promise<Object>} Termination results
   */
  async detectAndTerminateConflicts() {
    logger.info('Detecting conflicting server instances', { port: this.config.port });

    const results = {
      portInUse: false,
      processesFound: [],
      terminated: [],
      errors: []
    };

    // Check if port is in use
    results.portInUse = await this.isPortInUse(this.config.port, this.config.host);

    if (!results.portInUse) {
      logger.info('Port is available', { port: this.config.port });
      return results;
    }

    logger.warn('Port is in use, finding processes', { port: this.config.port });

    // Find processes using the port
    const processes = await this.findProcessesOnPort(this.config.port);
    results.processesFound = processes;

    if (processes.length === 0) {
      logger.warn('Port appears to be in use but no processes found', { port: this.config.port });
      return results;
    }

    // Get detailed process information and terminate
    for (const processInfo of processes) {
      try {
        const detailedInfo = await this.getProcessInfo(processInfo.pid);
        
        if (detailedInfo.exists) {
          logger.info('Found process using port', {
            pid: processInfo.pid,
            command: detailedInfo.command,
            port: this.config.port
          });

          // Check if it's our own process
          if (processInfo.pid === process.pid) {
            logger.info('Skipping termination of current process', { pid: processInfo.pid });
            continue;
          }

          // Terminate the process
          const terminated = await this.terminateProcess(processInfo.pid);
          
          if (terminated) {
            results.terminated.push({
              pid: processInfo.pid,
              command: detailedInfo.command,
              terminated: true
            });
            logger.info('Successfully terminated conflicting process', {
              pid: processInfo.pid,
              command: detailedInfo.command
            });
          } else {
            results.errors.push({
              pid: processInfo.pid,
              command: detailedInfo.command,
              error: 'Failed to terminate'
            });
          }
        }
      } catch (error) {
        results.errors.push({
          pid: processInfo.pid,
          error: error.message
        });
        logger.error('Error handling process', { pid: processInfo.pid, error: error.message });
      }
    }

    // Wait a moment for ports to be released
    if (results.terminated.length > 0) {
      logger.info('Waiting for ports to be released', { terminated: results.terminated.length });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }

  /**
   * Perform health check on server
   * @param {number} timeout Timeout in milliseconds
   * @returns {Promise<Object>} Health check result
   */
  async performHealthCheck(timeout = null) {
    const timeoutMs = timeout || this.config.healthTimeout;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const options = {
        hostname: this.config.host,
        port: this.config.port,
        path: this.config.healthEndpoint,
        method: 'GET',
        timeout: timeoutMs
      };

      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          const duration = Date.now() - startTime;
          
          try {
            const responseData = JSON.parse(data);
            resolve({
              success: res.statusCode === 200,
              statusCode: res.statusCode,
              data: responseData,
              duration,
              timestamp: new Date().toISOString()
            });
          } catch (parseError) {
            resolve({
              success: false,
              statusCode: res.statusCode,
              error: 'Invalid JSON response',
              rawData: data,
              duration,
              timestamp: new Date().toISOString()
            });
          }
        });
      });

      req.on('error', (error) => {
        const duration = Date.now() - startTime;
        resolve({
          success: false,
          error: error.message,
          duration,
          timestamp: new Date().toISOString()
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const duration = Date.now() - startTime;
        resolve({
          success: false,
          error: 'Health check timeout',
          duration,
          timestamp: new Date().toISOString()
        });
      });

      req.end();
    });
  }

  /**
   * Start the backend server
   * @returns {Promise<Object>} Startup result
   */
  async startServer() {
    if (this.isStarting) {
      throw new Error('Server is already starting');
    }

    if (this.serverProcess) {
      throw new Error('Server is already running');
    }

    this.isStarting = true;
    const startTime = Date.now();

    try {
      logger.info('Starting backend server', {
        command: this.config.startCommand,
        port: this.config.port,
        projectPath: this.config.projectPath
      });

      // Detect and terminate conflicts
      const conflictResults = await this.detectAndTerminateConflicts();
      
      if (conflictResults.errors.length > 0) {
        logger.warn('Some conflicts could not be resolved', { errors: conflictResults.errors });
      }

      // Start the server process
      const [command, ...args] = this.config.startCommand.split(' ');
      this.serverProcess = spawn(command, args, {
        cwd: this.config.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      // Save PID
      if (this.serverProcess.pid) {
        fs.writeFileSync(this.config.pidFile, this.serverProcess.pid.toString());
        logger.info('Server PID saved', { pid: this.serverProcess.pid, pidFile: this.config.pidFile });
      }

      // Handle process events
      this.serverProcess.on('error', (error) => {
        logger.error('Server process error', { error: error.message });
        this.serverProcess = null;
        this.isStarting = false;
      });

      this.serverProcess.on('exit', (code, signal) => {
        logger.info('Server process exited', { code, signal });
        this.serverProcess = null;
        this.isStarting = false;
        
        // Clean up PID file
        if (fs.existsSync(this.config.pidFile)) {
          fs.unlinkSync(this.config.pidFile);
        }
      });

      // Handle stdout/stderr
      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.info('Server stdout', { output });
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.warn('Server stderr', { output });
        }
      });

      // Wait for server to start
      logger.info('Waiting for server to start', { timeout: this.config.startupTimeout });
      await this.waitForServerStart();

      // Perform health check
      logger.info('Performing health check');
      const healthResult = await this.performHealthCheck();

      if (!healthResult.success) {
        throw new Error(`Health check failed: ${healthResult.error || 'Unknown error'}`);
      }

      this.startTime = Date.now();
      this.isStarting = false;

      logger.info('Server started successfully', {
        pid: this.serverProcess.pid,
        port: this.config.port,
        startupTime: Date.now() - startTime,
        healthCheck: healthResult
      });

      return {
        success: true,
        pid: this.serverProcess.pid,
        port: this.config.port,
        startupTime: Date.now() - startTime,
        healthCheck: healthResult,
        conflictResults
      };

    } catch (error) {
      this.isStarting = false;
      
      if (this.serverProcess) {
        this.serverProcess.kill();
        this.serverProcess = null;
      }

      logger.error('Failed to start server', { error: error.message });
      throw error;
    }
  }

  /**
   * Wait for server to start
   * @returns {Promise<void>}
   */
  async waitForServerStart() {
    const startTime = Date.now();
    const maxWaitTime = this.config.startupTimeout;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const healthResult = await this.performHealthCheck(5000);
        if (healthResult.success) {
          return;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Server failed to start within ${maxWaitTime}ms`);
  }

  /**
   * Stop the server
   * @param {boolean} force Force termination
   * @returns {Promise<Object>} Shutdown result
   */
  async stopServer(force = false) {
    if (this.isShuttingDown) {
      throw new Error('Server is already shutting down');
    }

    this.isShuttingDown = true;
    const startTime = Date.now();

    try {
      logger.info('Stopping server', { force, pid: this.serverProcess?.pid });

      if (!this.serverProcess) {
        logger.info('No server process to stop');
        return { success: true, message: 'No server process running' };
      }

      // Stop monitoring
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Graceful shutdown
      if (!force) {
        this.serverProcess.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            logger.warn('Graceful shutdown timeout, forcing termination');
            this.serverProcess.kill('SIGKILL');
            resolve();
          }, 10000);

          this.serverProcess.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } else {
        this.serverProcess.kill('SIGKILL');
      }

      this.serverProcess = null;
      this.isShuttingDown = false;

      // Clean up PID file
      if (fs.existsSync(this.config.pidFile)) {
        fs.unlinkSync(this.config.pidFile);
      }

      logger.info('Server stopped successfully', {
        shutdownTime: Date.now() - startTime
      });

      return {
        success: true,
        shutdownTime: Date.now() - startTime,
        force
      };

    } catch (error) {
      this.isShuttingDown = false;
      logger.error('Failed to stop server', { error: error.message });
      throw error;
    }
  }

  /**
   * Restart the server
   * @returns {Promise<Object>} Restart result
   */
  async restartServer() {
    logger.info('Restarting server');

    const now = Date.now();
    
    // Clean up old restart history outside the window
    this.restartHistory = this.restartHistory.filter(time => now - time < this.restartWindow);
    
    // Check restart limit
    if (this.restartHistory.length >= this.maxRestartAttempts) {
      throw new Error(`Too many restart attempts (${this.maxRestartAttempts}) within ${this.restartWindow}ms`);
    }

    this.restartHistory.push(now);
    this.restartCount++;

    try {
      // Stop server if running
      if (this.serverProcess) {
        await this.stopServer();
      }

      // Start server
      const result = await this.startServer();

      logger.info('Server restarted successfully', {
        restartCount: this.restartCount,
        restartHistory: this.restartHistory.length
      });

      return {
        success: true,
        restartCount: this.restartCount,
        ...result
      };

    } catch (error) {
      logger.error('Failed to restart server', { error: error.message });
      throw error;
    }
  }

  /**
   * Start monitoring the server
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      logger.warn('Monitoring already started');
      return;
    }

    logger.info('Starting server monitoring', { interval: this.config.monitoringInterval });

    this.monitoringInterval = setInterval(async () => {
      try {
        if (!this.serverProcess) {
          logger.warn('No server process to monitor');
          return;
        }

        const healthResult = await this.performHealthCheck();
        
        if (!healthResult.success) {
          logger.error('Health check failed during monitoring', { healthResult });
          
          // Attempt restart if health check fails
          try {
            await this.restartServer();
            logger.info('Server restarted due to health check failure');
          } catch (restartError) {
            logger.error('Failed to restart server after health check failure', { 
              error: restartError.message 
            });
          }
        } else {
          logger.debug('Server health check passed', { 
            duration: healthResult.duration,
            statusCode: healthResult.statusCode
          });
        }

      } catch (error) {
        logger.error('Monitoring error', { error: error.message });
      }
    }, this.config.monitoringInterval);
  }

  /**
   * Stop monitoring the server
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Server monitoring stopped');
    }
  }

  /**
   * Get server status
   * @returns {Object} Server status
   */
  getStatus() {
    return {
      service: 'ServerLifecycleService',
      isRunning: !!this.serverProcess,
      isStarting: this.isStarting,
      isShuttingDown: this.isShuttingDown,
      pid: this.serverProcess?.pid || null,
      port: this.config.port,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      restartCount: this.restartCount,
      restartHistory: this.restartHistory.length,
      monitoring: !!this.monitoringInterval,
      config: {
        port: this.config.port,
        host: this.config.host,
        healthEndpoint: this.config.healthEndpoint,
        startCommand: this.config.startCommand
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get detailed server information
   * @returns {Promise<Object>} Detailed server information
   */
  async getDetailedStatus() {
    const baseStatus = this.getStatus();
    
    // Add health check if server is running
    if (this.serverProcess) {
      try {
        const healthResult = await this.performHealthCheck();
        baseStatus.healthCheck = healthResult;
      } catch (error) {
        baseStatus.healthCheck = {
          success: false,
          error: error.message
        };
      }
    }

    // Add port status
    baseStatus.portStatus = {
      inUse: await this.isPortInUse(this.config.port, this.config.host),
      processes: await this.findProcessesOnPort(this.config.port)
    };

    return baseStatus;
  }
}

module.exports = ServerLifecycleService;
