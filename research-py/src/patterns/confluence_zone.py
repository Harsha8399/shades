"""
Confluence Zone + Entry Model 2 Pattern implementation for Python.
"""
import pandas as pd
import numpy as np
from typing import Optional, List
from .base import BasePattern, Signal
from ..indicators.support_resistance import (
    find_sr_zones,
    is_price_at_zone,
    calculate_atr,
    find_nearest_support,
    find_nearest_resistance,
)
from ..indicators.fibonacci import find_fib_retracement, is_price_at_fib_level
from ..indicators.trendlines import (
    find_trendlines,
    get_trendline_price,
    find_recent_swing_high,
    find_recent_swing_low,
)
from ..strategies.strategy_spec import param


def _spec_value(param_id: str, fallback: float) -> float:
    """Read a spec-configurable numeric from strategy_spec.json, falling back
    to the preserved literal when the spec is unavailable (e.g. a standalone
    script run). The spec is the canonical source: these values are marked
    configurable there, so re-literalizing them elsewhere is what allowed the
    two engines to drift silently (Stage 3 Phase 3 review, finding F8)."""
    try:
        return param(param_id)
    except Exception:
        return fallback


# Minimum R:R for a structural target to be preferred over a fixed R:R target.
# Preserved verbatim from the TypeScript engine. Not a book rule.
MIN_TARGET_RR = _spec_value('MIN_TARGET_RR', 1.5)

# Trendline touch tolerance as an ATR multiple. Preserved verbatim from the
# TypeScript engine. Not a book rule.
TRENDLINE_TOLERANCE_ATR = _spec_value('TRENDLINE_TOLERANCE_ATR', 0.3)

