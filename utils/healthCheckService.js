'use strict';

const logger = require('./loggerService');

/**
 * Comprehensive Health Check Service
 * Provides detailed health status for all system components
 */
class HealthCheckService {
  constructor() {
    this.checks = new Map();
    this.checkResults = new Map();
    this.lastCheckTime = null;
    this.checkInterval = 30000; // 30 seconds
    this.autoCheck = true;
    
    // Initialize default health checks
    this.initializeDefaultChecks();
  }

  /**
   * Initialize default health checks
   */
  initializeDefaultChecks() {
    // System health check
    this.addCheck('system', 'System Resources', this.checkSystemResources.bind(this), 5000);
    
    // Memory health check
    this.addCheck('memory', 'Memory Usage', this.checkMemoryUsage.bind(this), 5000);
    
    // Process health check
    this.addCheck('process', 'Process Health', this.checkProcessHealth.bind(this), 3000);
    
    // Network connectivity check (basic)
    this.addCheck('network', 'Network Connectivity', this.checkNetworkConnectivity.bind(this), 10000);
    
    logger.info('Health check service initialized with default checks', {
      checks: Array.from(this.checks.keys()),
      checkInterval: this.checkInterval
    });
  }

  /**
   * Add a health check
   * @param {string} id Unique check identifier
   * @param {string} name Human-readable check name
   * @param {Function} checkFunction Function that returns health status
   * @param {number} timeout Timeout in milliseconds
   */
  addCheck(id, name, checkFunction, timeout = 5000) {
    this.checks.set(id, {
      id,
      name,
      checkFunction,
      timeout,
      lastRun: null,
      lastResult: null
    });
    
    logger.info('Health check added', {
      checkId: id,
      checkName: name,
      timeout
    });
  }

  /**
   * Remove a health check
   * @param {string} id Check identifier
   */
  removeCheck(id) {
    if (this.checks.has(id)) {
      this.checks.delete(id);
      this.checkResults.delete(id);
      logger.info('Health check removed', { checkId: id });
    }
  }

