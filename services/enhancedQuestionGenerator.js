'use strict';

const logger = require('../utils/loggerService');
const MLPredictionService = require('./mlPredictionService');

/**
 * Enhanced Question Generation Service for Cricket Betting Agent
 * Integrates ML predictions to create dynamic, data-driven betting questions
 */
class EnhancedQuestionGenerator {
  constructor(redisClient, mlPredictionService = null) {
    this.redisClient = redisClient;
    this.mlPredictionService = mlPredictionService || new MLPredictionService();
    this.questionTTL = 7200; // 2 hours TTL for generated questions
    this.processingInterval = 5000; // 5 seconds processing interval
    this.isRunning = false;
    this.processedEvents = new Set(); // Track processed events to avoid duplicates
    this.questionTemplates = this.initializeEnhancedQuestionTemplates();
    this.predictionCache = new Map(); // Cache predictions for performance
    this.predictionCacheTTL = 30000; // 30 seconds cache TTL
    this.userInteractionMetrics = new Map(); // Track user interactions
  }

  /**
   * Initialize enhanced question templates with ML prediction integration
   * @returns {Object} Enhanced question templates organized by event type
   */
  initializeEnhancedQuestionTemplates() {
    return {
      boundary: [
        {
          template: "Will {batsman} hit another boundary in the next over? (Confidence: {confidence}%)",
          difficulty: "easy",
          category: "next_over_prediction",
          context: "boundary_follow_up",
          mlTarget: "boundary_probability",
          confidenceThreshold: 0.6,
          predictionWeight: 0.8
        },
        {
          template: "How many boundaries will {batsman} hit in the next 5 overs? (Predicted: {predictedBoundaries})",
          difficulty: "medium",
          category: "multi_over_prediction",
          context: "boundary_frequency",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.5,
          predictionWeight: 0.7
        },
        {
          template: "Will {batsman} score more than {runs} runs in this innings? (ML Score: {mlScore})",
          difficulty: "medium",
          category: "innings_total_prediction",
          context: "boundary_momentum",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.4,
          predictionWeight: 0.6
        },
        {
          template: "Will the team score more than {runs} runs in the next over? (Probability: {probability}%)",
          difficulty: "easy",
          category: "team_over_prediction",
          context: "boundary_impact",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.5,
          predictionWeight: 0.8
        }
      ],
      six: [
        {
          template: "Will {batsman} hit another six in the next 3 balls? (AI Confidence: {confidence}%)",
          difficulty: "medium",
          category: "immediate_prediction",
          context: "six_momentum",
          mlTarget: "boundary_probability",
          confidenceThreshold: 0.7,
          predictionWeight: 0.9
        },
        {
          template: "How many sixes will {batsman} hit in the remaining overs? (ML Estimate: {predictedSixes})",
          difficulty: "hard",
          category: "innings_prediction",
          context: "six_consistency",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.4,
          predictionWeight: 0.6
        },
        {
          template: "Will {batsman} hit more than {runs} sixes in this match? (Prediction Score: {mlScore})",
          difficulty: "hard",
          category: "match_total_prediction",
          context: "six_tracking",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.3,
          predictionWeight: 0.5
        },
        {
          template: "Will the team hit another six before the end of this over? (AI Probability: {probability}%)",
          difficulty: "easy",
          category: "over_prediction",
          context: "six_frequency",
          mlTarget: "boundary_probability",
          confidenceThreshold: 0.6,
          predictionWeight: 0.8
        }
      ],
      wicket: [
        {
          template: "Will the next wicket fall within the next 2 overs? (ML Confidence: {confidence}%)",
          difficulty: "medium",
          category: "wicket_timing",
          context: "wicket_sequence",
          mlTarget: "wicket_occurrence",
          confidenceThreshold: 0.6,
          predictionWeight: 0.9
        },
        {
          template: "How many wickets will fall in the next 10 overs? (AI Prediction: {predictedWickets})",
          difficulty: "hard",
          category: "wicket_count_prediction",
          context: "wicket_cluster",
          mlTarget: "wicket_occurrence",
          confidenceThreshold: 0.4,
          predictionWeight: 0.7
        },
        {
          template: "Will {batsman} be dismissed in the next over? (Risk Level: {riskLevel})",
          difficulty: "medium",
          category: "batsman_dismissal",
          context: "wicket_pressure",
          mlTarget: "wicket_occurrence",
          confidenceThreshold: 0.5,
          predictionWeight: 0.8
        },
        {
          template: "Will the team lose more than {wickets} wickets in the next 5 overs? (ML Score: {mlScore})",
          difficulty: "hard",
          category: "wicket_collapse",
          context: "wicket_cascade",
          mlTarget: "wicket_occurrence",
          confidenceThreshold: 0.4,
          predictionWeight: 0.6
        }
      ],
      new_over: [
        {
          template: "Will {batsman} score more than {runs} runs in over {over}? (AI Confidence: {confidence}%)",
          difficulty: "medium",
          category: "over_score_prediction",
          context: "new_over_start",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.5,
          predictionWeight: 0.8
        },
        {
          template: "Will {bowler} take a wicket in this over? (ML Probability: {probability}%)",
          difficulty: "medium",
          category: "bowler_wicket_prediction",
          context: "new_over_bowling",
          mlTarget: "wicket_occurrence",
          confidenceThreshold: 0.6,
          predictionWeight: 0.9
        },
        {
          template: "Will the team score more than {runs} runs in the next 3 overs? (Predicted: {predictedRuns})",
          difficulty: "hard",
          category: "multi_over_score",
          context: "over_momentum",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.4,
          predictionWeight: 0.7
        },
        {
          template: "Will {batsman} hit a boundary in this over? (AI Score: {mlScore})",
          difficulty: "easy",
          category: "boundary_in_over",
          context: "over_boundary_chance",
          mlTarget: "boundary_probability",
          confidenceThreshold: 0.5,
          predictionWeight: 0.8
        }
      ],
      milestone: [
        {
          template: "Will {batsman} reach {milestone} runs in this innings? (ML Confidence: {confidence}%)",
          difficulty: "medium",
          category: "milestone_prediction",
          context: "milestone_progress",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.4,
          predictionWeight: 0.6
        },
        {
          template: "How many runs will {batsman} score in total this innings? (AI Estimate: {predictedRuns})",
          difficulty: "hard",
          category: "innings_total_prediction",
          context: "milestone_extrapolation",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.3,
          predictionWeight: 0.5
        },
        {
          template: "Will {batsman} score a century in this match? (Prediction Score: {mlScore})",
          difficulty: "hard",
          category: "century_prediction",
          context: "milestone_century",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.3,
          predictionWeight: 0.4
        },
        {
          template: "Will the team reach {runs} runs before losing {wickets} more wickets? (AI Analysis: {analysis})",
          difficulty: "hard",
          category: "team_milestone",
          context: "milestone_team_target",
          mlTarget: "runs_per_over",
          confidenceThreshold: 0.4,
          predictionWeight: 0.6
        }
      ]
    };
  }

