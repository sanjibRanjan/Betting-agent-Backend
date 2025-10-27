'use strict';

const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

/**
 * Enhanced Logging Service for Cricket Betting App
 * Provides structured logging with different levels, contexts, and file persistence
 */
class LoggerService {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.enableConsole = process.env.NODE_ENV !== 'test';
    this.logFile = process.env.LOG_FILE || 'cricket-app.log';
    this.logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'monitoring', 'logs');
    
    // Ensure logs directory exists
    this.ensureLogsDirectory();
    
    // Initialize Winston logger
    this.winston = this.initializeWinston();
    
    // Track log counts for monitoring
    this.logCounts = {
      info: 0,
      warn: 0,
      error: 0,
      debug: 0
    };
  }

  /**
   * Ensure logs directory exists
   */
  ensureLogsDirectory() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
        console.log(`[LoggerService] Created logs directory: ${this.logsDir}`);
      }
    } catch (error) {
      console.error(`[LoggerService] Failed to create logs directory: ${error.message}`);
    }
  }

  /**
   * Initialize Winston logger with file rotation
   */
  initializeWinston() {
    const transports = [];

    // Console transport
    if (this.enableConsole) {
      transports.push(
        new winston.transports.Console({
          level: this.logLevel,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      );
    }

    // Daily rotating file transport for general logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(this.logsDir, 'cricket-app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        level: this.logLevel,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );

    // Daily rotating file transport for API logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(this.logsDir, 'api-logs-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );

    // Daily rotating file transport for error logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(this.logsDir, 'error-logs-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );

    return winston.createLogger({
      level: this.logLevel,
      transports,
      exitOnError: false
    });
  }

  /**
   * Get current timestamp in ISO format
   * @returns {string} ISO timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Format log message with context
   * @param {string} level Log level
   * @param {string} message Log message
   * @param {Object} context Additional context
   * @returns {Object} Formatted log entry
   */
  formatLog(level, message, context = {}) {
    return {
      timestamp: this.getTimestamp(),
      level: level.toUpperCase(),
      message,
      context,
      pid: process.pid,
      service: 'Sanjib-Agent'
    };
  }

  /**
   * Log info message
   * @param {string} message Log message
   * @param {Object} context Additional context
   */
  info(message, context = {}) {
    this.logCounts.info++;
    this.winston.info(message, this.formatLog('info', message, context));
  }

  /**
   * Log warning message
   * @param {string} message Log message
   * @param {Object} context Additional context
   */
  warn(message, context = {}) {
    this.logCounts.warn++;
    this.winston.warn(message, this.formatLog('warn', message, context));
  }

  /**
   * Log error message
   * @param {string} message Log message
   * @param {Object} context Additional context
   */
  error(message, context = {}) {
    this.logCounts.error++;
    this.winston.error(message, this.formatLog('error', message, context));
  }

  /**
   * Log debug message
   * @param {string} message Log message
   * @param {Object} context Additional context
   */
  debug(message, context = {}) {
    this.logCounts.debug++;
    this.winston.debug(message, this.formatLog('debug', message, context));
  }

  /**
   * Log API request
   * @param {string} method HTTP method
   * @param {string} url Request URL
   * @param {Object} context Additional context
   */
  apiRequest(method, url, context = {}) {
    const logContext = {
      type: 'api_request',
      method,
      url,
      ...context
    };
    this.info(`API Request: ${method} ${url}`, logContext);
    
    // Also log to API-specific file
    this.winston.log('info', `API Request: ${method} ${url}`, {
      ...logContext,
      transport: 'api-logs'
    });
  }

  /**
   * Log API response
   * @param {string} method HTTP method
   * @param {string} url Request URL
   * @param {number} status HTTP status code
   * @param {number} duration Response duration in ms
   * @param {Object} context Additional context
   */
  apiResponse(method, url, status, duration, context = {}) {
    const level = status >= 400 ? 'error' : 'info';
    const logContext = {
      type: 'api_response',
      method,
      url,
      status,
      duration,
      ...context
    };
    
    this[level](`API Response: ${method} ${url} - ${status} (${duration}ms)`, logContext);
    
    // Also log to API-specific file
    this.winston.log(level, `API Response: ${method} ${url} - ${status} (${duration}ms)`, {
      ...logContext,
      transport: 'api-logs'
    });
  }

  /**
   * Log error with detailed context
   * @param {string} message Error message
   * @param {Error} error Original error object
   * @param {Object} context Additional context
   */
  logError(message, error, context = {}) {
    const errorContext = {
      type: 'error_log',
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data
      },
      ...context
    };
    
    this.error(message, errorContext);
  }

  /**
   * Log performance metrics
   * @param {string} operation Operation name
   * @param {number} duration Duration in milliseconds
   * @param {Object} metrics Additional metrics
   * @param {Object} context Additional context
   */
  logPerformance(operation, duration, metrics = {}, context = {}) {
    const performanceContext = {
      type: 'performance',
      operation,
      duration,
      metrics,
      ...context
    };
    
    this.info(`Performance: ${operation} completed in ${duration}ms`, performanceContext);
  }

  /**
   * Log system health status
   * @param {Object} healthData Health status data
   * @param {Object} context Additional context
   */
  logHealth(healthData, context = {}) {
    const healthContext = {
      type: 'health_check',
      health: healthData,
      ...context
    };
    
    this.info('Health check completed', healthContext);
  }

  /**
   * Log cache operation
   * @param {string} operation Cache operation (hit, miss, set, clear)
   * @param {string} key Cache key
   * @param {Object} context Additional context
   */
  cacheOperation(operation, key, context = {}) {
    this.info(`Cache ${operation}: ${key}`, {
      type: 'cache_operation',
      operation,
      key,
      ...context
    });
  }

  /**
   * Log socket operation
   * @param {string} operation Socket operation
   * @param {string} clientId Client ID
   * @param {Object} context Additional context
   */
  socketOperation(operation, clientId, context = {}) {
    this.info(`Socket ${operation}: ${clientId}`, {
      type: 'socket_operation',
      operation,
      clientId,
      ...context
    });
  }

  /**
   * Check if should log at given level
   * @param {string} level Log level to check
   * @returns {boolean} Whether to log
   */
  shouldLog(level) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const requestedLevelIndex = levels.indexOf(level);
    return requestedLevelIndex >= currentLevelIndex;
  }

  /**
   * Output log entry
   * @param {Object} logEntry Formatted log entry
   */
  output(logEntry) {
    if (this.enableConsole) {
      const logString = JSON.stringify(logEntry);
      console.log(logString);
    }
  }

  /**
   * Get recent logs from files
   * @param {number} limit Number of logs to retrieve
   * @param {string} level Log level filter (optional)
   * @returns {Promise<Array>} Array of recent log entries
   */
  async getRecentLogs(limit = 50, level = null) {
    try {
      const logFiles = fs.readdirSync(this.logsDir)
        .filter(file => file.endsWith('.log'))
        .map(file => path.join(this.logsDir, file))
        .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime);

      const logs = [];
      
      for (const logFile of logFiles) {
        if (logs.length >= limit) break;
        
        try {
          const content = fs.readFileSync(logFile, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          
          for (const line of lines.reverse()) {
            if (logs.length >= limit) break;
            
            try {
              const logEntry = JSON.parse(line);
              if (!level || logEntry.level === level) {
                logs.push(logEntry);
              }
            } catch (parseError) {
              // Skip invalid JSON lines
              continue;
            }
          }
        } catch (readError) {
          console.error(`Failed to read log file ${logFile}:`, readError.message);
        }
      }
      
      return logs.slice(0, limit);
    } catch (error) {
      console.error('Failed to retrieve recent logs:', error.message);
      return [];
    }
  }

  /**
   * Get log statistics
   * @returns {Object} Log statistics
   */
  getLogStats() {
    return {
      totalLogs: Object.values(this.logCounts).reduce((sum, count) => sum + count, 0),
      logCounts: { ...this.logCounts },
      logsDirectory: this.logsDir,
      logLevel: this.logLevel,
      enableConsole: this.enableConsole
    };
  }

  /**
   * Clear log counts (for testing or reset)
   */
  clearLogCounts() {
    this.logCounts = {
      info: 0,
      warn: 0,
      error: 0,
      debug: 0
    };
  }

  /**
   * Get logger status
   * @returns {Object} Logger status information
   */
  getStatus() {
    return {
      service: 'LoggerService',
      logLevel: this.logLevel,
      enableConsole: this.enableConsole,
      logFile: this.logFile,
      logsDirectory: this.logsDir,
      logStats: this.getLogStats(),
      status: 'ready',
      timestamp: this.getTimestamp()
    };
  }
}

// Create singleton instance
const logger = new LoggerService();

module.exports = logger;
