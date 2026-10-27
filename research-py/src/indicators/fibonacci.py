"""
Fibonacci retracement and extension utilities.
"""
import pandas as pd
import numpy as np
from typing import List, Optional, Tuple
from dataclasses import dataclass

from .trendlines import find_swing_points


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
    Find Fibonacci retracement anchored on confirmed swing points.

    Anchoring follows the methodology: "Analyse the swing points & draw
    Fibonacci retracement" (p.9). The previous implementation anchored on the
    window extremes (highest high / lowest low of the lookback window), which
    are not swing points at all and slide as the window advances.

    The TypeScript engine previously looked only at the last 4 swings and
    returned ``None`` when they did not contain both a high and a low. That
    silently dropped the Fibonacci confirmation factor depending on the shape
    of the recent swings, so both engines now scan the swings from most recent
    to oldest and take the first HIGH and the first LOW found.

    Args:
        df: OHLCV DataFrame
        lookback: Number of bars to look back for the swing search

    Returns:
        FibRetracement object if a usable swing pair exists, None otherwise
    """
    if len(df) < lookback:
        lookback = len(df)

    data = df.iloc[-lookback:]
    if len(data) == 0:
        return None

    # Confirmed swing points inside the window.
    swing_highs, swing_lows = find_swing_points(data, 5, 3)

    last_high: Optional[Tuple[int, float]] = None
    last_low: Optional[Tuple[int, float]] = None

    # Scan from most recent to oldest, taking the first high and first low.
    if swing_highs:
        last_high = swing_highs[-1]
    if swing_lows:
        last_low = swing_lows[-1]

    if last_high is None or last_low is None:
        return None

    high_idx, high_price = last_high
    low_idx, low_price = last_low

    # Direction is decided by which of the two extremes came first.
    direction = 'UP' if low_idx < high_idx else 'DOWN'

    levels = calculate_fib_levels(high_price, low_price, direction)

    return FibRetracement(
        swing_high=high_price,
        swing_low=low_price,
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

