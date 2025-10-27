'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/loggerService');

/**
 * Feature Engineering Service for Cricket Betting Agent
 * Extracts and engineers predictive features from cricket match data
 * Focuses on over-level aggregates and player performance metrics
 */
class FeatureEngineer {
  constructor(databaseService) {
    this.databaseService = databaseService;
    this.featureCollection = null;
    this.initializeFeatureSchema();
  }

  /**
   * Initialize MongoDB schema for engineered features
   */
  initializeFeatureSchema() {
    // Over-level Features Schema
    const overFeaturesSchema = new mongoose.Schema({
      matchId: { type: String, required: true, index: true },
      fixtureId: { type: String, required: true, index: true },
      innings: { type: Number, required: true }, // 1 or 2
      overNumber: { type: Number, required: true, index: true },
      teamBatting: { type: String, required: true },
      teamBowling: { type: String, required: true },
      
      // Over-level aggregates
      overRuns: { type: Number, required: true },
      overWickets: { type: Number, required: true, default: 0 },
      overBalls: { type: Number, required: true, default: 6 },
      overExtras: { type: Number, default: 0 },
      overBoundaries: { type: Number, default: 0 },
      overSixes: { type: Number, default: 0 },
      
      // Cumulative match state
      totalRuns: { type: Number, required: true },
      totalWickets: { type: Number, required: true },
      totalOvers: { type: Number, required: true },
      runRate: { type: Number, required: true },
      requiredRunRate: { type: Number, default: 0 },
      
      // Player performance in this over
      batsmanStats: {
        striker: {
          playerId: { type: String },
          name: { type: String },
          runs: { type: Number, default: 0 },
          balls: { type: Number, default: 0 },
          strikeRate: { type: Number, default: 0 }
        },
        nonStriker: {
          playerId: { type: String },
          name: { type: String },
          runs: { type: Number, default: 0 },
          balls: { type: Number, default: 0 },
          strikeRate: { type: Number, default: 0 }
        }
      },
      
      bowlerStats: {
        playerId: { type: String },
        name: { type: String },
        runs: { type: Number, default: 0 },
        wickets: { type: Number, default: 0 },
        balls: { type: Number, default: 0 },
        economyRate: { type: Number, default: 0 },
        dotBalls: { type: Number, default: 0 }
      },
      
      // Momentum and form indicators
      momentum: {
        recentRunRate: { type: Number, default: 0 }, // Last 5 overs
        wicketsInHand: { type: Number, required: true },
        pressureIndex: { type: Number, default: 0 }, // Custom pressure metric
        partnershipRuns: { type: Number, default: 0 },
        partnershipBalls: { type: Number, default: 0 }
      },
      
      // Match context
      matchContext: {
        target: { type: Number, default: 0 },
        chase: { type: Boolean, default: false },
        powerplay: { type: Boolean, default: false },
        deathOvers: { type: Boolean, default: false },
        venue: { type: String },
        format: { type: String },
        series: { type: String }
      },
      
      // Temporal features
      timestamp: { type: Date, required: true },
      overStartTime: { type: Date },
      overEndTime: { type: Date },
      
      // Data quality indicators
      dataQuality: {
        complete: { type: Boolean, default: true },
        missingBalls: { type: Number, default: 0 },
        validationErrors: { type: [String], default: [] }
      },
      
      // Feature engineering metadata
      engineeredAt: { type: Date, default: Date.now },
      version: { type: String, default: '1.0' }
    }, {
      timestamps: true
    });

    // Create compound indexes for efficient queries
    overFeaturesSchema.index({ matchId: 1, innings: 1, overNumber: 1 }, { unique: true });
    overFeaturesSchema.index({ fixtureId: 1, overNumber: 1 });
    overFeaturesSchema.index({ timestamp: -1 });
    overFeaturesSchema.index({ 'bowlerStats.playerId': 1, timestamp: -1 });
    overFeaturesSchema.index({ 'batsmanStats.striker.playerId': 1, timestamp: -1 });

    this.featureCollection = mongoose.model('OverFeatures', overFeaturesSchema);
    
    logger.info('Feature engineering schema initialized', {
      collection: 'OverFeatures',
      indexes: ['matchId_innings_overNumber', 'fixtureId_overNumber', 'timestamp', 'bowler_playerId', 'batsman_playerId']
    });
  }

