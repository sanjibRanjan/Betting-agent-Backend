'use strict';

const { Matrix } = require('ml-matrix');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/loggerService');

/**
 * Simple Machine Learning Models for Cricket Predictions
 */

// Simple Logistic Regression Implementation
class SimpleLogisticRegression {
  constructor(options = {}) {
    this.learningRate = options.learningRate || 0.01;
    this.maxIterations = options.maxIterations || 1000;
    this.weights = null;
    this.bias = 0;
    this.trained = false;
  }

  sigmoid(z) {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  }

  train(X, y) {
    const nSamples = X.rows;
    const nFeatures = X.columns;
    
    // Initialize weights
    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;

    // Gradient descent
    for (let iter = 0; iter < this.maxIterations; iter++) {
      let totalLoss = 0;
      const weightGradients = new Array(nFeatures).fill(0);
      let biasGradient = 0;

      for (let i = 0; i < nSamples; i++) {
        const features = X.getRow(i);
        let z = this.bias;
        
        for (let j = 0; j < nFeatures; j++) {
          z += this.weights[j] * features[j];
        }

        const prediction = this.sigmoid(z);
        const actual = y[i];
        const error = prediction - actual;

        totalLoss += actual * Math.log(Math.max(1e-15, prediction)) + 
                    (1 - actual) * Math.log(Math.max(1e-15, 1 - prediction));

        biasGradient += error;

        for (let j = 0; j < nFeatures; j++) {
          weightGradients[j] += error * features[j];
        }
      }

      // Update parameters
      this.bias -= this.learningRate * (biasGradient / nSamples);
      for (let j = 0; j < nFeatures; j++) {
        this.weights[j] -= this.learningRate * (weightGradients[j] / nSamples);
      }

      // Early stopping if converged
      if (Math.abs(totalLoss) < 0.01) break;
    }

    this.trained = true;
  }

  predict(X) {
    if (!this.trained) throw new Error('Model not trained');
    
    const predictions = [];
    for (let i = 0; i < X.rows; i++) {
      const features = X.getRow(i);
      let z = this.bias;
      
      for (let j = 0; j < this.weights.length; j++) {
        z += this.weights[j] * features[j];
      }

      const probability = this.sigmoid(z);
      predictions.push(probability > 0.5 ? 1 : 0);
    }

    return predictions;
  }

  predictProbability(X) {
    if (!this.trained) throw new Error('Model not trained');
    
    const probabilities = [];
    for (let i = 0; i < X.rows; i++) {
      const features = X.getRow(i);
      let z = this.bias;
      
      for (let j = 0; j < this.weights.length; j++) {
        z += this.weights[j] * features[j];
      }

      probabilities.push(this.sigmoid(z));
    }

    return probabilities;
  }
}

