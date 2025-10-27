'use strict';

const axios = require('axios');
const logger = require('../utils/loggerService');
const RateLimiter = require('../utils/rateLimiter');

/**
 * Cricket API Service for fetching live matches from SportMonks
 * Handles authentication, error handling, and data normalization
 * Supports ball-by-ball data, player stats, and enhanced match details
 */
class CricketService {
  constructor(apiKey) {
    this.apiKey = apiKey || 'nPhIHrWHHOgoHkqWtmh4X8OYCjg6siT9bBb4UPLtB4ddIb7nueXB6kxmlxRX';
    this.baseURL = 'https://cricket.sportmonks.com/api/v2.0'; // SportMonks Cricket API base URL
    this.timeout = 15000; // 15 seconds for cricket APIs
    this.requestCount = 0;
    this.lastRequestTime = null;
    
    // Initialize advanced rate limiter
    this.rateLimiter = new RateLimiter({
      maxCallsPerHour: 3000,
      defaultDelay: 2000, // Increased to 2 seconds between requests
      maxDelay: 60000, // 1 minute max delay
      backoffMultiplier: 2.5,
      jitterFactor: 0.15
    });
    
    // Enhanced configuration for retries and caching
    this.maxRetries = 3;
    
    // Endpoint configuration - disable /livescores due to rate limiting issues
    this.useLiveScoresEndpoint = false; // Set to false to avoid rate limiting errors
    this.baseRetryDelay = 1000; // 1 second base delay
    this.retryMultiplier = 2; // Exponential backoff multiplier
    this.retryableStatuses = [401, 429, 500, 502, 503, 504]; // Status codes to retry
    
    // Optimized Cache TTL configuration aligned with requirements
    this.cacheTTL = {
      liveMatches: 30,           // 30 seconds for live matches
      fixtures: 300,             // 5 minutes for fixtures
      ballByBall: 10,            // 10 seconds for ball-by-ball data
      finishedMatches: 3600,     // 1 hour for finished matches
      playerStats: 3600,         // 1 hour for player stats
      teams: 21600,              // 6 hours for team data
      leagues: 86400,            // 24 hours for league data
      staleDataFallback: 1800    // 30 minutes for stale data fallback
    };
    
    // Optimized Include parameters for SportMonks Cricket API v2.0
    // Based on official documentation - prevents 400 Bad Request errors
    this.includeParams = {
      livescores: 'localteam,visitorteam,venue,runs,scoreboards', // Essential for livescores
      liveMatches: 'localteam,visitorteam,venue,runs,scoreboards,stage', // For live fixtures
      fixtureDetails: 'localteam,visitorteam,venue,runs,scoreboards,balls,league,season,stage,tosswon,weather',
      ballByBall: 'localteam,visitorteam,balls,runs,scoreboards', // Ball-by-ball data
      playerStats: 'career,stats', // Simplified player data
      teams: 'country,venue', // Team information
      leagues: 'season,country', // League information  
      basic: 'localteam,visitorteam,venue', // Minimal includes
      minimal: 'localteam,visitorteam' // Ultra-minimal for fallback
    };
    
    // Adaptive polling configuration based on match status
    this.pollingConfig = {
      liveMatches: 25000,        // 25 seconds for LIVE matches (20-30s range)
      ballByBall: 10000,         // 10 seconds for ball-by-ball when enabled
      upcomingMatches: 300000,   // 5 minutes for UPCOMING matches
      finishedMatches: 600000,   // 10 minutes for FINISHED matches
      scheduledMatches: 600000,  // 10 minutes for scheduled matches
      inactivePolling: 120000    // 2 minutes when no live matches
    };
    
    // Match status tracking for adaptive polling
    this.matchStatuses = new Map(); // matchId -> { status, lastUpdate, pollInterval }
    
    logger.info('CricketService initialized', {
      hasApiKey: !!this.apiKey,
      baseURL: this.baseURL,
      timeout: this.timeout,
      maxRetries: this.maxRetries
    });
  }

