'use strict';

/**
 * Socket.IO Client for Sanjib Agent Live Cricket Server
 * 
 * Features:
 * - Connects to live server and subscribes to match channels
 * - Listens for various match events including questions
 * - Measures latency from event generation to receipt
 * - Auto-reconnects on disconnects with exponential backoff
 * - Comprehensive logging with timestamps
 * - Structured JSON output for better readability
 */

const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

class CricketSocketClient {
  constructor(options = {}) {
    // Configuration
    this.serverUrl = options.serverUrl || 'http://localhost:3000';
    this.autoReconnect = options.autoReconnect !== false; // Default: true
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = options.reconnectDelay || 1000; // Initial delay in ms
    this.maxReconnectDelay = options.maxReconnectDelay || 30000; // Max delay in ms
    this.logToFile = options.logToFile || false;
    this.logFilePath = options.logFilePath || './socket-client.log';
    
    // Connection state
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.subscribedChannels = new Set();
    
    // Statistics
    this.stats = {
      eventsReceived: 0,
      questionsReceived: 0,
      averageLatency: 0,
      totalLatency: 0,
      connectionTime: null,
      lastEventTime: null,
      reconnectCount: 0,
      startTime: new Date().toISOString()
    };
    
    // Latency tracking
    this.latencyMeasurements = [];
    
    // Initialize logging
    this.initializeLogging();
  }