  /**
   * Run a specific health check
   * @param {string} id Check identifier
   * @returns {Promise<Object>} Health check result
   */
  async runCheck(id) {
    const check = this.checks.get(id);
    if (!check) {
      return {
        id,
        name: 'Unknown Check',
        status: 'unknown',
        message: 'Check not found',
        timestamp: new Date().toISOString(),
        duration: 0
      };
    }

    const startTime = Date.now();
    
    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), check.timeout);
      });

      // Run check with timeout
      const result = await Promise.race([
        check.checkFunction(),
        timeoutPromise
      ]);

      const duration = Date.now() - startTime;
      
      const checkResult = {
        id: check.id,
        name: check.name,
        status: result.status || 'unknown',
        message: result.message || 'Check completed',
        data: result.data || {},
        timestamp: new Date().toISOString(),
        duration,
        lastRun: new Date().toISOString()
      };

      // Store result
      check.lastRun = new Date().toISOString();
      check.lastResult = checkResult;
      this.checkResults.set(id, checkResult);

      return checkResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      const checkResult = {
        id: check.id,
        name: check.name,
        status: 'error',
        message: error.message,
        error: error.message,
        timestamp: new Date().toISOString(),
        duration,
        lastRun: new Date().toISOString()
      };

      // Store error result
      check.lastRun = new Date().toISOString();
      check.lastResult = checkResult;
      this.checkResults.set(id, checkResult);

      logger.error('Health check failed', {
        checkId: id,
        checkName: check.name,
        error: error.message,
        duration
      });

      return checkResult;
    }
  }

  /**
   * Run all health checks
   * @returns {Promise<Object>} Overall health status
   */
  async runAllChecks() {
    const startTime = Date.now();
    const results = [];
    const checkPromises = [];

    // Run all checks in parallel
    for (const [id, check] of this.checks) {
      checkPromises.push(this.runCheck(id));
    }

    try {
      const checkResults = await Promise.allSettled(checkPromises);
      
      checkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const checkId = Array.from(this.checks.keys())[index];
          results.push({
            id: checkId,
            name: 'Check Error',
            status: 'error',
            message: result.reason?.message || 'Check failed',
            error: result.reason?.message,
            timestamp: new Date().toISOString(),
            duration: 0
          });
        }
      });

      const overallDuration = Date.now() - startTime;
      this.lastCheckTime = new Date().toISOString();

      // Determine overall health status
      const overallStatus = this.determineOverallStatus(results);

      const healthStatus = {
        status: overallStatus,
        timestamp: this.lastCheckTime,
        duration: overallDuration,
        checks: results,
        summary: {
          total: results.length,
          healthy: results.filter(r => r.status === 'healthy').length,
          degraded: results.filter(r => r.status === 'degraded').length,
          unhealthy: results.filter(r => r.status === 'unhealthy').length,
          error: results.filter(r => r.status === 'error').length
        }
      };

      logger.info('Health checks completed', {
        overallStatus,
        totalChecks: results.length,
        duration: overallDuration,
        summary: healthStatus.summary
      });

      return healthStatus;
    } catch (error) {
      logger.error('Failed to run health checks', {
        error: error.message,
        duration: Date.now() - startTime
      });

      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        error: error.message,
        checks: [],
        summary: {
          total: 0,
          healthy: 0,
          degraded: 0,
          unhealthy: 0,
          error: 1
        }
      };
    }
  }

  /**
   * Determine overall health status from individual check results
   * @param {Array} results Array of check results
   * @returns {string} Overall status
   */
  determineOverallStatus(results) {
    if (results.length === 0) return 'unknown';
    
    const hasError = results.some(r => r.status === 'error');
    const hasUnhealthy = results.some(r => r.status === 'unhealthy');
    const hasDegraded = results.some(r => r.status === 'degraded');
    
    if (hasError || hasUnhealthy) return 'unhealthy';
    if (hasDegraded) return 'degraded';
    
    const allHealthy = results.every(r => r.status === 'healthy');
    return allHealthy ? 'healthy' : 'unknown';
  }

  /**
   * Get current health status (cached or run new checks)
   * @param {boolean} forceRefresh Force refresh of health checks
   * @returns {Promise<Object>} Health status
   */
  async getHealthStatus(forceRefresh = false) {
    const now = Date.now();
    const shouldRefresh = forceRefresh || 
                         !this.lastCheckTime || 
                         (now - new Date(this.lastCheckTime).getTime()) > this.checkInterval;

    if (shouldRefresh) {
      return await this.runAllChecks();
    }

    // Return cached results
    const results = Array.from(this.checkResults.values());
    return {
      status: this.determineOverallStatus(results),
      timestamp: this.lastCheckTime,
      duration: 0,
      checks: results,
      summary: {
        total: results.length,
        healthy: results.filter(r => r.status === 'healthy').length,
        degraded: results.filter(r => r.status === 'degraded').length,
        unhealthy: results.filter(r => r.status === 'unhealthy').length,
        error: results.filter(r => r.status === 'error').length
      },
      cached: true
    };
  }

  /**
   * System resources health check
   * @returns {Promise<Object>} System resources status
   */
  async checkSystemResources() {
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    const status = memoryUsage.heapUsed / memoryUsage.heapTotal < 0.9 ? 'healthy' : 
                   memoryUsage.heapUsed / memoryUsage.heapTotal < 0.95 ? 'degraded' : 'unhealthy';

    return {
      status,
      message: `System resources check completed`,
      data: {
        cpuUsage: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        memoryUsage: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          heapUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
        },
        uptime: uptime
      }
    };
  }

  /**
   * Memory usage health check
   * @returns {Promise<Object>} Memory usage status
   */
  async checkMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    let status = 'healthy';
    let message = 'Memory usage is normal';

    if (heapUsagePercent > 95) {
      status = 'unhealthy';
      message = 'Memory usage is critically high';
    } else if (heapUsagePercent > 85) {
      status = 'degraded';
      message = 'Memory usage is elevated';
    }

    return {
      status,
      message,
      data: {
        heapUsagePercent: Math.round(heapUsagePercent),
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        rss: memoryUsage.rss
      }
    };
  }

  /**
   * Process health check
   * @returns {Promise<Object>} Process health status
   */
  async checkProcessHealth() {
    const uptime = process.uptime();
    const pid = process.pid;
    const platform = process.platform;
    const nodeVersion = process.version;

    return {
      status: 'healthy',
      message: 'Process is running normally',
      data: {
        pid,
        uptime,
        platform,
        nodeVersion,
        uptimeFormatted: this.formatUptime(uptime * 1000)
      }
    };
  }

  /**
   * Basic network connectivity check
   * @returns {Promise<Object>} Network connectivity status
   */
  async checkNetworkConnectivity() {
    try {
      const dns = require('dns');
      const { promisify } = require('util');
      const resolve4 = promisify(dns.resolve4);

      // Try to resolve a common DNS name
      await resolve4('google.com');
      
      return {
        status: 'healthy',
        message: 'Network connectivity is available',
        data: {
          dnsResolution: 'working'
        }
      };
    } catch (error) {
      return {
        status: 'degraded',
        message: 'Network connectivity issues detected',
        data: {
          dnsResolution: 'failed',
          error: error.message
        }
      };
    }
  }

  /**
   * Format uptime in human-readable format
   * @param {number} uptimeMs Uptime in milliseconds
   * @returns {string} Formatted uptime string
   */
  formatUptime(uptimeMs) {
    const seconds = Math.floor(uptimeMs / 1000);
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
   * Start automatic health checking
   * @param {number} interval Check interval in milliseconds
   */
  startAutoCheck(interval = null) {
    if (interval) {
      this.checkInterval = interval;
    }

    if (this.autoCheck) {
      logger.info('Auto health checking already started');
      return;
    }

    this.autoCheck = true;
    this.autoCheckInterval = setInterval(async () => {
      try {
        await this.runAllChecks();
      } catch (error) {
        logger.error('Auto health check failed', {
          error: error.message
        });
      }
    }, this.checkInterval);

    logger.info('Auto health checking started', {
      interval: this.checkInterval
    });
  }

  /**
   * Stop automatic health checking
   */
  stopAutoCheck() {
    if (!this.autoCheck) {
      return;
    }

    this.autoCheck = false;
    if (this.autoCheckInterval) {
      clearInterval(this.autoCheckInterval);
      this.autoCheckInterval = null;
    }

    logger.info('Auto health checking stopped');
  }

  /**
   * Get health check service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      service: 'HealthCheckService',
      autoCheck: this.autoCheck,
      checkInterval: this.checkInterval,
      lastCheckTime: this.lastCheckTime,
      registeredChecks: Array.from(this.checks.keys()),
      checkResults: this.checkResults.size,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = HealthCheckService;
