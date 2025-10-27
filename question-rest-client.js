'use strict';

/**
 * REST API Client for Sanjib Agent Question Service
 * 
 * Features:
 * - Fetches questions via REST API endpoints
 * - Real-time polling with configurable intervals
 * - Filtering by match ID, confidence, category, difficulty
 * - Question statistics and analytics
 * - Answer submission and question interaction
 * - Structured JSON output for better readability
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class QuestionRESTClient {
  constructor(options = {}) {
    // Configuration
    this.serverUrl = options.serverUrl || 'http://localhost:3000';
    this.pollInterval = options.pollInterval || 30000; // 30 seconds
    this.logToFile = options.logToFile || false;
    this.logFilePath = options.logFilePath || './question-rest-client.log';
    this.displayMode = options.displayMode || 'console'; // 'console', 'json', 'table'
    this.timeout = options.timeout || 10000;
    
    // Filtering options
    this.filters = {
      matchId: null,
      minConfidence: 0,
      category: null,
      difficulty: null,
      mlEnhanced: true,
      limit: 50
    };
    
    // Statistics
    this.stats = {
      requestsMade: 0,
      requestsSuccessful: 0,
      requestsFailed: 0,
      questionsReceived: 0,
      questionsDisplayed: 0,
      questionsFiltered: 0,
      averageConfidence: 0,
      totalConfidence: 0,
      startTime: new Date().toISOString(),
      lastRequestTime: null,
      lastQuestionTime: null,
      matchesTracked: new Set(),
      categoriesSeen: new Set(),
      difficultiesSeen: new Set(),
      averageResponseTime: 0,
      totalResponseTime: 0
    };
    
    // Question storage
    this.recentQuestions = [];
    this.maxRecentQuestions = 200;
    this.questionHistory = new Map(); // Track question changes over time
    
    // Polling state
    this.isPolling = false;
    this.pollingInterval = null;
    
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
   * Make HTTP request with error handling and statistics
   */
  async makeRequest(url, options = {}) {
    const startTime = Date.now();
    this.stats.requestsMade++;
    
    try {
      const response = await axios({
        url,
        timeout: this.timeout,
        ...options
      });
      
      const responseTime = Date.now() - startTime;
      this.stats.requestsSuccessful++;
      this.stats.totalResponseTime += responseTime;
      this.stats.averageResponseTime = this.stats.totalResponseTime / this.stats.requestsSuccessful;
      this.stats.lastRequestTime = new Date().toISOString();
      
      return {
        success: true,
        data: response.data,
        responseTime,
        status: response.status
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.stats.requestsFailed++;
      
      this.log('error', 'HTTP request failed', {
        url,
        error: error.message,
        status: error.response?.status,
        responseTime
      });
      
      return {
        success: false,
        error: error.message,
        status: error.response?.status,
        responseTime
      };
    }
  }

  /**
   * Fetch all active questions
   */
  async fetchActiveQuestions(options = {}) {
    const {
      limit = this.filters.limit,
      category = this.filters.category,
      difficulty = this.filters.difficulty
    } = options;

    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (category) params.append('category', category);
    if (difficulty) params.append('difficulty', difficulty);

    const url = `${this.serverUrl}/api/questions/questions/active${params.toString() ? `?${params.toString()}` : ''}`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const questions = result.data.data.questions;
      
      this.log('info', 'Fetched active questions', {
        totalQuestions: questions.length,
        responseTime: result.responseTime,
        filters: { limit, category, difficulty }
      });

      this.processQuestions(questions, 'active');
      return questions;
    } else {
      this.log('error', 'Failed to fetch active questions', {
        error: result.error || result.data?.error,
        status: result.status
      });
      return [];
    }
  }

  /**
   * Fetch questions for a specific match
   */
  async fetchMatchQuestions(matchId, options = {}) {
    const {
      limit = this.filters.limit,
      category = this.filters.category,
      difficulty = this.filters.difficulty,
      mlEnhanced = this.filters.mlEnhanced
    } = options;

    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (category) params.append('category', category);
    if (difficulty) params.append('difficulty', difficulty);
    if (mlEnhanced !== null) params.append('mlEnhanced', mlEnhanced);

    const url = `${this.serverUrl}/api/questions/match/${matchId}/questions${params.toString() ? `?${params.toString()}` : ''}`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const questions = result.data.data.questions;
      
      this.log('info', 'Fetched match questions', {
        matchId,
        questionCount: questions.length,
        responseTime: result.responseTime,
        filters: { limit, category, difficulty, mlEnhanced }
      });

      this.processQuestions(questions, 'match');
      return questions;
    } else {
      this.log('error', 'Failed to fetch match questions', {
        matchId,
        error: result.error || result.data?.error,
        status: result.status
      });
      return [];
    }
  }

  /**
   * Get question statistics for a match
   */
  async getMatchQuestionStats(matchId) {
    const url = `${this.serverUrl}/api/questions/match/${matchId}/questions/stats`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const stats = result.data.data;
      
      this.log('info', 'Fetched match question statistics', {
        matchId,
        stats,
        responseTime: result.responseTime
      });

      return stats;
    } else {
      this.log('error', 'Failed to fetch match question statistics', {
        matchId,
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
  }

  /**
   * Get question interaction metrics
   */
  async getQuestionMetrics(questionId) {
    const url = `${this.serverUrl}/api/questions/question/${questionId}/metrics`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const metrics = result.data.data;
      
      this.log('info', 'Fetched question metrics', {
        questionId,
        metrics,
        responseTime: result.responseTime
      });

      return metrics;
    } else {
      this.log('error', 'Failed to fetch question metrics', {
        questionId,
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
  }

  /**
   * Submit answer for a question
   */
  async submitAnswer(questionId, answer, confidence = 0.8, userId = null, sessionId = null) {
    const url = `${this.serverUrl}/api/questions/question/${questionId}/answer`;
    
    const result = await this.makeRequest(url, {
      method: 'POST',
      data: {
        answer,
        confidence,
        userId,
        sessionId
      }
    });
    
    if (result.success && result.data.success) {
      this.log('info', 'Answer submitted successfully', {
        questionId,
        answer,
        confidence,
        responseTime: result.responseTime
      });

      return result.data.data;
    } else {
      this.log('error', 'Failed to submit answer', {
        questionId,
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
  }

  /**
   * Skip a question
   */
  async skipQuestion(questionId, reason = 'User skipped', userId = null, sessionId = null) {
    const url = `${this.serverUrl}/api/questions/question/${questionId}/skip`;
    
    const result = await this.makeRequest(url, {
      method: 'POST',
      data: {
        reason,
        userId,
        sessionId
      }
    });
    
    if (result.success && result.data.success) {
      this.log('info', 'Question skipped successfully', {
        questionId,
        reason,
        responseTime: result.responseTime
      });

      return result.data.data;
    } else {
      this.log('error', 'Failed to skip question', {
        questionId,
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
  }

  /**
   * Get questions by category
   */
  async getQuestionsByCategory(category, limit = 50) {
    const url = `${this.serverUrl}/api/questions/questions/category/${category}?limit=${limit}`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const questions = result.data.data.questions;
      
      this.log('info', 'Fetched questions by category', {
        category,
        questionCount: questions.length,
        responseTime: result.responseTime
      });

      this.processQuestions(questions, 'category');
      return questions;
    } else {
      this.log('error', 'Failed to fetch questions by category', {
        category,
        error: result.error || result.data?.error,
        status: result.status
      });
      return [];
    }
  }

  /**
   * Get questions by difficulty
   */
  async getQuestionsByDifficulty(difficulty, limit = 50) {
    const url = `${this.serverUrl}/api/questions/questions/difficulty/${difficulty}?limit=${limit}`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const questions = result.data.data.questions;
      
      this.log('info', 'Fetched questions by difficulty', {
        difficulty,
        questionCount: questions.length,
        responseTime: result.responseTime
      });

      this.processQuestions(questions, 'difficulty');
      return questions;
    } else {
      this.log('error', 'Failed to fetch questions by difficulty', {
        difficulty,
        error: result.error || result.data?.error,
        status: result.status
      });
      return [];
    }
  }

  /**
   * Get ML prediction service status
   */
  async getMLStatus() {
    const url = `${this.serverUrl}/api/questions/ml/status`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const mlStatus = result.data.data;
      
      this.log('info', 'Fetched ML status', {
        mlStatus,
        responseTime: result.responseTime
      });

      return mlStatus;
    } else {
      this.log('error', 'Failed to fetch ML status', {
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
  }

  /**
   * Get question generation service status
   */
  async getServiceStatus() {
    const url = `${this.serverUrl}/api/questions/service/status`;
    
    const result = await this.makeRequest(url);
    
    if (result.success && result.data.success) {
      const serviceStatus = result.data.data;
      
      this.log('info', 'Fetched service status', {
        serviceStatus,
        responseTime: result.responseTime
      });

      return serviceStatus;
    } else {
      this.log('error', 'Failed to fetch service status', {
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
  }

  /**
   * Clear questions for a match
   */
  async clearMatchQuestions(matchId) {
    const url = `${this.serverUrl}/api/questions/match/${matchId}/questions`;
    
    const result = await this.makeRequest(url, {
      method: 'DELETE'
    });
    
    if (result.success && result.data.success) {
      this.log('info', 'Cleared match questions successfully', {
        matchId,
        responseTime: result.responseTime
      });

      return result.data.data;
    } else {
      this.log('error', 'Failed to clear match questions', {
        matchId,
        error: result.error || result.data?.error,
        status: result.status
      });
      return null;
    }
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
      
      // Track categories, difficulties, and matches
      if (question.category) {
        this.stats.categoriesSeen.add(question.category);
      }
      if (question.difficulty) {
        this.stats.difficultiesSeen.add(question.difficulty);
      }
      if (question.matchId) {
        this.stats.matchesTracked.add(question.matchId);
      }
    });

    // Store recent questions and track changes
    this.storeRecentQuestions(filteredQuestions);
    this.trackQuestionChanges(filteredQuestions);
    
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
        metadata: question.metadata,
        interactionMetrics: question.interactionMetrics
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
        if (questionData.interactionMetrics) {
          console.log(`Interaction Metrics: ${JSON.stringify(questionData.interactionMetrics, null, 2)}`);
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
   * Track question changes over time
   */
  trackQuestionChanges(questions) {
    questions.forEach(question => {
      const questionId = question.questionId || question.id;
      
      if (!this.questionHistory.has(questionId)) {
        this.questionHistory.set(questionId, []);
      }
      
      this.questionHistory.get(questionId).push({
        ...question,
        timestamp: new Date().toISOString()
      });
      
      // Keep only last 10 versions of each question
      const history = this.questionHistory.get(questionId);
      if (history.length > 10) {
        this.questionHistory.set(questionId, history.slice(-10));
      }
    });
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
   * Start polling for questions
   */
  startPolling(options = {}) {
    if (this.isPolling) {
      this.log('warn', 'Polling already started');
      return;
    }

    const {
      interval = this.pollInterval,
      matchId = null,
      fetchType = 'active' // 'active', 'match', 'category', 'difficulty'
    } = options;

    this.isPolling = true;
    
    this.log('info', 'Starting question polling', {
      interval,
      matchId,
      fetchType,
      filters: this.filters
    });

    // Initial fetch
    this.performPollingFetch(fetchType, matchId);

    // Set up interval
    this.pollingInterval = setInterval(() => {
      this.performPollingFetch(fetchType, matchId);
    }, interval);
  }

  /**
   * Perform polling fetch based on type
   */
  async performPollingFetch(fetchType, matchId) {
    try {
      switch (fetchType) {
        case 'match':
          if (matchId) {
            await this.fetchMatchQuestions(matchId);
          } else {
            this.log('warn', 'Match ID required for match polling');
          }
          break;
        case 'category':
          if (this.filters.category) {
            await this.getQuestionsByCategory(this.filters.category);
          } else {
            this.log('warn', 'Category filter required for category polling');
          }
          break;
        case 'difficulty':
          if (this.filters.difficulty) {
            await this.getQuestionsByDifficulty(this.filters.difficulty);
          } else {
            this.log('warn', 'Difficulty filter required for difficulty polling');
          }
          break;
        case 'active':
        default:
          await this.fetchActiveQuestions();
          break;
      }
    } catch (error) {
      this.log('error', 'Polling fetch failed', {
        fetchType,
        matchId,
        error: error.message
      });
    }
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPolling = false;
      
      this.log('info', 'Stopped question polling');
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      ...this.stats,
      matchesTracked: Array.from(this.stats.matchesTracked),
      categoriesSeen: Array.from(this.stats.categoriesSeen),
      difficultiesSeen: Array.from(this.stats.difficultiesSeen),
      filters: this.filters,
      isPolling: this.isPolling,
      recentQuestionsCount: this.recentQuestions.length,
      questionHistorySize: this.questionHistory.size,
      uptimeSeconds: Math.floor((Date.now() - new Date(this.stats.startTime).getTime()) / 1000)
    };
  }

  /**
   * Get recent questions
   */
  getRecentQuestions(limit = 20) {
    return this.recentQuestions.slice(0, limit);
  }

  /**
   * Get question history for a specific question
   */
  getQuestionHistory(questionId) {
    return this.questionHistory.get(questionId) || [];
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.log('info', 'Initiating graceful shutdown');
    
    this.stopPolling();
    
    // Log final statistics
    this.log('info', 'Final statistics', this.getStats());
    
    this.log('info', 'Shutdown complete');
  }
}

// Export the class for use in other modules
module.exports = QuestionRESTClient;

// If running directly, start the client
if (require.main === module) {
  const client = new QuestionRESTClient({
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    displayMode: process.env.DISPLAY_MODE || 'console',
    pollInterval: parseInt(process.env.POLL_INTERVAL) || 30000,
    logToFile: process.env.LOG_TO_FILE === 'true',
    logFilePath: process.env.LOG_FILE_PATH || './question-rest-client.log'
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
      // Set up filters if provided via environment variables
      const filters = {};
      if (process.env.FILTER_MATCH_ID) filters.matchId = process.env.FILTER_MATCH_ID;
      if (process.env.FILTER_MIN_CONFIDENCE) filters.minConfidence = parseFloat(process.env.FILTER_MIN_CONFIDENCE);
      if (process.env.FILTER_CATEGORY) filters.category = process.env.FILTER_CATEGORY;
      if (process.env.FILTER_DIFFICULTY) filters.difficulty = process.env.FILTER_DIFFICULTY;
      if (process.env.FILTER_ML_ENHANCED !== undefined) filters.mlEnhanced = process.env.FILTER_ML_ENHANCED === 'true';
      if (process.env.FILTER_LIMIT) filters.limit = parseInt(process.env.FILTER_LIMIT);
      
      if (Object.keys(filters).length > 0) {
        client.setFilters(filters);
      }
      
      // Start polling based on environment variables
      const pollType = process.env.POLL_TYPE || 'active';
      const pollMatchId = process.env.POLL_MATCH_ID || null;
      
      client.startPolling({
        interval: parseInt(process.env.POLL_INTERVAL) || 30000,
        matchId: pollMatchId,
        fetchType: pollType
      });
      
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
