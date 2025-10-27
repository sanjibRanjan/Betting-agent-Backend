'use strict';

const logger = require('../utils/loggerService');

/**
 * Real-time Question Broadcasting Service
 * Handles streaming of ML-enhanced questions to clients via Socket.IO
 */
class QuestionBroadcastingService {
  constructor(io, enhancedQuestionGenerator, redisClient) {
    this.io = io;
    this.enhancedQuestionGenerator = enhancedQuestionGenerator;
    this.redisClient = redisClient;
    this.isRunning = false;
    this.broadcastInterval = null;
    this.broadcastIntervalMs = 10000; // 10 seconds
    this.connectedClients = new Set();
    this.subscribedMatches = new Map(); // Track which clients are subscribed to which matches
    this.questionUpdateQueue = new Map(); // Queue for question updates
    
    this.setupSocketHandlers();
  }

  /**
   * Setup Socket.IO event handlers for question broadcasting
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info('Client connected to question broadcasting service', { socketId: socket.id });
      this.connectedClients.add(socket.id);

      // Send current questions immediately on connection
      this.sendCurrentQuestions(socket);

      // Handle client disconnection
      socket.on('disconnect', () => {
        logger.info('Client disconnected from question broadcasting service', { socketId: socket.id });
        this.connectedClients.delete(socket.id);
        this.subscribedMatches.delete(socket.id);
      });

      // Handle client subscribing to questions for a specific match
      socket.on('questions:subscribe', (data) => {
        const { matchId } = data;
        if (matchId) {
          logger.info('Client subscribed to questions for match', { 
            socketId: socket.id, 
            matchId 
          });
          
          if (!this.subscribedMatches.has(socket.id)) {
            this.subscribedMatches.set(socket.id, new Set());
          }
          this.subscribedMatches.get(socket.id).add(matchId);
          
          // Send current questions for this match
          this.sendQuestionsForMatch(socket, matchId);
        }
      });

      // Handle client unsubscribing from questions for a specific match
      socket.on('questions:unsubscribe', (data) => {
        const { matchId } = data;
        if (matchId && this.subscribedMatches.has(socket.id)) {
          logger.info('Client unsubscribed from questions for match', { 
            socketId: socket.id, 
            matchId 
          });
          this.subscribedMatches.get(socket.id).delete(matchId);
        }
      });

      // Handle client requesting questions for a specific match
      socket.on('questions:request', (data) => {
        const { matchId, limit = 50 } = data;
        if (matchId) {
          logger.info('Client requested questions for match', { 
            socketId: socket.id, 
            matchId,
            limit 
          });
          this.sendQuestionsForMatch(socket, matchId, limit);
        }
      });

      // Handle client answering a question
      socket.on('questions:answer', (data) => {
        const { questionId, answer, confidence } = data;
        if (questionId) {
          logger.info('Client answered question', { 
            socketId: socket.id, 
            questionId,
            answer,
            confidence 
          });
          
          // Record user interaction
          this.enhancedQuestionGenerator.recordUserInteraction(
            questionId, 
            'answer', 
            { answer, confidence, socketId: socket.id }
          );
          
          // Send acknowledgment
          socket.emit('questions:answer:ack', {
            questionId,
            success: true,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle client skipping a question
      socket.on('questions:skip', (data) => {
        const { questionId, reason } = data;
        if (questionId) {
          logger.info('Client skipped question', { 
            socketId: socket.id, 
            questionId,
            reason 
          });
          
          // Record user interaction
          this.enhancedQuestionGenerator.recordUserInteraction(
            questionId, 
            'skip', 
            { reason, socketId: socket.id }
          );
          
          // Send acknowledgment
          socket.emit('questions:skip:ack', {
            questionId,
            success: true,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle client viewing a question
      socket.on('questions:view', (data) => {
        const { questionId } = data;
        if (questionId) {
          // Record user interaction
          this.enhancedQuestionGenerator.recordUserInteraction(
            questionId, 
            'view', 
            { socketId: socket.id }
          );
        }
      });
    });
  }

  /**
   * Send current questions to a specific socket
   * @param {Socket} socket The socket to send data to
   */
  async sendCurrentQuestions(socket) {
    try {
      // Get all active matches
      const matchKeys = await this.redisClient.keys('questions:enhanced:*');
      const allQuestions = [];

      for (const key of matchKeys) {
        const matchId = key.replace('questions:enhanced:', '');
        const questions = await this.enhancedQuestionGenerator.getEnhancedQuestions(matchId, 10);
        allQuestions.push(...questions);
      }

      socket.emit('questions:data', {
        questions: allQuestions,
        count: allQuestions.length,
        source: 'cache',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error sending current questions', {
        socketId: socket.id,
        error: error.message
      });
      socket.emit('questions:error', {
        error: 'Failed to fetch questions',
        message: error.message
      });
    }
  }

