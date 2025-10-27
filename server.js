'use strict';

// Phase 1 server for the AI Cricket Betting Agent
// - Express server with health check
// - Axios fetch of live cricket data from example API
// - Redis caching (TTL 60s)
// - Polling every 10 seconds
// - Socket.IO initialized for future real-time features

const http = require('http');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const { createClient } = require('redis');
const { Server } = require('socket.io');

// Import custom services
const CricketService = require('./core/cricketService');
const CacheService = require('./utils/cacheService');
const SocketService = require('./utils/socketService');
const LiveMatchesRoutes = require('./routes/liveMatches');
const MonitoringService = require('./utils/monitoringService');
const RateLimiter = require('./utils/rateLimiter');

// Import enhanced production services
const ErrorHandler = require('./utils/errorHandler');
const DatabaseService = require('./utils/databaseService');
const AlertingService = require('./utils/alertingService');
const HealthCheckService = require('./utils/healthCheckService');
const ServerLifecycleService = require('./utils/serverLifecycleService');

// Import enhanced data processing services
const DataProcessor = require('./services/dataProcessor');
const EventDetector = require('./services/eventDetector');
const QuestionGenerator = require('./services/questionGenerator');

// Import ML-enhanced question generation services
const MLPredictionService = require('./services/mlPredictionService');
const EnhancedQuestionGenerator = require('./services/enhancedQuestionGenerator');
const QuestionBroadcastingService = require('./services/questionBroadcastingService');
const QuestionAPIRoutes = require('./routes/questionAPIRoutes');

// Load environment variables from .env
dotenv.config();

// ----- Configuration -------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const SPORTMONKS_API_TOKEN = process.env.SPORTMONKS_API_TOKEN;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanjib-agent';

// Enhanced configuration for SportMonks API
const CRICKET_API_TIMEOUT = Number(process.env.CRICKET_API_TIMEOUT) || 15000;
const CRICKET_API_RETRY_ATTEMPTS = Number(process.env.CRICKET_API_RETRY_ATTEMPTS) || 3;
const CRICKET_API_RATE_LIMIT_DELAY = Number(process.env.CRICKET_API_RATE_LIMIT_DELAY) || 1000;

// Cache TTL configuration
const CACHE_TTL_LIVE_MATCHES = Number(process.env.CACHE_TTL_LIVE_MATCHES) || 30;
const CACHE_TTL_FIXTURE_DETAILS = Number(process.env.CACHE_TTL_FIXTURE_DETAILS) || 300;
const CACHE_TTL_PLAYER_STATS = Number(process.env.CACHE_TTL_PLAYER_STATS) || 3600;
const CACHE_TTL_BALL_BY_BALL = Number(process.env.CACHE_TTL_BALL_BY_BALL) || 10;
const CACHE_TTL_LEAGUES = Number(process.env.CACHE_TTL_LEAGUES) || 86400;

// Monitoring configuration
const MONITORING_ENABLED = process.env.MONITORING_ENABLED !== 'false';
const HEALTH_CHECK_INTERVAL = Number(process.env.HEALTH_CHECK_INTERVAL) || 30000;

// SportMonks Cricket API configuration
const SPORTMONKS_API_BASE_URL = 'https://cricket.sportmonks.com/api/v2.0';

// Cache and polling settings
const CACHE_KEY_LIVE_MATCHES = 'live:cricket:matches';
const CACHE_TTL_SECONDS = 60; // cache expiry of 60 seconds
const POLL_INTERVAL_MS = 10_000; // fetch every 10 seconds

// ----- App and Middleware --------------------------------------------------
const app = express();

// Performance optimizations
const compression = require('compression');
const helmet = require('helmet');

// Enable compression for all responses
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Security headers with performance considerations
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "*"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for better performance
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
})); 

app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification if needed
    req.rawBody = buf;
  }
})); 

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware for performance monitoring
app.use((req, res, next) => {
  req.startTime = Date.now();
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log slow requests
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    if (duration > 1000) { // Log requests taking more than 1 second
      console.warn(`[Slow Request] ${req.method} ${req.path} - ${duration}ms`, {
        requestId: req.requestId,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    }
  });
  
  next();
});

// ----- HTTP + Socket.IO Setup ---------------------------------------------
const httpServer = http.createServer(app);

