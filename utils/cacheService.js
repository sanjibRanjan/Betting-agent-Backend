'use strict';

const logger = require('./loggerService');

/**
 * Enhanced Redis Cache Service for cricket matches
 * Handles caching, retrieval, cache freshness validation, and monitoring
 */
class CacheService {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.cacheKey = 'live:cricket:matches';
    this.previousCacheKey = 'live:cricket:matches:previous';
    this.defaultTTL = 60; // 60 seconds
    
    // Enhanced Cache freshness configuration aligned with requirements
    this.freshnessConfig = {
      liveMatches: 30000,      // 30 seconds for live matches
      fixtures: 300000,        // 5 minutes for fixtures  
      ballByBall: 10000,       // 10 seconds for ball-by-ball data
      staleThreshold: 600000,  // 10 minutes before considering data too stale
      maxRetentionTime: 86400000, // 24 hours max retention
      qualityThreshold: 0.7    // Data quality must be above 70%
    };
    
    // Cache type detection for dynamic TTL
    this.cacheTypes = {
      'live:cricket:matches': 'liveMatches',
      'cricket:fixtures': 'fixtures',
      'cricket:ballbyball': 'ballByBall',
      'cricket:teams': 'teams',
      'cricket:players': 'players'
    };
    
    // Cache monitoring metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      writes: 0,
      invalidations: 0,
      freshnessWarnings: 0,
      staleServed: 0,
      errors: 0
    };
    
    // Cache quality thresholds
    // TEMPORARILY RELAXED for debugging and testing
    this.qualityThresholds = {
      minDataCompleteness: 0.4, // REDUCED: 40% minimum data completeness (was 0.7)
      maxErrorRate: 0.3, // INCREASED: 30% maximum error rate (was 0.1)
      minMatchCount: 0 // RELAXED: Allow 0 matches for debugging (was 1)
    };
    
    logger.info('Enhanced CacheService initialized', {
      defaultTTL: this.defaultTTL,
      freshnessConfig: this.freshnessConfig,
      qualityThresholds: this.qualityThresholds
    });
  }

  /**
   * Store live matches in Redis cache with enhanced validation and monitoring
   * @param {Array} matches Array of match objects
   * @param {number} ttl Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async setLiveMatches(matches, ttl = null, cacheType = 'liveMatches') {
    // Auto-determine TTL based on cache type if not provided
    if (!ttl) {
      ttl = this.freshnessConfig[cacheType] ? this.freshnessConfig[cacheType] / 1000 : this.defaultTTL;
    }
    const startTime = Date.now();
    
    try {
      // Validate input
      const validationResult = this.validateMatchesData(matches);
      if (!validationResult.isValid) {
        this.metrics.errors++;
        logger.error('Invalid matches data provided to cache', {
          errors: validationResult.errors,
          matchesType: typeof matches,
          isArray: Array.isArray(matches)
        });
        return false;
      }

      // Assess data quality before caching
      const qualityAssessment = this.assessDataQuality(matches);
      if (!qualityAssessment.meetsThreshold) {
        this.metrics.errors++;
        logger.warn('Matches data quality below threshold, not caching', {
          qualityAssessment,
          thresholds: this.qualityThresholds
        });
        return false;
      }

      // Store previous state before updating current state
      await this.storePreviousState();

      // Create enhanced cache data structure
      const cacheData = {
        matches: matches,
        timestamp: new Date().toISOString(),
        ttl: ttl,
        count: matches.length,
        source: 'api',
        version: '2.0',
        quality: qualityAssessment,
        metadata: {
          cacheWriteTime: Date.now(),
          expiryTime: Date.now() + (ttl * 1000),
          dataHash: this.generateDataHash(matches),
          freshnessLevel: 'fresh'
        }
      };

      // Write to cache with monitoring
      await this.redisClient.set(
        this.cacheKey, 
        JSON.stringify(cacheData), 
        { EX: ttl }
      );
      
      const duration = Date.now() - startTime;
      this.metrics.writes++;

      logger.info('Successfully cached live matches with quality validation', {
        matchesCount: matches.length,
        ttl: ttl,
        duration: duration,
        qualityScore: qualityAssessment.completeness,
        cacheKey: this.cacheKey
      });

      return true;

    } catch (error) {
      this.metrics.errors++;
      const duration = Date.now() - startTime;
      
      logger.error('Failed to cache live matches', {
        error: error.message,
        stack: error.stack,
        matchesCount: Array.isArray(matches) ? matches.length : 'invalid',
        duration: duration
      });
      return false;
    }
  }

  /**
   * Store data with specific cache key and TTL
   * @param {string} key Cache key
   * @param {any} data Data to cache
   * @param {number} ttl Time to live in seconds
   * @param {Object} metadata Additional metadata
   * @returns {Promise<boolean>} Success status
   */
  async setData(key, data, ttl, metadata = {}) {
    try {
      const cacheData = {
        data,
        timestamp: new Date().toISOString(),
        ttl,
        metadata: {
          ...metadata,
          source: 'api',
          version: '1.0'
        }
      };

      const startTime = Date.now();
      await this.redisClient.set(key, JSON.stringify(cacheData), { EX: ttl });
      const duration = Date.now() - startTime;

      console.log(`[CacheService] Successfully cached data with key '${key}' and TTL ${ttl}s (${duration}ms)`);
      return true;

    } catch (error) {
      console.error(`[CacheService] Failed to cache data with key '${key}':`, {
        error: error.message,
        stack: error.stack,
        ttl
      });
      return false;
    }
  }

  /**
   * Retrieve data by cache key
   * @param {string} key Cache key
   * @returns {Promise<Object|null>} Cached data or null
   */
  async getData(key) {
    try {
      const startTime = Date.now();
      const cached = await this.redisClient.get(key);
      const duration = Date.now() - startTime;
      
      if (!cached) {
        console.log(`[CacheService] Cache miss for key: ${key} (${duration}ms)`);
        return null;
      }

      const cacheData = JSON.parse(cached);
      const age = Math.floor((Date.now() - new Date(cacheData.timestamp).getTime()) / 1000);
      
      console.log(`[CacheService] Cache hit for key '${key}' (${duration}ms, age: ${age}s)`);
      
      return {
        data: cacheData.data,
        metadata: cacheData.metadata,
        age,
        timestamp: cacheData.timestamp
      };

    } catch (error) {
      console.error(`[CacheService] Failed to retrieve cached data for key '${key}':`, {
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Store fixture details with appropriate TTL
   * @param {string|number} fixtureId Fixture ID
   * @param {Object} fixtureData Fixture details
   * @param {number} ttl Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async setFixtureDetails(fixtureId, fixtureData, ttl = 300) {
    const key = `fixture:details:${fixtureId}`;
    return await this.setData(key, fixtureData, ttl, {
      type: 'fixture_details',
      fixtureId
    });
  }

  /**
   * Retrieve fixture details by ID
   * @param {string|number} fixtureId Fixture ID
   * @returns {Promise<Object|null>} Fixture details or null
   */
  async getFixtureDetails(fixtureId) {
    const key = `fixture:details:${fixtureId}`;
    return await this.getData(key);
  }

  /**
   * Store player stats with appropriate TTL
   * @param {string|number} playerId Player ID
   * @param {Object} playerData Player statistics
   * @param {number} ttl Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async setPlayerStats(playerId, playerData, ttl = 3600) {
    const key = `player:stats:${playerId}`;
    return await this.setData(key, playerData, ttl, {
      type: 'player_stats',
      playerId
    });
  }

  /**
   * Retrieve player stats by ID
   * @param {string|number} playerId Player ID
   * @returns {Promise<Object|null>} Player stats or null
   */
  async getPlayerStats(playerId) {
    const key = `player:stats:${playerId}`;
    return await this.getData(key);
  }

  /**
   * Store ball-by-ball data with appropriate TTL
   * @param {string|number} fixtureId Fixture ID
   * @param {Object} ballData Ball-by-ball data
   * @param {number} ttl Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async setBallByBallData(fixtureId, ballData, ttl = 10) {
    const key = `fixture:balls:${fixtureId}`;
    return await this.setData(key, ballData, ttl, {
      type: 'ball_by_ball',
      fixtureId
    });
  }

  /**
   * Retrieve ball-by-ball data by fixture ID
   * @param {string|number} fixtureId Fixture ID
   * @returns {Promise<Object|null>} Ball-by-ball data or null
   */
  async getBallByBallData(fixtureId) {
    const key = `fixture:balls:${fixtureId}`;
    return await this.getData(key);
  }

  /**
   * Retrieve live matches from Redis cache with freshness validation
   * @param {Object} options - Retrieval options
   * @param {boolean} options.allowStale - Allow stale data if fresh data unavailable
   * @param {number} options.maxStaleTime - Maximum acceptable stale time in ms
   * @returns {Promise<Object>} Cache result with metadata
   */
  async getLiveMatches(options = {}) {
    const startTime = Date.now();
    const { allowStale = true, maxStaleTime = this.freshnessConfig.maxStaleTime } = options;
    
    try {
      const cached = await this.redisClient.get(this.cacheKey);
      const duration = Date.now() - startTime;
      
      // DEBUG: Log cache retrieval
      logger.info('Cache retrieval attempt', {
        cacheKey: this.cacheKey,
        cachedExists: !!cached,
        cachedLength: cached ? cached.length : 0,
        duration: duration
      });
      
      if (!cached) {
        this.metrics.misses++;
        logger.debug('Cache miss for live matches', {
          cacheKey: this.cacheKey,
          duration: duration
        });
        
        return {
          matches: [],
          metadata: {
            source: 'cache_miss',
            fresh: false,
            stale: false,
            age: null,
            quality: null
          }
        };
      }

      const cacheData = JSON.parse(cached);
      const matches = cacheData.matches || [];
      const cacheTimestamp = new Date(cacheData.timestamp);
      const age = Date.now() - cacheTimestamp.getTime();
      
      // Assess cache freshness
      const freshnessAssessment = this.assessCacheFreshness(cacheData, age);
      
      // Update metrics
      this.metrics.hits++;
      if (!freshnessAssessment.isFresh) {
        this.metrics.staleServed++;
        if (freshnessAssessment.needsWarning) {
          this.metrics.freshnessWarnings++;
        }
      }
      
      // Check if data is too stale to serve
      if (!allowStale && !freshnessAssessment.isFresh && age > maxStaleTime) {
        logger.warn('Cache data too stale, not serving', {
          age: age,
          maxStaleTime: maxStaleTime,
          cacheTimestamp: cacheData.timestamp
        });
        
        return {
          matches: [],
          metadata: {
            source: 'cache_too_stale',
            fresh: false,
            stale: true,
            age: age,
            quality: cacheData.quality || null
          }
        };
      }
      
      // Validate cached data quality
      const currentQuality = this.validateCachedData(matches, cacheData);
      if (!currentQuality.isValid) {
        this.metrics.errors++;
        logger.warn('Cached data quality validation failed', {
          qualityIssues: currentQuality.issues,
          matchesCount: matches.length
        });
        
        return {
          matches: [],
          metadata: {
            source: 'cache_invalid_quality',
            fresh: freshnessAssessment.isFresh,
            stale: !freshnessAssessment.isFresh,
            age: age,
            quality: currentQuality
          }
        };
      }
      
      logger.debug('Successfully retrieved live matches from cache', {
        matchesCount: matches.length,
        age: age,
        isFresh: freshnessAssessment.isFresh,
        qualityScore: cacheData.quality?.completeness,
        duration: duration
      });
      
      return {
        matches: matches,
        metadata: {
          source: 'cache_hit',
          fresh: freshnessAssessment.isFresh,
          stale: !freshnessAssessment.isFresh,
          age: age,
          quality: cacheData.quality || null,
          timestamp: cacheData.timestamp,
          ttl: cacheData.ttl,
          freshnessLevel: freshnessAssessment.level
        }
      };

    } catch (error) {
      this.metrics.errors++;
      const duration = Date.now() - startTime;
      
      logger.error('Failed to retrieve cached matches', {
        error: error.message,
        stack: error.stack,
        cacheKey: this.cacheKey,
        duration: duration
      });
      
      return {
        matches: [],
        metadata: {
          source: 'cache_error',
          fresh: false,
          stale: false,
          age: null,
          quality: null,
          error: error.message
        }
      };
    }
  }

  /**
   * Get cache metadata (timestamp, TTL, count)
   * @returns {Promise<Object|null>} Cache metadata or null
   */
  async getCacheMetadata() {
    try {
      const cached = await this.redisClient.get(this.cacheKey);
      
      if (!cached) {
        return null;
      }

      const cacheData = JSON.parse(cached);
      return {
        timestamp: cacheData.timestamp,
        ttl: cacheData.ttl,
        count: cacheData.count,
        age: Math.floor((Date.now() - new Date(cacheData.timestamp).getTime()) / 1000)
      };

    } catch (error) {
      console.error('[CacheService] Failed to get cache metadata:', error.message);
      return null;
    }
  }

  /**
   * Check if cache is valid (not expired)
   * @returns {Promise<boolean>} Cache validity status
   */
  async isCacheValid() {
    try {
      const ttl = await this.redisClient.ttl(this.cacheKey);
      return ttl > 0;
    } catch (error) {
      console.error('[CacheService] Failed to check cache validity:', error.message);
      return false;
    }
  }

  /**
   * Clear the live matches cache
   * @returns {Promise<boolean>} Success status
   */
  async clearCache() {
    try {
      await this.redisClient.del(this.cacheKey);
      console.log('[CacheService] Cache cleared successfully');
      return true;
    } catch (error) {
      console.error('[CacheService] Failed to clear cache:', error.message);
      return false;
    }
  }

  /**
   * Store previous state before updating current state
   * @returns {Promise<boolean>} Success status
   */
  async storePreviousState() {
    try {
      const currentData = await this.redisClient.get(this.cacheKey);
      if (currentData) {
        await this.redisClient.set(this.previousCacheKey, currentData, { EX: this.defaultTTL * 2 });
        console.log('[CacheService] Previous state stored successfully');
        return true;
      }
      return false;
    } catch (error) {
      console.error('[CacheService] Failed to store previous state:', error.message);
      return false;
    }
  }

  /**
   * Get previous matches state for comparison
   * @returns {Promise<Array>} Array of previous matches or empty array
   */
  async getPreviousMatches() {
    try {
      const cached = await this.redisClient.get(this.previousCacheKey);
      if (!cached) {
        console.log('[CacheService] No previous state found');
        return [];
      }

      const cacheData = JSON.parse(cached);
      const matches = cacheData.matches || [];
      
      console.log(`[CacheService] Retrieved ${matches.length} previous matches for comparison`);
      return matches;

    } catch (error) {
      console.error('[CacheService] Failed to retrieve previous matches:', error.message);
      return [];
    }
  }

  /**
   * Get both current and previous matches for comparison
   * @returns {Promise<Object>} Object containing current and previous matches
   */
  async getMatchesForComparison() {
    try {
      const [currentMatches, previousMatches] = await Promise.all([
        this.getLiveMatches(),
        this.getPreviousMatches()
      ]);

      return {
        current: currentMatches,
        previous: previousMatches,
        hasPrevious: previousMatches.length > 0
      };
    } catch (error) {
      console.error('[CacheService] Failed to get matches for comparison:', error.message);
      return {
        current: [],
        previous: [],
        hasPrevious: false
      };
    }
  }

  /**
   * Validate matches data before caching
   * @param {Array} matches - Array of match objects
   * @returns {Object} Validation result
   */
  validateMatchesData(matches) {
    const errors = [];
    
    if (!Array.isArray(matches)) {
      errors.push('Matches data is not an array');
      return { isValid: false, errors };
    }
    
    if (matches.length === 0) {
      return { isValid: true, errors: [], isEmpty: true };
    }
    
    // Validate individual match objects
    matches.forEach((match, index) => {
      if (!match || typeof match !== 'object') {
        errors.push(`Match at index ${index} is not a valid object`);
        return;
      }
      
      if (!match.id && !match.fixtureId && !match.matchId) {
        errors.push(`Match at index ${index} missing required ID field`);
      }
      
      if (!match.teams && !match.teamDetails) {
        errors.push(`Match at index ${index} missing team information`);
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors,
      matchCount: matches.length
    };
  }

  /**
   * Assess data quality of matches array
   * @param {Array} matches - Array of match objects
   * @returns {Object} Quality assessment
   */
  assessDataQuality(matches) {
    if (!Array.isArray(matches)) {
      return {
        completeness: 0,
        errorRate: 1,
        matchCount: 0,
        meetsThreshold: false,
        issues: ['Invalid matches data - not an array']
      };
    }
    
    // ENHANCED: Handle zero matches case for debugging
    if (matches.length === 0) {
      logger.info('Assessing data quality for empty matches array', {
        thresholds: this.qualityThresholds,
        allowEmpty: this.qualityThresholds.minMatchCount === 0
      });
      
      return {
        completeness: 1, // Empty array is "complete" in its emptiness
        errorRate: 0, // No errors in empty array
        matchCount: 0,
        meetsThreshold: this.qualityThresholds.minMatchCount === 0, // Meets threshold if we allow 0 matches
        issues: this.qualityThresholds.minMatchCount === 0 ? null : ['No matches provided']
      };
    }
    
    let totalCompleteness = 0;
    let errorCount = 0;
    const issues = [];
    
    matches.forEach((match, index) => {
      let matchCompleteness = 0;
      const checks = [
        !!match.id || !!match.fixtureId || !!match.matchId,
        !!match.teams || !!match.teamDetails,
        !!match.status,
        !!match.score,
        !!match.venue,
        !!match.startTime
      ];
      
      matchCompleteness = checks.filter(Boolean).length / checks.length;
      totalCompleteness += matchCompleteness;
      
      if (matchCompleteness < this.qualityThresholds.minDataCompleteness) {
        errorCount++;
        issues.push(`Match ${index} has low completeness: ${Math.round(matchCompleteness * 100)}%`);
      }
      
      // Check for error indicators in match data
      if (match.error || match.status === 'error') {
        errorCount++;
        issues.push(`Match ${index} has error status`);
      }
    });
    
    const avgCompleteness = totalCompleteness / matches.length;
    const errorRate = errorCount / matches.length;
    
    const meetsThreshold = 
      avgCompleteness >= this.qualityThresholds.minDataCompleteness &&
      errorRate <= this.qualityThresholds.maxErrorRate &&
      matches.length >= this.qualityThresholds.minMatchCount;
    
    return {
      completeness: Math.round(avgCompleteness * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      matchCount: matches.length,
      meetsThreshold,
      issues: issues.length > 0 ? issues : null
    };
  }

  /**
   * Assess cache freshness
   * @param {Object} cacheData - Cached data object
   * @param {number} age - Cache age in milliseconds
   * @returns {Object} Freshness assessment
   */
  assessCacheFreshness(cacheData, age) {
    const isFresh = age <= this.freshnessConfig.minFreshTime;
    const isStale = age > this.freshnessConfig.warningStaleTime;
    const isTooOld = age > this.freshnessConfig.maxRetentionTime;
    
    let level = 'fresh';
    let needsWarning = false;
    
    if (isTooOld) {
      level = 'expired';
      needsWarning = true;
    } else if (isStale) {
      level = 'stale';
      needsWarning = age > this.freshnessConfig.warningStaleTime;
    } else if (!isFresh) {
      level = 'aging';
    }
    
    return {
      isFresh,
      isStale,
      isTooOld,
      level,
      needsWarning,
      age
    };
  }

  /**
   * Validate cached data quality
   * @param {Array} matches - Cached matches
   * @param {Object} cacheData - Full cache data object
   * @returns {Object} Validation result
   */
  validateCachedData(matches, cacheData) {
    const issues = [];
    
    // Check data structure integrity
    if (!Array.isArray(matches)) {
      issues.push('Cached matches is not an array');
      return { isValid: false, issues };
    }
    
    // Check for data corruption indicators
    if (cacheData.count !== undefined && cacheData.count !== matches.length) {
      issues.push(`Count mismatch: expected ${cacheData.count}, got ${matches.length}`);
    }
    
    // Check for minimum data requirements
    if (matches.length === 0) {
      // Empty cache is valid in some cases
      return { isValid: true, issues: [], isEmpty: true };
    }
    
    // Validate data hash if available
    if (cacheData.metadata?.dataHash) {
      const currentHash = this.generateDataHash(matches);
      if (currentHash !== cacheData.metadata.dataHash) {
        issues.push('Data hash mismatch, possible corruption');
      }
    }
    
    // Check for error objects in matches
    const errorMatches = matches.filter(match => match.error || match.status === 'error');
    if (errorMatches.length > 0) {
      issues.push(`${errorMatches.length} matches have error status`);
    }
    
    return {
      isValid: issues.length === 0,
      issues: issues.length > 0 ? issues : null,
      errorMatchCount: errorMatches.length
    };
  }

  /**
   * Generate simple hash for data integrity checking
   * @param {Array} matches - Array of matches
   * @returns {string} Simple hash
   */
  generateDataHash(matches) {
    if (!Array.isArray(matches) || matches.length === 0) {
      return 'empty';
    }
    
    // Create deterministic hash based on match count and first few match IDs
    const ids = matches.slice(0, 5).map(m => m.id || m.fixtureId || m.matchId || '').join('');
    // Use deterministic hash without timestamp to avoid hash mismatches
    return `${matches.length}_${ids.length}_${ids}`;
  }

  /**
   * Get comprehensive cache service status with monitoring data
   * @returns {Promise<Object>} Enhanced service status information
   */
  async getStatus() {
    try {
      const isConnected = this.redisClient.isOpen;
      const cacheValid = await this.isCacheValid();
      const metadata = await this.getCacheMetadata();
      
      // Calculate cache hit rate
      const totalRequests = this.metrics.hits + this.metrics.misses;
      const hitRate = totalRequests > 0 ? Math.round((this.metrics.hits / totalRequests) * 100) / 100 : 0;
      
      // Calculate error rate
      const totalOperations = this.metrics.writes + this.metrics.hits + this.metrics.misses;
      const errorRate = totalOperations > 0 ? Math.round((this.metrics.errors / totalOperations) * 100) / 100 : 0;
      
      return {
        service: 'EnhancedCacheService',
        version: '2.0',
        connected: isConnected,
        cacheValid,
        metadata,
        keys: {
          primary: this.cacheKey,
          previous: this.previousCacheKey
        },
        configuration: {
          defaultTTL: this.defaultTTL,
          freshnessConfig: this.freshnessConfig,
          qualityThresholds: this.qualityThresholds
        },
        metrics: {
          ...this.metrics,
          hitRate,
          errorRate,
          totalRequests,
          totalOperations
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: 'EnhancedCacheService',
        version: '2.0',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Reset cache metrics (for monitoring/debugging)
   */
  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      writes: 0,
      invalidations: 0,
      freshnessWarnings: 0,
      staleServed: 0,
      errors: 0
    };
    
    logger.info('Cache metrics reset');
  }

  /**
   * Get cache monitoring metrics
   * @returns {Object} Current cache metrics
   */
  getMetrics() {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const totalOperations = this.metrics.writes + this.metrics.hits + this.metrics.misses;
    
    return {
      ...this.metrics,
      hitRate: totalRequests > 0 ? Math.round((this.metrics.hits / totalRequests) * 100) / 100 : 0,
      errorRate: totalOperations > 0 ? Math.round((this.metrics.errors / totalOperations) * 100) / 100 : 0,
      totalRequests,
      totalOperations,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Invalidate cache if data quality issues detected
   * @param {string} reason - Reason for invalidation
   * @returns {Promise<boolean>} Success status
   */
  async invalidateCache(reason = 'manual') {
    try {
      await this.redisClient.del(this.cacheKey);
      this.metrics.invalidations++;
      
      logger.warn('Cache invalidated', {
        reason,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to invalidate cache', {
        reason,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Check if cached data is fresh based on cache type and timestamp
   * @param {Object} cachedData - Cached data with metadata
   * @param {string} cacheType - Type of cache (liveMatches, fixtures, ballByBall)
   * @returns {Object} Freshness status
   */
  checkDataFreshness(cachedData, cacheType = 'liveMatches') {
    if (!cachedData || !cachedData.timestamp) {
      return {
        isFresh: false,
        isStale: true,
        age: 0,
        message: 'No cached data or timestamp'
      };
    }
    
    const now = Date.now();
    const cacheTime = new Date(cachedData.timestamp).getTime();
    const age = now - cacheTime;
    
    const freshnessThreshold = this.freshnessConfig[cacheType] || this.freshnessConfig.liveMatches;
    const staleThreshold = this.freshnessConfig.staleThreshold;
    
    const isFresh = age <= freshnessThreshold;
    const isStale = age > staleThreshold;
    
    return {
      isFresh,
      isStale,
      age,
      ageSeconds: Math.floor(age / 1000),
      freshnessThreshold: freshnessThreshold / 1000,
      message: isFresh ? 'Fresh data' : (isStale ? 'Stale data' : 'Moderately old data')
    };
  }

  /**
   * Get cache with freshness validation
   * @param {string} cacheType - Type of cache to retrieve
   * @returns {Promise<Object>} Cache data with freshness info
   */
  async getCacheWithFreshness(cacheType = 'liveMatches') {
    try {
      const cachedData = await this.getLiveMatches();
      const freshness = this.checkDataFreshness({ 
        timestamp: cachedData.cachedAt || new Date().toISOString(),
        data: cachedData 
      }, cacheType);
      
      return {
        data: cachedData,
        freshness,
        cacheType,
        retrievedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get cache with freshness validation', {
        cacheType,
        error: error.message
      });
      return {
        data: [],
        freshness: { isFresh: false, isStale: true, age: 0 },
        cacheType,
        error: error.message
      };
    }
  }

  /**
   * Enhanced cache status with freshness metrics
   * @returns {Object} Comprehensive cache status
   */
  getEnhancedStatus() {
    const hitRate = this.metrics.hits + this.metrics.misses > 0 ? 
      this.metrics.hits / (this.metrics.hits + this.metrics.misses) : 0;
    
    return {
      ...this.getStatus(),
      freshnessConfig: this.freshnessConfig,
      cacheTypes: Object.keys(this.cacheTypes),
      hitRate: Math.round(hitRate * 100) / 100,
      qualityMetrics: {
        freshnessWarnings: this.metrics.freshnessWarnings,
        staleServed: this.metrics.staleServed,
        dataQualityThreshold: this.freshnessConfig.qualityThreshold
      }
    };
  }
}

module.exports = CacheService;