  /**
   * Start the enhanced question generation service
   * @returns {Promise<boolean>} Success status
   */
  async start() {
    if (this.isRunning) {
      logger.warn('EnhancedQuestionGenerator is already running');
      return true;
    }

    try {
      this.isRunning = true;
      logger.info('Starting EnhancedQuestionGenerator service', {
        processingInterval: this.processingInterval,
        questionTTL: this.questionTTL,
        mlServiceAvailable: this.mlPredictionService.isHealthy
      });

      // Clear old processed events on startup
      this.clearOldProcessedEvents();

      // Start continuous processing
      this.processEventsContinuously();
      
      // Start periodic cleanup of processed events
      this.startPeriodicCleanup();
      
      return true;
    } catch (error) {
      logger.error('Failed to start EnhancedQuestionGenerator', {
        error: error.message,
        stack: error.stack
      });
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Stop the enhanced question generation service
   * @returns {Promise<boolean>} Success status
   */
  async stop() {
    try {
      this.isRunning = false;
      logger.info('EnhancedQuestionGenerator service stopped');
      return true;
    } catch (error) {
      logger.error('Failed to stop EnhancedQuestionGenerator', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Continuously process events from Redis queues with ML integration
   */
  async processEventsContinuously() {
    while (this.isRunning) {
      try {
        await this.processAllEventQueuesWithML();
        await this.sleep(this.processingInterval);
      } catch (error) {
        logger.error('Error in continuous event processing', {
          error: error.message,
          stack: error.stack
        });
        // Continue processing even if there's an error
        await this.sleep(this.processingInterval);
      }
    }
  }

  /**
   * Process all available event queues with ML predictions
   * @returns {Promise<Object>} Processing result
   */
  async processAllEventQueuesWithML() {
    try {
      // Get all event queue keys
      const eventQueueKeys = await this.getEventQueueKeys();
      
      if (eventQueueKeys.length === 0) {
        return {
          success: true,
          processedQueues: 0,
          generatedQuestions: 0,
          mlPredictionsUsed: 0,
          message: 'No event queues found'
        };
      }

      let totalGeneratedQuestions = 0;
      let totalMLPredictionsUsed = 0;
      const processingResults = [];

      for (const queueKey of eventQueueKeys) {
        try {
          const result = await this.processEventQueueWithML(queueKey);
          processingResults.push(result);
          totalGeneratedQuestions += result.generatedQuestions || 0;
          totalMLPredictionsUsed += result.mlPredictionsUsed || 0;
        } catch (error) {
          logger.error('Error processing event queue with ML', {
            queueKey,
            error: error.message
          });
          processingResults.push({
            queueKey,
            success: false,
            error: error.message,
            generatedQuestions: 0,
            mlPredictionsUsed: 0
          });
        }
      }

      logger.info(`Processed ${eventQueueKeys.length} event queues with ML integration`, {
        totalQueues: eventQueueKeys.length,
        totalGeneratedQuestions,
        totalMLPredictionsUsed,
        processingResults: processingResults.length
      });

      return {
        success: true,
        processedQueues: eventQueueKeys.length,
        generatedQuestions: totalGeneratedQuestions,
        mlPredictionsUsed: totalMLPredictionsUsed,
        processingResults
      };

    } catch (error) {
      logger.error('Failed to process all event queues with ML', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        processedQueues: 0,
        generatedQuestions: 0,
        mlPredictionsUsed: 0
      };
    }
  }

  /**
   * Process a single event queue with ML predictions
   * @param {string} queueKey Event queue key (e.g., "event:queue:12345")
   * @returns {Promise<Object>} Processing result
   */
  async processEventQueueWithML(queueKey) {
    try {
      // Extract match ID from queue key
      const matchId = queueKey.replace('event:queue:', '');
      
      // Get events from the queue
      const events = await this.getEventsFromQueue(queueKey);
      
      if (events.length === 0) {
        return {
          queueKey,
          matchId,
          success: true,
          eventsProcessed: 0,
          generatedQuestions: 0,
          mlPredictionsUsed: 0,
          message: 'No events in queue'
        };
      }

      let generatedQuestions = 0;
      let mlPredictionsUsed = 0;
      const processedEvents = [];

      for (const event of events) {
        try {
          // Check if event was already processed (with time-based expiry)
          const eventId = this.generateEventId(event);
          const now = Date.now();
          const eventTime = new Date(event.timestamp).getTime();
          
          // Skip events older than 1 hour or already processed recently
          if (now - eventTime > 3600000) { // 1 hour
            logger.debug(`Skipping old event: ${eventId}`, { eventTime, now });
            continue;
          }
          
          if (this.processedEvents.has(eventId)) {
            logger.debug(`Skipping already processed event: ${eventId}`);
            continue;
          }

          // Get ML predictions for this event
          const mlPredictions = await this.getMLPredictionsForEvent(event, matchId);
          
          // Generate enhanced questions with ML data
          const questions = await this.generateEnhancedQuestionsForEvent(event, matchId, mlPredictions);
          
          if (questions.length > 0) {
            // Store generated questions
            await this.storeGeneratedQuestions(matchId, questions);
            generatedQuestions += questions.length;
            
            if (mlPredictions) {
              mlPredictionsUsed++;
            }
            
            // Mark event as processed
            this.processedEvents.add(eventId);
            processedEvents.push(event);
          }
        } catch (error) {
          logger.error('Error processing individual event with ML', {
            matchId,
            eventType: event.type,
            error: error.message
          });
        }
      }

      logger.info(`Processed ${processedEvents.length} events for match ${matchId} with ML integration`, {
        matchId,
        queueKey,
        eventsProcessed: processedEvents.length,
        generatedQuestions,
        mlPredictionsUsed,
        totalEventsInQueue: events.length
      });

      return {
        queueKey,
        matchId,
        success: true,
        eventsProcessed: processedEvents.length,
        generatedQuestions,
        mlPredictionsUsed,
        totalEventsInQueue: events.length
      };

    } catch (error) {
      logger.error('Failed to process event queue with ML', {
        queueKey,
        error: error.message,
        stack: error.stack
      });
      return {
        queueKey,
        success: false,
        error: error.message,
        eventsProcessed: 0,
        generatedQuestions: 0,
        mlPredictionsUsed: 0
      };
    }
  }

  /**
   * Get ML predictions for a specific event
   * @param {Object} event Event object
   * @param {string} matchId Match ID
   * @returns {Promise<Object|null>} ML predictions or null if unavailable
   */
  async getMLPredictionsForEvent(event, matchId) {
    try {
      // Check cache first
      const cacheKey = `ml_predictions_${matchId}_${event.type}_${event.timestamp}`;
      const cached = this.predictionCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.predictionCacheTTL) {
        logger.debug('Using cached ML predictions', { matchId, eventType: event.type });
        return cached.predictions;
      }

      // Check if ML service is healthy
      if (!this.mlPredictionService.isHealthy) {
        logger.debug('ML service not healthy, skipping predictions', { matchId, eventType: event.type });
        return null;
      }

      // Extract current over data from event
      const overData = this.extractOverDataFromEvent(event, matchId);
      
      if (!overData) {
        logger.debug('No over data available for ML predictions', { matchId, eventType: event.type });
        return null;
      }

      // Get predictions for relevant targets
      const targets = ['wicket_occurrence', 'runs_per_over', 'boundary_probability'];
      const predictions = await this.mlPredictionService.predictBatch(overData, targets);

      if (predictions && predictions.success) {
        // Cache the predictions
        this.predictionCache.set(cacheKey, {
          predictions: predictions.predictions,
          timestamp: Date.now()
        });

        logger.debug('ML predictions obtained', {
          matchId,
          eventType: event.type,
          targets: Object.keys(predictions.predictions)
        });

        return predictions.predictions;
      }

      return null;

    } catch (error) {
      logger.error('Error getting ML predictions for event', {
        matchId,
        eventType: event.type,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract over data from event for ML predictions
   * @param {Object} event Event object
   * @param {string} matchId Match ID
   * @returns {Object|null} Over data or null if unavailable
   */
  extractOverDataFromEvent(event, matchId) {
    try {
      // This would extract over-level features from the event
      // Implementation depends on your event data structure
      
      const overData = {
        overNumber: event.over || 1,
        innings: event.innings || 1,
        teamBatting: event.teamBatting || 'Unknown',
        teamBowling: event.teamBowling || 'Unknown',
        overRuns: event.runs || 0,
        overWickets: event.wickets || 0,
        totalRuns: event.totalRuns || 0,
        totalWickets: event.totalWickets || 0,
        runRate: event.runRate || 0,
        requiredRunRate: event.requiredRunRate || 0,
        matchContext: {
          venue: event.venue || 'Unknown',
          format: event.format || 'T20',
          series: event.series || 'Unknown',
          target: event.target || 0,
          chase: event.chase || false,
          powerplay: event.powerplay || false,
          deathOvers: event.deathOvers || false
        },
        batsmanStats: {
          striker: {
            runs: event.batsmanRuns || 0,
            balls: event.batsmanBalls || 0,
            strikeRate: event.batsmanStrikeRate || 0
          },
          nonStriker: {
            runs: event.nonStrikerRuns || 0,
            balls: event.nonStrikerBalls || 0,
            strikeRate: event.nonStrikerStrikeRate || 0
          }
        },
        bowlerStats: {
          runs: event.bowlerRuns || 0,
          wickets: event.bowlerWickets || 0,
          balls: event.bowlerBalls || 0,
          economyRate: event.bowlerEconomyRate || 0,
          dotBalls: event.bowlerDotBalls || 0
        },
        momentum: {
          recentRunRate: event.recentRunRate || 0,
          wicketsInHand: event.wicketsInHand || 10,
          pressureIndex: event.pressureIndex || 0,
          partnershipRuns: event.partnershipRuns || 0,
          partnershipBalls: event.partnershipBalls || 0
        }
      };

      return overData;

    } catch (error) {
      logger.error('Error extracting over data from event', {
        matchId,
        eventType: event.type,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Generate enhanced questions for a specific event with ML predictions
   * @param {Object} event Event object
   * @param {string} matchId Match ID
   * @param {Object} mlPredictions ML predictions
   * @returns {Promise<Array>} Array of generated questions
   */
  async generateEnhancedQuestionsForEvent(event, matchId, mlPredictions) {
    try {
      const eventType = event.type;
      const templates = this.questionTemplates[eventType];

      if (!templates || templates.length === 0) {
        logger.debug(`No templates found for event type: ${eventType}`, {
          matchId,
          eventType
        });
        return [];
      }

      const generatedQuestions = [];

      for (const template of templates) {
        try {
          // Check if ML predictions are available and meet confidence threshold
          if (template.mlTarget && mlPredictions) {
            const prediction = mlPredictions[template.mlTarget];
            if (prediction && prediction.prediction) {
              const confidence = prediction.prediction.confidence || 0;
              if (confidence < template.confidenceThreshold) {
                logger.debug(`Skipping template due to low confidence`, {
                  matchId,
                  eventType,
                  template: template.template,
                  confidence,
                  threshold: template.confidenceThreshold
                });
                continue;
              }
            }
          }

          const question = this.fillEnhancedTemplate(template, event, matchId, mlPredictions);
          if (question) {
            generatedQuestions.push(question);
          }
        } catch (error) {
          logger.warn('Error filling enhanced template', {
            matchId,
            eventType,
            template: template.template,
            error: error.message
          });
        }
      }

      logger.info(`Generated ${generatedQuestions.length} enhanced questions for ${eventType} event`, {
        matchId,
        eventType,
        questionCount: generatedQuestions.length,
        mlPredictionsUsed: !!mlPredictions
      });

      return generatedQuestions;

    } catch (error) {
      logger.error('Failed to generate enhanced questions for event', {
        matchId,
        eventType: event.type,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Fill enhanced template with event data and ML predictions
   * @param {Object} template Question template
   * @param {Object} event Event data
   * @param {string} matchId Match ID
   * @param {Object} mlPredictions ML predictions
   * @returns {Object|null} Generated question object
   */
  fillEnhancedTemplate(template, event, matchId, mlPredictions) {
    try {
      let questionText = template.template;
      
      // Replace basic placeholders with event data
      const placeholders = {
        '{batsman}': event.batsman || 'the batsman',
        '{bowler}': event.bowler || 'the bowler',
        '{runs}': event.runs || event.totalRuns || 'X',
        '{wickets}': event.wickets || 'X',
        '{over}': event.over || 'X',
        '{milestone}': event.milestone || 'X'
      };

      // Replace all basic placeholders
      for (const [placeholder, value] of Object.entries(placeholders)) {
        questionText = questionText.replace(new RegExp(this.escapeRegex(placeholder), 'g'), value);
      }

      // Replace ML prediction placeholders
      // First, try to use actual ML predictions if available
      if (mlPredictions && template.mlTarget) {
        const prediction = mlPredictions[template.mlTarget];
        if (prediction && prediction.prediction) {
          const mlPlaceholders = this.generateMLPlaceholders(prediction, template);
          
          for (const [placeholder, value] of Object.entries(mlPlaceholders)) {
            questionText = questionText.replace(new RegExp(this.escapeRegex(placeholder), 'g'), value);
          }
        }
      }
      
      // IMPORTANT: Always replace remaining ML placeholders with fallback values
      // This ensures no unresolved placeholders are sent to the frontend
      const fallbackMLPlaceholders = {
        '{confidence}': '60',
        '{probability}': '50',
        '{mlScore}': '5',
        '{predictedBoundaries}': '2',
        '{predictedSixes}': '1',
        '{predictedWickets}': '1',
        '{predictedRuns}': '7',
        '{riskLevel}': 'Medium',
        '{analysis}': 'Likely'
      };
      
      for (const [placeholder, value] of Object.entries(fallbackMLPlaceholders)) {
        // Always replace to ensure no unresolved placeholders remain
        if (questionText.includes(placeholder)) {
          questionText = questionText.replace(new RegExp(this.escapeRegex(placeholder), 'g'), value);
        }
      }

      // Create enhanced question object
      const question = {
        questionId: this.generateQuestionId(matchId, event, template),
        questionText: questionText,
        eventType: event.type,
        matchId: matchId,
        templateId: template.template,
        difficulty: template.difficulty,
        category: template.category,
        context: template.context,
        timestamp: new Date().toISOString(),
        mlEnhanced: !!mlPredictions,
        mlTarget: template.mlTarget,
        predictionWeight: template.predictionWeight,
        metadata: {
          originalEvent: {
            type: event.type,
            batsman: event.batsman,
            bowler: event.bowler,
            runs: event.runs,
            wickets: event.wickets,
            over: event.over,
            milestone: event.milestone,
            timestamp: event.timestamp
          },
          template: {
            difficulty: template.difficulty,
            category: template.category,
            context: template.context,
            mlTarget: template.mlTarget,
            predictionWeight: template.predictionWeight
          },
          mlPredictions: mlPredictions ? {
            targets: Object.keys(mlPredictions),
            timestamp: new Date().toISOString()
          } : null,
          generatedAt: new Date().toISOString(),
          version: '2.0'
        }
      };

      return question;

    } catch (error) {
      logger.error('Failed to fill enhanced template', {
        matchId,
        eventType: event.type,
        template: template.template,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Generate ML prediction placeholders for template
   * @param {Object} prediction ML prediction
   * @param {Object} template Template object
   * @returns {Object} ML placeholders
   */
  generateMLPlaceholders(prediction, template) {
    const placeholders = {};
    
    try {
      const pred = prediction.prediction;
      const confidence = pred.confidence || 0;
      const probability = pred.prediction || 0;

      // Confidence percentage
      placeholders['{confidence}'] = Math.round(confidence * 100);
      
      // Probability percentage
      placeholders['{probability}'] = Math.round(probability * 100);
      
      // ML Score (normalized)
      placeholders['{mlScore}'] = Math.round(probability * 10);
      
      // Risk Level and Predicted Wickets
      if (template.mlTarget === 'wicket_occurrence') {
        if (probability > 0.7) placeholders['{riskLevel}'] = 'High';
        else if (probability > 0.4) placeholders['{riskLevel}'] = 'Medium';
        else placeholders['{riskLevel}'] = 'Low';
        
        // Predicted wickets based on probability (for multi-over predictions)
        placeholders['{predictedWickets}'] = Math.round(probability * 2); // Scale for next 10 overs
      }
      
      // Predicted values for regression targets
      if (template.mlTarget === 'runs_per_over') {
        placeholders['{predictedRuns}'] = Math.round(probability);
        placeholders['{predictedBoundaries}'] = Math.round(probability * 0.3); // Estimate
        placeholders['{predictedSixes}'] = Math.round(probability * 0.1); // Estimate
      }
      
      // Analysis text
      if (probability > 0.7) {
        placeholders['{analysis}'] = 'Very Likely';
      } else if (probability > 0.4) {
        placeholders['{analysis}'] = 'Possible';
      } else {
        placeholders['{analysis}'] = 'Unlikely';
      }

    } catch (error) {
      logger.warn('Error generating ML placeholders', {
        error: error.message,
        prediction: prediction
      });
    }

    return placeholders;
  }

  /**
   * Get events from a specific queue
   * @param {string} queueKey Event queue key
   * @param {number} limit Maximum number of events to retrieve
   * @returns {Promise<Array>} Array of events
   */
  async getEventsFromQueue(queueKey, limit = 10) {
    try {
      const events = await this.redisClient.lRange(queueKey, 0, limit - 1);
      
      return events.map(eventStr => {
        try {
          return JSON.parse(eventStr);
        } catch (parseError) {
          logger.warn('Failed to parse event from queue', {
            queueKey,
            eventStr,
            parseError: parseError.message
          });
          return null;
        }
      }).filter(event => event !== null);

    } catch (error) {
      logger.error('Failed to get events from queue', {
        queueKey,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get all event queue keys from Redis
   * @returns {Promise<Array>} Array of event queue keys
   */
  async getEventQueueKeys() {
    try {
      const keys = await this.redisClient.keys('event:queue:*');
      return keys || [];
    } catch (error) {
      logger.error('Failed to get event queue keys', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Store generated questions in Redis
   * @param {string} matchId Match ID
   * @param {Array} questions Array of question objects
   * @returns {Promise<boolean>} Success status
   */
  async storeGeneratedQuestions(matchId, questions) {
    try {
      const questionsKey = `questions:enhanced:${matchId}`;
      
      // Store each question in the list
      for (const question of questions) {
        await this.redisClient.lPush(questionsKey, JSON.stringify(question));
      }

      // Set TTL for the questions list
      await this.redisClient.expire(questionsKey, this.questionTTL);

      logger.info(`Stored ${questions.length} enhanced questions for match ${matchId}`, {
        matchId,
        questionsKey,
        questionCount: questions.length,
        ttl: this.questionTTL
      });

      return true;

    } catch (error) {
      logger.error('Failed to store enhanced questions', {
        matchId,
        questionCount: questions.length,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Retrieve enhanced questions for a match
   * @param {string} matchId Match ID
   * @param {number} limit Maximum number of questions to retrieve
   * @returns {Promise<Array>} Array of generated questions
   */
  async getEnhancedQuestions(matchId, limit = 50) {
    try {
      const questionsKey = `questions:enhanced:${matchId}`;
      const questions = await this.redisClient.lRange(questionsKey, 0, limit - 1);
      
      const parsedQuestions = questions.map(questionStr => {
        try {
          return JSON.parse(questionStr);
        } catch (parseError) {
          logger.warn('Failed to parse enhanced question', {
            matchId,
            questionStr,
            parseError: parseError.message
          });
          return null;
        }
      }).filter(question => question !== null);

      logger.debug(`Retrieved ${parsedQuestions.length} enhanced questions for match ${matchId}`, {
        matchId,
        questionCount: parsedQuestions.length,
        limit
      });

      return parsedQuestions;

    } catch (error) {
      logger.error('Failed to get enhanced questions', {
        matchId,
        limit,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Record user interaction with questions
   * @param {string} questionId Question ID
   * @param {string} interactionType Type of interaction (view, answer, skip)
   * @param {Object} interactionData Additional interaction data
   */
  recordUserInteraction(questionId, interactionType, interactionData = {}) {
    try {
      const interaction = {
        questionId,
        interactionType,
        timestamp: new Date().toISOString(),
        ...interactionData
      };

      // Store in memory metrics
      if (!this.userInteractionMetrics.has(questionId)) {
        this.userInteractionMetrics.set(questionId, []);
      }
      
      this.userInteractionMetrics.get(questionId).push(interaction);

      // Store in Redis for persistence
      const metricsKey = `user_interactions:${questionId}`;
      this.redisClient.lPush(metricsKey, JSON.stringify(interaction));
      this.redisClient.expire(metricsKey, 86400); // 24 hours TTL

      logger.debug('User interaction recorded', {
        questionId,
        interactionType,
        totalInteractions: this.userInteractionMetrics.get(questionId).length
      });

    } catch (error) {
      logger.error('Failed to record user interaction', {
        questionId,
        interactionType,
        error: error.message
      });
    }
  }

  /**
   * Get user interaction metrics for a question
   * @param {string} questionId Question ID
   * @returns {Object} Interaction metrics
   */
  getQuestionInteractionMetrics(questionId) {
    try {
      const interactions = this.userInteractionMetrics.get(questionId) || [];
      
      const metrics = {
        questionId,
        totalInteractions: interactions.length,
        interactionTypes: {},
        lastInteraction: interactions.length > 0 ? interactions[interactions.length - 1].timestamp : null
      };

      // Count interaction types
      interactions.forEach(interaction => {
        const type = interaction.interactionType;
        metrics.interactionTypes[type] = (metrics.interactionTypes[type] || 0) + 1;
      });

      return metrics;

    } catch (error) {
      logger.error('Failed to get question interaction metrics', {
        questionId,
        error: error.message
      });
      return {
        questionId,
        totalInteractions: 0,
        interactionTypes: {},
        lastInteraction: null
      };
    }
  }

  /**
   * Generate unique event ID for deduplication
   * @param {Object} event Event object
   * @returns {string} Unique event ID
   */
  generateEventId(event) {
    return `${event.type}_${event.matchId}_${event.timestamp}_${event.batsman}_${event.bowler}`;
  }

  /**
   * Generate unique question ID
   * @param {string} matchId Match ID
   * @param {Object} event Event object
   * @param {Object} template Template object
   * @returns {string} Unique question ID
   */
  generateQuestionId(matchId, event, template) {
    const timestamp = Date.now();
    const hash = this.simpleHash(`${matchId}_${event.type}_${template.template}_${timestamp}`);
    return `eq_${matchId}_${hash}`;
  }

  /**
   * Simple hash function for ID generation
   * @param {string} str Input string
   * @returns {string} Hash string
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Escape special regex characters in a string
   * @param {string} str Input string
   * @returns {string} Escaped string
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Clear old processed events
   */
  clearOldProcessedEvents() {
    logger.info('Clearing old processed events on startup');
    this.processedEvents.clear();
  }

  /**
   * Start periodic cleanup of processed events
   */
  startPeriodicCleanup() {
    setInterval(() => {
      if (this.isRunning) {
        const oldSize = this.processedEvents.size;
        this.processedEvents.clear();
        logger.debug(`Cleared ${oldSize} processed events during periodic cleanup`);
      }
    }, 300000); // Clear every 5 minutes
  }

  /**
   * Sleep utility function
   * @param {number} ms Milliseconds to sleep
   * @returns {Promise} Promise that resolves after specified time
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get generated questions for a match
   * @param {string} matchId Match ID
   * @param {number} limit Maximum number of questions to return
   * @returns {Promise<Array>} Array of generated questions
   */
  async getGeneratedQuestions(matchId, limit = 50) {
    try {
      const questionsKey = `questions:enhanced:${matchId}`;
      const questions = await this.redisClient.lRange(questionsKey, 0, limit - 1);
      
      return questions.map(q => {
        try {
          return JSON.parse(q);
        } catch (error) {
          logger.warn('Failed to parse enhanced question JSON', { matchId, question: q });
          return null;
        }
      }).filter(q => q !== null);
      
    } catch (error) {
      logger.error('Failed to get enhanced questions', {
        matchId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get question statistics for a match
   * @param {string} matchId Match ID
   * @returns {Promise<Object>} Question statistics
   */
  async getQuestionStats(matchId) {
    try {
      const questionsKey = `questions:enhanced:${matchId}`;
      const ttl = await this.redisClient.ttl(questionsKey);
      const totalQuestions = await this.redisClient.lLen(questionsKey);
      
      return {
        totalQuestions,
        ttl,
        matchId,
        questionsKey
      };
      
    } catch (error) {
      logger.error('Failed to get enhanced question stats', {
        matchId,
        error: error.message
      });
      return {
        totalQuestions: 0,
        ttl: -1,
        matchId,
        questionsKey: null
      };
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      service: 'EnhancedQuestionGenerator',
      connected: this.redisClient?.isOpen || false,
      running: this.isRunning,
      mlServiceHealthy: this.mlPredictionService.isHealthy,
      questionTTL: this.questionTTL,
      processingInterval: this.processingInterval,
      processedEventsCount: this.processedEvents.size,
      templatesCount: Object.keys(this.questionTemplates).length,
      predictionCacheSize: this.predictionCache.size,
      userInteractionMetricsSize: this.userInteractionMetrics.size,
      status: this.isRunning ? 'running' : 'stopped',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = EnhancedQuestionGenerator;