  /**
   * Fetch live cricket matches using the dedicated livescores endpoint
   * This method uses the exact configuration provided by the user
   * @returns {Promise<Object>} Live scores data with error handling
   */
  async fetchLiveScores() {
    const startTime = Date.now();
    const requestId = `livescores_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.apiRequest('GET', '/livescores', {
      requestId,
      service: 'CricketService',
      operation: 'fetchLiveScores'
    });
    
    if (!this.apiKey) {
      logger.warn('No API key provided for live scores', {
        requestId,
        service: 'CricketService'
      });
      return { error: 'No API key provided' };
    }

    try {
      const endpoint = '/livescores';
      const entity = this.rateLimiter.extractEntity(endpoint);
      
      // Use new rate limiter
      await this.rateLimiter.enforceRateLimit(endpoint);
      
      logger.info('Fetching live scores from SportMonks API', {
        requestId,
        requestCount: this.requestCount + 1,
        service: 'CricketService',
        entity,
        endpoint
      });
      
      this.requestCount++;
      this.lastRequestTime = Date.now();

      // Use the correct SportMonks API configuration
      const config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `${this.baseURL}/livescores`,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Sanjib-Agent/1.0'
        },
        params: {
          api_token: this.apiKey,
          include: this.includeParams.livescores
        },
        timeout: this.timeout
      };

      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      // Update rate limiter from response metadata
      this.rateLimiter.updateFromResponse(response, entity);
      
      if (response && response.data) {
        const matches = this.extractMatchesFromResponse(response.data);
        const normalizedMatches = this.normalizeMatchesWithValidation(matches);
        
        logger.info(`Successfully fetched ${normalizedMatches.length} live scores`, {
          requestId,
          matchesCount: normalizedMatches.length,
          duration
        });
        
        logger.apiResponse('GET', '/livescores', 200, duration, {
          requestId,
          matchesCount: normalizedMatches.length,
          source: 'sportmonks_livescores'
        });
        
        return {
          matches: normalizedMatches,
          raw: response.data,
          error: null,
          timestamp: new Date().toISOString(),
          source: 'sportmonks_livescores',
          requestCount: this.requestCount,
          requestId,
          endpoint: '/livescores',
          duration
        };
      }
      
      return { error: 'No live scores data found' };
    } catch (error) {
      const errorMessage = this.handleError(error);
      const duration = Date.now() - startTime;
      
      // Enhanced error logging for 400 Bad Request responses
      const errorDetails = {
        requestId,
        error: errorMessage,
        duration,
        errorCode: error.code,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
        params: error.config?.params
      };
      
      // Log detailed error information for debugging
      if (error.response?.status === 400) {
        errorDetails.responseData = error.response.data;
        errorDetails.responseHeaders = error.response.headers;
        
        logger.error('400 Bad Request - Detailed Error Analysis', {
          ...errorDetails,
          analysis: this.analyze400Error(error)
        });
      } else {
        logger.error('Failed to fetch live scores', errorDetails);
      }
      
      logger.apiResponse('GET', '/livescores', error.response?.status || 500, duration, {
        requestId,
        error: errorMessage,
        statusCode: error.response?.status
      });
      
      return {
        matches: [],
        raw: null,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        source: 'error',
        requestCount: this.requestCount,
        requestId,
        duration,
        errorDetails: errorDetails
      };
    }
  }

  /**
   * Get today's date range for API filtering
   * @returns {string} Date range string for API
   */
  getTodayDateRange() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    return `${todayStr},${tomorrowStr}`;
  }

  /**
   * Determine adaptive polling interval based on match status
   * @param {string} matchId - Match ID
   * @param {string} status - Match status (live, finished, scheduled, etc.)
   * @param {boolean} ballByBallEnabled - Whether ball-by-ball is enabled
   * @returns {number} Polling interval in milliseconds
   */
  getAdaptivePollingInterval(matchId, status, ballByBallEnabled = false) {
    const statusLower = status?.toLowerCase();
    
    // Update match status tracking
    this.matchStatuses.set(matchId, {
      status: statusLower,
      lastUpdate: Date.now(),
      ballByBallEnabled
    });
    
    // Return appropriate interval based on status
    if (statusLower === 'live' || statusLower === 'inplay') {
      return ballByBallEnabled ? this.pollingConfig.ballByBall : this.pollingConfig.liveMatches;
    } else if (statusLower === 'finished' || statusLower === 'completed') {
      return this.pollingConfig.finishedMatches;
    } else if (statusLower === 'upcoming' || statusLower === 'scheduled') {
      return this.pollingConfig.upcomingMatches;
    } else {
      return this.pollingConfig.inactivePolling;
    }
  }

  /**
   * Get current system status including adaptive polling information
   * @returns {Object} System status
   */
  getSystemStatus() {
    const now = Date.now();
    const activeMatches = Array.from(this.matchStatuses.entries())
      .filter(([_, info]) => info.status === 'live' || info.status === 'inplay')
      .length;
    
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime ? new Date(this.lastRequestTime).toISOString() : null,
      rateLimiter: this.rateLimiter?.getStatus(),
      activeMatches,
      totalTrackedMatches: this.matchStatuses.size,
      pollingConfig: this.pollingConfig,
      cacheTTL: this.cacheTTL,
      timestamp: new Date(now).toISOString()
    };
  }

  /**
   * Fetch live cricket matches from SportMonks API
   * @returns {Promise<Object>} Normalized match data with error handling
   */
  async fetchLiveMatches() {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.apiRequest('GET', '/fixtures/live', {
      requestId,
      service: 'CricketService',
      operation: 'fetchLiveMatches'
    });
    
    if (!this.apiKey) {
      logger.warn('No API key provided, falling back to mock data', {
        requestId,
        service: 'CricketService'
      });
      return this.getMockData();
    }

    try {
      // OPTIMIZATION: Skip /livescores endpoint due to rate limiting issues
      // Use /fixtures endpoint directly as it's working reliably
      if (!this.useLiveScoresEndpoint) {
        logger.info('Skipping /livescores endpoint to avoid rate limiting issues', {
          requestId,
          service: 'CricketService',
          reason: 'useLiveScoresEndpoint is disabled'
        });
      } else {
        // First try the dedicated livescores endpoint
        logger.info('Attempting to fetch live scores using dedicated endpoint', {
          requestId,
          service: 'CricketService'
        });
        
        const liveScoresResult = await this.fetchLiveScores();
        if (liveScoresResult.matches && liveScoresResult.matches.length > 0 && !liveScoresResult.error) {
          logger.info('Successfully fetched live scores using dedicated endpoint', {
            requestId,
            matchesCount: liveScoresResult.matches.length,
            duration: liveScoresResult.duration
          });
          return liveScoresResult;
        }
        
        logger.warn('Live scores endpoint failed, falling back to fixtures endpoints', {
          requestId,
          error: liveScoresResult.error
        });
      }

      // Use new rate limiter for fixtures endpoint
      const fixturesEndpoint = '/fixtures';
      await this.rateLimiter.enforceRateLimit(fixturesEndpoint);
      
      logger.info('Fetching live matches from SportMonks API using fixtures endpoints', {
        requestId,
        requestCount: this.requestCount + 1,
        service: 'CricketService'
      });
      
      this.requestCount++;
      this.lastRequestTime = Date.now();

      // Enhanced SportMonks v2.0 endpoints optimized for truly live data
      // Using valid SportMonks API parameters only
      
      // Build endpoints array - only include /livescores if useLiveScoresEndpoint is true
      const allEndpoints = [
        { 
          path: '/livescores', 
          params: { api_token: this.apiKey, include: this.includeParams.livescores },
          description: 'Primary livescores with essential includes',
          priority: 1
        },
        { 
          path: '/fixtures', 
          params: { 
            api_token: this.apiKey, 
            include: this.includeParams.liveMatches 
          },
          description: 'Live fixtures with includes',
          priority: 2
        },
        { 
          path: '/fixtures', 
          params: { 
            api_token: this.apiKey, 
            include: this.includeParams.basic
          },
          description: 'Basic fixtures',
          priority: 3
        },
        { 
          path: '/fixtures', 
          params: { api_token: this.apiKey },
          description: 'Basic fixtures without includes',
          priority: 4
        }
      ];
      
      // Filter out /livescores endpoint if disabled
      const endpoints = this.useLiveScoresEndpoint 
        ? allEndpoints 
        : allEndpoints.filter(e => e.path !== '/livescores');

      let matches = [];
      let rawData = null;
      let lastError = null;
      let successfulEndpoint = null;

      // Try each endpoint until one works
      for (const endpoint of endpoints) {
        try {
          const response = await this.makeApiRequestWithRetry(
            endpoint.path, 
            endpoint.params,
            requestId
          );
          
          if (response && response.data) {
            matches = this.extractMatchesFromResponse(response.data);
            rawData = response.data;
            successfulEndpoint = endpoint.path;
            
            logger.info(`Successfully fetched ${matches.length} matches`, {
              requestId,
              endpoint: endpoint.path,
              matchesCount: matches.length,
              duration: Date.now() - startTime
            });
            break;
          }
        } catch (error) {
          lastError = error;
          logger.warn(`Endpoint ${endpoint.path} failed`, {
            requestId,
            endpoint: endpoint.path,
            error: error.message,
            willRetry: true
          });
          continue;
        }
      }

      // If all primary endpoints failed, try minimal parameters
      if (matches.length === 0) {
        logger.info('Trying minimal query parameters', { requestId });
        
        try {
          // Fallback minimal endpoints for SportMonks v2.0
          const allMinimalEndpoints = [
            { 
              path: '/livescores', 
              params: { api_token: this.apiKey },
              description: 'Ultra-minimal livescores (no includes)'
            },
            { 
              path: '/fixtures', 
              params: { api_token: this.apiKey, include: this.includeParams.minimal },
              description: 'Minimal fixtures'
            },
            { 
              path: '/fixtures', 
              params: { api_token: this.apiKey },
              description: 'Basic fixtures without includes'
            }
          ];
          
          // Filter out /livescores endpoint if disabled
          const minimalEndpoints = this.useLiveScoresEndpoint 
            ? allMinimalEndpoints 
            : allMinimalEndpoints.filter(e => e.path !== '/livescores');

          for (const endpoint of minimalEndpoints) {
            try {
              const response = await this.makeApiRequestWithRetry(
                endpoint.path, 
                endpoint.params,
                requestId
              );
              
              if (response && response.data) {
                matches = this.extractMatchesFromResponse(response.data);
                if (matches.length > 0) {
                  rawData = response.data;
                  successfulEndpoint = endpoint.path;
                  
                  logger.info(`Successfully fetched ${matches.length} matches with minimal params`, {
                    requestId,
                    endpoint: endpoint.path,
                    params: endpoint.params,
                    matchesCount: matches.length,
                    duration: Date.now() - startTime
                  });
                  break;
                }
              }
            } catch (queryError) {
              logger.warn(`Minimal params failed`, {
                requestId,
                endpoint: endpoint.path,
                params: endpoint.params,
                error: queryError.message
              });
              continue;
            }
          }
        } catch (error) {
          lastError = error;
          logger.error('All parameter approaches failed', {
            requestId,
            error: error.message
          });
        }
      }

      // If still no matches, try to get recent matches as fallback
      if (matches.length === 0) {
        logger.warn('No live matches found from API, trying recent matches fallback', {
          requestId,
          duration: Date.now() - startTime,
          lastError: lastError?.message
        });
        
        // Try to get recent matches (last 30 days) as fallback
        try {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const recentDateRange = `${thirtyDaysAgo.toISOString().split('T')[0]},${new Date().toISOString().split('T')[0]}`;
          
          const recentResponse = await this.makeApiRequestWithRetry('/fixtures', {
            starting_at: recentDateRange,
            include: this.includeParams.basic,
            per_page: 20
          }, requestId);
          
          if (recentResponse && recentResponse.data && recentResponse.data.data.length > 0) {
            const recentMatches = this.extractMatchesFromResponse(recentResponse.data);
            const normalizedRecentMatches = this.normalizeMatchesWithValidation(recentMatches);
            
            logger.info(`Fallback successful: found ${normalizedRecentMatches.length} recent matches`, {
              requestId,
              duration: Date.now() - startTime
            });
            
            return {
              matches: normalizedRecentMatches,
              raw: recentResponse.data,
              error: null,
              timestamp: new Date().toISOString(),
              source: 'api_recent_fallback',
              requestCount: this.requestCount,
              requestId,
              duration: Date.now() - startTime,
              fallback: true,
              fallbackReason: 'No live matches available, showing recent matches'
            };
          }
        } catch (fallbackError) {
          logger.warn('Recent matches fallback failed', {
            requestId,
            error: fallbackError.message
          });
        }
        
        // If fallback also fails, return empty array
        return {
          matches: [],
          raw: null,
          error: 'No live matches currently available and recent matches fallback failed',
          timestamp: new Date().toISOString(),
          source: 'api_empty',
          requestCount: this.requestCount,
          requestId,
          duration: Date.now() - startTime
        };
      }

      // Filter for recent matches (last 3 years) to avoid showing very old data
      // Note: SportMonks API may return older data depending on subscription
      const currentYear = new Date().getFullYear();
      
      // DEBUG: Log filtering process
      logger.info('Starting match filtering process', {
        requestId,
        totalMatches: matches.length,
        currentYear,
        filterThreshold: currentYear - 5
      });
      
      const recentMatches = matches.filter(match => {
        if (!match.starting_at) {
          logger.debug(`Filtering out match ${match.id} - no starting_at field`, {
            matchId: match.id,
            teams: `${match.localteam?.name || 'N/A'} vs ${match.visitorteam?.name || 'N/A'}`,
            live: match.live,
            status: match.status
          });
          return false;
        }
        const matchYear = new Date(match.starting_at).getFullYear();
        const isRecent = matchYear >= currentYear - 5; // Increased to 5 years to include more data
        
        if (!isRecent) {
          logger.debug(`Filtering out match ${match.id} - too old (${matchYear})`, {
            matchId: match.id,
            matchYear,
            currentYear,
            threshold: currentYear - 5,
            teams: `${match.localteam?.name || 'N/A'} vs ${match.visitorteam?.name || 'N/A'}`,
            live: match.live,
            status: match.status
          });
        }
        
        // Allow matches from last 3 years to handle API data limitations
        return isRecent;
      });
      
      logger.info('Match filtering completed', {
        requestId,
        originalCount: matches.length,
        filteredCount: recentMatches.length,
        filteredOut: matches.length - recentMatches.length
      });

      // Normalize the matches data with enhanced validation
      const normalizedMatches = this.normalizeMatchesWithValidation(recentMatches);
      const totalDuration = Date.now() - startTime;
      
      // ENHANCED: Log detailed processing results with status breakdown
      const liveMatchesOnly = normalizedMatches.filter(match => match.status === 'Live');
      
      // Log status breakdown for debugging
      const statusBreakdown = {};
      normalizedMatches.forEach(match => {
        const status = match.status || 'unknown';
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      });
      
      logger.info(`Successfully processed ${normalizedMatches.length} matches (${liveMatchesOnly.length} live)`, {
        requestId,
        totalMatches: normalizedMatches.length,
        liveMatches: liveMatchesOnly.length,
        successfulEndpoint,
        duration: totalDuration,
        avgTimePerMatch: normalizedMatches.length > 0 ? totalDuration / normalizedMatches.length : 0,
        statusBreakdown,
        liveMatchDetails: liveMatchesOnly.slice(0, 3).map(match => ({
          id: match.id,
          title: match.title,
          status: match.status,
          score: match.score
        }))
      });
      
      logger.apiResponse('GET', '/fixtures/live', 200, totalDuration, {
        requestId,
        matchesCount: normalizedMatches.length,
        source: 'sportmonks_api'
      });
      
      return {
        matches: normalizedMatches,
        raw: rawData,
        error: null,
        timestamp: new Date().toISOString(),
        source: 'sportmonks_api',
        requestCount: this.requestCount,
        requestId,
        endpoint: successfulEndpoint,
        duration: totalDuration
      };

    } catch (error) {
      const errorMessage = this.handleError(error);
      const totalDuration = Date.now() - startTime;
      
      logger.error('Failed to fetch live matches', {
        requestId,
        error: errorMessage,
        duration: totalDuration,
        errorCode: error.code,
        statusCode: error.response?.status
      });
      
      logger.apiResponse('GET', '/fixtures/live', error.response?.status || 500, totalDuration, {
        requestId,
        error: errorMessage
      });
      
      return {
        matches: [],
        raw: null,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        source: 'error',
        requestCount: this.requestCount,
        requestId,
        duration: totalDuration
      };
    }
  }

  /**
   * Make API request with retry logic and exponential backoff
   * Based on SportMonks Cricket API documentation
   * @param {string} endpoint API endpoint
   * @param {Object} params Query parameters
   * @param {string} requestId Request ID for logging
   * @returns {Promise<Object>} API response
   */
  async makeApiRequestWithRetry(endpoint, params = {}, requestId = null) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Apply rate limiting before each attempt
        await this.rateLimiter.enforceRateLimit(endpoint, attempt);
        
        const response = await this.makeApiRequest(endpoint, params, requestId, attempt);
        
        // Update rate limiter on successful response
        const entity = this.rateLimiter.extractEntity(endpoint);
        this.rateLimiter.updateFromResponse(response, entity);
        
        // Log successful response
        logger.info(`API request successful on attempt ${attempt}`, {
          requestId,
          endpoint,
          attempt,
          status: response.status,
          statusText: response.statusText,
          rateLimitRemaining: response.data?.meta?.rate_limit?.remaining
        });
        
        return response;
      } catch (error) {
        lastError = error;
        const statusCode = error.response?.status;
        
        // Enhanced rate limit error handling with exponential backoff
        if (statusCode === 429) {
          const entity = this.rateLimiter.extractEntity(endpoint);
          this.rateLimiter.handleRateLimitError(error, entity);
          
          // For 429 errors, use enhanced exponential backoff with jitter
          if (attempt < this.maxRetries) {
            const baseDelay = this.calculateRetryDelay(attempt);
            const rateLimitDelay = this.extractRetryAfterFromError(error);
            const finalDelay = Math.max(baseDelay, rateLimitDelay);
            const jitteredDelay = this.addJitter(finalDelay);
            
            logger.warn(`Rate limit exceeded (429), retrying with enhanced backoff`, {
              requestId,
              endpoint,
              attempt,
              maxRetries: this.maxRetries,
              baseDelay,
              rateLimitDelay,
              finalDelay: jitteredDelay,
              entity,
              error: error.message
            });
            
            await new Promise(resolve => setTimeout(resolve, jitteredDelay));
            continue;
          }
        }
        
        // Check if error is retryable (excluding 429 which is handled above)
        if (attempt < this.maxRetries && this.retryableStatuses.includes(statusCode) && statusCode !== 429) {
          const delay = this.calculateRetryDelay(attempt);
          
          logger.warn(`API request failed, retrying in ${delay}ms`, {
            requestId,
            endpoint,
            attempt,
            maxRetries: this.maxRetries,
            statusCode,
            error: error.message,
            nextRetryIn: delay
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Log final failure
        logger.error(`API request failed after ${attempt} attempts`, {
          requestId,
          endpoint,
          attempt,
          statusCode,
          error: error.message,
          isRetryable: this.retryableStatuses.includes(statusCode)
        });
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Make API request with proper authentication and error handling
   * Based on SportMonks Cricket API documentation
   * @param {string} endpoint API endpoint
   * @param {Object} params Query parameters
   * @param {string} requestId Request ID for logging
   * @param {number} attempt Current attempt number
   * @returns {Promise<Object>} API response
   */
  async makeApiRequest(endpoint, params = {}, requestId = null, attempt = 1) {
    const startTime = Date.now();
    const url = `${this.baseURL}${endpoint}`;
    
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Sanjib-Agent/1.0'
      },
      params: {
        ...params,
        api_token: this.apiKey  // SportMonks uses 'api_token' parameter
      }
    };

    logger.debug(`Making API request to: ${url}`, {
      requestId,
      endpoint,
      attempt,
      params: Object.keys(params),
      hasApiToken: !!this.apiKey
    });
    
    const response = await axios(config);
    const duration = Date.now() - startTime;
    
    logger.debug(`API response received`, {
      requestId,
      endpoint,
      attempt,
      status: response.status,
      statusText: response.statusText,
      duration,
      contentType: response.headers['content-type'],
      dataSize: response.data ? JSON.stringify(response.data).length : 0
    });
    
    return response;
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attempt Current attempt number (1-based)
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const delay = this.baseRetryDelay * Math.pow(this.retryMultiplier, attempt - 1);
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Extract retry-after delay from error response
   * @param {Error} error - Error object from failed request
   * @returns {number} Delay in milliseconds
   */
  extractRetryAfterFromError(error) {
    const retryAfter = error.response?.headers['retry-after'] || 
                      error.response?.data?.meta?.rate_limit?.resets_in_seconds;
    
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 60000); // Cap at 60 seconds
      }
    }
    
    // Default retry delay for rate limits
    return 30000; // 30 seconds
  }

  /**
   * Add jitter to delay to prevent thundering herd
   * @param {number} delay - Base delay in milliseconds
   * @returns {number} Jittered delay in milliseconds
   */
  addJitter(delay) {
    const jitterFactor = 0.25; // ±25% jitter
    const jitter = (Math.random() - 0.5) * 2 * jitterFactor * delay;
    return Math.max(1000, Math.floor(delay + jitter)); // Minimum 1 second
  }

  /**
   * Extract matches from SportMonks API response
   * Handles SportMonks nested JSON structure with includes
   * @param {Object} data API response data
   * @returns {Array} Array of match objects
   */
  extractMatchesFromResponse(data) {
    // Check if response is HTML (invalid)
    if (typeof data === 'string' && data.includes('<!doctype html>')) {
      logger.warn('API returned HTML instead of JSON data');
      return [];
    }

    // ENHANCED LOGGING: Log raw API response structure for debugging
    logger.debug('Raw API response analysis', {
      responseType: typeof data,
      isArray: Array.isArray(data),
      hasData: !!data.data,
      dataLength: data.data?.length,
      hasMeta: !!data.meta,
      topLevelKeys: typeof data === 'object' ? Object.keys(data) : 'not_object',
      sampleFixture: data.data?.[0] ? {
        id: data.data[0].id,
        status: data.data[0].status,
        live: data.data[0].live,
        localteam: data.data[0].localteam?.name,
        visitorteam: data.data[0].visitorteam?.name
      } : null
    });

    // SportMonks response structure: { data: [...], meta: {...} }
    if (data.data && Array.isArray(data.data)) {
      logger.info(`Found ${data.data.length} fixtures in SportMonks data field`, {
        fixturesCount: data.data.length,
        hasRateLimit: !!data.meta?.rate_limit,
        rateLimitData: data.meta?.rate_limit
      });
      
      // ENHANCED: Log status breakdown for debugging live match detection
      const statusBreakdown = {};
      const liveMatches = [];
      
      data.data.forEach((fixture, index) => {
        const status = fixture.status || 'no_status';
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
        
        if (fixture.live === true) {
          liveMatches.push({
            id: fixture.id,
            status: fixture.status,
            live: fixture.live,
            teams: `${fixture.localteam?.name || 'N/A'} vs ${fixture.visitorteam?.name || 'N/A'}`
          });
        }
      });
      
      logger.info('API Response Status Analysis', {
        totalFixtures: data.data.length,
        statusBreakdown,
        liveMatchesFound: liveMatches.length,
        liveMatchesList: liveMatches.slice(0, 5) // Log first 5 live matches
      });
      
      return data.data;
    }
    
    // Handle direct array response (less common with SportMonks)
    if (Array.isArray(data)) {
      // Check if it's an array of numbers (invalid response)
      if (data.length > 0 && typeof data[0] === 'number') {
        console.warn('[CricketService] API returned array of numbers instead of fixture data');
        return [];
      }
      console.log(`[CricketService] Found ${data.length} fixtures in direct array`);
      return data;
    }
    
    // Handle other possible SportMonks response structures
    if (data.fixtures && Array.isArray(data.fixtures)) {
      return data.fixtures;
    }
    
    if (data.matches && Array.isArray(data.matches)) {
      return data.matches;
    }
    
    if (data.results && Array.isArray(data.results)) {
      return data.results;
    }
    
    if (data.live && Array.isArray(data.live)) {
      return data.live;
    }
    
    if (data.current && Array.isArray(data.current)) {
      return data.current;
    }
    
    // Check for nested structures
    if (data.response && Array.isArray(data.response)) {
      return data.response;
    }
    
    if (data.items && Array.isArray(data.items)) {
      return data.items;
    }

    // Check for SportMonks specific fields
    if (data.fixtureList && Array.isArray(data.fixtureList)) {
      return data.fixtureList;
    }

    if (data.fixtureData && Array.isArray(data.fixtureData)) {
      return data.fixtureData;
    }
    
    console.warn('[CricketService] Unexpected SportMonks API response format:', {
      type: typeof data,
      isArray: Array.isArray(data),
      keys: typeof data === 'object' ? Object.keys(data) : 'not an object',
      sample: Array.isArray(data) && data.length > 0 ? data[0] : (typeof data === 'object' ? Object.keys(data).slice(0, 5) : data)
    });
    return [];
  }

  /**
   * Get mock data as fallback with SportMonks structure
   * @param {string} requestId Request ID for logging
   * @returns {Object} Mock fixture data
   */
  getMockData(requestId = null) {
    logger.info('Returning mock data as fallback', {
      requestId,
      service: 'CricketService',
      operation: 'getMockData'
    });
    
    const mockFixtures = [
      {
        id: 'fixture_001',
        title: 'India vs Australia - 1st ODI',
        teams: {
          home: 'India',
          away: 'Australia'
        },
        status: 'Live',
        score: 'India 245/4 (45.2) | Australia 189/10 (38.1)',
        venue: 'MCA Stadium, Pune',
        startTime: new Date().toISOString(),
        format: 'ODI',
        series: 'India vs Australia ODI Series 2024',
        odds: { home: 1.85, away: 2.10 },
        lastUpdated: new Date().toISOString(),
        fixtureId: 'fixture_001',
        leagueId: 'league_001',
        seasonId: 'season_001',
        ballByBall: {
          totalBalls: 272,
          lastBall: {
            ball: '45.2',
            runs: 1,
            batsman: 'Virat Kohli',
            bowler: 'Mitchell Starc'
          },
          recentBalls: [
            { ball: '45.1', runs: 0, batsman: 'Virat Kohli', bowler: 'Mitchell Starc' },
            { ball: '45.2', runs: 1, batsman: 'Virat Kohli', bowler: 'Mitchell Starc' }
          ]
        },
        teamDetails: {
          local: { id: 1, name: 'India', code: 'IND', image_path: '/flags/india.png' },
          visitor: { id: 2, name: 'Australia', code: 'AUS', image_path: '/flags/australia.png' }
        }
      },
      {
        id: 'fixture_002', 
        title: 'England vs New Zealand - 2nd T20I',
        teams: {
          home: 'England',
          away: 'New Zealand'
        },
        status: 'Live',
        score: 'England 156/3 (15.2) | New Zealand 142/8 (20.0)',
        venue: 'Lord\'s, London',
        startTime: new Date().toISOString(),
        format: 'T20I',
        series: 'England vs New Zealand T20I Series 2024',
        odds: { home: 1.95, away: 1.90 },
        lastUpdated: new Date().toISOString(),
        fixtureId: 'fixture_002',
        leagueId: 'league_002',
        seasonId: 'season_002',
        ballByBall: {
          totalBalls: 92,
          lastBall: {
            ball: '15.2',
            runs: 2,
            batsman: 'Jos Buttler',
            bowler: 'Trent Boult'
          },
          recentBalls: [
            { ball: '15.1', runs: 1, batsman: 'Jos Buttler', bowler: 'Trent Boult' },
            { ball: '15.2', runs: 2, batsman: 'Jos Buttler', bowler: 'Trent Boult' }
          ]
        },
        teamDetails: {
          local: { id: 3, name: 'England', code: 'ENG', image_path: '/flags/england.png' },
          visitor: { id: 4, name: 'New Zealand', code: 'NZ', image_path: '/flags/newzealand.png' }
        }
      },
      {
        id: 'fixture_003',
        title: 'Pakistan vs South Africa - 3rd Test',
        teams: {
          home: 'Pakistan',
          away: 'South Africa'
        },
        status: 'Live',
        score: 'Pakistan 287/6 (78.3) | South Africa 245/10 (65.2)',
        venue: 'Gaddafi Stadium, Lahore',
        startTime: new Date().toISOString(),
        format: 'Test',
        series: 'Pakistan vs South Africa Test Series 2024',
        odds: { home: 2.20, away: 1.75 },
        lastUpdated: new Date().toISOString(),
        fixtureId: 'fixture_003',
        leagueId: 'league_003',
        seasonId: 'season_003',
        ballByBall: {
          totalBalls: 471,
          lastBall: {
            ball: '78.3',
            runs: 0,
            batsman: 'Babar Azam',
            bowler: 'Kagiso Rabada'
          },
          recentBalls: [
            { ball: '78.2', runs: 1, batsman: 'Babar Azam', bowler: 'Kagiso Rabada' },
            { ball: '78.3', runs: 0, batsman: 'Babar Azam', bowler: 'Kagiso Rabada' }
          ]
        },
        teamDetails: {
          local: { id: 5, name: 'Pakistan', code: 'PAK', image_path: '/flags/pakistan.png' },
          visitor: { id: 6, name: 'South Africa', code: 'SA', image_path: '/flags/southafrica.png' }
        }
      }
    ];

    console.log(`[CricketService] Returning ${mockFixtures.length} mock fixtures as fallback`);
    
    return {
      matches: mockFixtures,
      raw: { source: 'mock_data', fixtures: mockFixtures },
      error: null,
      timestamp: new Date().toISOString(),
      source: 'mock_fallback',
      requestCount: this.requestCount
    };
  }

  /**
   * Extract entity from API endpoint URL
   * @param {string} url - The API endpoint URL
   * @returns {string} The entity name
   */
  extractEntityFromUrl(url) {
    const path = url.replace(this.baseURL, '');
    if (path.includes('/livescores')) return 'livescores';
    if (path.includes('/fixtures')) return 'fixtures';
    if (path.includes('/teams')) return 'teams';
    if (path.includes('/players')) return 'players';
    if (path.includes('/leagues')) return 'leagues';
    return 'unknown';
  }

  /**
   * Update rate limit information from API response
   * @param {Object} response - Axios response object
   * @param {string} entity - The entity name
   */
  updateRateLimitInfo(response, entity) {
    if (response.data && response.data.rate_limit) {
      const rateLimit = response.data.rate_limit;
      this.rateLimitConfig.entities[entity] = {
        calls: this.rateLimitConfig.maxCallsPerHour - rateLimit.remaining,
        resetTime: new Date(Date.now() + (rateLimit.resets_in_seconds * 1000)),
        remaining: rateLimit.remaining,
        requestedEntity: rateLimit.requested_entity
      };
      
      logger.info(`Rate limit updated for ${entity}`, {
        remaining: rateLimit.remaining,
        resetsInSeconds: rateLimit.resets_in_seconds,
        requestedEntity: rateLimit.requested_entity
      });
    }
  }

  /**
   * Check if entity is rate limited
   * @param {string} entity - The entity name
   * @returns {Object} Rate limit status
   */
  checkEntityRateLimit(entity) {
    const entityInfo = this.rateLimitConfig.entities[entity];
    if (!entityInfo) return { isLimited: false, remaining: 3000 };
    
    const now = new Date();
    const isLimited = entityInfo.remaining <= 0 && entityInfo.resetTime && entityInfo.resetTime > now;
    
    return {
      isLimited,
      remaining: entityInfo.remaining,
      resetTime: entityInfo.resetTime,
      resetInSeconds: entityInfo.resetTime ? Math.max(0, Math.floor((entityInfo.resetTime - now) / 1000)) : 0
    };
  }

  /**
   * Enforce SportMonks rate limiting with entity awareness
   * @param {string} entity - The entity being requested
   * @returns {Promise<void>}
   */
  async enforceRateLimit(entity = 'unknown') {
    // Check entity-specific rate limit
    const rateLimitStatus = this.checkEntityRateLimit(entity);
    
    if (rateLimitStatus.isLimited) {
      const waitTime = rateLimitStatus.resetInSeconds * 1000;
      logger.warn(`Entity ${entity} is rate limited`, {
        remaining: rateLimitStatus.remaining,
        resetInSeconds: rateLimitStatus.resetInSeconds,
        waitTimeMs: waitTime
      });
      
      if (waitTime > 0 && waitTime <= this.rateLimitConfig.maxDelay) {
        logger.info(`Waiting ${waitTime}ms for rate limit reset`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw new Error(`Rate limit exceeded for ${entity}. Reset in ${rateLimitStatus.resetInSeconds} seconds`);
      }
    }
    
    // Basic delay between requests
    if (this.lastRequestTime) {
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.rateLimitConfig.defaultDelay) {
        const delay = this.rateLimitConfig.defaultDelay - timeSinceLastRequest;
        logger.info(`Rate limiting: waiting ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Get current rate limit status for all entities
   * @returns {Object} Rate limit status for all entities
   */
  getRateLimitStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      entities: {},
      summary: {
        totalEntities: Object.keys(this.rateLimitConfig.entities).length,
        limitedEntities: 0,
        totalRemaining: 0
      }
    };
    
