'use strict';

const logger = require('../utils/loggerService');

/**
 * Data Pipeline Service for Cricket Feature Engineering
 * Orchestrates the complete data processing workflow from raw data to engineered features
 */
class DataPipeline {
  constructor(databaseService, featureEngineer) {
    this.databaseService = databaseService;
    this.featureEngineer = featureEngineer;
    this.processingStats = {
      totalMatches: 0,
      processedMatches: 0,
      totalOvers: 0,
      processedOvers: 0,
      errors: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Execute the complete data pipeline
   * @param {Object} options Pipeline options
   * @returns {Promise<Object>} Pipeline execution results
   */
  async executePipeline(options = {}) {
    try {
      this.processingStats.startTime = new Date();
      logger.info('Starting cricket data pipeline execution', {
        options,
        timestamp: this.processingStats.startTime.toISOString()
      });

      const pipelineResults = {
        success: false,
        totalMatches: 0,
        processedMatches: 0,
        totalOvers: 0,
        processedOvers: 0,
        errors: [],
        processingTime: 0,
        statistics: {},
        recommendations: []
      };

      // Step 1: Validate data sources
      const validationResult = await this.validateDataSources();
      if (!validationResult.success) {
        pipelineResults.errors.push('Data source validation failed');
        return pipelineResults;
      }

      // Step 2: Fetch raw data
      const fetchResult = await this.fetchRawData(options);
      if (!fetchResult.success) {
        pipelineResults.errors.push('Raw data fetch failed');
        return pipelineResults;
      }

      pipelineResults.totalMatches = fetchResult.matchesFound;

      // Step 3: Validate data quality
      const qualityResult = await this.validateDataQuality(fetchResult.matches);
      pipelineResults.statistics.dataQuality = qualityResult;

      // Step 4: Process matches for feature engineering
      const processingResult = await this.processMatches(fetchResult.matches, options);
      pipelineResults.processedMatches = processingResult.processedSuccessfully;
      pipelineResults.processedOvers = processingResult.totalOversProcessed;
      pipelineResults.errors.push(...processingResult.errors);

      // Step 5: Generate statistics and recommendations
      const statsResult = await this.generateStatistics();
      pipelineResults.statistics = { ...pipelineResults.statistics, ...statsResult };

      const recommendations = await this.generateRecommendations(pipelineResults);
      pipelineResults.recommendations = recommendations;

      // Step 6: Finalize pipeline
      this.processingStats.endTime = new Date();
      pipelineResults.processingTime = this.processingStats.endTime - this.processingStats.startTime;
      pipelineResults.success = pipelineResults.processedMatches > 0;

      logger.info('Cricket data pipeline execution completed', {
        success: pipelineResults.success,
        totalMatches: pipelineResults.totalMatches,
        processedMatches: pipelineResults.processedMatches,
        processedOvers: pipelineResults.processedOvers,
        processingTime: pipelineResults.processingTime,
        errors: pipelineResults.errors.length
      });

      return pipelineResults;

    } catch (error) {
      logger.error('Cricket data pipeline execution failed', {
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        totalMatches: 0,
        processedMatches: 0,
        totalOvers: 0,
        processedOvers: 0,
        errors: [error.message],
        processingTime: 0,
        statistics: {},
        recommendations: []
      };
    }
  }

  /**
   * Validate data sources and connections
   * @returns {Promise<Object>} Validation result
   */
  async validateDataSources() {
    try {
      logger.info('Validating data sources');

      const validationResults = {
        success: true,
        checks: {
          database: false,
          featureEngineer: false,
          collections: false
        },
        errors: []
      };

      // Check database connection
      if (this.databaseService && this.databaseService.connected) {
        validationResults.checks.database = true;
        logger.debug('Database connection validated');
      } else {
        validationResults.errors.push('Database not connected');
        validationResults.success = false;
      }

      // Check feature engineer service
      if (this.featureEngineer && this.featureEngineer.featureCollection) {
        validationResults.checks.featureEngineer = true;
        logger.debug('Feature engineer service validated');
      } else {
        validationResults.errors.push('Feature engineer service not available');
        validationResults.success = false;
      }

      // Check required collections
      try {
        const db = this.databaseService.connection.connection.db;
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        
        const requiredCollections = ['matches', 'players'];
        const missingCollections = requiredCollections.filter(name => 
          !collectionNames.includes(name)
        );

        if (missingCollections.length === 0) {
          validationResults.checks.collections = true;
          logger.debug('Required collections validated');
        } else {
          validationResults.errors.push(`Missing collections: ${missingCollections.join(', ')}`);
          validationResults.success = false;
        }
      } catch (error) {
        validationResults.errors.push(`Collection validation failed: ${error.message}`);
        validationResults.success = false;
      }

      logger.info('Data source validation completed', {
        success: validationResults.success,
        checks: validationResults.checks,
        errors: validationResults.errors
      });

      return validationResults;

    } catch (error) {
      logger.error('Data source validation failed', {
        error: error.message
      });
      return {
        success: false,
        errors: [error.message]
      };
    }
  }

  /**
   * Fetch raw data from MongoDB
   * @param {Object} options Fetch options
   * @returns {Promise<Object>} Fetch result
   */
  async fetchRawData(options = {}) {
    try {
      logger.info('Fetching raw cricket data from MongoDB', { options });

      const fetchOptions = {
        limit: options.limit || 100,
        matchIds: options.matchIds || null,
        status: options.status || ['Finished', 'Live', 'In Progress'],
        hasBallByBall: true
      };

      let query = {
        ballByBall: { $exists: true, $ne: null },
        status: { $in: fetchOptions.status }
      };

      if (fetchOptions.matchIds && fetchOptions.matchIds.length > 0) {
        query.fixtureId = { $in: fetchOptions.matchIds };
      }

      const matches = await this.databaseService.models.Match.find(query)
        .sort({ updatedAt: -1 })
        .limit(fetchOptions.limit)
        .lean();

      const matchesWithBallByBall = matches.filter(match => 
        match.ballByBall && 
        match.ballByBall.recentBalls && 
        match.ballByBall.recentBalls.length > 0
      );

      logger.info('Raw cricket data fetched', {
        totalMatches: matches.length,
        matchesWithBallByBall: matchesWithBallByBall.length,
        query: fetchOptions
      });

      return {
        success: true,
        matchesFound: matchesWithBallByBall.length,
        matches: matchesWithBallByBall,
        query: fetchOptions
      };

    } catch (error) {
      logger.error('Failed to fetch raw cricket data', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        matchesFound: 0,
        matches: []
      };
    }
  }

  /**
   * Validate data quality of fetched matches
   * @param {Array} matches Array of match documents
   * @returns {Promise<Object>} Quality validation results
   */
  async validateDataQuality(matches) {
    try {
      logger.info('Validating data quality for fetched matches', {
        matchCount: matches.length
      });

      const qualityResults = {
        totalMatches: matches.length,
        validMatches: 0,
        invalidMatches: 0,
        issues: {
          missingBallByBall: 0,
          incompleteBallData: 0,
          missingPlayerInfo: 0,
          missingScoreInfo: 0
        },
        qualityScore: 0
      };

      for (const match of matches) {
        const matchQuality = this.validateMatchQuality(match);
        
        if (matchQuality.valid) {
          qualityResults.validMatches++;
        } else {
          qualityResults.invalidMatches++;
        }

        // Aggregate issues
        Object.keys(matchQuality.issues).forEach(issue => {
          if (matchQuality.issues[issue]) {
            qualityResults.issues[issue]++;
          }
        });
      }

      // Calculate overall quality score
      qualityResults.qualityScore = qualityResults.totalMatches > 0 ?
        (qualityResults.validMatches / qualityResults.totalMatches) * 100 : 0;

      logger.info('Data quality validation completed', {
        qualityScore: qualityResults.qualityScore,
        validMatches: qualityResults.validMatches,
        invalidMatches: qualityResults.invalidMatches,
        issues: qualityResults.issues
      });

      return qualityResults;

    } catch (error) {
      logger.error('Data quality validation failed', {
        error: error.message
      });
      return {
        totalMatches: 0,
        validMatches: 0,
        invalidMatches: 0,
        issues: {},
        qualityScore: 0,
        error: error.message
      };
    }
  }

  /**
   * Validate quality of a single match
   * @param {Object} match Match document
   * @returns {Object} Match quality assessment
   */
  validateMatchQuality(match) {
    const quality = {
      valid: true,
      issues: {
        missingBallByBall: false,
        incompleteBallData: false,
        missingPlayerInfo: false,
        missingScoreInfo: false
      },
      score: 100
    };

    // Check for ball-by-ball data
    if (!match.ballByBall || !match.ballByBall.recentBalls) {
      quality.issues.missingBallByBall = true;
      quality.valid = false;
      quality.score -= 50;
    } else {
      const balls = match.ballByBall.recentBalls;
      
      // Check for incomplete ball data
      if (balls.length < 10) {
        quality.issues.incompleteBallData = true;
        quality.score -= 20;
      }

      // Check for missing player information
      const ballsWithoutBatsman = balls.filter(ball => !ball.batsman).length;
      const ballsWithoutBowler = balls.filter(ball => !ball.bowler).length;
      
      if (ballsWithoutBatsman > balls.length * 0.1 || ballsWithoutBowler > balls.length * 0.1) {
        quality.issues.missingPlayerInfo = true;
        quality.score -= 15;
      }

      // Check for missing score information
      const ballsWithoutScore = balls.filter(ball => !ball.score).length;
      if (ballsWithoutScore > balls.length * 0.05) {
        quality.issues.missingScoreInfo = true;
        quality.score -= 15;
      }
    }

    quality.valid = quality.score >= 70;

    return quality;
  }

  /**
   * Process matches through feature engineering pipeline
   * @param {Array} matches Array of match documents
   * @param {Object} options Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processMatches(matches, options = {}) {
    try {
      logger.info('Processing matches through feature engineering pipeline', {
        matchCount: matches.length,
        options
      });

      const processingResults = {
        success: false,
        processedSuccessfully: 0,
        totalOversProcessed: 0,
        errors: [],
        matchResults: []
      };

      // Process matches in batches to avoid memory issues
      const batchSize = options.batchSize || 10;
      const batches = this.createBatches(matches, batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Processing batch ${i + 1}/${batches.length}`, {
          batchSize: batch.length,
          batchNumber: i + 1,
          totalBatches: batches.length
        });

        const batchResults = await this.processBatch(batch, options);
        
        processingResults.processedSuccessfully += batchResults.processedSuccessfully;
        processingResults.totalOversProcessed += batchResults.totalOversProcessed;
        processingResults.errors.push(...batchResults.errors);
        processingResults.matchResults.push(...batchResults.matchResults);

        // Add delay between batches to avoid overwhelming the system
        if (i < batches.length - 1) {
          await this.delay(1000); // 1 second delay
        }
      }

      processingResults.success = processingResults.processedSuccessfully > 0;

      logger.info('Match processing completed', {
        success: processingResults.success,
        processedSuccessfully: processingResults.processedSuccessfully,
        totalOversProcessed: processingResults.totalOversProcessed,
        errors: processingResults.errors.length
      });

      return processingResults;

    } catch (error) {
      logger.error('Match processing failed', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        processedSuccessfully: 0,
        totalOversProcessed: 0,
        errors: [error.message],
        matchResults: []
      };
    }
  }

  /**
   * Process a batch of matches
   * @param {Array} batch Array of match documents
   * @param {Object} options Processing options
   * @returns {Promise<Object>} Batch processing results
   */
  async processBatch(batch, options = {}) {
    const batchResults = {
      processedSuccessfully: 0,
      totalOversProcessed: 0,
      errors: [],
      matchResults: []
    };

    for (const match of batch) {
      try {
        const result = await this.featureEngineer.processMatchFeatures(match);
        
        batchResults.matchResults.push(result);
        
        if (result.success) {
          batchResults.processedSuccessfully++;
          batchResults.totalOversProcessed += result.oversProcessed;
        } else {
          batchResults.errors.push(`${match.fixtureId}: ${result.error}`);
        }

      } catch (error) {
        logger.error('Error processing match in batch', {
          matchId: match.fixtureId,
          error: error.message
        });
        batchResults.errors.push(`${match.fixtureId}: ${error.message}`);
      }
    }

    return batchResults;
  }

  /**
   * Generate comprehensive statistics from processed data
   * @returns {Promise<Object>} Statistics
   */
  async generateStatistics() {
    try {
      logger.info('Generating comprehensive statistics');

      const [featureStats, matchStats, playerStats] = await Promise.all([
        this.featureEngineer.getStatistics(),
        this.getMatchStatistics(),
        this.getPlayerStatistics()
      ]);

      const statistics = {
        features: featureStats.success ? featureStats.statistics : {},
        matches: matchStats,
        players: playerStats,
        generatedAt: new Date().toISOString()
      };

      logger.info('Statistics generated successfully', {
        featureStats: statistics.features,
        matchStats: statistics.matches,
        playerStats: statistics.players
      });

      return statistics;

    } catch (error) {
      logger.error('Failed to generate statistics', {
        error: error.message
      });
      return {
        error: error.message,
        generatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Get match-level statistics
   * @returns {Promise<Object>} Match statistics
   */
  async getMatchStatistics() {
    try {
      const matchStats = await this.databaseService.models.Match.aggregate([
        {
          $group: {
            _id: null,
            totalMatches: { $sum: 1 },
            matchesWithBallByBall: {
              $sum: {
                $cond: [
                  { $and: [
                    { $ne: ['$ballByBall', null] },
                    { $gt: [{ $size: { $ifNull: ['$ballByBall.recentBalls', []] } }, 0] }
                  ]},
                  1,
                  0
                ]
              }
            },
            avgBallsPerMatch: {
              $avg: {
                $size: { $ifNull: ['$ballByBall.recentBalls', []] }
              }
            },
            byStatus: {
              $push: '$status'
            }
          }
        },
        {
          $project: {
            _id: 0,
            totalMatches: 1,
            matchesWithBallByBall: 1,
            avgBallsPerMatch: { $round: ['$avgBallsPerMatch', 2] },
            statusCounts: {
              $reduce: {
                input: '$byStatus',
                initialValue: {},
                in: {
                  $mergeObjects: [
                    '$$value',
                    { $arrayToObject: [[{
                      k: '$$this',
                      v: { $add: [{ $ifNull: [{ $getField: { field: '$$this', input: '$$value' } }, 0] }, 1] }
                    }]] }
                  ]
                }
              }
            }
          }
        }
      ]);

      return matchStats.length > 0 ? matchStats[0] : {
        totalMatches: 0,
        matchesWithBallByBall: 0,
        avgBallsPerMatch: 0,
        statusCounts: {}
      };

    } catch (error) {
      logger.warn('Error getting match statistics', { error: error.message });
      return { error: error.message };
    }
  }

  /**
   * Get player-level statistics
   * @returns {Promise<Object>} Player statistics
   */
  async getPlayerStatistics() {
    try {
      const playerStats = await this.databaseService.models.Player.aggregate([
        {
          $group: {
            _id: null,
            totalPlayers: { $sum: 1 },
            playersWithCareer: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$career.matches', 0] }, 0] },
                  1,
                  0
                ]
              }
            },
            avgCareerRuns: { $avg: '$career.runs' },
            avgCareerWickets: { $avg: '$career.wickets' }
          }
        },
        {
          $project: {
            _id: 0,
            totalPlayers: 1,
            playersWithCareer: 1,
            avgCareerRuns: { $round: ['$avgCareerRuns', 2] },
            avgCareerWickets: { $round: ['$avgCareerWickets', 2] }
          }
        }
      ]);

      return playerStats.length > 0 ? playerStats[0] : {
        totalPlayers: 0,
        playersWithCareer: 0,
        avgCareerRuns: 0,
        avgCareerWickets: 0
      };

    } catch (error) {
      logger.warn('Error getting player statistics', { error: error.message });
      return { error: error.message };
    }
  }

  /**
   * Generate recommendations based on pipeline results
   * @param {Object} pipelineResults Pipeline execution results
   * @returns {Promise<Array>} Array of recommendations
   */
  async generateRecommendations(pipelineResults) {
    const recommendations = [];

    // Data quality recommendations
    if (pipelineResults.statistics.dataQuality) {
      const quality = pipelineResults.statistics.dataQuality;
      
      if (quality.qualityScore < 80) {
        recommendations.push({
          type: 'data_quality',
          priority: 'high',
          message: `Data quality score is ${quality.qualityScore.toFixed(1)}%. Consider improving data collection processes.`,
          details: quality.issues
        });
      }

      if (quality.issues.missingBallByBall > 0) {
        recommendations.push({
          type: 'data_completeness',
          priority: 'medium',
          message: `${quality.issues.missingBallByBall} matches missing ball-by-ball data.`,
          action: 'Review API integration for complete ball-by-ball data collection.'
        });
      }
    }

    // Processing recommendations
    if (pipelineResults.processedMatches < pipelineResults.totalMatches * 0.8) {
      recommendations.push({
        type: 'processing_efficiency',
        priority: 'medium',
        message: `Only ${pipelineResults.processedMatches}/${pipelineResults.totalMatches} matches processed successfully.`,
        action: 'Investigate and resolve processing errors.'
      });
    }

    // Performance recommendations
    if (pipelineResults.processingTime > 300000) { // 5 minutes
      recommendations.push({
        type: 'performance',
        priority: 'low',
        message: `Pipeline execution took ${(pipelineResults.processingTime / 1000).toFixed(1)} seconds.`,
        action: 'Consider optimizing batch sizes or implementing parallel processing.'
      });
    }

    return recommendations;
  }

  /**
   * Create batches from an array
   * @param {Array} array Input array
   * @param {Number} batchSize Batch size
   * @returns {Array} Array of batches
   */
  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Add delay for batch processing
   * @param {Number} ms Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get pipeline status
   * @returns {Object} Pipeline status
   */
  getStatus() {
    return {
      service: 'DataPipeline',
      connected: !!(this.databaseService?.connected && this.featureEngineer),
      processingStats: this.processingStats,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = DataPipeline;
