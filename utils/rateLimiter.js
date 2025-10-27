'use strict';

const logger = require('./loggerService');

/**
 * Dynamic Rate Limiter for SportMonks Cricket API
 * Implements adaptive rate limiting with backoff strategies
 */
class RateLimiter {
  constructor(options = {}) {
    // Default SportMonks configuration
    this.maxCallsPerHour = options.maxCallsPerHour || 3000;
    this.defaultDelay = options.defaultDelay || 1000; // 1 second between requests
    this.maxDelay = options.maxDelay || 30000; // 30 seconds max delay
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitterFactor = options.jitterFactor || 0.1;
    
    // Entity-specific rate limiting (SportMonks has separate limits per entity)
    // FIXED: Initialize with full quota to prevent immediate blocking
    this.entities = {
      'livescores': { calls: 0, resetTime: null, remaining: this.maxCallsPerHour, lastCall: null, initialized: false },
      'fixtures': { calls: 0, resetTime: null, remaining: this.maxCallsPerHour, lastCall: null, initialized: false },
      'teams': { calls: 0, resetTime: null, remaining: this.maxCallsPerHour, lastCall: null, initialized: false },
      'players': { calls: 0, resetTime: null, remaining: this.maxCallsPerHour, lastCall: null, initialized: false },
      'leagues': { calls: 0, resetTime: null, remaining: this.maxCallsPerHour, lastCall: null, initialized: false }
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      isOpen: false,
      failures: 0,
      lastFailure: null,
      threshold: 5, // Open circuit after 5 consecutive failures
      timeout: 60000 // 1 minute timeout
    };
    
    // Request history for analytics
    this.requestHistory = [];
    this.maxHistorySize = 1000;
    
    logger.info('RateLimiter initialized', {
      maxCallsPerHour: this.maxCallsPerHour,
      defaultDelay: this.defaultDelay,
      maxDelay: this.maxDelay,
      entities: Object.keys(this.entities)
    });
  }

  /**
   * Extract entity from API endpoint URL
   * @param {string} endpoint - The API endpoint
   * @returns {string} The entity name
   */
  extractEntity(endpoint) {
    if (endpoint.includes('/livescores')) return 'livescores';
    if (endpoint.includes('/fixtures')) return 'fixtures';
    if (endpoint.includes('/teams')) return 'teams';
    if (endpoint.includes('/players')) return 'players';
    if (endpoint.includes('/leagues')) return 'leagues';
    return 'fixtures'; // Default fallback
  }

  /**
   * Update rate limit information from API response metadata
   * @param {Object} response - Axios response object
   * @param {string} entity - The entity name
   */
  updateFromResponse(response, entity) {
    try {
      const entityInfo = this.entities[entity];
      if (!entityInfo) return;

      let updated = false;
      
      // ENHANCED: Check for SportMonks rate limit info in response metadata
      if (response.data?.meta?.rate_limit) {
        const rateLimit = response.data.meta.rate_limit;
        
        // Update with actual API data
        if (rateLimit.remaining !== undefined) {
          entityInfo.remaining = Math.max(0, rateLimit.remaining);
          entityInfo.calls = this.maxCallsPerHour - rateLimit.remaining;
          updated = true;
          
          logger.info(`Rate limit updated from meta for ${entity}`, {
            remaining: rateLimit.remaining,
            resetsInSeconds: rateLimit.resets_in_seconds,
            entity,
            source: 'response_meta'
          });
        }
        
        if (rateLimit.resets_in_seconds) {
          entityInfo.resetTime = new Date(Date.now() + (rateLimit.resets_in_seconds * 1000));
        }
      }
      
      // ENHANCED: Check headers for rate limit info with multiple header variations
      const headers = response.headers || {};
      const headerVariations = [
        'x-ratelimit-remaining',
        'x-rate-limit-remaining', 
        'ratelimit-remaining',
        'rate-limit-remaining'
      ];
      
      for (const headerName of headerVariations) {
        if (headers[headerName]) {
          const remaining = parseInt(headers[headerName]);
          if (!isNaN(remaining)) {
            entityInfo.remaining = Math.max(0, remaining);
            updated = true;
            
            logger.info(`Rate limit updated from headers for ${entity}`, {
              remaining,
              headerName,
              entity,
              source: 'response_headers'
            });
            break;
          }
        }
      }
      
      // Check reset time headers
      const resetHeaders = ['x-ratelimit-reset', 'x-rate-limit-reset', 'ratelimit-reset'];
      for (const resetHeader of resetHeaders) {
        if (headers[resetHeader]) {
          const resetTime = parseInt(headers[resetHeader]);
          if (!isNaN(resetTime)) {
            entityInfo.resetTime = new Date(resetTime * 1000);
            break;
          }
        }
      }
      
      // FIXED: If this is the first successful response and no rate limit info found, 
      // set reasonable defaults to prevent blocking
      if (!entityInfo.initialized && !updated) {
        logger.warn(`No rate limit data found for ${entity}, using safe defaults`, {
          entity,
          defaultRemaining: this.maxCallsPerHour - 1
        });
        
        entityInfo.remaining = this.maxCallsPerHour - 1; // Assume 1 call used
        entityInfo.calls = 1;
        entityInfo.initialized = true;
      }
      
      // Mark as initialized after first successful response
      entityInfo.initialized = true;
      
      // Reset circuit breaker on success
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.isOpen = false;
      
    } catch (error) {
      logger.error('Failed to update rate limit from response', {
        error: error.message,
        stack: error.stack,
        entity,
        hasResponseData: !!response?.data,
        hasHeaders: !!response?.headers
      });
    }
  }

