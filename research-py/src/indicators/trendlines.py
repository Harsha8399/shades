"""
Trendline detection utilities.
"""
import pandas as pd
import numpy as np
from typing import List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class Trendline:
    """Represents a trendline."""
    type: str  # 'SUPPORT' or 'RESISTANCE'
    slope: float
    intercept: float
    start_idx: int
    end_idx: int
    touches: int
    strength: float


def find_swing_points(
    df: pd.DataFrame,
    left_bars: int = 3,
    right_bars: int = 3,
) -> Tuple[List[Tuple[int, float]], List[Tuple[int, float]]]:
    """
    Find swing highs and swing lows.
    
    Returns:
        Tuple of (swing_highs, swing_lows) as lists of (index, price)
    """
    highs = []
    lows = []
    
    for i in range(left_bars, len(df) - right_bars):
        # Check swing high
        is_high = True
        current_high = df['high'].iloc[i]
        
        for j in range(i - left_bars, i):
            if df['high'].iloc[j] >= current_high:
                is_high = False
                break
        
        if is_high:
            for j in range(i + 1, i + right_bars + 1):
                if df['high'].iloc[j] >= current_high:
                    is_high = False
                    break
        
        if is_high:
            highs.append((i, current_high))
        
        # Check swing low
        is_low = True
        current_low = df['low'].iloc[i]
        
        for j in range(i - left_bars, i):
            if df['low'].iloc[j] <= current_low:
                is_low = False
                break
        
        if is_low:
            for j in range(i + 1, i + right_bars + 1):
                if df['low'].iloc[j] <= current_low:
                    is_low = False
                    break
        
        if is_low:
            lows.append((i, current_low))
    
    return highs, lows


def find_trendlines(
    df: pd.DataFrame,
    tolerance: float = 0.02,
    min_touches: int = 2,
) -> List[Trendline]:
    """
    Find trendlines from swing points.
    
    Args:
        df: OHLCV DataFrame
        tolerance: Price tolerance as percentage
        min_touches: Minimum touches to validate trendline
    
    Returns:
        List of detected trendlines
    """
    swing_highs, swing_lows = find_swing_points(df)
    trendlines = []
    
    # Find support trendlines (connecting lows)
    for i in range(len(swing_lows) - 1):
        for j in range(i + 1, len(swing_lows)):
            idx1, price1 = swing_lows[i]
            idx2, price2 = swing_lows[j]
            
            if idx2 == idx1:
                continue
            
            slope = (price2 - price1) / (idx2 - idx1)
            intercept = price1 - (slope * idx1)
            
            # Count touches
            touches = 2
            for k, (idx, price) in enumerate(swing_lows):
                if k == i or k == j:
                    continue
                expected = intercept + slope * idx
                if abs(price - expected) / expected < tolerance:
                    touches += 1
            
            if touches >= min_touches:
                trendlines.append(Trendline(
                    type='SUPPORT',
                    slope=slope,
                    intercept=intercept,
                    start_idx=idx1,
                    end_idx=idx2,
                    touches=touches,
                    strength=touches / len(swing_lows) if swing_lows else 0,
                ))
    
    # Find resistance trendlines (connecting highs)
    for i in range(len(swing_highs) - 1):
        for j in range(i + 1, len(swing_highs)):
            idx1, price1 = swing_highs[i]
            idx2, price2 = swing_highs[j]
            
            if idx2 == idx1:
                continue
            
            slope = (price2 - price1) / (idx2 - idx1)
            intercept = price1 - (slope * idx1)
            
            # Count touches
            touches = 2
            for k, (idx, price) in enumerate(swing_highs):
                if k == i or k == j:
                    continue
                expected = intercept + slope * idx
                if abs(price - expected) / expected < tolerance:
                    touches += 1
            
            if touches >= min_touches:
                trendlines.append(Trendline(
                    type='RESISTANCE',
                    slope=slope,
                    intercept=intercept,
                    start_idx=idx1,
                    end_idx=idx2,
                    touches=touches,
                    strength=touches / len(swing_highs) if swing_highs else 0,
                ))
    
    # Sort by strength
    trendlines.sort(key=lambda t: t.strength, reverse=True)
    
    return trendlines


def get_trendline_price(trendline: Trendline, index: int) -> float:
    """Get price at a specific index for a trendline."""
    return trendline.intercept + (trendline.slope * index)

