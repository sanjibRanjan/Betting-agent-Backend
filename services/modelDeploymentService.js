'use strict';

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/loggerService');

/**
 * Model Deployment Service for Cricket Betting Predictions
 * Handles model loading, prediction serving, and real-time inference
 */
class ModelDeploymentService {
  constructor(databaseService) {
    this.databaseService = databaseService;
    this.deployedModels = new Map();
    this.modelCache = new Map();
    this.predictionHistory = [];
    this.maxHistorySize = 1000;
    this.resultsPath = path.join(__dirname, '../ml-results');
    
    // Initialize deployment
    this.initializeDeployment();
  }

  /**
   * Initialize deployment service
   */
  async initializeDeployment() {
    try {
      logger.info('Initializing model deployment service');
      
      // Load available deployment packages
      await this.loadAvailableModels();
      
      logger.info('Model deployment service initialized', {
        availableModels: this.deployedModels.size
      });
    } catch (error) {
      logger.error('Failed to initialize model deployment service', {
        error: error.message
      });
    }
  }

  /**
   * Load available model deployment packages
   */
  async loadAvailableModels() {
    try {
      const files = await fs.readdir(this.resultsPath);
      const deploymentFiles = files.filter(file => 
        file.startsWith('deployment-package-') && file.endsWith('.json')
      );

      for (const file of deploymentFiles) {
        try {
          const filepath = path.join(this.resultsPath, file);
          const content = await fs.readFile(filepath, 'utf8');
          const deploymentPackage = JSON.parse(content);
          
          const modelKey = `${deploymentPackage.metadata.target}-${deploymentPackage.metadata.algorithm}`;
          
          // Note: In a real deployment, you'd need to reconstruct the model object
          // For now, we'll store the metadata and filepath
          this.deployedModels.set(modelKey, {
            metadata: deploymentPackage.metadata,
            filepath: filepath,
            loaded: false
          });

          logger.debug('Found deployment package', {
            modelKey,
            target: deploymentPackage.metadata.target,
            algorithm: deploymentPackage.metadata.algorithm,
            modelType: deploymentPackage.metadata.modelType
          });

        } catch (error) {
          logger.warn('Failed to load deployment package', {
            file,
            error: error.message
          });
        }
      }

      logger.info('Available models loaded', {
        count: this.deployedModels.size,
        models: Array.from(this.deployedModels.keys())
      });

    } catch (error) {
      logger.error('Failed to load available models', {
        error: error.message
      });
    }
  }