    Object.keys(this.rateLimitConfig.entities).forEach(entity => {
      const entityStatus = this.checkEntityRateLimit(entity);
      status.entities[entity] = entityStatus;
      
      if (entityStatus.isLimited) {
        status.summary.limitedEntities++;
      }
      status.summary.totalRemaining += entityStatus.remaining;
    });
    
    return status;
  }

  /**
   * Get rate limit information for a specific entity
   * @param {string} entity - The entity name
   * @returns {Object} Rate limit information
   */
  getEntityRateLimitInfo(entity) {
    return this.checkEntityRateLimit(entity);
  }

  /**
   * Normalize SportMonks fixture data with enhanced validation and null checks
   * Maps SportMonks nested structure to internal format
   * @param {Array} fixtures Raw fixture data from SportMonks API
   * @returns {Array} Normalized match objects
   */
  normalizeMatchesWithValidation(fixtures) {
    if (!Array.isArray(fixtures)) {
      console.warn('[CricketService] normalizeMatches: input is not an array');
      return [];
    }

    return fixtures.map((fixture, index) => {
      try {
        // Validate fixture object
        if (!fixture || typeof fixture !== 'object') {
          logger.warn('Invalid fixture object', { index, fixture });
          return null;
        }

        // Extract team information with null checks
        const localTeam = fixture.localteam || {};
        const visitorTeam = fixture.visitorteam || {};
        const venue = fixture.venue || {};
        
        // Validate team information
        if (!localTeam.name && !localTeam.code) {
          logger.warn('Missing local team information', { fixtureId: fixture.id, index });
        }
        if (!visitorTeam.name && !visitorTeam.code) {
          logger.warn('Missing visitor team information', { fixtureId: fixture.id, index });
        }
        
        // Extract score information from multiple sources with validation
        const scores = Array.isArray(fixture.scores) ? fixture.scores : [];
        const runs = Array.isArray(fixture.runs) ? fixture.runs : [];
        
        // Find team-specific scores/runs with null checks
        const localScore = scores.find(score => 
          score && score.team_id && score.team_id === localTeam.id
        );
        const visitorScore = scores.find(score => 
          score && score.team_id && score.team_id === visitorTeam.id
        );
        
        const localRuns = runs.find(run => 
          run && run.team_id && run.team_id === localTeam.id
        );
        const visitorRuns = runs.find(run => 
          run && run.team_id && run.team_id === visitorTeam.id
        );
        
        // Try to extract from scoreboards if available with null checks
        const scoreboards = Array.isArray(fixture.scoreboards) ? fixture.scoreboards : [];
        const localScoreboard = scoreboards.find(sb => 
          sb && sb.team_id && sb.team_id === localTeam.id
        );
        const visitorScoreboard = scoreboards.find(sb => 
          sb && sb.team_id && sb.team_id === visitorTeam.id
        );
        
        // Build score string with enhanced validation and fallback logic
        let scoreString = null;
        
        // Helper function to safely format score
        const formatScore = (teamName, scoreObj, runsObj) => {
          if (!teamName) return null;
          
          let score = 'N/A', wickets = 'N/A', overs = 'N/A';
          
          // Try to get data from scoreboards first
          if (scoreObj) {
            score = scoreObj.score != null ? scoreObj.score : (runsObj?.score || 'N/A');
            wickets = scoreObj.wickets != null ? scoreObj.wickets : (runsObj?.wickets || 'N/A');
            overs = scoreObj.overs != null ? scoreObj.overs : (runsObj?.overs || 'N/A');
          } else if (runsObj) {
            score = runsObj.score != null ? runsObj.score : 'N/A';
            wickets = runsObj.wickets != null ? runsObj.wickets : 'N/A';
            overs = runsObj.overs != null ? runsObj.overs : 'N/A';
          }
          
          // Only return formatted string if we have meaningful data
          if (score !== 'N/A' || wickets !== 'N/A' || overs !== 'N/A') {
            return `${teamName} ${score}/${wickets} (${overs})`;
          }
          return null;
        };
        
        const localScoreString = formatScore(
          localTeam.name || localTeam.code, 
          localScoreboard || localScore, 
          localRuns
        );
        const visitorScoreString = formatScore(
          visitorTeam.name || visitorTeam.code, 
          visitorScoreboard || visitorScore, 
          visitorRuns
        );
        
        // Build final score string
        if (localScoreString && visitorScoreString) {
          scoreString = `${localScoreString} | ${visitorScoreString}`;
        } else if (localScoreString) {
          scoreString = localScoreString;
        } else if (visitorScoreString) {
          scoreString = visitorScoreString;
        }
        // If no score data available, show match status
        else if (fixture.status === 'LIVE' || fixture.status === 'INPLAY' || fixture.status === 'NS') {
          scoreString = `${localTeam.name || 'TBD'} vs ${visitorTeam.name || 'TBD'} - Live`;
        } else if (fixture.note) {
          scoreString = String(fixture.note).trim(); // Safely convert to string and trim
        } else {
          scoreString = `${localTeam.name || 'TBD'} vs ${visitorTeam.name || 'TBD'}`;
        }
        
        // FIXED: Determine match status with enhanced SportMonks logic
        let status = 'unknown';
        
        // CRITICAL: SportMonks uses 'live: true' field for live matches
        // However, we must also check if the match is actually recent to avoid marking old matches as live
        const isRecentMatch = fixture.starting_at ? 
          (Date.now() - new Date(fixture.starting_at).getTime()) < (7 * 24 * 60 * 60 * 1000) : false; // 7 days
        
        if (fixture.live === true && isRecentMatch) {
          status = 'Live';
          logger.debug(`Match ${fixture.id} identified as LIVE via live field (recent match)`, {
            fixtureId: fixture.id,
            live: fixture.live,
            rawStatus: fixture.status,
            teams: `${localTeam.name || localTeam.code} vs ${visitorTeam.name || visitorTeam.code}`,
            isRecent: isRecentMatch,
            startTime: fixture.starting_at
          });
        } else if (fixture.live === true && !isRecentMatch) {
          status = 'Finished';
          logger.debug(`Match ${fixture.id} marked as FINISHED - old match with live=true (${fixture.starting_at})`, {
            fixtureId: fixture.id,
            live: fixture.live,
            rawStatus: fixture.status,
            teams: `${localTeam.name || localTeam.code} vs ${visitorTeam.name || visitorTeam.code}`,
            isRecent: isRecentMatch,
            startTime: fixture.starting_at,
            note: 'Old match incorrectly marked as live by API'
          });
        }
        // Check for various live status indicators in status field (only if live field is not true)
        else if (fixture.status && typeof fixture.status === 'string') {
          const statusLower = fixture.status.toLowerCase();
          const liveStatusIndicators = [
            'live', 'inplay', 'in play', 'in progress', 'ongoing',
            '1st innings', '2nd innings', 'innings break', 'rain delay',
            'drinks break', 'tea break', 'lunch break', 'dinner break',
            'stumps day', 'play suspended', 'match resumed'
          ];
          
          if (liveStatusIndicators.some(indicator => statusLower.includes(indicator))) {
            status = 'Live';
            logger.debug(`Match ${fixture.id} identified as LIVE via status indicators`, {
              fixtureId: fixture.id,
              rawStatus: fixture.status,
              statusLower,
              matchedIndicator: liveStatusIndicators.find(indicator => statusLower.includes(indicator))
            });
          }
          // Handle finished/completed matches
          else if (statusLower.includes('finished') || statusLower.includes('completed') || 
                   statusLower.includes('match ended') || statusLower.includes('result')) {
            status = 'Finished';
          }
          // Handle not started matches
          else if (statusLower.includes('not started') || statusLower.includes('upcoming') || 
                   statusLower.includes('scheduled') || statusLower === 'ns') {
            status = 'Not Started';
          }
          // Handle postponed/cancelled
          else if (statusLower.includes('postponed')) {
            status = 'Postponed';
          } else if (statusLower.includes('cancelled') || statusLower.includes('abandoned')) {
            status = 'Cancelled';
          } else {
            // Keep original status for any unrecognized values
            status = fixture.status;
          }
        }
        
        // Log all status determinations for debugging
        logger.debug('Match status determination completed', {
          fixtureId: fixture.id,
          originalStatus: fixture.status,
          liveField: fixture.live,
          determinedStatus: status,
          isLive: status === 'Live'
        });
        
        // Extract ball-by-ball data with validation
        const balls = Array.isArray(fixture.balls) ? fixture.balls : [];
        let ballByBallData = null;
        
        if (balls.length > 0) {
          // Validate ball objects
          const validBalls = balls.filter(ball => 
            ball && 
            typeof ball === 'object' && 
            ball.ball !== undefined
          );
          
          if (validBalls.length > 0) {
            const lastBall = validBalls[validBalls.length - 1];
            ballByBallData = {
              totalBalls: validBalls.length,
              lastBall: this.validateBallData(lastBall),
              recentBalls: validBalls.slice(-6).map(ball => this.validateBallData(ball))
            };
          }
        }
        
        // Validate and return normalized match object
        const normalizedMatch = {
          id: fixture.id || `fixture_${Date.now()}_${index}`,
          title: `${localTeam.name || localTeam.code || 'TBD'} vs ${visitorTeam.name || visitorTeam.code || 'TBD'}`,
          teams: {
            home: localTeam.name || localTeam.code || 'TBD',
            away: visitorTeam.name || visitorTeam.code || 'TBD'
          },
          status: status,
          score: scoreString,
          venue: this.validateVenueData(venue),
          startTime: this.validateDateTime(fixture.starting_at || fixture.start_time),
          format: fixture.type || fixture.format || 'unknown',
          series: fixture.league?.name || fixture.series?.name || fixture.tournament?.name || null,
          odds: fixture.odds || null,
          lastUpdated: new Date().toISOString(),
          // SportMonks specific fields with validation
          fixtureId: fixture.id || null,
          leagueId: fixture.league_id || null,
          seasonId: fixture.season_id || null,
          roundId: fixture.round_id || null,
          refereeId: fixture.referee_id || null,
          ballByBall: ballByBallData,
          // Additional metadata with null checks
          matchNumber: fixture.match_number || null,
          season: fixture.season?.name || null,
          country: venue?.country || null,
          // Team details with validation
          teamDetails: {
            local: this.validateTeamData(localTeam),
            visitor: this.validateTeamData(visitorTeam)
          },
          // Data quality indicators
          dataQuality: {
            hasScore: !!scoreString && scoreString !== 'Live - Score not available',
            hasBalls: !!ballByBallData,
            hasTeams: !!(localTeam.name && visitorTeam.name),
            hasVenue: !!(venue.name || venue.city),
            completeness: this.calculateDataCompleteness(fixture)
          }
        };
        
        return normalizedMatch;
      } catch (error) {
        logger.error(`Error normalizing fixture ${index}`, {
          fixtureId: fixture?.id,
          error: error.message,
          stack: error.stack
        });
        
        return {
          id: `error_fixture_${Date.now()}_${index}`,
          title: 'Error Processing Fixture',
          teams: { home: 'Unknown', away: 'Unknown' },
          status: 'error',
          score: null,
          venue: null,
          startTime: null,
          format: 'unknown',
          series: null,
          odds: null,
          lastUpdated: new Date().toISOString(),
          error: error.message,
          dataQuality: {
            hasScore: false,
            hasBalls: false,
            hasTeams: false,
            hasVenue: false,
            completeness: 0
          }
        };
      }
    }).filter(match => match !== null); // Remove null matches from validation failures
  }

  /**
   * Validate ball data structure
   * @param {Object} ball - Raw ball object
   * @returns {Object} Validated ball object
   */
  validateBallData(ball) {
    if (!ball || typeof ball !== 'object') return null;
    
    return {
      ball: ball.ball || null,
      runs: ball.runs != null ? Number(ball.runs) : 0,
      batsman: ball.batsman_one?.name || ball.batsman || 'Unknown',
      bowler: ball.bowler?.name || ball.bowler || 'Unknown',
      extras: ball.extras || 0,
      wicket: ball.wicket || false
    };
  }

  /**
   * Validate team data structure
   * @param {Object} team - Raw team object
   * @returns {Object} Validated team object
   */
  validateTeamData(team) {
    if (!team || typeof team !== 'object') {
      return { id: null, name: 'TBD', code: 'TBD', image_path: null };
    }
    
    return {
      id: team.id || null,
      name: team.name || team.code || 'TBD',
      code: team.code || team.name?.substring(0, 3)?.toUpperCase() || 'TBD',
      image_path: team.image_path || null
    };
  }

  /**
   * Validate venue data structure
   * @param {Object} venue - Raw venue object
   * @returns {string|null} Validated venue string
   */
  validateVenueData(venue) {
    if (!venue || typeof venue !== 'object') return null;
    
    const venueName = venue.name || venue.city;
    const venueCountry = venue.country;
    
    if (venueName && venueCountry) {
      return `${venueName}, ${venueCountry}`;
    } else if (venueName) {
      return venueName;
    } else if (venueCountry) {
      return venueCountry;
    }
    
    return null;
  }

  /**
   * Validate date time string
   * @param {string} dateTime - Raw date time string
   * @returns {string|null} Validated ISO string or null
   */
  validateDateTime(dateTime) {
    if (!dateTime) return null;
    
    try {
      const date = new Date(dateTime);
      return isNaN(date.getTime()) ? null : date.toISOString();
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate data completeness score
   * @param {Object} fixture - Raw fixture object
   * @returns {number} Completeness score (0-1)
   */
  calculateDataCompleteness(fixture) {
    const checks = [
      !!fixture.localteam?.name,
      !!fixture.visitorteam?.name,
      !!fixture.venue?.name,
      !!fixture.starting_at,
      !!(fixture.scores?.length || fixture.runs?.length),
      !!fixture.status,
      !!fixture.type,
      !!fixture.league_id
    ];
    
    const completedChecks = checks.filter(Boolean).length;
    return Math.round((completedChecks / checks.length) * 100) / 100;
  }

  /**
   * Legacy normalizeMatches method for backward compatibility
   */
  normalizeMatches(fixtures) {
    return this.normalizeMatchesWithValidation(fixtures);
  }

  /**
   * Analyze 400 Bad Request errors to identify root causes
   * @param {Error} error - The error object from axios
   * @returns {Object} Analysis of the 400 error
   */
  analyze400Error(error) {
    const analysis = {
      type: '400_BAD_REQUEST',
      possibleCauses: [],
      recommendations: [],
      errorDetails: null
    };
    
    try {
      if (error.response?.data) {
        analysis.errorDetails = error.response.data;
        
        // Check for common 400 error patterns
        const errorData = error.response.data;
        
        if (typeof errorData === 'string') {
          analysis.errorMessage = errorData;
        } else if (errorData.message) {
          analysis.errorMessage = errorData.message;
          
          // Analyze error message for common issues
          if (errorData.message.includes('include')) {
            analysis.possibleCauses.push('Invalid include parameter');
            analysis.recommendations.push('Check SportMonks API docs for valid include values');
          }
          
          if (errorData.message.includes('filter')) {
            analysis.possibleCauses.push('Invalid filter parameter');
            analysis.recommendations.push('Verify filter syntax and supported values');
          }
          
          if (errorData.message.includes('api_token')) {
            analysis.possibleCauses.push('Invalid or expired API token');
            analysis.recommendations.push('Verify API key is valid and active');
          }
          
          if (errorData.message.includes('per_page')) {
            analysis.possibleCauses.push('Invalid pagination parameter');
            analysis.recommendations.push('Check pagination limits and syntax');
          }
        }
        
        if (errorData.errors) {
          analysis.validationErrors = errorData.errors;
        }
        
        if (errorData.data) {
          analysis.responseData = errorData.data;
        }
      }
      
      // Check request configuration
      if (error.config) {
        analysis.requestConfig = {
          url: error.config.url,
          method: error.config.method,
          params: error.config.params,
          headers: error.config.headers
        };
        
        // Check for problematic parameters
        if (error.config.params) {
          const params = error.config.params;
          
          if (params.include && typeof params.include === 'string') {
            const includeFields = params.include.split(',');
            analysis.includeFields = includeFields;
            
            // Check for potentially invalid include fields
            const suspiciousFields = includeFields.filter(field => 
              !['venue', 'localteam', 'visitorteam', 'lineup', 'scoreboards', 'balls', 'league', 'season'].includes(field.trim())
            );
            
            if (suspiciousFields.length > 0) {
              analysis.possibleCauses.push(`Potentially invalid include fields: ${suspiciousFields.join(', ')}`);
              analysis.recommendations.push('Verify include field names against SportMonks API documentation');
            }
          }
        }
      }
      
    } catch (analysisError) {
      analysis.analysisError = analysisError.message;
    }
    
    return analysis;
  }

  /**
   * Handle and categorize different types of errors from SportMonks API
   * @param {Error} error The caught error
   * @returns {string} Human-readable error message
   */
  handleError(error) {
    console.error('[CricketService] Handling error:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText
    });

    if (error.code === 'ECONNABORTED') {
      return 'Request timeout - API took too long to respond';
    }
    
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.response.data?.error || error.response.statusText;
      
      switch (status) {
        case 400:
          return `Bad request (${status}): ${message || 'Invalid request parameters'}`;
        case 401:
          return 'Authentication failed - Invalid API token or unauthorized access to SportMonks API';
        case 403:
          return 'Access forbidden - API token lacks permissions or quota exceeded for SportMonks API';
        case 404:
          return 'API endpoint not found - Check SportMonks endpoint URL';
        case 429:
          return 'Rate limit exceeded - Too many requests to SportMonks API entity, please wait for reset';
        case 500:
          return 'Internal server error from SportMonks API provider';
        case 502:
          return 'Bad gateway - SportMonks API server is temporarily unavailable';
        case 503:
          return 'Service unavailable - SportMonks API is temporarily down';
        default:
          return `SportMonks API error (${status}): ${message}`;
      }
    }
    
    if (error.request) {
      return 'Network error - Unable to reach SportMonks API server. Check internet connection.';
    }
    
    return error.message || 'Unknown error occurred while fetching cricket data from SportMonks API';
  }

  /**
   * Get service health status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'CricketService',
      apiKeyConfigured: !!this.apiKey,
      baseURL: this.baseURL,
      timeout: this.timeout,
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      rateLimitDelay: this.rateLimitDelay,
      maxRetries: this.maxRetries,
      retryableStatuses: this.retryableStatuses,
      cacheTTL: this.cacheTTL,
      includeParams: Object.keys(this.includeParams),
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get cache TTL for specific data type
   * @param {string} dataType The type of data (liveMatches, fixtureDetails, etc.)
   * @returns {number} TTL in seconds
   */
  getCacheTTL(dataType) {
    return this.cacheTTL[dataType] || this.cacheTTL.liveMatches;
  }

  /**
   * Get optimized include parameters for specific operation
   * @param {string} operation The operation type (liveMatches, fixtureDetails, etc.)
   * @returns {string} Include parameters string
   */
  getIncludeParams(operation) {
    return this.includeParams[operation] || this.includeParams.basic;
  }

  /**
   * Validate and sanitize API parameters
   * @param {Object} params Raw parameters
   * @returns {Object} Sanitized parameters
   */
  sanitizeParams(params) {
    const sanitized = {};
    
    // Only include known parameters
    const allowedParams = ['include', 'status', 'live', 'inplay', 'current', 'per_page', 'page'];
    
    for (const [key, value] of Object.entries(params)) {
      if (allowedParams.includes(key) && value !== undefined && value !== null) {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * Fetch ball-by-ball data for a specific fixture
   * @param {string|number} fixtureId The fixture ID
   * @returns {Promise<Object>} Ball-by-ball data
   */
  async fetchBallByBallData(fixtureId) {
    const startTime = Date.now();
    const requestId = `ballbyball_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.apiRequest('GET', `/fixtures/${fixtureId}`, {
      requestId,
      service: 'CricketService',
      operation: 'fetchBallByBallData',
      fixtureId
    });
    
    if (!this.apiKey) {
      logger.warn('No API token provided for ball-by-ball data', {
        requestId,
        fixtureId
      });
      return { error: 'No API token provided' };
    }

    try {
      await this.enforceRateLimit();
      
      logger.info(`Fetching ball-by-ball data for fixture ${fixtureId}`, {
        requestId,
        fixtureId,
        includeParams: this.includeParams.ballByBall
      });
      
      const response = await this.makeApiRequestWithRetry(`/fixtures/${fixtureId}`, {
        include: this.includeParams.ballByBall
      }, requestId);
      
      if (response && response.data) {
        const fixture = response.data;
        const duration = Date.now() - startTime;
        
        logger.info(`Successfully fetched ball-by-ball data`, {
          requestId,
          fixtureId,
          ballsCount: fixture.balls?.length || 0,
          duration
        });
        
        return {
          fixtureId: fixture.id,
          balls: fixture.balls || [],
          teams: {
            local: fixture.localteam,
            visitor: fixture.visitorteam
          },
          timestamp: new Date().toISOString(),
          requestId,
          duration,
          cacheTTL: this.cacheTTL.ballByBall,
          error: null
        };
      }
      
      return { error: 'No ball-by-ball data found' };
    } catch (error) {
      const errorMessage = this.handleError(error);
      const duration = Date.now() - startTime;
      
      logger.error('Failed to fetch ball-by-ball data', {
        requestId,
        fixtureId,
        error: errorMessage,
        duration
      });
      
      return {
        error: errorMessage,
        timestamp: new Date().toISOString(),
        requestId,
        duration
      };
    }
  }

  /**
   * Fetch player statistics for a specific player
   * @param {string|number} playerId The player ID
   * @returns {Promise<Object>} Player statistics
   */
  async fetchPlayerStats(playerId) {
    const startTime = Date.now();
    const requestId = `playerstats_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.apiRequest('GET', `/players/${playerId}`, {
      requestId,
      service: 'CricketService',
      operation: 'fetchPlayerStats',
      playerId
    });
    
    if (!this.apiKey) {
      logger.warn('No API token provided for player stats', {
        requestId,
        playerId
      });
      return { error: 'No API token provided' };
    }

    try {
      await this.enforceRateLimit();
      
      logger.info(`Fetching player stats for player ${playerId}`, {
        requestId,
        playerId,
        includeParams: this.includeParams.playerStats
      });
      
      const response = await this.makeApiRequestWithRetry(`/players/${playerId}`, {
        include: this.includeParams.playerStats
      }, requestId);
      
      if (response && response.data) {
        const player = response.data;
        const duration = Date.now() - startTime;
        
        logger.info(`Successfully fetched player stats`, {
          requestId,
          playerId,
          playerName: player.fullname,
          duration
        });
        
        return {
          playerId: player.id,
          name: player.fullname,
          career: player.career || {},
          batting: player.batting || {},
          bowling: player.bowling || {},
          timestamp: new Date().toISOString(),
          requestId,
          duration,
          cacheTTL: this.cacheTTL.playerStats,
          error: null
        };
      }
      
      return { error: 'No player data found' };
    } catch (error) {
      const errorMessage = this.handleError(error);
      const duration = Date.now() - startTime;
      
      logger.error('Failed to fetch player stats', {
        requestId,
        playerId,
        error: errorMessage,
        duration
      });
      
      return {
        error: errorMessage,
        timestamp: new Date().toISOString(),
        requestId,
        duration
      };
    }
  }

  /**
   * Fetch detailed fixture information including lineups and scoreboards
   * @param {string|number} fixtureId The fixture ID
   * @returns {Promise<Object>} Detailed fixture data
   */
  async fetchFixtureDetails(fixtureId) {
    const startTime = Date.now();
    const requestId = `fixturedetails_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.apiRequest('GET', `/fixtures/${fixtureId}`, {
      requestId,
      service: 'CricketService',
      operation: 'fetchFixtureDetails',
      fixtureId
    });
    
    if (!this.apiKey) {
      logger.warn('No API token provided for fixture details', {
        requestId,
        fixtureId
      });
      return { error: 'No API token provided' };
    }

    try {
      await this.enforceRateLimit();
      
      logger.info(`Fetching detailed fixture info for ${fixtureId}`, {
        requestId,
        fixtureId,
        includeParams: this.includeParams.fixtureDetails
      });
      
      const response = await this.makeApiRequestWithRetry(`/fixtures/${fixtureId}`, {
        include: this.includeParams.fixtureDetails
      }, requestId);
      
      if (response && response.data) {
        const fixture = response.data;
        const duration = Date.now() - startTime;
        
        logger.info(`Successfully fetched fixture details`, {
          requestId,
          fixtureId,
          duration
        });
        
        return {
          fixture: fixture,
          timestamp: new Date().toISOString(),
          requestId,
          duration,
          cacheTTL: this.cacheTTL.fixtureDetails,
          error: null
        };
      }
      
      return { error: 'No fixture details found' };
    } catch (error) {
      const errorMessage = this.handleError(error);
      const duration = Date.now() - startTime;
      
      logger.error('Failed to fetch fixture details', {
        requestId,
        fixtureId,
        error: errorMessage,
        duration
      });
      
      return {
        error: errorMessage,
        timestamp: new Date().toISOString(),
        requestId,
        duration
      };
    }
  }

  /**
   * Test SportMonks API connectivity
   * @returns {Promise<Object>} Test result
   */
  async testConnection() {
    const startTime = Date.now();
    const requestId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.apiRequest('GET', '/fixtures', {
      requestId,
      service: 'CricketService',
      operation: 'testConnection'
    });
    
    try {
      logger.info('Testing SportMonks API connection', { requestId });
      
      // Test connection - skip /livescores if disabled
      let response;
      if (this.useLiveScoresEndpoint) {
        try {
          response = await this.makeApiRequestWithRetry('/livescores', {}, requestId);
        } catch (livescoresError) {
          logger.warn('Livescores endpoint failed, trying fixtures endpoint', { 
            requestId, 
            error: livescoresError.message 
          });
          response = await this.makeApiRequestWithRetry('/fixtures', { per_page: 1 }, requestId);
        }
      } else {
        logger.info('Skipping /livescores endpoint, using fixtures endpoint directly', { requestId });
        response = await this.makeApiRequestWithRetry('/fixtures', { per_page: 1 }, requestId);
      }
      const duration = Date.now() - startTime;
      
      logger.info('SportMonks API connection test successful', {
        requestId,
        status: response.status,
        duration
      });
      
      return {
        success: true,
        status: response.status,
        message: 'SportMonks API connection successful',
        timestamp: new Date().toISOString(),
        requestId,
        duration
      };
    } catch (error) {
      const errorMessage = this.handleError(error);
      const duration = Date.now() - startTime;
      
      logger.error('SportMonks API connection test failed', {
        requestId,
        error: errorMessage,
        duration
      });
      
      return {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        requestId,
        duration
      };
    }
  }
}

module.exports = CricketService;
