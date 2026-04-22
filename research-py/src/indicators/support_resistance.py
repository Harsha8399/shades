"""
Support and resistance zone detection.
"""
import pandas as pd
import numpy as np
from typing import List, Tuple, Optional
from dataclasses import dataclass
from .trendlines import find_swing_points


@dataclass
class SRZone:
    """Support or resistance zone."""
    type: str  # 'SUPPORT' or 'RESISTANCE'
    price_level: float
    strength: int  # Number of touches
    first_touch: pd.Timestamp
    last_touch: pd.Timestamp


def calculate_atr(df: pd.DataFrame, period: int = 14) -> float:
    """Calculate Average True Range."""
    high = df['high']
    low = df['low']
    close = df['close'].shift(1)
    
    tr1 = high - low
    tr2 = abs(high - close)
    tr3 = abs(low - close)
    
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean().iloc[-1]
    
    return atr if not pd.isna(atr) else (high - low).mean()


def find_sr_zones(
    df: pd.DataFrame,
    tolerance_atr: float = 0.5,
    min_touches: int = 2,
) -> List[SRZone]:
    """
    Find support and resistance zones based on swing points.
    
    Args:
        df: OHLCV DataFrame
        tolerance_atr: Zone tolerance as ATR multiplier
        min_touches: Minimum touches to validate zone
    
    Returns:
        List of SRZone objects
    """
    atr = calculate_atr(df)
    tolerance = atr * tolerance_atr
    
    swing_highs, swing_lows = find_swing_points(df, 3, 3)
    zones = []
    
    # Group swing highs into resistance zones
    resistance_zones = _group_swings_into_zones(
        swing_highs, df.index, tolerance, 'RESISTANCE', min_touches
    )
    zones.extend(resistance_zones)
    
    # Group swing lows into support zones
    support_zones = _group_swings_into_zones(
        swing_lows, df.index, tolerance, 'SUPPORT', min_touches
    )
    zones.extend(support_zones)
    
    return zones


def _group_swings_into_zones(
    swings: List[Tuple[int, float]],
    index: pd.DatetimeIndex,
    tolerance: float,
    zone_type: str,
    min_touches: int,
) -> List[SRZone]:
    """Group swing points into zones based on price proximity."""
    if not swings:
        return []
    
    zones = []
    used = set()
    
    for i, (idx1, price1) in enumerate(swings):
        if i in used:
            continue
        
        cluster = [(idx1, price1)]
        used.add(i)
        
        # Find all swings within tolerance
        for j, (idx2, price2) in enumerate(swings):
            if j in used:
                continue
            
            avg_price = sum(p for _, p in cluster) / len(cluster)
            if abs(price2 - avg_price) <= tolerance:
                cluster.append((idx2, price2))
                used.add(j)
        
        if len(cluster) >= min_touches:
            prices = [p for _, p in cluster]
            indices = [idx for idx, _ in cluster]
            
            zones.append(SRZone(
                type=zone_type,
                price_level=sum(prices) / len(prices),
                strength=len(cluster),
                first_touch=index[min(indices)],
                last_touch=index[max(indices)],
            ))
    
    return zones


def is_price_at_zone(
    price: float,
    zones: List[SRZone],
    tolerance: float,
) -> Tuple[bool, Optional[SRZone], Optional[str]]:
    """
    Check if price is at a support/resistance zone.
    
    Returns:
        Tuple of (is_at_zone, zone, zone_type)
    """
    for zone in zones:
        if abs(price - zone.price_level) <= tolerance:
            return True, zone, zone.type
    
    return False, None, None


def find_nearest_support(price: float, zones: List[SRZone]) -> Optional[SRZone]:
    """Find nearest support level below current price."""
    supports = [z for z in zones if z.type == 'SUPPORT' and z.price_level < price]
    if not supports:
        return None
    return max(supports, key=lambda z: z.price_level)


def find_nearest_resistance(price: float, zones: List[SRZone]) -> Optional[SRZone]:
    """Find nearest resistance level above current price."""
    resistances = [z for z in zones if z.type == 'RESISTANCE' and z.price_level > price]
    if not resistances:
        return None
    return min(resistances, key=lambda z: z.price_level)

