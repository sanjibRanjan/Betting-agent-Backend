"""
Comprehensive unit tests for cricket prediction models.
"""
import pytest
import pandas as pd
import numpy as np
import os
import tempfile
import shutil
from unittest.mock import Mock, patch, MagicMock
import json

from config import Config
from data_loader import CricketDataLoader
from model_trainer import CricketModelTrainer
from model_deployer import CricketPredictionService, ModelPackager


class TestConfig:
    """Test configuration utilities."""
    
    def test_config_initialization(self):
        """Test config initialization."""
        config = Config()
        
        assert config.MONGODB_URI is not None
        assert config.DATABASE_NAME is not None
        assert len(config.TARGET_FEATURES) > 0
        assert len(config.NUMERICAL_FEATURES) > 0
        assert len(config.CATEGORICAL_FEATURES) > 0
    
    def test_target_features_config(self):
        """Test target features configuration."""
        config = Config()
        
        for target_name, target_config in config.TARGET_FEATURES.items():
            assert 'type' in target_config
            assert 'target_column' in target_config
            assert 'description' in target_config
            assert target_config['type'] in ['classification', 'regression']


class TestDataLoader:
    """Test data loading and preprocessing."""
    
    @pytest.fixture
    def sample_data(self):
        """Create sample over features data."""
        return pd.DataFrame({
            'matchId': ['match1', 'match1', 'match2'],
            'fixtureId': ['fix1', 'fix1', 'fix2'],
            'innings': [1, 1, 2],
            'overNumber': [1, 2, 1],
            'teamBatting': ['Team A', 'Team A', 'Team B'],
            'teamBowling': ['Team B', 'Team B', 'Team A'],
            'overRuns': [8, 12, 6],
            'overWickets': [0, 1, 0],
            'overBalls': [6, 6, 6],
            'totalRuns': [8, 20, 6],
            'totalWickets': [0, 1, 0],
            'runRate': [8.0, 10.0, 6.0],
            'batsmanStats': [
                {'striker': {'runs': 6, 'balls': 4}},
                {'striker': {'runs': 8, 'balls': 6}},
                {'striker': {'runs': 4, 'balls': 3}}
            ],
            'bowlerStats': [
                {'runs': 8, 'wickets': 0, 'balls': 6},
                {'runs': 12, 'wickets': 1, 'balls': 6},
                {'runs': 6, 'wickets': 0, 'balls': 6}
            ],
            'momentum': [
                {'recentRunRate': 8.0, 'wicketsInHand': 10},
                {'recentRunRate': 10.0, 'wicketsInHand': 9},
                {'recentRunRate': 6.0, 'wicketsInHand': 10}
            ],
            'matchContext': [
                {'venue': 'Stadium1', 'format': 'T20'},
                {'venue': 'Stadium1', 'format': 'T20'},
                {'venue': 'Stadium2', 'format': 'T20'}
            ]
        })
    
    def test_data_loader_initialization(self):
        """Test data loader initialization."""
        config = Config()
        loader = CricketDataLoader(config)
        
        assert loader.config == config
        assert loader.scaler is not None
        assert loader.imputer is not None
    
    @patch('pymongo.MongoClient')
    def test_database_connection(self, mock_mongo_client):
        """Test database connection."""
        mock_client = Mock()
        mock_mongo_client.return_value = mock_client
        mock_client.admin.command.return_value = True
        
        config = Config()
        loader = CricketDataLoader(config)
        
        result = loader.connect()
        
        assert result is True
        assert loader.client is not None
        assert loader.db is not None
    
    def test_flatten_nested_features(self, sample_data):
        """Test flattening of nested features."""
        config = Config()
        loader = CricketDataLoader(config)
        
        flattened_df = loader._flatten_nested_features(sample_data)
        
        # Check that nested columns are flattened
        assert 'batsmanStats.striker.runs' in flattened_df.columns
        assert 'bowlerStats.runs' in flattened_df.columns
        assert 'momentum.recentRunRate' in flattened_df.columns
        assert 'matchContext.venue' in flattened_df.columns
        
        # Check that original nested columns are removed
        assert 'batsmanStats' not in flattened_df.columns
        assert 'bowlerStats' not in flattened_df.columns
        assert 'momentum' not in flattened_df.columns
        assert 'matchContext' not in flattened_df.columns
    
    def test_handle_missing_values(self, sample_data):
        """Test missing value handling."""
        config = Config()
        loader = CricketDataLoader(config)
        
        # Add some missing values
        sample_data.loc[0, 'overRuns'] = np.nan
        sample_data.loc[1, 'teamBatting'] = np.nan
        
        processed_df = loader._handle_missing_values(sample_data)
        
        # Check that missing values are handled
        assert processed_df['overRuns'].isnull().sum() == 0
        assert processed_df['teamBatting'].isnull().sum() == 0
    
    def test_encode_categorical_features(self, sample_data):
        """Test categorical feature encoding."""
        config = Config()
        loader = CricketDataLoader(config)
        
        encoded_df = loader._encode_categorical_features(sample_data)
        
        # Check that categorical features are encoded
        assert encoded_df['teamBatting'].dtype in ['int64', 'int32']
        assert encoded_df['teamBowling'].dtype in ['int64', 'int32']
    
    def test_engineer_features(self, sample_data):
        """Test feature engineering."""
        config = Config()
        loader = CricketDataLoader(config)
        
        engineered_df = loader._engineer_features(sample_data)
        
        # Check that new features are created
        assert 'is_powerplay' in engineered_df.columns
        assert 'is_death_overs' in engineered_df.columns
        assert 'is_middle_overs' in engineered_df.columns
        
        # Check feature values
        assert engineered_df['is_powerplay'].sum() > 0  # Some overs should be powerplay
        assert engineered_df['is_death_overs'].sum() == 0  # No death overs in sample
    
    def test_create_targets_classification(self, sample_data):
        """Test target creation for classification."""
        config = Config()
        loader = CricketDataLoader(config)
        
        target_df = loader.create_targets(sample_data, 'wicket_occurrence')
        
        # Check that target is created
        assert 'target' in target_df.columns
        assert target_df['target'].dtype in ['int64', 'int32']
        assert target_df['target'].isin([0, 1]).all()
    
    def test_create_targets_regression(self, sample_data):
        """Test target creation for regression."""
        config = Config()
        loader = CricketDataLoader(config)
        
        target_df = loader.create_targets(sample_data, 'runs_per_over')
        
        # Check that target is created
        assert 'target' in target_df.columns
        assert target_df['target'].dtype in ['float64', 'int64']
    
    def test_prepare_train_test_data(self, sample_data):
        """Test train/test data preparation."""
        config = Config()
        loader = CricketDataLoader(config)
        
        # Preprocess data first
        processed_df = loader.preprocess_features(sample_data)
        
        # Prepare train/test data
        X_train, X_val, X_test, y_train, y_val, y_test = loader.prepare_train_test_data(
            processed_df, 'wicket_occurrence'
        )
        
        # Check data shapes
        assert len(X_train) > 0
        assert len(X_val) > 0
        assert len(X_test) > 0
        assert len(X_train) + len(X_val) + len(X_test) == len(processed_df)
        
        # Check that features are scaled
        assert X_train.shape[1] == X_val.shape[1] == X_test.shape[1]


