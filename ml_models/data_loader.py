"""
Data loading and preprocessing utilities for cricket predictive modeling.
"""
import logging
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional
from pymongo import MongoClient
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.impute import SimpleImputer
import warnings

from config import Config

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL), format=Config.LOG_FORMAT)
logger = logging.getLogger(__name__)


class CricketDataLoader:
    """Data loader for cricket feature data from MongoDB."""
    
    def __init__(self, config: Config = None):
        """Initialize the data loader.
        
        Args:
            config: Configuration object (optional)
        """
        self.config = config or Config()
        self.client = None
        self.db = None
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.imputer = SimpleImputer(strategy='median')
        
    def connect(self) -> bool:
        """Connect to MongoDB.
        
        Returns:
            bool: True if connection successful, False otherwise
        """
        try:
            self.client = MongoClient(self.config.MONGODB_URI)
            self.db = self.client[self.config.DATABASE_NAME]
            
            # Test connection
            self.client.admin.command('ping')
            logger.info(f"Connected to MongoDB: {self.config.DATABASE_NAME}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from MongoDB."""
        if self.client:
            self.client.close()
            logger.info("Disconnected from MongoDB")
    
    def load_over_features(self, 
                          limit: Optional[int] = None,
                          match_ids: Optional[List[str]] = None,
                          min_overs_per_match: int = None) -> pd.DataFrame:
        """Load over features from MongoDB.
        
        Args:
            limit: Maximum number of documents to load
            match_ids: Specific match IDs to load (optional)
            min_overs_per_match: Minimum overs per match for filtering
            
        Returns:
            pd.DataFrame: Loaded over features data
        """
        try:
            collection = self.db[self.config.OVER_FEATURES_COLLECTION]
            
            # Build query
            query = {}
            if match_ids:
                query['matchId'] = {'$in': match_ids}
            
            # Execute query
            cursor = collection.find(query)
            if limit:
                cursor = cursor.limit(limit)
            
            # Convert to DataFrame
            data = list(cursor)
            if not data:
                logger.warning("No over features data found")
                return pd.DataFrame()
            
            df = pd.DataFrame(data)
            logger.info(f"Loaded {len(df)} over features records")
            
            # Filter by minimum overs per match
            if min_overs_per_match:
                match_counts = df.groupby('matchId').size()
                valid_matches = match_counts[match_counts >= min_overs_per_match].index
                df = df[df['matchId'].isin(valid_matches)]
                logger.info(f"Filtered to {len(df)} records from {len(valid_matches)} matches")
            
            return df
            
        except Exception as e:
            logger.error(f"Failed to load over features: {e}")
            return pd.DataFrame()
    
    def load_matches(self, match_ids: Optional[List[str]] = None) -> pd.DataFrame:
        """Load match data from MongoDB.
        
        Args:
            match_ids: Specific match IDs to load (optional)
            
        Returns:
            pd.DataFrame: Loaded match data
        """
        try:
            collection = self.db[self.config.MATCHES_COLLECTION]
            
            # Build query
            query = {}
            if match_ids:
                query['fixtureId'] = {'$in': match_ids}
            
            # Execute query
            cursor = collection.find(query)
            data = list(cursor)
            
            if not data:
                logger.warning("No match data found")
                return pd.DataFrame()
            
            df = pd.DataFrame(data)
            logger.info(f"Loaded {len(df)} match records")
            
            return df
            
        except Exception as e:
            logger.error(f"Failed to load matches: {e}")
            return pd.DataFrame()
    
    def preprocess_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Preprocess features for machine learning.
        
        Args:
            df: Raw feature DataFrame
            
        Returns:
            pd.DataFrame: Preprocessed DataFrame
        """
        logger.info("Starting feature preprocessing")
        
        # Create a copy to avoid modifying original data
        processed_df = df.copy()
        
        # Handle nested features
        processed_df = self._flatten_nested_features(processed_df)
        
        # Handle missing values
        processed_df = self._handle_missing_values(processed_df)
        
        # Handle outliers
        processed_df = self._handle_outliers(processed_df)
        
        # Encode categorical variables
        processed_df = self._encode_categorical_features(processed_df)
        
        # Feature engineering
        processed_df = self._engineer_features(processed_df)
        
        logger.info(f"Preprocessing completed. Shape: {processed_df.shape}")
        return processed_df
    
    def _flatten_nested_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Flatten nested dictionary features.
        
        Args:
            df: DataFrame with nested features
            
        Returns:
            pd.DataFrame: DataFrame with flattened features
        """
        flattened_df = df.copy()
        
        # Flatten nested dictionaries
        nested_columns = ['batsmanStats', 'bowlerStats', 'momentum', 'matchContext', 'dataQuality']
        
        for col in nested_columns:
            if col in flattened_df.columns:
                # Convert nested dict to separate columns
                nested_data = pd.json_normalize(flattened_df[col])
                nested_data.columns = [f"{col}.{subcol}" for subcol in nested_data.columns]
                
                # Add flattened columns
                flattened_df = pd.concat([flattened_df, nested_data], axis=1)
                
                # Drop original nested column
                flattened_df.drop(col, axis=1, inplace=True)
        
        return flattened_df
    
    def _handle_missing_values(self, df: pd.DataFrame) -> pd.DataFrame:
        """Handle missing values in the dataset.
        
        Args:
            df: DataFrame with potential missing values
            
        Returns:
            pd.DataFrame: DataFrame with handled missing values
        """
        # Calculate missing ratio for each column
        missing_ratio = df.isnull().sum() / len(df)
        
        # Remove columns with too many missing values
        columns_to_drop = missing_ratio[missing_ratio > self.config.MAX_MISSING_RATIO].index
        if len(columns_to_drop) > 0:
            logger.warning(f"Dropping columns with high missing ratio: {list(columns_to_drop)}")
            df = df.drop(columns=columns_to_drop)
        
        # Impute remaining missing values
        numerical_columns = df.select_dtypes(include=[np.number]).columns
        categorical_columns = df.select_dtypes(include=['object']).columns
        
        # Impute numerical columns
        if len(numerical_columns) > 0:
            df[numerical_columns] = self.imputer.fit_transform(df[numerical_columns])
        
        # Impute categorical columns
        for col in categorical_columns:
            if df[col].isnull().any():
                df[col] = df[col].fillna('Unknown')
        
        return df
    
    def _handle_outliers(self, df: pd.DataFrame) -> pd.DataFrame:
        """Handle outliers in numerical features.
        
        Args:
            df: DataFrame with potential outliers
            
        Returns:
            pd.DataFrame: DataFrame with handled outliers
        """
        numerical_columns = df.select_dtypes(include=[np.number]).columns
        
        for col in numerical_columns:
            if col in self.config.NUMERICAL_FEATURES:
                # Calculate Z-scores
                z_scores = np.abs((df[col] - df[col].mean()) / df[col].std())
                
                # Cap outliers instead of removing them
                outlier_mask = z_scores > self.config.OUTLIER_THRESHOLD
                if outlier_mask.any():
                    upper_bound = df[col].quantile(0.95)
                    lower_bound = df[col].quantile(0.05)
                    df.loc[outlier_mask, col] = df.loc[outlier_mask, col].clip(lower_bound, upper_bound)
        
        return df
    
    def _encode_categorical_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Encode categorical features.
        
        Args:
            df: DataFrame with categorical features
            
        Returns:
            pd.DataFrame: DataFrame with encoded categorical features
        """
        categorical_columns = df.select_dtypes(include=['object']).columns
        
        for col in categorical_columns:
            if col in self.config.CATEGORICAL_FEATURES:
                # Use label encoding for categorical features
                if col not in self.label_encoders:
                    self.label_encoders[col] = LabelEncoder()
                
                df[col] = self.label_encoders[col].fit_transform(df[col].astype(str))
        
        return df
    
    def _engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Engineer additional features.
        
        Args:
            df: DataFrame to add engineered features to
            
        Returns:
            pd.DataFrame: DataFrame with engineered features
        """
        # Add over number features
        if 'overNumber' in df.columns:
            df['is_powerplay'] = df['overNumber'].apply(lambda x: 1 if x <= 6 else 0)
            df['is_death_overs'] = df['overNumber'].apply(lambda x: 1 if x >= 16 else 0)
            df['is_middle_overs'] = df['overNumber'].apply(lambda x: 1 if 7 <= x <= 15 else 0)
        
        # Add run rate features
        if 'runRate' in df.columns and 'requiredRunRate' in df.columns:
            df['run_rate_diff'] = df['runRate'] - df['requiredRunRate']
            df['run_rate_ratio'] = df['runRate'] / (df['requiredRunRate'] + 0.1)  # Add small value to avoid division by zero
        
        # Add partnership features
        if 'momentum.partnershipRuns' in df.columns and 'momentum.partnershipBalls' in df.columns:
            df['partnership_rate'] = df['momentum.partnershipRuns'] / (df['momentum.partnershipBalls'] + 1)
        
        # Add pressure indicators
        if 'momentum.wicketsInHand' in df.columns:
            df['wickets_remaining_ratio'] = df['momentum.wicketsInHand'] / 10
        
        return df
    
    def create_targets(self, df: pd.DataFrame, target_name: str) -> pd.DataFrame:
        """Create target variables for different prediction tasks.
        
        Args:
            df: Feature DataFrame
            target_name: Name of the target to create
            
        Returns:
            pd.DataFrame: DataFrame with target variable added
        """
        if target_name not in self.config.TARGET_FEATURES:
            raise ValueError(f"Unknown target: {target_name}")
        
        target_config = self.config.TARGET_FEATURES[target_name]
        target_df = df.copy()
        
        if target_config['type'] == 'classification':
            # Create binary classification target
            threshold = target_config.get('threshold', 1)
            target_df['target'] = (target_df[target_config['target_column']] >= threshold).astype(int)
        else:
            # Use continuous target for regression
            target_df['target'] = target_df[target_config['target_column']]
        
        return target_df
    
    def prepare_train_test_data(self, 
                               df: pd.DataFrame, 
                               target_name: str,
                               test_size: float = None,
                               validation_size: float = None) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, pd.Series]:
        """Prepare train, validation, and test datasets.
        
        Args:
            df: Preprocessed feature DataFrame
            target_name: Name of the target variable
            test_size: Proportion of data for testing
            validation_size: Proportion of data for validation
            
        Returns:
            Tuple of (X_train, X_val, X_test, y_train, y_val, y_test)
        """
        test_size = test_size or self.config.TEST_SIZE
        validation_size = validation_size or self.config.VALIDATION_SIZE
        
        # Create target variable
        df_with_target = self.create_targets(df, target_name)
        
        # Separate features and target
        # Exclude datetime columns and other non-feature columns
        datetime_columns = df_with_target.select_dtypes(include=['datetime64']).columns.tolist()
        excluded_columns = ['target', '_id', 'matchId', 'fixtureId', 'timestamp', 'createdAt', 'updatedAt', 'engineeredAt', 'overStartTime', 'overEndTime'] + datetime_columns
        
        feature_columns = [col for col in df_with_target.columns if col not in excluded_columns]
        
        X = df_with_target[feature_columns]
        y = df_with_target['target']
        
        # Handle any remaining missing values
        X = X.fillna(0)
        
        # Convert categorical columns to numeric (label encoding)
        categorical_columns = X.select_dtypes(include=['object', 'bool']).columns
        for col in categorical_columns:
            if col in X.columns:
                # Replace 'Unknown' with a numeric value
                X[col] = X[col].replace('Unknown', 0)
                # Convert to numeric, coercing errors to 0
                X[col] = pd.to_numeric(X[col], errors='coerce').fillna(0)
        
        # Split data
        X_temp, X_test, y_temp, y_test = train_test_split(
            X, y, test_size=test_size, random_state=self.config.RANDOM_STATE, stratify=y if y.dtype == 'int' else None
        )
        
        # Split remaining data into train and validation
        val_size_adjusted = validation_size / (1 - test_size)
        X_train, X_val, y_train, y_val = train_test_split(
            X_temp, y_temp, test_size=val_size_adjusted, random_state=self.config.RANDOM_STATE, stratify=y_temp if y_temp.dtype == 'int' else None
        )
        
        # Scale features
        X_train_scaled = pd.DataFrame(
            self.scaler.fit_transform(X_train),
            columns=X_train.columns,
            index=X_train.index
        )
        X_val_scaled = pd.DataFrame(
            self.scaler.transform(X_val),
            columns=X_val.columns,
            index=X_val.index
        )
        X_test_scaled = pd.DataFrame(
            self.scaler.transform(X_test),
            columns=X_test.columns,
            index=X_test.index
        )
        
        logger.info(f"Data split completed:")
        logger.info(f"  Train: {X_train_scaled.shape[0]} samples")
        logger.info(f"  Validation: {X_val_scaled.shape[0]} samples")
        logger.info(f"  Test: {X_test_scaled.shape[0]} samples")
        logger.info(f"  Features: {X_train_scaled.shape[1]}")
        
        return X_train_scaled, X_val_scaled, X_test_scaled, y_train, y_val, y_test
    
    def get_feature_importance_data(self, df: pd.DataFrame) -> Dict:
        """Get feature importance and data quality information.
        
        Args:
            df: Feature DataFrame
            
        Returns:
            Dict: Feature information and statistics
        """
        feature_info = {
            'total_samples': len(df),
            'total_features': len(df.columns),
            'numerical_features': len(df.select_dtypes(include=[np.number]).columns),
            'categorical_features': len(df.select_dtypes(include=['object']).columns),
            'missing_values': df.isnull().sum().to_dict(),
            'data_types': {col: str(dtype) for col, dtype in df.dtypes.to_dict().items()},
            'feature_ranges': {}
        }
        
        # Calculate ranges for numerical features
        numerical_features = df.select_dtypes(include=[np.number]).columns
        for col in numerical_features:
            feature_info['feature_ranges'][col] = {
                'min': float(df[col].min()),
                'max': float(df[col].max()),
                'mean': float(df[col].mean()),
                'std': float(df[col].std())
            }
        
        return feature_info
