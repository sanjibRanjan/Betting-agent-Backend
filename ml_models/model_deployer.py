"""
Model deployment utilities for real-time cricket prediction service.
"""
import logging
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import joblib
import json
import os
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient

from config import Config
from data_loader import CricketDataLoader

# Configure logging
logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL), format=Config.LOG_FORMAT)
logger = logging.getLogger(__name__)


class CricketPredictionService:
    """Real-time prediction service for cricket events."""
    
    def __init__(self, config: Config = None):
        """Initialize the prediction service.
        
        Args:
            config: Configuration object (optional)
        """
        self.config = config or Config()
        self.models = {}
        self.data_loader = CricketDataLoader(self.config)
        self.app = Flask(__name__)
        
        # Enable CORS for all routes
        CORS(self.app, origins=['http://localhost:3000', 'http://localhost:3001'])
        
        # Load trained models
        self._load_models()
        
        # Setup Flask routes
        self._setup_routes()
    
    def _load_models(self):
        """Load all trained models from disk."""
        logger.info("Loading trained models...")
        
        for target_name in self.config.TARGET_FEATURES.keys():
            self.models[target_name] = {}
            
            # Try to load all model types for this target
            model_types = ['logistic_regression', 'random_forest', 'gradient_boosting', 'xgboost']
            
            for model_type in model_types:
                model_path = os.path.join(self.config.MODELS_DIR, f"{model_type}_{target_name}.joblib")
                
                if os.path.exists(model_path):
                    try:
                        model = joblib.load(model_path)
                        self.models[target_name][model_type] = model
                        logger.info(f"Loaded {model_type} for {target_name}")
                    except Exception as e:
                        logger.error(f"Failed to load {model_type} for {target_name}: {e}")
        
        logger.info(f"Loaded models for {len(self.models)} prediction tasks")
    
    def _setup_routes(self):
        """Setup Flask API routes."""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            """Health check endpoint."""
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'models_loaded': len(self.models),
                'available_targets': list(self.models.keys())
            })
        
        @self.app.route('/predict/<target_name>', methods=['POST'])
        def predict(target_name):
            """Make predictions for a specific target.
            
            Expected JSON payload:
            {
                "features": {...},  # Feature values
                "model_type": "best"  # or specific model name
            }
            """
            try:
                data = request.get_json()
                
                if not data or 'features' not in data:
                    return jsonify({'error': 'Missing features in request'}), 400
                
                # Get model type
                model_type = data.get('model_type', 'best')
                
                # Make prediction
                prediction = self.predict_single(target_name, data['features'], model_type)
                
                if prediction is None:
                    return jsonify({'error': f'No model available for {target_name}'}), 404
                
                return jsonify({
                    'target': target_name,
                    'model_type': model_type,
                    'prediction': prediction,
                    'timestamp': datetime.now().isoformat()
                })
                
            except Exception as e:
                logger.error(f"Prediction error: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/predict_batch', methods=['POST'])
        def predict_batch():
            """Make batch predictions for multiple targets.
            
            Expected JSON payload:
            {
                "features": {...},  # Feature values
                "targets": ["wicket_occurrence", "runs_per_over"],  # Target names
                "model_types": {"wicket_occurrence": "best", "runs_per_over": "xgboost"}
            }
            """
            try:
                data = request.get_json()
                
                if not data or 'features' not in data:
                    return jsonify({'error': 'Missing features in request'}), 400
                
                targets = data.get('targets', list(self.models.keys()))
                model_types = data.get('model_types', {})
                
                predictions = {}
                
                for target in targets:
                    model_type = model_types.get(target, 'best')
                    prediction = self.predict_single(target, data['features'], model_type)
                    
                    if prediction is not None:
                        predictions[target] = {
                            'model_type': model_type,
                            'prediction': prediction
                        }
                
                return jsonify({
                    'predictions': predictions,
                    'timestamp': datetime.now().isoformat()
                })
                
            except Exception as e:
                logger.error(f"Batch prediction error: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/model_info', methods=['GET'])
        def model_info():
            """Get information about loaded models."""
            model_info = {}
            
            for target_name, models in self.models.items():
                model_info[target_name] = {
                    'available_models': list(models.keys()),
                    'target_config': self.config.TARGET_FEATURES.get(target_name, {}),
                    'model_count': len(models)
                }
            
            return jsonify({
                'models': model_info,
                'timestamp': datetime.now().isoformat()
            })
        
        @self.app.route('/feature_importance/<target_name>', methods=['GET'])
        def feature_importance(target_name):
            """Get feature importance for a specific model."""
            try:
                model_type = request.args.get('model_type', 'best')
                model = self._get_model(target_name, model_type)
                
                if model is None:
                    return jsonify({'error': f'No model found for {target_name}'}), 404
                
                # Try to get feature importance
                importance = self._get_feature_importance(model)
                
                if not importance:
                    return jsonify({'error': 'Feature importance not available'}), 404
                
                return jsonify({
                    'target': target_name,
                    'model_type': model_type,
                    'feature_importance': importance,
                    'timestamp': datetime.now().isoformat()
                })
                
            except Exception as e:
                logger.error(f"Feature importance error: {e}")
                return jsonify({'error': str(e)}), 500
    
    def _get_model(self, target_name: str, model_type: str):
        """Get a specific model for prediction.
        
        Args:
            target_name: Name of the prediction target
            model_type: Type of model ('best' or specific model name)
            
        Returns:
            Model object or None
        """
        if target_name not in self.models:
            return None
        
        available_models = self.models[target_name]
        
        if model_type == 'best':
            # Return the first available model (could be enhanced with performance metrics)
            return next(iter(available_models.values())) if available_models else None
        else:
            return available_models.get(model_type)
    
    def _get_feature_importance(self, model) -> Dict[str, float]:
        """Extract feature importance from model.
        
        Args:
            model: Trained model object
            
        Returns:
            Dict: Feature importance scores
        """
        try:
            if hasattr(model, 'feature_importances_'):
                importance = model.feature_importances_
                # Get feature names (this would need to be stored during training)
                feature_names = [f"feature_{i}" for i in range(len(importance))]
                return dict(zip(feature_names, importance))
            elif hasattr(model, 'coef_'):
                importance = np.abs(model.coef_).flatten()
                feature_names = [f"feature_{i}" for i in range(len(importance))]
                return dict(zip(feature_names, importance))
            else:
                return {}
        except Exception as e:
            logger.warning(f"Could not extract feature importance: {e}")
            return {}
    
    def predict_single(self, target_name: str, features: Dict[str, Any], model_type: str = 'best') -> Optional[Any]:
        """Make a single prediction.
        
        Args:
            target_name: Name of the prediction target
            features: Feature values dictionary
            model_type: Type of model to use
            
        Returns:
            Prediction result or None
        """
        try:
            # Get model
            model = self._get_model(target_name, model_type)
            if model is None:
                logger.error(f"No model available for {target_name}")
                return None
            
            # Prepare features
            feature_vector = self._prepare_features(features, target_name)
            if feature_vector is None:
                return None
            
            # Make prediction
            prediction = model.predict([feature_vector])[0]
            
            # For classification, also get probabilities if available
            if hasattr(model, 'predict_proba'):
                probabilities = model.predict_proba([feature_vector])[0]
                return {
                    'prediction': prediction,
                    'probabilities': probabilities.tolist(),
                    'confidence': float(max(probabilities))
                }
            else:
                return {
                    'prediction': prediction,
                    'confidence': None
                }
                
        except Exception as e:
            logger.error(f"Prediction error for {target_name}: {e}")
            return None
    
    def _prepare_features(self, features: Dict[str, Any], target_name: str) -> Optional[np.ndarray]:
        """Prepare features for model prediction.
        
        Args:
            features: Raw feature dictionary
            target_name: Name of the prediction target
            
        Returns:
            Prepared feature vector or None
        """
        try:
            # Create a complete feature set with default values
            complete_features = {
                # Basic over features
                "innings": features.get("innings", 1),
                "overNumber": features.get("overNumber", 5),
                "overBalls": features.get("overBalls", 6),
                "overBoundaries": features.get("overBoundaries", 0),
                "overExtras": features.get("overExtras", 0),
                "overRuns": features.get("overRuns", 0),
                "overSixes": features.get("overSixes", 0),
                "overWickets": features.get("overWickets", 0),
                "requiredRunRate": features.get("requiredRunRate", 0),
                "runRate": features.get("runRate", 0),
                "teamBatting": features.get("teamBatting", 5),
                "teamBowling": features.get("teamBowling", 5),
                "totalOvers": features.get("totalOvers", 0.1),
                "totalRuns": features.get("totalRuns", 0),
                "totalWickets": features.get("totalWickets", 0),
                
                # Batsman stats
                "batsmanStats.striker.runs": features.get("batsmanStats.striker.runs", 0),
                "batsmanStats.striker.balls": features.get("batsmanStats.striker.balls", 0),
                "batsmanStats.striker.strikeRate": features.get("batsmanStats.striker.strikeRate", 0),
                "batsmanStats.nonStriker.runs": features.get("batsmanStats.nonStriker.runs", 0),
                "batsmanStats.nonStriker.balls": features.get("batsmanStats.nonStriker.balls", 0),
                
                # Bowler stats
                "bowlerStats.runs": features.get("bowlerStats.runs", 0),
                "bowlerStats.wickets": features.get("bowlerStats.wickets", 0),
                "bowlerStats.balls": features.get("bowlerStats.balls", 0),
                "bowlerStats.dotBalls": features.get("bowlerStats.dotBalls", 0),
                "bowlerStats.economyRate": features.get("bowlerStats.economyRate", 0),
                
                # Momentum features
                "momentum.recentRunRate": features.get("momentum.recentRunRate", 0),
                "momentum.wicketsInHand": features.get("momentum.wicketsInHand", 10),
                "momentum.pressureIndex": features.get("momentum.pressureIndex", 0),
                "momentum.partnershipRuns": features.get("momentum.partnershipRuns", 0),
                "momentum.partnershipBalls": features.get("momentum.partnershipBalls", 0),
                
                # Match context
                "matchContext.target": features.get("matchContext.target", 0),
                "matchContext.chase": features.get("matchContext.chase", False),
                "matchContext.powerplay": features.get("matchContext.powerplay", False),
                "matchContext.deathOvers": features.get("matchContext.deathOvers", False),
                
                # Data quality
                "dataQuality.complete": features.get("dataQuality.complete", True),
                "dataQuality.missingBalls": features.get("dataQuality.missingBalls", 0),
                
                # Engineered features
                "is_powerplay": features.get("is_powerplay", 0),
                "is_death_overs": features.get("is_death_overs", 0),
                "is_middle_overs": features.get("is_middle_overs", 1),
                "run_rate_diff": features.get("run_rate_diff", 0),
                "run_rate_ratio": features.get("run_rate_ratio", 0),
                "partnership_rate": features.get("partnership_rate", 0),
                "wickets_remaining_ratio": features.get("wickets_remaining_ratio", 1.0),
            }
            
            # Convert features to DataFrame
            df = pd.DataFrame([complete_features])
            
            # Apply same preprocessing as training
            processed_df = self.data_loader.preprocess_features(df)
            
            # Remove non-feature columns (same as in prepare_train_test_data)
            datetime_columns = processed_df.select_dtypes(include=['datetime64']).columns.tolist()
            excluded_columns = ['target', '_id', 'matchId', 'fixtureId', 'timestamp', 'createdAt', 'updatedAt', 'engineeredAt', 'overStartTime', 'overEndTime'] + datetime_columns
            
            feature_columns = [col for col in processed_df.columns if col not in excluded_columns]
            
            # Handle any remaining missing values
            feature_df = processed_df[feature_columns].fillna(0)
            
            # Convert categorical columns to numeric (same as in prepare_train_test_data)
            categorical_columns = feature_df.select_dtypes(include=['object', 'bool']).columns
            for col in categorical_columns:
                if col in feature_df.columns:
                    # Replace 'Unknown' with a numeric value
                    feature_df[col] = feature_df[col].replace('Unknown', 0)
                    # Convert to numeric, coercing errors to 0
                    feature_df[col] = pd.to_numeric(feature_df[col], errors='coerce').fillna(0)
            
            feature_vector = feature_df.values[0]
            
            return feature_vector
            
        except Exception as e:
            logger.error(f"Feature preparation error: {e}")
            return None
    
    def run_server(self, host: str = '0.0.0.0', port: int = 5001, debug: bool = False):
        """Run the Flask prediction server.
        
        Args:
            host: Server host
            port: Server port
            debug: Enable debug mode
        """
        logger.info(f"Starting prediction server on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug)


class ModelPackager:
    """Utility class for packaging models for deployment."""
    
    def __init__(self, config: Config = None):
        """Initialize the model packager.
        
        Args:
            config: Configuration object (optional)
        """
        self.config = config or Config()
    
    def package_model(self, target_name: str, model_name: str) -> Dict[str, Any]:
        """Package a model for deployment.
        
        Args:
            target_name: Name of the prediction target
            model_name: Name of the model
            
        Returns:
            Dict: Package information
        """
        try:
            # Load model
            model_path = os.path.join(self.config.MODELS_DIR, f"{model_name}_{target_name}.joblib")
            
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"Model file not found: {model_path}")
            
            model = joblib.load(model_path)
            
            # Get model metadata
            metadata = {
                'target_name': target_name,
                'model_name': model_name,
                'model_type': type(model).__name__,
                'target_config': self.config.TARGET_FEATURES.get(target_name, {}),
                'created_at': datetime.now().isoformat(),
                'version': '1.0'
            }
            
            # Get feature information
            feature_info = self._get_model_feature_info(model)
            metadata['feature_info'] = feature_info
            
            # Create package
            package = {
                'model': model,
                'metadata': metadata,
                'config': {
                    'target_features': self.config.TARGET_FEATURES,
                    'numerical_features': self.config.NUMERICAL_FEATURES,
                    'categorical_features': self.config.CATEGORICAL_FEATURES
                }
            }
            
            # Save package
            package_path = os.path.join(self.config.MODELS_DIR, f"package_{model_name}_{target_name}.joblib")
            joblib.dump(package, package_path)
            
            logger.info(f"Model packaged successfully: {package_path}")
            
            return {
                'success': True,
                'package_path': package_path,
                'metadata': metadata
            }
            
        except Exception as e:
            logger.error(f"Failed to package model: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _get_model_feature_info(self, model) -> Dict[str, Any]:
        """Get feature information from model.
        
        Args:
            model: Trained model
            
        Returns:
            Dict: Feature information
        """
        feature_info = {}
        
        try:
            if hasattr(model, 'feature_importances_'):
                feature_info['has_feature_importance'] = True
                feature_info['feature_count'] = len(model.feature_importances_)
            elif hasattr(model, 'coef_'):
                feature_info['has_coefficients'] = True
                feature_info['feature_count'] = len(model.coef_.flatten())
            else:
                feature_info['has_feature_importance'] = False
                feature_info['has_coefficients'] = False
                
        except Exception as e:
            logger.warning(f"Could not extract feature info: {e}")
        
        return feature_info
    
    def create_deployment_package(self, target_name: str, model_name: str = 'best') -> Dict[str, Any]:
        """Create a complete deployment package.
        
        Args:
            target_name: Name of the prediction target
            model_name: Name of the model to package
            
        Returns:
            Dict: Deployment package information
        """
        try:
            # Package the model
            package_result = self.package_model(target_name, model_name)
            
            if not package_result['success']:
                return package_result
            
            # Create deployment script
            deployment_script = self._create_deployment_script(target_name, model_name)
            
            # Create requirements file
            requirements = self._create_requirements_file()
            
            # Create README
            readme = self._create_readme(target_name, model_name, package_result['metadata'])
            
            # Save deployment files
            deployment_dir = os.path.join(self.config.MODELS_DIR, f"deployment_{target_name}")
            os.makedirs(deployment_dir, exist_ok=True)
            
            # Save files
            with open(os.path.join(deployment_dir, 'deploy.py'), 'w') as f:
                f.write(deployment_script)
            
            with open(os.path.join(deployment_dir, 'requirements.txt'), 'w') as f:
                f.write(requirements)
            
            with open(os.path.join(deployment_dir, 'README.md'), 'w') as f:
                f.write(readme)
            
            logger.info(f"Deployment package created: {deployment_dir}")
            
            return {
                'success': True,
                'deployment_dir': deployment_dir,
                'package_path': package_result['package_path'],
                'metadata': package_result['metadata']
            }
            
        except Exception as e:
            logger.error(f"Failed to create deployment package: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _create_deployment_script(self, target_name: str, model_name: str) -> str:
        """Create deployment script for the model.
        
        Args:
            target_name: Name of the prediction target
            model_name: Name of the model
            
        Returns:
            str: Deployment script content
        """
        return f'''"""
Deployment script for {target_name} prediction model.
"""
import joblib
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify

# Load the packaged model
package = joblib.load('package_{model_name}_{target_name}.joblib')
model = package['model']
metadata = package['metadata']
config = package['config']

app = Flask(__name__)

@app.route('/predict', methods=['POST'])
def predict():
    """Make predictions."""
    try:
        data = request.get_json()
        features = data.get('features', {{}})
        
        # Prepare features (simplified)
        feature_vector = prepare_features(features)
        
        # Make prediction
        prediction = model.predict([feature_vector])[0]
        
        return jsonify({{
            'prediction': prediction,
            'target': '{target_name}',
            'model': '{model_name}'
        }})
        
    except Exception as e:
        return jsonify({{'error': str(e)}}), 500

def prepare_features(features):
    """Prepare features for prediction."""
    # This would need to implement the same preprocessing as training
    # For now, return a placeholder
    return np.zeros(10)  # Adjust based on actual feature count

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
'''
    
    def _create_requirements_file(self) -> str:
        """Create requirements file for deployment.
        
        Returns:
            str: Requirements file content
        """
        return '''flask==2.3.3
pandas==2.1.4
numpy==1.24.3
scikit-learn==1.3.2
joblib==1.3.2
'''
    
    def _create_readme(self, target_name: str, model_name: str, metadata: Dict[str, Any]) -> str:
        """Create README file for deployment.
        
        Args:
            target_name: Name of the prediction target
            model_name: Name of the model
            metadata: Model metadata
            
        Returns:
            str: README content
        """
        return f'''# {target_name} Prediction Model Deployment

## Model Information

- **Target**: {target_name}
- **Model Type**: {metadata.get('model_type', 'Unknown')}
- **Created**: {metadata.get('created_at', 'Unknown')}
- **Version**: {metadata.get('version', '1.0')}

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the prediction service:
```bash
python deploy.py
```

## API Usage

### Make Prediction

```bash
curl -X POST http://localhost:5000/predict \\
  -H "Content-Type: application/json" \\
  -d '{{"features": {{...}}}}'
```

## Model Configuration

{json.dumps(metadata.get('target_config', {{}}), indent=2)}

## Feature Information

{json.dumps(metadata.get('feature_info', {{}}), indent=2)}
'''
