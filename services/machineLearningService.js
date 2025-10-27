'use strict';

const { Matrix } = require('ml-matrix');
const { Parser } = require('json2csv');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/loggerService');

/**
 * Machine Learning Service for Cricket Betting Predictions
 * Handles data preprocessing, model training, evaluation, and deployment
 */
class MachineLearningService {
  constructor(databaseService) {
    this.databaseService = databaseService;
    this.models = {};
    this.featureColumns = [];
    this.targetColumns = [];
    this.trainingData = null;
    this.testData = null;
    this.modelResults = {};
    this.resultsPath = path.join(__dirname, '../ml-results');
    
    // Initialize results directory
    this.initializeResultsDirectory();
  }

  /**
   * Initialize results directory for storing model outputs
   */
  async initializeResultsDirectory() {
    try {
      await fs.mkdir(this.resultsPath, { recursive: true });
      logger.info('ML results directory initialized', { path: this.resultsPath });
    } catch (error) {
      logger.error('Failed to initialize ML results directory', { error: error.message });
    }
  }

  /**
   * Load and preprocess feature datasets from OverFeatures collection
   * @param {Object} options Processing options
   * @returns {Promise<Object>} Processing results
   */
  async loadAndPreprocessData(options = {}) {
    try {
      logger.info('Starting data loading and preprocessing', { options });

      const {
        matchIds = null,
        limit = 1000,
        minOvers = 5,
        includeIncomplete = false
      } = options;

      // Build query for OverFeatures collection
      let query = {};
      
      if (matchIds && matchIds.length > 0) {
        query.matchId = { $in: matchIds };
      }

      if (!includeIncomplete) {
        query['dataQuality.complete'] = true;
      }

      // Get feature data from MongoDB
      const features = await this.databaseService.db.collection('overfeatures')
        .find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      if (!features || features.length === 0) {
        throw new Error('No feature data found in OverFeatures collection');
      }

      logger.info('Raw features loaded', { 
        count: features.length,
        sampleMatchIds: [...new Set(features.slice(0, 10).map(f => f.matchId))]
      });

      // Preprocess features
      const processedData = await this.preprocessFeatures(features, { minOvers });
      
      // Split into training and test sets
      const { trainData, testData, featureColumns, targetColumns } = this.createTrainTestSplit(
        processedData, 
        { testSize: 0.2, randomSeed: 42 }
      );

      this.trainingData = trainData;
      this.testData = testData;
      this.featureColumns = featureColumns;
      this.targetColumns = targetColumns;

      logger.info('Data preprocessing completed', {
        totalSamples: processedData.length,
        trainingSamples: trainData.X.rows,
        testSamples: testData.X.rows,
        featureCount: featureColumns.length,
        targetCount: targetColumns.length,
        featureColumns: featureColumns.slice(0, 10), // Log first 10 features
        targetColumns
      });

      return {
        success: true,
        totalSamples: processedData.length,
        trainingSamples: trainData.X.rows,
        testSamples: testData.X.rows,
        featureColumns,
        targetColumns,
        dataQuality: this.assessDataQuality(processedData)
      };

    } catch (error) {
      logger.error('Failed to load and preprocess data', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Preprocess raw feature data
   * @param {Array} features Raw feature data
   * @param {Object} options Preprocessing options
   * @returns {Array} Processed feature data
   */
  async preprocessFeatures(features, options = {}) {
    const { minOvers = 5 } = options;
    const processedData = [];

    for (const feature of features) {
      try {
        // Skip incomplete or invalid data
        if (!this.isValidFeature(feature, minOvers)) {
          continue;
        }

        // Extract and clean features
        const processedFeature = this.extractFeatures(feature);
        
        // Calculate target variables
        const targets = this.calculateTargets(feature);
        
        processedData.push({
          ...processedFeature,
          ...targets,
          matchId: feature.matchId,
          innings: feature.innings,
          overNumber: feature.overNumber,
          timestamp: feature.timestamp
        });

      } catch (error) {
        logger.warn('Error processing feature', {
          matchId: feature.matchId,
          overNumber: feature.overNumber,
          error: error.message
        });
      }
    }

    logger.info('Feature preprocessing completed', {
      inputFeatures: features.length,
      processedFeatures: processedData.length,
      filteredOut: features.length - processedData.length
    });

    return processedData;
  }

  /**
   * Validate if feature data is suitable for ML
   * @param {Object} feature Feature object
   * @param {Number} minOvers Minimum overs required
   * @returns {Boolean} Is valid
   */
  isValidFeature(feature, minOvers) {
    // Check basic requirements
    if (!feature.matchId || !feature.innings || feature.overNumber < minOvers) {
      return false;
    }

    // Check for required numeric fields
    const requiredFields = [
      'overRuns', 'overWickets', 'totalRuns', 'totalWickets', 
      'runRate', 'requiredRunRate'
    ];

    for (const field of requiredFields) {
      if (typeof feature[field] !== 'number' || isNaN(feature[field])) {
        return false;
      }
    }

    // Check player stats
    if (!feature.batsmanStats?.striker || !feature.bowlerStats) {
      return false;
    }

    return true;
  }

  /**
   * Extract features from raw feature data
   * @param {Object} feature Raw feature object
   * @returns {Object} Extracted features
   */
  extractFeatures(feature) {
    return {
      // Over-level features
      overRuns: feature.overRuns || 0,
      overWickets: feature.overWickets || 0,
      overBalls: feature.overBalls || 6,
      overExtras: feature.overExtras || 0,
      overBoundaries: feature.overBoundaries || 0,
      overSixes: feature.overSixes || 0,
      
      // Cumulative match state
      totalRuns: feature.totalRuns || 0,
      totalWickets: feature.totalWickets || 0,
      totalOvers: feature.totalOvers || 0,
      runRate: feature.runRate || 0,
      requiredRunRate: feature.requiredRunRate || 0,
      
      // Batsman performance
      strikerRuns: feature.batsmanStats?.striker?.runs || 0,
      strikerBalls: feature.batsmanStats?.striker?.balls || 0,
      strikerStrikeRate: feature.batsmanStats?.striker?.strikeRate || 0,
      nonStrikerRuns: feature.batsmanStats?.nonStriker?.runs || 0,
      nonStrikerBalls: feature.batsmanStats?.nonStriker?.balls || 0,
      nonStrikerStrikeRate: feature.batsmanStats?.nonStriker?.strikeRate || 0,
      
      // Bowler performance
      bowlerRuns: feature.bowlerStats?.runs || 0,
      bowlerWickets: feature.bowlerStats?.wickets || 0,
      bowlerBalls: feature.bowlerStats?.balls || 0,
      bowlerEconomyRate: feature.bowlerStats?.economyRate || 0,
      bowlerDotBalls: feature.bowlerStats?.dotBalls || 0,
      
      // Momentum indicators
      recentRunRate: feature.momentum?.recentRunRate || 0,
      wicketsInHand: feature.momentum?.wicketsInHand || 10,
      pressureIndex: feature.momentum?.pressureIndex || 0,
      partnershipRuns: feature.momentum?.partnershipRuns || 0,
      partnershipBalls: feature.momentum?.partnershipBalls || 0,
      
      // Match context (encoded)
      isChase: feature.matchContext?.chase ? 1 : 0,
      isPowerplay: feature.matchContext?.powerplay ? 1 : 0,
      isDeathOvers: feature.matchContext?.deathOvers ? 1 : 0,
      
      // Over position features
      overNumber: feature.overNumber,
      isFirstInnings: feature.innings === 1 ? 1 : 0,
      isSecondInnings: feature.innings === 2 ? 1 : 0
    };
  }

  /**
   * Calculate target variables for prediction
   * @param {Object} feature Feature object
   * @returns {Object} Target variables
   */
  calculateTargets(feature) {
    return {
      // Classification targets
      wicketOccurred: feature.overWickets > 0 ? 1 : 0,
      boundaryScored: feature.overBoundaries > 0 ? 1 : 0,
      sixScored: feature.overSixes > 0 ? 1 : 0,
      highRunOver: feature.overRuns >= 10 ? 1 : 0,
      maidenOver: feature.overRuns === 0 ? 1 : 0,
      
      // Regression targets
      runsScored: feature.overRuns,
      wicketsTaken: feature.overWickets,
      totalBoundaries: feature.overBoundaries,
      totalSixes: feature.overSixes
    };
  }

  /**
   * Create train-test split
   * @param {Array} data Processed feature data
   * @param {Object} options Split options
   * @returns {Object} Train and test datasets
   */
  createTrainTestSplit(data, options = {}) {
    const { testSize = 0.2, randomSeed = 42 } = options;
    
    // Shuffle data with seed for reproducibility
    const shuffledData = this.shuffleArray([...data], randomSeed);
    
    const testCount = Math.floor(shuffledData.length * testSize);
    const trainData = shuffledData.slice(testCount);
    const testData = shuffledData.slice(0, testCount);
    
    // Extract feature and target columns
    const featureColumns = Object.keys(trainData[0]).filter(key => 
      !['matchId', 'innings', 'overNumber', 'timestamp'].includes(key) &&
      !this.targetColumns.includes(key)
    );
    
    const targetColumns = [
      'wicketOccurred', 'boundaryScored', 'sixScored', 'highRunOver', 'maidenOver',
      'runsScored', 'wicketsTaken', 'totalBoundaries', 'totalSixes'
    ];
    
    // Convert to matrices
    const trainX = this.createFeatureMatrix(trainData, featureColumns);
    const trainY = this.createTargetMatrix(trainData, targetColumns);
    const testX = this.createFeatureMatrix(testData, featureColumns);
    const testY = this.createTargetMatrix(testData, targetColumns);
    
    return {
      trainData: { X: trainX, y: trainY },
      testData: { X: testX, y: testY },
      featureColumns,
      targetColumns
    };
  }

  /**
   * Create feature matrix from data
   * @param {Array} data Feature data
   * @param {Array} columns Feature columns
   * @returns {Matrix} Feature matrix
   */
  createFeatureMatrix(data, columns) {
    const matrix = data.map(row => 
      columns.map(col => {
        const value = row[col];
        return typeof value === 'number' && !isNaN(value) ? value : 0;
      })
    );
    
    return new Matrix(matrix);
  }

  /**
   * Create target matrix from data
   * @param {Array} data Feature data
   * @param {Array} columns Target columns
   * @returns {Matrix} Target matrix
   */
  createTargetMatrix(data, columns) {
    const matrix = data.map(row => 
      columns.map(col => {
        const value = row[col];
        return typeof value === 'number' && !isNaN(value) ? value : 0;
      })
    );
    
    return new Matrix(matrix);
  }

  /**
   * Assess data quality
   * @param {Array} data Processed data
   * @returns {Object} Data quality metrics
   */
  assessDataQuality(data) {
    if (!data || data.length === 0) {
      return { quality: 'poor', issues: ['No data available'] };
    }

    const issues = [];
    let quality = 'good';

    // Check for missing values
    const sample = data[0];
    const numericFields = Object.keys(sample).filter(key => 
      typeof sample[key] === 'number'
    );

    let missingValues = 0;
    for (const record of data) {
      for (const field of numericFields) {
        if (isNaN(record[field]) || record[field] === null) {
          missingValues++;
        }
      }
    }

    const missingPercentage = (missingValues / (data.length * numericFields.length)) * 100;
    if (missingPercentage > 5) {
      issues.push(`High missing values: ${missingPercentage.toFixed(2)}%`);
      quality = 'poor';
    } else if (missingPercentage > 1) {
      issues.push(`Moderate missing values: ${missingPercentage.toFixed(2)}%`);
      quality = 'fair';
    }

    // Check for class imbalance in classification targets
    const classificationTargets = ['wicketOccurred', 'boundaryScored', 'sixScored'];
    for (const target of classificationTargets) {
      const positiveCount = data.filter(record => record[target] === 1).length;
      const positivePercentage = (positiveCount / data.length) * 100;
      
      if (positivePercentage < 5 || positivePercentage > 95) {
        issues.push(`Class imbalance in ${target}: ${positivePercentage.toFixed(2)}% positive`);
        quality = quality === 'good' ? 'fair' : quality;
      }
    }

    return {
      quality,
      issues,
      totalSamples: data.length,
      missingPercentage: missingPercentage.toFixed(2),
      featureCount: numericFields.length
    };
  }

  /**
   * Train multiple machine learning models
   * @param {Object} options Training options
   * @returns {Promise<Object>} Training results
   */
  async trainModels(options = {}) {
    try {
      if (!this.trainingData || !this.testData) {
        throw new Error('Training data not available. Please load and preprocess data first.');
      }

      logger.info('Starting model training', { 
        trainingSamples: this.trainingData.X.rows,
        testSamples: this.testData.X.rows,
        features: this.featureColumns.length
      });

      const results = {};

      // Train classification models
      const classificationResults = await this.trainClassificationModels(options);
      results.classification = classificationResults;

      // Train regression models
      const regressionResults = await this.trainRegressionModels(options);
      results.regression = regressionResults;

      this.modelResults = results;

      // Save results
      await this.saveTrainingResults(results);

      logger.info('Model training completed', {
        classificationModels: Object.keys(classificationResults).length,
        regressionModels: Object.keys(regressionResults).length
      });

      return {
        success: true,
        results,
        summary: this.generateTrainingSummary(results)
      };

    } catch (error) {
      logger.error('Failed to train models', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Train classification models
   * @param {Object} options Training options
   * @returns {Promise<Object>} Classification results
   */
  async trainClassificationModels(options = {}) {
    const results = {};
    const classificationTargets = ['wicketOccurred', 'boundaryScored', 'sixScored', 'highRunOver', 'maidenOver'];

    for (const target of classificationTargets) {
      logger.info(`Training classification model for ${target}`);
      
      try {
        const targetIndex = this.targetColumns.indexOf(target);
        const trainY = this.trainingData.y.getColumn(targetIndex);
        const testY = this.testData.y.getColumn(targetIndex);

        // Train Logistic Regression
        const lrModel = new LogisticRegression({ numSteps: 1000, learningRate: 0.1 });
        lrModel.train(this.trainingData.X, trainY);
        const lrPredictions = lrModel.predict(this.testData.X);
        const lrMetrics = this.evaluateClassification(testY, lrPredictions, target);

        // Train Random Forest
        const rfModel = new RandomForestClassifier({ nEstimators: 100, maxDepth: 10 });
        rfModel.train(this.trainingData.X, trainY);
        const rfPredictions = rfModel.predict(this.testData.X);
        const rfMetrics = this.evaluateClassification(testY, rfPredictions, target);

        // Train XGBoost
        const xgbModel = new XGBoostClassifier({ maxDepth: 6, nEstimators: 100 });
        xgbModel.train(this.trainingData.X, trainY);
        const xgbPredictions = xgbModel.predict(this.testData.X);
        const xgbMetrics = this.evaluateClassification(testY, xgbPredictions, target);

        results[target] = {
          logisticRegression: { model: lrModel, metrics: lrMetrics },
          randomForest: { model: rfModel, metrics: rfMetrics },
          xgboost: { model: xgbModel, metrics: xgbMetrics }
        };

        logger.info(`Classification model training completed for ${target}`, {
          logisticRegression: lrMetrics,
          randomForest: rfMetrics,
          xgboost: xgbMetrics
        });

      } catch (error) {
        logger.error(`Failed to train classification model for ${target}`, {
          error: error.message
        });
        results[target] = { error: error.message };
      }
    }

    return results;
  }

  /**
   * Train regression models
   * @param {Object} options Training options
   * @returns {Promise<Object>} Regression results
   */
  async trainRegressionModels(options = {}) {
    const results = {};
    const regressionTargets = ['runsScored', 'wicketsTaken', 'totalBoundaries', 'totalSixes'];

    for (const target of regressionTargets) {
      logger.info(`Training regression model for ${target}`);
      
      try {
        const targetIndex = this.targetColumns.indexOf(target);
        const trainY = this.trainingData.y.getColumn(targetIndex);
        const testY = this.testData.y.getColumn(targetIndex);

        // Train Random Forest Regressor
        const rfModel = new RandomForestRegressor({ nEstimators: 100, maxDepth: 10 });
        rfModel.train(this.trainingData.X, trainY);
        const rfPredictions = rfModel.predict(this.testData.X);
        const rfMetrics = this.evaluateRegression(testY, rfPredictions, target);

        // Train XGBoost Regressor
        const xgbModel = new XGBoostRegressor({ maxDepth: 6, nEstimators: 100 });
        xgbModel.train(this.trainingData.X, trainY);
        const xgbPredictions = xgbModel.predict(this.testData.X);
        const xgbMetrics = this.evaluateRegression(testY, xgbPredictions, target);

        results[target] = {
          randomForest: { model: rfModel, metrics: rfMetrics },
          xgboost: { model: xgbModel, metrics: xgbMetrics }
        };

        logger.info(`Regression model training completed for ${target}`, {
          randomForest: rfMetrics,
          xgboost: xgbMetrics
        });

      } catch (error) {
        logger.error(`Failed to train regression model for ${target}`, {
          error: error.message
        });
        results[target] = { error: error.message };
      }
    }

    return results;
  }

  /**
   * Evaluate classification model
   * @param {Array} actual Actual values
   * @param {Array} predicted Predicted values
   * @param {String} target Target name
   * @returns {Object} Evaluation metrics
   */
  evaluateClassification(actual, predicted, target) {
    const confusionMatrix = new ConfusionMatrix(actual, predicted);
    
    const accuracy = confusionMatrix.getAccuracy();
    const precision = confusionMatrix.getPrecision();
    const recall = confusionMatrix.getRecall();
    const f1Score = confusionMatrix.getF1Score();
    
    const metrics = {
      accuracy: Math.round(accuracy * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1Score: Math.round(f1Score * 1000) / 1000,
      confusionMatrix: {
        trueNegatives: confusionMatrix.getTrueNegatives(),
        truePositives: confusionMatrix.getTruePositives(),
        falseNegatives: confusionMatrix.getFalseNegatives(),
        falsePositives: confusionMatrix.getFalsePositives()
      }
    };

    logger.debug(`Classification metrics for ${target}`, metrics);
    return metrics;
  }

  /**
   * Evaluate regression model
   * @param {Array} actual Actual values
   * @param {Array} predicted Predicted values
   * @param {String} target Target name
   * @returns {Object} Evaluation metrics
   */
  evaluateRegression(actual, predicted, target) {
    const n = actual.length;
    
    // Calculate RMSE
    const mse = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0) / n;
    const rmse = Math.sqrt(mse);
    
    // Calculate MAE
    const mae = actual.reduce((sum, val, i) => sum + Math.abs(val - predicted[i]), 0) / n;
    
    // Calculate R²
    const actualMean = actual.reduce((sum, val) => sum + val, 0) / n;
    const ssTotal = actual.reduce((sum, val) => sum + Math.pow(val - actualMean, 2), 0);
    const ssResidual = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0);
    const rSquared = 1 - (ssResidual / ssTotal);
    
    const metrics = {
      rmse: Math.round(rmse * 1000) / 1000,
      mae: Math.round(mae * 1000) / 1000,
      rSquared: Math.round(rSquared * 1000) / 1000,
      meanActual: Math.round(actualMean * 1000) / 1000,
      meanPredicted: Math.round(predicted.reduce((sum, val) => sum + val, 0) / n * 1000) / 1000
    };

    logger.debug(`Regression metrics for ${target}`, metrics);
    return metrics;
  }

  /**
   * Perform hyperparameter tuning
   * @param {Object} options Tuning options
   * @returns {Promise<Object>} Tuning results
   */
  async performHyperparameterTuning(options = {}) {
    try {
      logger.info('Starting hyperparameter tuning');

      const tuningResults = {};
      const bestModels = {};

      // Hyperparameter grids
      const lrParams = [
        { learningRate: 0.01, numSteps: 1000 },
        { learningRate: 0.1, numSteps: 1000 },
        { learningRate: 0.5, numSteps: 1000 },
        { learningRate: 0.1, numSteps: 2000 }
      ];

      const rfParams = [
        { nEstimators: 50, maxDepth: 5 },
        { nEstimators: 100, maxDepth: 10 },
        { nEstimators: 200, maxDepth: 15 },
        { nEstimators: 100, maxDepth: 20 }
      ];

      const xgbParams = [
        { maxDepth: 3, nEstimators: 50 },
        { maxDepth: 6, nEstimators: 100 },
        { maxDepth: 9, nEstimators: 200 },
        { maxDepth: 6, nEstimators: 300 }
      ];

      // Tune classification models
      const classificationTargets = ['wicketOccurred', 'boundaryScored', 'sixScored'];
      
      for (const target of classificationTargets) {
        logger.info(`Tuning hyperparameters for ${target}`);
        
        const targetIndex = this.targetColumns.indexOf(target);
        const trainY = this.trainingData.y.getColumn(targetIndex);
        const testY = this.testData.y.getColumn(targetIndex);

        // Tune Logistic Regression
        let bestLRScore = 0;
        let bestLRModel = null;
        let bestLRParams = null;

        for (const params of lrParams) {
          const model = new LogisticRegression(params);
          model.train(this.trainingData.X, trainY);
          const predictions = model.predict(this.testData.X);
          const metrics = this.evaluateClassification(testY, predictions, target);
          
          if (metrics.f1Score > bestLRScore) {
            bestLRScore = metrics.f1Score;
            bestLRModel = model;
            bestLRParams = params;
          }
        }

        // Tune Random Forest
        let bestRFScore = 0;
        let bestRFModel = null;
        let bestRFParams = null;

        for (const params of rfParams) {
          const model = new RandomForestClassifier(params);
          model.train(this.trainingData.X, trainY);
          const predictions = model.predict(this.testData.X);
          const metrics = this.evaluateClassification(testY, predictions, target);
          
          if (metrics.f1Score > bestRFScore) {
            bestRFScore = metrics.f1Score;
            bestRFModel = model;
            bestRFParams = params;
          }
        }

        // Tune XGBoost
        let bestXGBScore = 0;
        let bestXGBModel = null;
        let bestXGBParams = null;

        for (const params of xgbParams) {
          const model = new XGBoostClassifier(params);
          model.train(this.trainingData.X, trainY);
          const predictions = model.predict(this.testData.X);
          const metrics = this.evaluateClassification(testY, predictions, target);
          
          if (metrics.f1Score > bestXGBScore) {
            bestXGBScore = metrics.f1Score;
            bestXGBModel = model;
            bestXGBParams = params;
          }
        }

        tuningResults[target] = {
          logisticRegression: { 
            bestParams: bestLRParams, 
            bestScore: bestLRScore,
            model: bestLRModel
          },
          randomForest: { 
            bestParams: bestRFParams, 
            bestScore: bestRFScore,
            model: bestRFModel
          },
          xgboost: { 
            bestParams: bestXGBParams, 
            bestScore: bestXGBScore,
            model: bestXGBModel
          }
        };

        // Select best overall model for this target
        const bestOverall = [
          { name: 'logisticRegression', score: bestLRScore, model: bestLRModel },
          { name: 'randomForest', score: bestRFScore, model: bestRFModel },
          { name: 'xgboost', score: bestXGBScore, model: bestXGBModel }
        ].reduce((best, current) => current.score > best.score ? current : best);

        bestModels[target] = {
          algorithm: bestOverall.name,
          model: bestOverall.model,
          score: bestOverall.score
        };

        logger.info(`Hyperparameter tuning completed for ${target}`, {
          bestAlgorithm: bestOverall.name,
          bestScore: bestOverall.score,
          bestParams: tuningResults[target][bestOverall.name].bestParams
        });
      }

      // Save tuning results
      await this.saveTuningResults(tuningResults, bestModels);

      return {
        success: true,
        tuningResults,
        bestModels,
        summary: this.generateTuningSummary(tuningResults, bestModels)
      };

    } catch (error) {
      logger.error('Failed to perform hyperparameter tuning', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate training summary
   * @param {Object} results Training results
   * @returns {Object} Summary
   */
  generateTrainingSummary(results) {
    const summary = {
      totalModels: 0,
      bestModels: {},
      averagePerformance: {}
    };

    // Process classification results
    if (results.classification) {
      for (const [target, models] of Object.entries(results.classification)) {
        if (models.error) continue;
        
        summary.totalModels += Object.keys(models).length;
        
        // Find best model for this target
        const modelScores = Object.entries(models).map(([algorithm, result]) => ({
          algorithm,
          f1Score: result.metrics.f1Score
        }));
        
        const bestModel = modelScores.reduce((best, current) => 
          current.f1Score > best.f1Score ? current : best
        );
        
        summary.bestModels[target] = {
          algorithm: bestModel.algorithm,
          f1Score: bestModel.f1Score
        };
      }
    }

    // Process regression results
    if (results.regression) {
      for (const [target, models] of Object.entries(results.regression)) {
        if (models.error) continue;
        
        summary.totalModels += Object.keys(models).length;
        
        // Find best model for this target
        const modelScores = Object.entries(models).map(([algorithm, result]) => ({
          algorithm,
          rSquared: result.metrics.rSquared
        }));
        
        const bestModel = modelScores.reduce((best, current) => 
          current.rSquared > best.rSquared ? current : best
        );
        
        summary.bestModels[target] = {
          algorithm: bestModel.algorithm,
          rSquared: bestModel.rSquared
        };
      }
    }

    return summary;
  }

  /**
   * Generate tuning summary
   * @param {Object} tuningResults Tuning results
   * @param {Object} bestModels Best models
   * @returns {Object} Summary
   */
  generateTuningSummary(tuningResults, bestModels) {
    const summary = {
      tunedTargets: Object.keys(tuningResults).length,
      bestModels: {},
      improvements: {}
    };

    for (const [target, bestModel] of Object.entries(bestModels)) {
      summary.bestModels[target] = {
        algorithm: bestModel.algorithm,
        score: bestModel.score
      };
    }

    return summary;
  }

  /**
   * Shuffle array with seed
   * @param {Array} array Array to shuffle
   * @param {Number} seed Random seed
   * @returns {Array} Shuffled array
   */
  shuffleArray(array, seed = 42) {
    const shuffled = [...array];
    let currentIndex = shuffled.length;
    let randomIndex;

    // Simple seeded random number generator
    let random = seed;
    const seededRandom = () => {
      random = (random * 9301 + 49297) % 233280;
      return random / 233280;
    };

    while (currentIndex !== 0) {
      randomIndex = Math.floor(seededRandom() * currentIndex);
      currentIndex--;
      [shuffled[currentIndex], shuffled[randomIndex]] = [
        shuffled[randomIndex], shuffled[currentIndex]
      ];
    }

    return shuffled;
  }

  /**
   * Save training results to file
   * @param {Object} results Training results
   */
  async saveTrainingResults(results) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `training-results-${timestamp}.json`;
      const filepath = path.join(this.resultsPath, filename);
      
      await fs.writeFile(filepath, JSON.stringify(results, null, 2));
      
      logger.info('Training results saved', { filepath });
    } catch (error) {
      logger.error('Failed to save training results', { error: error.message });
    }
  }

  /**
   * Save tuning results to file
   * @param {Object} tuningResults Tuning results
   * @param {Object} bestModels Best models
   */
  async saveTuningResults(tuningResults, bestModels) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `tuning-results-${timestamp}.json`;
      const filepath = path.join(this.resultsPath, filename);
      
      const results = {
        tuningResults,
        bestModels,
        timestamp: new Date().toISOString()
      };
      
      await fs.writeFile(filepath, JSON.stringify(results, null, 2));
      
      logger.info('Tuning results saved', { filepath });
    } catch (error) {
      logger.error('Failed to save tuning results', { error: error.message });
    }
  }

  /**
   * Generate comprehensive model comparison report
   * @returns {Promise<Object>} Comparison report
   */
  async generateModelComparisonReport() {
    try {
      if (!this.modelResults || Object.keys(this.modelResults).length === 0) {
        throw new Error('No model results available. Please train models first.');
      }

      logger.info('Generating model comparison report');

      const report = {
        timestamp: new Date().toISOString(),
        dataSummary: {
          trainingSamples: this.trainingData?.X.rows || 0,
          testSamples: this.testData?.X.rows || 0,
          features: this.featureColumns?.length || 0,
          targets: this.targetColumns?.length || 0
        },
        modelComparison: {},
        bestModels: {},
        recommendations: []
      };

      // Compare classification models
      if (this.modelResults.classification) {
        for (const [target, models] of Object.entries(this.modelResults.classification)) {
          if (models.error) continue;

          report.modelComparison[target] = {
            type: 'classification',
            models: {}
          };

          let bestF1 = 0;
          let bestAlgorithm = '';

          for (const [algorithm, result] of Object.entries(models)) {
            const metrics = result.metrics;
            report.modelComparison[target].models[algorithm] = {
              accuracy: metrics.accuracy,
              precision: metrics.precision,
              recall: metrics.recall,
              f1Score: metrics.f1Score,
              confusionMatrix: metrics.confusionMatrix
            };

            if (metrics.f1Score > bestF1) {
              bestF1 = metrics.f1Score;
              bestAlgorithm = algorithm;
            }
          }

          report.bestModels[target] = {
            algorithm: bestAlgorithm,
            f1Score: bestF1,
            type: 'classification'
          };

          // Generate recommendations
          if (bestF1 > 0.8) {
            report.recommendations.push(`${target}: Excellent performance with ${bestAlgorithm} (F1: ${bestF1})`);
          } else if (bestF1 > 0.6) {
            report.recommendations.push(`${target}: Good performance with ${bestAlgorithm} (F1: ${bestF1}), consider feature engineering`);
          } else {
            report.recommendations.push(`${target}: Poor performance (F1: ${bestF1}), needs more data or different approach`);
          }
        }
      }

      // Compare regression models
      if (this.modelResults.regression) {
        for (const [target, models] of Object.entries(this.modelResults.regression)) {
          if (models.error) continue;

          report.modelComparison[target] = {
            type: 'regression',
            models: {}
          };

          let bestR2 = -Infinity;
          let bestAlgorithm = '';

          for (const [algorithm, result] of Object.entries(models)) {
            const metrics = result.metrics;
            report.modelComparison[target].models[algorithm] = {
              rmse: metrics.rmse,
              mae: metrics.mae,
              rSquared: metrics.rSquared,
              meanActual: metrics.meanActual,
              meanPredicted: metrics.meanPredicted
            };

            if (metrics.rSquared > bestR2) {
              bestR2 = metrics.rSquared;
              bestAlgorithm = algorithm;
            }
          }

          report.bestModels[target] = {
            algorithm: bestAlgorithm,
            rSquared: bestR2,
            type: 'regression'
          };

          // Generate recommendations
          if (bestR2 > 0.7) {
            report.recommendations.push(`${target}: Excellent performance with ${bestAlgorithm} (R²: ${bestR2})`);
          } else if (bestR2 > 0.5) {
            report.recommendations.push(`${target}: Good performance with ${bestAlgorithm} (R²: ${bestR2}), consider feature engineering`);
          } else {
            report.recommendations.push(`${target}: Poor performance (R²: ${bestR2}), needs more data or different approach`);
          }
        }
      }

      // Save report
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `model-comparison-report-${timestamp}.json`;
      const filepath = path.join(this.resultsPath, filename);
      
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));

      logger.info('Model comparison report generated', { 
        filepath,
        totalModels: Object.keys(report.modelComparison).length,
        bestModels: Object.keys(report.bestModels).length
      });

      return {
        success: true,
        report,
        filepath
      };

    } catch (error) {
      logger.error('Failed to generate model comparison report', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Package best-performing model for deployment
   * @param {String} target Target variable
   * @param {String} algorithm Algorithm name
   * @returns {Promise<Object>} Packaging result
   */
  async packageModelForDeployment(target, algorithm) {
    try {
      if (!this.modelResults || !this.modelResults.classification && !this.modelResults.regression) {
        throw new Error('No trained models available');
      }

      // Find the specified model
      let model = null;
      let modelType = null;

      if (this.modelResults.classification && this.modelResults.classification[target]) {
        model = this.modelResults.classification[target][algorithm]?.model;
        modelType = 'classification';
      } else if (this.modelResults.regression && this.modelResults.regression[target]) {
        model = this.modelResults.regression[target][algorithm]?.model;
        modelType = 'regression';
      }

      if (!model) {
        throw new Error(`Model not found for target: ${target}, algorithm: ${algorithm}`);
      }

      // Create deployment package
      const deploymentPackage = {
        model: model,
        metadata: {
          target: target,
          algorithm: algorithm,
          modelType: modelType,
          featureColumns: this.featureColumns,
          targetColumns: this.targetColumns,
          trainingDate: new Date().toISOString(),
          version: '1.0'
        },
        preprocessing: {
          featureExtraction: this.extractFeatures.bind(this),
          targetCalculation: this.calculateTargets.bind(this)
        }
      };

      // Save deployment package
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `deployment-package-${target}-${algorithm}-${timestamp}.json`;
      const filepath = path.join(this.resultsPath, filename);
      
      await fs.writeFile(filepath, JSON.stringify(deploymentPackage, null, 2));

      logger.info('Model packaged for deployment', {
        target,
        algorithm,
        modelType,
        filepath
      });

      return {
        success: true,
        deploymentPackage,
        filepath,
        metadata: deploymentPackage.metadata
      };

    } catch (error) {
      logger.error('Failed to package model for deployment', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      service: 'MachineLearningService',
      connected: !!this.databaseService?.connected,
      dataLoaded: !!(this.trainingData && this.testData),
      modelsTrained: Object.keys(this.modelResults).length > 0,
      featureColumns: this.featureColumns?.length || 0,
      targetColumns: this.targetColumns?.length || 0,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = MachineLearningService;
