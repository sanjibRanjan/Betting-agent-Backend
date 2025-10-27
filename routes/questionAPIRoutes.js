'use strict';

const express = require('express');
const logger = require('../utils/loggerService');

/**
 * Question API Routes for Cricket Betting Agent
 * Provides RESTful endpoints for fetching ML-enhanced questions
 */
class QuestionAPIRoutes {
  constructor(enhancedQuestionGenerator, questionBroadcastingService) {
    this.router = express.Router();
    this.enhancedQuestionGenerator = enhancedQuestionGenerator;
    this.questionBroadcastingService = questionBroadcastingService;
    
    this.setupRoutes();
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Get questions for a specific match
    this.router.get('/match/:matchId/questions', this.getQuestionsForMatch.bind(this));
    
    // Get question statistics for a match
    this.router.get('/match/:matchId/questions/stats', this.getQuestionStats.bind(this));
    
    // Get user interaction metrics for a question
    this.router.get('/question/:questionId/metrics', this.getQuestionMetrics.bind(this));
    
    // Submit user answer for a question
    this.router.post('/question/:questionId/answer', this.submitAnswer.bind(this));
    
    // Skip a question
    this.router.post('/question/:questionId/skip', this.skipQuestion.bind(this));
    
    // Get all active questions across all matches
    this.router.get('/questions/active', this.getAllActiveQuestions.bind(this));
    
    // Get questions by category
    this.router.get('/questions/category/:category', this.getQuestionsByCategory.bind(this));
    
    // Get questions by difficulty
    this.router.get('/questions/difficulty/:difficulty', this.getQuestionsByDifficulty.bind(this));
    
    // Get ML prediction status
    this.router.get('/ml/status', this.getMLStatus.bind(this));
    
    // Get question generation service status
    this.router.get('/service/status', this.getServiceStatus.bind(this));
    
    // Clear questions for a match
    this.router.delete('/match/:matchId/questions', this.clearQuestions.bind(this));
  }

  /**
   * Get questions for a specific match
   * GET /api/questions/match/:matchId/questions
   */
  async getQuestionsForMatch(req, res) {
    try {
      const { matchId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const category = req.query.category || null;
      const difficulty = req.query.difficulty || null;
      const mlEnhanced = req.query.mlEnhanced !== 'false'; // Default to true

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      const questions = await this.enhancedQuestionGenerator.getGeneratedQuestions(matchId, limit);
      
      // Filter questions based on query parameters
      let filteredQuestions = questions;
      
      if (category) {
        filteredQuestions = filteredQuestions.filter(q => q.category === category);
      }
      
      if (difficulty) {
        filteredQuestions = filteredQuestions.filter(q => q.difficulty === difficulty);
      }
      
      if (mlEnhanced !== null) {
        filteredQuestions = filteredQuestions.filter(q => q.mlEnhanced === mlEnhanced);
      }

      // Add interaction metrics to each question
      const questionsWithMetrics = await Promise.all(
        filteredQuestions.map(async (question) => {
          const metrics = this.enhancedQuestionGenerator.getQuestionInteractionMetrics(question.questionId);
          return {
            ...question,
            interactionMetrics: metrics
          };
        })
      );

      res.json({
        success: true,
        data: {
          matchId,
          questions: questionsWithMetrics,
          count: questionsWithMetrics.length,
          filters: {
            category,
            difficulty,
            mlEnhanced,
            limit
          },
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error getting questions for match', {
        matchId: req.params.matchId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get questions for match',
        message: error.message
      });
    }
  }

  /**
   * Get question statistics for a match
   * GET /api/questions/match/:matchId/questions/stats
   */
  async getQuestionStats(req, res) {
    try {
      const { matchId } = req.params;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      const questions = await this.enhancedQuestionGenerator.getGeneratedQuestions(matchId, 1000);
      
      // Calculate statistics
      const stats = {
        matchId,
        totalQuestions: questions.length,
        mlEnhancedQuestions: questions.filter(q => q.mlEnhanced).length,
        categories: {},
        difficulties: {},
        eventTypes: {},
        averageConfidence: 0,
        averagePredictionWeight: 0,
        timestamp: new Date().toISOString()
      };

      let totalConfidence = 0;
      let totalPredictionWeight = 0;
      let confidenceCount = 0;
      let weightCount = 0;

      questions.forEach(question => {
        // Count by category
        stats.categories[question.category] = (stats.categories[question.category] || 0) + 1;
        
        // Count by difficulty
        stats.difficulties[question.difficulty] = (stats.difficulties[question.difficulty] || 0) + 1;
        
        // Count by event type
        stats.eventTypes[question.eventType] = (stats.eventTypes[question.eventType] || 0) + 1;
        
        // Calculate average confidence and prediction weight
        if (question.metadata && question.metadata.mlPredictions) {
          confidenceCount++;
          totalConfidence += 0.7; // Placeholder - would extract from ML predictions
        }
        
        if (question.predictionWeight) {
          weightCount++;
          totalPredictionWeight += question.predictionWeight;
        }
      });

      if (confidenceCount > 0) {
        stats.averageConfidence = Math.round((totalConfidence / confidenceCount) * 100) / 100;
      }
      
      if (weightCount > 0) {
        stats.averagePredictionWeight = Math.round((totalPredictionWeight / weightCount) * 100) / 100;
      }

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Error getting question stats', {
        matchId: req.params.matchId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get question statistics',
        message: error.message
      });
    }
  }

