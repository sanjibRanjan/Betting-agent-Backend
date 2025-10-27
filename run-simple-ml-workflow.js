#!/usr/bin/env node

'use strict';

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const DatabaseService = require('./utils/databaseService');
const SimpleMLService = require('./services/simpleMLService');
const ModelDeploymentService = require('./services/modelDeploymentService');
const logger = require('./utils/loggerService');

/**
 * Simple Machine Learning Workflow for Cricket Betting Predictions
 * Orchestrates data loading, preprocessing, training, evaluation, and deployment
 */
class SimpleMLWorkflow {
  constructor() {
    this.databaseService = null;
    this.mlService = null;
    this.deploymentService = null;
    this.workflowResults = {};
    this.startTime = null;
  }

  /**
   * Initialize all services
   */
  async initialize() {
    try {
      logger.info('Initializing Simple ML workflow services');

      this.startTime = new Date();

      // Initialize database service
      this.databaseService = new DatabaseService();
      const dbConnected = await this.databaseService.connect();
      
      if (!dbConnected) {
        throw new Error('Failed to connect to database');
      }

      // Initialize ML service
      this.mlService = new SimpleMLService(this.databaseService);

      // Initialize deployment service
      this.deploymentService = new ModelDeploymentService(this.databaseService);

      logger.info('All services initialized successfully');
      return true;

    } catch (error) {
      logger.error('Failed to initialize services', { error: error.message });
      return false;
    }
  }

  /**
   * Run complete ML workflow
   * @param {Object} options Workflow options
   */
  async runWorkflow(options = {}) {
    try {
      logger.info('Starting complete Simple ML workflow', { options });

      const {
        dataLimit = 500,
        testSize = 0.2,
        generateReports = true,
        deployBestModels = true,
        targetModels = ['wicketOccurred', 'boundaryScored', 'runsScored']
      } = options;

      const workflowSteps = [
        { name: 'Data Loading', fn: () => this.step1_LoadData({ dataLimit }) },
        { name: 'Data Preprocessing', fn: () => this.step2_PreprocessData({ testSize }) },
        { name: 'Model Training', fn: () => this.step3_TrainModels() },
        { name: 'Model Evaluation', fn: () => this.step4_EvaluateModels() },
        { name: 'Report Generation', fn: () => this.step5_GenerateReports(), skip: !generateReports },
        { name: 'Model Deployment', fn: () => this.step6_DeployModels({ targetModels }), skip: !deployBestModels }
      ];

      const results = {};

      for (const step of workflowSteps) {
        if (step.skip) {
          logger.info(`Skipping step: ${step.name}`);
          results[step.name] = { skipped: true };
          continue;
        }

        logger.info(`Executing step: ${step.name}`);
        
        try {
          const stepStartTime = Date.now();
          const result = await step.fn();
          const stepDuration = Date.now() - stepStartTime;
          
          results[step.name] = {
            success: true,
            result,
            duration: stepDuration
          };
          
          logger.info(`Step completed: ${step.name}`, { 
            duration: `${stepDuration}ms`,
            success: true
          });

        } catch (error) {
          const stepDuration = Date.now() - (results[step.name]?.startTime || Date.now());
          
          results[step.name] = {
            success: false,
            error: error.message,
            duration: stepDuration
          };
          
          logger.error(`Step failed: ${step.name}`, { 
            error: error.message,
            duration: `${stepDuration}ms`
          });

          // Decide whether to continue or stop
          if (this.isCriticalStep(step.name)) {
            throw new Error(`Critical step failed: ${step.name} - ${error.message}`);
          }
        }
      }

      this.workflowResults = results;
      
      const totalDuration = Date.now() - this.startTime.getTime();
      logger.info('Simple ML workflow completed', { 
        totalDuration: `${totalDuration}ms`,
        steps: Object.keys(results).length,
        successful: Object.values(results).filter(r => r.success).length,
        failed: Object.values(results).filter(r => !r.success && !r.skipped).length
      });

      return {
        success: true,
        results,
        totalDuration,
        summary: this.generateWorkflowSummary(results)
      };

    } catch (error) {
      logger.error('Simple ML workflow failed', { error: error.message });
      return {
        success: false,
        error: error.message,
        results: this.workflowResults
      };
    }
  }