// Simple Decision Tree Implementation
class SimpleDecisionTree {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth || 10;
    this.minSamplesSplit = options.minSamplesSplit || 2;
    this.tree = null;
    this.trained = false;
  }

  calculateGini(y) {
    const counts = {};
    for (const label of y) {
      counts[label] = (counts[label] || 0) + 1;
    }
    
    const total = y.length;
    let gini = 1;
    for (const count of Object.values(counts)) {
      gini -= Math.pow(count / total, 2);
    }
    
    return gini;
  }

  findBestSplit(X, y) {
    const nFeatures = X.columns;
    let bestGini = Infinity;
    let bestFeature = -1;
    let bestThreshold = 0;

    for (let feature = 0; feature < nFeatures; feature++) {
      const values = X.getColumn(feature);
      const uniqueValues = [...new Set(values)].sort((a, b) => a - b);

      for (let i = 0; i < uniqueValues.length - 1; i++) {
        const threshold = (uniqueValues[i] + uniqueValues[i + 1]) / 2;
        
        const leftIndices = [];
        const rightIndices = [];
        
        for (let j = 0; j < values.length; j++) {
          if (values[j] <= threshold) {
            leftIndices.push(j);
          } else {
            rightIndices.push(j);
          }
        }

        if (leftIndices.length === 0 || rightIndices.length === 0) continue;

        const leftY = leftIndices.map(idx => y[idx]);
        const rightY = rightIndices.map(idx => y[idx]);

        const leftGini = this.calculateGini(leftY);
        const rightGini = this.calculateGini(rightY);
        
        const weightedGini = (leftY.length * leftGini + rightY.length * rightGini) / y.length;

        if (weightedGini < bestGini) {
          bestGini = weightedGini;
          bestFeature = feature;
          bestThreshold = threshold;
        }
      }
    }

    return { feature: bestFeature, threshold: bestThreshold, gini: bestGini };
  }

  buildTree(X, y, depth = 0) {
    const nSamples = y.length;
    
    // Stop conditions
    if (depth >= this.maxDepth || nSamples < this.minSamplesSplit || this.calculateGini(y) === 0) {
      const counts = {};
      for (const label of y) {
        counts[label] = (counts[label] || 0) + 1;
      }
      
      const majorityClass = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
      return { isLeaf: true, prediction: parseInt(majorityClass) };
    }

    const split = this.findBestSplit(X, y);
    
    if (split.feature === -1) {
      const counts = {};
      for (const label of y) {
        counts[label] = (counts[label] || 0) + 1;
      }
      const majorityClass = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
      return { isLeaf: true, prediction: parseInt(majorityClass) };
    }

    const leftIndices = [];
    const rightIndices = [];
    
    for (let i = 0; i < nSamples; i++) {
      if (X.get(i, split.feature) <= split.threshold) {
        leftIndices.push(i);
      } else {
        rightIndices.push(i);
      }
    }

    const leftX = new Matrix(leftIndices.map(idx => X.getRow(idx)));
    const rightX = new Matrix(rightIndices.map(idx => X.getRow(idx)));
    const leftY = leftIndices.map(idx => y[idx]);
    const rightY = rightIndices.map(idx => y[idx]);

    return {
      isLeaf: false,
      feature: split.feature,
      threshold: split.threshold,
      left: this.buildTree(leftX, leftY, depth + 1),
      right: this.buildTree(rightX, rightY, depth + 1)
    };
  }

  train(X, y) {
    this.tree = this.buildTree(X, y);
    this.trained = true;
  }

  predictSingle(x, node = null) {
    if (node === null) node = this.tree;
    
    if (node.isLeaf) {
      return node.prediction;
    }

    if (x[node.feature] <= node.threshold) {
      return this.predictSingle(x, node.left);
    } else {
      return this.predictSingle(x, node.right);
    }
  }

  predict(X) {
    if (!this.trained) throw new Error('Model not trained');
    
    const predictions = [];
    for (let i = 0; i < X.rows; i++) {
      predictions.push(this.predictSingle(X.getRow(i)));
    }
    return predictions;
  }
}

// Simple Random Forest Implementation
class SimpleRandomForest {
  constructor(options = {}) {
    this.nEstimators = options.nEstimators || 10;
    this.maxDepth = options.maxDepth || 10;
    this.trees = [];
    this.trained = false;
  }

  bootstrapSample(X, y) {
    const nSamples = X.rows;
    const indices = [];
    
    for (let i = 0; i < nSamples; i++) {
      indices.push(Math.floor(Math.random() * nSamples));
    }

    const sampleX = new Matrix(indices.map(idx => X.getRow(idx)));
    const sampleY = indices.map(idx => y[idx]);

    return { X: sampleX, y: sampleY };
  }

  train(X, y) {
    this.trees = [];
    
    for (let i = 0; i < this.nEstimators; i++) {
      const tree = new SimpleDecisionTree({ maxDepth: this.maxDepth });
      const { X: sampleX, y: sampleY } = this.bootstrapSample(X, y);
      tree.train(sampleX, sampleY);
      this.trees.push(tree);
    }

    this.trained = true;
  }

  predict(X) {
    if (!this.trained) throw new Error('Model not trained');
    
    const predictions = [];
    
    for (let i = 0; i < X.rows; i++) {
      const treePredictions = this.trees.map(tree => tree.predictSingle(X.getRow(i)));
      
      // Majority voting
      const counts = {};
      for (const pred of treePredictions) {
        counts[pred] = (counts[pred] || 0) + 1;
      }
      
      const majorityClass = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
      predictions.push(parseInt(majorityClass));
    }

    return predictions;
  }
}

// Simple Linear Regression for regression tasks
class SimpleLinearRegression {
  constructor(options = {}) {
    this.learningRate = options.learningRate || 0.01;
    this.maxIterations = options.maxIterations || 1000;
    this.weights = null;
    this.bias = 0;
    this.trained = false;
  }

