'use strict';

const logger = require('../utils/loggerService');

/**
 * Event Detection Service for Cricket Betting Agent
 * Detects and categorizes events from match state changes
 */
class EventDetector {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.eventTTL = 3600; // 1 hour TTL for event queue
  }

  /**
   * Detect events by comparing previous and current match states
   * @param {Object} previousState Previous normalized match state
   * @param {Object} currentState Current normalized match state
   * @returns {Array} Array of detected events
   */
  detectEvents(previousState, currentState) {
    try {
      if (!previousState || !currentState) {
        logger.warn('Missing state data for event detection', {
          hasPrevious: !!previousState,
          hasCurrent: !!currentState
        });
        return [];
      }

      if (previousState.matchId !== currentState.matchId) {
        logger.warn('Match IDs do not match for event detection', {
          previousMatchId: previousState.matchId,
          currentMatchId: currentState.matchId
        });
        return [];
      }

      const events = [];
      const matchId = currentState.matchId;
      const timestamp = new Date().toISOString();

      // Enhanced debug logging for state comparison
      this.logStateComparison(previousState, currentState, matchId);

      // Detect run increment events (1-2 runs)
      const runIncrementEvent = this.detectRunIncrement(previousState, currentState, matchId, timestamp);
      if (runIncrementEvent) events.push(runIncrementEvent);

      // Detect boundary event (runs >= 4 on last ball)
      const boundaryEvent = this.detectBoundary(previousState, currentState, matchId, timestamp);
      if (boundaryEvent) events.push(boundaryEvent);

      // Detect six event (runs = 6 on last ball)
      const sixEvent = this.detectSix(previousState, currentState, matchId, timestamp);
      if (sixEvent) events.push(sixEvent);

      // Detect wicket event (wicket count increased)
      const wicketEvent = this.detectWicket(previousState, currentState, matchId, timestamp);
      if (wicketEvent) events.push(wicketEvent);

      // Detect new over event (over number changed)
      const newOverEvent = this.detectNewOver(previousState, currentState, matchId, timestamp);
      if (newOverEvent) events.push(newOverEvent);

      // Detect milestone event (player reached 50 or 100 runs)
      const milestoneEvent = this.detectMilestone(previousState, currentState, matchId, timestamp);
      if (milestoneEvent) events.push(milestoneEvent);

      // Detect partial milestone event (every 10 runs)
      const partialMilestoneEvent = this.detectPartialMilestone(previousState, currentState, matchId, timestamp);
      if (partialMilestoneEvent) events.push(partialMilestoneEvent);

      // Detect run rate change event
      const runRateEvent = this.detectRunRateChange(previousState, currentState, matchId, timestamp);
      if (runRateEvent) events.push(runRateEvent);

      // Log detected events with detailed information
      if (events.length > 0) {
        logger.info(`Detected ${events.length} events for match ${matchId}`, {
          matchId,
          eventCount: events.length,
          eventTypes: events.map(e => e.type),
          events: events.map(e => ({
            type: e.type,
            description: e.description,
            runs: e.runs || e.totalRuns || e.milestone,
            wickets: e.wickets,
            over: e.over
          }))
        });

        // Alert for significant events
        this.alertSignificantEvents(events, matchId);
      } else {
        logger.debug(`No events detected for match ${matchId}`, {
          matchId,
          previousRuns: previousState.totalRuns,
          currentRuns: currentState.totalRuns,
          previousWickets: previousState.wickets,
          currentWickets: currentState.wickets,
          previousOvers: previousState.overs,
          currentOvers: currentState.overs
        });
      }

      return events;

    } catch (error) {
      logger.error('Failed to detect events', {
        error: error.message,
        stack: error.stack,
        previousMatchId: previousState?.matchId,
        currentMatchId: currentState?.matchId
      });
      return [];
    }
  }

  /**
   * Log detailed state comparison for debugging
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   */
  logStateComparison(previousState, currentState, matchId) {
    try {
      const runsDiff = (currentState.totalRuns || 0) - (previousState.totalRuns || 0);
      const wicketsDiff = (currentState.wickets || 0) - (previousState.wickets || 0);
      const oversDiff = (currentState.overs || 0) - (previousState.overs || 0);
      const runRateDiff = (currentState.runRate || 0) - (previousState.runRate || 0);

      logger.debug(`State comparison for match ${matchId}`, {
        matchId,
        previous: {
          runs: previousState.totalRuns || 0,
          wickets: previousState.wickets || 0,
          overs: previousState.overs || 0,
          runRate: previousState.runRate || 0,
          lastBallRuns: previousState.lastBallRuns || 0,
          batsman: previousState.batsman || 'Unknown',
          bowler: previousState.bowler || 'Unknown'
        },
        current: {
          runs: currentState.totalRuns || 0,
          wickets: currentState.wickets || 0,
          overs: currentState.overs || 0,
          runRate: currentState.runRate || 0,
          lastBallRuns: currentState.lastBallRuns || 0,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown'
        },
        changes: {
          runsDiff,
          wicketsDiff,
          oversDiff,
          runRateDiff: parseFloat(runRateDiff.toFixed(2)),
          hasChanges: runsDiff !== 0 || wicketsDiff !== 0 || oversDiff !== 0
        }
      });

      // Alert for significant changes
      if (Math.abs(runsDiff) >= 10 || wicketsDiff > 0 || Math.abs(oversDiff) >= 1) {
        logger.warn(`Significant change detected in match ${matchId}`, {
          matchId,
          changeType: wicketsDiff > 0 ? 'wicket' : runsDiff >= 10 ? 'big_runs' : 'over_change',
          runsDiff,
          wicketsDiff,
          oversDiff
        });
      }
    } catch (error) {
      logger.warn('Error logging state comparison', {
        matchId,
        error: error.message
      });
    }
  }

  /**
   * Detect run increment events (1-2 runs)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Run increment event or null
   */
  detectRunIncrement(previousState, currentState, matchId, timestamp) {
    try {
      const previousRuns = previousState.totalRuns || 0;
      const currentRuns = currentState.totalRuns || 0;
      const runsDiff = currentRuns - previousRuns;
      
      // Detect small run increments (1-2 runs)
      if (runsDiff >= 1 && runsDiff <= 2) {
        return {
          type: 'run_increment',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          runs: runsDiff,
          totalRuns: currentRuns,
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `${currentState.batsman} scored ${runsDiff} run${runsDiff > 1 ? 's' : ''} off ${currentState.bowler} (Total: ${currentRuns})`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting run increment event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Detect partial milestone event (every 10 runs)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Partial milestone event or null
   */
  detectPartialMilestone(previousState, currentState, matchId, timestamp) {
    try {
      const previousRuns = previousState.totalRuns || 0;
      const currentRuns = currentState.totalRuns || 0;
      
      // Check for 10-run milestones (10, 20, 30, 40, 60, 70, 80, 90, 110, etc.)
      const previousMilestone = Math.floor(previousRuns / 10) * 10;
      const currentMilestone = Math.floor(currentRuns / 10) * 10;
      
      if (currentMilestone > previousMilestone && currentMilestone % 10 === 0 && currentMilestone < 50) {
        return {
          type: 'partial_milestone',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          milestone: currentMilestone,
          totalRuns: currentRuns,
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `${currentState.batsman} reached ${currentMilestone} runs milestone (Total: ${currentRuns})`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting partial milestone event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Detect run rate change event
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Run rate change event or null
   */
  detectRunRateChange(previousState, currentState, matchId, timestamp) {
    try {
      const previousRunRate = previousState.runRate || 0;
      const currentRunRate = currentState.runRate || 0;
      const runRateDiff = Math.abs(currentRunRate - previousRunRate);
      
      // Detect significant run rate changes (>= 0.5)
      if (runRateDiff >= 0.5) {
        return {
          type: 'run_rate_change',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          previousRunRate: parseFloat(previousRunRate.toFixed(2)),
          currentRunRate: parseFloat(currentRunRate.toFixed(2)),
          runRateDiff: parseFloat(runRateDiff.toFixed(2)),
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `Run rate changed from ${previousRunRate.toFixed(2)} to ${currentRunRate.toFixed(2)} (${runRateDiff >= 0 ? '+' : ''}${runRateDiff.toFixed(2)})`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting run rate change event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Alert for significant events
   * @param {Array} events Array of detected events
   * @param {string} matchId Match ID
   */
  alertSignificantEvents(events, matchId) {
    try {
      const significantEvents = events.filter(event => 
        ['wicket', 'six', 'milestone', 'boundary'].includes(event.type)
      );

      if (significantEvents.length > 0) {
        logger.warn(`🚨 SIGNIFICANT EVENTS DETECTED for match ${matchId}`, {
          matchId,
          significantEventCount: significantEvents.length,
          events: significantEvents.map(e => ({
            type: e.type,
            description: e.description,
            timestamp: e.timestamp
          }))
        });

        // Console alert for immediate visibility
        console.log(`🚨 [EventDetector] SIGNIFICANT EVENTS for Match ${matchId}:`);
        significantEvents.forEach(event => {
          console.log(`   • ${event.type.toUpperCase()}: ${event.description}`);
        });
      }
    } catch (error) {
      logger.warn('Error alerting significant events', {
        matchId,
        error: error.message
      });
    }
  }

  /**
   * Detect boundary event (runs >= 4 on last ball)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Boundary event or null
   */
  detectBoundary(previousState, currentState, matchId, timestamp) {
    try {
      const currentRuns = currentState.lastBallRuns || 0;
      
      // Check if current ball resulted in 4 or more runs
      if (currentRuns >= 4 && currentRuns < 6) {
        return {
          type: 'boundary',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          runs: currentRuns,
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `${currentState.batsman} hit a ${currentRuns} run boundary off ${currentState.bowler}`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting boundary event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Detect six event (runs = 6 on last ball)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Six event or null
   */
  detectSix(previousState, currentState, matchId, timestamp) {
    try {
      const currentRuns = currentState.lastBallRuns || 0;
      
      // Check if current ball resulted in exactly 6 runs
      if (currentRuns === 6) {
        return {
          type: 'six',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          runs: currentRuns,
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `${currentState.batsman} hit a six off ${currentState.bowler}`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting six event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Detect wicket event (wicket count increased)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Wicket event or null
   */
  detectWicket(previousState, currentState, matchId, timestamp) {
    try {
      const previousWickets = previousState.wickets || 0;
      const currentWickets = currentState.wickets || 0;
      
      // Check if wicket count increased
      if (currentWickets > previousWickets) {
        const wicketsLost = currentWickets - previousWickets;
        
        logger.warn(`🚨 WICKET FALLEN for match ${matchId}`, {
          matchId,
          previousWickets,
          currentWickets,
          wicketsLost,
          batsman: currentState.batsman,
          bowler: currentState.bowler,
          totalRuns: currentState.totalRuns
        });

        return {
          type: 'wicket',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          wickets: currentWickets,
          wicketsLost: wicketsLost,
          previousWickets: previousWickets,
          totalRuns: currentState.totalRuns,
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `🚨 WICKET! ${currentState.batsman} dismissed by ${currentState.bowler} (${currentWickets}/${wicketsLost} wickets)`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting wicket event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Detect new over event (over number changed)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} New over event or null
   */
  detectNewOver(previousState, currentState, matchId, timestamp) {
    try {
      const previousOver = Math.floor(previousState.overs || 0);
      const currentOver = Math.floor(currentState.overs || 0);
      
      // Check if over number increased
      if (currentOver > previousOver) {
        return {
          type: 'new_over',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          over: currentOver,
          previousOver: previousOver,
          timestamp: timestamp,
          description: `New over ${currentOver} started, ${currentState.bowler} bowling to ${currentState.batsman}`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting new over event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Detect milestone event (player reached major milestones)
   * @param {Object} previousState Previous match state
   * @param {Object} currentState Current match state
   * @param {string} matchId Match ID
   * @param {string} timestamp Event timestamp
   * @returns {Object|null} Milestone event or null
   */
  detectMilestone(previousState, currentState, matchId, timestamp) {
    try {
      const previousRuns = previousState.totalRuns || 0;
      const currentRuns = currentState.totalRuns || 0;
      
      // Check for milestone achievements (50, 100, 150, 200, 250, 300)
      let milestone = null;
      
      if (previousRuns < 50 && currentRuns >= 50) {
        milestone = 50;
      } else if (previousRuns < 100 && currentRuns >= 100) {
        milestone = 100;
      } else if (previousRuns < 150 && currentRuns >= 150) {
        milestone = 150;
      } else if (previousRuns < 200 && currentRuns >= 200) {
        milestone = 200;
      } else if (previousRuns < 250 && currentRuns >= 250) {
        milestone = 250;
      } else if (previousRuns < 300 && currentRuns >= 300) {
        milestone = 300;
      }
      
      if (milestone) {
        logger.info(`🎯 MILESTONE ACHIEVED: ${milestone} runs for match ${matchId}`, {
          matchId,
          milestone,
          previousRuns,
          currentRuns,
          batsman: currentState.batsman,
          bowler: currentState.bowler
        });

        return {
          type: 'milestone',
          matchId: matchId,
          batsman: currentState.batsman || 'Unknown',
          bowler: currentState.bowler || 'Unknown',
          milestone: milestone,
          totalRuns: currentRuns,
          previousRuns: previousRuns,
          over: this.extractOverFromTimestamp(currentState),
          timestamp: timestamp,
          description: `🎯 ${currentState.batsman} reached ${milestone} runs milestone! (Total: ${currentRuns})`
        };
      }
      
      return null;
    } catch (error) {
      logger.warn('Error detecting milestone event', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract over number from current state
   * @param {Object} currentState Current match state
   * @returns {number} Over number
   */
  extractOverFromTimestamp(currentState) {
    try {
      // Try to extract over from overs field
      if (currentState.overs) {
        return Math.floor(currentState.overs);
      }
      
      // Default to 0 if no over information available
      return 0;
    } catch (error) {
      logger.warn('Error extracting over from timestamp', {
        error: error.message,
        currentState: currentState?.matchId
      });
      return 0;
    }
  }

  /**
   * Publish events to Redis event queue
   * @param {string} matchId Match ID
   * @param {Array} events Array of detected events
   * @returns {Promise<boolean>} Success status
   */
  async publishEvents(matchId, events) {
    try {
      if (!events || events.length === 0) {
        return true; // No events to publish
      }

      const eventQueueKey = `event:queue:${matchId}`;

      // Add each event to the Redis list
      for (const event of events) {
        const eventMessage = {
          ...event,
          publishedAt: new Date().toISOString(),
          version: '1.0'
        };

        await this.redisClient.lPush(eventQueueKey, JSON.stringify(eventMessage));
      }

      // Set TTL for the event queue
      await this.redisClient.expire(eventQueueKey, this.eventTTL);

      logger.info(`Published ${events.length} events for match ${matchId}`, {
        matchId,
        eventCount: events.length,
        eventQueueKey,
        eventTypes: events.map(e => e.type)
      });

      return true;

    } catch (error) {
      logger.error('Failed to publish events', {
        matchId,
        eventCount: events?.length || 0,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Retrieve events from Redis event queue
   * @param {string} matchId Match ID
   * @param {number} limit Maximum number of events to retrieve
   * @returns {Promise<Array>} Array of events
   */
  async getEvents(matchId, limit = 50) {
    try {
      const eventQueueKey = `event:queue:${matchId}`;
      const events = await this.redisClient.lRange(eventQueueKey, 0, limit - 1);
      
      const parsedEvents = events.map(eventStr => {
        try {
          return JSON.parse(eventStr);
        } catch (parseError) {
          logger.warn('Failed to parse event from queue', {
            matchId,
            eventStr,
            parseError: parseError.message
          });
          return null;
        }
      }).filter(event => event !== null);

      logger.debug(`Retrieved ${parsedEvents.length} events for match ${matchId}`, {
        matchId,
        eventCount: parsedEvents.length,
        limit
      });

      return parsedEvents;

    } catch (error) {
      logger.error('Failed to get events', {
        matchId,
        limit,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Clear events from Redis event queue
   * @param {string} matchId Match ID
   * @returns {Promise<boolean>} Success status
   */
  async clearEvents(matchId) {
    try {
      const eventQueueKey = `event:queue:${matchId}`;
      await this.redisClient.del(eventQueueKey);
      
      logger.info(`Cleared events for match ${matchId}`, {
        matchId,
        eventQueueKey
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to clear events', {
        matchId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get event queue statistics
   * @param {string} matchId Match ID
   * @returns {Promise<Object>} Queue statistics
   */
  async getEventQueueStats(matchId) {
    try {
      const eventQueueKey = `event:queue:${matchId}`;
      const queueLength = await this.redisClient.lLen(eventQueueKey);
      const ttl = await this.redisClient.ttl(eventQueueKey);
      
      return {
        matchId,
        queueLength,
        ttl,
        eventQueueKey,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get event queue stats', {
        matchId,
        error: error.message
      });
      return {
        matchId,
        queueLength: 0,
        ttl: -1,
        error: error.message
      };
    }
  }

  /**
   * Process events for all matches by comparing states
   * @param {Array} matchStates Array of current match states
   * @returns {Promise<Object>} Processing result
   */
  async processEventsForMatches(matchStates) {
    try {
      let totalEvents = 0;
      let matchesWithEvents = 0;
      let matchesWithoutPreviousState = 0;
      const processingResults = [];
      const missedEvents = [];

      logger.info(`Starting event processing for ${matchStates.length} matches`, {
        totalMatches: matchStates.length,
        timestamp: new Date().toISOString()
      });

      for (const currentState of matchStates) {
        try {
          // Get previous state for this match
          const previousState = await this.getPreviousState(currentState.matchId);
          
          if (previousState) {
            // Log state comparison for debugging
            logger.debug(`Processing events for match ${currentState.matchId}`, {
              matchId: currentState.matchId,
              hasPreviousState: true,
              previousRuns: previousState.totalRuns,
              currentRuns: currentState.totalRuns,
              previousWickets: previousState.wickets,
              currentWickets: currentState.wickets
            });

            // Detect events
            const events = this.detectEvents(previousState, currentState);
            
            if (events.length > 0) {
              // Publish events to Redis
              const publishSuccess = await this.publishEvents(currentState.matchId, events);
              
              processingResults.push({
                matchId: currentState.matchId,
                eventCount: events.length,
                events: events,
                published: publishSuccess
              });
              
              totalEvents += events.length;
              matchesWithEvents++;
              
              // Log all detected events for verification
              events.forEach(event => {
                logger.info(`[EventDetector] Detected ${event.type}: ${event.description} (Match: ${event.matchId})`, {
                  matchId: event.matchId,
                  eventType: event.type,
                  description: event.description,
                  timestamp: event.timestamp
                });
              });
            } else {
              // Track matches with no events detected
              logger.debug(`No events detected for match ${currentState.matchId}`, {
                matchId: currentState.matchId,
                previousRuns: previousState.totalRuns,
                currentRuns: currentState.totalRuns,
                runsDiff: currentState.totalRuns - previousState.totalRuns,
                previousWickets: previousState.wickets,
                currentWickets: currentState.wickets,
                wicketsDiff: currentState.wickets - previousState.wickets
              });
            }
          } else {
            matchesWithoutPreviousState++;
            logger.debug(`No previous state found for match ${currentState.matchId}`, {
              matchId: currentState.matchId,
              currentRuns: currentState.totalRuns,
              currentWickets: currentState.wickets
            });
          }
        } catch (error) {
          logger.error('Error processing events for match', {
            matchId: currentState.matchId,
            error: error.message,
            stack: error.stack
          });
        }
      }

      // Log comprehensive processing summary
      logger.info(`Event processing completed for ${matchStates.length} matches`, {
        totalMatches: matchStates.length,
        matchesWithEvents,
        matchesWithoutPreviousState,
        totalEvents,
        eventTypes: this.getEventTypeSummary(processingResults),
        timestamp: new Date().toISOString()
      });

      // Alert if no events detected across all matches
      if (totalEvents === 0 && matchStates.length > 0) {
        logger.warn(`⚠️ NO EVENTS DETECTED across ${matchStates.length} matches`, {
          totalMatches: matchStates.length,
          matchesWithPreviousState: matchStates.length - matchesWithoutPreviousState,
          matchesWithoutPreviousState,
          alertType: 'no_events_detected'
        });
      }

      return {
        success: true,
        totalMatches: matchStates.length,
        totalEvents,
        matchesWithEvents,
        matchesWithoutPreviousState,
        processingResults,
        eventTypeSummary: this.getEventTypeSummary(processingResults),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to process events for matches', {
        error: error.message,
        stack: error.stack,
        totalMatches: matchStates?.length || 0
      });
      return {
        success: false,
        error: error.message,
        totalMatches: 0,
        totalEvents: 0,
        matchesWithEvents: 0
      };
    }
  }

  /**
   * Get event type summary from processing results
   * @param {Array} processingResults Processing results array
   * @returns {Object} Event type summary
   */
  getEventTypeSummary(processingResults) {
    const summary = {};
    
    processingResults.forEach(result => {
      if (result.events) {
        result.events.forEach(event => {
          summary[event.type] = (summary[event.type] || 0) + 1;
        });
      }
    });
    
    return summary;
  }

  /**
   * Get previous state for a match (helper method)
   * @param {string} matchId Match ID
   * @returns {Promise<Object|null>} Previous state or null
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
      logger.error('Failed to get previous state for event detection', {
        matchId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'EventDetector',
      connected: this.redisClient?.isOpen || false,
      eventTTL: this.eventTTL,
      status: 'ready',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = EventDetector;
