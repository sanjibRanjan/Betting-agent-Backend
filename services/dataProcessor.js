'use strict';

const logger = require('../utils/loggerService');

/**
 * Enhanced Data Processing Service for Cricket Betting Agent
 * Handles data normalization and Redis state management for live match data
 */
class DataProcessor {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.stateTTL = 120; // 120 seconds TTL for normalized state
  }

  /**
   * Normalize raw match data from SportMonks API into consistent schema
   * @param {Object} rawData Raw match data from API
   * @returns {Promise<Object>} Normalized match data
   */
  async normalizeMatchData(rawData) {
    try {
      if (!rawData || !rawData.matches || !Array.isArray(rawData.matches)) {
        logger.warn('Invalid raw data provided to normalizeMatchData', {
          hasRawData: !!rawData,
          hasMatches: !!(rawData && rawData.matches),
          isArray: Array.isArray(rawData?.matches)
        });
        return null;
      }

      const normalizedMatches = [];

      for (const match of rawData.matches) {
        try {
          const normalizedMatch = this.extractCoreAttributes(match);
          if (normalizedMatch) {
            normalizedMatches.push(normalizedMatch);
          }
        } catch (error) {
          logger.error('Error normalizing individual match', {
            matchId: match.id || 'unknown',
            error: error.message
          });
        }
      }

      logger.info(`Successfully normalized ${normalizedMatches.length} matches`, {
        totalMatches: rawData.matches.length,
        normalizedCount: normalizedMatches.length
      });

      return {
        matches: normalizedMatches,
        timestamp: new Date().toISOString(),
        source: 'data_processor',
        totalMatches: rawData.matches.length,
        normalizedCount: normalizedMatches.length
      };

    } catch (error) {
      logger.error('Failed to normalize match data', {
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Extract core attributes from a single match object with enhanced validation
   * @param {Object} match Raw match object
   * @returns {Object|null} Normalized match object or null if invalid
   */
  extractCoreAttributes(match) {
    try {
      // Validate input match object
      if (!match || typeof match !== 'object') {
        logger.warn('Invalid match object provided to extractCoreAttributes', {
          match: match
        });
        return null;
      }

      // Extract team information with null checks and validation
      const homeTeam = this.validateTeamName(
        match.teamDetails?.local?.name || 
        match.teams?.home || 
        match.localTeam || 
        'Unknown'
      );
      const awayTeam = this.validateTeamName(
        match.teamDetails?.visitor?.name || 
        match.teams?.away || 
        match.visitorTeam || 
        'Unknown'
      );
      
      // Validate that we have valid team names
      if (homeTeam === 'Unknown' && awayTeam === 'Unknown') {
        logger.warn('No valid team information found', {
          matchId: match.id || match.fixtureId,
          teamDetails: match.teamDetails,
          teams: match.teams
        });
      }
      
      // Extract match ID with validation
      const matchId = this.validateMatchId(
        match.fixtureId || 
        match.id || 
        `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      );
      
      // Extract score information with validation
      const scoreInfo = this.extractScoreInfo(match);
      if (!scoreInfo) {
        logger.warn('Failed to extract score information', { matchId });
        return null;
      }
      
      // Extract ball-by-ball information with validation
      const ballByBallInfo = this.extractBallByBallInfo(match);
      if (!ballByBallInfo) {
        logger.warn('Failed to extract ball-by-ball information', { matchId });
        return null;
      }
      
      // Calculate run rate with validation
      const runRate = this.calculateRunRate(scoreInfo.totalRuns, scoreInfo.overs);
      
      // Validate data quality
      const dataQuality = this.assessDataQuality(match, scoreInfo, ballByBallInfo);
      
      // Create normalized match object with comprehensive validation
      const normalizedMatch = {
        matchId: matchId,
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        totalRuns: scoreInfo.totalRuns,
        wickets: scoreInfo.wickets,
        overs: scoreInfo.overs,
        runRate: runRate,
        lastBallRuns: ballByBallInfo.lastBallRuns,
        batsman: ballByBallInfo.batsman,
        bowler: ballByBallInfo.bowler,
        timestamp: new Date().toISOString(),
        // Additional metadata with validation
        status: this.validateStatus(match.status),
        venue: this.validateVenue(match.venue),
        format: this.validateFormat(match.format),
        series: this.validateSeries(match.series),
        // Data quality assessment
        dataQuality: dataQuality,
        // Original match data for reference (safely extracted)
        originalMatch: {
          id: match.id || null,
          fixtureId: match.fixtureId || null,
          leagueId: match.leagueId || null,
          seasonId: match.seasonId || null
        }
      };

      // Final validation check
      if (!this.isValidNormalizedMatch(normalizedMatch)) {
        logger.error('Generated normalized match failed validation', {
          matchId,
          normalizedMatch
        });
        return null;
      }

      return normalizedMatch;

    } catch (error) {
      logger.error('Failed to extract core attributes', {
        matchId: match.id || 'unknown',
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract score information from match object with enhanced validation
   * @param {Object} match Raw match object
   * @returns {Object|null} Score information or null if invalid
   */
  extractScoreInfo(match) {
    try {
      if (!match || typeof match !== 'object') {
        logger.warn('Invalid match object provided to extractScoreInfo');
        return null;
      }

      // Default values
      let totalRuns = 0;
      let wickets = 0;
      let overs = 0;
      let extracted = false;

      // Method 1: Try to extract from score string (format: "Team 245/4 (45.2)")
      if (match.score && typeof match.score === 'string') {
        const scoreMatch = match.score.match(/(\d+)\/(\d+)\s*\(([0-9.]+)\)/);
        if (scoreMatch) {
          const extractedRuns = parseInt(scoreMatch[1], 10);
          const extractedWickets = parseInt(scoreMatch[2], 10);
          const extractedOvers = parseFloat(scoreMatch[3]);
          
          // Validate extracted values
          if (!isNaN(extractedRuns) && !isNaN(extractedWickets) && !isNaN(extractedOvers)) {
            totalRuns = Math.max(0, extractedRuns);
            wickets = Math.max(0, Math.min(10, extractedWickets)); // Wickets: 0-10
            overs = Math.max(0, extractedOvers);
            extracted = true;
            
            logger.debug('Extracted score from score string', {
              matchId: match.fixtureId || match.id,
              totalRuns,
              wickets,
              overs,
              originalScore: match.score
            });
          }
        }
      }

      // Method 2: Try to extract from dataQuality object if available
      if (!extracted && match.dataQuality?.hasScore) {
        // Look for structured score data
        if (match.scoreData && typeof match.scoreData === 'object') {
          if (typeof match.scoreData.runs === 'number' && match.scoreData.runs >= 0) {
            totalRuns = match.scoreData.runs;
          }
          if (typeof match.scoreData.wickets === 'number' && match.scoreData.wickets >= 0 && match.scoreData.wickets <= 10) {
            wickets = match.scoreData.wickets;
          }
          if (typeof match.scoreData.overs === 'number' && match.scoreData.overs >= 0) {
            overs = match.scoreData.overs;
          }
          extracted = true;
        }
      }

      // Method 3: Try to extract from ball-by-ball data
      if (!extracted && match.ballByBall && typeof match.ballByBall === 'object') {
        const ballByBall = match.ballByBall;
        
        if (ballByBall.lastBall && typeof ballByBall.lastBall === 'object') {
          const lastBall = ballByBall.lastBall;
          
          // Extract over information from ball notation (e.g., "45.2")
          if (lastBall.ball && typeof lastBall.ball === 'string') {
            const overMatch = lastBall.ball.match(/([0-9]+)\.([0-9]+)/);
            if (overMatch) {
              const overNumber = parseInt(overMatch[1], 10);
              const ballInOver = parseInt(overMatch[2], 10);
              
              if (!isNaN(overNumber) && !isNaN(ballInOver) && ballInOver >= 0 && ballInOver <= 6) {
                overs = overNumber + (ballInOver / 6);
                extracted = true;
              }
            }
          }
        }
        
        // Try to calculate runs from recent balls if no other source
        if (totalRuns === 0 && Array.isArray(ballByBall.recentBalls)) {
          const calculatedRuns = ballByBall.recentBalls.reduce((sum, ball) => {
            if (ball && typeof ball.runs === 'number' && ball.runs >= 0) {
              return sum + ball.runs;
            }
            return sum;
          }, 0);
          
          if (calculatedRuns > 0) {
            totalRuns = calculatedRuns;
            extracted = true;
            
            logger.debug('Calculated runs from recent balls', {
              matchId: match.fixtureId || match.id,
              calculatedRuns,
              recentBallsCount: ballByBall.recentBalls.length
            });
          }
        }
      }

      // Method 4: Try alternative score formats
      if (!extracted) {
        // Look for alternative score patterns in the score string
        if (match.score && typeof match.score === 'string') {
          // Pattern: "245 for 4" or "245-4"
          const altPattern1 = match.score.match(/(\d+)\s*(?:for|-)\s*(\d+)/i);
          if (altPattern1) {
            const extractedRuns = parseInt(altPattern1[1], 10);
            const extractedWickets = parseInt(altPattern1[2], 10);
            
            if (!isNaN(extractedRuns) && !isNaN(extractedWickets)) {
              totalRuns = Math.max(0, extractedRuns);
              wickets = Math.max(0, Math.min(10, extractedWickets));
              extracted = true;
            }
          }
          
          // Pattern: just runs "245"
          if (!extracted) {
            const runsOnly = match.score.match(/^(\d+)$/);
            if (runsOnly) {
              const extractedRuns = parseInt(runsOnly[1], 10);
              if (!isNaN(extractedRuns)) {
                totalRuns = Math.max(0, extractedRuns);
                extracted = true;
              }
            }
          }
        }
      }

      // Validate final values
      if (totalRuns < 0 || wickets < 0 || wickets > 10 || overs < 0 || overs > 50) {
        logger.warn('Extracted score values are out of valid cricket ranges', {
          matchId: match.fixtureId || match.id,
          totalRuns,
          wickets,
          overs
        });
        
        // Reset to safe values
        totalRuns = Math.max(0, Math.min(1000, totalRuns)); // Max reasonable runs
        wickets = Math.max(0, Math.min(10, wickets));
        overs = Math.max(0, Math.min(50, overs)); // Max overs in ODI
      }

      const scoreInfo = {
        totalRuns,
        wickets,
        overs,
        extracted,
        isValid: extracted && (totalRuns > 0 || wickets > 0 || overs > 0)
      };

      logger.debug('Extracted score information', {
        matchId: match.fixtureId || match.id,
        scoreInfo,
        source: match.score
      });

      return scoreInfo;

    } catch (error) {
      logger.warn('Failed to extract score info', {
        matchId: match.id || 'unknown',
        error: error.message
      });
      return { totalRuns: 0, wickets: 0, overs: 0 };
    }
  }

  /**
   * Extract ball-by-ball information from match object with validation
   * @param {Object} match Raw match object
   * @returns {Object|null} Ball-by-ball information or null if invalid
   */
  extractBallByBallInfo(match) {
    try {
      if (!match || typeof match !== 'object') {
        logger.warn('Invalid match object provided to extractBallByBallInfo');
        return null;
      }

      let lastBallRuns = 0;
      let batsman = 'Unknown';
      let bowler = 'Unknown';
      let extracted = false;

      if (match.ballByBall && typeof match.ballByBall === 'object') {
        const ballByBall = match.ballByBall;
        
        // Method 1: Extract from last ball with validation
        if (ballByBall.lastBall && typeof ballByBall.lastBall === 'object') {
          const lastBall = ballByBall.lastBall;
          
          // Validate runs
          if (typeof lastBall.runs === 'number' && lastBall.runs >= 0 && lastBall.runs <= 6) {
            lastBallRuns = lastBall.runs;
            extracted = true;
          } else if (typeof lastBall.runs === 'string') {
            const parsedRuns = parseInt(lastBall.runs, 10);
            if (!isNaN(parsedRuns) && parsedRuns >= 0 && parsedRuns <= 6) {
              lastBallRuns = parsedRuns;
              extracted = true;
            }
          }
          
          // Validate batsman
          if (typeof lastBall.batsman === 'string' && lastBall.batsman.trim().length > 0) {
            batsman = this.sanitizePlayerName(lastBall.batsman);
          } else if (typeof lastBall.batsman_one === 'string' && lastBall.batsman_one.trim().length > 0) {
            batsman = this.sanitizePlayerName(lastBall.batsman_one);
          }
          
          // Validate bowler
          if (typeof lastBall.bowler === 'string' && lastBall.bowler.trim().length > 0) {
            bowler = this.sanitizePlayerName(lastBall.bowler);
          } else if (typeof lastBall.bowler_name === 'string' && lastBall.bowler_name.trim().length > 0) {
            bowler = this.sanitizePlayerName(lastBall.bowler_name);
          }
          
          logger.debug('Extracted ball info from lastBall', {
            matchId: match.fixtureId || match.id,
            lastBallRuns,
            batsman,
            bowler
          });
        }
        
        // Method 2: If no last ball, try recent balls with validation
        if (!extracted && Array.isArray(ballByBall.recentBalls) && ballByBall.recentBalls.length > 0) {
          // Find the most recent valid ball
          for (let i = ballByBall.recentBalls.length - 1; i >= 0; i--) {
            const recentBall = ballByBall.recentBalls[i];
            
            if (recentBall && typeof recentBall === 'object') {
              // Validate runs
              if (!extracted && typeof recentBall.runs === 'number' && recentBall.runs >= 0 && recentBall.runs <= 6) {
                lastBallRuns = recentBall.runs;
                extracted = true;
              }
              
              // Update batsman if still unknown
              if (batsman === 'Unknown' && typeof recentBall.batsman === 'string' && recentBall.batsman.trim().length > 0) {
                batsman = this.sanitizePlayerName(recentBall.batsman);
              }
              
              // Update bowler if still unknown
              if (bowler === 'Unknown' && typeof recentBall.bowler === 'string' && recentBall.bowler.trim().length > 0) {
                bowler = this.sanitizePlayerName(recentBall.bowler);
              }
              
              // Break if we have all the info we need
              if (extracted && batsman !== 'Unknown' && bowler !== 'Unknown') {
                break;
              }
            }
          }
          
          if (extracted) {
            logger.debug('Extracted ball info from recentBalls', {
              matchId: match.fixtureId || match.id,
              lastBallRuns,
              batsman,
              bowler,
              recentBallsCount: ballByBall.recentBalls.length
            });
          }
        }
      }

      // Additional validation for extracted data
      if (lastBallRuns < 0 || lastBallRuns > 6) {
        logger.warn('Invalid ball runs detected, resetting to 0', {
          matchId: match.fixtureId || match.id,
          invalidRuns: lastBallRuns
        });
        lastBallRuns = 0;
      }

      const ballInfo = {
        lastBallRuns,
        batsman,
        bowler,
        extracted,
        isValid: extracted || (batsman !== 'Unknown' || bowler !== 'Unknown')
      };

      logger.debug('Extracted ball-by-ball information', {
        matchId: match.fixtureId || match.id,
        ballInfo
      });

      return ballInfo;

    } catch (error) {
      logger.error('Failed to extract ball-by-ball info', {
        matchId: match?.id || match?.fixtureId || 'unknown',
        error: error.message,
        stack: error.stack
      });
      
      return {
        lastBallRuns: 0,
        batsman: 'Unknown',
        bowler: 'Unknown',
        extracted: false,
        isValid: false
      };
    }
  }

  /**
   * Sanitize and validate player name
   * @param {string} name - Raw player name
   * @returns {string} Sanitized player name
   */
  sanitizePlayerName(name) {
    if (!name || typeof name !== 'string') {
      return 'Unknown';
    }
    
    // Remove extra whitespace and validate length
    const sanitized = name.trim();
    if (sanitized.length === 0 || sanitized.length > 50) {
      return 'Unknown';
    }
    
    // Basic validation: should contain at least one letter
    if (!/[a-zA-Z]/.test(sanitized)) {
      return 'Unknown';
    }
    
    return sanitized;
  }

  /**
   * Validate team name
   * @param {string} teamName - Raw team name
   * @returns {string} Validated team name
   */
  validateTeamName(teamName) {
    if (!teamName || typeof teamName !== 'string') {
      return 'Unknown';
    }
    
    const sanitized = teamName.trim();
    if (sanitized.length === 0 || sanitized.length > 30) {
      return 'Unknown';
    }
    
    return sanitized;
  }

  /**
   * Validate match ID
   * @param {string|number} matchId - Raw match ID
   * @returns {string} Validated match ID
   */
  validateMatchId(matchId) {
    if (!matchId) {
      return `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    const id = String(matchId).trim();
    if (id.length === 0 || id.length > 50) {
      return `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    return id;
  }

  /**
   * Validate match status
   * @param {string} status - Raw status
   * @returns {string} Validated status
   */
  validateStatus(status) {
    if (!status || typeof status !== 'string') {
      return 'unknown';
    }
    
    const validStatuses = ['live', 'finished', 'scheduled', 'postponed', 'cancelled', 'unknown'];
    const normalized = status.toLowerCase().trim();
    
    return validStatuses.includes(normalized) ? normalized : 'unknown';
  }

  /**
   * Validate venue information
   * @param {string} venue - Raw venue
   * @returns {string|null} Validated venue
   */
  validateVenue(venue) {
    if (!venue || typeof venue !== 'string') {
      return null;
    }
    
    const sanitized = venue.trim();
    if (sanitized.length === 0 || sanitized.length > 100) {
      return null;
    }
    
    return sanitized;
  }

  /**
   * Validate match format
   * @param {string} format - Raw format
   * @returns {string} Validated format
   */
  validateFormat(format) {
    if (!format || typeof format !== 'string') {
      return 'unknown';
    }
    
    const validFormats = ['test', 't20', 'odi', 'first-class', 't10', 'unknown'];
    const normalized = format.toLowerCase().trim();
    
    return validFormats.includes(normalized) ? normalized : 'unknown';
  }

  /**
   * Validate series information
   * @param {string} series - Raw series
   * @returns {string|null} Validated series
   */
  validateSeries(series) {
    if (!series || typeof series !== 'string') {
      return null;
    }
    
    const sanitized = series.trim();
    if (sanitized.length === 0 || sanitized.length > 100) {
      return null;
    }
    
    return sanitized;
  }

  /**
   * Assess overall data quality of extracted information
   * @param {Object} match - Original match object
   * @param {Object} scoreInfo - Extracted score info
   * @param {Object} ballByBallInfo - Extracted ball-by-ball info
   * @returns {Object} Data quality assessment
   */
  assessDataQuality(match, scoreInfo, ballByBallInfo) {
    const quality = {
      hasValidScore: scoreInfo?.isValid || false,
      hasValidBalls: ballByBallInfo?.isValid || false,
      hasValidTeams: !!(match.teams || match.teamDetails),
      hasValidStatus: !!(match.status),
      hasValidVenue: !!(match.venue),
      completeness: 0
    };
    
    // Calculate completeness score
    const checks = Object.values(quality).filter(v => typeof v === 'boolean');
    const passedChecks = checks.filter(Boolean).length;
    quality.completeness = Math.round((passedChecks / checks.length) * 100) / 100;
    
    return quality;
  }

  /**
   * Validate final normalized match object
   * @param {Object} normalizedMatch - Normalized match object
   * @returns {boolean} True if valid
   */
  isValidNormalizedMatch(normalizedMatch) {
    if (!normalizedMatch || typeof normalizedMatch !== 'object') {
      return false;
    }
    
    // Required fields validation
    const requiredFields = ['matchId', 'homeTeam', 'awayTeam', 'timestamp'];
    for (const field of requiredFields) {
      if (!normalizedMatch[field]) {
        logger.warn(`Missing required field: ${field}`, {
          matchId: normalizedMatch.matchId
        });
        return false;
      }
    }
    
    // Data type validation
    if (typeof normalizedMatch.totalRuns !== 'number' || normalizedMatch.totalRuns < 0) {
      return false;
    }
    
    if (typeof normalizedMatch.wickets !== 'number' || normalizedMatch.wickets < 0 || normalizedMatch.wickets > 10) {
      return false;
    }
    
    if (typeof normalizedMatch.overs !== 'number' || normalizedMatch.overs < 0) {
      return false;
    }
    
    if (typeof normalizedMatch.runRate !== 'number' || normalizedMatch.runRate < 0) {
      return false;
    }
    
    return true;
  }

  /**
   * Calculate run rate from runs and overs
   * @param {number} runs Total runs
   * @param {number} overs Total overs
   * @returns {number} Run rate
   */
  calculateRunRate(runs, overs) {
    try {
      if (overs > 0) {
        return Math.round((runs / overs) * 100) / 100; // Round to 2 decimal places
      }
      return 0;
    } catch (error) {
      logger.warn('Failed to calculate run rate', {
        runs,
        overs,
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Store normalized state in Redis with proper key management
   * @param {string} matchId Match ID
   * @param {Object} normalizedData Normalized match data
   * @returns {Promise<boolean>} Success status
   */
  async storeNormalizedState(matchId, normalizedData) {
    try {
      if (!matchId || !normalizedData) {
        logger.warn('Invalid parameters for storeNormalizedState', {
          hasMatchId: !!matchId,
          hasNormalizedData: !!normalizedData
        });
        return false;
      }

      const currentKey = `match:state:${matchId}:current`;
      const previousKey = `match:state:${matchId}:previous`;

      // Copy current state to previous before overwriting
      await this.copyCurrentToPrevious(currentKey, previousKey);

      // Store current normalized state
      const stateData = {
        ...normalizedData,
        processedAt: new Date().toISOString(),
        version: '1.0'
      };

      await this.redisClient.set(currentKey, JSON.stringify(stateData), { EX: this.stateTTL });

      logger.info(`Stored normalized state for match ${matchId}`, {
        matchId,
        currentKey,
        previousKey,
        ttl: this.stateTTL
      });

      return true;

    } catch (error) {
      logger.error('Failed to store normalized state', {
        matchId,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Copy current state to previous state before updating
   * @param {string} currentKey Current state key
   * @param {string} previousKey Previous state key
   * @returns {Promise<boolean>} Success status
   */
  async copyCurrentToPrevious(currentKey, previousKey) {
    try {
      const currentData = await this.redisClient.get(currentKey);
      if (currentData) {
        await this.redisClient.set(previousKey, currentData, { EX: this.stateTTL });
        logger.debug(`Copied current state to previous for key: ${currentKey}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.warn('Failed to copy current to previous state', {
        currentKey,
        previousKey,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Retrieve current normalized state for a match
   * @param {string} matchId Match ID
   * @returns {Promise<Object|null>} Current normalized state or null
   */
  async getCurrentState(matchId) {
    try {
      const currentKey = `match:state:${matchId}:current`;
      const currentData = await this.redisClient.get(currentKey);
      
      if (currentData) {
        return JSON.parse(currentData);
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get current state', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Retrieve previous normalized state for a match
   * @param {string} matchId Match ID
   * @returns {Promise<Object|null>} Previous normalized state or null
   */
  async getPreviousState(matchId) {
    try {
      const previousKey = `match:state:${matchId}:previous`;
      const previousData = await this.redisClient.get(previousKey);
      
      if (previousData) {
        return JSON.parse(previousData);
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get previous state', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Process and store normalized data for all matches
   * @param {Object} rawData Raw match data from API
   * @returns {Promise<Object>} Processing result
   */
  async processAndStoreMatches(rawData) {
    try {
      const normalizedData = await this.normalizeMatchData(rawData);
      
      if (!normalizedData || !normalizedData.matches) {
        return {
          success: false,
          error: 'Failed to normalize match data',
          processedCount: 0
        };
      }

      let processedCount = 0;
      const errors = [];

      // Process each normalized match
      for (const normalizedMatch of normalizedData.matches) {
        try {
          const success = await this.storeNormalizedState(normalizedMatch.matchId, normalizedMatch);
          if (success) {
            processedCount++;
          } else {
            errors.push(`Failed to store state for match ${normalizedMatch.matchId}`);
          }
        } catch (error) {
          errors.push(`Error processing match ${normalizedMatch.matchId}: ${error.message}`);
        }
      }

      logger.info(`Processed ${processedCount} matches`, {
        totalMatches: normalizedData.matches.length,
        processedCount,
        errorCount: errors.length
      });

      return {
        success: processedCount > 0,
        processedCount,
        totalMatches: normalizedData.matches.length,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to process and store matches', {
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
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'DataProcessor',
      connected: this.redisClient?.isOpen || false,
      stateTTL: this.stateTTL,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = DataProcessor;
module.exports = DataProcessor;