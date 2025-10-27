"""
Machine learning model training and evaluation utilities for cricket predictions.
"""
import logging
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
import joblib
import json
from datetime import datetime
import os

from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.model_selection import GridSearchCV, cross_val_score
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, roc_auc_score,
    mean_squared_error, mean_absolute_error, r2_score
)
import xgboost as xgb

from config import Config

# Configure logging
logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL), format=Config.LOG_FORMAT)
logger = logging.getLogger(__name__)


class CricketModelTrainer:
    """Trainer for cricket prediction models."""
    
    def __init__(self, config: Config = None):
        """Initialize the model trainer.
        
        Args:
            config: Configuration object (optional)
        """
        self.config = config or Config()
        self.models = {}
        self.results = {}
        
        # Create directories
        os.makedirs(self.config.MODELS_DIR, exist_ok=True)
        os.makedirs(self.config.REPORTS_DIR, exist_ok=True)
        
    def train_models(self, 
                    X_train: pd.DataFrame, 
                    y_train: pd.Series,
                    X_val: pd.DataFrame,
                    y_val: pd.Series,
                    target_name: str,
                    task_type: str) -> Dict[str, Any]:
        """Train multiple models for a given prediction task.
        
        Args:
            X_train: Training features
            y_train: Training targets
            X_val: Validation features
            y_val: Validation targets
            target_name: Name of the prediction task
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Training results for all models
        """
        logger.info(f"Starting model training for {target_name} ({task_type})")
        
        if task_type == 'classification':
            model_configs = self._get_classification_models()
        else:
            model_configs = self._get_regression_models()
        
        results = {}
        
        for model_name, model_class in model_configs.items():
            try:
                logger.info(f"Training {model_name}...")
                
                # Train model
                model_results = self._train_single_model(
                    model_name, model_class, X_train, y_train, X_val, y_val, task_type
                )
                
                results[model_name] = model_results
                
                # Save model
                self._save_model(model_results['model'], model_name, target_name)
                
                logger.info(f"Completed training {model_name}")
                
            except Exception as e:
                logger.error(f"Error training {model_name}: {e}")
                results[model_name] = {'error': str(e)}
        
        self.results[target_name] = results
        return results
    
    def _get_classification_models(self) -> Dict[str, Any]:
        """Get classification model configurations.
        
        Returns:
            Dict: Model name to model class mapping
        """
        return {
            'logistic_regression': LogisticRegression(random_state=self.config.RANDOM_STATE),
            'random_forest': RandomForestClassifier(random_state=self.config.RANDOM_STATE),
            'gradient_boosting': GradientBoostingClassifier(random_state=self.config.RANDOM_STATE),
            'xgboost': xgb.XGBClassifier(random_state=self.config.RANDOM_STATE)
        }
    
    def _get_regression_models(self) -> Dict[str, Any]:
        """Get regression model configurations.
        
        Returns:
            Dict: Model name to model class mapping
        """
        return {
            'random_forest': RandomForestRegressor(random_state=self.config.RANDOM_STATE),
            'gradient_boosting': GradientBoostingRegressor(random_state=self.config.RANDOM_STATE),
            'xgboost': xgb.XGBRegressor(random_state=self.config.RANDOM_STATE)
        }
    
    def _train_single_model(self, 
                           model_name: str,
                           model_class: Any,
                           X_train: pd.DataFrame,
                           y_train: pd.Series,
                           X_val: pd.DataFrame,
                           y_val: pd.Series,
                           task_type: str) -> Dict[str, Any]:
        """Train a single model with hyperparameter tuning.
        
        Args:
            model_name: Name of the model
            model_class: Model class to train
            X_train: Training features
            y_train: Training targets
            X_val: Validation features
            y_val: Validation targets
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Training results
        """
        # Get hyperparameter grid
        param_grid = self.config.MODEL_CONFIGS.get(model_name, {})
        
        if param_grid:
            # Perform grid search
            logger.info(f"Performing hyperparameter tuning for {model_name}")
            grid_search = GridSearchCV(
                model_class,
                param_grid,
                cv=self.config.CV_FOLDS,
                scoring=self._get_scoring_metric(task_type),
                n_jobs=-1,
                verbose=1
            )
            grid_search.fit(X_train, y_train)
            
            best_model = grid_search.best_estimator_
            best_params = grid_search.best_params_
            cv_score = grid_search.best_score_
            
        else:
            # Train with default parameters
            best_model = model_class
            best_model.fit(X_train, y_train)
            best_params = {}
            cv_score = None
        
        # Evaluate on validation set
        val_predictions = best_model.predict(X_val)
        val_metrics = self._calculate_metrics(y_val, val_predictions, task_type)
        
        # Cross-validation scores
        cv_scores = self._cross_validate_model(best_model, X_train, y_train, task_type)
        
        return {
            'model': best_model,
            'best_params': best_params,
            'cv_score': cv_score,
            'cv_scores': cv_scores,
            'val_metrics': val_metrics,
            'val_predictions': val_predictions,
            'feature_importance': self._get_feature_importance(best_model, X_train.columns),
            'training_time': datetime.now().isoformat()
        }
    
    def _get_scoring_metric(self, task_type: str) -> str:
        """Get appropriate scoring metric for the task.
        
        Args:
            task_type: 'classification' or 'regression'
            
        Returns:
            str: Scoring metric name
        """
        if task_type == 'classification':
            return 'f1'
        else:
            return 'neg_mean_squared_error'
    
    def _calculate_metrics(self, y_true: pd.Series, y_pred: np.ndarray, task_type: str) -> Dict[str, float]:
        """Calculate evaluation metrics.
        
        Args:
            y_true: True target values
            y_pred: Predicted target values
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Calculated metrics
        """
        metrics = {}
        
        if task_type == 'classification':
            metrics['accuracy'] = accuracy_score(y_true, y_pred)
            metrics['precision'] = precision_score(y_true, y_pred, average='weighted')
            metrics['recall'] = recall_score(y_true, y_pred, average='weighted')
            metrics['f1'] = f1_score(y_true, y_pred, average='weighted')
            
            # ROC AUC (for binary classification)
            if len(np.unique(y_true)) == 2:
                try:
                    y_prob = self.models.get('model', None)
                    if y_prob is not None:
                        metrics['roc_auc'] = roc_auc_score(y_true, y_prob)
                except:
                    pass
        
        else:  # regression
            metrics['mse'] = mean_squared_error(y_true, y_pred)
            metrics['rmse'] = np.sqrt(metrics['mse'])
            metrics['mae'] = mean_absolute_error(y_true, y_pred)
            metrics['r2'] = r2_score(y_true, y_pred)
        
        return metrics
    
    def _cross_validate_model(self, model: Any, X: pd.DataFrame, y: pd.Series, task_type: str) -> Dict[str, List[float]]:
        """Perform cross-validation.
        
        Args:
            model: Trained model
            X: Features
            y: Targets
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Cross-validation scores
        """
        cv_scores = {}
        
        if task_type == 'classification':
            scoring_metrics = ['accuracy', 'precision', 'recall', 'f1']
        else:
            scoring_metrics = ['neg_mean_squared_error', 'neg_mean_absolute_error', 'r2']
        
        for metric in scoring_metrics:
            scores = cross_val_score(model, X, y, cv=self.config.CV_FOLDS, scoring=metric)
            cv_scores[metric] = scores.tolist()
        
        return cv_scores
    
    def _get_feature_importance(self, model: Any, feature_names: pd.Index) -> Dict[str, float]:
        """Extract feature importance from model.
        
        Args:
            model: Trained model
            feature_names: Feature column names
            
        Returns:
            Dict: Feature importance scores
        """
        try:
            if hasattr(model, 'feature_importances_'):
                importance = model.feature_importances_
            elif hasattr(model, 'coef_'):
                importance = np.abs(model.coef_).flatten()
            else:
                return {}
            
            # Create feature importance dictionary
            feature_importance = dict(zip(feature_names, importance))
            
            # Sort by importance
            feature_importance = dict(sorted(feature_importance.items(), key=lambda x: x[1], reverse=True))
            
            return feature_importance
            
        except Exception as e:
            logger.warning(f"Could not extract feature importance: {e}")
            return {}
    
    def _save_model(self, model: Any, model_name: str, target_name: str):
        """Save trained model to disk.
        
        Args:
            model: Trained model
            model_name: Name of the model
            target_name: Name of the prediction task
        """
        try:
            filename = f"{model_name}_{target_name}.joblib"
            filepath = os.path.join(self.config.MODELS_DIR, filename)
            joblib.dump(model, filepath)
            logger.info(f"Saved model: {filepath}")
            
        except Exception as e:
            logger.error(f"Failed to save model {model_name}: {e}")
    
    def evaluate_on_test(self, 
                        X_test: pd.DataFrame, 
                        y_test: pd.Series, 
                        target_name: str,
                        task_type: str) -> Dict[str, Any]:
        """Evaluate all trained models on test set.
        
        Args:
            X_test: Test features
            y_test: Test targets
            target_name: Name of the prediction task
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Test evaluation results
        """
        logger.info(f"Evaluating models on test set for {target_name}")
        
        test_results = {}
        
        for model_name in self.results.get(target_name, {}):
            try:
                # Load model
                model_path = os.path.join(self.config.MODELS_DIR, f"{model_name}_{target_name}.joblib")
                if os.path.exists(model_path):
                    model = joblib.load(model_path)
                    
                    # Make predictions
                    test_predictions = model.predict(X_test)
                    
                    # Calculate metrics
                    test_metrics = self._calculate_metrics(y_test, test_predictions, task_type)
                    
                    test_results[model_name] = {
                        'test_metrics': test_metrics,
                        'test_predictions': test_predictions.tolist()
                    }
                    
                    logger.info(f"Test evaluation completed for {model_name}")
                    
            except Exception as e:
                logger.error(f"Error evaluating {model_name} on test set: {e}")
                test_results[model_name] = {'error': str(e)}
        
        return test_results
    
    def generate_model_report(self, target_name: str, task_type: str) -> Dict[str, Any]:
        """Generate comprehensive model performance report.
        
        Args:
            target_name: Name of the prediction task
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Comprehensive model report
        """
        if target_name not in self.results:
            return {'error': f'No results found for {target_name}'}
        
        report = {
            'target_name': target_name,
            'task_type': task_type,
            'timestamp': datetime.now().isoformat(),
            'models': {},
            'best_model': None,
            'summary': {}
        }
        
        best_score = -np.inf
        best_model_name = None
        
        for model_name, results in self.results[target_name].items():
            if 'error' in results:
                report['models'][model_name] = {'error': results['error']}
                continue
            
            model_report = {
                'best_params': results.get('best_params', {}),
                'cv_score': results.get('cv_score'),
                'cv_scores': results.get('cv_scores', {}),
                'val_metrics': results.get('val_metrics', {}),
                'feature_importance': dict(list(results.get('feature_importance', {}).items())[:10]),  # Top 10 features
                'training_time': results.get('training_time')
            }
            
            report['models'][model_name] = model_report
            
            # Determine best model based on validation F1 (classification) or R² (regression)
            val_metrics = results.get('val_metrics', {})
            if task_type == 'classification':
                score = val_metrics.get('f1', 0)
            else:
                score = val_metrics.get('r2', 0)
            
            if score > best_score:
                best_score = score
                best_model_name = model_name
        
        report['best_model'] = best_model_name
        report['summary'] = self._generate_summary_stats(report, task_type)
        
        # Save report
        self._save_report(report, target_name)
        
        return report
    
    def _generate_summary_stats(self, report: Dict[str, Any], task_type: str) -> Dict[str, Any]:
        """Generate summary statistics for the report.
        
        Args:
            report: Model report dictionary
            task_type: 'classification' or 'regression'
            
        Returns:
            Dict: Summary statistics
        """
        summary = {
            'total_models': len(report['models']),
            'best_model': report['best_model'],
            'model_comparison': {}
        }
        
        # Compare models
        for model_name, model_data in report['models'].items():
            if 'error' in model_data:
                continue
                
            val_metrics = model_data.get('val_metrics', {})
            summary['model_comparison'][model_name] = {
                'validation_score': val_metrics.get('f1' if task_type == 'classification' else 'r2', 0),
                'cv_mean': np.mean(list(model_data.get('cv_scores', {}).values())) if model_data.get('cv_scores') else 0
            }
        
        return summary
    
    def _save_report(self, report: Dict[str, Any], target_name: str):
        """Save model report to file.
        
        Args:
            report: Model report dictionary
            target_name: Name of the prediction task
        """
        try:
            filename = f"model_report_{target_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(self.config.REPORTS_DIR, filename)
            
            with open(filepath, 'w') as f:
                json.dump(report, f, indent=2, default=str)
            
            logger.info(f"Saved model report: {filepath}")
            
        except Exception as e:
            logger.error(f"Failed to save report: {e}")
    
    def load_model(self, model_name: str, target_name: str) -> Any:
        """Load a trained model from disk.
        
        Args:
            model_name: Name of the model
            target_name: Name of the prediction task
            
        Returns:
            Loaded model object
        """
        try:
            filename = f"{model_name}_{target_name}.joblib"
            filepath = os.path.join(self.config.MODELS_DIR, filename)
            
            if os.path.exists(filepath):
                model = joblib.load(filepath)
                logger.info(f"Loaded model: {filepath}")
                return model
            else:
                logger.error(f"Model file not found: {filepath}")
                return None
                
        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            return None