  /**
   * Step 1: Load and validate data
   */
  async step1_LoadData(options) {
    logger.info('Step 1: Loading data from OverFeatures collection');

    const result = await this.mlService.loadAndPreprocessData({
      limit: options.dataLimit,
      minOvers: 5,
      includeIncomplete: false
    });

    if (!result.success) {
      throw new Error(`Data loading failed: ${result.error}`);
    }

    // Validate data quality
    if (result.dataQuality.quality === 'poor') {
      logger.warn('Poor data quality detected', result.dataQuality);
    }

    return {
      totalSamples: result.totalSamples,
      trainingSamples: result.trainingSamples,
      testSamples: result.testSamples,
      featureCount: result.featureColumns.length,
      targetCount: result.targetColumns.length,
      dataQuality: result.dataQuality
    };
  }

  /**
   * Step 2: Preprocess and split data
   */
  async step2_PreprocessData(options) {
    logger.info('Step 2: Preprocessing data and creating train-test split');

    // Data is already preprocessed in step 1, just validate
    if (!this.mlService.trainingData || !this.mlService.testData) {
      throw new Error('Training data not available from step 1');
    }

    const trainX = this.mlService.trainingData.X;
    const testX = this.mlService.testData.X;

    // Validate data quality
    const hasNaN = this.checkForNaN(trainX) || this.checkForNaN(testX);
    const hasInfinite = this.checkForInfinite(trainX) || this.checkForInfinite(testX);

    if (hasNaN || hasInfinite) {
      logger.warn('Data quality issues detected', { hasNaN, hasInfinite });
    }

    return {
      trainingShape: `${trainX.rows}x${trainX.columns}`,
      testShape: `${testX.rows}x${testX.columns}`,
      featureColumns: this.mlService.featureColumns.length,
      targetColumns: this.mlService.targetColumns.length,
      dataQuality: { hasNaN, hasInfinite }
    };
  }

  /**
   * Step 3: Train machine learning models
   */
  async step3_TrainModels() {
    logger.info('Step 3: Training machine learning models');

    const result = await this.mlService.trainModels({
      verbose: true
    });

    if (!result.success) {
      throw new Error(`Model training failed: ${result.error}`);
    }

    const classificationCount = result.results.classification ? 
      Object.keys(result.results.classification).length : 0;
    const regressionCount = result.results.regression ? 
      Object.keys(result.results.regression).length : 0;

    if (classificationCount === 0 && regressionCount === 0) {
      throw new Error('No successful model training results');
    }

    return {
      totalModels: result.summary.totalModels,
      classificationModels: classificationCount,
      regressionModels: regressionCount,
      bestModels: result.summary.bestModels
    };
  }

  /**
   * Step 4: Evaluate model performance
   */
  async step4_EvaluateModels() {
    logger.info('Step 4: Evaluating model performance');

    if (!this.mlService.modelResults || Object.keys(this.mlService.modelResults).length === 0) {
      throw new Error('No trained models available for evaluation');
    }

    const evaluationResults = {};

    // Evaluate classification models
    if (this.mlService.modelResults.classification) {
      for (const [target, models] of Object.entries(this.mlService.modelResults.classification)) {
        if (models.error) continue;

        evaluationResults[target] = { type: 'classification', bestScore: 0 };

        for (const [algorithm, result] of Object.entries(models)) {
          const metrics = result.metrics;
          if (metrics.f1Score > evaluationResults[target].bestScore) {
            evaluationResults[target].bestScore = metrics.f1Score;
            evaluationResults[target].bestAlgorithm = algorithm;
          }
        }
      }
    }

    // Evaluate regression models
    if (this.mlService.modelResults.regression) {
      for (const [target, models] of Object.entries(this.mlService.modelResults.regression)) {
        if (models.error) continue;

        evaluationResults[target] = { type: 'regression', bestScore: -Infinity };

        for (const [algorithm, result] of Object.entries(models)) {
          const metrics = result.metrics;
          if (metrics.rSquared > evaluationResults[target].bestScore) {
            evaluationResults[target].bestScore = metrics.rSquared;
            evaluationResults[target].bestAlgorithm = algorithm;
          }
        }
      }
    }

    return evaluationResults;
  }

  /**
   * Step 5: Generate comprehensive reports
   */
  async step5_GenerateReports() {
    logger.info('Step 5: Generating comprehensive reports');

    const result = await this.mlService.generateModelComparisonReport();

    if (!result.success) {
      throw new Error(`Report generation failed: ${result.error}`);
    }

    return {
      reportGenerated: true,
      filepath: result.filepath,
      comparisonTargets: Object.keys(result.report.modelComparison).length,
      bestModels: Object.keys(result.report.bestModels).length,
      recommendations: result.report.recommendations.length
    };
  }