  /**
   * Send questions for a specific match to a socket
   * @param {Socket} socket The socket to send data to
   * @param {string} matchId Match ID
   * @param {number} limit Maximum number of questions
   */
  async sendQuestionsForMatch(socket, matchId, limit = 50) {
    try {
      const questions = await this.enhancedQuestionGenerator.getEnhancedQuestions(matchId, limit);
      
      socket.emit('questions:match:data', {
        matchId,
        questions,
        count: questions.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error sending questions for match', {
        socketId: socket.id,
        matchId,
        error: error.message
      });
      socket.emit('questions:error', {
        error: 'Failed to fetch questions for match',
        message: error.message,
        matchId
      });
    }
  }

  /**
   * Broadcast new questions to subscribed clients
   * @param {string} matchId Match ID
   * @param {Array} questions Array of new questions
   */
  broadcastNewQuestions(matchId, questions) {
    try {
      if (!Array.isArray(questions) || questions.length === 0) {
        return;
      }

      const updateData = {
        matchId,
        questions,
        count: questions.length,
        changeType: 'new',
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size
      };

      // Broadcast to all connected clients
      this.io.emit('questions:new', updateData);
      
      // Send to clients subscribed to this specific match
      this.io.to(`questions:${matchId}`).emit('questions:match:new', updateData);

      logger.info('Broadcasted new questions', {
        matchId,
        questionCount: questions.length,
        clientCount: this.connectedClients.size
      });

    } catch (error) {
      logger.error('Error broadcasting new questions', {
        matchId,
        questionCount: questions.length,
        error: error.message
      });
    }
  }

  /**
   * Broadcast updated questions to subscribed clients
   * @param {string} matchId Match ID
   * @param {Array} questions Array of updated questions
   */
  broadcastUpdatedQuestions(matchId, questions) {
    try {
      if (!Array.isArray(questions) || questions.length === 0) {
        return;
      }

      const updateData = {
        matchId,
        questions,
        count: questions.length,
        changeType: 'update',
        timestamp: new Date().toISOString(),
        clientCount: this.connectedClients.size
      };

      // Broadcast to all connected clients
      this.io.emit('questions:update', updateData);
      
      // Send to clients subscribed to this specific match
      this.io.to(`questions:${matchId}`).emit('questions:match:update', updateData);

      logger.info('Broadcasted updated questions', {
        matchId,
        questionCount: questions.length,
        clientCount: this.connectedClients.size
      });

    } catch (error) {
      logger.error('Error broadcasting updated questions', {
        matchId,
        questionCount: questions.length,
        error: error.message
      });
    }
  }

  /**
   * Queue question updates for broadcasting
   * @param {string} matchId Match ID
   * @param {Array} questions Array of questions
   * @param {string} updateType Type of update (new, update)
   */
  queueQuestionUpdate(matchId, questions, updateType = 'new') {
    try {
      if (!this.questionUpdateQueue.has(matchId)) {
        this.questionUpdateQueue.set(matchId, []);
      }

      this.questionUpdateQueue.get(matchId).push({
        questions,
        updateType,
        timestamp: new Date().toISOString()
      });

      logger.debug('Queued question update', {
        matchId,
        questionCount: questions.length,
        updateType,
        queueSize: this.questionUpdateQueue.get(matchId).length
      });

    } catch (error) {
      logger.error('Error queuing question update', {
        matchId,
        questionCount: questions.length,
        updateType,
        error: error.message
      });
    }
  }