// Enhanced Socket.IO configuration for better performance and stability
const io = new Server(httpServer, {
  cors: { 
    origin: process.env.CORS_ORIGIN || '*', 
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Performance optimizations
  pingTimeout: 60000,        // Increase ping timeout to 60 seconds
  pingInterval: 25000,       // Ping every 25 seconds
  upgradeTimeout: 10000,      // Upgrade timeout to 10 seconds
  allowEIO3: true,           // Allow Engine.IO v3 clients
  
  // Connection management
  maxHttpBufferSize: 1e6,    // 1MB max buffer size
  transports: ['websocket', 'polling'], // Prefer websocket, fallback to polling
  
  // Performance settings
  compression: true,          // Enable compression
  serveClient: false,        // Don't serve client files (better security)
  
  // Rate limiting
  perMessageDeflate: {
    threshold: 1024,         // Only compress messages > 1KB
    concurrencyLimit: 10,    // Limit concurrent compressions
    memLevel: 7              // Memory level for compression
  }
});

// Enhanced connection handling with health monitoring
io.engine.on('connection_error', (err) => {
  console.error('[Socket.IO] Connection error:', {
    message: err.message,
    description: err.description,
    context: err.context,
    type: err.type
  });
});

// Connection health monitoring
let connectionStats = {
  totalConnections: 0,
  activeConnections: 0,
  failedConnections: 0,
  lastHealthCheck: Date.now()
};

io.on('connection', (socket) => {
  connectionStats.totalConnections++;
  connectionStats.activeConnections++;
  
  // Set up connection health monitoring
  socket.healthCheck = {
    lastPing: Date.now(),
    missedPings: 0,
    isHealthy: true
  };
  
  // Enhanced ping/pong handling
  socket.on('ping', () => {
    socket.healthCheck.lastPing = Date.now();
    socket.healthCheck.missedPings = 0;
    socket.emit('pong');
  });
  
  // Handle client health check
  socket.on('health:check', (data, callback) => {
    const healthStatus = {
      serverTime: Date.now(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      connectionStats: {
        ...connectionStats,
        clientSocketId: socket.id
      }
    };
    
    if (callback) {
      callback(healthStatus);
    } else {
      socket.emit('health:response', healthStatus);
    }
  });
  
  socket.on('disconnect', (reason) => {
    connectionStats.activeConnections--;
    console.log(`[Socket.IO] Client disconnected: ${socket.id}, reason: ${reason}`);
  });
});

// Periodic health check for all connections
setInterval(() => {
  const now = Date.now();
  const unhealthyThreshold = 60000; // 60 seconds
  
  io.sockets.sockets.forEach((socket) => {
    if (socket.healthCheck) {
      const timeSinceLastPing = now - socket.healthCheck.lastPing;
      
      if (timeSinceLastPing > unhealthyThreshold) {
        socket.healthCheck.missedPings++;
        
        if (socket.healthCheck.missedPings > 3) {
          console.warn(`[Socket.IO] Unhealthy connection detected: ${socket.id}`);
          socket.disconnect(true);
        }
      }
    }
  });
  
  connectionStats.lastHealthCheck = now;
}, 30000); // Check every 30 seconds

// ----- Redis Client --------------------------------------------------------
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => {
  console.error('[Redis] Client error:', err);
});

// ----- Utilities -----------------------------------------------------------
const nowIso = () => new Date().toISOString();

// ----- Routes --------------------------------------------------------------
// Root route for frontend (will be updated after services are initialized)
app.get('/', (req, res) => {
  res.json({
    message: 'Cricket Betting Agent API Server',
    version: '2.0',
    status: 'running',
    endpoints: {
      matches: '/api/live-matches',
      health: '/api/health',
      websocket: '/socket.io',
      monitoring: '/api/monitoring/status',
      rateLimits: '/api/rate-limits',
      cache: '/api/cache/metrics'
    },
    timestamp: new Date().toISOString()
  });
});

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  try {
    const healthStatus = await global.healthCheckService.getHealthStatus();
    const statusCode = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json({
      status: healthStatus.status,
      service: 'Sanjib Agent',
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      checks: healthStatus.checks,
      summary: healthStatus.summary
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      service: 'Sanjib Agent',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Legacy health check endpoint for backward compatibility
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Sanjib Agent',
    timestamp: nowIso(),
    uptimeSeconds: process.uptime(),
  });
});

// Enhanced monitoring endpoints
app.get('/monitoring/status', async (req, res) => {
  try {
    const systemStatus = global.monitoringService.getEnhancedSystemStatus();
    res.json({
      success: true,
      data: systemStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get monitoring status',
      message: error.message
    });
  }
});

// Legacy monitoring endpoint for backward compatibility
app.get('/api/monitoring/status', (req, res) => {
  try {
    const systemStatus = global.monitoringService.getSystemStatus();
    res.json({
      success: true,
      data: systemStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get monitoring status',
      message: error.message
    });
  }
});

app.get('/api/monitoring/metrics', (req, res) => {
  try {
    const metrics = global.monitoringService.metrics;
    res.json({
      success: true,
      data: {
        metrics,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get metrics',
      message: error.message
    });
  }
});

app.post('/api/monitoring/reset', (req, res) => {
  try {
    global.monitoringService.resetMetrics();
    res.json({
      success: true,
      message: 'Metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to reset metrics',
      message: error.message
    });
  }
});

// Log streaming endpoint
app.get('/logs/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const level = req.query.level || null;
    
    const loggerService = require('./utils/loggerService');
    const logs = await loggerService.getRecentLogs(limit, level);
    
    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
        limit,
        level
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve logs',
      message: error.message
    });
  }
});

// Alerting endpoints
app.get('/api/alerts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const severity = req.query.severity || null;
    
    const alerts = global.alertingService.getRecentAlerts(limit, severity);
    
    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        limit,
        severity
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get alerts',
      message: error.message
    });
  }
});

app.post('/api/alerts/:alertId/acknowledge', (req, res) => {
  try {
    const { alertId } = req.params;
    const success = global.alertingService.acknowledgeAlert(alertId);
    
    if (success) {
      res.json({
        success: true,
        message: 'Alert acknowledged successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alert',
      message: error.message
    });
  }
});

app.post('/api/system/resume', (req, res) => {
  try {
    const success = global.alertingService.manualResume();
    
    res.json({
      success,
      message: success ? 'System resumed successfully' : 'System was not paused'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to resume system',
      message: error.message
    });
  }
});

app.get('/api/system/pause-status', (req, res) => {
  try {
    const pauseStatus = global.alertingService.getAutoPauseStatus();
    
    res.json({
      success: true,
      data: pauseStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get pause status',
      message: error.message
    });
  }
});

// Server Lifecycle Management endpoints
app.get('/api/lifecycle/status', (req, res) => {
  try {
    const status = global.serverLifecycleService ? 
      global.serverLifecycleService.getStatus() : 
      { error: 'Server lifecycle service not available' };
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get lifecycle status',
      message: error.message
    });
  }
});

