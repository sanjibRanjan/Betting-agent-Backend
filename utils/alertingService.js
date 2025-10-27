'use strict';

const logger = require('./loggerService');

/**
 * Lightweight Alerting Service for System Health Monitoring
 * Provides alerts for performance degradation and system issues
 */
class AlertingService {
  constructor() {
    this.alerts = [];
    this.alertThresholds = {
      successRate: 95, // 95% success rate threshold
      latencyThreshold: 10000, // 10 seconds latency threshold
      consecutiveFailures: 3, // 3 consecutive failures before auto-pause
      errorRate: 10, // 10% error rate threshold
      cacheHitRate: 80 // 80% cache hit rate threshold
    };
    
    this.alertState = {
      autoPaused: false,
      lastPauseTime: null,
      pauseReason: null,
      consecutiveFailures: 0,
      lastAlertTime: null,
      alertCooldown: 300000 // 5 minutes cooldown between alerts
    };

    this.alertTypes = {
      PERFORMANCE: 'performance',
      ERROR_RATE: 'error_rate',
      LATENCY: 'latency',
      CACHE: 'cache',
      SYSTEM: 'system',
      API: 'api'
    };

    logger.info('AlertingService initialized', {
      thresholds: this.alertThresholds,
      alertTypes: Object.values(this.alertTypes)
    });
  }

  /**
   * Check system health and generate alerts
   * @param {Object} metrics Current system metrics
   * @returns {Object} Alert analysis result
   */
  checkHealth(metrics) {
    const alerts = [];
    const now = Date.now();

    // Check success rate
    if (metrics.polling && metrics.polling.successRate < this.alertThresholds.successRate) {
      alerts.push(this.createAlert(
        this.alertTypes.PERFORMANCE,
        'Low Success Rate',
        `Success rate is ${metrics.polling.successRate.toFixed(2)}%, below threshold of ${this.alertThresholds.successRate}%`,
        {
          current: metrics.polling.successRate,
          threshold: this.alertThresholds.successRate,
          totalCycles: metrics.polling.totalCycles,
          failedCycles: metrics.polling.failedCycles
        }
      ));
    }

    // Check API latency
    if (metrics.api && metrics.api.averageResponseTime > this.alertThresholds.latencyThreshold) {
      alerts.push(this.createAlert(
        this.alertTypes.LATENCY,
        'High API Latency',
        `Average API response time is ${metrics.api.averageResponseTime}ms, above threshold of ${this.alertThresholds.latencyThreshold}ms`,
        {
          current: metrics.api.averageResponseTime,
          threshold: this.alertThresholds.latencyThreshold,
          totalRequests: metrics.api.totalRequests
        }
      ));
    }

    // Check cache hit rate
    if (metrics.cache && metrics.cache.hitRate < this.alertThresholds.cacheHitRate) {
      alerts.push(this.createAlert(
        this.alertTypes.CACHE,
        'Low Cache Hit Rate',
        `Cache hit rate is ${metrics.cache.hitRate.toFixed(2)}%, below threshold of ${this.alertThresholds.cacheHitRate}%`,
        {
          current: metrics.cache.hitRate,
          threshold: this.alertThresholds.cacheHitRate,
          hits: metrics.cache.hits,
          misses: metrics.cache.misses
        }
      ));
    }

    // Check consecutive failures for auto-pause
    if (metrics.polling && metrics.polling.failedCycles >= this.alertThresholds.consecutiveFailures) {
      if (!this.alertState.autoPaused) {
        this.triggerAutoPause('consecutive_failures', metrics.polling.failedCycles);
        alerts.push(this.createAlert(
          this.alertTypes.SYSTEM,
          'Auto-Pause Triggered',
          `System auto-paused due to ${metrics.polling.failedCycles} consecutive failures`,
          {
            consecutiveFailures: metrics.polling.failedCycles,
            threshold: this.alertThresholds.consecutiveFailures
          }
        ));
      }
    } else {
      // Reset consecutive failures if below threshold
      this.alertState.consecutiveFailures = 0;
      if (this.alertState.autoPaused && this.alertState.pauseReason === 'consecutive_failures') {
        this.clearAutoPause();
        alerts.push(this.createAlert(
          this.alertTypes.SYSTEM,
          'Auto-Pause Cleared',
          'System auto-pause cleared - failures resolved',
          { reason: 'failures_resolved' }
        ));
      }
    }

    // Process and store alerts
    const processedAlerts = this.processAlerts(alerts);

    return {
      hasAlerts: processedAlerts.length > 0,
      alerts: processedAlerts,
      autoPaused: this.alertState.autoPaused,
      pauseReason: this.alertState.pauseReason,
      consecutiveFailures: this.alertState.consecutiveFailures
    };
  }

