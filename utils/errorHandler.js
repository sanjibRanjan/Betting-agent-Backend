'use strict';

const logger = require('./loggerService');

/**
 * Production-ready Error Handling Service
 * Provides robust error handling with retry logic, exponential backoff, and jitter
 */
class ErrorHandler {
  constructor() {
    this.maxRetries = 3;
    this.baseRetryDelay = 1000; // 1 second
    this.retryMultiplier = 2;
    this.maxRetryDelay = 30000; // 30 seconds
    this.retryableStatuses = [401, 429, 500, 502, 503, 504, 'ECONNABORTED', 'ENOTFOUND', 'ECONNRESET'];
    this.circuitBreakerThreshold = 5; // Failures before circuit opens
    this.circuitBreakerTimeout = 60000; // 1 minute before trying again
    this.circuitBreakerState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Check if error is retryable
   * @param {Error} error The error to check
   * @returns {boolean} Whether the error is retryable
   */
  isRetryable(error) {
    if (this.circuitBreakerState === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.circuitBreakerTimeout) {
        return false;
      }
      // Time to try again - move to HALF_OPEN
      this.circuitBreakerState = 'HALF_OPEN';
      logger.warn('Circuit breaker moving to HALF_OPEN state', {
        timeSinceLastFailure,
        circuitBreakerTimeout: this.circuitBreakerTimeout
      });
    }

    const statusCode = error.response?.status || error.code;
    return this.retryableStatuses.includes(statusCode);
  }

  /**
   * Update circuit breaker state
   * @param {boolean} success Whether the operation was successful
   */
  updateCircuitBreaker(success) {
    if (success) {
      if (this.circuitBreakerState === 'HALF_OPEN') {
        this.circuitBreakerState = 'CLOSED';
        this.failureCount = 0;
        logger.info('Circuit breaker closed - service recovered');
      }
    } else {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.circuitBreakerThreshold) {
        this.circuitBreakerState = 'OPEN';
        logger.error('Circuit breaker opened - too many failures', {
          failureCount: this.failureCount,
          threshold: this.circuitBreakerThreshold
        });
      }
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt Current attempt number (1-based)
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const delay = Math.min(
      this.baseRetryDelay * Math.pow(this.retryMultiplier, attempt - 1),
      this.maxRetryDelay
    );
    
    // Add jitter to prevent thundering herd (10-20% random variation)
    const jitter = delay * (0.1 + Math.random() * 0.1);
    return Math.floor(delay + jitter);
  }

  /**
   * Execute operation with retry logic and circuit breaker
   * @param {Function} operation The operation to execute
   * @param {Object} context Context information for logging
   * @returns {Promise<any>} Result of the operation
   */
  async executeWithRetry(operation, context = {}) {
    let lastError = null;
    const startTime = Date.now();
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug('Executing operation with retry logic', {
          attempt,
          maxRetries: this.maxRetries,
          circuitBreakerState: this.circuitBreakerState,
          ...context
        });

        const result = await operation();
        this.updateCircuitBreaker(true);
        
        const duration = Date.now() - startTime;
        logger.info('Operation succeeded', {
          attempt,
          duration,
          ...context
        });
        
        return result;
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;
        
        logger.warn('Operation failed', {
          attempt,
          maxRetries: this.maxRetries,
          error: error.message,
          statusCode: error.response?.status || error.code,
          duration,
          ...context
        });

        // Check if we should retry
        if (attempt < this.maxRetries && this.isRetryable(error)) {
          const delay = this.calculateRetryDelay(attempt);
          
          logger.info('Retrying operation', {
            attempt,
            nextAttempt: attempt + 1,
            retryDelay: delay,
            ...context
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Final failure
        this.updateCircuitBreaker(false);
        
        logger.error('Operation failed after all retries', {
          attempts: attempt,
          totalDuration: duration,
          finalError: error.message,
          statusCode: error.response?.status || error.code,
          ...context
        });
        
        throw this.enhanceError(error, context, duration);
      }
    }

    throw lastError;
  }

  /**
   * Enhance error with additional context and categorization
   * @param {Error} error Original error
   * @param {Object} context Additional context
   * @param {number} duration Operation duration
   * @returns {Error} Enhanced error
   */
  enhanceError(error, context = {}, duration = 0) {
    const enhancedError = new Error(error.message);
    enhancedError.originalError = error;
    enhancedError.context = context;
    enhancedError.duration = duration;
    enhancedError.timestamp = new Date().toISOString();
    enhancedError.category = this.categorizeError(error);
    enhancedError.retryable = this.isRetryable(error);
    
    // Copy relevant properties
    if (error.response) {
      enhancedError.statusCode = error.response.status;
      enhancedError.statusText = error.response.statusText;
      enhancedError.responseData = error.response.data;
    }
    
    if (error.code) {
      enhancedError.code = error.code;
    }

    return enhancedError;
  }

  /**
   * Categorize error for better handling
   * @param {Error} error The error to categorize
   * @returns {string} Error category
   */
  categorizeError(error) {
    if (error.code === 'ECONNABORTED') return 'TIMEOUT';
    if (error.code === 'ENOTFOUND') return 'DNS_ERROR';
    if (error.code === 'ECONNRESET') return 'CONNECTION_RESET';
    if (error.code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
    
    if (error.response) {
      const status = error.response.status;
      if (status >= 400 && status < 500) return 'CLIENT_ERROR';
      if (status >= 500) return 'SERVER_ERROR';
      if (status === 429) return 'RATE_LIMITED';
      if (status === 401) return 'UNAUTHORIZED';
      if (status === 403) return 'FORBIDDEN';
    }
    
    return 'UNKNOWN';
  }

  /**
   * Handle API-specific errors with fallback strategies
   * @param {Error} error The error to handle
   * @param {Object} fallbackData Fallback data to return
   * @param {Object} context Additional context
   * @returns {Object} Error response with fallback data
   */
  handleApiError(error, fallbackData = null, context = {}) {
    const category = this.categorizeError(error);
    const enhancedError = this.enhanceError(error, context);
    
    logger.error('API error handled with fallback', {
      category,
      error: error.message,
      hasFallback: !!fallbackData,
      ...context
    });

    return {
      error: true,
      message: error.message,
      category,
      statusCode: error.response?.status || error.code,
      timestamp: new Date().toISOString(),
      fallback: fallbackData,
      context
    };
  }

  /**
   * Create a timeout promise
   * @param {number} timeoutMs Timeout in milliseconds
   * @returns {Promise} Timeout promise
   */
  createTimeout(timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Wrap operation with timeout
   * @param {Promise} operation The operation promise
   * @param {number} timeoutMs Timeout in milliseconds
   * @returns {Promise} Promise that rejects on timeout
   */
  withTimeout(operation, timeoutMs) {
    return Promise.race([
      operation,
      this.createTimeout(timeoutMs)
    ]);
  }

  /**
   * Get error handler status
   * @returns {Object} Error handler status
   */
  getStatus() {
    return {
      service: 'ErrorHandler',
      maxRetries: this.maxRetries,
      circuitBreakerState: this.circuitBreakerState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      retryableStatuses: this.retryableStatuses,
      baseRetryDelay: this.baseRetryDelay,
      retryMultiplier: this.retryMultiplier,
      maxRetryDelay: this.maxRetryDelay,
      circuitBreakerThreshold: this.circuitBreakerThreshold,
      circuitBreakerTimeout: this.circuitBreakerTimeout,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ErrorHandler;
