"""
Complete training pipeline script for cricket prediction models.
This script demonstrates the full workflow from data loading to model deployment.
"""
import logging
import sys
import os
from datetime import datetime
import json

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config import Config
from data_loader import CricketDataLoader
from model_trainer import CricketModelTrainer
from model_deployer import ModelPackager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f'ml_training_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def main():
    """Main training pipeline execution."""
    logger.info("Starting Cricket Prediction Model Training Pipeline")
    logger.info("=" * 60)
    
    # Initialize configuration
    config = Config()
    logger.info(f"Configuration loaded: {len(config.TARGET_FEATURES)} prediction targets")
    
    # Initialize components
    data_loader = CricketDataLoader(config)
    trainer = CricketModelTrainer(config)
    packager = ModelPackager(config)
    
    try:
        # Step 1: Connect to database
        logger.info("Step 1: Connecting to MongoDB...")
        if not data_loader.connect():
            logger.error("Failed to connect to MongoDB. Please check your connection settings.")
            return False
        
        logger.info("✓ Database connection established")
        
        # Step 2: Load and explore data
        logger.info("Step 2: Loading over features data...")
        df = data_loader.load_over_features(limit=5000)  # Load up to 5000 samples
        
        if df.empty:
            logger.error("No data found in OverFeatures collection. Please run feature engineering first.")
            return False
        
        logger.info(f"✓ Loaded {len(df)} over features records")
        logger.info(f"  - Unique matches: {df['matchId'].nunique()}")
        logger.info(f"  - Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
        
        # Step 3: Preprocess features
        logger.info("Step 3: Preprocessing features...")
        processed_df = data_loader.preprocess_features(df)
        logger.info(f"✓ Preprocessing completed. Shape: {processed_df.shape}")
        
        # Get feature information
        feature_info = data_loader.get_feature_importance_data(processed_df)
        logger.info(f"Feature statistics:")
        logger.info(f"  - Total features: {feature_info['total_features']}")
        logger.info(f"  - Numerical features: {feature_info['numerical_features']}")
        logger.info(f"  - Categorical features: {feature_info['categorical_features']}")
        
        # Step 4: Train models for each target
        logger.info("Step 4: Training prediction models...")
        all_results = {}
        
        for target_name, target_config in config.TARGET_FEATURES.items():
            logger.info(f"\nTraining models for: {target_name}")
            logger.info(f"  Type: {target_config['type']}")
            logger.info(f"  Description: {target_config['description']}")
            
            try:
                # Prepare train/test data
                X_train, X_val, X_test, y_train, y_val, y_test = data_loader.prepare_train_test_data(
                    processed_df, target_name
                )
                
                if X_train.empty:
                    logger.warning(f"No training data available for {target_name}")
                    continue
                
                logger.info(f"  Data split: Train={len(X_train)}, Val={len(X_val)}, Test={len(X_test)}")
                
                # Train models
                training_results = trainer.train_models(
                    X_train, y_train, X_val, y_val, target_name, target_config['type']
                )
                
                # Evaluate on test set
                test_results = trainer.evaluate_on_test(X_test, y_test, target_name, target_config['type'])
                
                # Generate comprehensive report
                report = trainer.generate_model_report(target_name, target_config['type'])
                
                all_results[target_name] = {
                    'training_results': training_results,
                    'test_results': test_results,
                    'report': report,
                    'feature_info': feature_info
                }
                
                # Log best model
                if 'best_model' in report and report['best_model']:
                    best_model = report['best_model']
                    val_metrics = training_results.get(best_model, {}).get('val_metrics', {})
                    
                    if target_config['type'] == 'classification':
                        score = val_metrics.get('f1', 0)
                        logger.info(f"  ✓ Best model: {best_model} (F1: {score:.3f})")
                    else:
                        score = val_metrics.get('r2', 0)
                        logger.info(f"  ✓ Best model: {best_model} (R²: {score:.3f})")
                
                logger.info(f"  ✓ Training completed for {target_name}")
                
            except Exception as e:
                logger.error(f"  ✗ Error training {target_name}: {e}")
                all_results[target_name] = {'error': str(e)}
        
        # Step 5: Generate summary report
        logger.info("\nStep 5: Generating summary report...")
        summary_report = generate_summary_report(all_results, config)
        
        # Save comprehensive results
        results_file = f"training_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump({
                'summary': summary_report,
                'detailed_results': all_results,
                'config': {
                    'target_features': config.TARGET_FEATURES,
                    'model_configs': config.MODEL_CONFIGS,
                    'training_timestamp': datetime.now().isoformat()
                }
            }, f, indent=2, default=str)
        
        logger.info(f"✓ Results saved to: {results_file}")
        
        # Step 6: Create deployment packages
        logger.info("\nStep 6: Creating deployment packages...")
        deployment_results = {}
        
        for target_name in config.TARGET_FEATURES.keys():
            if target_name in all_results and 'error' not in all_results[target_name]:
                logger.info(f"  Creating deployment package for: {target_name}")
                
                try:
                    package_result = packager.create_deployment_package(target_name)
                    deployment_results[target_name] = package_result
                    
                    if package_result['success']:
                        logger.info(f"  ✓ Deployment package created: {package_result['deployment_dir']}")
                    else:
                        logger.error(f"  ✗ Failed to create package: {package_result['error']}")
                        
                except Exception as e:
                    logger.error(f"  ✗ Error creating deployment package for {target_name}: {e}")
                    deployment_results[target_name] = {'error': str(e)}
        
        # Final summary
        logger.info("\n" + "=" * 60)
        logger.info("TRAINING PIPELINE COMPLETED")
        logger.info("=" * 60)
        
        successful_targets = [name for name, result in all_results.items() 
                            if 'error' not in result]
        failed_targets = [name for name, result in all_results.items() 
                         if 'error' in result]
        
        logger.info(f"✓ Successfully trained: {len(successful_targets)} targets")
        if successful_targets:
            logger.info(f"  - {', '.join(successful_targets)}")
        
        if failed_targets:
            logger.warning(f"✗ Failed training: {len(failed_targets)} targets")
            logger.warning(f"  - {', '.join(failed_targets)}")
        
        logger.info(f"✓ Models saved to: {config.MODELS_DIR}")
        logger.info(f"✓ Reports saved to: {config.REPORTS_DIR}")
        
        if deployment_results:
            successful_deployments = [name for name, result in deployment_results.items() 
                                    if result.get('success', False)]
            if successful_deployments:
                logger.info(f"✓ Deployment packages created: {len(successful_deployments)}")
                logger.info(f"  - {', '.join(successful_deployments)}")
        
        logger.info("\nNext steps:")
        logger.info("1. Review model reports in the reports/ directory")
        logger.info("2. Test predictions using the deployment packages")
        logger.info("3. Start the prediction service: python main.py serve")
        
        return True
        
    except Exception as e:
        logger.error(f"Pipeline failed with error: {e}")
        return False
        
    finally:
        # Cleanup
        data_loader.disconnect()
        logger.info("Database connection closed")


