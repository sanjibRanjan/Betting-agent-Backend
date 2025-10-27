"""
Example usage of the cricket prediction ML system.
This script demonstrates how to use the system for predictions and analysis.
"""
import logging
import json
from datetime import datetime

from config import Config
from data_loader import CricketDataLoader
from model_trainer import CricketModelTrainer
from model_deployer import CricketPredictionService, ModelPackager

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def example_data_loading():
    """Example of loading and exploring cricket data."""
    print("\n" + "="*50)
    print("EXAMPLE 1: Data Loading and Exploration")
    print("="*50)
    
    # Initialize data loader
    config = Config()
    loader = CricketDataLoader(config)
    
    # Connect to database
    if not loader.connect():
        print("Failed to connect to database")
        return
    
    try:
        # Load a sample of data
        print("Loading over features data...")
        df = loader.load_over_features(limit=100)
        
        if df.empty:
            print("No data found. Please ensure OverFeatures collection exists.")
            return
        
        print(f"Loaded {len(df)} records")
        print(f"Columns: {list(df.columns)}")
        print(f"Sample data:")
        print(df.head())
        
        # Get feature information
        feature_info = loader.get_feature_importance_data(df)
        print(f"\nFeature Statistics:")
        print(f"  - Total features: {feature_info['total_features']}")
        print(f"  - Numerical features: {feature_info['numerical_features']}")
        print(f"  - Categorical features: {feature_info['categorical_features']}")
        
        # Show data quality
        missing_data = feature_info['missing_values']
        print(f"\nMissing Data Summary:")
        for col, missing_count in missing_data.items():
            if missing_count > 0:
                print(f"  - {col}: {missing_count} missing values")
        
    finally:
        loader.disconnect()


def example_model_training():
    """Example of training a single model."""
    print("\n" + "="*50)
    print("EXAMPLE 2: Model Training")
    print("="*50)
    
    # Initialize components
    config = Config()
    loader = CricketDataLoader(config)
    trainer = CricketModelTrainer(config)
    
    # Connect to database
    if not loader.connect():
        print("Failed to connect to database")
        return
    
    try:
        # Load and preprocess data
        print("Loading and preprocessing data...")
        df = loader.load_over_features(limit=500)
        processed_df = loader.preprocess_features(df)
        
        if processed_df.empty:
            print("No data available for training")
            return
        
        # Train a single model for wicket prediction
        target_name = 'wicket_occurrence'
        print(f"Training models for: {target_name}")
        
        # Prepare data
        X_train, X_val, X_test, y_train, y_val, y_test = loader.prepare_train_test_data(
            processed_df, target_name
        )
        
        print(f"Data split: Train={len(X_train)}, Val={len(X_val)}, Test={len(X_test)}")
        
        # Train models
        training_results = trainer.train_models(
            X_train, y_train, X_val, y_val, target_name, 'classification'
        )
        
        # Show results
        print(f"\nTraining Results for {target_name}:")
        for model_name, result in training_results.items():
            if 'error' in result:
                print(f"  {model_name}: ERROR - {result['error']}")
            else:
                val_metrics = result.get('val_metrics', {})
                print(f"  {model_name}:")
                print(f"    - Accuracy: {val_metrics.get('accuracy', 0):.3f}")
                print(f"    - Precision: {val_metrics.get('precision', 0):.3f}")
                print(f"    - Recall: {val_metrics.get('recall', 0):.3f}")
                print(f"    - F1-Score: {val_metrics.get('f1', 0):.3f}")
        
        # Generate report
        report = trainer.generate_model_report(target_name, 'classification')
        if 'best_model' in report:
            print(f"\nBest model: {report['best_model']}")
        
    finally:
        loader.disconnect()


def example_prediction_service():
    """Example of using the prediction service."""
    print("\n" + "="*50)
    print("EXAMPLE 3: Prediction Service")
    print("="*50)
    
    # Initialize prediction service
    config = Config()
    service = CricketPredictionService(config)
    
    # Example feature data (typical over-level features)
    example_features = {
        'overRuns': 8,
        'overWickets': 0,
        'overBalls': 6,
        'overExtras': 2,
        'overBoundaries': 1,
        'overSixes': 0,
        'totalRuns': 120,
        'totalWickets': 3,
        'totalOvers': 12.0,
        'runRate': 10.0,
        'requiredRunRate': 8.5,
        'momentum.recentRunRate': 9.5,
        'momentum.wicketsInHand': 7,
        'momentum.pressureIndex': 1.12,
        'momentum.partnershipRuns': 45,
        'momentum.partnershipBalls': 32,
        'batsmanStats.striker.runs': 28,
        'batsmanStats.striker.balls': 18,
        'batsmanStats.striker.strikeRate': 155.6,
        'bowlerStats.runs': 12,
        'bowlerStats.wickets': 1,
        'bowlerStats.balls': 6,
        'bowlerStats.economyRate': 12.0,
        'bowlerStats.dotBalls': 2,
        'overNumber': 13,
        'teamBatting': 'India',
        'teamBowling': 'Australia',
        'venue': 'Melbourne Cricket Ground',
        'format': 'T20'
    }
    
    print("Example prediction features:")
    for key, value in example_features.items():
        print(f"  {key}: {value}")
    
    # Make predictions for different targets
    targets_to_predict = ['wicket_occurrence', 'runs_per_over']
    
    print(f"\nMaking predictions for: {', '.join(targets_to_predict)}")
    
    for target_name in targets_to_predict:
        prediction = service.predict_single(target_name, example_features)
        
        if prediction:
            print(f"\n{target_name}:")
            print(f"  Prediction: {prediction.get('prediction')}")
            if prediction.get('confidence'):
                print(f"  Confidence: {prediction['confidence']:.3f}")
            if prediction.get('probabilities'):
                print(f"  Probabilities: {prediction['probabilities']}")
        else:
            print(f"\n{target_name}: No prediction available")