  train(X, y) {
    const nSamples = X.rows;
    const nFeatures = X.columns;
    
    // Initialize weights
    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;

    // Gradient descent
    for (let iter = 0; iter < this.maxIterations; iter++) {
      let totalLoss = 0;
      const weightGradients = new Array(nFeatures).fill(0);
      let biasGradient = 0;

      for (let i = 0; i < nSamples; i++) {
        const features = X.getRow(i);
        let prediction = this.bias;
        
        for (let j = 0; j < nFeatures; j++) {
          prediction += this.weights[j] * features[j];
        }

        const error = prediction - y[i];
        totalLoss += error * error;

        biasGradient += error;

        for (let j = 0; j < nFeatures; j++) {
          weightGradients[j] += error * features[j];
        }
      }

      // Update parameters
      this.bias -= this.learningRate * (biasGradient / nSamples);
      for (let j = 0; j < nFeatures; j++) {
        this.weights[j] -= this.learningRate * (weightGradients[j] / nSamples);
      }

      // Early stopping if converged
      if (Math.abs(totalLoss) < 0.01) break;
    }

    this.trained = true;
  }

  predict(X) {
    if (!this.trained) throw new Error('Model not trained');
    
    const predictions = [];
    for (let i = 0; i < X.rows; i++) {
      const features = X.getRow(i);
      let prediction = this.bias;
      
      for (let j = 0; j < this.weights.length; j++) {
        prediction += this.weights[j] * features[j];
      }

      predictions.push(Math.max(0, prediction)); // Ensure non-negative predictions
    }

    return predictions;
  }
}

/**
 * Simple Machine Learning Service for Cricket Betting Predictions
 * Uses basic implementations of common ML algorithms
 */
class SimpleMLService {
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

        // Train Simple Logistic Regression
        const lrModel = new SimpleLogisticRegression();
        lrModel.train(this.trainingData.X, trainY);
        const lrPredictions = lrModel.predict(this.testData.X);
        const lrMetrics = this.evaluateClassification(testY, lrPredictions, target);

        // Train Simple Decision Tree
        const dtModel = new SimpleDecisionTree({ maxDepth: 15 });
        dtModel.train(this.trainingData.X, trainY);
        const dtPredictions = dtModel.predict(this.testData.X);
        const dtMetrics = this.evaluateClassification(testY, dtPredictions, target);

        // Train Simple Random Forest
        const rfModel = new SimpleRandomForest({ nEstimators: 50, maxDepth: 10 });
        rfModel.train(this.trainingData.X, trainY);
        const rfPredictions = rfModel.predict(this.testData.X);
        const rfMetrics = this.evaluateClassification(testY, rfPredictions, target);

        results[target] = {
          logisticRegression: { model: lrModel, metrics: lrMetrics },
          decisionTree: { model: dtModel, metrics: dtMetrics },
          randomForest: { model: rfModel, metrics: rfMetrics }
        };

        logger.info(`Classification model training completed for ${target}`, {
          logisticRegression: lrMetrics,
          decisionTree: dtMetrics,
          randomForest: rfMetrics
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

        // Train Simple Linear Regression
        const lrModel = new SimpleLinearRegression();
        lrModel.train(this.trainingData.X, trainY);
        const lrPredictions = lrModel.predict(this.testData.X);
        const lrMetrics = this.evaluateRegression(testY, lrPredictions, target);

        results[target] = {
          linearRegression: { model: lrModel, metrics: lrMetrics }
        };

        logger.info(`Regression model training completed for ${target}`, {
          linearRegression: lrMetrics
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
   */
  evaluateClassification(actual, predicted, target) {
    let truePositives = 0;
    let trueNegatives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (let i = 0; i < actual.length; i++) {
      if (actual[i] === 1 && predicted[i] === 1) truePositives++;
      else if (actual[i] === 0 && predicted[i] === 0) trueNegatives++;
      else if (actual[i] === 0 && predicted[i] === 1) falsePositives++;
      else if (actual[i] === 1 && predicted[i] === 0) falseNegatives++;
    }

    const accuracy = (truePositives + trueNegatives) / actual.length;
    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
    
    const metrics = {
      accuracy: Math.round(accuracy * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1Score: Math.round(f1Score * 1000) / 1000,
      confusionMatrix: {
        trueNegatives,
        truePositives,
        falseNegatives,
        falsePositives
      }
    };

    logger.debug(`Classification metrics for ${target}`, metrics);
    return metrics;
  }

  /**
   * Evaluate regression model
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
   * Generate training summary
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
   * Shuffle array with seed
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
   * Generate comprehensive model comparison report
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
   */
  getStatus() {
    return {
      service: 'SimpleMLService',
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

module.exports = SimpleMLService;