  /**
   * Deploy a specific model for real-time serving
   * @param {String} target Target variable
   * @param {String} algorithm Algorithm name
   * @returns {Promise<Object>} Deployment result
   */
  async deployModel(target, algorithm) {
    try {
      const modelKey = `${target}-${algorithm}`;
      
      if (!this.deployedModels.has(modelKey)) {
        throw new Error(`Model not found: ${modelKey}`);
      }

      const modelInfo = this.deployedModels.get(modelKey);
      
      if (modelInfo.loaded) {
        logger.info('Model already deployed', { modelKey });
        return {
          success: true,
          modelKey,
          status: 'already_deployed',
          metadata: modelInfo.metadata
        };
      }

      // Load the deployment package
      const deploymentPackage = await this.loadDeploymentPackage(modelInfo.filepath);
      
      // Initialize model cache for this deployment
      this.modelCache.set(modelKey, {
        package: deploymentPackage,
        lastUsed: new Date(),
        predictionCount: 0
      });

      // Mark as deployed
      modelInfo.loaded = true;

      logger.info('Model deployed successfully', {
        modelKey,
        target: deploymentPackage.metadata.target,
        algorithm: deploymentPackage.metadata.algorithm,
        modelType: deploymentPackage.metadata.modelType,
        version: deploymentPackage.metadata.version
      });

      return {
        success: true,
        modelKey,
        status: 'deployed',
        metadata: deploymentPackage.metadata
      };

    } catch (error) {
      logger.error('Failed to deploy model', {
        target,
        algorithm,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Load deployment package from file
   * @param {String} filepath Package file path
   * @returns {Promise<Object>} Deployment package
   */
  async loadDeploymentPackage(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const packageJson = JSON.parse(content);
      
      // Validate package structure
      if (!packageJson.metadata || !packageJson.preprocessing) {
        throw new Error('Invalid deployment package structure');
      }

      return packageJson;
    } catch (error) {
      logger.error('Failed to load deployment package', {
        filepath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Make prediction using deployed model
   * @param {String} modelKey Model identifier
   * @param {Object} featureData Raw feature data
   * @returns {Promise<Object>} Prediction result
   */
  async makePrediction(modelKey, featureData) {
    try {
      if (!this.modelCache.has(modelKey)) {
        throw new Error(`Model not deployed: ${modelKey}`);
      }

      const modelCache = this.modelCache.get(modelKey);
      const deploymentPackage = modelCache.package;

      // Extract features using the preprocessing functions
      const extractedFeatures = this.extractFeatures(featureData, deploymentPackage.metadata.featureColumns);
      
      // Make prediction (Note: In real deployment, you'd use the actual model)
      // For now, we'll simulate a prediction based on the feature values
      const prediction = this.simulatePrediction(
        extractedFeatures, 
        deploymentPackage.metadata.modelType,
        deploymentPackage.metadata.target
      );

      // Update cache statistics
      modelCache.lastUsed = new Date();
      modelCache.predictionCount++;

      // Store prediction in history
      this.addToPredictionHistory({
        modelKey,
        timestamp: new Date().toISOString(),
        input: featureData,
        features: extractedFeatures,
        prediction,
        metadata: deploymentPackage.metadata
      });

      logger.debug('Prediction made', {
        modelKey,
        prediction,
        predictionCount: modelCache.predictionCount
      });

      return {
        success: true,
        modelKey,
        prediction,
        confidence: this.calculateConfidence(prediction, deploymentPackage.metadata.modelType),
        metadata: {
          target: deploymentPackage.metadata.target,
          algorithm: deploymentPackage.metadata.algorithm,
          modelType: deploymentPackage.metadata.modelType,
          version: deploymentPackage.metadata.version,
          predictionCount: modelCache.predictionCount
        }
      };

    } catch (error) {
      logger.error('Failed to make prediction', {
        modelKey,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract features from raw data
   * @param {Object} rawData Raw feature data
   * @param {Array} featureColumns Expected feature columns
   * @returns {Object} Extracted features
   */
  extractFeatures(rawData, featureColumns) {
    const features = {};
    
    // Map raw data to expected feature structure
    const featureMapping = {
      overRuns: rawData.overRuns || 0,
      overWickets: rawData.overWickets || 0,
      overBalls: rawData.overBalls || 6,
      overExtras: rawData.overExtras || 0,
      overBoundaries: rawData.overBoundaries || 0,
      overSixes: rawData.overSixes || 0,
      totalRuns: rawData.totalRuns || 0,
      totalWickets: rawData.totalWickets || 0,
      totalOvers: rawData.totalOvers || 0,
      runRate: rawData.runRate || 0,
      requiredRunRate: rawData.requiredRunRate || 0,
      strikerRuns: rawData.batsmanStats?.striker?.runs || 0,
      strikerBalls: rawData.batsmanStats?.striker?.balls || 0,
      strikerStrikeRate: rawData.batsmanStats?.striker?.strikeRate || 0,
      nonStrikerRuns: rawData.batsmanStats?.nonStriker?.runs || 0,
      nonStrikerBalls: rawData.batsmanStats?.nonStriker?.balls || 0,
      nonStrikerStrikeRate: rawData.batsmanStats?.nonStriker?.strikeRate || 0,
      bowlerRuns: rawData.bowlerStats?.runs || 0,
      bowlerWickets: rawData.bowlerStats?.wickets || 0,
      bowlerBalls: rawData.bowlerStats?.balls || 0,
      bowlerEconomyRate: rawData.bowlerStats?.economyRate || 0,
      bowlerDotBalls: rawData.bowlerStats?.dotBalls || 0,
      recentRunRate: rawData.momentum?.recentRunRate || 0,
      wicketsInHand: rawData.momentum?.wicketsInHand || 10,
      pressureIndex: rawData.momentum?.pressureIndex || 0,
      partnershipRuns: rawData.momentum?.partnershipRuns || 0,
      partnershipBalls: rawData.momentum?.partnershipBalls || 0,
      isChase: rawData.matchContext?.chase ? 1 : 0,
      isPowerplay: rawData.matchContext?.powerplay ? 1 : 0,
      isDeathOvers: rawData.matchContext?.deathOvers ? 1 : 0,
      overNumber: rawData.overNumber || 0,
      isFirstInnings: rawData.innings === 1 ? 1 : 0,
      isSecondInnings: rawData.innings === 2 ? 1 : 0
    };

    // Extract only the features that are expected
    for (const column of featureColumns) {
      features[column] = featureMapping[column] !== undefined ? featureMapping[column] : 0;
    }

    return features;
  }

  /**
   * Simulate prediction (placeholder for actual model inference)
   * @param {Object} features Extracted features
   * @param {String} modelType Model type (classification/regression)
   * @param {String} target Target variable
   * @returns {Number} Simulated prediction
   */
  simulatePrediction(features, modelType, target) {
    // This is a simplified simulation - in real deployment, you'd use the actual trained model
    
    if (modelType === 'classification') {
      // Simulate classification prediction based on feature values
      const runRate = features.runRate || 0;
      const wicketsInHand = features.wicketsInHand || 10;
      const pressureIndex = features.pressureIndex || 0;
      
      // Simple heuristic-based simulation
      if (target === 'wicketOccurred') {
        const wicketProbability = Math.min(0.3, (10 - wicketsInHand) * 0.05 + pressureIndex * 0.1);
        return Math.random() < wicketProbability ? 1 : 0;
      } else if (target === 'boundaryScored') {
        const boundaryProbability = Math.min(0.4, runRate * 0.05);
        return Math.random() < boundaryProbability ? 1 : 0;
      } else if (target === 'sixScored') {
        const sixProbability = Math.min(0.2, runRate * 0.03);
        return Math.random() < sixProbability ? 1 : 0;
      } else {
        return Math.random() < 0.2 ? 1 : 0; // Default 20% probability
      }
    } else {
      // Simulate regression prediction
      const baseValue = features.overRuns || 0;
      const variation = (Math.random() - 0.5) * 2; // ±1 variation
      return Math.max(0, baseValue + variation);
    }
  }

  /**
   * Calculate prediction confidence
   * @param {Number} prediction Prediction value
   * @param {String} modelType Model type
   * @returns {Number} Confidence score
   */
  calculateConfidence(prediction, modelType) {
    if (modelType === 'classification') {
      // For classification, confidence is based on how extreme the prediction is
      return Math.abs(prediction - 0.5) * 2; // 0 to 1 scale
    } else {
      // For regression, confidence is based on prediction consistency
      return Math.min(1, Math.max(0, 0.8 - Math.abs(prediction) * 0.1));
    }
  }

  /**
   * Add prediction to history
   * @param {Object} predictionData Prediction data
   */
  addToPredictionHistory(predictionData) {
    this.predictionHistory.push(predictionData);
    
    // Keep only recent predictions
    if (this.predictionHistory.length > this.maxHistorySize) {
      this.predictionHistory = this.predictionHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get prediction history
   * @param {Object} filters Optional filters
   * @returns {Array} Prediction history
   */
  getPredictionHistory(filters = {}) {
    let history = [...this.predictionHistory];

    if (filters.modelKey) {
      history = history.filter(p => p.modelKey === filters.modelKey);
    }

    if (filters.startTime) {
      history = history.filter(p => new Date(p.timestamp) >= new Date(filters.startTime));
    }

    if (filters.endTime) {
      history = history.filter(p => new Date(p.timestamp) <= new Date(filters.endTime));
    }

    if (filters.limit) {
      history = history.slice(-filters.limit);
    }

    return history;
  }

  /**
   * Get deployment statistics
   * @returns {Object} Deployment statistics
   */
  getDeploymentStats() {
    const stats = {
      totalModels: this.deployedModels.size,
      deployedModels: 0,
      totalPredictions: 0,
      modelStats: {}
    };

    for (const [modelKey, modelInfo] of this.deployedModels.entries()) {
      if (modelInfo.loaded) {
        stats.deployedModels++;
      }

      const cache = this.modelCache.get(modelKey);
      if (cache) {
        stats.totalPredictions += cache.predictionCount;
        stats.modelStats[modelKey] = {
          deployed: modelInfo.loaded,
          predictionCount: cache.predictionCount,
          lastUsed: cache.lastUsed,
          metadata: modelInfo.metadata
        };
      }
    }

    return stats;
  }

  /**
   * Undeploy a model
   * @param {String} modelKey Model identifier
   * @returns {Promise<Object>} Undeployment result
   */
  async undeployModel(modelKey) {
    try {
      if (!this.deployedModels.has(modelKey)) {
        throw new Error(`Model not found: ${modelKey}`);
      }

      // Remove from cache
      this.modelCache.delete(modelKey);

      // Mark as not deployed
      const modelInfo = this.deployedModels.get(modelKey);
      modelInfo.loaded = false;

      logger.info('Model undeployed', { modelKey });

      return {
        success: true,
        modelKey,
        status: 'undeployed'
      };

    } catch (error) {
      logger.error('Failed to undeploy model', {
        modelKey,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get available models
   * @returns {Object} Available models
   */
  getAvailableModels() {
    const models = {};
    
    for (const [modelKey, modelInfo] of this.deployedModels.entries()) {
      models[modelKey] = {
        target: modelInfo.metadata.target,
        algorithm: modelInfo.metadata.algorithm,
        modelType: modelInfo.metadata.modelType,
        version: modelInfo.metadata.version,
        deployed: modelInfo.loaded,
        trainingDate: modelInfo.metadata.trainingDate
      };
    }

    return models;
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    const stats = this.getDeploymentStats();
    
    return {
      service: 'ModelDeploymentService',
      connected: !!this.databaseService?.connected,
      totalModels: stats.totalModels,
      deployedModels: stats.deployedModels,
      totalPredictions: stats.totalPredictions,
      predictionHistorySize: this.predictionHistory.length,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ModelDeploymentService;
