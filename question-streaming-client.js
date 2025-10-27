'use strict';

/**
 * Question Streaming Client for Sanjib Agent
 * 
 * Features:
 * - Connects to question broadcasting service via Socket.IO
 * - Fetches questions via REST API
 * - Real-time display of betting questions
 * - Filtering by match ID and confidence threshold
 * - Statistics tracking and performance monitoring
 * - Structured JSON output for better readability
 */

const { io } = require('socket.io-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class QuestionStreamingClient {
  constructor(options = {}) {
    // Configuration
    this.serverUrl = options.serverUrl || 'http://localhost:5000';
    this.autoReconnect = options.autoReconnect !== false;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.logToFile = options.logToFile || false;
    this.logFilePath = options.logFilePath || './question-client.log';
    this.displayMode = options.displayMode || 'console'; // 'console', 'json', 'table'
    this.refreshInterval = options.refreshInterval || 30000; // 30 seconds for REST API polling
    
    // Connection state
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.subscribedMatches = new Set();
    
    // Filtering options
    this.filters = {
      matchId: null,
      minConfidence: 0,
      category: null,
      difficulty: null,
      mlEnhanced: true
    };
    
    // Statistics
    this.stats = {
      questionsReceived: 0,
      questionsDisplayed: 0,
      questionsFiltered: 0,
      averageConfidence: 0,
      totalConfidence: 0,
      connectionTime: null,
      lastQuestionTime: null,
      reconnectCount: 0,
      startTime: new Date().toISOString(),
      matchesTracked: 0,
      categoriesSeen: new Set(),
      difficultiesSeen: new Set()
    };
    
    // Question storage
    this.recentQuestions = [];
    this.maxRecentQuestions = 100;
    
    // Initialize logging
    this.initializeLogging();
  }

  /**
   * Initialize logging system
   */
  initializeLogging() {
    if (this.logToFile) {
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

    // Console output based on display mode
    if (this.displayMode === 'json') {
      console.log(JSON.stringify(logEntry, null, 2));
    } else if (this.displayMode === 'table' && data) {
      console.table(data);
    } else {
      console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
    }

    // File output if enabled
    if (this.logToFile) {
      fs.appendFileSync(this.logFilePath, JSON.stringify(logEntry) + '\n');
    }
  }

  /**
   * Connect to the server via Socket.IO
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.log('info', 'Attempting to connect to question broadcasting service', { 
        serverUrl: this.serverUrl 
      });

      this.socket = io(this.serverUrl, {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true
      });

      // Connection successful
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.stats.connectionTime = new Date().toISOString();
        
        this.log('info', 'Connected to question broadcasting service', {
          socketId: this.socket.id,
          serverUrl: this.serverUrl
        });

        // Set up event listeners
        this.setupSocketEventListeners();
        resolve();
      });

      // Connection failed
      this.socket.on('connect_error', (error) => {
        this.log('error', 'Failed to connect to question broadcasting service', {
          error: error.message,
          serverUrl: this.serverUrl
        });
        
        if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
        reject(error);
      });

      // Disconnected
      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.log('warn', 'Disconnected from question broadcasting service', {
          reason,
          socketId: this.socket.id,
          reconnectAttempts: this.reconnectAttempts
        });

        if (this.autoReconnect && reason !== 'io client disconnect') {
          this.scheduleReconnect();
        }
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

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    ) + Math.random() * 1000;

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
   * Set up Socket.IO event listeners for question broadcasting
   */
  setupSocketEventListeners() {
    if (!this.socket) return;

    // Question data events
    this.socket.on('questions:data', (data) => {
      this.handleQuestionsData(data);
    });

    this.socket.on('questions:new', (data) => {
      this.handleNewQuestions(data);
    });

    this.socket.on('questions:update', (data) => {
      this.handleUpdatedQuestions(data);
    });

    this.socket.on('questions:match:data', (data) => {
      this.handleMatchQuestionsData(data);
    });

    this.socket.on('questions:match:new', (data) => {
      this.handleMatchNewQuestions(data);
    });

    this.socket.on('questions:match:update', (data) => {
      this.handleMatchUpdatedQuestions(data);
    });

    // Answer acknowledgment events
    this.socket.on('questions:answer:ack', (data) => {
      this.handleAnswerAcknowledgment(data);
    });

    this.socket.on('questions:skip:ack', (data) => {
      this.handleSkipAcknowledgment(data);
    });

    // Error events
    this.socket.on('questions:error', (data) => {
      this.handleQuestionError(data);
    });

    // Generic event handler
    this.socket.onAny((eventName, data) => {
      this.handleGenericEvent(eventName, data);
    });
  }

  /**
   * Handle questions data events
   */
  handleQuestionsData(data) {
    this.log('info', 'Received questions data', {
      eventType: 'questions:data',
      questionCount: data.count,
      source: data.source,
      timestamp: data.timestamp
    });

    if (data.questions && Array.isArray(data.questions)) {
      this.processQuestions(data.questions, 'initial');
    }
  }

  /**
   * Handle new questions events
   */
  handleNewQuestions(data) {
    this.log('info', 'Received new questions', {
      eventType: 'questions:new',
      matchId: data.matchId,
      questionCount: data.count,
      changeType: data.changeType,
      timestamp: data.timestamp
    });

    if (data.questions && Array.isArray(data.questions)) {
      this.processQuestions(data.questions, 'new');
    }
  }

  /**
   * Handle updated questions events
   */
  handleUpdatedQuestions(data) {
    this.log('info', 'Received updated questions', {
      eventType: 'questions:update',
      matchId: data.matchId,
      questionCount: data.count,
      changeType: data.changeType,
      timestamp: data.timestamp
    });

    if (data.questions && Array.isArray(data.questions)) {
      this.processQuestions(data.questions, 'update');
    }
  }

  /**
   * Handle match-specific questions data
   */
  handleMatchQuestionsData(data) {
    this.log('info', 'Received match questions data', {
      eventType: 'questions:match:data',
      matchId: data.matchId,
      questionCount: data.count,
      timestamp: data.timestamp
    });

    if (data.questions && Array.isArray(data.questions)) {
      this.processQuestions(data.questions, 'match');
    }
  }

  /**
   * Handle match-specific new questions
   */
  handleMatchNewQuestions(data) {
    this.log('info', 'Received match new questions', {
      eventType: 'questions:match:new',
      matchId: data.matchId,
      questionCount: data.count,
      timestamp: data.timestamp
    });

    if (data.questions && Array.isArray(data.questions)) {
      this.processQuestions(data.questions, 'match-new');
    }
  }

  /**
   * Handle match-specific updated questions
   */
  handleMatchUpdatedQuestions(data) {
    this.log('info', 'Received match updated questions', {
      eventType: 'questions:match:update',
      matchId: data.matchId,
      questionCount: data.count,
      timestamp: data.timestamp
    });

    if (data.questions && Array.isArray(data.questions)) {
      this.processQuestions(data.questions, 'match-update');
    }
  }

  /**
   * Handle answer acknowledgment
   */
  handleAnswerAcknowledgment(data) {
    this.log('info', 'Answer acknowledged by server', {
      questionId: data.questionId,
      success: data.success,
      timestamp: data.timestamp
    });
  }

  /**
   * Handle skip acknowledgment
   */
  handleSkipAcknowledgment(data) {
    this.log('info', 'Skip acknowledged by server', {
      questionId: data.questionId,
      success: data.success,
      timestamp: data.timestamp
    });
  }

  /**
   * Handle question errors
   */
  handleQuestionError(data) {
    this.log('error', 'Received question error', {
      error: data.error,
      message: data.message,
      matchId: data.matchId || 'N/A'
    });
  }

  /**
   * Handle generic events
   */
  handleGenericEvent(eventName, data) {
    const handledEvents = [
      'questions:data', 'questions:new', 'questions:update',
      'questions:match:data', 'questions:match:new', 'questions:match:update',
      'questions:answer:ack', 'questions:skip:ack', 'questions:error'
    ];

    if (handledEvents.includes(eventName)) {
      return;
    }

    this.log('info', 'Received generic event', {
      eventType: eventName,
      data: data
    });
  }

  /**
   * Process and display questions
   */
  processQuestions(questions, source = 'unknown') {
    if (!Array.isArray(questions)) {
      return;
    }

    const filteredQuestions = this.filterQuestions(questions);
    const displayedCount = this.displayQuestions(filteredQuestions, source);
    
    // Update statistics
    this.stats.questionsReceived += questions.length;
    this.stats.questionsDisplayed += displayedCount;
    this.stats.questionsFiltered += (questions.length - displayedCount);
    
    // Update confidence statistics
    questions.forEach(question => {
      if (question.confidence || question.predictionWeight) {
        const confidence = question.confidence || question.predictionWeight || 0;
        this.stats.totalConfidence += confidence;
        this.stats.averageConfidence = this.stats.totalConfidence / this.stats.questionsReceived;
      }
      
      // Track categories and difficulties
      if (question.category) {
        this.stats.categoriesSeen.add(question.category);
      }
      if (question.difficulty) {
        this.stats.difficultiesSeen.add(question.difficulty);
      }
    });

    // Store recent questions
    this.storeRecentQuestions(filteredQuestions);
    
    this.stats.lastQuestionTime = new Date().toISOString();
  }

  /**
   * Filter questions based on current filters
   */
  filterQuestions(questions) {
    return questions.filter(question => {
      // Match ID filter
      if (this.filters.matchId && question.matchId !== this.filters.matchId) {
        return false;
      }
      
      // Confidence filter
      const confidence = question.confidence || question.predictionWeight || 0;
      if (confidence < this.filters.minConfidence) {
        return false;
      }
      
      // Category filter
      if (this.filters.category && question.category !== this.filters.category) {
        return false;
      }
      
      // Difficulty filter
      if (this.filters.difficulty && question.difficulty !== this.filters.difficulty) {
        return false;
      }
      
      // ML Enhanced filter
      if (this.filters.mlEnhanced !== null && question.mlEnhanced !== this.filters.mlEnhanced) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Display questions based on display mode
   */
  displayQuestions(questions, source) {
    if (questions.length === 0) {
      return 0;
    }

    this.log('info', `Displaying ${questions.length} questions from ${source}`, {
      source,
      questionCount: questions.length,
      filters: this.filters
    });

    questions.forEach((question, index) => {
      const questionData = {
        index: index + 1,
        questionId: question.questionId || question.id,
        matchId: question.matchId,
        question: question.question || question.text,
        category: question.category,
        difficulty: question.difficulty,
        confidence: question.confidence || question.predictionWeight || 0,
        eventType: question.eventType,
        predictedEvent: question.predictedEvent,
        timestamp: question.timestamp,
        mlEnhanced: question.mlEnhanced,
        metadata: question.metadata
      };

      if (this.displayMode === 'json') {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'QUESTION',
          source: source,
          data: questionData
        }, null, 2));
      } else if (this.displayMode === 'table') {
        console.table(questionData);
      } else {
        console.log(`\n--- Question ${index + 1} ---`);
        console.log(`ID: ${questionData.questionId}`);
        console.log(`Match: ${questionData.matchId}`);
        console.log(`Question: ${questionData.question}`);
        console.log(`Category: ${questionData.category}`);
        console.log(`Difficulty: ${questionData.difficulty}`);
        console.log(`Confidence: ${(questionData.confidence * 100).toFixed(1)}%`);
        console.log(`Event Type: ${questionData.eventType}`);
        console.log(`Predicted Event: ${questionData.predictedEvent}`);
        console.log(`ML Enhanced: ${questionData.mlEnhanced ? 'Yes' : 'No'}`);
        console.log(`Timestamp: ${questionData.timestamp}`);
        if (questionData.metadata) {
          console.log(`Metadata: ${JSON.stringify(questionData.metadata, null, 2)}`);
        }
      }
    });

    return questions.length;
  }

  /**
   * Store recent questions for history
   */
  storeRecentQuestions(questions) {
    questions.forEach(question => {
      this.recentQuestions.unshift({
        ...question,
        receivedAt: new Date().toISOString()
      });
    });

    // Keep only the most recent questions
    if (this.recentQuestions.length > this.maxRecentQuestions) {
      this.recentQuestions = this.recentQuestions.slice(0, this.maxRecentQuestions);
    }
  }

  /**
   * Subscribe to questions for a specific match
   */
  subscribeToMatch(matchId) {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot subscribe to match: not connected to server');
      return false;
    }

    this.socket.emit('questions:subscribe', { matchId });
    this.subscribedMatches.add(matchId);
    this.stats.matchesTracked = this.subscribedMatches.size;
    
    this.log('info', 'Subscribed to match questions', {
      matchId,
      subscribedMatches: Array.from(this.subscribedMatches)
    });

    return true;
  }

  /**
   * Unsubscribe from questions for a specific match
   */
  unsubscribeFromMatch(matchId) {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot unsubscribe from match: not connected to server');
      return false;
    }

    this.socket.emit('questions:unsubscribe', { matchId });
    this.subscribedMatches.delete(matchId);
    this.stats.matchesTracked = this.subscribedMatches.size;
    
    this.log('info', 'Unsubscribed from match questions', {
      matchId,
      subscribedMatches: Array.from(this.subscribedMatches)
    });

    return true;
  }

  /**
   * Request questions for a specific match
   */
  requestQuestionsForMatch(matchId, limit = 50) {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot request questions: not connected to server');
      return false;
    }

    this.socket.emit('questions:request', { matchId, limit });
    
    this.log('info', 'Requested questions for match', {
      matchId,
      limit
    });

    return true;
  }

  /**
   * Answer a question
   */
  answerQuestion(questionId, answer, confidence = 0.8) {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot answer question: not connected to server');
      return false;
    }

    this.socket.emit('questions:answer', { questionId, answer, confidence });
    
    this.log('info', 'Answered question', {
      questionId,
      answer,
      confidence
    });

    return true;
  }

  /**
   * Skip a question
   */
  skipQuestion(questionId, reason = 'User skipped') {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot skip question: not connected to server');
      return false;
    }

    this.socket.emit('questions:skip', { questionId, reason });
    
    this.log('info', 'Skipped question', {
      questionId,
      reason
    });

    return true;
  }

  /**
   * View a question (record interaction)
   */
  viewQuestion(questionId) {
    if (!this.socket || !this.isConnected) {
      this.log('warn', 'Cannot view question: not connected to server');
      return false;
    }

    this.socket.emit('questions:view', { questionId });
    
    this.log('info', 'Viewed question', {
      questionId
    });

    return true;
  }

  /**
   * Set filters
   */
  setFilters(filters) {
    this.filters = { ...this.filters, ...filters };
    
    this.log('info', 'Updated filters', {
      filters: this.filters
    });
  }

  /**
   * Fetch questions via REST API
   */
  async fetchQuestionsViaAPI(options = {}) {
    try {
      const {
        matchId = null,
        limit = 50,
        category = null,
        difficulty = null,
        mlEnhanced = true
      } = options;

      let url = `${this.serverUrl}/api/questions/questions/active`;
      const params = new URLSearchParams();
      
      if (limit) params.append('limit', limit);
      if (category) params.append('category', category);
      if (difficulty) params.append('difficulty', difficulty);

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data.success) {
        const questions = response.data.data.questions;
        
        // Filter by matchId if specified
        const filteredQuestions = matchId ? 
          questions.filter(q => q.matchId === matchId) : 
          questions;

        this.log('info', 'Fetched questions via REST API', {
          totalQuestions: questions.length,
          filteredQuestions: filteredQuestions.length,
          matchId,
          filters: { category, difficulty, mlEnhanced }
        });

        this.processQuestions(filteredQuestions, 'api');
        return filteredQuestions;
      } else {
        throw new Error(response.data.error || 'Failed to fetch questions');
      }
    } catch (error) {
      this.log('error', 'Failed to fetch questions via REST API', {
        error: error.message,
        url: error.config?.url
      });
      return [];
    }
  }

  /**
   * Start REST API polling
   */
  startAPIPolling(interval = null) {
    const pollInterval = interval || this.refreshInterval;
    
    this.log('info', 'Starting REST API polling', {
      interval: pollInterval
    });

    // Initial fetch
    this.fetchQuestionsViaAPI();

    // Set up interval
    this.apiPollingInterval = setInterval(() => {
      this.fetchQuestionsViaAPI();
    }, pollInterval);
  }

  /**
   * Stop REST API polling
   */
  stopAPIPolling() {
    if (this.apiPollingInterval) {
      clearInterval(this.apiPollingInterval);
      this.apiPollingInterval = null;
      
      this.log('info', 'Stopped REST API polling');
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      ...this.stats,
      isConnected: this.isConnected,
      socketId: this.socket?.id || null,
      subscribedMatches: Array.from(this.subscribedMatches),
      recentQuestionsCount: this.recentQuestions.length,
      categoriesSeen: Array.from(this.stats.categoriesSeen),
      difficultiesSeen: Array.from(this.stats.difficultiesSeen),
      filters: this.filters,
      uptimeSeconds: this.stats.connectionTime ? 
        Math.floor((Date.now() - new Date(this.stats.connectionTime).getTime()) / 1000) : 0
    };
  }

  /**
   * Get recent questions
   */
  getRecentQuestions(limit = 20) {
    return this.recentQuestions.slice(0, limit);
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopAPIPolling();
    this.autoReconnect = false;

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
module.exports = QuestionStreamingClient;

// If running directly, start the client
if (require.main === module) {
  const client = new QuestionStreamingClient({
    serverUrl: process.env.SERVER_URL || 'http://localhost:5000',
    displayMode: process.env.DISPLAY_MODE || 'console',
    logToFile: process.env.LOG_TO_FILE === 'true',
    logFilePath: process.env.LOG_FILE_PATH || './question-client.log',
    refreshInterval: parseInt(process.env.REFRESH_INTERVAL) || 30000
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
      // Connect to Socket.IO
      await client.connect();
      
      // Set up filters if provided via environment variables
      const filters = {};
      if (process.env.FILTER_MATCH_ID) filters.matchId = process.env.FILTER_MATCH_ID;
      if (process.env.FILTER_MIN_CONFIDENCE) filters.minConfidence = parseFloat(process.env.FILTER_MIN_CONFIDENCE);
      if (process.env.FILTER_CATEGORY) filters.category = process.env.FILTER_CATEGORY;
      if (process.env.FILTER_DIFFICULTY) filters.difficulty = process.env.FILTER_DIFFICULTY;
      if (process.env.FILTER_ML_ENHANCED !== undefined) filters.mlEnhanced = process.env.FILTER_ML_ENHANCED === 'true';
      
      if (Object.keys(filters).length > 0) {
        client.setFilters(filters);
      }
      
      // Subscribe to specific match if provided
      if (process.env.SUBSCRIBE_MATCH_ID) {
        client.subscribeToMatch(process.env.SUBSCRIBE_MATCH_ID);
        client.requestQuestionsForMatch(process.env.SUBSCRIBE_MATCH_ID);
      }
      
      // Start REST API polling
      client.startAPIPolling();
      
      // Log statistics every 60 seconds
      setInterval(() => {
        const stats = client.getStats();
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'STATS',
          message: 'Client statistics',
          data: stats
        }, null, 2));
      }, 60000);

    } catch (error) {
      console.error('Failed to start client:', error.message);
      process.exit(1);
    }
  })();
}
