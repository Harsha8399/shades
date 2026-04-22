"""
Swing Point Detection using scipy.signal.find_peaks.

Uses battle-tested scipy for peak detection, with custom logic on top
for trading-specific adjustments.
"""
import pandas as pd
import numpy as np
from dataclasses import dataclass
from typing import List, Tuple, Optional

try:
    from scipy.signal import find_peaks
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    print("Warning: scipy not installed. Using fallback swing detection.")


@dataclass
class SwingPoint:
    """Represents a swing high or low."""
    index: int
    price: float
    timestamp: pd.Timestamp
    swing_type: str  # 'HIGH' or 'LOW'
    strength: int    # Number of bars on each side that confirm this swing


def detect_swing_highs(
    df: pd.DataFrame,
    prominence: float = None,
    distance: int = 5,
    width: int = None,
) -> List[SwingPoint]:
    """
    Detect swing highs using scipy.signal.find_peaks.
    
    Args:
        df: DataFrame with 'high' column
        prominence: Minimum prominence of peaks (in price units or None for auto)
        distance: Minimum number of bars between peaks
        width: Minimum width of peaks
    
    Returns:
        List of SwingPoint objects for swing highs
    """
    highs = df['high'].values
    
    if HAS_SCIPY:
        # Auto-calculate prominence if not provided
        if prominence is None:
            prominence = np.std(highs) * 0.5
        
        peaks, properties = find_peaks(
            highs,
            prominence=prominence,
            distance=distance,
            width=width,
        )
        
        swing_highs = []
        for idx in peaks:
            strength = _calculate_swing_strength(highs, idx, 'HIGH')
            swing_highs.append(SwingPoint(
                index=idx,
                price=highs[idx],
                timestamp=df.index[idx] if hasattr(df.index, '__getitem__') else pd.Timestamp.now(),
                swing_type='HIGH',
                strength=strength,
            ))
        return swing_highs
    else:
        return _fallback_swing_highs(df, distance)


def detect_swing_lows(
    df: pd.DataFrame,
    prominence: float = None,
    distance: int = 5,
    width: int = None,
) -> List[SwingPoint]:
    """
    Detect swing lows using scipy.signal.find_peaks on inverted data.
    
    Args:
        df: DataFrame with 'low' column
        prominence: Minimum prominence of valleys (in price units or None for auto)
        distance: Minimum number of bars between valleys
        width: Minimum width of valleys
    
    Returns:
        List of SwingPoint objects for swing lows
    """
    lows = df['low'].values
    
    if HAS_SCIPY:
        # Invert lows to find valleys as peaks
        inverted = -lows
        
        if prominence is None:
            prominence = np.std(lows) * 0.5
        
        peaks, properties = find_peaks(
            inverted,
            prominence=prominence,
            distance=distance,
            width=width,
        )
        
        swing_lows = []
        for idx in peaks:
            strength = _calculate_swing_strength(lows, idx, 'LOW')
            swing_lows.append(SwingPoint(
                index=idx,
                price=lows[idx],
                timestamp=df.index[idx] if hasattr(df.index, '__getitem__') else pd.Timestamp.now(),
                swing_type='LOW',
                strength=strength,
            ))
        return swing_lows
    else:
        return _fallback_swing_lows(df, distance)


def detect_all_swings(
    df: pd.DataFrame,
    prominence: float = None,
    distance: int = 5,
) -> Tuple[List[SwingPoint], List[SwingPoint]]:
    """
    Detect both swing highs and swing lows.
    
    Returns:
        Tuple of (swing_highs, swing_lows)
    """
    highs = detect_swing_highs(df, prominence, distance)
    lows = detect_swing_lows(df, prominence, distance)
    return highs, lows


def _calculate_swing_strength(prices: np.ndarray, idx: int, swing_type: str) -> int:
    """
    Calculate swing strength as number of bars confirming the swing.
    
    A swing high of strength N means N bars on each side have lower highs.
    A swing low of strength N means N bars on each side have higher lows.
    """
    n = len(prices)
    strength = 0
    
    for offset in range(1, min(20, n)):  # Check up to 20 bars
        left_idx = idx - offset
        right_idx = idx + offset
        
        if left_idx < 0 or right_idx >= n:
            break
        
        if swing_type == 'HIGH':
            if prices[left_idx] < prices[idx] and prices[right_idx] < prices[idx]:
                strength += 1
            else:
                break
        else:  # LOW
            if prices[left_idx] > prices[idx] and prices[right_idx] > prices[idx]:
                strength += 1
            else:
                break
    
    return strength


def _fallback_swing_highs(df: pd.DataFrame, lookback: int = 5) -> List[SwingPoint]:
    """Fallback swing high detection without scipy."""
    highs = df['high'].values
    swing_highs = []
    
    for i in range(lookback, len(highs) - lookback):
        is_swing = True
        for j in range(1, lookback + 1):
            if highs[i] <= highs[i - j] or highs[i] <= highs[i + j]:
                is_swing = False
                break
        
        if is_swing:
            swing_highs.append(SwingPoint(
                index=i,
                price=highs[i],
                timestamp=df.index[i] if hasattr(df.index, '__getitem__') else pd.Timestamp.now(),
                swing_type='HIGH',
                strength=lookback,
            ))
    
    return swing_highs


def _fallback_swing_lows(df: pd.DataFrame, lookback: int = 5) -> List[SwingPoint]:
    """Fallback swing low detection without scipy."""
    lows = df['low'].values
    swing_lows = []
    
    for i in range(lookback, len(lows) - lookback):
        is_swing = True
        for j in range(1, lookback + 1):
            if lows[i] >= lows[i - j] or lows[i] >= lows[i + j]:
                is_swing = False
                break
        
        if is_swing:
            swing_lows.append(SwingPoint(
                index=i,
                price=lows[i],
                timestamp=df.index[i] if hasattr(df.index, '__getitem__') else pd.Timestamp.now(),
                swing_type='LOW',
                strength=lookback,
            ))
    
    return swing_lows


def filter_significant_swings(
    swings: List[SwingPoint],
    min_strength: int = 3,
) -> List[SwingPoint]:
    """Filter swings by minimum strength."""
    return [s for s in swings if s.strength >= min_strength]


def get_recent_swing_high(
    df: pd.DataFrame,
    lookback_bars: int = 50,
) -> Optional[SwingPoint]:
    """Get most recent significant swing high."""
    recent_df = df.iloc[-lookback_bars:] if len(df) > lookback_bars else df
    highs = detect_swing_highs(recent_df, distance=3)
    significant = filter_significant_swings(highs, min_strength=2)
    return significant[-1] if significant else None


def get_recent_swing_low(
    df: pd.DataFrame,
    lookback_bars: int = 50,
) -> Optional[SwingPoint]:
    """Get most recent significant swing low."""
    recent_df = df.iloc[-lookback_bars:] if len(df) > lookback_bars else df
    lows = detect_swing_lows(recent_df, distance=3)
    significant = filter_significant_swings(lows, min_strength=2)
    return significant[-1] if significant else None

