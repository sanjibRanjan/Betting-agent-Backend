'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/loggerService');

/**
 * Live Matches Routes
 * Handles API endpoints for live cricket matches with comprehensive error handling
 */
class LiveMatchesRoutes {
  constructor(cricketService, cacheService) {
    this.cricketService = cricketService;
    this.cacheService = cacheService;
    this.setupRoutes();
  }

  setupRoutes() {
    // GET /api/live-matches - Get live cricket matches with pagination and filtering
    router.get('/', async (req, res) => {
      const startTime = Date.now();
      const requestId = req.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // DEBUG: Log route entry
      logger.info('Live matches route entry', {
        requestId,
        timestamp: new Date().toISOString(),
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      
      try {
        // Parse query parameters for pagination and filtering
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)); // Max 100 items per page
        const offset = (page - 1) * limit;
        
        // Filtering options
        const status = req.query.status; // live, finished, upcoming
        const league = req.query.league;
        const team = req.query.team;
        const sortBy = req.query.sortBy || 'start_time'; // start_time, league, status
        const sortOrder = req.query.sortOrder || 'desc'; // asc, desc
        
        logger.info('Live matches request received', {
          requestId,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          pagination: { page, limit, offset },
          filters: { status, league, team, sortBy, sortOrder }
        });
        
        // Check if we have valid cached data
        const isCacheValid = await this.cacheService.isCacheValid();
        let matches = [];
        let source = 'cache';
        let error = null;
        
        // DEBUG: Log cache validity check
        logger.info('Cache validity check', {
          requestId,
          isCacheValid,
          cacheServiceExists: !!this.cacheService
        });

        if (isCacheValid) {
          const cacheResult = await this.cacheService.getLiveMatches();
          matches = cacheResult.matches || [];
          logger.info('Serving cached matches', {
            requestId,
            matchesCount: matches.length,
            source: 'cache',
            cacheResultType: typeof cacheResult,
            cacheResultKeys: cacheResult ? Object.keys(cacheResult) : 'null',
            cacheResultMatches: cacheResult?.matches ? `Array with ${cacheResult.matches.length} items` : 'no matches property',
            cacheMetadata: cacheResult?.metadata || 'no metadata'
          });
        } else {
          // Fetch fresh data if cache is expired or empty
          logger.info('Cache invalid/empty, fetching fresh data', { requestId });
          
          try {
            const fetchResult = await this.cricketService.fetchLiveMatches();
            
            if (fetchResult.error) {
              error = fetchResult.error;
              logger.warn('API fetch failed, attempting fallback', {
                requestId,
                error: fetchResult.error,
                source: fetchResult.source
              });
              
              // Try to return stale cache data
              const staleCacheResult = await this.cacheService.getLiveMatches();
              matches = staleCacheResult.matches || [];
              if (matches.length > 0) {
                logger.info('Serving stale cache data due to API failure', {
                  requestId,
                  matchesCount: matches.length,
                  source: 'stale-cache'
                });
                source = 'stale-cache';
              } else {
                logger.error('No cached data available for fallback', { requestId });
                matches = [];
                source = 'error';
              }
            } else {
              matches = fetchResult.matches;
              // Cache the fresh data
              const cacheSuccess = await this.cacheService.setLiveMatches(matches);
              logger.info('Fresh data fetched and cached', {
                requestId,
                matchesCount: matches.length,
                cacheSuccess,
                source: 'api',
                fetchResultKeys: fetchResult ? Object.keys(fetchResult) : 'null',
                fetchResultMatches: fetchResult?.matches ? `Array with ${fetchResult.matches.length} items` : 'no matches property'
              });
              source = 'api';
            }
          } catch (fetchError) {
            logger.error('Unexpected error during fetch', {
              requestId,
              error: fetchError.message,
              stack: fetchError.stack
            });
            
            // Final fallback: try cached data
            matches = await this.cacheService.getLiveMatches();
            if (matches.length > 0) {
              source = 'fallback-cache';
              logger.info('Using fallback cache data', {
                requestId,
                matchesCount: matches.length
              });
            } else {
              source = 'error';
              error = fetchError.message;
            }
          }
        }

        // Apply filtering
        let filteredMatches = [...matches];
        
        // DEBUG: Log filtering process
        logger.info('Route filtering process', {
          requestId,
          originalMatchesCount: matches.length,
          statusFilter: status,
          matchesSample: matches.slice(0, 2).map(m => ({
            id: m.id,
            status: m.status,
            title: m.title
          }))
        });
        
        if (status) {
          filteredMatches = filteredMatches.filter(match => 
            match.status?.toLowerCase() === status.toLowerCase()
          );
        }
        
        logger.info('Route filtering completed', {
          requestId,
          originalCount: matches.length,
          filteredCount: filteredMatches.length,
          statusFilter: status
        });
        
        if (league) {
          filteredMatches = filteredMatches.filter(match => 
            match.league?.name?.toLowerCase().includes(league.toLowerCase()) ||
            match.competition?.name?.toLowerCase().includes(league.toLowerCase())
          );
        }
        
        if (team) {
          filteredMatches = filteredMatches.filter(match => 
            match.localteam?.name?.toLowerCase().includes(team.toLowerCase()) ||
            match.visitorteam?.name?.toLowerCase().includes(team.toLowerCase())
          );
        }

        // Apply sorting
        filteredMatches.sort((a, b) => {
          let aValue, bValue;
          
          switch (sortBy) {
            case 'start_time':
              aValue = new Date(a.starting_at || a.start_time || 0).getTime();
              bValue = new Date(b.starting_at || b.start_time || 0).getTime();
              break;
            case 'league':
              aValue = (a.league?.name || a.competition?.name || '').toLowerCase();
              bValue = (b.league?.name || b.competition?.name || '').toLowerCase();
              break;
            case 'status':
              aValue = (a.status || '').toLowerCase();
              bValue = (b.status || '').toLowerCase();
              break;
            default:
              aValue = a[sortBy] || '';
              bValue = b[sortBy] || '';
          }
          
          if (sortOrder === 'asc') {
            return aValue > bValue ? 1 : -1;
          } else {
            return aValue < bValue ? 1 : -1;
          }
        });

        // Apply pagination
        const totalCount = filteredMatches.length;
        const paginatedMatches = filteredMatches.slice(offset, offset + limit);
        
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        const metadata = await this.cacheService.getCacheMetadata();
        const duration = Date.now() - startTime;
        
        logger.info('Live matches request completed', {
          requestId,
          totalMatches: matches.length,
          filteredMatches: filteredMatches.length,
          returnedMatches: paginatedMatches.length,
          source,
          duration,
          hasError: !!error,
          pagination: { page, limit, totalPages, totalCount }
        });
        
        res.json({
          success: true,
          data: {
            matches: paginatedMatches,
            pagination: {
              page,
              limit,
              totalCount,
              totalPages,
              hasNextPage,
              hasPrevPage,
              nextPage: hasNextPage ? page + 1 : null,
              prevPage: hasPrevPage ? page - 1 : null
            },
            filters: {
              status,
              league,
              team,
              sortBy,
              sortOrder
            },
            source,
            timestamp: new Date().toISOString(),
            cache: metadata,
            requestId,
            duration
          },
          ...(error && { warning: `API error occurred: ${error}` })
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Live matches route error', {
          requestId,
          error: error.message,
          stack: error.stack,
          duration
        });
        
        // Final fallback: try to return cached data even if there's an error
        try {
          const fallbackMatches = await this.cacheService.getLiveMatches();
          logger.info('Emergency fallback to cached data', {
            requestId,
            matchesCount: fallbackMatches.length
          });
          
          res.json({
            success: true,
            data: {
              matches: fallbackMatches.slice(0, parseInt(req.query.limit) || 20),
              pagination: {
                page: 1,
                limit: parseInt(req.query.limit) || 20,
                totalCount: fallbackMatches.length,
                totalPages: Math.ceil(fallbackMatches.length / (parseInt(req.query.limit) || 20)),
                hasNextPage: false,
                hasPrevPage: false
              },
              source: 'emergency-fallback',
              timestamp: new Date().toISOString(),
              requestId,
              duration
            },
            warning: 'Service error occurred, returning cached data'
          });
        } catch (fallbackError) {
          logger.error('Emergency fallback failed', {
            requestId,
            error: fallbackError.message
          });
          
          res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            requestId,
            duration,
            data: { matches: [], count: 0 }
          });
        }
      }
    });

    // GET /api/live-matches/refresh - Force refresh live matches
    router.get('/refresh', async (req, res) => {
      const startTime = Date.now();
      const requestId = `refresh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        logger.info('Force refresh requested', {
          requestId,
          userAgent: req.get('User-Agent'),
          ip: req.ip
        });
        
        const fetchResult = await this.cricketService.fetchLiveMatches();
        
        if (fetchResult.error) {
          logger.error('Force refresh failed', {
            requestId,
            error: fetchResult.error,
            source: fetchResult.source
          });
          
          return res.status(500).json({
            success: false,
            error: 'Failed to fetch live matches',
            message: fetchResult.error,
            requestId,
            duration: Date.now() - startTime,
            data: { matches: [], count: 0 }
          });
        }

        // Cache the fresh data
        const cacheSuccess = await this.cacheService.setLiveMatches(fetchResult.matches);
        const duration = Date.now() - startTime;
        
        logger.info('Force refresh completed', {
          requestId,
          matchesCount: fetchResult.matches.length,
          cacheSuccess,
          duration,
          source: fetchResult.source
        });
        
        res.json({
          success: true,
          data: {
            matches: fetchResult.matches,
            count: fetchResult.matches.length,
            source: 'api-refresh',
            timestamp: new Date().toISOString(),
            requestId,
            duration,
            cacheSuccess
          }
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Force refresh error', {
          requestId,
          error: error.message,
          stack: error.stack,
          duration
        });
        
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: error.message,
          requestId,
          duration,
          data: { matches: [], count: 0 }
        });
      }
    });

    // GET /api/live-matches/status - Get service status
    router.get('/status', async (req, res) => {
      try {
        const cricketStatus = this.cricketService.getStatus();
        const cacheStatus = await this.cacheService.getStatus();
        const cacheMetadata = await this.cacheService.getCacheMetadata();

        res.json({
          success: true,
          data: {
            cricket: cricketStatus,
            cache: cacheStatus,
            metadata: cacheMetadata,
            timestamp: new Date().toISOString()
          }
        });

      } catch (error) {
        console.error('[LiveMatches] Status error:', error.message);
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: error.message
        });
      }
    });

    // GET /api/live-matches/cache/clear - Clear cache (admin endpoint)
    router.delete('/cache', async (req, res) => {
      try {
        const cleared = await this.cacheService.clearCache();
        
        res.json({
          success: cleared,
          message: cleared ? 'Cache cleared successfully' : 'Failed to clear cache',
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[LiveMatches] Clear cache error:', error.message);
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          message: error.message
        });
      }
    });
  }

  getRouter() {
    return router;
  }
}

module.exports = LiveMatchesRoutes;