  /**
   * Get user interaction metrics for a question
   * GET /api/questions/question/:questionId/metrics
   */
  async getQuestionMetrics(req, res) {
    try {
      const { questionId } = req.params;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      const metrics = this.enhancedQuestionGenerator.getQuestionInteractionMetrics(questionId);

      res.json({
        success: true,
        data: metrics
      });

    } catch (error) {
      logger.error('Error getting question metrics', {
        questionId: req.params.questionId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get question metrics',
        message: error.message
      });
    }
  }

  /**
   * Submit user answer for a question
   * POST /api/questions/question/:questionId/answer
   */
  async submitAnswer(req, res) {
    try {
      const { questionId } = req.params;
      const { answer, confidence, userId, sessionId } = req.body;

      if (!answer) {
        return res.status(400).json({
          success: false,
          error: 'Answer is required'
        });
      }

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      // Record user interaction
      this.enhancedQuestionGenerator.recordUserInteraction(questionId, 'answer', {
        answer,
        confidence,
        userId,
        sessionId,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          questionId,
          answer,
          confidence,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error submitting answer', {
        questionId: req.params.questionId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to submit answer',
        message: error.message
      });
    }
  }

  /**
   * Skip a question
   * POST /api/questions/question/:questionId/skip
   */
  async skipQuestion(req, res) {
    try {
      const { questionId } = req.params;
      const { reason, userId, sessionId } = req.body;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      // Record user interaction
      this.enhancedQuestionGenerator.recordUserInteraction(questionId, 'skip', {
        reason,
        userId,
        sessionId,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          questionId,
          reason,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error skipping question', {
        questionId: req.params.questionId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to skip question',
        message: error.message
      });
    }
  }

  /**
   * Get all active questions across all matches
   * GET /api/questions/questions/active
   */
  async getAllActiveQuestions(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const category = req.query.category || null;
      const difficulty = req.query.difficulty || null;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      // Get all active matches
      const matchKeys = await this.enhancedQuestionGenerator.redisClient.keys('questions:enhanced:*');
      const allQuestions = [];

      for (const key of matchKeys) {
        const matchId = key.replace('questions:enhanced:', '');
        const questions = await this.enhancedQuestionGenerator.getGeneratedQuestions(matchId, 50);
        allQuestions.push(...questions);
      }

      // Filter questions based on query parameters
      let filteredQuestions = allQuestions;
      
      if (category) {
        filteredQuestions = filteredQuestions.filter(q => q.category === category);
      }
      
      if (difficulty) {
        filteredQuestions = filteredQuestions.filter(q => q.difficulty === difficulty);
      }

      // Sort by timestamp (newest first) and limit
      filteredQuestions = filteredQuestions
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);