  /**
   * Check if rate limit is exceeded for an entity
   * @param {string} entity - The entity name
   * @returns {Object} Rate limit status
   */
  checkRateLimit(entity) {
    const entityInfo = this.entities[entity] || this.entities.fixtures;
    const now = new Date();
    
    // Check if reset time has passed
    if (entityInfo.resetTime && entityInfo.resetTime <= now) {
      entityInfo.remaining = this.maxCallsPerHour;
      entityInfo.calls = 0;
      entityInfo.resetTime = null;
    }
    
    const isLimited = entityInfo.remaining <= 0;
    const resetInSeconds = entityInfo.resetTime ? 
      Math.max(0, Math.floor((entityInfo.resetTime - now) / 1000)) : 0;
    
    return {
      isLimited,
      remaining: entityInfo.remaining,
      resetTime: entityInfo.resetTime,
      resetInSeconds,
      entity
    };
  }

  /**
   * Check circuit breaker status
   * @returns {Object} Circuit breaker status
   */
  checkCircuitBreaker() {
    const now = Date.now();
    
    // Auto-reset circuit breaker after timeout
    if (this.circuitBreaker.isOpen && 
        this.circuitBreaker.lastFailure &&
        (now - this.circuitBreaker.lastFailure) > this.circuitBreaker.timeout) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
      logger.info('Circuit breaker reset after timeout');
    }
    