app.get('/api/lifecycle/detailed-status', async (req, res) => {
  try {
    if (!global.serverLifecycleService) {
      return res.status(503).json({
        success: false,
        error: 'Server lifecycle service not available'
      });
    }
    
    const status = await global.serverLifecycleService.getDetailedStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get detailed lifecycle status',
      message: error.message
    });
  }
});

app.post('/api/lifecycle/restart', async (req, res) => {
  try {
    if (!global.serverLifecycleService) {
      return res.status(503).json({
        success: false,
        error: 'Server lifecycle service not available'
      });
    }
    
    const result = await global.serverLifecycleService.restartServer();
    
    res.json({
      success: result.success,
      data: result,
      message: result.success ? 'Server restarted successfully' : 'Failed to restart server'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to restart server',
      message: error.message
    });
  }
});

// Enhanced rate limit monitoring endpoint with entity details
app.get('/api/rate-limits', (req, res) => {
  try {
    if (!global.cricketService) {
      return res.status(503).json({
        success: false,
        error: 'Cricket service not available'
      });
    }
    
    const rateLimitStatus = global.cricketService.rateLimiter.getStatus();
    const systemStatus = global.cricketService.getSystemStatus();
    
    res.json({
      success: true,
      data: {
        ...rateLimitStatus,
        system: systemStatus,
        entities: rateLimitStatus.entities,
        recommendations: generateRateLimitRecommendations(rateLimitStatus)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get rate limit status',
      message: error.message
    });
  }
});

// Individual entity rate limit endpoint
app.get('/api/rate-limits/:entity', (req, res) => {
  try {
    if (!global.cricketService) {
      return res.status(503).json({
        success: false,
        error: 'Cricket service not available'
      });
    }
    
    const { entity } = req.params;
    const entityInfo = global.cricketService.rateLimiter.getEntityInfo(entity);
    
    if (!entityInfo) {
      return res.status(404).json({
        success: false,
        error: `Entity '${entity}' not found`
      });
    }
    
    res.json({
      success: true,
      data: entityInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to get rate limit status for entity '${req.params.entity}'`,
      message: error.message
    });
  }
});

// Rate limit history endpoint
app.get('/api/rate-limits/history/:entity?', (req, res) => {
  try {
    if (!global.cricketService) {
      return res.status(503).json({
        success: false,
        error: 'Cricket service not available'
      });
    }
    
    const limit = parseInt(req.query.limit) || 50;
    const history = global.cricketService.rateLimiter.getRequestHistory(limit);
    
    // Filter by entity if specified
    const { entity } = req.params;
    const filteredHistory = entity ? 
      history.filter(req => req.entity === entity) : 
      history;
    
    res.json({
      success: true,
      data: {
        history: filteredHistory,
        entity: entity || 'all',
        limit,
        totalRequests: filteredHistory.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get rate limit history',
      message: error.message
    });
  }
});

// 🚨 EMERGENCY: Rate limiter reset endpoints for debugging
app.post('/api/rate-limits/reset', (req, res) => {
  try {
    if (!global.cricketService) {
      return res.status(503).json({
        error: 'Cricket service not available',
        timestamp: new Date().toISOString()
      });
    }

    const beforeStatus = global.cricketService.rateLimiter.getStatus();
    global.cricketService.rateLimiter.reset();
    const afterStatus = global.cricketService.rateLimiter.getStatus();
    
    console.log('🔄 MANUAL RESET: Rate limiter reset via API');
    
    res.json({
      success: true,
      message: 'Rate limiter reset successfully',
      before: beforeStatus,
      after: afterStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Rate limit reset error:', error.message);
    res.status(500).json({
      error: 'Failed to reset rate limiter',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/rate-limits/reset/:entity', (req, res) => {
  try {
    const entity = req.params.entity;
    
    if (!global.cricketService) {
      return res.status(503).json({
        error: 'Cricket service not available',
        timestamp: new Date().toISOString()
      });
    }

    const beforeStatus = global.cricketService.rateLimiter.getEntityInfo(entity);
    const resetSuccess = global.cricketService.rateLimiter.resetEntity(entity);
    const afterStatus = global.cricketService.rateLimiter.getEntityInfo(entity);
    
    console.log(`🔄 MANUAL RESET: Entity ${entity} reset via API`);
    
    res.json({
      success: resetSuccess,
      message: resetSuccess ? `Entity ${entity} reset successfully` : `Failed to reset entity ${entity}`,
      entity,
      before: beforeStatus,
      after: afterStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[API] Entity reset error for ${req.params.entity}:`, error.message);
    res.status(500).json({
      error: `Failed to reset entity ${req.params.entity}`,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Generate rate limit recommendations based on current status
 */
function generateRateLimitRecommendations(rateLimitStatus) {
  const recommendations = [];
  
  if (rateLimitStatus.summary.limitedEntities > 0) {
    recommendations.push({
      type: 'warning',
      message: `${rateLimitStatus.summary.limitedEntities} entities are rate limited`,
      action: 'Consider reducing polling frequency or enabling cache fallback'
    });
  }
  
  const remainingPercentage = (rateLimitStatus.summary.totalRemaining / (rateLimitStatus.summary.totalEntities * 3000)) * 100;
  
  if (remainingPercentage < 10) {
    recommendations.push({
      type: 'critical',
      message: `Only ${Math.round(remainingPercentage)}% of rate limits remaining`,
      action: 'Switch to cache-only mode or increase polling intervals immediately'
    });
  } else if (remainingPercentage < 25) {
    recommendations.push({
      type: 'warning',
      message: `${Math.round(remainingPercentage)}% of rate limits remaining`,
      action: 'Consider increasing polling intervals to preserve quota'
    });
  }
  
  return recommendations;
}

// Cache monitoring endpoint  
app.get('/api/cache/metrics', (req, res) => {
  try {
    if (!global.cacheService) {
      return res.status(503).json({
        success: false,
        error: 'Cache service not available'
      });
    }

    const metrics = global.cacheService.getMetrics();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache metrics',
      message: error.message
    });
  }
});

app.post('/api/lifecycle/start-monitoring', (req, res) => {
  try {
    if (!global.serverLifecycleService) {
      return res.status(503).json({
        success: false,
        error: 'Server lifecycle service not available'
      });
    }
    
    global.serverLifecycleService.startMonitoring();
    
    res.json({
      success: true,
      message: 'Server monitoring started',
      data: {
        monitoring: true,
        interval: global.serverLifecycleService.config.monitoringInterval
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to start monitoring',
      message: error.message
    });
  }
});

app.post('/api/lifecycle/stop-monitoring', (req, res) => {
  try {
    if (!global.serverLifecycleService) {
      return res.status(503).json({
        success: false,
        error: 'Server lifecycle service not available'
      });
    }
    
    global.serverLifecycleService.stopMonitoring();
    
    res.json({
      success: true,
      message: 'Server monitoring stopped',
      data: {
        monitoring: false
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to stop monitoring',
      message: error.message
    });
  }
});

// WebSocket health and performance monitoring endpoints
app.get('/api/websocket/health', (req, res) => {
  try {
    const stats = {
      totalConnections: connectionStats.totalConnections,
      activeConnections: connectionStats.activeConnections,
      failedConnections: connectionStats.failedConnections,
      lastHealthCheck: connectionStats.lastHealthCheck,
      serverUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket health status',
      message: error.message
    });
  }
});

app.get('/api/websocket/stats', (req, res) => {
  try {
    if (!global.socketService) {
      return res.status(503).json({
        success: false,
        error: 'Socket service not available'
      });
    }
    
    const stats = global.socketService.getConnectionStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket statistics',
      message: error.message
    });
  }
});

app.get('/api/websocket/rooms', (req, res) => {
  try {
    const rooms = [];
    
    // Get all rooms from Socket.IO adapter
    if (io.sockets.adapter.rooms) {
      for (const [roomName, roomClients] of io.sockets.adapter.rooms) {
        if (roomName.startsWith('match:') || roomName === 'live-matches') {
          rooms.push({
            name: roomName,
            clientCount: roomClients.size,
            type: roomName.startsWith('match:') ? 'match' : 'general'
          });
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        rooms,
        totalRooms: rooms.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket rooms',
      message: error.message
    });
  }
});

// Database endpoints
app.get('/api/database/stats', async (req, res) => {
  try {
    const stats = await global.databaseService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get database stats',
      message: error.message
    });
  }
});

app.get('/api/database/error-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const filters = {};
    
    if (req.query.resolved !== undefined) {
      filters.resolved = req.query.resolved === 'true';
    }
    
    if (req.query.service) {
      filters.service = req.query.service;
    }
    
    const result = await global.databaseService.getErrorLogs(filters, page, limit);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get error logs',
      message: error.message
    });
  }
});

