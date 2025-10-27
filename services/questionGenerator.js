'use strict';

const logger = require('../utils/loggerService');

/**
 * Question Generation Service for Cricket Betting Agent
 * Reads events from Redis event queues and generates structured questions based on templates
 */
class QuestionGenerator {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.questionTTL = 7200; // 2 hours TTL for generated questions
    this.processingInterval = 5000; // 5 seconds processing interval
    this.isRunning = false;
    this.processedEvents = new Set(); // Track processed events to avoid duplicates
    this.questionTemplates = this.initializeQuestionTemplates();
  }

  /**
   * Initialize question templates library with placeholders
   * @returns {Object} Question templates organized by event type
   */
  initializeQuestionTemplates() {
    return {
      boundary: [
        {
          template: "Will {batsman} hit another boundary in the next over?",
          difficulty: "easy",
          category: "next_over_prediction",
          context: "boundary_follow_up"
        },
        {
          template: "How many boundaries will {batsman} hit in the next 5 overs?",
          difficulty: "medium",
          category: "multi_over_prediction",
          context: "boundary_frequency"
        },
        {
          template: "Will {batsman} score more than {runs} runs in this innings?",
          difficulty: "medium",
          category: "innings_total_prediction",
          context: "boundary_momentum"
        },
        {
          template: "Will the team score more than {runs} runs in the next over?",
          difficulty: "easy",
          category: "team_over_prediction",
          context: "boundary_impact"
        }
      ],
      six: [
        {
          template: "Will {batsman} hit another six in the next 3 balls?",
          difficulty: "medium",
          category: "immediate_prediction",
          context: "six_momentum"
        },
        {
          template: "How many sixes will {batsman} hit in the remaining overs?",
          difficulty: "hard",
          category: "innings_prediction",
          context: "six_consistency"
        },
        {
          template: "Will {batsman} hit more than {runs} sixes in this match?",
          difficulty: "hard",
          category: "match_total_prediction",
          context: "six_tracking"
        },
        {
          template: "Will the team hit another six before the end of this over?",
          difficulty: "easy",
          category: "over_prediction",
          context: "six_frequency"
        }
      ],
      wicket: [
        {
          template: "Will the next wicket fall within the next 2 overs?",
          difficulty: "medium",
          category: "wicket_timing",
          context: "wicket_sequence"
        },
        {
          template: "How many wickets will fall in the next 10 overs?",
          difficulty: "hard",
          category: "wicket_count_prediction",
          context: "wicket_cluster"
        },
        {
          template: "Will {batsman} be dismissed in the next over?",
          difficulty: "medium",
          category: "batsman_dismissal",
          context: "wicket_pressure"
        },
        {
          template: "Will the team lose more than {wickets} wickets in the next 5 overs?",
          difficulty: "hard",
          category: "wicket_collapse",
          context: "wicket_cascade"
        }
      ],
      new_over: [
        {
          template: "Will {batsman} score more than {runs} runs in over {over}?",
          difficulty: "medium",
          category: "over_score_prediction",
          context: "new_over_start"
        },
        {
          template: "Will {bowler} take a wicket in this over?",
          difficulty: "medium",
          category: "bowler_wicket_prediction",
          context: "new_over_bowling"
        },
        {
          template: "Will the team score more than {runs} runs in the next 3 overs?",
          difficulty: "hard",
          category: "multi_over_score",
          context: "over_momentum"
        },
        {
          template: "Will {batsman} hit a boundary in this over?",
          difficulty: "easy",
          category: "boundary_in_over",
          context: "over_boundary_chance"
        }
      ],
      milestone: [
        {
          template: "Will {batsman} reach {milestone} runs in this innings?",
          difficulty: "medium",
          category: "milestone_prediction",
          context: "milestone_progress"
        },
        {
          template: "How many runs will {batsman} score in total this innings?",
          difficulty: "hard",
          category: "innings_total_prediction",
          context: "milestone_extrapolation"
        },
        {
          template: "Will {batsman} score a century in this match?",
          difficulty: "hard",
          category: "century_prediction",
          context: "milestone_century"
        },
        {
          template: "Will the team reach {runs} runs before losing {wickets} more wickets?",
          difficulty: "hard",
          category: "team_milestone",
          context: "milestone_team_target"
        }
      ]
    };
  }

  /**
   * Start the question generation service
   * @returns {Promise<boolean>} Success status
   */
  async start() {
    if (this.isRunning) {
      logger.warn('QuestionGenerator is already running');
      return true;
    }

    try {
      this.isRunning = true;
      logger.info('Starting QuestionGenerator service', {
        processingInterval: this.processingInterval,
        questionTTL: this.questionTTL
      });

      // Start continuous processing
      this.processEventsContinuously();
      
      return true;
    } catch (error) {
      logger.error('Failed to start QuestionGenerator', {
        error: error.message,
        stack: error.stack
      });
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Stop the question generation service
   * @returns {Promise<boolean>} Success status
   */
  async stop() {
    try {
      this.isRunning = false;
      logger.info('QuestionGenerator service stopped');
      return true;
    } catch (error) {
      logger.error('Failed to stop QuestionGenerator', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Continuously process events from Redis queues
   */
  async processEventsContinuously() {
    while (this.isRunning) {
      try {
        await this.processAllEventQueues();
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
   * Process all available event queues
   * @returns {Promise<Object>} Processing result
   */
  async processAllEventQueues() {
    try {
      // Get all event queue keys
      const eventQueueKeys = await this.getEventQueueKeys();
      
      if (eventQueueKeys.length === 0) {
        return {
          success: true,
          processedQueues: 0,
          generatedQuestions: 0,
          message: 'No event queues found'
        };
      }

      let totalGeneratedQuestions = 0;
      const processingResults = [];

      for (const queueKey of eventQueueKeys) {
        try {
          const result = await this.processEventQueue(queueKey);
          processingResults.push(result);
          totalGeneratedQuestions += result.generatedQuestions || 0;
        } catch (error) {
          logger.error('Error processing event queue', {
            queueKey,
            error: error.message
          });
          processingResults.push({
            queueKey,
            success: false,
            error: error.message,
            generatedQuestions: 0
          });
        }
      }

      logger.info(`Processed ${eventQueueKeys.length} event queues`, {
        totalQueues: eventQueueKeys.length,
        totalGeneratedQuestions,
        processingResults: processingResults.length
      });

      return {
        success: true,
        processedQueues: eventQueueKeys.length,
        generatedQuestions: totalGeneratedQuestions,
        processingResults
      };

    } catch (error) {
      logger.error('Failed to process all event queues', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        processedQueues: 0,
        generatedQuestions: 0
      };
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
   * Process a single event queue
   * @param {string} queueKey Event queue key (e.g., "event:queue:12345")
   * @returns {Promise<Object>} Processing result
   */
  async processEventQueue(queueKey) {
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
          message: 'No events in queue'
        };
      }

      let generatedQuestions = 0;
      const processedEvents = [];

      for (const event of events) {
        try {
          // Check if event was already processed
          const eventId = this.generateEventId(event);
          if (this.processedEvents.has(eventId)) {
            continue;
          }

          // Generate questions for this event
          const questions = await this.generateQuestionsForEvent(event, matchId);
          
          if (questions.length > 0) {
            // Store generated questions
            await this.storeGeneratedQuestions(matchId, questions);
            generatedQuestions += questions.length;
            
            // Mark event as processed
            this.processedEvents.add(eventId);
            processedEvents.push(event);
          }
        } catch (error) {
          logger.error('Error processing individual event', {
            matchId,
            eventType: event.type,
            error: error.message
          });
        }
      }

      logger.info(`Processed ${processedEvents.length} events for match ${matchId}`, {
        matchId,
        queueKey,
        eventsProcessed: processedEvents.length,
        generatedQuestions,
        totalEventsInQueue: events.length
      });

      return {
        queueKey,
        matchId,
        success: true,
        eventsProcessed: processedEvents.length,
        generatedQuestions,
        totalEventsInQueue: events.length
      };

    } catch (error) {
      logger.error('Failed to process event queue', {
        queueKey,
        error: error.message,
        stack: error.stack
      });
      return {
        queueKey,
        success: false,
        error: error.message,
        eventsProcessed: 0,
        generatedQuestions: 0
      };
    }
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
   * Generate questions for a specific event
   * @param {Object} event Event object
   * @param {string} matchId Match ID
   * @returns {Promise<Array>} Array of generated questions
   */
  async generateQuestionsForEvent(event, matchId) {
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
          const question = this.fillTemplate(template, event, matchId);
          if (question) {
            generatedQuestions.push(question);
          }
        } catch (error) {
          logger.warn('Error filling template', {
            matchId,
            eventType,
            template: template.template,
            error: error.message
          });
        }
      }

      logger.info(`Generated ${generatedQuestions.length} questions for ${eventType} event`, {
        matchId,
        eventType,
        questionCount: generatedQuestions.length
      });

      return generatedQuestions;

    } catch (error) {
      logger.error('Failed to generate questions for event', {
        matchId,
        eventType: event.type,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Fill template placeholders with event data
   * @param {Object} template Question template
   * @param {Object} event Event data
   * @param {string} matchId Match ID
   * @returns {Object|null} Generated question object
   */
  fillTemplate(template, event, matchId) {
    try {
      let questionText = template.template;
      
      // Replace placeholders with event data
      const placeholders = {
        '{batsman}': event.batsman || 'the batsman',
        '{bowler}': event.bowler || 'the bowler',
        '{runs}': event.runs || event.totalRuns || 'X',
        '{wickets}': event.wickets || 'X',
        '{over}': event.over || 'X',
        '{milestone}': event.milestone || 'X'
      };

      // Replace all placeholders
      for (const [placeholder, value] of Object.entries(placeholders)) {
        questionText = questionText.replace(new RegExp(placeholder, 'g'), value);
      }

      // Create structured question object
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
            context: template.context
          },
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      return question;

    } catch (error) {
      logger.error('Failed to fill template', {
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
   * Store generated questions in Redis
   * @param {string} matchId Match ID
   * @param {Array} questions Array of question objects
   * @returns {Promise<boolean>} Success status
   */
  async storeGeneratedQuestions(matchId, questions) {
    try {
      const questionsKey = `questions:generated:${matchId}`;
      
      // Store each question in the list
      for (const question of questions) {
        await this.redisClient.lPush(questionsKey, JSON.stringify(question));
      }

      // Set TTL for the questions list
      await this.redisClient.expire(questionsKey, this.questionTTL);

      logger.info(`Stored ${questions.length} generated questions for match ${matchId}`, {
        matchId,
        questionsKey,
        questionCount: questions.length,
        ttl: this.questionTTL
      });

      return true;

    } catch (error) {
      logger.error('Failed to store generated questions', {
        matchId,
        questionCount: questions.length,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Retrieve generated questions for a match
   * @param {string} matchId Match ID
   * @param {number} limit Maximum number of questions to retrieve
   * @returns {Promise<Array>} Array of generated questions
   */
  async getGeneratedQuestions(matchId, limit = 50) {
    try {
      const questionsKey = `questions:generated:${matchId}`;
      const questions = await this.redisClient.lRange(questionsKey, 0, limit - 1);
      
      const parsedQuestions = questions.map(questionStr => {
        try {
          return JSON.parse(questionStr);
        } catch (parseError) {
          logger.warn('Failed to parse generated question', {
            matchId,
            questionStr,
            parseError: parseError.message
          });
          return null;
        }
      }).filter(question => question !== null);

      logger.debug(`Retrieved ${parsedQuestions.length} generated questions for match ${matchId}`, {
        matchId,
        questionCount: parsedQuestions.length,
        limit
      });

      return parsedQuestions;

    } catch (error) {
      logger.error('Failed to get generated questions', {
        matchId,
        limit,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get question generation statistics for a match
   * @param {string} matchId Match ID
   * @returns {Promise<Object>} Statistics object
   */
  async getQuestionStats(matchId) {
    try {
      const questionsKey = `questions:generated:${matchId}`;
      const queueLength = await this.redisClient.lLen(questionsKey);
      const ttl = await this.redisClient.ttl(questionsKey);
      
      return {
        matchId,
        totalQuestions: queueLength,
        ttl,
        questionsKey,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get question stats', {
        matchId,
        error: error.message
      });
      return {
        matchId,
        totalQuestions: 0,
        ttl: -1,
        error: error.message
      };
    }
  }

  /**
   * Clear generated questions for a match
   * @param {string} matchId Match ID
   * @returns {Promise<boolean>} Success status
   */
  async clearGeneratedQuestions(matchId) {
    try {
      const questionsKey = `questions:generated:${matchId}`;
      await this.redisClient.del(questionsKey);
      
      logger.info(`Cleared generated questions for match ${matchId}`, {
        matchId,
        questionsKey
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to clear generated questions', {
        matchId,
        error: error.message
      });
      return false;
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
    return `q_${matchId}_${hash}`;
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
      const questionsKey = `questions:generated:${matchId}`;
      const questions = await this.redisClient.lRange(questionsKey, 0, limit - 1);
      
      return questions.map(q => {
        try {
          return JSON.parse(q);
        } catch (error) {
          logger.warn('Failed to parse question JSON', { matchId, question: q });
          return null;
        }
      }).filter(q => q !== null);
      
    } catch (error) {
      logger.error('Failed to get generated questions', {
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
      const questionsKey = `questions:generated:${matchId}`;
      const ttl = await this.redisClient.ttl(questionsKey);
      const totalQuestions = await this.redisClient.lLen(questionsKey);
      
      return {
        totalQuestions,
        ttl,
        matchId,
        questionsKey
      };
      
    } catch (error) {
      logger.error('Failed to get question stats', {
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
      service: 'QuestionGenerator',
      connected: this.redisClient?.isOpen || false,
      running: this.isRunning,
      questionTTL: this.questionTTL,
      processingInterval: this.processingInterval,
      processedEventsCount: this.processedEvents.size,
      templatesCount: Object.keys(this.questionTemplates).length,
      status: this.isRunning ? 'running' : 'stopped',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = QuestionGenerator;
