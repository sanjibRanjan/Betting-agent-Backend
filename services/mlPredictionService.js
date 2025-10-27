'use strict';

const axios = require('axios');
const logger = require('../utils/loggerService');

/**
 * Machine Learning Prediction Service for Cricket Events
 * Integrates with the Python ML system for real-time predictions
 */
class MLPredictionService {
  constructor(config = {}) {
    this.mlServiceUrl = config.mlServiceUrl || 'http://localhost:5001';
    this.timeout = config.timeout || 5000;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.isHealthy = false;
    this.lastHealthCheck = null;
    this.healthCheckInterval = config.healthCheckInterval || 30000; // 30 seconds
    
    // Initialize health check
    this.startHealthCheck();
  }

  /**
   * Start periodic health checks for the ML service
   */
  startHealthCheck() {
    setInterval(async () => {
      try {
        await this.checkHealth();
      } catch (error) {
        logger.warn('ML service health check failed', { error: error.message });
      }
    }, this.healthCheckInterval);
  }

  /**
   * Check if the ML service is healthy
   * @returns {Promise<boolean>} Health status
   */
  async checkHealth() {
    try {
      const response = await axios.get(`${this.mlServiceUrl}/health`, {
        timeout: this.timeout
      });

      this.isHealthy = response.status === 200;
      this.lastHealthCheck = new Date().toISOString();
      
      if (this.isHealthy) {
        logger.debug('ML service health check passed', {
          modelsLoaded: response.data.models_loaded,
          availableTargets: response.data.available_targets
        });
      }

      return this.isHealthy;
    } catch (error) {
      this.isHealthy = false;
      logger.error('ML service health check failed', {
        error: error.message,
        url: this.mlServiceUrl
      });
      return false;
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'MLPredictionService',
      isHealthy: this.isHealthy,
      mlServiceUrl: this.mlServiceUrl,
      lastHealthCheck: this.lastHealthCheck,
      status: this.isHealthy ? 'ready' : 'unhealthy',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Extract features from over data for ML prediction
   * @param {Object} overData Over-level data from OverFeatures collection
   * @returns {Object} Feature object for ML prediction
   */
  extractFeatures(overData) {
    try {
      const features = {
        // Basic over features
        overRuns: overData.overRuns || 0,
        overWickets: overData.overWickets || 0,
        overBalls: overData.overBalls || 6,
        overExtras: overData.overExtras || 0,
        overBoundaries: overData.overBoundaries || 0,
        overSixes: overData.overSixes || 0,
        
        // Cumulative match state
        totalRuns: overData.totalRuns || 0,
        totalWickets: overData.totalWickets || 0,
        totalOvers: overData.totalOvers || 0,
        runRate: overData.runRate || 0,
        requiredRunRate: overData.requiredRunRate || 0,
        
        // Over context
        overNumber: overData.overNumber || 1,
        innings: overData.innings || 1,
        teamBatting: overData.teamBatting || 'Unknown',
        teamBowling: overData.teamBowling || 'Unknown',
        
        // Momentum indicators
        'momentum.recentRunRate': overData.momentum?.recentRunRate || 0,
        'momentum.wicketsInHand': overData.momentum?.wicketsInHand || 10,
        'momentum.pressureIndex': overData.momentum?.pressureIndex || 0,
        'momentum.partnershipRuns': overData.momentum?.partnershipRuns || 0,
        'momentum.partnershipBalls': overData.momentum?.partnershipBalls || 0,
        
        // Player performance
        'batsmanStats.striker.runs': overData.batsmanStats?.striker?.runs || 0,
        'batsmanStats.striker.balls': overData.batsmanStats?.striker?.balls || 0,
        'batsmanStats.striker.strikeRate': overData.batsmanStats?.striker?.strikeRate || 0,
        'batsmanStats.nonStriker.runs': overData.batsmanStats?.nonStriker?.runs || 0,
        'batsmanStats.nonStriker.balls': overData.batsmanStats?.nonStriker?.balls || 0,
        'batsmanStats.nonStriker.strikeRate': overData.batsmanStats?.nonStriker?.strikeRate || 0,
        
        'bowlerStats.runs': overData.bowlerStats?.runs || 0,
        'bowlerStats.wickets': overData.bowlerStats?.wickets || 0,
        'bowlerStats.balls': overData.bowlerStats?.balls || 0,
        'bowlerStats.economyRate': overData.bowlerStats?.economyRate || 0,
        'bowlerStats.dotBalls': overData.bowlerStats?.dotBalls || 0,
        
        // Match context
        venue: overData.matchContext?.venue || 'Unknown',
        format: overData.matchContext?.format || 'T20',
        series: overData.matchContext?.series || 'Unknown',
        target: overData.matchContext?.target || 0,
        chase: overData.matchContext?.chase || false,
        powerplay: overData.matchContext?.powerplay || false,
        deathOvers: overData.matchContext?.deathOvers || false
      };

      return features;
    } catch (error) {
      logger.error('Error extracting features from over data', {
        error: error.message,
        overData: overData
      });
      return {};
    }
  }

  /**
   * Make a single prediction
   * @param {string} targetName Target to predict (e.g., 'wicket_occurrence')
   * @param {Object} overData Over-level data
   * @param {string} modelType Model type to use ('best' or specific model name)
   * @returns {Promise<Object>} Prediction result
   */
  async predict(targetName, overData, modelType = 'best') {
    if (!this.isHealthy) {
      logger.warn('ML service is not healthy, skipping prediction', { targetName });
      return null;
    }

    try {
      const features = this.extractFeatures(overData);
      
      const response = await axios.post(`${this.mlServiceUrl}/predict/${targetName}`, {
        features,
        model_type: modelType
      }, {
        timeout: this.timeout
      });

      logger.debug('Prediction made successfully', {
        target: targetName,
        modelType,
        prediction: response.data.prediction
      });

      return {
        success: true,
        target: targetName,
        modelType,
        prediction: response.data.prediction,
        timestamp: response.data.timestamp,
        features
      };

    } catch (error) {
      logger.error('Prediction failed', {
        target: targetName,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        target: targetName,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Make batch predictions for multiple targets
   * @param {Object} overData Over-level data
   * @param {Array} targets Array of target names
   * @param {Object} modelTypes Model types for each target
   * @returns {Promise<Object>} Batch prediction results
   */
  async predictBatch(overData, targets = ['wicket_occurrence', 'runs_per_over'], modelTypes = {}) {
    if (!this.isHealthy) {
      logger.warn('ML service is not healthy, skipping batch prediction');
      return null;
    }

    try {
      const features = this.extractFeatures(overData);
      
      const response = await axios.post(`${this.mlServiceUrl}/predict_batch`, {
        features,
        targets,
        model_types: modelTypes
      }, {
        timeout: this.timeout
      });

      logger.debug('Batch prediction made successfully', {
        targets,
        predictionsCount: Object.keys(response.data.predictions).length
      });

      return {
        success: true,
        predictions: response.data.predictions,
        timestamp: response.data.timestamp,
        features
      };

    } catch (error) {
      logger.error('Batch prediction failed', {
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get predictions for cricket events in real-time
   * @param {Object} matchData Current match data
   * @returns {Promise<Object>} Real-time predictions
   */
  async getRealTimePredictions(matchData) {
    try {
      // Extract current over data from match
      const currentOver = this.extractCurrentOverData(matchData);
      
      if (!currentOver) {
        logger.warn('No current over data available for predictions');
        return null;
      }

      // Make predictions for key cricket events
      const predictions = await this.predictBatch(currentOver, [
        'wicket_occurrence',
        'runs_per_over',
        'boundary_probability'
      ]);

      if (predictions && predictions.success) {
        // Enhance predictions with additional context
        const enhancedPredictions = {
          ...predictions,
          matchContext: {
            matchId: matchData.fixtureId,
            currentOver: currentOver.overNumber,
            innings: currentOver.innings,
            timestamp: new Date().toISOString()
          },
          recommendations: this.generateRecommendations(predictions.predictions)
        };

        logger.info('Real-time predictions generated', {
          matchId: matchData.fixtureId,
          overNumber: currentOver.overNumber,
          predictionsCount: Object.keys(predictions.predictions).length
        });

        return enhancedPredictions;
      }

      return null;

    } catch (error) {
      logger.error('Error generating real-time predictions', {
        error: error.message,
        matchId: matchData.fixtureId
      });
      return null;
    }
  }

  /**
   * Extract current over data from match data
   * @param {Object} matchData Match data object
   * @returns {Object} Current over data
   */
  extractCurrentOverData(matchData) {
    try {
      // This would extract the most recent over data from the match
      // Implementation depends on your data structure
      
      if (!matchData.ballByBall || !matchData.ballByBall.recentBalls) {
        return null;
      }

      // Get the most recent over
      const recentBalls = matchData.ballByBall.recentBalls;
      const lastBall = recentBalls[recentBalls.length - 1];
      
      if (!lastBall) {
        return null;
      }

      // Calculate over number
      const overNumber = Math.floor(lastBall.ball);
      const innings = overNumber <= 20 ? 1 : 2;

      // Create over-level features (simplified)
      const overData = {
        overNumber,
        innings,
        teamBatting: matchData.teams.home,
        teamBowling: matchData.teams.away,
        overRuns: 0, // Would need to calculate from balls
        overWickets: 0, // Would need to calculate from balls
        totalRuns: matchData.score?.runs || 0,
        totalWickets: matchData.score?.wickets || 0,
        runRate: (matchData.score?.runs || 0) / Math.max(overNumber, 1),
        matchContext: {
          venue: matchData.venue,
          format: matchData.format,
          series: matchData.series
        }
      };

      return overData;

    } catch (error) {
      logger.error('Error extracting current over data', {
        error: error.message,
        matchData: matchData
      });
      return null;
    }
  }

  /**
   * Generate recommendations based on predictions
   * @param {Object} predictions Prediction results
   * @returns {Object} Recommendations
   */
  generateRecommendations(predictions) {
    const recommendations = {
      riskLevel: 'medium',
      suggestions: [],
      confidence: 'medium'
    };

    try {
      // Analyze wicket prediction
      const wicketPred = predictions.wicket_occurrence;
      if (wicketPred && wicketPred.prediction && wicketPred.prediction.prediction > 0.7) {
        recommendations.riskLevel = 'high';
        recommendations.suggestions.push('High probability of wicket in next over');
      }

      // Analyze runs prediction
      const runsPred = predictions.runs_per_over;
      if (runsPred && runsPred.prediction && runsPred.prediction.prediction > 12) {
        recommendations.suggestions.push('Expect high scoring over');
      }

      // Analyze boundary prediction
      const boundaryPred = predictions.boundary_probability;
      if (boundaryPred && boundaryPred.prediction && boundaryPred.prediction.prediction > 0.6) {
        recommendations.suggestions.push('High boundary probability');
      }

      // Determine overall confidence
      const allConfidences = Object.values(predictions)
        .filter(p => p.prediction && p.prediction.confidence)
        .map(p => p.prediction.confidence);
      
      if (allConfidences.length > 0) {
        const avgConfidence = allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length;
        if (avgConfidence > 0.8) {
          recommendations.confidence = 'high';
        } else if (avgConfidence < 0.5) {
          recommendations.confidence = 'low';
        }
      }

    } catch (error) {
      logger.warn('Error generating recommendations', { error: error.message });
    }

    return recommendations;
  }

  /**
   * Get model information from ML service
   * @returns {Promise<Object>} Model information
   */
  async getModelInfo() {
    try {
      const response = await axios.get(`${this.mlServiceUrl}/model_info`, {
        timeout: this.timeout
      });

      return {
        success: true,
        models: response.data.models,
        timestamp: response.data.timestamp
      };

    } catch (error) {
      logger.error('Failed to get model info', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get feature importance for a model
   * @param {string} targetName Target name
   * @param {string} modelType Model type
   * @returns {Promise<Object>} Feature importance data
   */
  async getFeatureImportance(targetName, modelType = 'best') {
    try {
      const response = await axios.get(`${this.mlServiceUrl}/feature_importance/${targetName}`, {
        params: { model_type: modelType },
        timeout: this.timeout
      });

      return {
        success: true,
        target: targetName,
        modelType,
        featureImportance: response.data.feature_importance,
        timestamp: response.data.timestamp
      };

    } catch (error) {
      logger.error('Failed to get feature importance', {
        target: targetName,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = MLPredictionService;