// ----- Live Cricket Fetching ----------------------------------------------
/**
 * Fetch live cricket matches from SportMonks API.
 * Returns a normalized structure so future phases can build on top easily.
 */
async function fetchLiveCricketMatches() {
  if (!SPORTMONKS_API_TOKEN) {
    console.warn('[Config] SPORTMONKS_API_TOKEN is missing. Live fetch will be skipped.');
    return { matches: [], raw: null };
  }

  try {
    const response = await axios.get(`${SPORTMONKS_API_BASE_URL}/fixtures`, {
      params: { 
        api_token: SPORTMONKS_API_TOKEN,
        include: 'venue,localteam,visitorteam,balls,lineup,scoreboards'
      },
      timeout: 10_000,
    });

    // SportMonks API returns { data: [...], meta: {...} }
    const payload = response.data;
    const matches = Array.isArray(payload?.data) ? payload.data : [];

    return { matches, raw: payload };
  } catch (error) {
    const message = error?.response?.data || error.message || 'Unknown error';
    console.error('[Fetch] Error fetching live matches:', message);
    return { matches: [], raw: null };
  }
}

// ----- Caching Layer -------------------------------------------------------
/**
 * Refresh the cache with the latest live matches.
 */
async function refreshLiveMatchesCache() {
  const { matches } = await fetchLiveCricketMatches();

  try {
    await redisClient.set(CACHE_KEY_LIVE_MATCHES, JSON.stringify(matches), {
      EX: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[Redis] Failed to set cache:', err?.message || err);
  }

  return matches;
}

/**
 * Retrieve matches from cache if available.
 */
async function getCachedLiveMatches() {
  try {
    const cached = await redisClient.get(CACHE_KEY_LIVE_MATCHES);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    console.error('[Redis] Failed to read cache:', err?.message || err);
  }
  return [];
}

// ----- Polling -------------------------------------------------------------
let pollIntervalId = null;

function startPolling(cricketService, cacheService, socketService, dataProcessor, eventDetector, questionGenerator, databaseService, errorHandler) {
  const doPoll = async () => {
    const cycleStartTime = Date.now();
    let cycleData = {
      success: false,
      duration: 0,
      error: null,
      matchesCount: 0,
      changesDetected: false,
      broadcastType: 'none',
      eventsDetected: 0,
      normalizedMatches: 0,
      persistedMatches: 0
    };
    
    try {
      console.log(`[Polling] ${new Date().toLocaleTimeString()} - Starting polling cycle`);
      
      // Check if system is auto-paused
      if (global.alertingService && global.alertingService.shouldPause()) {
        console.log('[Polling] System is auto-paused, skipping polling cycle');
        return;
      }
      
      const fetchResult = await errorHandler.executeWithRetry(
        () => cricketService.fetchLiveMatches(),
        {
          service: 'PollingService',
          operation: 'fetchLiveMatches',
          cycleStartTime
        }
      );
      
      if (fetchResult.error) {
        console.error('[Refresh] Failed to fetch live matches:', fetchResult.error);
        cycleData.error = fetchResult.error;
        
        // Log error to database
        if (databaseService && databaseService.connected) {
          await databaseService.saveErrorLog({
            requestId: fetchResult.requestId || `poll_${Date.now()}`,
            service: 'CricketService',
            operation: 'fetchLiveMatches',
            errorType: 'api_failure',
            errorMessage: fetchResult.error,
            duration: Date.now() - cycleStartTime,
            context: {
              cycleStartTime,
              retryAttempts: fetchResult.retryAttempts || 0
            }
          });
        }
        
        // Use cached data as fallback
        const cachedMatches = cacheService ? await cacheService.getLiveMatches() : [];
        if (cachedMatches.length > 0) {
          console.log(`[Polling] Using cached data as fallback: ${cachedMatches.length} matches`);
          socketService.broadcastMatchesUpdate(cachedMatches, 'cache-fallback');
          cycleData.success = true;
          cycleData.matchesCount = cachedMatches.length;
          cycleData.broadcastType = 'fallback';
        }
        
        // Record API failure
        global.monitoringService.recordApiRequest({
          success: false,
          error: fetchResult.error,
          duration: Date.now() - cycleStartTime
        });
        
        return;
      }

      // Record successful API request
      global.monitoringService.recordApiRequest({
        success: true,
        duration: Date.now() - cycleStartTime
      });

      // Persist matches to database
      if (databaseService && databaseService.connected && fetchResult.matches.length > 0) {
        try {
          const persistResult = await databaseService.saveMatches(fetchResult.matches);
          if (persistResult.success) {
            cycleData.persistedMatches = persistResult.upserted + persistResult.modified;
            console.log(`[Polling] Persisted ${cycleData.persistedMatches} matches to database`);
          } else {
            console.warn('[Polling] Failed to persist matches to database:', persistResult.error);
          }
        } catch (persistError) {
          console.error('[Polling] Error persisting matches:', persistError.message);
        }
      }

      // Get previous state for comparison
      const comparisonData = cacheService ? await cacheService.getMatchesForComparison() : { current: [], previous: [], hasPrevious: false };
      
      // Cache the fresh data (this will store previous state automatically)
      const cacheSuccess = cacheService ? await cacheService.setLiveMatches(fetchResult.matches, CACHE_TTL_SECONDS) : true;
      
      if (!cacheSuccess) {
        console.error('[Polling] Failed to cache matches, skipping broadcast');
        cycleData.error = 'Cache operation failed';
        return;
      }

      // Enhanced Data Processing: Normalize and store match data (if services available)
      if (dataProcessor && eventDetector) {
        console.log('[DataProcessing] Starting data normalization...');
        const normalizeResult = await dataProcessor.processAndStoreMatches({
          matches: fetchResult.matches,
          timestamp: new Date().toISOString(),
          source: 'api'
        });
        
        if (normalizeResult.success) {
          cycleData.normalizedMatches = normalizeResult.processedCount;
          console.log(`[DataProcessing] Normalized ${normalizeResult.processedCount} matches`);
          
          // Enhanced Event Detection: Process events for normalized matches
          console.log('[EventDetection] Starting event detection...');
          const eventResult = await eventDetector.processEventsForMatches(
            normalizeResult.normalizedMatches || []
          );
          
          if (eventResult.success) {
            cycleData.eventsDetected = eventResult.totalEvents;
            console.log(`[EventDetection] Detected ${eventResult.totalEvents} events across ${eventResult.matchesWithEvents} matches`);
          } else {
            console.warn('[EventDetection] Event detection failed:', eventResult.error);
          }
        } else {
          console.warn('[DataProcessing] Data normalization failed:', normalizeResult.error);
        }
      } else {
        console.log('[DataProcessing] Enhanced data processing services not available, skipping normalization and event detection');
      }

      // Compare with previous state and broadcast selective updates
      if (comparisonData.hasPrevious) {
        const MatchComparator = require('./utils/matchComparator');
        const matchComparator = new MatchComparator();
        
        const comparisonResult = matchComparator.compareMatches(
          fetchResult.matches, 
          comparisonData.previous
        );
        
        // Record change detection
        global.monitoringService.recordChangeDetection({
          hasChanges: comparisonResult.summary.hasChanges,
          newCount: comparisonResult.summary.newCount,
          updatedCount: comparisonResult.summary.updatedCount,
          finishedCount: comparisonResult.summary.finishedCount
        });
        
        if (comparisonResult.summary.hasChanges) {
          console.log(`[Polling] Changes detected: ${comparisonResult.summary.newCount} new, ${comparisonResult.summary.updatedCount} updated, ${comparisonResult.summary.finishedCount} finished`);
          
          // Broadcast selective updates
          socketService.broadcastSelectiveUpdates(comparisonResult, 'api-refresh');
          cycleData.success = true;
          cycleData.matchesCount = fetchResult.matches.length;
          cycleData.changesDetected = true;
          cycleData.broadcastType = 'selective';
          
          // Record selective broadcast
          global.monitoringService.recordBroadcast({
            type: 'selective',
            success: true,
            clientCount: socketService.connectedClients.size,
            changesCount: comparisonResult.summary.newCount + comparisonResult.summary.updatedCount + comparisonResult.summary.finishedCount
          });
        } else {
          console.log(`[Polling] No changes detected, skipping broadcast`);
          cycleData.success = true;
          cycleData.matchesCount = fetchResult.matches.length;
          cycleData.broadcastType = 'none';
        }
      } else {
        // First run or no previous state - broadcast all matches
        console.log(`[Polling] First run or no previous state, broadcasting all matches`);
        socketService.broadcastMatchesUpdate(fetchResult.matches, 'api-refresh');
        cycleData.success = true;
        cycleData.matchesCount = fetchResult.matches.length;
        cycleData.broadcastType = 'full';
        
        // Record full broadcast
        global.monitoringService.recordBroadcast({
          type: 'full',
          success: true,
          clientCount: socketService.connectedClients.size,
          matchesCount: fetchResult.matches.length
        });
      }
      
      console.log(`[Polling] ${new Date().toLocaleTimeString()} - Completed polling cycle: ${fetchResult.matches.length} matches`);
    } catch (error) {
      console.error('[Polling] Error:', error.message);
      cycleData.error = error.message;
      
      // Emergency fallback: try to broadcast cached data
      try {
        const cachedMatches = await cacheService.getLiveMatches();
        if (cachedMatches.length > 0) {
          console.log(`[Polling] Emergency fallback: broadcasting ${cachedMatches.length} cached matches`);
          socketService.broadcastMatchesUpdate(cachedMatches, 'emergency-fallback');
          cycleData.success = true;
          cycleData.matchesCount = cachedMatches.length;
          cycleData.broadcastType = 'emergency';
        }
      } catch (fallbackError) {
        console.error('[Polling] Emergency fallback failed:', fallbackError.message);
      }
    } finally {
      // Record cycle completion
      cycleData.duration = Date.now() - cycleStartTime;
      global.monitoringService.recordPollingCycle(cycleData);
      
      // Check for performance alerts
      global.monitoringService.checkPerformanceAlerts();
    }
  };

  // Run immediately on startup, then on interval
  doPoll().catch(() => {});
  pollIntervalId = setInterval(doPoll, POLL_INTERVAL_MS);
}

// ----- Startup & Shutdown --------------------------------------------------
async function start() {
  try {
    console.log('[Startup] Starting Sanjib Agent with enhanced production features...');
    console.log(`[Config] API Token: ${SPORTMONKS_API_TOKEN ? 'Configured' : 'Missing'}`);
    console.log(`[Config] API Base URL: ${SPORTMONKS_API_BASE_URL}`);
    console.log(`[Config] Polling Interval: ${POLL_INTERVAL_MS}ms`);
    console.log(`[Config] Cache TTL: ${CACHE_TTL_SECONDS}s`);
    console.log(`[Config] MongoDB URI: ${MONGODB_URI.replace(/\/\/.*@/, '//***:***@')}`);
    
    // Try to connect to Redis (with timeout)
    let redisConnected = false;
    try {
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 5000))
      ]);
      console.log('[Redis] Connected successfully');
      redisConnected = true;
    } catch (redisErr) {
      console.warn('[Redis] Connection failed, running without Redis:', redisErr.message);
      console.warn('[Redis] App will continue with limited functionality');
    }

    // Initialize enhanced production services
    const errorHandler = new ErrorHandler();
    const databaseService = new DatabaseService();
    const alertingService = new AlertingService();
    const healthCheckService = new HealthCheckService();
    const serverLifecycleService = new ServerLifecycleService({
      port: PORT,
      host: 'localhost',
      healthEndpoint: '/api/health',
      healthTimeout: 10000,
      startupTimeout: 30000,
      maxRetries: 3,
      retryDelay: 2000,
      monitoringInterval: 60000,
      projectPath: process.cwd(),
      startCommand: 'npm start'
    });
    
    // Try to connect to MongoDB
    let mongoConnected = false;
    try {
      mongoConnected = await databaseService.connect();
      if (mongoConnected) {
        console.log('[MongoDB] Connected successfully');
      } else {
        console.warn('[MongoDB] Connection failed, running without database persistence');
      }
    } catch (mongoErr) {
      console.warn('[MongoDB] Connection failed:', mongoErr.message);
      console.warn('[MongoDB] App will continue with limited functionality');
    }

    // Initialize services with enhanced configuration
    const cricketService = new CricketService(SPORTMONKS_API_TOKEN);
    
    // Override default configuration with environment variables
    cricketService.timeout = CRICKET_API_TIMEOUT;
    cricketService.maxRetries = CRICKET_API_RETRY_ATTEMPTS;
    cricketService.rateLimitDelay = CRICKET_API_RATE_LIMIT_DELAY;
    cricketService.cacheTTL = {
      liveMatches: CACHE_TTL_LIVE_MATCHES,
      fixtureDetails: CACHE_TTL_FIXTURE_DETAILS,
      playerStats: CACHE_TTL_PLAYER_STATS,
      ballByBall: CACHE_TTL_BALL_BY_BALL,
      leagues: CACHE_TTL_LEAGUES
    };
    
    // 🚨 EMERGENCY FIX: Reset rate limiter state on startup to clear any stuck entities
    console.log('🔄 EMERGENCY RESET: Clearing rate limiter state on startup...');
    cricketService.rateLimiter.reset();
    
    // Additionally reset livescores entity specifically (the problematic one)
    cricketService.rateLimiter.resetEntity('livescores');
    console.log('✅ Rate limiter emergency reset completed');
    
    const cacheService = redisConnected ? new CacheService(redisClient) : null;
    
    // Initialize enhanced data processing services
    const dataProcessor = redisConnected ? new DataProcessor(redisClient) : null;
    const eventDetector = redisConnected ? new EventDetector(redisClient) : null;
    const questionGenerator = redisConnected ? new QuestionGenerator(redisClient) : null;
    
    // Initialize ML-enhanced services
    const mlPredictionService = new MLPredictionService();
    const enhancedQuestionGenerator = redisConnected ? new EnhancedQuestionGenerator(redisClient, mlPredictionService) : null;
    const questionBroadcastingService = redisConnected && enhancedQuestionGenerator ? 
      new QuestionBroadcastingService(io, enhancedQuestionGenerator, redisClient) : null;
    const questionAPIRoutes = enhancedQuestionGenerator ? 
      new QuestionAPIRoutes(enhancedQuestionGenerator, questionBroadcastingService) : null;
    
    const socketService = new SocketService(io, cricketService, cacheService);
    const liveMatchesRoutes = new LiveMatchesRoutes(cricketService, cacheService);
    const monitoringService = new MonitoringService();
    
    // Integrate services
    monitoringService.setAlertingService(alertingService);
    
    // Make services globally available
    global.monitoringService = monitoringService;
    global.errorHandler = errorHandler;
    global.databaseService = databaseService;
    global.alertingService = alertingService;
    global.healthCheckService = healthCheckService;
    global.serverLifecycleService = serverLifecycleService;
    global.socketService = socketService;
    global.cricketService = cricketService;

    // Test API connection
    console.log('[Startup] Testing SportMonks Cricket API connection...');
    const apiTest = await cricketService.testConnection();
    if (apiTest.success) {
      console.log('[API] Connection test successful');
    } else {
      console.warn('[API] Connection test failed:', apiTest.error);
      console.warn('[API] App will use fallback mechanisms');
    }

    // Enhanced API endpoints
    app.get('/api/fixture/:id', async (req, res) => {
      try {
        const fixtureId = req.params.id;
        const result = await cricketService.fetchFixtureDetails(fixtureId);
        
        if (result.error) {
          return res.status(500).json({
            success: false,
            error: result.error,
            requestId: result.requestId
          });
        }
        
        res.json({
          success: true,
          data: result.fixture,
          requestId: result.requestId,
          duration: result.duration,
          cacheTTL: result.cacheTTL
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch fixture details',
          message: error.message
        });
      }
    });

    app.get('/api/player/:id', async (req, res) => {
      try {
        const playerId = req.params.id;
        const result = await cricketService.fetchPlayerStats(playerId);
        
        if (result.error) {
          return res.status(500).json({
            success: false,
            error: result.error,
            requestId: result.requestId
          });
        }
        
        res.json({
          success: true,
          data: {
            playerId: result.playerId,
            name: result.name,
            career: result.career,
            batting: result.batting,
            bowling: result.bowling
          },
          requestId: result.requestId,
          duration: result.duration,
          cacheTTL: result.cacheTTL
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch player stats',
          message: error.message
        });
      }
    });

    app.get('/api/ball-by-ball/:id', async (req, res) => {
      try {
        const fixtureId = req.params.id;
        const result = await cricketService.fetchBallByBallData(fixtureId);
        
        if (result.error) {
          return res.status(500).json({
            success: false,
            error: result.error,
            requestId: result.requestId
          });
        }
        
        res.json({
          success: true,
          data: {
            fixtureId: result.fixtureId,
            balls: result.balls,
            teams: result.teams
          },
          requestId: result.requestId,
          duration: result.duration,
          cacheTTL: result.cacheTTL
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch ball-by-ball data',
          message: error.message
        });
      }
    });

    app.get('/api/test-connection', async (req, res) => {
      try {
        const result = await cricketService.testConnection();
        
        res.json({
          success: result.success,
          message: result.message,
          status: result.status,
          requestId: result.requestId,
          duration: result.duration,
          timestamp: result.timestamp
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to test API connection',
          message: error.message
        });
      }
    });

    app.get('/api/service-status', (req, res) => {
      try {
        const status = cricketService.getStatus();
        res.json({
          success: true,
          data: status
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get service status',
          message: error.message
        });
      }
    });

    // Enhanced Data Processing API endpoints
    app.get('/api/match/:matchId/normalized-state', async (req, res) => {
      try {
        const matchId = req.params.matchId;
        
        if (!dataProcessor) {
          return res.status(503).json({
            success: false,
            error: 'Data processing service not available'
          });
        }
        
        const currentState = await dataProcessor.getCurrentState(matchId);
        
        if (!currentState) {
          return res.status(404).json({
            success: false,
            error: 'No normalized state found for this match'
          });
        }
        
        res.json({
          success: true,
          data: currentState,
          matchId
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get normalized state',
          message: error.message
        });
      }
    });

    app.get('/api/match/:matchId/events', async (req, res) => {
      try {
        const matchId = req.params.matchId;
        const limit = parseInt(req.query.limit) || 50;
        
        if (!eventDetector) {
          return res.status(503).json({
            success: false,
            error: 'Event detection service not available'
          });
        }
        
        const events = await eventDetector.getEvents(matchId, limit);
        const stats = await eventDetector.getEventQueueStats(matchId);
        
        res.json({
          success: true,
          data: {
            events,
            stats,
            matchId
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get events',
          message: error.message
        });
      }
    });

    app.get('/api/enhanced-services/status', (req, res) => {
      try {
        const status = {
          dataProcessor: dataProcessor ? dataProcessor.getStatus() : null,
          eventDetector: eventDetector ? eventDetector.getStatus() : null,
          questionGenerator: questionGenerator ? questionGenerator.getStatus() : null,
          timestamp: new Date().toISOString()
        };
        
        res.json({
          success: true,
          data: status
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get enhanced services status',
          message: error.message
        });
      }
    });

    // Question Generator API endpoints
    app.get('/api/match/:matchId/questions', async (req, res) => {
      try {
        const matchId = req.params.matchId;
        const limit = parseInt(req.query.limit) || 50;
        
        if (!questionGenerator) {
          return res.status(503).json({
            success: false,
            error: 'Question generator service not available'
          });
        }
        
        const questions = await questionGenerator.getGeneratedQuestions(matchId, limit);
        const stats = await questionGenerator.getQuestionStats(matchId);
        
        res.json({
          success: true,
          data: {
            questions,
            stats,
            matchId
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get generated questions',
          message: error.message
        });
      }
    });

    app.get('/api/match/:matchId/questions/stats', async (req, res) => {
      try {
        const matchId = req.params.matchId;
        
        if (!questionGenerator) {
          return res.status(503).json({
            success: false,
            error: 'Question generator service not available'
          });
        }
        
        const stats = await questionGenerator.getQuestionStats(matchId);
        
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get question statistics',
          message: error.message
        });
      }
    });

    app.delete('/api/match/:matchId/questions', async (req, res) => {
      try {
        const matchId = req.params.matchId;
        
        if (!questionGenerator) {
          return res.status(503).json({
            success: false,
            error: 'Question generator service not available'
          });
        }
        
        const success = await questionGenerator.clearGeneratedQuestions(matchId);
        
        res.json({
          success,
          message: success ? 'Questions cleared successfully' : 'Failed to clear questions',
          matchId
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to clear questions',
          message: error.message
        });
      }
    });

    // Mount live matches routes after services are initialized
    app.use('/api/live-matches', liveMatchesRoutes.getRouter());
    
    // Mount question API routes
    if (questionAPIRoutes) {
      app.use('/api/questions', questionAPIRoutes.getRouter());
      console.log('[Server] Question API routes mounted at /api/questions');
      
      // Update root route to include question endpoints
      app.get('/', (req, res) => {
        res.json({
          message: 'Cricket Betting Agent API Server',
          version: '2.0',
          status: 'running',
          endpoints: {
            matches: '/api/live-matches',
            health: '/api/health',
            websocket: '/socket.io',
            monitoring: '/api/monitoring/status',
            rateLimits: '/api/rate-limits',
            cache: '/api/cache/metrics',
            questions: {
              active: '/api/questions/questions/active',
              serviceStatus: '/api/questions/service/status',
              mlStatus: '/api/questions/ml/status'
            }
          },
          timestamp: new Date().toISOString()
        });
      });
    }

    console.log('[Services] All services initialized');

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
      console.log(`[Server] Live matches: http://localhost:${PORT}/api/live-matches`);
    });

    // Start health check service
    healthCheckService.startAutoCheck();
    console.log('[Server] Health check service started');

    // Start polling and real-time updates
    if (redisConnected && dataProcessor && eventDetector && enhancedQuestionGenerator) {
      startPolling(cricketService, cacheService, socketService, dataProcessor, eventDetector, enhancedQuestionGenerator, databaseService, errorHandler);
      socketService.startAutoUpdates();
      
      // Start enhanced question generator service
      await enhancedQuestionGenerator.start();
      console.log('[Server] Enhanced polling with ML-integrated question generation started');
      
      // Start question broadcasting service
      if (questionBroadcastingService) {
        questionBroadcastingService.startBroadcasting();
        console.log('[Server] Question broadcasting service started');
      }
    } else if (redisConnected && dataProcessor && eventDetector && questionGenerator) {
      startPolling(cricketService, cacheService, socketService, dataProcessor, eventDetector, questionGenerator, databaseService, errorHandler);
      socketService.startAutoUpdates();
      console.log('[Server] Enhanced polling with data processing and event detection started (ML-enhanced question generation not available)');
    } else if (redisConnected) {
      startPolling(cricketService, cacheService, socketService, null, null, null, databaseService, errorHandler);
      socketService.startAutoUpdates();
      console.log('[Server] Basic polling started (enhanced services not available)');
    } else {
      startPolling(cricketService, null, socketService, null, null, null, databaseService, errorHandler);
      console.log('[Server] Polling started without Redis (limited functionality)');
    }
    
    console.log('[Server] All services started successfully');

  } catch (err) {
    console.error('[Startup] Failed to start server:', err?.message || err);
    process.exit(1);
  }
}

async function shutdown(code = 0) {
  console.log('[Shutdown] Cleaning up...');
  
  // Stop polling
  if (pollIntervalId) clearInterval(pollIntervalId);
  
  // Stop health check service
  if (global.healthCheckService) {
    global.healthCheckService.stopAutoCheck();
  }

  // Close Socket.IO
  try { io.close(); } catch (_) {}

  // Disconnect from MongoDB
  const disconnectMongo = global.databaseService ? 
    global.databaseService.disconnect() : Promise.resolve(true);

  // Close Redis and HTTP server
  const quitRedis = redisClient.quit().catch(() => {});
  const closeServer = new Promise((resolve) => {
    httpServer.close(() => resolve());
  });

  try {
    await Promise.allSettled([quitRedis, closeServer, disconnectMongo]);
    console.log('[Shutdown] Cleanup completed successfully');
  } catch (error) {
    console.error('[Shutdown] Error during cleanup:', error.message);
  } finally {
    process.exit(code);
  }
}

process.on('SIGINT', () => {
  console.log('\n[Signal] SIGINT received');
  shutdown(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Signal] SIGTERM received');
  shutdown(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

// Kick everything off
start();