class TestModelTrainer:
    """Test model training and evaluation."""
    
    @pytest.fixture
    def sample_training_data(self):
        """Create sample training data."""
        np.random.seed(42)
        n_samples = 100
        n_features = 10
        
        X_train = pd.DataFrame(
            np.random.randn(n_samples, n_features),
            columns=[f'feature_{i}' for i in range(n_features)]
        )
        
        y_train = pd.Series(np.random.randint(0, 2, n_samples))
        X_val = pd.DataFrame(
            np.random.randn(20, n_features),
            columns=[f'feature_{i}' for i in range(n_features)]
        )
        y_val = pd.Series(np.random.randint(0, 2, 20))
        
        return X_train, y_train, X_val, y_val
    
    def test_model_trainer_initialization(self):
        """Test model trainer initialization."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        assert trainer.config == config
        assert trainer.models == {}
        assert trainer.results == {}
    
    def test_get_classification_models(self):
        """Test getting classification models."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        models = trainer._get_classification_models()
        
        assert 'logistic_regression' in models
        assert 'random_forest' in models
        assert 'gradient_boosting' in models
        assert 'xgboost' in models
    
    def test_get_regression_models(self):
        """Test getting regression models."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        models = trainer._get_regression_models()
        
        assert 'random_forest' in models
        assert 'gradient_boosting' in models
        assert 'xgboost' in models
    
    def test_calculate_metrics_classification(self, sample_training_data):
        """Test metrics calculation for classification."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        X_train, y_train, X_val, y_val = sample_training_data
        
        # Create dummy predictions
        y_pred = np.random.randint(0, 2, len(y_val))
        
        metrics = trainer._calculate_metrics(y_val, y_pred, 'classification')
        
        assert 'accuracy' in metrics
        assert 'precision' in metrics
        assert 'recall' in metrics
        assert 'f1' in metrics
        assert all(0 <= v <= 1 for v in metrics.values() if isinstance(v, (int, float)))
    
    def test_calculate_metrics_regression(self, sample_training_data):
        """Test metrics calculation for regression."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        X_train, y_train, X_val, y_val = sample_training_data
        
        # Create dummy predictions for regression
        y_pred = np.random.randn(len(y_val))
        y_val_regression = pd.Series(np.random.randn(len(y_val)))
        
        metrics = trainer._calculate_metrics(y_val_regression, y_pred, 'regression')
        
        assert 'mse' in metrics
        assert 'rmse' in metrics
        assert 'mae' in metrics
        assert 'r2' in metrics
    
    def test_get_feature_importance(self, sample_training_data):
        """Test feature importance extraction."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        X_train, y_train, X_val, y_val = sample_training_data
        
        # Create a simple model
        from sklearn.ensemble import RandomForestClassifier
        model = RandomForestClassifier(n_estimators=10, random_state=42)
        model.fit(X_train, y_train)
        
        importance = trainer._get_feature_importance(model, X_train.columns)
        
        assert isinstance(importance, dict)
        assert len(importance) == len(X_train.columns)
        assert all(isinstance(v, (int, float)) for v in importance.values())
    
    @patch('joblib.dump')
    def test_save_model(self, mock_dump, sample_training_data):
        """Test model saving."""
        config = Config()
        trainer = CricketModelTrainer(config)
        
        X_train, y_train, X_val, y_val = sample_training_data
        
        # Create a simple model
        from sklearn.ensemble import RandomForestClassifier
        model = RandomForestClassifier(n_estimators=10, random_state=42)
        model.fit(X_train, y_train)
        
        trainer._save_model(model, 'test_model', 'test_target')
        
        mock_dump.assert_called_once()


