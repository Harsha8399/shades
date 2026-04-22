"""
Data loading utilities for the research lab.
"""
import pandas as pd
from pathlib import Path
from typing import Optional, Union
from datetime import datetime


def load_csv(
    filepath: Union[str, Path],
    timestamp_col: str = 'timestamp',
    date_format: Optional[str] = None,
) -> pd.DataFrame:
    """
    Load OHLCV data from a CSV file.
    
    Args:
        filepath: Path to the CSV file
        timestamp_col: Name of the timestamp column
        date_format: Optional date format string for parsing
    
    Returns:
        DataFrame with DatetimeIndex and OHLCV columns
    """
    df = pd.read_csv(filepath)
    
    # Normalize column names
    df.columns = df.columns.str.lower().str.strip()
    
    # Handle various timestamp column names
    timestamp_candidates = [timestamp_col, 'date', 'time', 'datetime', 'timestamp']
    timestamp_column = None
    
    for col in timestamp_candidates:
        if col in df.columns:
            timestamp_column = col
            break
    
    if timestamp_column is None:
        raise ValueError(f"No timestamp column found. Available columns: {df.columns.tolist()}")
    
    # Parse timestamps
    if date_format:
        df['timestamp'] = pd.to_datetime(df[timestamp_column], format=date_format)
    else:
        # Try to infer format
        sample = df[timestamp_column].iloc[0]
        if isinstance(sample, (int, float)):
            # Unix timestamp
            if sample > 1e12:
                df['timestamp'] = pd.to_datetime(df[timestamp_column], unit='ms')
            else:
                df['timestamp'] = pd.to_datetime(df[timestamp_column], unit='s')
        else:
            df['timestamp'] = pd.to_datetime(df[timestamp_column])
    
    # Set index
    df.set_index('timestamp', inplace=True)
    df.sort_index(inplace=True)
    
    # Normalize OHLCV columns
    column_mapping = {
        'o': 'open', 'h': 'high', 'l': 'low', 'c': 'close', 'v': 'volume',
        'Open': 'open', 'High': 'high', 'Low': 'low', 'Close': 'close', 'Volume': 'volume',
    }
    df.rename(columns=column_mapping, inplace=True)
    
    # Ensure required columns exist
    required = ['open', 'high', 'low', 'close']
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")
    
    # Add volume if missing
    if 'volume' not in df.columns:
        df['volume'] = 0
    
    return df[['open', 'high', 'low', 'close', 'volume']]


def load_ohlcv(
    filepath: Union[str, Path],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> pd.DataFrame:
    """
    Load OHLCV data with optional date filtering.
    
    Args:
        filepath: Path to the data file
        start_date: Optional start date filter
        end_date: Optional end date filter
    
    Returns:
        Filtered DataFrame
    """
    df = load_csv(filepath)
    
    if start_date:
        df = df[df.index >= start_date]
    
    if end_date:
        df = df[df.index <= end_date]
    
    return df


def infer_timeframe(df: pd.DataFrame) -> str:
    """
    Infer timeframe from OHLCV data.
    
    Args:
        df: DataFrame with DatetimeIndex
    
    Returns:
        Timeframe string (e.g., '1h', '4h', '1d')
    """
    if len(df) < 2:
        return '1h'
    
    # Calculate average time between bars
    deltas = df.index.to_series().diff().dropna()
    avg_delta = deltas.mean()
    
    minutes = avg_delta.total_seconds() / 60
    
    if minutes <= 1.5:
        return '1m'
    elif minutes <= 7.5:
        return '5m'
    elif minutes <= 22.5:
        return '15m'
    elif minutes <= 90:
        return '1h'
    elif minutes <= 360:
        return '4h'
    elif minutes <= 1440 * 1.5:
        return '1d'
    else:
        return '1w'


def resample_ohlcv(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """
    Resample OHLCV data to a different timeframe.
    
    Args:
        df: Source DataFrame
        timeframe: Target timeframe (e.g., '1h', '4h', '1d')
    
    Returns:
        Resampled DataFrame
    """
    timeframe_map = {
        '1m': '1T', '5m': '5T', '15m': '15T', '30m': '30T',
        '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W',
    }
    
    rule = timeframe_map.get(timeframe, timeframe)
    
    resampled = df.resample(rule).agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum',
    }).dropna()
    
    return resampled

