"""
Configuration settings for the cricket predictive modeling system.
"""
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Config:
    """Configuration class for ML models and data processing."""
    
    # MongoDB Configuration
    MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/sanjib-agent')
    DATABASE_NAME = os.getenv('DATABASE_NAME', 'sanjib-agent')
    
    # Collections
    OVER_FEATURES_COLLECTION = 'overfeatures'
    MATCHES_COLLECTION = 'matches'
    
    # Model Configuration
    MODELS_DIR = 'models'
    REPORTS_DIR = 'reports'
    DATA_DIR = 'data'
    
    # Training Configuration
    TEST_SIZE = 0.2
    VALIDATION_SIZE = 0.2
    RANDOM_STATE = 42
    CV_FOLDS = 5
    
    # Feature Configuration
    TARGET_FEATURES = {
        'wicket_occurrence': {
            'type': 'classification',
            'target_column': 'overWickets',
            'threshold': 1,  # >= 1 wicket
            'description': 'Predict wicket occurrence in next over'
        },
        'runs_per_over': {
            'type': 'regression',
            'target_column': 'overRuns',
            'description': 'Predict runs scored in next over'
        },
        'boundary_probability': {
            'type': 'classification',
            'target_column': 'overBoundaries',
            'threshold': 1,  # >= 1 boundary
            'description': 'Predict boundary probability in next over'
        },
        'run_rate_change': {
            'type': 'regression',
            'target_column': 'runRate',
            'description': 'Predict run rate change in next over'
        }
    }
    
    # Feature Selection
    NUMERICAL_FEATURES = [
        'overRuns', 'overWickets', 'overBalls', 'overExtras', 'overBoundaries', 'overSixes',
        'totalRuns', 'totalWickets', 'totalOvers', 'runRate', 'requiredRunRate',
        'momentum.recentRunRate', 'momentum.wicketsInHand', 'momentum.pressureIndex',
        'momentum.partnershipRuns', 'momentum.partnershipBalls',
        'batsmanStats.striker.runs', 'batsmanStats.striker.balls', 'batsmanStats.striker.strikeRate',
        'batsmanStats.nonStriker.runs', 'batsmanStats.nonStriker.balls', 'batsmanStats.nonStriker.strikeRate',
        'bowlerStats.runs', 'bowlerStats.wickets', 'bowlerStats.balls', 'bowlerStats.economyRate', 'bowlerStats.dotBalls'
    ]
    
    CATEGORICAL_FEATURES = [
        'teamBatting', 'teamBowling', 'venue', 'format', 'series'
    ]
    
    # Model Hyperparameters
    MODEL_CONFIGS = {
        'logistic_regression': {
            'C': [0.1, 1, 10, 100],
            'penalty': ['l1', 'l2'],
            'solver': ['liblinear', 'saga']
        },
        'random_forest': {
            'n_estimators': [50, 100, 200],
            'max_depth': [10, 20, None],
            'min_samples_split': [2, 5, 10],
            'min_samples_leaf': [1, 2, 4]
        },
        'gradient_boosting': {
            'n_estimators': [50, 100, 200],
            'learning_rate': [0.01, 0.1, 0.2],
            'max_depth': [3, 5, 7],
            'subsample': [0.8, 0.9, 1.0]
        },
        'xgboost': {
            'n_estimators': [50, 100, 200],
            'learning_rate': [0.01, 0.1, 0.2],
            'max_depth': [3, 5, 7],
            'subsample': [0.8, 0.9, 1.0]
        }
    }
    
    # Evaluation Metrics
    CLASSIFICATION_METRICS = ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']
    REGRESSION_METRICS = ['mse', 'rmse', 'mae', 'r2']
    
    # Data Processing
    MIN_SAMPLES_PER_MATCH = 10  # Minimum overs per match for training
    MAX_MISSING_RATIO = 0.3     # Maximum missing data ratio
    OUTLIER_THRESHOLD = 3       # Z-score threshold for outlier detection
    
    # Logging
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