  /**
   * Initialize logging system
   */
  initializeLogging() {
    if (this.logToFile) {
      // Ensure log directory exists
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  /**
   * Log message with timestamp
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      data: data || null
    };

    // Console output (structured JSON as per user preference)
    console.log(JSON.stringify(logEntry, null, 2));

    // File output if enabled
    if (this.logToFile) {
      fs.appendFileSync(this.logFilePath, JSON.stringify(logEntry) + '\n');
    }
  }

  /**
   * Calculate latency between event generation and receipt
   */
  calculateLatency(eventData) {
    if (!eventData.timestamp) {
      return null;
    }

    const eventTime = new Date(eventData.timestamp).getTime();
    const receiveTime = Date.now();
    const latency = receiveTime - eventTime;

    // Update statistics
    this.latencyMeasurements.push(latency);
    this.stats.totalLatency += latency;
    this.stats.averageLatency = this.stats.totalLatency / this.latencyMeasurements.length;

    return {
      latencyMs: latency,
      eventTimestamp: eventData.timestamp,
      receiveTimestamp: new Date(receiveTime).toISOString(),
      averageLatency: this.stats.averageLatency,
      measurementCount: this.latencyMeasurements.length
    };
  }

  /**
   * Connect to the server with enhanced error handling and retry logic
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.log('info', 'Attempting to connect to server', { serverUrl: this.serverUrl });

      this.socket = io(this.serverUrl, {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true,
        // Enhanced connection options
        reconnection: this.autoReconnect,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        reconnectionDelayMax: this.maxReconnectDelay,
        maxReconnectionAttempts: this.maxReconnectAttempts,
        // Performance optimizations
        upgrade: true,
        rememberUpgrade: true,
        // Health monitoring
        pingTimeout: 60000,
        pingInterval: 25000
      });

      // Connection successful
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.stats.connectionTime = new Date().toISOString();
        
        this.log('info', 'Connected to server successfully', {
          socketId: this.socket.id,
          serverUrl: this.serverUrl,
          transport: this.socket.io.engine.transport.name
        });

        // Set up event listeners
        this.setupEventListeners();
        
        // Start health monitoring
        this.startHealthMonitoring();
        
        resolve();
      });

      // Connection failed
      this.socket.on('connect_error', (error) => {
        this.log('error', 'Failed to connect to server', {
          error: error.message,
          serverUrl: this.serverUrl,
          attempt: this.reconnectAttempts + 1
        });
        
        if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
        reject(error);
      });

      // Disconnected
      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.log('warn', 'Disconnected from server', {
          reason,
          socketId: this.socket.id,
          reconnectAttempts: this.reconnectAttempts
        });

        if (this.autoReconnect && reason !== 'io client disconnect') {
          this.scheduleReconnect();
        }
      });

      // Reconnection events
      this.socket.on('reconnect', (attemptNumber) => {
        this.log('info', 'Reconnected to server', {
          attemptNumber,
          socketId: this.socket.id
        });
      });

      this.socket.on('reconnect_attempt', (attemptNumber) => {
        this.log('info', 'Reconnection attempt', {
          attemptNumber,
          maxAttempts: this.maxReconnectAttempts
        });
      });

      this.socket.on('reconnect_error', (error) => {
        this.log('error', 'Reconnection error', {
          error: error.message,
          attempt: this.reconnectAttempts
        });
      });

      this.socket.on('reconnect_failed', () => {
        this.log('error', 'Reconnection failed - max attempts reached', {
          totalAttempts: this.reconnectAttempts
        });
      });
    });
  }

  /**
   * Schedule automatic reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    this.stats.reconnectCount++;

    // Exponential backoff with jitter
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    ) + Math.random() * 1000; // Add jitter

    this.log('info', 'Scheduling reconnection attempt', {
      attempt: this.reconnectAttempts,
      delayMs: Math.round(delay),
      maxAttempts: this.maxReconnectAttempts
    });

    this.reconnectTimeout = setTimeout(async () => {
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        try {
          await this.connect();
        } catch (error) {
          this.log('error', 'Reconnection attempt failed', {
            attempt: this.reconnectAttempts,
            error: error.message
          });
        }
      } else {
        this.log('error', 'Maximum reconnection attempts reached', {
          totalAttempts: this.reconnectAttempts
        });
      }
    }, delay);
  }

  /**
   * Start health monitoring for the connection
   */
  startHealthMonitoring() {
    if (!this.socket) return;

    // Send periodic health checks
    this.healthCheckInterval = setInterval(() => {
      if (this.socket && this.isConnected) {
        this.socket.emit('health:check', {}, (response) => {
          this.log('debug', 'Health check response received', {
            serverTime: response.serverTime,
            uptime: response.uptime,
            memoryUsage: response.memoryUsage,
            clientCount: response.connectionStats?.activeConnections
          });
        });
      }
    }, 30000); // Every 30 seconds

    // Send periodic pings
    this.pingInterval = setInterval(() => {
      if (this.socket && this.isConnected) {
        this.socket.emit('ping');
      }
    }, 25000); // Every 25 seconds
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Set up event listeners for various match events
   */
  setupEventListeners() {
    if (!this.socket) return;

    // Match data events
    this.socket.on('matches:data', (data) => {
      this.handleMatchData(data);
    });

    this.socket.on('matches:update', (data) => {
      this.handleMatchUpdate(data);
    });

    this.socket.on('matches:live', (data) => {
      this.handleLiveMatchUpdate(data);
    });

    // Specific match change events
    this.socket.on('matches:new', (data) => {
      this.handleNewMatches(data);
    });

    this.socket.on('matches:finished', (data) => {
      this.handleFinishedMatches(data);
    });

    this.socket.on('matches:live:new', (data) => {
      this.handleLiveNewMatches(data);
    });

    this.socket.on('matches:live:update', (data) => {
      this.handleLiveMatchUpdate(data);
    });

    this.socket.on('matches:live:finished', (data) => {
      this.handleLiveFinishedMatches(data);
    });

    // Change summary events
    this.socket.on('matches:changes:summary', (data) => {
      this.handleChangeSummary(data);
    });

    this.socket.on('matches:live:changes:summary', (data) => {
      this.handleLiveChangeSummary(data);
    });

    // Error events
    this.socket.on('matches:error', (data) => {
      this.handleMatchError(data);
    });

    // Custom events (including potential question events)
    this.socket.on('question', (data) => {
      this.handleQuestionEvent(data);
    });

    this.socket.on('questions:generated', (data) => {
      this.handleQuestionsGenerated(data);
    });

    this.socket.on('questions:new', (data) => {
      this.handleNewQuestions(data);
    });

    // Generic event handler for any other events
    this.socket.onAny((eventName, data) => {
      this.handleGenericEvent(eventName, data);
    });
  }

  /**
   * Handle match data events
   */
  handleMatchData(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received match data', {
      eventType: 'matches:data',
      matchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A',
      cacheInfo: data.cache || null
    });
  }

  /**
   * Handle match update events
   */
  handleMatchUpdate(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received match update', {
      eventType: 'matches:update',
      matchCount: data.count,
      changeType: data.changeType || 'update',
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A',
      clientCount: data.clientCount
    });
  }

  /**
   * Handle live match update events
   */
  handleLiveMatchUpdate(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received live match update', {
      eventType: 'matches:live',
      matchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A',
      clientCount: data.clientCount
    });
  }

  /**
   * Handle new matches events
   */
  handleNewMatches(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received new matches', {
      eventType: 'matches:new',
      newMatchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A',
      matches: data.matches?.map(m => ({ id: m.id, title: m.title })) || []
    });
  }

  /**
   * Handle finished matches events
   */
  handleFinishedMatches(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received finished matches', {
      eventType: 'matches:finished',
      finishedMatchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A',
      matches: data.matches?.map(m => ({ id: m.id, title: m.title })) || []
    });
  }

  /**
   * Handle live new matches events
   */
  handleLiveNewMatches(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received live new matches', {
      eventType: 'matches:live:new',
      newMatchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A'
    });
  }

  /**
   * Handle live match update events
   */
  handleLiveMatchUpdate(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received live match update', {
      eventType: 'matches:live:update',
      matchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A'
    });
  }

  /**
   * Handle live finished matches events
   */
  handleLiveFinishedMatches(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received live finished matches', {
      eventType: 'matches:live:finished',
      finishedMatchCount: data.count,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A'
    });
  }

  /**
   * Handle change summary events
   */
  handleChangeSummary(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received change summary', {
      eventType: 'matches:changes:summary',
      summary: data.summary,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A',
      clientCount: data.clientCount
    });
  }

  /**
   * Handle live change summary events
   */
  handleLiveChangeSummary(data) {
    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received live change summary', {
      eventType: 'matches:live:changes:summary',
      summary: data.summary,
      source: data.source,
      latency: latency ? latency.latencyMs : 'N/A'
    });
  }

  /**
   * Handle match error events
   */
  handleMatchError(data) {
    this.log('error', 'Received match error', {
      eventType: 'matches:error',
      error: data.error,
      message: data.message
    });
  }

  /**
   * Handle question events (if available from server)
   */
  handleQuestionEvent(data) {
    this.stats.eventsReceived++;
    this.stats.questionsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received question event', {
      eventType: 'question',
      questionId: data.questionId || data.id,
      matchId: data.matchId,
      question: data.question,
      difficulty: data.difficulty,
      category: data.category,
      latency: latency ? latency.latencyMs : 'N/A',
      timestamp: data.timestamp
    });
  }

  /**
   * Handle questions generated events
   */
  handleQuestionsGenerated(data) {
    this.stats.eventsReceived++;
    this.stats.questionsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received questions generated event', {
      eventType: 'questions:generated',
      matchId: data.matchId,
      questionCount: data.questions?.length || 0,
      questions: data.questions || [],
      latency: latency ? latency.latencyMs : 'N/A'
    });
  }

  /**
   * Handle new questions events
   */
  handleNewQuestions(data) {
    this.stats.eventsReceived++;
    this.stats.questionsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received new questions event', {
      eventType: 'questions:new',
      matchId: data.matchId,
      questionCount: data.questions?.length || 0,
      questions: data.questions || [],
      latency: latency ? latency.latencyMs : 'N/A'
    });
  }

  /**
   * Handle generic events (catch-all)
   */
  handleGenericEvent(eventName, data) {
    // Skip events we've already handled specifically
    const handledEvents = [
      'matches:data', 'matches:update', 'matches:live',
      'matches:new', 'matches:finished', 'matches:live:new',
      'matches:live:update', 'matches:live:finished',
      'matches:changes:summary', 'matches:live:changes:summary',
      'matches:error', 'question', 'questions:generated', 'questions:new'
    ];

    if (handledEvents.includes(eventName)) {
      return;
    }

    this.stats.eventsReceived++;
    this.stats.lastEventTime = new Date().toISOString();
    
    const latency = this.calculateLatency(data);
    
    this.log('info', 'Received generic event', {
      eventType: eventName,
      latency: latency ? latency.latencyMs : 'N/A',
      data: data
    });
  }

  /**
   * Subscribe to live match updates
   */
  subscribeToLiveMatches() {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot subscribe: not connected to server');
      return false;
    }

    this.socket.emit('matches:subscribe');
    this.subscribedChannels.add('live-matches');
    
    this.log('info', 'Subscribed to live match updates', {
      socketId: this.socket.id,
      subscribedChannels: Array.from(this.subscribedChannels)
    });

    return true;
  }

  /**
   * Unsubscribe from live match updates
   */
  unsubscribeFromLiveMatches() {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot unsubscribe: not connected to server');
      return false;
    }

    this.socket.emit('matches:unsubscribe');
    this.subscribedChannels.delete('live-matches');
    
    this.log('info', 'Unsubscribed from live match updates', {
      socketId: this.socket.id,
      subscribedChannels: Array.from(this.subscribedChannels)
    });

    return true;
  }

  /**
   * Request current matches
   */
  requestCurrentMatches() {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot request matches: not connected to server');
      return false;
    }

    this.socket.emit('matches:request');
    
    this.log('info', 'Requested current matches', {
      socketId: this.socket.id
    });

    return true;
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      ...this.stats,
      isConnected: this.isConnected,
      socketId: this.socket?.id || null,
      subscribedChannels: Array.from(this.subscribedChannels),
      recentLatencies: this.latencyMeasurements.slice(-10), // Last 10 measurements
      uptimeSeconds: this.stats.connectionTime ? 
        Math.floor((Date.now() - new Date(this.stats.connectionTime).getTime()) / 1000) : 0
    };
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop health monitoring
    this.stopHealthMonitoring();

    this.autoReconnect = false; // Disable auto-reconnect when manually disconnecting

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnected = false;
    this.log('info', 'Disconnected from server manually');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.log('info', 'Initiating graceful shutdown');
    
    this.disconnect();
    
    // Log final statistics
    this.log('info', 'Final statistics', this.getStats());
    
    this.log('info', 'Shutdown complete');
  }
}

// Export the class for use in other modules
module.exports = CricketSocketClient;

// If running directly, start the client
if (require.main === module) {
  const client = new CricketSocketClient({
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    logToFile: process.env.LOG_TO_FILE === 'true',
    logFilePath: process.env.LOG_FILE_PATH || './socket-client.log'
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await client.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await client.shutdown();
    process.exit(0);
  });

  // Start the client
  (async () => {
    try {
      await client.connect();
      
      // Subscribe to live updates
      client.subscribeToLiveMatches();
      
      // Request current matches
      client.requestCurrentMatches();
      
      // Log statistics every 30 seconds
      setInterval(() => {
        const stats = client.getStats();
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'STATS',
          message: 'Client statistics',
          data: stats
        }, null, 2));
      }, 30000);

    } catch (error) {
      console.error('Failed to start client:', error.message);
      process.exit(1);
    }
  })();
}
