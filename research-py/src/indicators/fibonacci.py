"""
Fibonacci retracement and extension utilities.
"""
import pandas as pd
import numpy as np
from typing import List, Optional, Tuple
from dataclasses import dataclass


# Standard Fibonacci ratios
FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786]
FIB_EXTENSION_RATIOS = [1.272, 1.618, 2.0, 2.618]


@dataclass
class FibLevel:
    """Represents a Fibonacci level."""
    ratio: float
    price: float
    label: str


@dataclass
class FibRetracement:
    """Fibonacci retracement levels."""
    swing_high: float
    swing_low: float
    direction: str  # Direction of the move being retraced
    levels: List[FibLevel]


def calculate_fib_levels(
    swing_high: float,
    swing_low: float,
    direction: str = 'UP',
    ratios: Optional[List[float]] = None,
) -> List[FibLevel]:
    """
    Calculate Fibonacci retracement levels.
    
    Args:
        swing_high: High point of the swing
        swing_low: Low point of the swing
        direction: Direction of the original move ('UP' or 'DOWN')
        ratios: Optional custom Fibonacci ratios
    
    Returns:
        List of FibLevel objects
    """
    if ratios is None:
        ratios = FIB_RATIOS
    
    price_range = swing_high - swing_low
    levels = []
    
    for ratio in ratios:
        if direction == 'UP':
            # Retracement of up move (from high going down)
            price = swing_high - (price_range * ratio)
        else:
            # Retracement of down move (from low going up)
            price = swing_low + (price_range * ratio)
        
        levels.append(FibLevel(
            ratio=ratio,
            price=price,
            label=f"{ratio * 100:.1f}%",
        ))
    
    return levels


def find_fib_retracement(
    df: pd.DataFrame,
    lookback: int = 50,
) -> Optional[FibRetracement]:
    """
    Find Fibonacci retracement from recent swing.
    
    Args:
        df: OHLCV DataFrame
        lookback: Number of bars to look back for swing
    
    Returns:
        FibRetracement object if found, None otherwise
    """
    if len(df) < lookback:
        lookback = len(df)
    
    data = df.iloc[-lookback:]
    
    # Find swing high and low
    high_idx = data['high'].idxmax()
    low_idx = data['low'].idxmin()
    
    swing_high = data['high'].max()
    swing_low = data['low'].min()
    
    # Determine direction based on which came first
    if data.index.get_loc(low_idx) < data.index.get_loc(high_idx):
        direction = 'UP'  # Move was up, we're looking for pullback
    else:
        direction = 'DOWN'  # Move was down, we're looking for bounce
    
    levels = calculate_fib_levels(swing_high, swing_low, direction)
    
    return FibRetracement(
        swing_high=swing_high,
        swing_low=swing_low,
        direction=direction,
        levels=levels,
    )


def calculate_fib_extensions(
    swing_high: float,
    swing_low: float,
    direction: str = 'UP',
) -> List[FibLevel]:
    """
    Calculate Fibonacci extension levels.
    
    Args:
        swing_high: High point of the swing
        swing_low: Low point of the swing
        direction: Direction of the original move
    
    Returns:
        List of FibLevel extension objects
    """
    price_range = swing_high - swing_low
    levels = []
    
    for ratio in FIB_EXTENSION_RATIOS:
        if direction == 'UP':
            price = swing_low + (price_range * ratio)
        else:
            price = swing_high - (price_range * ratio)
        
        levels.append(FibLevel(
            ratio=ratio,
            price=price,
            label=f"{ratio * 100:.1f}%",
        ))
    
    return levels


def is_price_at_fib_level(
    price: float,
    fib_retracement: FibRetracement,
    tolerance: float,
) -> Tuple[bool, Optional[FibLevel]]:
    """
    Check if price is at a Fibonacci level.
    
    Args:
        price: Current price
        fib_retracement: FibRetracement object
        tolerance: Price tolerance
    
    Returns:
        Tuple of (is_at_level, level)
    """
    for level in fib_retracement.levels:
        if abs(price - level.price) <= tolerance:
            return True, level
    
    return False, None

