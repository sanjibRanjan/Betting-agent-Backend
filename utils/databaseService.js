'use strict';

const mongoose = require('mongoose');
const logger = require('./loggerService');

/**
 * MongoDB Database Service for persistent storage
 * Handles matches, players, and error logs persistence
 */
class DatabaseService {
  constructor() {
    this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanjib-agent';
    this.connected = false;
    this.connection = null;
    this.models = {};
    
    // Initialize schemas
    this.initializeSchemas();
  }

  /**
   * Initialize MongoDB schemas
   */
  initializeSchemas() {
    // Matches Schema
    const matchSchema = new mongoose.Schema({
      fixtureId: { type: String, required: true, unique: true },
      title: { type: String, required: true },
      teams: {
        home: { type: String, required: true },
        away: { type: String, required: true }
      },
      status: { type: String, required: true },
      score: { type: String },
      venue: { type: String },
      startTime: { type: Date },
      format: { type: String },
      series: { type: String },
      odds: { type: mongoose.Schema.Types.Mixed },
      lastUpdated: { type: Date, default: Date.now },
      leagueId: { type: String },
      seasonId: { type: String },
      roundId: { type: String },
      ballByBall: { type: mongoose.Schema.Types.Mixed },
      teamDetails: {
        local: {
          id: { type: Number },
          name: { type: String },
          code: { type: String },
          image_path: { type: String }
        },
        visitor: {
          id: { type: Number },
          name: { type: String },
          code: { type: String },
          image_path: { type: String }
        }
      },
      rawData: { type: mongoose.Schema.Types.Mixed }, // Store original API response
      source: { type: String, default: 'sportmonks_api' },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }, {
      timestamps: true
    });

    // Players Schema
    const playerSchema = new mongoose.Schema({
      playerId: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      fullName: { type: String },
      dateOfBirth: { type: Date },
      country: { type: String },
      role: { type: String },
      battingStyle: { type: String },
      bowlingStyle: { type: String },
      career: {
        matches: { type: Number, default: 0 },
        runs: { type: Number, default: 0 },
        wickets: { type: Number, default: 0 },
        average: { type: Number, default: 0 },
        strikeRate: { type: Number, default: 0 }
      },
      batting: { type: mongoose.Schema.Types.Mixed },
      bowling: { type: mongoose.Schema.Types.Mixed },
      rawData: { type: mongoose.Schema.Types.Mixed },
      source: { type: String, default: 'sportmonks_api' },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }, {
      timestamps: true
    });

    // Error Logs Schema
    const errorLogSchema = new mongoose.Schema({
      requestId: { type: String, required: true },
      service: { type: String, required: true },
      operation: { type: String, required: true },
      errorType: { type: String, required: true },
      errorMessage: { type: String, required: true },
      errorStack: { type: String },
      statusCode: { type: Number },
      duration: { type: Number },
      context: { type: mongoose.Schema.Types.Mixed },
      retryAttempts: { type: Number, default: 0 },
      resolved: { type: Boolean, default: false },
      resolvedAt: { type: Date },
      createdAt: { type: Date, default: Date.now }
    });

    // Create models
    this.models.Match = mongoose.model('Match', matchSchema);
    this.models.Player = mongoose.model('Player', playerSchema);
    this.models.ErrorLog = mongoose.model('ErrorLog', errorLogSchema);

    logger.info('Database schemas initialized', {
      schemas: ['Match', 'Player', 'ErrorLog']
    });
  }

