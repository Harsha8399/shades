"""
Confluence Zone + Entry Model 2 Pattern implementation for Python.
"""
import pandas as pd
import numpy as np
from typing import Optional, List
from .base import BasePattern, Signal
from ..indicators.support_resistance import find_sr_zones, is_price_at_zone, calculate_atr
from ..indicators.fibonacci import find_fib_retracement, is_price_at_fib_level
from ..indicators.trendlines import find_trendlines, get_trendline_price


class ConfluenceZonePattern(BasePattern):
    """
    Confluence Zone + Entry Model 2 Pattern.
    
    Detects high-probability entry points where multiple technical factors align:
    1. Support/Resistance Zone
    2. Fibonacci Level (50%, 61.8%, 78.6%)
    3. Trendline
    4. Entry Model 2 - Rejection candle at confluence
    """
    
    @property
    def id(self) -> str:
        return "confluence-zone-em2"
    
    @property
    def name(self) -> str:
        return "Confluence Zone + Entry Model 2"
    
    @property
    def description(self) -> str:
        return "Detects rejection candles at zones where S/R, Fib, and trendline align"
    
    def __init__(
        self,
        config: Optional[dict] = None,
        # Parameters for optimization
        min_confluence: int = 2,
        atr_multiplier: float = 2.0,
        target_rr: float = 2.0,
        sr_zone_lookback: int = 100,
        zone_tolerance_atr: float = 0.5,
        min_rejection_wick_ratio: float = 2.0,
    ):
        default_config = {
            'min_confluence_factors': min_confluence,
            'sr_zone_lookback': sr_zone_lookback,
            'fib_levels': [0.5, 0.618, 0.786],
            'zone_tolerance_atr': zone_tolerance_atr,
            'min_rejection_wick_ratio': min_rejection_wick_ratio,
            'target_rr': target_rr,
            'atr_multiplier': atr_multiplier,
        }
        if config:
            default_config.update(config)
        super().__init__(default_config)
    
    def detect_signal(
        self,
        df: pd.DataFrame,
        symbol: str = "",
    ) -> Optional[Signal]:
        """Detect confluence zone signal."""
        if not self.validate(df):
            return None
        
        config = self.config
        atr = calculate_atr(df)
        tolerance = atr * config['zone_tolerance_atr']
        
        current_bar = df.iloc[-1]
        current_price = current_bar['close']
        
        # Find confluence factors
        factors = []
        direction = None
        zone_level = current_price
        
        # 1. Check S/R zones
        sr_zones = find_sr_zones(
            df.iloc[-config['sr_zone_lookback']:],
            tolerance_atr=0.5,
            min_touches=2
        )
        
        at_zone, zone, zone_type = is_price_at_zone(current_price, sr_zones, tolerance)
        if at_zone and zone:
            zone_level = zone.price_level
            factors.append(f"sr_{zone_type.lower()}")
            direction = 'LONG' if zone_type == 'SUPPORT' else 'SHORT'
        
        # 2. Check Fibonacci levels
        fib_retracement = find_fib_retracement(df, lookback=50)
        if fib_retracement:
            at_fib, fib_level = is_price_at_fib_level(
                current_price, fib_retracement, tolerance
            )
            if at_fib and fib_level:
                factors.append(f"fib_{int(fib_level.ratio * 1000)}")
                if not direction:
                    direction = 'LONG' if fib_retracement.direction == 'UP' else 'SHORT'
        
        # 3. Check trendlines
        trendlines = find_trendlines(df, tolerance=0.02, min_touches=2)
        if trendlines:
            current_idx = len(df) - 1
            for tl in trendlines[:3]:  # Check top 3 trendlines
                expected = get_trendline_price(tl, current_idx)
                if abs(current_price - expected) <= tolerance:
                    factors.append(f"trendline_{tl.type.lower()}")
                    if not direction:
                        direction = 'LONG' if tl.type == 'SUPPORT' else 'SHORT'
                    break
        
        # Check minimum confluence
        if len(factors) < config['min_confluence_factors'] or not direction:
            return None
        
        # 4. Check for Entry Model 2 (rejection candle)
        if not self._is_rejection_candle(current_bar, direction, zone_level, tolerance):
            return None
        
        # Calculate entry, SL, TP
        entry_price = current_price
        stop_loss = self.calculate_stop_loss(entry_price, direction, df)
        target = self.calculate_target(entry_price, stop_loss, direction, df)
        
        # Validate R:R
        risk = abs(entry_price - stop_loss)
        reward = abs(target - entry_price)
        rr_ratio = reward / risk if risk > 0 else 0
        
        if rr_ratio < 1.5:
            return None
        
        confidence = min(len(factors) / 4, 1.0)
        
        return Signal(
            pattern_id=self.id,
            pattern_name=self.name,
            direction=direction,
            timestamp=df.index[-1],
            entry_price=entry_price,
            stop_loss=stop_loss,
            target=target,
            confidence=confidence,
            confluence_factors=factors,
            risk_reward_ratio=rr_ratio,
        )
    
    def _is_rejection_candle(
        self,
        bar: pd.Series,
        direction: str,
        zone_level: float,
        tolerance: float,
    ) -> bool:
        """Check if candle is a rejection candle (Entry Model 2)."""
        body = abs(bar['close'] - bar['open'])
        upper_wick = bar['high'] - max(bar['open'], bar['close'])
        lower_wick = min(bar['open'], bar['close']) - bar['low']
        
        min_ratio = self.config['min_rejection_wick_ratio']
        
        if direction == 'LONG':
            # Bullish rejection: lower wick into zone, close above
            wick_ratio = lower_wick / body if body > 0 else lower_wick
            wick_touches_zone = bar['low'] <= zone_level + tolerance
            close_above_zone = bar['close'] > zone_level
            is_bullish = bar['close'] >= bar['open']
            
            return (wick_touches_zone and close_above_zone and 
                    wick_ratio >= min_ratio and is_bullish)
        else:
            # Bearish rejection: upper wick into zone, close below
            wick_ratio = upper_wick / body if body > 0 else upper_wick
            wick_touches_zone = bar['high'] >= zone_level - tolerance
            close_below_zone = bar['close'] < zone_level
            is_bearish = bar['close'] <= bar['open']
            
            return (wick_touches_zone and close_below_zone and 
                    wick_ratio >= min_ratio and is_bearish)
    
    def calculate_stop_loss(
        self,
        entry_price: float,
        direction: str,
        df: pd.DataFrame,
    ) -> float:
        """Calculate stop-loss based on recent swing."""
        recent = df.iloc[-10:]
        
        if direction == 'LONG':
            swing_low = recent['low'].min()
            buffer = (entry_price - swing_low) * 0.1
            return swing_low - buffer
        else:
            swing_high = recent['high'].max()
            buffer = (swing_high - entry_price) * 0.1
            return swing_high + buffer
    
    def get_required_bars(self) -> int:
        return max(self.config['sr_zone_lookback'], 100)

