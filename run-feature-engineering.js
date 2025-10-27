#!/usr/bin/env node

'use strict';

const DatabaseService = require('./utils/databaseService');
const FeatureEngineer = require('./services/featureEngineer');
const DataPipeline = require('./services/dataPipeline');
const logger = require('./utils/loggerService');

/**
 * Main execution script for Cricket Feature Engineering Pipeline
 * Provides command-line interface for running feature engineering operations
 */
class FeatureEngineeringRunner {
  constructor() {
    this.databaseService = null;
    this.featureEngineer = null;
    this.dataPipeline = null;
  }

  /**
   * Initialize all services
   */
  async initialize() {
    try {
      logger.info('Initializing feature engineering services');

      // Initialize database service
      this.databaseService = new DatabaseService();
      const dbConnected = await this.databaseService.connect();
      
      if (!dbConnected) {
        throw new Error('Failed to connect to database');
      }

      // Initialize feature engineer
      this.featureEngineer = new FeatureEngineer(this.databaseService);

      // Initialize data pipeline
      this.dataPipeline = new DataPipeline(this.databaseService, this.featureEngineer);

      logger.info('Feature engineering services initialized successfully');
      return true;

    } catch (error) {
      logger.error('Failed to initialize feature engineering services', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Run the complete feature engineering pipeline
   * @param {Object} options Pipeline options
   */
  async runPipeline(options = {}) {
    try {
      logger.info('Starting feature engineering pipeline execution', { options });

      const results = await this.dataPipeline.executePipeline(options);

      // Display results
      this.displayResults(results);

      return results;

    } catch (error) {
      logger.error('Feature engineering pipeline execution failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Display pipeline execution results
   * @param {Object} results Pipeline results
   */
  displayResults(results) {
    console.log('\n' + '='.repeat(60));
    console.log('FEATURE ENGINEERING PIPELINE RESULTS');
    console.log('='.repeat(60));

    console.log(`\n📊 Processing Summary:`);
    console.log(`   Total Matches: ${results.totalMatches}`);
    console.log(`   Processed Successfully: ${results.processedMatches}`);
    console.log(`   Total Overs Processed: ${results.processedOvers}`);
    console.log(`   Processing Time: ${(results.processingTime / 1000).toFixed(2)} seconds`);

    if (results.errors && results.errors.length > 0) {
      console.log(`\n⚠️  Errors (${results.errors.length}):`);
      results.errors.slice(0, 5).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
      if (results.errors.length > 5) {
        console.log(`   ... and ${results.errors.length - 5} more errors`);
      }
    }

    if (results.statistics) {
      console.log(`\n📈 Statistics:`);
      
      if (results.statistics.features) {
        const features = results.statistics.features;
        console.log(`   Total Over Features: ${features.totalOvers || 0}`);
        console.log(`   Average Run Rate: ${features.avgRunRate || 0}`);
        console.log(`   Total Runs Processed: ${features.totalRuns || 0}`);
        console.log(`   Total Wickets Processed: ${features.totalWickets || 0}`);
      }

      if (results.statistics.dataQuality) {
        const quality = results.statistics.dataQuality;
        console.log(`   Data Quality Score: ${quality.qualityScore?.toFixed(1)}%`);
        console.log(`   Valid Matches: ${quality.validMatches}/${quality.totalMatches}`);
      }
    }

    if (results.recommendations && results.recommendations.length > 0) {
      console.log(`\n💡 Recommendations:`);
      results.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. [${rec.priority.toUpperCase()}] ${rec.message}`);
        if (rec.action) {
          console.log(`      Action: ${rec.action}`);
        }
      });
    }

    console.log(`\n✅ Pipeline Status: ${results.success ? 'SUCCESS' : 'FAILED'}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Get system status
   */
  async getStatus() {
    try {
      const status = {
        database: this.databaseService?.getStatus(),
        featureEngineer: this.featureEngineer?.getStatus(),
        dataPipeline: this.dataPipeline?.getStatus()
      };

      console.log('\n' + '='.repeat(50));
      console.log('SYSTEM STATUS');
      console.log('='.repeat(50));

      Object.entries(status).forEach(([service, serviceStatus]) => {
        console.log(`\n${service.toUpperCase()}:`);
        console.log(`   Status: ${serviceStatus.status}`);
        console.log(`   Connected: ${serviceStatus.connected}`);
        if (serviceStatus.timestamp) {
          console.log(`   Last Updated: ${serviceStatus.timestamp}`);
        }
      });

      console.log('='.repeat(50) + '\n');

      return status;

    } catch (error) {
      logger.error('Failed to get system status', { error: error.message });
      return null;
    }
  }

  /**
   * Run tests
   */
  async runTests() {
    try {
      console.log('Running feature engineering tests...\n');
      
      const { runTests } = require('./test-feature-engineering');
      const results = await runTests();
      
      return results;

    } catch (error) {
      logger.error('Test execution failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.databaseService) {
        await this.databaseService.disconnect();
      }
      logger.info('Feature engineering runner cleanup completed');
    } catch (error) {
      logger.warn('Error during cleanup', { error: error.message });
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    command: 'pipeline',
    limit: 50,
    batchSize: 10,
    matchIds: null,
    status: ['Finished', 'Live', 'In Progress']
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
        
      case '--test':
      case '-t':
        options.command = 'test';
        break;
        
      case '--status':
      case '-s':
        options.command = 'status';
        break;
        
      case '--limit':
        options.limit = parseInt(args[++i]) || 50;
        break;
        
      case '--batch-size':
        options.batchSize = parseInt(args[++i]) || 10;
        break;
        
      case '--match-ids':
        options.matchIds = args[++i].split(',').map(id => id.trim());
        break;
        
      case '--status-filter':
        options.status = args[++i].split(',').map(s => s.trim());
        break;
        
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Cricket Feature Engineering Pipeline

USAGE:
  node run-feature-engineering.js [OPTIONS]

OPTIONS:
  --help, -h              Show this help message
  --test, -t              Run test suite
  --status, -s            Show system status
  --limit <number>        Maximum matches to process (default: 50)
  --batch-size <number>   Batch size for processing (default: 10)
  --match-ids <ids>       Comma-separated match IDs to process
  --status-filter <status> Comma-separated match statuses to include

EXAMPLES:
  # Run pipeline with default settings
  node run-feature-engineering.js

  # Process specific matches
  node run-feature-engineering.js --match-ids "216,217,218"

  # Run with custom batch size and limit
  node run-feature-engineering.js --limit 100 --batch-size 20

  # Run tests
  node run-feature-engineering.js --test

  # Check system status
  node run-feature-engineering.js --status

  # Process only finished matches
  node run-feature-engineering.js --status-filter "Finished"
`);
}

/**
 * Main execution function
 */
async function main() {
  const options = parseArguments();
  const runner = new FeatureEngineeringRunner();

  try {
    // Initialize services
    const initialized = await runner.initialize();
    if (!initialized) {
      console.error('Failed to initialize services');
      process.exit(1);
    }

    // Execute command
    switch (options.command) {
      case 'test':
        const testResults = await runner.runTests();
        process.exit(testResults.success ? 0 : 1);
        break;
        
      case 'status':
        await runner.getStatus();
        break;
        
      case 'pipeline':
      default:
        const results = await runner.runPipeline(options);
        process.exit(results.success ? 0 : 1);
        break;
    }

  } catch (error) {
    console.error('Execution failed:', error.message);
    logger.error('Main execution failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  } finally {
    await runner.cleanup();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { FeatureEngineeringRunner, parseArguments, showHelp };