  /**
   * Connect to MongoDB
   * @returns {Promise<boolean>} Connection success status
   */
  async connect() {
    try {
      logger.info('Connecting to MongoDB', {
        uri: this.mongoUri.replace(/\/\/.*@/, '//***:***@') // Hide credentials in logs
      });

      this.connection = await mongoose.connect(this.mongoUri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false
      });

      this.connected = true;
      
      logger.info('Successfully connected to MongoDB', {
        host: this.connection.connection.host,
        port: this.connection.connection.port,
        name: this.connection.connection.name
      });

      // Set up connection event listeners
      this.setupConnectionListeners();

      return true;
    } catch (error) {
      this.connected = false;
      logger.error('Failed to connect to MongoDB', {
        error: error.message,
        uri: this.mongoUri.replace(/\/\/.*@/, '//***:***@')
      });
      return false;
    }
  }

  /**
   * Set up MongoDB connection event listeners
   */
  setupConnectionListeners() {
    const db = mongoose.connection;

    db.on('error', (error) => {
      logger.error('MongoDB connection error', { error: error.message });
    });

    db.on('disconnected', () => {
      this.connected = false;
      logger.warn('MongoDB disconnected');
    });

    db.on('reconnected', () => {
      this.connected = true;
      logger.info('MongoDB reconnected');
    });

    db.on('close', () => {
      this.connected = false;
      logger.info('MongoDB connection closed');
    });
  }

  /**
   * Save match data to database
   * @param {Object} matchData Match data to save
   * @returns {Promise<Object>} Save result
   */
  async saveMatch(matchData) {
    if (!this.connected) {
      logger.warn('Database not connected, skipping match save', {
        fixtureId: matchData.fixtureId
      });
      return { success: false, error: 'Database not connected' };
    }

    try {
      const match = new this.models.Match({
        ...matchData,
        updatedAt: new Date()
      });

      const result = await this.models.Match.findOneAndUpdate(
        { fixtureId: matchData.fixtureId },
        match,
        { upsert: true, new: true, runValidators: true }
      );

      logger.debug('Match saved to database', {
        fixtureId: matchData.fixtureId,
        matchId: result._id
      });

      return {
        success: true,
        matchId: result._id,
        fixtureId: result.fixtureId
      };
    } catch (error) {
      logger.error('Failed to save match to database', {
        fixtureId: matchData.fixtureId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save multiple matches to database
   * @param {Array} matches Array of match data
   * @returns {Promise<Object>} Bulk save result
   */
  async saveMatches(matches) {
    if (!this.connected) {
      logger.warn('Database not connected, skipping bulk match save', {
        matchesCount: matches.length
      });
      return { success: false, error: 'Database not connected' };
    }

    try {
      const operations = matches.map(match => ({
        updateOne: {
          filter: { fixtureId: match.fixtureId },
          update: { ...match, updatedAt: new Date() },
          upsert: true
        }
      }));

      const result = await this.models.Match.bulkWrite(operations);

      logger.info('Bulk matches saved to database', {
        matchesCount: matches.length,
        upserted: result.upsertedCount,
        modified: result.modifiedCount
      });

      return {
        success: true,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
        total: matches.length
      };
    } catch (error) {
      logger.error('Failed to bulk save matches to database', {
        matchesCount: matches.length,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save player data to database
   * @param {Object} playerData Player data to save
   * @returns {Promise<Object>} Save result
   */
  async savePlayer(playerData) {
    if (!this.connected) {
      logger.warn('Database not connected, skipping player save', {
        playerId: playerData.playerId
      });
      return { success: false, error: 'Database not connected' };
    }

    try {
      const player = new this.models.Player({
        ...playerData,
        updatedAt: new Date()
      });

      const result = await this.models.Player.findOneAndUpdate(
        { playerId: playerData.playerId },
        player,
        { upsert: true, new: true, runValidators: true }
      );

      logger.debug('Player saved to database', {
        playerId: playerData.playerId,
        playerDbId: result._id
      });

      return {
        success: true,
        playerId: result._id,
        playerExternalId: result.playerId
      };
    } catch (error) {
      logger.error('Failed to save player to database', {
        playerId: playerData.playerId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save error log to database
   * @param {Object} errorData Error data to save
   * @returns {Promise<Object>} Save result
   */
  async saveErrorLog(errorData) {
    if (!this.connected) {
      logger.warn('Database not connected, skipping error log save', {
        requestId: errorData.requestId
      });
      return { success: false, error: 'Database not connected' };
    }

    try {
      const errorLog = new this.models.ErrorLog(errorData);
      const result = await errorLog.save();

      logger.debug('Error log saved to database', {
        requestId: errorData.requestId,
        errorLogId: result._id
      });

      return {
        success: true,
        errorLogId: result._id,
        requestId: result.requestId
      };
    } catch (error) {
      logger.error('Failed to save error log to database', {
        requestId: errorData.requestId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get matches from database with pagination
   * @param {Object} filters Query filters
   * @param {number} page Page number
   * @param {number} limit Number of results per page
   * @returns {Promise<Object>} Query result
   */
  async getMatches(filters = {}, page = 1, limit = 50) {
    if (!this.connected) {
      return { success: false, error: 'Database not connected', matches: [], total: 0 };
    }

    try {
      const skip = (page - 1) * limit;
      
      const [matches, total] = await Promise.all([
        this.models.Match.find(filters)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.models.Match.countDocuments(filters)
      ]);

      logger.debug('Matches retrieved from database', {
        filters,
        page,
        limit,
        matchesCount: matches.length,
        total
      });

      return {
        success: true,
        matches,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      logger.error('Failed to get matches from database', {
        filters,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        matches: [],
        total: 0
      };
    }
  }

  /**
   * Get error logs from database with pagination
   * @param {Object} filters Query filters
   * @param {number} page Page number
   * @param {number} limit Number of results per page
   * @returns {Promise<Object>} Query result
   */
  async getErrorLogs(filters = {}, page = 1, limit = 50) {
    if (!this.connected) {
      return { success: false, error: 'Database not connected', logs: [], total: 0 };
    }

    try {
      const skip = (page - 1) * limit;
      
      const [logs, total] = await Promise.all([
        this.models.ErrorLog.find(filters)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.models.ErrorLog.countDocuments(filters)
      ]);

      logger.debug('Error logs retrieved from database', {
        filters,
        page,
        limit,
        logsCount: logs.length,
        total
      });

      return {
        success: true,
        logs,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      logger.error('Failed to get error logs from database', {
        filters,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        logs: [],
        total: 0
      };
    }
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getStats() {
    if (!this.connected) {
      return { success: false, error: 'Database not connected' };
    }

    try {
      const [matchCount, playerCount, errorLogCount, recentErrors] = await Promise.all([
        this.models.Match.countDocuments(),
        this.models.Player.countDocuments(),
        this.models.ErrorLog.countDocuments(),
        this.models.ErrorLog.countDocuments({ 
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
        })
      ]);

      return {
        success: true,
        stats: {
          matches: matchCount,
          players: playerCount,
          totalErrorLogs: errorLogCount,
          recentErrors,
          connected: this.connected
        }
      };
    } catch (error) {
      logger.error('Failed to get database statistics', {
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Disconnect from MongoDB
   * @returns {Promise<boolean>} Disconnection success status
   */
  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.disconnect();
        this.connected = false;
        logger.info('Disconnected from MongoDB');
        return true;
      }
      return true;
    } catch (error) {
      logger.error('Failed to disconnect from MongoDB', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get database service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      service: 'DatabaseService',
      connected: this.connected,
      uri: this.mongoUri.replace(/\/\/.*@/, '//***:***@'),
      models: Object.keys(this.models),
      status: this.connected ? 'ready' : 'disconnected',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = DatabaseService;
