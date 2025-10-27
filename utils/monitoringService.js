'use strict';

const logger = require('./loggerService');

/**
 * Enhanced Monitoring Service for Cricket Match Updates
 * Tracks performance metrics, error rates, system health, and integrates with alerting
 */
class MonitoringService {
  constructor() {
    this.metrics = {
      polling: {
        totalCycles: 0,
        successfulCycles: 0,
        failedCycles: 0,
        averageDuration: 0,
        lastCycleTime: null,
        lastError: null
      },
      changes: {
        totalDetected: 0,
        newMatches: 0,
        updatedMatches: 0,
        finishedMatches: 0,
        falsePositives: 0
      },
      broadcasts: {
        totalBroadcasts: 0,
        selectiveBroadcasts: 0,
        fullBroadcasts: 0,
        failedBroadcasts: 0,
        averageClients: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        errors: 0,
        averageRetrievalTime: 0
      },
      api: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        lastError: null
      }
    };
    
    this.startTime = Date.now();
    this.lastResetTime = Date.now();
    
    // Alerting integration
    this.alertingService = null;
    this.lastAlertCheck = Date.now();
    this.alertCheckInterval = 60000; // Check for alerts every minute
  }

  /**
   * Set alerting service reference
   * @param {AlertingService} alertingService Alerting service instance
   */
  setAlertingService(alertingService) {
    this.alertingService = alertingService;
    logger.info('Alerting service integrated with monitoring service');
  }

  /**
   * Record polling cycle metrics
   * @param {Object} cycleData Data about the polling cycle
   */
  recordPollingCycle(cycleData) {
    this.metrics.polling.totalCycles++;
    this.metrics.polling.lastCycleTime = new Date().toISOString();
    
    if (cycleData.success) {
      this.metrics.polling.successfulCycles++;
    } else {
      this.metrics.polling.failedCycles++;
      this.metrics.polling.lastError = cycleData.error;
    }
    
    // Update average duration
    if (cycleData.duration) {
      const totalDuration = this.metrics.polling.averageDuration * (this.metrics.polling.totalCycles - 1) + cycleData.duration;
      this.metrics.polling.averageDuration = totalDuration / this.metrics.polling.totalCycles;
    }

    logger.info('Polling cycle recorded', {
      ...cycleData,
      totalCycles: this.metrics.polling.totalCycles,
      successRate: this.getSuccessRate(),
      type: 'polling_metrics'
    });
  }

  /**
   * Record change detection metrics
   * @param {Object} changeData Data about detected changes
   */
  recordChangeDetection(changeData) {
    if (changeData.hasChanges) {
      this.metrics.changes.totalDetected++;
      this.metrics.changes.newMatches += changeData.newCount || 0;
      this.metrics.changes.updatedMatches += changeData.updatedCount || 0;
      this.metrics.changes.finishedMatches += changeData.finishedCount || 0;
    }

    logger.info('Change detection recorded', {
      ...changeData,
      totalDetected: this.metrics.changes.totalDetected,
      type: 'change_detection_metrics'
    });
  }

  /**
   * Record broadcast metrics
   * @param {Object} broadcastData Data about the broadcast
   */
  recordBroadcast(broadcastData) {
    this.metrics.broadcasts.totalBroadcasts++;
    
    if (broadcastData.type === 'selective') {
      this.metrics.broadcasts.selectiveBroadcasts++;
    } else {
      this.metrics.broadcasts.fullBroadcasts++;
    }
    
    if (broadcastData.success) {
      // Update average clients
      const totalClients = this.metrics.broadcasts.averageClients * (this.metrics.broadcasts.totalBroadcasts - 1) + broadcastData.clientCount;
      this.metrics.broadcasts.averageClients = totalClients / this.metrics.broadcasts.totalBroadcasts;
    } else {
      this.metrics.broadcasts.failedBroadcasts++;
    }

    logger.info('Broadcast recorded', {
      ...broadcastData,
      totalBroadcasts: this.metrics.broadcasts.totalBroadcasts,
      type: 'broadcast_metrics'
    });
  }

  /**
   * Record cache operation metrics
   * @param {Object} cacheData Data about the cache operation
   */
  recordCacheOperation(cacheData) {
    switch (cacheData.operation) {
      case 'hit':
        this.metrics.cache.hits++;
        break;
      case 'miss':
        this.metrics.cache.misses++;
        break;
      case 'error':
        this.metrics.cache.errors++;
        break;
    }
    
    if (cacheData.duration) {
      const totalDuration = this.metrics.cache.averageRetrievalTime * (this.metrics.cache.hits + this.metrics.cache.misses - 1) + cacheData.duration;
      this.metrics.cache.averageRetrievalTime = totalDuration / (this.metrics.cache.hits + this.metrics.cache.misses);
    }

    logger.debug('Cache operation recorded', {
      ...cacheData,
      hitRate: this.getCacheHitRate(),
      type: 'cache_metrics'
    });
  }

  /**
   * Record API request metrics
   * @param {Object} apiData Data about the API request
   */
  recordApiRequest(apiData) {
    this.metrics.api.totalRequests++;
    
    if (apiData.success) {
      this.metrics.api.successfulRequests++;
    } else {
      this.metrics.api.failedRequests++;
      this.metrics.api.lastError = apiData.error;
    }
    
    if (apiData.duration) {
      const totalDuration = this.metrics.api.averageResponseTime * (this.metrics.api.totalRequests - 1) + apiData.duration;
      this.metrics.api.averageResponseTime = totalDuration / this.metrics.api.totalRequests;
    }

    logger.info('API request recorded', {
      ...apiData,
      totalRequests: this.metrics.api.totalRequests,
      successRate: this.getApiSuccessRate(),
      type: 'api_metrics'
    });
  }

  /**
   * Get overall success rate
   * @returns {number} Success rate percentage
   */
  getSuccessRate() {
    if (this.metrics.polling.totalCycles === 0) return 0;
    return (this.metrics.polling.successfulCycles / this.metrics.polling.totalCycles) * 100;
  }

  /**
   * Get API success rate
   * @returns {number} API success rate percentage
   */
  getApiSuccessRate() {
    if (this.metrics.api.totalRequests === 0) return 0;
    return (this.metrics.api.successfulRequests / this.metrics.api.totalRequests) * 100;
  }

  /**
   * Get cache hit rate
   * @returns {number} Cache hit rate percentage
   */
  getCacheHitRate() {
    const totalCacheOps = this.metrics.cache.hits + this.metrics.cache.misses;
    if (totalCacheOps === 0) return 0;
    return (this.metrics.cache.hits / totalCacheOps) * 100;
  }

  /**
   * Get system uptime
   * @returns {number} Uptime in milliseconds
   */
  getUptime() {
    return Date.now() - this.startTime;
  }

  /**
   * Get comprehensive system status
   * @returns {Object} Complete system status
   */
  getSystemStatus() {
    return {
      uptime: this.getUptime(),
      uptimeFormatted: this.formatUptime(this.getUptime()),
      metrics: {
        ...this.metrics,
        polling: {
          ...this.metrics.polling,
          successRate: this.getSuccessRate()
        },
        api: {
          ...this.metrics.api,
          successRate: this.getApiSuccessRate()
        },
        cache: {
          ...this.metrics.cache,
          hitRate: this.getCacheHitRate()
        }
      },
      health: this.getHealthStatus(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get system health status
   * @returns {Object} Health status indicators
   */
  getHealthStatus() {
    const successRate = this.getSuccessRate();
    const apiSuccessRate = this.getApiSuccessRate();
    const cacheHitRate = this.getCacheHitRate();
    
    return {
      overall: successRate >= 90 ? 'healthy' : successRate >= 70 ? 'degraded' : 'unhealthy',
      polling: successRate >= 95 ? 'healthy' : successRate >= 80 ? 'degraded' : 'unhealthy',
      api: apiSuccessRate >= 90 ? 'healthy' : apiSuccessRate >= 70 ? 'degraded' : 'unhealthy',
      cache: cacheHitRate >= 80 ? 'healthy' : cacheHitRate >= 60 ? 'degraded' : 'unhealthy',
      indicators: {
        successRate,
        apiSuccessRate,
        cacheHitRate,
        averagePollingDuration: this.metrics.polling.averageDuration,
        averageApiResponseTime: this.metrics.api.averageResponseTime,
        averageCacheRetrievalTime: this.metrics.cache.averageRetrievalTime
      }
    };
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
   * Reset metrics (useful for testing or periodic resets)
   */
  resetMetrics() {
    this.metrics = {
      polling: {
        totalCycles: 0,
        successfulCycles: 0,
        failedCycles: 0,
        averageDuration: 0,
        lastCycleTime: null,
        lastError: null
      },
      changes: {
        totalDetected: 0,
        newMatches: 0,
        updatedMatches: 0,
        finishedMatches: 0,
        falsePositives: 0
      },
      broadcasts: {
        totalBroadcasts: 0,
        selectiveBroadcasts: 0,
        fullBroadcasts: 0,
        failedBroadcasts: 0,
        averageClients: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        errors: 0,
        averageRetrievalTime: 0
      },
      api: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        lastError: null
      }
    };
    
    this.lastResetTime = Date.now();
    
    logger.info('Metrics reset', {
      resetTime: new Date().toISOString(),
      type: 'metrics_reset'
    });
  }

  /**
   * Check performance alerts and trigger alerting service if available
   */
  checkPerformanceAlerts() {
    const health = this.getHealthStatus();
    const now = Date.now();
    
    // Check if it's time to run alert checks
    if (now - this.lastAlertCheck < this.alertCheckInterval) {
      return;
    }
    
    this.lastAlertCheck = now;
    
    // Use alerting service if available
    if (this.alertingService) {
      const alertResult = this.alertingService.checkHealth(this.metrics);
      
      if (alertResult.hasAlerts) {
        logger.info('Performance alerts triggered', {
          alertCount: alertResult.alerts.length,
          autoPaused: alertResult.autoPaused
        });
      }
      
      return alertResult;
    }
    
    // Fallback to legacy alerting
    if (health.overall === 'unhealthy') {
      logger.error('System health alert: Overall system is unhealthy', {
        health,
        metrics: this.metrics,
        type: 'health_alert'
      });
    } else if (health.overall === 'degraded') {
      logger.warn('System health warning: Overall system is degraded', {
        health,
        metrics: this.metrics,
        type: 'health_warning'
      });
    }
    
    // Check for specific component issues
    if (health.api === 'unhealthy') {
      logger.error('API health alert: API success rate is critically low', {
        apiSuccessRate: this.getApiSuccessRate(),
        lastError: this.metrics.api.lastError,
        type: 'api_health_alert'
      });
    }
    
    if (health.cache === 'unhealthy') {
      logger.error('Cache health alert: Cache hit rate is critically low', {
        cacheHitRate: this.getCacheHitRate(),
        type: 'cache_health_alert'
      });
    }
  }

  /**
   * Get enhanced system status with alerting information
   * @returns {Object} Enhanced system status
   */
  getEnhancedSystemStatus() {
    const baseStatus = this.getSystemStatus();
    
    // Add alerting information if available
    if (this.alertingService) {
      baseStatus.alerting = {
        autoPaused: this.alertingService.shouldPause(),
        pauseStatus: this.alertingService.getAutoPauseStatus(),
        recentAlerts: this.alertingService.getRecentAlerts(5),
        alertStats: this.alertingService.getStats()
      };
    }
    
    return baseStatus;
  }
}

module.exports = MonitoringService;