      res.json({
        success: true,
        data: {
          questions: filteredQuestions,
          count: filteredQuestions.length,
          totalMatches: matchKeys.length,
          filters: {
            category,
            difficulty,
            limit
          },
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error getting all active questions', {
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get active questions',
        message: error.message
      });
    }
  }

  /**
   * Get questions by category
   * GET /api/questions/questions/category/:category
   */
  async getQuestionsByCategory(req, res) {
    try {
      const { category } = req.params;
      const limit = parseInt(req.query.limit) || 50;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      // Get all active matches
      const matchKeys = await this.enhancedQuestionGenerator.redisClient.keys('questions:enhanced:*');
      const categoryQuestions = [];

      for (const key of matchKeys) {
        const matchId = key.replace('questions:enhanced:', '');
        const questions = await this.enhancedQuestionGenerator.getGeneratedQuestions(matchId, 100);
        const filtered = questions.filter(q => q.category === category);
        categoryQuestions.push(...filtered);
      }

      // Sort by timestamp and limit
      const sortedQuestions = categoryQuestions
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);

      res.json({
        success: true,
        data: {
          category,
          questions: sortedQuestions,
          count: sortedQuestions.length,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error getting questions by category', {
        category: req.params.category,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get questions by category',
        message: error.message
      });
    }
  }

  /**
   * Get questions by difficulty
   * GET /api/questions/questions/difficulty/:difficulty
   */
  async getQuestionsByDifficulty(req, res) {
    try {
      const { difficulty } = req.params;
      const limit = parseInt(req.query.limit) || 50;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      // Get all active matches
      const matchKeys = await this.enhancedQuestionGenerator.redisClient.keys('questions:enhanced:*');
      const difficultyQuestions = [];

      for (const key of matchKeys) {
        const matchId = key.replace('questions:enhanced:', '');
        const questions = await this.enhancedQuestionGenerator.getGeneratedQuestions(matchId, 100);
        const filtered = questions.filter(q => q.difficulty === difficulty);
        difficultyQuestions.push(...filtered);
      }

      // Sort by timestamp and limit
      const sortedQuestions = difficultyQuestions
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);

      res.json({
        success: true,
        data: {
          difficulty,
          questions: sortedQuestions,
          count: sortedQuestions.length,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error getting questions by difficulty', {
        difficulty: req.params.difficulty,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get questions by difficulty',
        message: error.message
      });
    }
  }

  /**
   * Get ML prediction service status
   * GET /api/questions/ml/status
   */
  async getMLStatus(req, res) {
    try {
      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      const mlStatus = this.enhancedQuestionGenerator.mlPredictionService.getStatus();

      res.json({
        success: true,
        data: mlStatus
      });

    } catch (error) {
      logger.error('Error getting ML status', {
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get ML status',
        message: error.message
      });
    }
  }

  /**
   * Get question generation service status
   * GET /api/questions/service/status
   */
  async getServiceStatus(req, res) {
    try {
      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      const serviceStatus = this.enhancedQuestionGenerator.getStatus();
      const broadcastingStatus = this.questionBroadcastingService ? 
        this.questionBroadcastingService.getStatus() : null;

      res.json({
        success: true,
        data: {
          questionGenerator: serviceStatus,
          broadcasting: broadcastingStatus,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error getting service status', {
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get service status',
        message: error.message
      });
    }
  }

  /**
   * Clear questions for a match
   * DELETE /api/questions/match/:matchId/questions
   */
  async clearQuestions(req, res) {
    try {
      const { matchId } = req.params;

      if (!this.enhancedQuestionGenerator) {
        return res.status(503).json({
          success: false,
          error: 'Enhanced question generator service not available'
        });
      }

      const questionsKey = `questions:enhanced:${matchId}`;
      await this.enhancedQuestionGenerator.redisClient.del(questionsKey);

      res.json({
        success: true,
        data: {
          matchId,
          message: 'Questions cleared successfully',
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error clearing questions', {
        matchId: req.params.matchId,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to clear questions',
        message: error.message
      });
    }
  }

  /**
   * Get the Express router
   * @returns {Router} Express router
   */
  getRouter() {
    return this.router;
  }
}

module.exports = QuestionAPIRoutes;