# Zone touch tolerance as an ATR multiple and the minimum number of touches
# a zone or trendline needs. Spec-configurable; bound here to the spec.
SR_ZONE_TOLERANCE_ATR = _spec_value('SR_ZONE_TOLERANCE_ATR', 0.5)
SR_MIN_TOUCHES = int(_spec_value('SR_MIN_TOUCHES', 2))
TRENDLINE_MIN_TOUCHES = int(_spec_value('TRENDLINE_MIN_TOUCHES', 2))


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
        # Component toggles (defaults preserve current behavior)
        use_support_resistance: bool = True,
        use_fibonacci: bool = True,
        use_trendline: bool = True,
        use_rejection_candle: bool = True,
        use_minimum_confluence: bool = True,
        use_minimum_risk_reward: bool = True,
    ):
        default_config = {
            'min_confluence_factors': min_confluence,
            'sr_zone_lookback': sr_zone_lookback,
            'fib_levels': [0.5, 0.618, 0.786],
            'zone_tolerance_atr': zone_tolerance_atr,
            'min_rejection_wick_ratio': min_rejection_wick_ratio,
            'target_rr': target_rr,
            'atr_multiplier': atr_multiplier,
            # Component toggles
            'use_support_resistance': use_support_resistance,
            'use_fibonacci': use_fibonacci,
            'use_trendline': use_trendline,
            'use_rejection_candle': use_rejection_candle,
            'use_minimum_confluence': use_minimum_confluence,
            'use_minimum_risk_reward': use_minimum_risk_reward,
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
        
        # 1. Check S/R zones (if enabled)
        if config.get('use_support_resistance', True):
            # The ATR is computed once over the whole decision window and reused,
            # matching the TypeScript engine, which passes `context.atr` (the
            # outer ATR) rather than recomputing it on the sliced window.
            sr_zones = find_sr_zones(
                df.iloc[-config['sr_zone_lookback']:],
                tolerance_atr=SR_ZONE_TOLERANCE_ATR,
                min_touches=SR_MIN_TOUCHES,
                atr=atr,
            )
            
            at_zone, zone, zone_type = is_price_at_zone(current_price, sr_zones, tolerance)
            if at_zone and zone:
                zone_level = zone.price_level
                factors.append(f"sr_{zone_type.lower()}")
                direction = 'LONG' if zone_type == 'SUPPORT' else 'SHORT'
        
        # 2. Check Fibonacci levels (if enabled)
        if config.get('use_fibonacci', True):
            fib_retracement = find_fib_retracement(df, lookback=50)
            if fib_retracement:
                at_fib, fib_level = is_price_at_fib_level(
                    current_price, fib_retracement, tolerance
                )
                if at_fib and fib_level:
                    factors.append(f"fib_{int(fib_level.ratio * 1000)}")
                    if not direction:
                        direction = 'LONG' if fib_retracement.direction == 'UP' else 'SHORT'
        
        # 3. Check trendlines (if enabled)
        if config.get('use_trendline', True):
            # The tolerance is an ATR multiple in both engines (0.3 in
            # TypeScript). A percentage tolerance is scale-dependent and would
            # behave differently on NSE equities, MCX commodities and crypto.
            trendlines = find_trendlines(
                df, tolerance=TRENDLINE_TOLERANCE_ATR, min_touches=TRENDLINE_MIN_TOUCHES, atr=atr
            )
            if trendlines:
                current_idx = len(df) - 1
                # Check ALL trendlines, not just the strongest few. The TypeScript
                # engine calls `isPriceAtTrendline`, which scans the whole list,
                # so restricting this to the top 3 made the two engines disagree
                # whenever a relevant line ranked lower. A line that price is
                # currently touching is a line price is respecting, regardless
                # of how many other lines also touch.
                for tl in trendlines:
                    expected = get_trendline_price(tl, current_idx)
                    if abs(current_price - expected) <= tolerance:
                        factors.append(f"trendline_{tl.type.lower()}")
                        if not direction:
                            direction = 'LONG' if tl.type == 'SUPPORT' else 'SHORT'
                        break
        
        # Check minimum confluence (if enabled)
        min_confluence = config.get('min_confluence_factors', 2) if config.get('use_minimum_confluence', True) else 0
        if len(factors) < min_confluence or not direction:
            return None
        
        # 4. Check for Entry Model 2 (rejection candle) - if enabled
        if config.get('use_rejection_candle', True):
            if not self._is_rejection_candle(current_bar, direction, zone_level, tolerance, atr):
                return None
        
        # Calculate entry, SL, TP
        entry_price = current_price
        stop_loss = self.calculate_stop_loss(entry_price, direction, df)
        target = self.calculate_target(entry_price, stop_loss, direction, df)
        
        # Validate R:R
        risk = abs(entry_price - stop_loss)
        reward = abs(target - entry_price)
        rr_ratio = reward / risk if risk > 0 else 0
        
        # Minimum risk/reward threshold (if enabled)
        if config.get('use_minimum_risk_reward', True):
            if rr_ratio < MIN_TARGET_RR:
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
        atr: float,
    ) -> bool:
        """Check if candle is a rejection candle (Entry Model 2)."""
        body = abs(bar['close'] - bar['open'])
        upper_wick = bar['high'] - max(bar['open'], bar['close'])
        lower_wick = min(bar['open'], bar['close']) - bar['low']
        
        min_ratio = self.config['min_rejection_wick_ratio']
        
        # Minimum meaningful body size: 1% of ATR (prevents near-zero bodies from creating huge ratios)
        min_body_size = atr * 0.01
        effective_body = max(body, min_body_size)
        
        if direction == 'LONG':
            # Bullish rejection: lower wick into zone, close above
            wick_ratio = lower_wick / effective_body
            wick_touches_zone = bar['low'] <= zone_level + tolerance
            close_above_zone = bar['close'] > zone_level
            is_bullish = bar['close'] >= bar['open']
            
            return (wick_touches_zone and close_above_zone and 
                    wick_ratio >= min_ratio and is_bullish)
        else:
            # Bearish rejection: upper wick into zone, close below
            wick_ratio = upper_wick / effective_body
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
        """
        Calculate stop-loss using the STOP_BUFFER_ATR rule (Stage 3 Phase 1).

        Buffer: 0.1 × ATR.  This replaces the old STOP_LOSS_BUFFER (10% of
        the entry-to-swing distance), which was scale-dependent: 10% of a
        small swing on a high-priced index gives a very different absolute
        distance from 10% of a large swing on a low-priced stock.
        STOP_BUFFER_ATR (0.1 ATR) is volatility-adaptive and scale-free, and
        reproduces the author's own drawn stops (p.16/p.17) to within the
        band observed in the charts.

        The SHORT branch requires that the located swing high is strictly
        ABOVE the entry; a swing high at or below the entry is not a valid
        stop reference for a short trade.  The TypeScript engine already
        enforced this; Python now matches.

        NOTE: This is still NOT the book's stop methodology.  The book (p.16-17)
        specifies three book-derived rules (EM1, EM2A, EM2B), all of which
        require a 'broader ongoing trendline' whose implementation is gated on
        TRENDLINE_ORIGIN_RULE (spec: NOT IMPLEMENTED, Stage 3).  This function
        is the parity baseline, not the final rule.
        """
        atr = calculate_atr(df)
        # STOP_BUFFER_ATR = 0.1 (spec: Stage 3 Phase 1, RESOLVED)
        buffer = atr * 0.1

        if direction == 'LONG':
            swing = find_recent_swing_low(df)
            if swing is not None:
                swing_low = float(swing[1])
                return swing_low - buffer
            # Fallback: minimum of the last 10 lows minus the ATR buffer.
            recent_lows = df['low'].iloc[-10:]
            min_low = float(recent_lows.min())
            return min_low - buffer
        else:
            swing = find_recent_swing_high(df)
            if swing is not None:
                swing_high = float(swing[1])
                # The swing high must be ABOVE the entry for a short.
                # A swing high at or below entry cannot serve as a stop
                # reference; fall through to the 10-candle high fallback.
                if swing_high > entry_price:
                    return swing_high + buffer
            # Fallback: maximum of the last 10 highs plus the ATR buffer,
            # guaranteed to be above the entry price.
            recent_highs = df['high'].iloc[-10:]
            max_high = float(recent_highs.max())
            fallback = max_high + buffer
            # Hard floor: stop must be above entry
            return max(fallback, entry_price + buffer)

    def calculate_target(
        self,
        entry_price: float,
        stop_loss: float,
        direction: str,
        df: pd.DataFrame,
    ) -> float:
        """
        Calculate the target from the next structural S/R level.

        The book (p.17) says the target is "the next crucial support" (for a
        short) or resistance (for a long), noting any minor levels in
        between. A fixed R:R is not that. This mirrors the TypeScript engine
        exactly.

        Falls back to a fixed R:R target when no structural level is at least
        ``MIN_TARGET_RR`` away.
        """
        risk = abs(entry_price - stop_loss)
        default_rr = self.config.get('target_rr', 2.0)

        atr = calculate_atr(df)
        zones = find_sr_zones(
            df, tolerance_atr=SR_ZONE_TOLERANCE_ATR, min_touches=SR_MIN_TOUCHES, atr=atr
        )

        if direction == 'LONG':
            resistance = find_nearest_resistance(entry_price, zones)
            if resistance is not None:
                distance = resistance.price_level - entry_price
                if risk > 0 and (distance / risk) >= MIN_TARGET_RR:
                    # Exit just before the level, where orders cluster.
                    return resistance.price_level * 0.998
        else:
            support = find_nearest_support(entry_price, zones)
            if support is not None:
                distance = entry_price - support.price_level
                if risk > 0 and (distance / risk) >= MIN_TARGET_RR:
                    return support.price_level * 1.002

        # Fallback: fixed R:R.
        if direction == 'LONG':
            return entry_price + (risk * default_rr)
        return entry_price - (risk * default_rr)
    
    def get_required_bars(self) -> int:
        return max(self.config['sr_zone_lookback'], 100)