class TestModelDeployer:
    """Test model deployment utilities."""
    
    @pytest.fixture
    def temp_dir(self):
        """Create temporary directory for testing."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @patch('joblib.load')
    @patch('joblib.dump')
    def test_model_packager_initialization(self, mock_dump, mock_load, temp_dir):
        """Test model packager initialization."""
        config = Config()
        packager = ModelPackager(config)
        
        assert packager.config == config
    
    @patch('joblib.load')
    @patch('joblib.dump')
    def test_package_model(self, mock_dump, mock_load, temp_dir):
        """Test model packaging."""
        # Mock model
        mock_model = Mock()
        mock_model.feature_importances_ = np.random.rand(10)
        
        # Mock file existence
        with patch('os.path.exists', return_value=True):
            with patch('joblib.load', return_value=mock_model):
                config = Config()
                packager = ModelPackager(config)
                
                result = packager.package_model('test_target', 'test_model')
                
                assert result['success'] is True
                assert 'package_path' in result
                assert 'metadata' in result
    
    @patch('flask.Flask')
    def test_prediction_service_initialization(self, mock_flask):
        """Test prediction service initialization."""
        config = Config()
        
        with patch.object(CricketPredictionService, '_load_models'):
            service = CricketPredictionService(config)
            
            assert service.config == config
            assert service.data_loader is not None
            assert service.app is not None
    
    @patch('flask.Flask')
    def test_prediction_service_health_check(self, mock_flask):
        """Test prediction service health check."""
        config = Config()
        
        with patch.object(CricketPredictionService, '_load_models'):
            service = CricketPredictionService(config)
            
            # Mock the health check endpoint
            with service.app.test_client() as client:
                response = client.get('/health')
                assert response.status_code == 200


class TestIntegration:
    """Integration tests."""
    
    @pytest.fixture
    def temp_dir(self):
        """Create temporary directory for testing."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @patch('pymongo.MongoClient')
    def test_full_pipeline_mock(self, mock_mongo_client, temp_dir):
        """Test full pipeline with mocked database."""
        # Mock MongoDB connection
        mock_client = Mock()
        mock_mongo_client.return_value = mock_client
        mock_client.admin.command.return_value = True
        
        # Mock database and collection
        mock_db = Mock()
        mock_collection = Mock()
        mock_client.__getitem__.return_value = mock_db
        mock_db.__getitem__.return_value = mock_collection
        
        # Mock data
        mock_data = [
            {
                'matchId': 'test_match',
                'fixtureId': 'test_fixture',
                'innings': 1,
                'overNumber': 1,
                'overRuns': 8,
                'overWickets': 0,
                'batsmanStats': {'striker': {'runs': 6}},
                'bowlerStats': {'runs': 8},
                'momentum': {'recentRunRate': 8.0},
                'matchContext': {'venue': 'Test Stadium'}
            }
        ]
        mock_collection.find.return_value = mock_data
        
        # Test data loading
        config = Config()
        loader = CricketDataLoader(config)
        
        assert loader.connect() is True
        
        df = loader.load_over_features()
        assert len(df) == 1
        
        # Test preprocessing
        processed_df = loader.preprocess_features(df)
        assert len(processed_df) > 0
        
        loader.disconnect()


# Pytest configuration
if __name__ == '__main__':
    pytest.main([__file__, '-v'])
