"""
Main script for training and evaluating cricket prediction models.
"""
import logging
import argparse
import sys
import os
from typing import Dict, List, Any
import json

from config import Config
from data_loader import CricketDataLoader
from model_trainer import CricketModelTrainer
from model_deployer import CricketPredictionService, ModelPackager

# Configure logging
logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL), format=Config.LOG_FORMAT)
logger = logging.getLogger(__name__)


def train_models(target_names: List[str] = None, limit: int = None) -> Dict[str, Any]:
    """Train models for specified targets.
    
    Args:
        target_names: List of target names to train (None for all)
        limit: Limit on number of samples to use for training
        
    Returns:
        Dict: Training results
    """
    logger.info("Starting model training pipeline")
    
    # Initialize components
    config = Config()
    data_loader = CricketDataLoader(config)
    trainer = CricketModelTrainer(config)
    
    # Connect to database
    if not data_loader.connect():
        logger.error("Failed to connect to database")
        return {'error': 'Database connection failed'}
    
    try:
        # Load and preprocess data
        logger.info("Loading over features data...")
        df = data_loader.load_over_features(limit=limit)
        
        if df.empty:
            logger.error("No data loaded")
            return {'error': 'No data available'}
        
        logger.info(f"Loaded {len(df)} samples")
        
        # Preprocess features
        logger.info("Preprocessing features...")
        processed_df = data_loader.preprocess_features(df)
        
        # Get feature information
        feature_info = data_loader.get_feature_importance_data(processed_df)
        logger.info(f"Feature info: {json.dumps(feature_info, indent=2)}")
        
        # Determine targets to train
        targets_to_train = target_names or list(config.TARGET_FEATURES.keys())
        
        all_results = {}
        
        for target_name in targets_to_train:
            logger.info(f"Training models for {target_name}...")
            
            try:
                # Get task type
                task_type = config.TARGET_FEATURES[target_name]['type']
                
                # Prepare train/test data
                X_train, X_val, X_test, y_train, y_val, y_test = data_loader.prepare_train_test_data(
                    processed_df, target_name
                )
                
                if X_train.empty:
                    logger.error(f"No training data for {target_name}")
                    continue
                
                # Train models
                training_results = trainer.train_models(
                    X_train, y_train, X_val, y_val, target_name, task_type
                )
                
                # Evaluate on test set
                test_results = trainer.evaluate_on_test(X_test, y_test, target_name, task_type)
                
                # Generate report
                report = trainer.generate_model_report(target_name, task_type)
                
                all_results[target_name] = {
                    'training_results': training_results,
                    'test_results': test_results,
                    'report': report,
                    'feature_info': feature_info
                }
                
                logger.info(f"Completed training for {target_name}")
                
            except Exception as e:
                logger.error(f"Error training {target_name}: {e}")
                all_results[target_name] = {'error': str(e)}
        
        return all_results
        
    finally:
        data_loader.disconnect()


def evaluate_models(target_names: List[str] = None) -> Dict[str, Any]:
    """Evaluate trained models.
    
    Args:
        target_names: List of target names to evaluate (None for all)
        
    Returns:
        Dict: Evaluation results
    """
    logger.info("Starting model evaluation")
    
    config = Config()
    trainer = CricketModelTrainer(config)
    
    # Determine targets to evaluate
    targets_to_evaluate = target_names or list(config.TARGET_FEATURES.keys())
    
    evaluation_results = {}
    
    for target_name in targets_to_evaluate:
        try:
            task_type = config.TARGET_FEATURES[target_name]['type']
            report = trainer.generate_model_report(target_name, task_type)
            evaluation_results[target_name] = report
            
        except Exception as e:
            logger.error(f"Error evaluating {target_name}: {e}")
            evaluation_results[target_name] = {'error': str(e)}
    
    return evaluation_results


def deploy_models(target_names: List[str] = None) -> Dict[str, Any]:
    """Deploy trained models as prediction services.
    
    Args:
        target_names: List of target names to deploy (None for all)
        
    Returns:
        Dict: Deployment results
    """
    logger.info("Starting model deployment")
    
    config = Config()
    packager = ModelPackager(config)
    
    # Determine targets to deploy
    targets_to_deploy = target_names or list(config.TARGET_FEATURES.keys())
    
    deployment_results = {}
    
    for target_name in targets_to_deploy:
        try:
            # Create deployment package
            package_result = packager.create_deployment_package(target_name)
            deployment_results[target_name] = package_result
            
            logger.info(f"Deployment package created for {target_name}")
            
        except Exception as e:
            logger.error(f"Error deploying {target_name}: {e}")
            deployment_results[target_name] = {'error': str(e)}
    
    return deployment_results


def run_prediction_service(host: str = '0.0.0.0', port: int = 5001, debug: bool = False):
    """Run the prediction service server.
    
    Args:
        host: Server host
        port: Server port
        debug: Enable debug mode
    """
    logger.info("Starting prediction service")
    
    config = Config()
    service = CricketPredictionService(config)
    
    try:
        service.run_server(host=host, port=port, debug=debug)
    except KeyboardInterrupt:
        logger.info("Prediction service stopped")
    except Exception as e:
        logger.error(f"Prediction service error: {e}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Cricket Prediction Model Pipeline')
    parser.add_argument('command', choices=['train', 'evaluate', 'deploy', 'serve'],
                       help='Command to execute')
    parser.add_argument('--targets', nargs='+', help='Target names to process')
    parser.add_argument('--limit', type=int, help='Limit number of samples for training')
    parser.add_argument('--host', default='0.0.0.0', help='Server host for prediction service')
    parser.add_argument('--port', type=int, default=5001, help='Server port for prediction service')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    parser.add_argument('--output', help='Output file for results')
    
    args = parser.parse_args()
    
    try:
        if args.command == 'train':
            results = train_models(args.targets, args.limit)
        elif args.command == 'evaluate':
            results = evaluate_models(args.targets)
        elif args.command == 'deploy':
            results = deploy_models(args.targets)
        elif args.command == 'serve':
            run_prediction_service(args.host, args.port, args.debug)
            return
        
        # Save results if output file specified
        if args.output and results:
            with open(args.output, 'w') as f:
                json.dump(results, f, indent=2, default=str)
            logger.info(f"Results saved to {args.output}")
        
        # Print summary
        print(f"\n=== {args.command.upper()} RESULTS ===")
        for target_name, result in results.items():
            if 'error' in result:
                print(f"{target_name}: ERROR - {result['error']}")
            else:
                print(f"{target_name}: SUCCESS")
                if 'report' in result and 'best_model' in result['report']:
                    print(f"  Best model: {result['report']['best_model']}")
                if 'deployment_dir' in result:
                    print(f"  Deployment: {result['deployment_dir']}")
        
    except Exception as e:
        logger.error(f"Pipeline error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