  /**
   * Main method to process matches and extract over-level features
   * @param {Array} matchIds Array of match IDs to process (optional)
   * @returns {Promise<Object>} Processing results
   */
  async processMatches(matchIds = null) {
    try {
      logger.info('Starting feature engineering for matches', {
        matchIds: matchIds?.length || 'all',
        timestamp: new Date().toISOString()
      });

      // Get matches to process
      const matches = await this.getMatchesToProcess(matchIds);
      
      if (!matches || matches.length === 0) {
        logger.warn('No matches found for feature engineering');
        return {
          success: false,
          error: 'No matches found',
          processedCount: 0
        };
      }

      let totalProcessed = 0;
      let totalErrors = 0;
      const processingResults = [];

      for (const match of matches) {
        try {
          const result = await this.processMatchFeatures(match);
          processingResults.push(result);
          
          if (result.success) {
            totalProcessed++;
          } else {
            totalErrors++;
          }
        } catch (error) {
          logger.error('Error processing match for features', {
            matchId: match.fixtureId,
            error: error.message
          });
          totalErrors++;
        }
      }

      logger.info('Feature engineering completed', {
        totalMatches: matches.length,
        processedSuccessfully: totalProcessed,
        errors: totalErrors,
        processingResults: processingResults.map(r => ({
          matchId: r.matchId,
          success: r.success,
          oversProcessed: r.oversProcessed,
          error: r.error
        }))
      });

      return {
        success: totalProcessed > 0,
        totalMatches: matches.length,
        processedSuccessfully: totalProcessed,
        errors: totalErrors,
        processingResults
      };

    } catch (error) {
      logger.error('Failed to process matches for feature engineering', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        processedCount: 0
      };
    }
  }