def example_model_packaging():
    """Example of packaging models for deployment."""
    print("\n" + "="*50)
    print("EXAMPLE 4: Model Packaging")
    print("="*50)
    
    # Initialize packager
    config = Config()
    packager = ModelPackager(config)
    
    # Package a model
    target_name = 'wicket_occurrence'
    model_name = 'random_forest'
    
    print(f"Creating deployment package for {target_name} using {model_name}")
    
    try:
        package_result = packager.create_deployment_package(target_name, model_name)
        
        if package_result['success']:
            print(f"✓ Package created successfully!")
            print(f"  Deployment directory: {package_result['deployment_dir']}")
            print(f"  Model metadata:")
            metadata = package_result['metadata']
            print(f"    - Target: {metadata['target_name']}")
            print(f"    - Model Type: {metadata['model_type']}")
            print(f"    - Created: {metadata['created_at']}")
            print(f"    - Version: {metadata['version']}")
            
            # Show feature information
            feature_info = metadata.get('feature_info', {})
            if feature_info:
                print(f"  Feature information:")
                for key, value in feature_info.items():
                    print(f"    - {key}: {value}")
        else:
            print(f"✗ Package creation failed: {package_result['error']}")
            
    except Exception as e:
        print(f"✗ Error creating package: {e}")


def example_batch_predictions():
    """Example of making batch predictions."""
    print("\n" + "="*50)
    print("EXAMPLE 5: Batch Predictions")
    print("="*50)
    
    # Initialize prediction service
    config = Config()
    service = CricketPredictionService(config)
    
    # Multiple feature sets (representing different overs)
    batch_features = [
        {
            'overRuns': 6,
            'totalRuns': 90,
            'runRate': 9.0,
            'overNumber': 10,
            'momentum.wicketsInHand': 8,
            'teamBatting': 'India'
        },
        {
            'overRuns': 12,
            'totalRuns': 110,
            'runRate': 10.0,
            'overNumber': 11,
            'momentum.wicketsInHand': 7,
            'teamBatting': 'India'
        },
        {
            'overRuns': 4,
            'totalRuns': 125,
            'runRate': 9.8,
            'overNumber': 12,
            'momentum.wicketsInHand': 6,
            'teamBatting': 'India'
        }
    ]
    
    print(f"Making batch predictions for {len(batch_features)} overs")
    
    # Make predictions for each feature set
    for i, features in enumerate(batch_features):
        print(f"\nOver {i+1}:")
        print(f"  Features: {features}")
        
        # Predict wicket occurrence
        wicket_prediction = service.predict_single('wicket_occurrence', features)
        if wicket_prediction:
            print(f"  Wicket probability: {wicket_prediction.get('prediction', 'N/A')}")
        
        # Predict runs per over
        runs_prediction = service.predict_single('runs_per_over', features)
        if runs_prediction:
            print(f"  Predicted runs: {runs_prediction.get('prediction', 'N/A')}")


def main():
    """Run all examples."""
    print("CRICKET PREDICTION ML SYSTEM - USAGE EXAMPLES")
    print("="*60)
    
    try:
        # Run examples
        example_data_loading()
        example_model_training()
        example_prediction_service()
        example_model_packaging()
        example_batch_predictions()
        
        print("\n" + "="*60)
        print("All examples completed successfully!")
        print("="*60)
        
        print("\nNext steps:")
        print("1. Train models: python run_training_pipeline.py")
        print("2. Start prediction service: python main.py serve")
        print("3. Test API endpoints with the provided examples")
        print("4. Integrate predictions into your cricket application")
        
    except Exception as e:
        logger.error(f"Example execution failed: {e}")
        print(f"\nError: {e}")
        print("Please check your configuration and ensure MongoDB is running.")


if __name__ == '__main__':
    main()