def generate_summary_report(all_results: dict, config: Config) -> dict:
    """Generate a summary report of all training results."""
    summary = {
        'pipeline_timestamp': datetime.now().isoformat(),
        'total_targets': len(config.TARGET_FEATURES),
        'successful_targets': 0,
        'failed_targets': 0,
        'target_summaries': {},
        'best_models': {},
        'performance_summary': {}
    }
    
    for target_name, result in all_results.items():
        if 'error' in result:
            summary['failed_targets'] += 1
            summary['target_summaries'][target_name] = {
                'status': 'failed',
                'error': result['error']
            }
        else:
            summary['successful_targets'] += 1
            
            # Get best model and performance
            report = result.get('report', {})
            best_model = report.get('best_model')
            
            if best_model:
                training_results = result.get('training_results', {})
                val_metrics = training_results.get(best_model, {}).get('val_metrics', {})
                
                summary['best_models'][target_name] = best_model
                
                # Get appropriate performance metric
                target_config = config.TARGET_FEATURES[target_name]
                if target_config['type'] == 'classification':
                    performance = val_metrics.get('f1', 0)
                else:
                    performance = val_metrics.get('r2', 0)
                
                summary['performance_summary'][target_name] = performance
                
                summary['target_summaries'][target_name] = {
                    'status': 'success',
                    'best_model': best_model,
                    'performance': performance,
                    'val_metrics': val_metrics
                }
            else:
                summary['target_summaries'][target_name] = {
                    'status': 'partial',
                    'error': 'No best model determined'
                }
    
    return summary


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