  /**
   * Step 6: Deploy best models
   */
  async step6_DeployModels(options) {
    logger.info('Step 6: Deploying best performing models');

    if (!this.mlService.modelResults || Object.keys(this.mlService.modelResults).length === 0) {
      throw new Error('No trained models available for deployment');
    }

    const deploymentResults = {};

    // Deploy specified target models
    for (const target of options.targetModels) {
      try {
        // Find the best model for this target
        const bestModel = this.findBestModelForTarget(target);
        
        if (bestModel) {
          // Package the model
          const packageResult = await this.mlService.packageModelForDeployment(
            target, 
            bestModel.algorithm
          );

          if (packageResult.success) {
            // Deploy the model
            const deployResult = await this.deploymentService.deployModel(
              target, 
              bestModel.algorithm
            );

            deploymentResults[target] = {
              success: deployResult.success,
              algorithm: bestModel.algorithm,
              score: bestModel.score,
              packagePath: packageResult.filepath,
              deployed: deployResult.success
            };
          } else {
            deploymentResults[target] = {
              success: false,
              error: packageResult.error
            };
          }
        } else {
          deploymentResults[target] = {
            success: false,
            error: 'No trained model found for target'
          };
        }

      } catch (error) {
        deploymentResults[target] = {
          success: false,
          error: error.message
        };
      }
    }

    return deploymentResults;
  }

  /**
   * Find best model for a target
   */
  findBestModelForTarget(target) {
    let bestModel = null;
    let bestScore = -Infinity;

    // Check classification models
    if (this.mlService.modelResults.classification && 
        this.mlService.modelResults.classification[target]) {
      
      const models = this.mlService.modelResults.classification[target];
      
      for (const [algorithm, result] of Object.entries(models)) {
        if (result.error) continue;
        
        const f1Score = result.metrics.f1Score;
        if (f1Score > bestScore) {
          bestScore = f1Score;
          bestModel = { algorithm, score: f1Score, type: 'classification' };
        }
      }
    }

    // Check regression models
    if (this.mlService.modelResults.regression && 
        this.mlService.modelResults.regression[target]) {
      
      const models = this.mlService.modelResults.regression[target];
      
      for (const [algorithm, result] of Object.entries(models)) {
        if (result.error) continue;
        
        const rSquared = result.metrics.rSquared;
        if (rSquared > bestScore) {
          bestScore = rSquared;
          bestModel = { algorithm, score: rSquared, type: 'regression' };
        }
      }
    }

    return bestModel;
  }

  /**
   * Check if step is critical (workflow should stop if it fails)
   */
  isCriticalStep(stepName) {
    const criticalSteps = ['Data Loading', 'Data Preprocessing', 'Model Training'];
    return criticalSteps.includes(stepName);
  }