  /**
   * Create an alert object
   * @param {string} type Alert type
   * @param {string} title Alert title
   * @param {string} message Alert message
   * @param {Object} data Additional alert data
   * @returns {Object} Alert object
   */
  createAlert(type, title, message, data = {}) {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      data,
      timestamp: new Date().toISOString(),
      severity: this.getAlertSeverity(type, data),
      acknowledged: false
    };
  }

  /**
   * Determine alert severity based on type and data
   * @param {string} type Alert type
   * @param {Object} data Alert data
   * @returns {string} Severity level
   */
  getAlertSeverity(type, data) {
    switch (type) {
      case this.alertTypes.SYSTEM:
        return 'critical';
      case this.alertTypes.PERFORMANCE:
        if (data.current < 50) return 'critical';
        if (data.current < 75) return 'high';
        return 'medium';
      case this.alertTypes.LATENCY:
        if (data.current > 30000) return 'critical';
        if (data.current > 20000) return 'high';
        return 'medium';
      case this.alertTypes.CACHE:
        if (data.current < 50) return 'high';
        return 'medium';
      default:
        return 'medium';
    }
  }

  /**
   * Process and store alerts
   * @param {Array} alerts Array of alert objects
   * @returns {Array} Processed alerts
   */
  processAlerts(alerts) {
    const now = Date.now();
    const processedAlerts = [];

    for (const alert of alerts) {
      // Check cooldown period
      if (this.alertState.lastAlertTime && 
          (now - this.alertState.lastAlertTime) < this.alertState.alertCooldown) {
        continue;
      }

      // Log alert
      this.logAlert(alert);

      // Store alert
      this.alerts.push(alert);
      processedAlerts.push(alert);

      // Update last alert time
      this.alertState.lastAlertTime = now;

      // Keep only last 100 alerts
      if (this.alerts.length > 100) {
        this.alerts = this.alerts.slice(-100);
      }
    }

    return processedAlerts;
  }

  /**
   * Log alert to logger service
   * @param {Object} alert Alert object
   */
  logAlert(alert) {
    const logLevel = alert.severity === 'critical' ? 'error' : 
                    alert.severity === 'high' ? 'warn' : 'info';

    logger[logLevel](`Alert: ${alert.title}`, {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      data: alert.data,
      timestamp: alert.timestamp
    });
  }

  /**
   * Trigger auto-pause functionality
   * @param {string} reason Reason for auto-pause
   * @param {number} failureCount Number of failures
   */
  triggerAutoPause(reason, failureCount) {
    this.alertState.autoPaused = true;
    this.alertState.lastPauseTime = Date.now();
    this.alertState.pauseReason = reason;
    this.alertState.consecutiveFailures = failureCount;

    logger.error('System auto-paused', {
      reason,
      failureCount,
      pauseTime: new Date().toISOString()
    });
  }

  /**
   * Clear auto-pause state
   */
  clearAutoPause() {
    this.alertState.autoPaused = false;
    this.alertState.lastPauseTime = null;
    this.alertState.pauseReason = null;
    this.alertState.consecutiveFailures = 0;

    logger.info('System auto-pause cleared', {
      clearTime: new Date().toISOString()
    });
  }

  /**
   * Check if system should be paused
   * @returns {boolean} Whether system should be paused
   */
  shouldPause() {
    return this.alertState.autoPaused;
  }

  /**
   * Get auto-pause status
   * @returns {Object} Auto-pause status
   */
  getAutoPauseStatus() {
    return {
      paused: this.alertState.autoPaused,
      reason: this.alertState.pauseReason,
      pauseTime: this.alertState.lastPauseTime,
      consecutiveFailures: this.alertState.consecutiveFailures,
      canResume: this.alertState.autoPaused && 
                 (Date.now() - this.alertState.lastPauseTime) > 60000 // 1 minute minimum pause
    };
  }

  /**
   * Manually resume system (clear auto-pause)
   * @returns {boolean} Success status
   */
  manualResume() {
    if (this.alertState.autoPaused) {
      this.clearAutoPause();
      logger.info('System manually resumed', {
        resumeTime: new Date().toISOString()
      });
      return true;
    }
    return false;
  }

  /**
   * Get recent alerts
   * @param {number} limit Number of alerts to retrieve
   * @param {string} severity Filter by severity (optional)
   * @returns {Array} Recent alerts
   */
  getRecentAlerts(limit = 20, severity = null) {
    let alerts = [...this.alerts].reverse(); // Most recent first

    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    return alerts.slice(0, limit);
  }

  /**
   * Acknowledge an alert
   * @param {string} alertId Alert ID to acknowledge
   * @returns {boolean} Success status
   */
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      
      logger.info('Alert acknowledged', {
        alertId,
        title: alert.title,
        acknowledgedAt: alert.acknowledgedAt
      });
      
      return true;
    }
    return false;
  }

  /**
   * Clear old alerts
   * @param {number} maxAge Maximum age in milliseconds
   */
  clearOldAlerts(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    const cutoffTime = Date.now() - maxAge;
    const initialCount = this.alerts.length;
    
    this.alerts = this.alerts.filter(alert => 
      new Date(alert.timestamp).getTime() > cutoffTime
    );

    const removedCount = initialCount - this.alerts.length;
    if (removedCount > 0) {
      logger.info('Cleared old alerts', {
        removedCount,
        remainingCount: this.alerts.length
      });
    }
  }

  /**
   * Get alerting service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    const severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };

    this.alerts.forEach(alert => {
      severityCounts[alert.severity] = (severityCounts[alert.severity] || 0) + 1;
    });

    return {
      totalAlerts: this.alerts.length,
      severityCounts,
      autoPaused: this.alertState.autoPaused,
      consecutiveFailures: this.alertState.consecutiveFailures,
      lastAlertTime: this.alertState.lastAlertTime,
      thresholds: this.alertThresholds
    };
  }

  /**
   * Get alerting service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      service: 'AlertingService',
      thresholds: this.alertThresholds,
      alertState: this.alertState,
      stats: this.getStats(),
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = AlertingService;
