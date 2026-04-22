"""
Technical Indicators using pandas-ta library.

This module wraps the battle-tested pandas-ta package
for reliable, verified calculations.

pandas-ta provides 130+ indicators with pandas integration.
"""
import pandas as pd
import numpy as np

# Try to import pandas_ta, fall back to manual calculation if not available
try:
    import pandas_ta as ta
    HAS_PANDAS_TA = True
except ImportError:
    HAS_PANDAS_TA = False
    print("Warning: pandas-ta not installed. Using fallback calculations.")


def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """
    Calculate Average True Range.
    
    Args:
        df: DataFrame with 'high', 'low', 'close' columns
        period: ATR period (default: 14)
    
    Returns:
        Series of ATR values
    """
    if HAS_PANDAS_TA:
        return ta.atr(df['high'], df['low'], df['close'], length=period)
    
    # Fallback calculation
    high = df['high']
    low = df['low']
    close = df['close'].shift(1)
    
    tr1 = high - low
    tr2 = abs(high - close)
    tr3 = abs(low - close)
    
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.rolling(window=period).mean()


def calculate_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Calculate Relative Strength Index."""
    if HAS_PANDAS_TA:
        return ta.rsi(df['close'], length=period)
    
    # Fallback
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))


def calculate_macd(
    df: pd.DataFrame,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9
) -> pd.DataFrame:
    """Calculate MACD indicator."""
    if HAS_PANDAS_TA:
        return ta.macd(df['close'], fast=fast, slow=slow, signal=signal)
    
    # Fallback
    exp1 = df['close'].ewm(span=fast, adjust=False).mean()
    exp2 = df['close'].ewm(span=slow, adjust=False).mean()
    macd_line = exp1 - exp2
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    
    return pd.DataFrame({
        'MACD_12_26_9': macd_line,
        'MACDs_12_26_9': signal_line,
        'MACDh_12_26_9': histogram,
    })


def calculate_bollinger_bands(
    df: pd.DataFrame,
    period: int = 20,
    std: float = 2.0
) -> pd.DataFrame:
    """Calculate Bollinger Bands."""
    if HAS_PANDAS_TA:
        return ta.bbands(df['close'], length=period, std=std)
    
    # Fallback
    sma = df['close'].rolling(window=period).mean()
    std_dev = df['close'].rolling(window=period).std()
    
    return pd.DataFrame({
        'BBL': sma - (std_dev * std),
        'BBM': sma,
        'BBU': sma + (std_dev * std),
    })


def calculate_stochastic(
    df: pd.DataFrame,
    k_period: int = 14,
    d_period: int = 3
) -> pd.DataFrame:
    """Calculate Stochastic oscillator."""
    if HAS_PANDAS_TA:
        return ta.stoch(df['high'], df['low'], df['close'], k=k_period, d=d_period)
    
    # Fallback
    lowest_low = df['low'].rolling(window=k_period).min()
    highest_high = df['high'].rolling(window=k_period).max()
    
    k = 100 * (df['close'] - lowest_low) / (highest_high - lowest_low)
    d = k.rolling(window=d_period).mean()
    
    return pd.DataFrame({
        'STOCHk': k,
        'STOCHd': d,
    })


def calculate_adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """Calculate Average Directional Index."""
    if HAS_PANDAS_TA:
        return ta.adx(df['high'], df['low'], df['close'], length=period)
    
    # Fallback - simplified
    plus_dm = df['high'].diff()
    minus_dm = df['low'].diff()
    
    plus_dm[plus_dm < 0] = 0
    minus_dm[minus_dm > 0] = 0
    minus_dm = abs(minus_dm)
    
    tr = calculate_atr(df, 1) * period  # Approximate
    
    plus_di = 100 * (plus_dm.rolling(period).mean() / tr.rolling(period).mean())
    minus_di = 100 * (minus_dm.rolling(period).mean() / tr.rolling(period).mean())
    
    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    adx = dx.rolling(period).mean()
    
    return pd.DataFrame({
        'ADX': adx,
        'DMP': plus_di,
        'DMN': minus_di,
    })


def calculate_ema(series: pd.Series, period: int) -> pd.Series:
    """Calculate Exponential Moving Average."""
    if HAS_PANDAS_TA:
        return ta.ema(series, length=period)
    return series.ewm(span=period, adjust=False).mean()


def calculate_sma(series: pd.Series, period: int) -> pd.Series:
    """Calculate Simple Moving Average."""
    if HAS_PANDAS_TA:
        return ta.sma(series, length=period)
    return series.rolling(window=period).mean()


def add_all_indicators(
    df: pd.DataFrame,
    atr_period: int = 14,
    rsi_period: int = 14,
) -> pd.DataFrame:
    """
    Add common indicators to DataFrame.
    
    Args:
        df: OHLCV DataFrame
        atr_period: ATR period
        rsi_period: RSI period
    
    Returns:
        DataFrame with added indicator columns
    """
    df = df.copy()
    
    df['atr'] = calculate_atr(df, atr_period)
    df['rsi'] = calculate_rsi(df, rsi_period)
    df['sma_20'] = calculate_sma(df['close'], 20)
    df['sma_50'] = calculate_sma(df['close'], 50)
    df['ema_20'] = calculate_ema(df['close'], 20)
    
    # Trend direction
    df['trend'] = np.where(df['sma_20'] > df['sma_50'], 'UP', 'DOWN')
    
    return df


def get_current_atr(df: pd.DataFrame, period: int = 14) -> float:
    """Get most recent ATR value."""
    atr = calculate_atr(df, period)
    return atr.iloc[-1] if len(atr) > 0 and not pd.isna(atr.iloc[-1]) else 0


def get_current_rsi(df: pd.DataFrame, period: int = 14) -> float:
    """Get most recent RSI value."""
    rsi = calculate_rsi(df, period)
    return rsi.iloc[-1] if len(rsi) > 0 and not pd.isna(rsi.iloc[-1]) else 50


def is_overbought(df: pd.DataFrame, threshold: float = 70) -> bool:
    """Check if RSI indicates overbought condition."""
    return get_current_rsi(df) > threshold


def is_oversold(df: pd.DataFrame, threshold: float = 30) -> bool:
    """Check if RSI indicates oversold condition."""
    return get_current_rsi(df) < threshold