  /**
   * Check for NaN values in matrix
   */
  checkForNaN(matrix) {
    for (let i = 0; i < matrix.rows; i++) {
      for (let j = 0; j < matrix.columns; j++) {
        if (isNaN(matrix.get(i, j))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check for infinite values in matrix
   */
  checkForInfinite(matrix) {
    for (let i = 0; i < matrix.rows; i++) {
      for (let j = 0; j < matrix.columns; j++) {
        if (!isFinite(matrix.get(i, j))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Generate workflow summary
   */
  generateWorkflowSummary(results) {
    const steps = Object.keys(results);
    const successfulSteps = steps.filter(step => results[step].success);
    const failedSteps = steps.filter(step => !results[step].success && !results[step].skipped);
    const skippedSteps = steps.filter(step => results[step].skipped);

    return {
      totalSteps: steps.length,
      successfulSteps: successfulSteps.length,
      failedSteps: failedSteps.length,
      skippedSteps: skippedSteps.length,
      successRate: steps.length > 0 ? Math.round((successfulSteps.length / steps.length) * 100) : 0,
      criticalStepsFailed: failedSteps.filter(step => this.isCriticalStep(step)).length
    };
  }

  /**
   * Generate final workflow report
   */
  async generateFinalReport() {
    try {
      const report = {
        timestamp: new Date().toISOString(),
        workflowResults: this.workflowResults,
        summary: this.generateWorkflowSummary(this.workflowResults),
        deploymentStats: this.deploymentService.getDeploymentStats(),
        recommendations: this.generateRecommendations(),
        totalDuration: this.startTime ? Date.now() - this.startTime.getTime() : 0
      };

      const fs = require('fs').promises;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `simple-ml-workflow-report-${timestamp}.json`;
      const filepath = path.join(__dirname, 'ml-results', filename);
      
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));

      logger.info('Final workflow report generated', { filepath });

      // Print summary to console
      console.log('\n' + '='.repeat(80));
      console.log('SIMPLE MACHINE LEARNING WORKFLOW REPORT');
      console.log('='.repeat(80));
      console.log(`Timestamp: ${report.timestamp}`);
      console.log(`Total Duration: ${Math.round(report.totalDuration / 1000)}s`);
      console.log(`Success Rate: ${report.summary.successRate}%`);
      console.log(`Total Steps: ${report.summary.totalSteps}`);
      console.log(`Successful: ${report.summary.successfulSteps}`);
      console.log(`Failed: ${report.summary.failedSteps}`);
      console.log(`Skipped: ${report.summary.skippedSteps}`);
      
      if (report.summary.criticalStepsFailed > 0) {
        console.log(`\n⚠️  Critical Steps Failed: ${report.summary.criticalStepsFailed}`);
      }

      console.log('\nDeployed Models:');
      for (const [modelKey, stats] of Object.entries(report.deploymentStats.modelStats)) {
        if (stats.deployed) {
          console.log(`  ✅ ${modelKey} (${stats.metadata.algorithm}) - ${stats.predictionCount} predictions`);
        }
      }

      console.log('\nRecommendations:');
      for (const recommendation of report.recommendations) {
        console.log(`  • ${recommendation}`);
      }

      console.log(`\nDetailed report saved to: ${filepath}`);
      console.log('='.repeat(80) + '\n');

      return report;

    } catch (error) {
      logger.error('Failed to generate final report', { error: error.message });
      return null;
    }
  }

  /**
   * Generate recommendations based on workflow results
   */
  generateRecommendations() {
    const recommendations = [];
    const summary = this.generateWorkflowSummary(this.workflowResults);

    if (summary.successRate === 100) {
      recommendations.push('🎉 All workflow steps completed successfully!');
      recommendations.push('The Simple ML pipeline is ready for production use.');
    } else if (summary.successRate >= 80) {
      recommendations.push('✅ Most workflow steps completed successfully.');
      recommendations.push('Review failed steps and consider rerunning the workflow.');
    } else {
      recommendations.push('⚠️ Multiple workflow steps failed.');
      recommendations.push('Review the errors and fix issues before proceeding.');
    }

    if (summary.criticalStepsFailed > 0) {
      recommendations.push('🚨 Critical steps failed - workflow cannot proceed without fixes.');
    }

    // Add model-specific recommendations
    if (this.mlService.modelResults) {
      const hasGoodModels = Object.values(this.mlService.modelResults)
        .some(category => Object.values(category)
          .some(models => Object.values(models)
            .some(result => !result.error && result.metrics)));

      if (hasGoodModels) {
        recommendations.push('📊 Good model performance achieved - consider deploying for real-time predictions.');
      } else {
        recommendations.push('📉 Model performance needs improvement - consider more data or feature engineering.');
      }
    }

    return recommendations;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.databaseService) {
        await this.databaseService.disconnect();
      }
      logger.info('Workflow cleanup completed');
    } catch (error) {
      logger.error('Workflow cleanup failed', { error: error.message });
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  const workflow = new SimpleMLWorkflow();
  
  try {
    // Initialize services
    const initialized = await workflow.initialize();
    if (!initialized) {
      console.error('Failed to initialize workflow services');
      process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = {
      dataLimit: parseInt(args[0]) || 500,
      generateReports: args.includes('--no-reports') ? false : true,
      deployBestModels: args.includes('--no-deploy') ? false : true
    };

    console.log('Starting Simple ML Workflow with options:', options);

    // Run workflow
    const result = await workflow.runWorkflow(options);
    
    if (!result.success) {
      console.error('\n❌ Workflow failed:', result.error);
      process.exit(1);
    }

    // Generate final report
    await workflow.generateFinalReport();

    console.log('\n✅ Simple ML Workflow completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Workflow execution failed:', error.message);
    process.exit(1);
  } finally {
    await workflow.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = SimpleMLWorkflow;