  /**
   * Get matches to process for feature engineering
   * @param {Array} matchIds Optional array of specific match IDs
   * @returns {Promise<Array>} Array of match documents
   */
  async getMatchesToProcess(matchIds = null) {
    try {
      let query = {};
      
      // Filter by match IDs if provided
      if (matchIds && matchIds.length > 0) {
        query.fixtureId = { $in: matchIds };
      }
      
      // Only process matches with ball-by-ball data
      query.ballByBall = { $exists: true, $ne: null };
      query.status = { $in: ['Finished', 'Live', 'In Progress'] };

      const matches = await this.databaseService.models.Match.find(query)
        .sort({ updatedAt: -1 })
        .limit(100) // Process most recent 100 matches by default
        .lean();

      logger.info('Retrieved matches for feature engineering', {
        query,
        matchesFound: matches.length
      });

      return matches;
    } catch (error) {
      logger.error('Failed to get matches for processing', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Process features for a single match
   * @param {Object} match Match document
   * @returns {Promise<Object>} Processing result
   */
  async processMatchFeatures(match) {
    try {
      const matchId = match.fixtureId;
      logger.info(`Processing features for match ${matchId}`, {
        matchId,
        title: match.title,
        hasBallByBall: !!match.ballByBall
      });

      if (!match.ballByBall || !match.ballByBall.recentBalls) {
        return {
          success: false,
          matchId,
          error: 'No ball-by-ball data available',
          oversProcessed: 0
        };
      }

      // Group balls by over and innings
      const overGroups = this.groupBallsByOver(match.ballByBall.recentBalls);
      
      let oversProcessed = 0;
      const processingErrors = [];

      for (const [overKey, balls] of Object.entries(overGroups)) {
        try {
          const overFeatures = await this.calculateOverFeatures(match, overKey, balls);
          
          if (overFeatures) {
            await this.saveOverFeatures(overFeatures);
            oversProcessed++;
          }
        } catch (error) {
          logger.warn('Error processing over features', {
            matchId,
            overKey,
            error: error.message
          });
          processingErrors.push(`Over ${overKey}: ${error.message}`);
        }
      }

      return {
        success: oversProcessed > 0,
        matchId,
        oversProcessed,
        totalOvers: Object.keys(overGroups).length,
        errors: processingErrors.length > 0 ? processingErrors : undefined
      };

    } catch (error) {
      logger.error('Failed to process match features', {
        matchId: match.fixtureId,
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        matchId: match.fixtureId,
        error: error.message,
        oversProcessed: 0
      };
    }
  }

  /**
   * Group balls by over number and innings
   * @param {Array} balls Array of ball objects
   * @returns {Object} Grouped balls by over key
   */
  groupBallsByOver(balls) {
    const overGroups = {};
    
    for (const ball of balls) {
      try {
        const overNumber = Math.floor(ball.ball);
        const innings = this.determineInnings(ball);
        const overKey = `${innings}_${overNumber}`;
        
        if (!overGroups[overKey]) {
          overGroups[overKey] = [];
        }
        
        overGroups[overKey].push(ball);
      } catch (error) {
        logger.warn('Error grouping ball by over', {
          ballId: ball.id,
          error: error.message
        });
      }
    }
    
    // Sort balls within each over
    Object.keys(overGroups).forEach(overKey => {
      overGroups[overKey].sort((a, b) => a.ball - b.ball);
    });
    
    return overGroups;
  }

  /**
   * Determine innings from ball data
   * @param {Object} ball Ball object
   * @returns {Number} Innings number (1 or 2)
   */
  determineInnings(ball) {
    // This is a simplified approach - in reality, you might need more sophisticated logic
    // based on your data structure to determine innings
    return ball.ball <= 20 ? 1 : 2; // Assuming T20 format
  }

  /**
   * Calculate comprehensive features for an over
   * @param {Object} match Match document
   * @param {string} overKey Over key (innings_over)
   * @param {Array} balls Array of balls in the over
   * @returns {Promise<Object>} Over features object
   */
  async calculateOverFeatures(match, overKey, balls) {
    try {
      const [innings, overNumber] = overKey.split('_').map(Number);
      
      if (!balls || balls.length === 0) {
        return null;
      }

      // Calculate basic over statistics
      const overStats = this.calculateOverStatistics(balls);
      
      // Calculate cumulative match statistics
      const cumulativeStats = await this.calculateCumulativeStats(match, innings, overNumber);
      
      // Calculate player statistics
      const playerStats = this.calculatePlayerStatistics(balls);
      
      // Calculate momentum and form indicators
      const momentum = await this.calculateMomentumIndicators(match, innings, overNumber);
      
      // Extract match context
      const matchContext = this.extractMatchContext(match);
      
      // Validate data quality
      const dataQuality = this.validateDataQuality(balls, overStats);

      const overFeatures = {
        matchId: match.fixtureId,
        fixtureId: match.fixtureId,
        innings,
        overNumber,
        teamBatting: this.getBattingTeam(match, innings),
        teamBowling: this.getBowlingTeam(match, innings),
        
        // Over-level aggregates
        overRuns: overStats.totalRuns,
        overWickets: overStats.wickets,
        overBalls: overStats.balls,
        overExtras: overStats.extras,
        overBoundaries: overStats.boundaries,
        overSixes: overStats.sixes,
        
        // Cumulative match state
        totalRuns: cumulativeStats.totalRuns,
        totalWickets: cumulativeStats.totalWickets,
        totalOvers: cumulativeStats.totalOvers,
        runRate: cumulativeStats.runRate,
        requiredRunRate: cumulativeStats.requiredRunRate,
        
        // Player performance
        batsmanStats: playerStats.batsman,
        bowlerStats: playerStats.bowler,
        
        // Momentum indicators
        momentum,
        
        // Match context
        matchContext,
        
        // Temporal features
        timestamp: new Date(),
        overStartTime: this.getOverStartTime(balls),
        overEndTime: this.getOverEndTime(balls),
        
        // Data quality
        dataQuality
      };

      return overFeatures;

    } catch (error) {
      logger.error('Failed to calculate over features', {
        matchId: match.fixtureId,
        overKey,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Calculate basic statistics for an over
   * @param {Array} balls Array of balls in the over
   * @returns {Object} Over statistics
   */
  calculateOverStatistics(balls) {
    let totalRuns = 0;
    let wickets = 0;
    let extras = 0;
    let boundaries = 0;
    let sixes = 0;
    let dotBalls = 0;

    for (const ball of balls) {
      if (ball.score) {
        const runs = ball.score.runs || 0;
        totalRuns += runs;
        
        if (runs === 0) dotBalls++;
        if (ball.score.four) boundaries++;
        if (ball.score.six) sixes++;
        if (ball.score.is_wicket) wickets++;
        
        // Count extras (byes, leg byes, noballs)
        extras += (ball.score.bye || 0) + (ball.score.leg_bye || 0) + (ball.score.noball_runs || 0);
      }
    }

    return {
      totalRuns,
      wickets,
      balls: balls.length,
      extras,
      boundaries,
      sixes,
      dotBalls
    };
  }

  /**
   * Calculate cumulative match statistics up to current over
   * @param {Object} match Match document
   * @param {Number} innings Current innings
   * @param {Number} overNumber Current over number
   * @returns {Promise<Object>} Cumulative statistics
   */
  async calculateCumulativeStats(match, innings, overNumber) {
    try {
      // Get all overs up to current over for cumulative calculation
      const previousOvers = await this.featureCollection.find({
        matchId: match.fixtureId,
        innings,
        overNumber: { $lte: overNumber }
      }).sort({ overNumber: 1 });

      let totalRuns = 0;
      let totalWickets = 0;
      let totalOvers = 0;

      for (const over of previousOvers) {
        totalRuns += over.overRuns || 0;
        totalWickets += over.overWickets || 0;
        totalOvers += (over.overBalls || 6) / 6; // Convert balls to overs
      }

      const runRate = totalOvers > 0 ? totalRuns / totalOvers : 0;
      
      // Calculate required run rate (simplified)
      const target = this.getMatchTarget(match);
      const requiredRunRate = target > 0 && innings === 2 ? 
        (target - totalRuns) / Math.max(1, (20 - totalOvers)) : 0;

      return {
        totalRuns,
        totalWickets,
        totalOvers,
        runRate: Math.round(runRate * 100) / 100,
        requiredRunRate: Math.round(requiredRunRate * 100) / 100
      };

    } catch (error) {
      logger.warn('Error calculating cumulative stats', {
        matchId: match.fixtureId,
        innings,
        overNumber,
        error: error.message
      });
      
      return {
        totalRuns: 0,
        totalWickets: 0,
        totalOvers: overNumber,
        runRate: 0,
        requiredRunRate: 0
      };
    }
  }

  /**
   * Calculate player statistics for the over
   * @param {Array} balls Array of balls in the over
   * @returns {Object} Player statistics
   */
  calculatePlayerStatistics(balls) {
    const batsmanStats = { striker: { runs: 0, balls: 0 }, nonStriker: { runs: 0, balls: 0 } };
    const bowlerStats = { runs: 0, wickets: 0, balls: 0, dotBalls: 0 };

    let currentStriker = null;
    let currentNonStriker = null;
    let currentBowler = null;

    for (const ball of balls) {
      // Update batsman information
      if (ball.batsman) {
        if (!currentStriker) currentStriker = ball.batsman;
        if (ball.batsman.id !== currentStriker.id) {
          // Switch striker/non-striker
          [currentStriker, currentNonStriker] = [currentNonStriker, currentStriker];
        }
      }

      // Update bowler information
      if (ball.bowler && !currentBowler) {
        currentBowler = ball.bowler;
      }

      // Calculate statistics
      if (ball.score) {
        const runs = ball.score.runs || 0;
        
        // Update batsman stats
        if (currentStriker) {
          batsmanStats.striker.runs += runs;
          batsmanStats.striker.balls++;
          batsmanStats.striker.strikeRate = batsmanStats.striker.balls > 0 ? 
            (batsmanStats.striker.runs / batsmanStats.striker.balls) * 100 : 0;
        }

        // Update bowler stats
        if (currentBowler) {
          bowlerStats.runs += runs;
          bowlerStats.balls++;
          if (runs === 0) bowlerStats.dotBalls++;
          if (ball.score.is_wicket) bowlerStats.wickets++;
        }
      }
    }

    // Calculate economy rate
    if (bowlerStats.balls > 0) {
      bowlerStats.economyRate = (bowlerStats.runs / bowlerStats.balls) * 6;
    }

    return {
      batsman: {
        striker: {
          ...batsmanStats.striker,
          playerId: currentStriker?.id?.toString(),
          name: currentStriker?.fullname || 'Unknown'
        },
        nonStriker: {
          ...batsmanStats.nonStriker,
          playerId: currentNonStriker?.id?.toString(),
          name: currentNonStriker?.fullname || 'Unknown'
        }
      },
      bowler: {
        ...bowlerStats,
        playerId: currentBowler?.id?.toString(),
        name: currentBowler?.fullname || 'Unknown'
      }
    };
  }

  /**
   * Calculate momentum and form indicators
   * @param {Object} match Match document
   * @param {Number} innings Current innings
   * @param {Number} overNumber Current over number
   * @returns {Promise<Object>} Momentum indicators
   */
  async calculateMomentumIndicators(match, innings, overNumber) {
    try {
      // Get recent overs for momentum calculation
      const recentOvers = await this.featureCollection.find({
        matchId: match.fixtureId,
        innings,
        overNumber: { $gte: Math.max(1, overNumber - 5), $lt: overNumber }
      }).sort({ overNumber: -1 }).limit(5);

      let recentRunRate = 0;
      if (recentOvers.length > 0) {
        const totalRuns = recentOvers.reduce((sum, over) => sum + (over.overRuns || 0), 0);
        const totalOvers = recentOvers.reduce((sum, over) => sum + (over.overBalls || 6) / 6, 0);
        recentRunRate = totalOvers > 0 ? totalRuns / totalOvers : 0;
      }

      // Calculate wickets in hand
      const wicketsInHand = 10 - (await this.getTotalWickets(match, innings, overNumber));

      // Calculate pressure index (simplified)
      const pressureIndex = this.calculatePressureIndex(match, innings, overNumber, recentRunRate);

      return {
        recentRunRate: Math.round(recentRunRate * 100) / 100,
        wicketsInHand,
        pressureIndex,
        partnershipRuns: 0, // Would need more complex logic to track partnerships
        partnershipBalls: 0
      };

    } catch (error) {
      logger.warn('Error calculating momentum indicators', {
        matchId: match.fixtureId,
        innings,
        overNumber,
        error: error.message
      });
      
      return {
        recentRunRate: 0,
        wicketsInHand: 10,
        pressureIndex: 0,
        partnershipRuns: 0,
        partnershipBalls: 0
      };
    }
  }

  /**
   * Extract match context information
   * @param {Object} match Match document
   * @returns {Object} Match context
   */
  extractMatchContext(match) {
    const target = this.getMatchTarget(match);
    const isChase = target > 0;
    
    return {
      target,
      chase: isChase,
      powerplay: false, // Would need over number to determine
      deathOvers: false, // Would need over number to determine
      venue: match.venue,
      format: match.format,
      series: match.series
    };
  }

  /**
   * Validate data quality for the over
   * @param {Array} balls Array of balls in the over
   * @param {Object} overStats Over statistics
   * @returns {Object} Data quality indicators
   */
  validateDataQuality(balls, overStats) {
    const validationErrors = [];
    let missingBalls = 0;

    // Check for complete over (should have 6 balls)
    if (balls.length < 6) {
      missingBalls = 6 - balls.length;
      validationErrors.push(`Incomplete over: missing ${missingBalls} balls`);
    }

    // Check for missing score information
    const ballsWithoutScore = balls.filter(ball => !ball.score).length;
    if (ballsWithoutScore > 0) {
      validationErrors.push(`${ballsWithoutScore} balls missing score information`);
    }

    return {
      complete: validationErrors.length === 0,
      missingBalls,
      validationErrors
    };
  }

  /**
   * Save over features to MongoDB
   * @param {Object} overFeatures Over features object
   * @returns {Promise<Object>} Save result
   */
  async saveOverFeatures(overFeatures) {
    try {
      const result = await this.featureCollection.findOneAndUpdate(
        {
          matchId: overFeatures.matchId,
          innings: overFeatures.innings,
          overNumber: overFeatures.overNumber
        },
        overFeatures,
        { upsert: true, new: true, runValidators: true }
      );

      logger.debug('Saved over features', {
        matchId: overFeatures.matchId,
        innings: overFeatures.innings,
        overNumber: overFeatures.overNumber,
        featureId: result._id
      });

      return {
        success: true,
        featureId: result._id,
        matchId: overFeatures.matchId,
        overNumber: overFeatures.overNumber
      };

    } catch (error) {
      logger.error('Failed to save over features', {
        matchId: overFeatures.matchId,
        innings: overFeatures.innings,
        overNumber: overFeatures.overNumber,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Helper methods
  getBattingTeam(match, innings) {
    return innings === 1 ? match.teams.home : match.teams.away;
  }

  getBowlingTeam(match, innings) {
    return innings === 1 ? match.teams.away : match.teams.home;
  }

  getMatchTarget(match) {
    // Simplified - would need more complex logic based on match format
    return 0; // No target for first innings
  }

  getOverStartTime(balls) {
    return balls.length > 0 ? new Date(balls[0].updated_at) : new Date();
  }

  getOverEndTime(balls) {
    return balls.length > 0 ? new Date(balls[balls.length - 1].updated_at) : new Date();
  }

  async getTotalWickets(match, innings, overNumber) {
    try {
      const result = await this.featureCollection.aggregate([
        {
          $match: {
            matchId: match.fixtureId,
            innings,
            overNumber: { $lte: overNumber }
          }
        },
        {
          $group: {
            _id: null,
            totalWickets: { $sum: '$overWickets' }
          }
        }
      ]);
      
      return result.length > 0 ? result[0].totalWickets : 0;
    } catch (error) {
      logger.warn('Error getting total wickets', { error: error.message });
      return 0;
    }
  }

  calculatePressureIndex(match, innings, overNumber, recentRunRate) {
    // Simplified pressure calculation
    const target = this.getMatchTarget(match);
    if (target === 0 || innings === 1) return 0;
    
    const requiredRate = (target / 20); // Assuming T20
    const pressureRatio = recentRunRate / Math.max(requiredRate, 0.1);
    
    return Math.round(pressureRatio * 100) / 100;
  }

  /**
   * Get feature engineering statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    try {
      const stats = await this.featureCollection.aggregate([
        {
          $group: {
            _id: null,
            totalOvers: { $sum: 1 },
            totalMatches: { $addToSet: '$matchId' },
            avgRunRate: { $avg: '$runRate' },
            totalRuns: { $sum: '$overRuns' },
            totalWickets: { $sum: '$overWickets' }
          }
        },
        {
          $project: {
            _id: 0,
            totalOvers: 1,
            totalMatches: { $size: '$totalMatches' },
            avgRunRate: { $round: ['$avgRunRate', 2] },
            totalRuns: 1,
            totalWickets: 1
          }
        }
      ]);

      return {
        success: true,
        statistics: stats.length > 0 ? stats[0] : {
          totalOvers: 0,
          totalMatches: 0,
          avgRunRate: 0,
          totalRuns: 0,
          totalWickets: 0
        }
      };

    } catch (error) {
      logger.error('Failed to get feature engineering statistics', {
        error: error.message
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
      service: 'FeatureEngineer',
      connected: !!this.databaseService?.connected,
      collection: 'OverFeatures',
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = FeatureEngineer;