  /**
   * Process queued question updates
   */
  async processQueuedUpdates() {
    try {
      for (const [matchId, updates] of this.questionUpdateQueue.entries()) {
        if (updates.length === 0) {
          continue;
        }

        // Process the latest update for each match
        const latestUpdate = updates[updates.length - 1];
        
        if (latestUpdate.updateType === 'new') {
          this.broadcastNewQuestions(matchId, latestUpdate.questions);
        } else if (latestUpdate.updateType === 'update') {
          this.broadcastUpdatedQuestions(matchId, latestUpdate.questions);
        }

        // Clear processed updates
        this.questionUpdateQueue.set(matchId, []);
      }

    } catch (error) {
      logger.error('Error processing queued question updates', {
        error: error.message
      });
    }
  }

  /**
   * Start automatic question broadcasting
   */
  startBroadcasting() {
    if (this.isRunning) {
      logger.warn('Question broadcasting already running');
      return;
    }

    logger.info('Starting question broadcasting service', {
      broadcastInterval: this.broadcastIntervalMs
    });

    const broadcastQuestions = async () => {
      try {
        // Check if we have connected clients
        if (this.connectedClients.size === 0) {
          logger.debug('No connected clients, skipping question broadcast');
          return;
        }

        // Process queued updates
        await this.processQueuedUpdates();

        // Get all active matches and broadcast their questions
        const matchKeys = await this.redisClient.keys('questions:enhanced:*');
        
        for (const key of matchKeys) {
          const matchId = key.replace('questions:enhanced:', '');
          const questions = await this.enhancedQuestionGenerator.getEnhancedQuestions(matchId, 20);
          
          if (questions.length > 0) {
            // Check if there are clients subscribed to this match
            const hasSubscribers = Array.from(this.subscribedMatches.values())
              .some(subscriptions => subscriptions.has(matchId));
            
            if (hasSubscribers) {
              this.broadcastUpdatedQuestions(matchId, questions);
            }
          }
        }

      } catch (error) {
        logger.error('Error in question broadcasting', {
          error: error.message
        });
      }
    };

    // Run immediately, then on interval
    broadcastQuestions();
    this.broadcastInterval = setInterval(broadcastQuestions, this.broadcastIntervalMs);
    this.isRunning = true;
  }

  /**
   * Stop automatic question broadcasting
   */
  stopBroadcasting() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
      this.isRunning = false;
      logger.info('Question broadcasting service stopped');
    }
  }

  /**
   * Set the broadcast interval
   * @param {number} intervalMs Interval in milliseconds
   */
  setBroadcastInterval(intervalMs) {
    this.broadcastIntervalMs = intervalMs;
    
    if (this.isRunning) {
      this.stopBroadcasting();
      this.startBroadcasting();
    }
  }

  /**
   * Get broadcasting statistics
   * @returns {Object} Broadcasting statistics
   */
  getBroadcastingStats() {
    const stats = {
      isRunning: this.isRunning,
      connectedClients: this.connectedClients.size,
      subscribedMatches: 0,
      queuedUpdates: 0,
      broadcastInterval: this.broadcastIntervalMs
    };

    // Count subscribed matches
    for (const subscriptions of this.subscribedMatches.values()) {
      stats.subscribedMatches += subscriptions.size;
    }

    // Count queued updates
    for (const updates of this.questionUpdateQueue.values()) {
      stats.queuedUpdates += updates.length;
    }

    return stats;
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'QuestionBroadcastingService',
      isRunning: this.isRunning,
      connectedClients: this.connectedClients.size,
      subscribedMatches: this.subscribedMatches.size,
      broadcastInterval: this.broadcastIntervalMs,
      queuedUpdates: this.questionUpdateQueue.size,
      stats: this.getBroadcastingStats(),
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

module.exports = QuestionBroadcastingService;
