'use strict';

const logger = require('./loggerService');
const MatchComparator = require('./matchComparator');

/**
 * Socket.IO Service for real-time cricket match updates
 * Handles broadcasting match data to connected clients
 */
class SocketService {
  constructor(io, cricketService, cacheService) {
    this.io = io;
    this.cricketService = cricketService;
    this.cacheService = cacheService;
    this.matchComparator = new MatchComparator();
    this.updateInterval = null;
    this.updateIntervalMs = 8000; // 8 seconds
    this.isRunning = false;
    this.connectedClients = new Set();
    
    this.setupSocketHandlers();
  }

  /**
   * Setup Socket.IO event handlers with enhanced error handling and performance monitoring
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[SocketService] Client connected: ${socket.id}`);
      this.connectedClients.add(socket.id);

      // Initialize client metrics
      socket.clientMetrics = {
        connectionTime: Date.now(),
        messagesReceived: 0,
        messagesSent: 0,
        lastActivity: Date.now(),
        subscriptions: new Set(),
        errors: 0
      };

      // Send current matches immediately on connection
      this.sendCurrentMatches(socket);

      // Enhanced ping/pong handling for connection health
      socket.on('ping', () => {
        socket.clientMetrics.lastActivity = Date.now();
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Handle client health check
      socket.on('health:check', (data, callback) => {
        const healthStatus = {
          serverTime: Date.now(),
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          clientMetrics: socket.clientMetrics,
          connectedClients: this.connectedClients.size
        };
        
        if (callback) {
          callback(healthStatus);
        } else {
          socket.emit('health:response', healthStatus);
        }
      });

      // Handle client disconnection with cleanup
      socket.on('disconnect', (reason) => {
        console.log(`[SocketService] Client disconnected: ${socket.id}, reason: ${reason}`);
        this.connectedClients.delete(socket.id);
        
        // Log client session metrics
        const sessionDuration = Date.now() - socket.clientMetrics.connectionTime;
        logger.info('Client session ended', {
          socketId: socket.id,
          reason,
          sessionDuration,
          messagesReceived: socket.clientMetrics.messagesReceived,
          messagesSent: socket.clientMetrics.messagesSent,
          errors: socket.clientMetrics.errors
        });
      });

      // Handle client requesting current matches with rate limiting
      socket.on('matches:request', (data) => {
        socket.clientMetrics.messagesReceived++;
        socket.clientMetrics.lastActivity = Date.now();
        
        // Rate limiting: max 1 request per 5 seconds per client
        const now = Date.now();
        if (!socket.lastMatchRequest || (now - socket.lastMatchRequest) > 5000) {
          socket.lastMatchRequest = now;
          console.log(`[SocketService] Client ${socket.id} requested current matches`);
          this.sendCurrentMatches(socket);
        } else {
          logger.warn('Rate limited match request', {
            socketId: socket.id,
            timeSinceLastRequest: now - socket.lastMatchRequest
          });
          socket.emit('matches:error', {
            error: 'Rate limited',
            message: 'Please wait before requesting matches again',
            retryAfter: 5000
          });
        }
      });

      // Handle client subscribing to live updates with room management
      socket.on('matches:subscribe', (data) => {
        socket.clientMetrics.messagesReceived++;
        socket.clientMetrics.lastActivity = Date.now();
        
        console.log(`[SocketService] Client ${socket.id} subscribed to live updates`);
        socket.join('live-matches');
        socket.clientMetrics.subscriptions.add('live-matches');
        
        // Send confirmation
        socket.emit('matches:subscribed', {
          room: 'live-matches',
          timestamp: new Date().toISOString()
        });
      });

      // Handle client unsubscribing from live updates
      socket.on('matches:unsubscribe', (data) => {
        socket.clientMetrics.messagesReceived++;
        socket.clientMetrics.lastActivity = Date.now();
        
        console.log(`[SocketService] Client ${socket.id} unsubscribed from live updates`);
        socket.leave('live-matches');
        socket.clientMetrics.subscriptions.delete('live-matches');
        
        // Send confirmation
        socket.emit('matches:unsubscribed', {
          room: 'live-matches',
          timestamp: new Date().toISOString()
        });
      });

      // Handle client subscribing to specific match updates
      socket.on('matches:subscribe:match', (data) => {
        socket.clientMetrics.messagesReceived++;
        socket.clientMetrics.lastActivity = Date.now();
        
        const { matchId } = data;
        if (matchId) {
          const roomName = `match:${matchId}`;
          socket.join(roomName);
          socket.clientMetrics.subscriptions.add(roomName);
          
          logger.info('Client subscribed to specific match', {
            socketId: socket.id,
            matchId,
            room: roomName
          });
          
          socket.emit('matches:subscribed:match', {
            matchId,
            room: roomName,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle client unsubscribing from specific match updates
      socket.on('matches:unsubscribe:match', (data) => {
        socket.clientMetrics.messagesReceived++;
        socket.clientMetrics.lastActivity = Date.now();
        
        const { matchId } = data;
        if (matchId) {
          const roomName = `match:${matchId}`;
          socket.leave(roomName);
          socket.clientMetrics.subscriptions.delete(roomName);
          
          logger.info('Client unsubscribed from specific match', {
            socketId: socket.id,
            matchId,
            room: roomName
          });
          
          socket.emit('matches:unsubscribed:match', {
            matchId,
            room: roomName,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle error events from client
      socket.on('error', (error) => {
        socket.clientMetrics.errors++;
        logger.error('Socket error from client', {
          socketId: socket.id,
          error: error.message,
          stack: error.stack
        });
      });

      // Handle client acknowledgment for message delivery
      socket.on('ack', (data) => {
        socket.clientMetrics.lastActivity = Date.now();
        // Could be used for delivery confirmation tracking
      });
    });
  }

  /**
   * Send current matches to a specific socket with enhanced error handling and performance monitoring
   * @param {Socket} socket The socket to send data to
   */
  async sendCurrentMatches(socket) {
    const startTime = Date.now();
    
    try {
      const matches = await this.cacheService.getLiveMatches();
      const metadata = await this.cacheService.getCacheMetadata();

      const responseData = {
        matches,
        count: matches.length,
        source: 'cache',
        timestamp: new Date().toISOString(),
        cache: metadata,
        requestId: `socket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      // Track message sent
      if (socket.clientMetrics) {
        socket.clientMetrics.messagesSent++;
        socket.clientMetrics.lastActivity = Date.now();
      }

      socket.emit('matches:data', responseData);

      const duration = Date.now() - startTime;
      logger.info('Sent current matches to client', {
        socketId: socket.id,
        matchesCount: matches.length,
        duration,
        source: 'cache'
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Error sending current matches to client', {
        socketId: socket.id,
        error: error.message,
        stack: error.stack,
        duration
      });

      // Track error
      if (socket.clientMetrics) {
        socket.clientMetrics.errors++;
      }

      socket.emit('matches:error', {
        error: 'Failed to fetch matches',
        message: error.message,
        timestamp: new Date().toISOString(),
        requestId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
    }
  }

  /**
   * Broadcast matches update to all connected clients with performance optimizations
   * @param {Array} matches Array of match objects
   * @param {string} source Source of the data (api, cache, etc.)
   */
  broadcastMatchesUpdate(matches, source = 'api') {
    const startTime = Date.now();
    
    try {
      if (!Array.isArray(matches)) {
        logger.error('Invalid matches data for broadcast', {
          type: typeof matches,
          matches: matches
        });
        return;
      }

      // Skip broadcast if no clients connected
      if (this.connectedClients.size === 0) {
        logger.debug('No connected clients, skipping broadcast', {
          matchesCount: matches.length,
          source
        });
        return;
      }

      const updateData = {
        matches,
        count: matches.length,
        source,
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size,
        requestId: `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      // Use compression for large payloads
      const payloadSize = JSON.stringify(updateData).length;
      const useCompression = payloadSize > 1024; // Compress if > 1KB

      // Broadcast to all connected clients
      this.io.emit('matches:update', updateData);
      
      // Also send to clients subscribed to live-matches room
      this.io.to('live-matches').emit('matches:live', updateData);

      const duration = Date.now() - startTime;
      logger.info('Broadcasted matches update', {
        matchesCount: matches.length,
        clientCount: this.connectedClients.size,
        source,
        duration,
        payloadSize,
        useCompression,
        type: 'matches_update_broadcast'
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error broadcasting matches update', {
        error: error.message,
        stack: error.stack,
        matchesCount: Array.isArray(matches) ? matches.length : 'invalid',
        source,
        duration,
        type: 'matches_update_broadcast_error'
      });
    }
  }

  /**
   * Broadcast selective updates based on match changes
   * @param {Object} comparisonResult Result from MatchComparator
   * @param {string} source Source of the data
   */
  broadcastSelectiveUpdates(comparisonResult, source = 'api') {
    try {
      if (!comparisonResult || !comparisonResult.summary) {
        logger.warn('Invalid comparison result for selective broadcast', {
          comparisonResult,
          type: 'selective_broadcast_error'
        });
        return;
      }

      const { summary } = comparisonResult;
      
      // Only broadcast if there are changes
      if (!summary.hasChanges) {
        logger.debug('No changes detected, skipping selective broadcast', {
          totalMatches: summary.totalCurrent,
          type: 'no_changes'
        });
        return;
      }

      logger.info('Broadcasting selective updates', {
        newMatches: summary.newCount,
        updatedMatches: summary.updatedCount,
        finishedMatches: summary.finishedCount,
        clientCount: this.connectedClients.size,
        type: 'selective_broadcast'
      });

      // Broadcast new matches
      if (summary.newCount > 0) {
        this.broadcastNewMatches(comparisonResult.newMatches, source);
      }

      // Broadcast updated matches
      if (summary.updatedCount > 0) {
        this.broadcastUpdatedMatches(comparisonResult.updatedMatches, source);
      }

      // Broadcast finished matches
      if (summary.finishedMatches > 0) {
        this.broadcastFinishedMatches(comparisonResult.finishedMatches, source);
      }

      // Send summary to all clients
      this.broadcastChangeSummary(comparisonResult, source);

    } catch (error) {
      logger.error('Error in selective broadcast', {
        error: error.message,
        stack: error.stack,
        comparisonResult: comparisonResult?.summary,
        type: 'selective_broadcast_error'
      });
    }
  }

  /**
   * Broadcast new matches
   * @param {Array} newMatches Array of new matches
   * @param {string} source Source of the data
   */
  broadcastNewMatches(newMatches, source = 'api') {
    try {
      const updateData = {
        matches: newMatches,
        count: newMatches.length,
        changeType: 'new',
        source,
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size
      };

      // Broadcast to all connected clients
      this.io.emit('matches:new', updateData);
      
      // Also send to clients subscribed to live-matches room
      this.io.to('live-matches').emit('matches:live:new', updateData);

      logger.info('Broadcasted new matches', {
        count: newMatches.length,
        clientCount: this.connectedClients.size,
        matches: newMatches.map(m => ({ id: m.id, title: m.title })),
        type: 'new_matches_broadcast'
      });

    } catch (error) {
      logger.error('Error broadcasting new matches', {
        error: error.message,
        matchesCount: newMatches.length,
        type: 'new_matches_broadcast_error'
      });
    }
  }

  /**
   * Broadcast updated matches
   * @param {Array} updatedMatches Array of updated matches
   * @param {string} source Source of the data
   */
  broadcastUpdatedMatches(updatedMatches, source = 'api') {
    try {
      const updateData = {
        matches: updatedMatches,
        count: updatedMatches.length,
        changeType: 'update',
        source,
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size
      };

      // Broadcast to all connected clients
      this.io.emit('matches:update', updateData);
      
      // Also send to clients subscribed to live-matches room
      this.io.to('live-matches').emit('matches:live:update', updateData);

      logger.info('Broadcasted updated matches', {
        count: updatedMatches.length,
        clientCount: this.connectedClients.size,
        matches: updatedMatches.map(m => ({ 
          id: m.id, 
          title: m.title, 
          changes: Object.keys(m.changes || {}) 
        })),
        type: 'updated_matches_broadcast'
      });

    } catch (error) {
      logger.error('Error broadcasting updated matches', {
        error: error.message,
        matchesCount: updatedMatches.length,
        type: 'updated_matches_broadcast_error'
      });
    }
  }

  /**
   * Broadcast finished matches
   * @param {Array} finishedMatches Array of finished matches
   * @param {string} source Source of the data
   */
  broadcastFinishedMatches(finishedMatches, source = 'api') {
    try {
      const updateData = {
        matches: finishedMatches,
        count: finishedMatches.length,
        changeType: 'finished',
        source,
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size
      };

      // Broadcast to all connected clients
      this.io.emit('matches:finished', updateData);
      
      // Also send to clients subscribed to live-matches room
      this.io.to('live-matches').emit('matches:live:finished', updateData);

      logger.info('Broadcasted finished matches', {
        count: finishedMatches.length,
        clientCount: this.connectedClients.size,
        matches: finishedMatches.map(m => ({ id: m.id, title: m.title })),
        type: 'finished_matches_broadcast'
      });

    } catch (error) {
      logger.error('Error broadcasting finished matches', {
        error: error.message,
        matchesCount: finishedMatches.length,
        type: 'finished_matches_broadcast_error'
      });
    }
  }

  /**
   * Broadcast change summary
   * @param {Object} comparisonResult Result from MatchComparator
   * @param {string} source Source of the data
   */
  broadcastChangeSummary(comparisonResult, source = 'api') {
    try {
      const summaryData = {
        summary: comparisonResult.summary,
        stats: this.matchComparator.getComparisonStats(comparisonResult),
        source,
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size
      };

      // Broadcast summary to all connected clients
      this.io.emit('matches:changes:summary', summaryData);
      
      // Also send to clients subscribed to live-matches room
      this.io.to('live-matches').emit('matches:live:changes:summary', summaryData);

      logger.info('Broadcasted change summary', {
        summary: comparisonResult.summary,
        clientCount: this.connectedClients.size,
        type: 'change_summary_broadcast'
      });

    } catch (error) {
      logger.error('Error broadcasting change summary', {
        error: error.message,
        type: 'change_summary_broadcast_error'
      });
    }
  }

  /**
   * Start automatic updates broadcasting
   */
  startAutoUpdates() {
    if (this.isRunning) {
      console.log('[SocketService] Auto updates already running');
      return;
    }

    console.log(`[SocketService] Starting auto updates every ${this.updateIntervalMs}ms`);
    
    const updateMatches = async () => {
      try {
        // Check if we have connected clients
        if (this.connectedClients.size === 0) {
          console.log('[SocketService] No connected clients, skipping broadcast');
          return;
        }

        // Get current matches from cache
        const matches = await this.cacheService.getLiveMatches();
        
        if (matches.length > 0) {
          this.broadcastMatchesUpdate(matches, 'auto-update');
        } else {
          // If no cached matches, try to fetch fresh data
          console.log('[SocketService] No cached matches, attempting fresh fetch');
          const fetchResult = await this.cricketService.fetchLiveMatches();
          
          if (!fetchResult.error && fetchResult.matches.length > 0) {
            await this.cacheService.setLiveMatches(fetchResult.matches);
            this.broadcastMatchesUpdate(fetchResult.matches, 'api-fetch');
          }
        }

      } catch (error) {
        console.error('[SocketService] Error in auto update:', error.message);
      }
    };

    // Run immediately, then on interval
    updateMatches();
    this.updateInterval = setInterval(updateMatches, this.updateIntervalMs);
    this.isRunning = true;
  }

  /**
   * Stop automatic updates broadcasting
   */
  stopAutoUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      this.isRunning = false;
      console.log('[SocketService] Auto updates stopped');
    }
  }

  /**
   * Set the update interval
   * @param {number} intervalMs Interval in milliseconds
   */
  setUpdateInterval(intervalMs) {
    this.updateIntervalMs = intervalMs;
    
    if (this.isRunning) {
      this.stopAutoUpdates();
      this.startAutoUpdates();
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'SocketService',
      isRunning: this.isRunning,
      connectedClients: this.connectedClients.size,
      updateInterval: this.updateIntervalMs,
      clientIds: Array.from(this.connectedClients)
    };
  }

  /**
   * Broadcast match update to specific match room
   * @param {string} matchId Match ID
   * @param {Object} matchData Match data to broadcast
   * @param {string} source Source of the data
   */
  broadcastMatchUpdate(matchId, matchData, source = 'api') {
    const startTime = Date.now();
    
    try {
      const roomName = `match:${matchId}`;
      const roomClients = this.io.sockets.adapter.rooms.get(roomName);
      
      if (!roomClients || roomClients.size === 0) {
        logger.debug('No clients subscribed to match room', {
          matchId,
          roomName,
          source
        });
        return;
      }

      const updateData = {
        matchId,
        match: matchData,
        source,
        timestamp: new Date().toISOString(),
        clientCount: roomClients.size,
        requestId: `match_broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      // Broadcast to specific match room
      this.io.to(roomName).emit('match:update', updateData);

      const duration = Date.now() - startTime;
      logger.info('Broadcasted match update to room', {
        matchId,
        roomName,
        clientCount: roomClients.size,
        source,
        duration,
        type: 'match_update_broadcast'
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error broadcasting match update to room', {
        matchId,
        error: error.message,
        stack: error.stack,
        duration,
        type: 'match_update_broadcast_error'
      });
    }
  }

  /**
   * Get connection statistics and health metrics
   * @returns {Object} Connection statistics
   */
  getConnectionStats() {
    const stats = {
      totalConnections: this.connectedClients.size,
      activeConnections: 0,
      unhealthyConnections: 0,
      averageSessionDuration: 0,
      totalMessagesReceived: 0,
      totalMessagesSent: 0,
      totalErrors: 0,
      rooms: new Map()
    };

    let totalSessionDuration = 0;
    let connectionCount = 0;

    this.io.sockets.sockets.forEach((socket) => {
      if (socket.clientMetrics) {
        stats.activeConnections++;
        stats.totalMessagesReceived += socket.clientMetrics.messagesReceived;
        stats.totalMessagesSent += socket.clientMetrics.messagesSent;
        stats.totalErrors += socket.clientMetrics.errors;

        const sessionDuration = Date.now() - socket.clientMetrics.connectionTime;
        totalSessionDuration += sessionDuration;
        connectionCount++;

        // Check for unhealthy connections
        const timeSinceLastActivity = Date.now() - socket.clientMetrics.lastActivity;
        if (timeSinceLastActivity > 300000) { // 5 minutes
          stats.unhealthyConnections++;
        }

        // Track room subscriptions
        socket.clientMetrics.subscriptions.forEach(room => {
          if (!stats.rooms.has(room)) {
            stats.rooms.set(room, 0);
          }
          stats.rooms.set(room, stats.rooms.get(room) + 1);
        });
      }
    });

    if (connectionCount > 0) {
      stats.averageSessionDuration = Math.round(totalSessionDuration / connectionCount);
    }

    return {
      ...stats,
      rooms: Object.fromEntries(stats.rooms),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Broadcast a custom message to all clients
   * @param {string} event Event name
   * @param {Object} data Data to broadcast
   */
  broadcast(event, data) {
    this.io.emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = SocketService;