    return {
      isOpen: this.circuitBreaker.isOpen,
      failures: this.circuitBreaker.failures,
      threshold: this.circuitBreaker.threshold
    };
  }

  /**
   * Calculate adaptive delay based on rate limit status and backoff
   * @param {string} entity - The entity name
   * @param {number} attempt - Current attempt number (for exponential backoff)
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(entity, attempt = 1) {
    const entityInfo = this.entities[entity] || this.entities.fixtures;
    let delay = this.defaultDelay;
    
    // Base delay between requests
    if (entityInfo.lastCall) {
      const timeSinceLastCall = Date.now() - entityInfo.lastCall;
      if (timeSinceLastCall < this.defaultDelay) {
        delay = this.defaultDelay - timeSinceLastCall;
      } else {
        delay = 0; // No additional delay needed
      }
    }
    
    // Exponential backoff for retries
    if (attempt > 1) {
      const exponentialDelay = this.defaultDelay * Math.pow(this.backoffMultiplier, attempt - 1);
      delay = Math.max(delay, exponentialDelay);
    }
    
    // Additional delay if rate limited
    const rateLimitStatus = this.checkRateLimit(entity);
    if (rateLimitStatus.isLimited && rateLimitStatus.resetInSeconds > 0) {
      // Add percentage of reset time as additional delay
      const rateLimitDelay = Math.min(
        rateLimitStatus.resetInSeconds * 1000 * 0.1, // 10% of reset time
        this.maxDelay
      );
      delay = Math.max(delay, rateLimitDelay);
    }
    
    // Add jitter to prevent thundering herd
    const jitter = delay * this.jitterFactor * Math.random();
    delay = Math.floor(delay + jitter);
    
    // Cap at maximum delay
    return Math.min(delay, this.maxDelay);
  }

  /**
   * Enforce rate limiting before making a request
   * @param {string} endpoint - The API endpoint
   * @param {number} attempt - Current attempt number
   * @returns {Promise<Object>} Rate limit check result
   */
  async enforceRateLimit(endpoint, attempt = 1) {
    const entity = this.extractEntity(endpoint);
    
    try {
      // Check circuit breaker
      const circuitStatus = this.checkCircuitBreaker();
      if (circuitStatus.isOpen) {
        throw new Error(`Circuit breaker is open for rate limiter (${circuitStatus.failures}/${circuitStatus.threshold} failures)`);
      }
      
      // Check entity rate limit
      const rateLimitStatus = this.checkRateLimit(entity);
      
      if (rateLimitStatus.isLimited) {
        logger.warn(`Rate limit exceeded for entity ${entity}`, {
          entity,
          remaining: rateLimitStatus.remaining,
          resetInSeconds: rateLimitStatus.resetInSeconds
        });
        
        // If reset time is reasonable, wait for it
        if (rateLimitStatus.resetInSeconds > 0 && rateLimitStatus.resetInSeconds <= 30) {
          const waitTime = rateLimitStatus.resetInSeconds * 1000;
          logger.info(`Waiting ${waitTime}ms for rate limit reset`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw new Error(`Rate limit exceeded for ${entity}. Reset in ${rateLimitStatus.resetInSeconds} seconds`);
        }
      }
      
      // Calculate and apply delay
      const delay = this.calculateDelay(entity, attempt);
      
      if (delay > 0) {
        logger.debug(`Rate limiting: waiting ${delay}ms for ${entity}`, {
          entity,
          attempt,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Record request
      this.recordRequest(entity, endpoint);
      
      return {
        success: true,
        entity,
        delay,
        remaining: rateLimitStatus.remaining,
        attempt
      };
      
    } catch (error) {
      logger.error('Rate limit enforcement failed', {
        entity,
        endpoint,
        attempt,
        error: error.message
      });
      
      // Update circuit breaker on failure
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailure = Date.now();
      
      if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        this.circuitBreaker.isOpen = true;
        logger.error('Circuit breaker opened due to rate limit failures', {
          failures: this.circuitBreaker.failures,
          threshold: this.circuitBreaker.threshold
        });
      }
      
      throw error;
    }
  }

  /**
   * Record a successful request
   * @param {string} entity - The entity name
   * @param {string} endpoint - The API endpoint
   */
  recordRequest(entity, endpoint) {
    const now = Date.now();
    const entityInfo = this.entities[entity] || this.entities.fixtures;
    
    // Update entity info
    entityInfo.lastCall = now;
    entityInfo.remaining = Math.max(0, entityInfo.remaining - 1);
    entityInfo.calls++;
    
    // Add to request history
    this.requestHistory.push({
      timestamp: now,
      entity,
      endpoint,
      remaining: entityInfo.remaining
    });
    
    // Trim history to max size
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);
    }
    
    logger.debug('Request recorded', {
      entity,
      endpoint,
      remaining: entityInfo.remaining,
      totalRequests: entityInfo.calls
    });
  }

  /**
   * Handle rate limit error response
   * @param {Error} error - The error object
   * @param {string} entity - The entity name
   */
  handleRateLimitError(error, entity) {
    if (error.response?.status === 429) {
      logger.warn('429 Rate Limit Error received', {
        entity,
        error: error.message
      });
      
      // Extract retry-after header if available
      const retryAfter = error.response.headers['retry-after'];
      if (retryAfter) {
        const retryAfterSeconds = parseInt(retryAfter);
        if (!isNaN(retryAfterSeconds)) {
          const entityInfo = this.entities[entity] || this.entities.fixtures;
          entityInfo.resetTime = new Date(Date.now() + (retryAfterSeconds * 1000));
          entityInfo.remaining = 0;
          
          logger.info(`Rate limit reset time updated from retry-after header`, {
            entity,
            retryAfterSeconds
          });
        }
      }
    }
    
    // Update circuit breaker
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
  }

  /**
   * Get comprehensive rate limit status
   * @returns {Object} Rate limit status for all entities
   */
  getStatus() {
    const now = new Date();
    const status = {
      timestamp: now.toISOString(),
      circuitBreaker: this.checkCircuitBreaker(),
      entities: {},
      summary: {
        totalEntities: Object.keys(this.entities).length,
        limitedEntities: 0,
        totalRemaining: 0,
        totalCalls: 0
      },
      config: {
        maxCallsPerHour: this.maxCallsPerHour,
        defaultDelay: this.defaultDelay,
        maxDelay: this.maxDelay,
        backoffMultiplier: this.backoffMultiplier
      }
    };
    
    Object.keys(this.entities).forEach(entity => {
      const entityStatus = this.checkRateLimit(entity);
      const entityInfo = this.entities[entity];
      
      status.entities[entity] = {
        ...entityStatus,
        calls: entityInfo.calls,
        lastCall: entityInfo.lastCall ? new Date(entityInfo.lastCall).toISOString() : null
      };
      
      if (entityStatus.isLimited) {
        status.summary.limitedEntities++;
      }
      status.summary.totalRemaining += entityStatus.remaining;
      status.summary.totalCalls += entityInfo.calls;
    });
    
    return status;
  }

  /**
   * Get recent request history
   * @param {number} limit - Number of recent requests to return
   * @returns {Array} Recent request history
   */
  getRequestHistory(limit = 100) {
    return this.requestHistory.slice(-limit).map(req => ({
      ...req,
      timestamp: new Date(req.timestamp).toISOString()
    }));
  }

  /**
   * Reset rate limiter state (for testing/debugging)
   */
  reset() {
    Object.keys(this.entities).forEach(entity => {
      this.entities[entity] = {
        calls: 0,
        resetTime: null,
        remaining: this.maxCallsPerHour,
        lastCall: null,
        initialized: false
      };
    });
    
    this.circuitBreaker = {
      isOpen: false,
      failures: 0,
      lastFailure: null,
      threshold: 5,
      timeout: 60000
    };
    
    this.requestHistory = [];
    
    logger.info('Rate limiter reset - all entities restored to full quota');
  }

  /**
   * EMERGENCY: Reset specific entity that may be stuck
   * @param {string} entity - Entity to reset
   */
  resetEntity(entity) {
    if (this.entities[entity]) {
      const oldState = { ...this.entities[entity] };
      
      this.entities[entity] = {
        calls: 0,
        resetTime: null,
        remaining: this.maxCallsPerHour,
        lastCall: null,
        initialized: false
      };
      
      logger.warn(`EMERGENCY RESET: Entity ${entity} reset due to stuck state`, {
        entity,
        oldState,
        newState: this.entities[entity]
      });
      
      return true;
    }
    
    logger.error(`Cannot reset entity ${entity} - not found`);
    return false;
  }

  /**
   * Get entity-specific rate limit info
   * @param {string} entity - The entity name
   * @returns {Object} Entity rate limit information
   */
  getEntityInfo(entity) {
    const rateLimitStatus = this.checkRateLimit(entity);
    const entityInfo = this.entities[entity] || this.entities.fixtures;
    
    return {
      ...rateLimitStatus,
      calls: entityInfo.calls,
      lastCall: entityInfo.lastCall ? new Date(entityInfo.lastCall).toISOString() : null,
      entity
    };
  }
}

module.exports = RateLimiter;
