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


@dataclass
class ConfirmedSwing:
    """
    A swing point together with the bar at which it became knowable.

    ``confirmed_at`` is the index of the last bar required to prove the swing.
    For a fractal with ``right_bars`` confirmation bars, a swing at index ``k``
    is only confirmed at ``k + right_bars`` -- until then it could still be
    invalidated by a future bar.
    """
    index: int
    price: float
    confirmed_at: int
    swing_type: str  # 'HIGH' or 'LOW'


def find_confirmed_swings(
    df: pd.DataFrame,
    left_bars: int = 3,
    right_bars: int = 3,
) -> Tuple[List[ConfirmedSwing], List[ConfirmedSwing]]:
    """
    Find swing highs and lows, annotated with their confirmation index.

    This is the causality-aware counterpart of :func:`find_swing_points`. It
    returns the same set of swings, but additionally records ``confirmed_at``,
    the index of the last bar needed to confirm the swing.

    Guarantee: a returned swing at index ``k`` always satisfies
    ``k + right_bars <= len(df) - 1``. Every swing handed back has already been
    confirmed by candles that exist inside ``df``; no swing depends on a bar
    that is not present.

    Args:
        df: OHLCV DataFrame
        left_bars: Bars required on the left side
        right_bars: Bars required on the right side (confirmation delay)

    Returns:
        Tuple of (swing_highs, swing_lows) as lists of ConfirmedSwing
    """
    highs: List[ConfirmedSwing] = []
    lows: List[ConfirmedSwing] = []

    if len(df) < left_bars + right_bars + 1:
        return highs, lows

    # The last bar that can host a *confirmed* swing. A swing at index k needs
    # bars k-left_bars .. k+right_bars to exist inside df.
    last_host = len(df) - right_bars - 1

    for i in range(left_bars, last_host + 1):
        current_high = df['high'].iloc[i]
        current_low = df['low'].iloc[i]

        # --- swing high ---
        is_high = True
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
            highs.append(ConfirmedSwing(
                index=i,
                price=current_high,
                confirmed_at=i + right_bars,
                swing_type='HIGH',
            ))

        # --- swing low ---
        is_low = True
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
            lows.append(ConfirmedSwing(
                index=i,
                price=current_low,
                confirmed_at=i + right_bars,
                swing_type='LOW',
            ))

    return highs, lows


def filter_confirmed_swings(
    swings: List[ConfirmedSwing],
    as_of_index: int,
) -> List[ConfirmedSwing]:
    """
    Return only the swings that were confirmed on or before ``as_of_index``.

    This is the explicit, testable form of the causality rule. A swing whose
    ``confirmed_at`` is greater than ``as_of_index`` is not yet knowable and
    must not influence a decision made at ``as_of_index``.

    Args:
        swings: Swings returned by :func:`find_confirmed_swings`
        as_of_index: The last bar index visible to the decision maker

    Returns:
        List of swings confirmed at or before ``as_of_index``
    """
    return [s for s in swings if s.confirmed_at <= as_of_index]


def find_swing_points(
    df: pd.DataFrame,
    left_bars: int = 3,
    right_bars: int = 3,
) -> Tuple[List[Tuple[int, float]], List[Tuple[int, float]]]:
    """
    Find swing highs and lows.

    Thin wrapper over :func:`find_confirmed_swings` preserving the original
    ``(index, price)`` tuple interface.

    Returns:
        Tuple of (swing_highs, swing_lows) as lists of (index, price)
    """
    highs, lows = find_confirmed_swings(df, left_bars, right_bars)
    return (
        [(s.index, s.price) for s in highs],
        [(s.index, s.price) for s in lows],
    )


def find_recent_swing_high(
    df: pd.DataFrame,
    left_bars: int = 3,
) -> Optional[Tuple[int, float]]:
    """
    Most recent confirmed swing high, excluding the final bar.

    The final bar is excluded because a swing confirmed by it has not been
    confirmed yet. The TypeScript engine uses a 3/1 fractal for this lookup;
    this mirrors it exactly so that both engines derive the same stop.
    """
    if len(df) < 2:
        return None
    highs, _ = find_swing_points(df.iloc[:-1], left_bars, 1)
    return highs[-1] if highs else None


def find_recent_swing_low(
    df: pd.DataFrame,
    left_bars: int = 3,
) -> Optional[Tuple[int, float]]:
    """
    Most recent confirmed swing low, excluding the final bar.

    Mirrors :func:`find_recent_swing_high`.
    """
    if len(df) < 2:
        return None
    _, lows = find_swing_points(df.iloc[:-1], left_bars, 1)
    return lows[-1] if lows else None


def find_trendlines(
    df: pd.DataFrame,
    tolerance: Optional[float] = None,
    min_touches: Optional[int] = None,
    atr: Optional[float] = None,
) -> List[Trendline]:
    """
    Find trendlines from swing points.

    The touch tolerance is expressed as an ATR multiple, not a percentage of
    price. A percentage tolerance is scale-dependent: 2% of a 1000-point index
    is a 20-point band while 2% of a 50-point stock is a 1-point band, so the
    same code behaves completely differently across NSE equities, MCX
    commodities and crypto. The TypeScript engine already used an ATR
    multiple, and the S/R zone tolerance uses one in both engines.

    Args:
        df: OHLCV DataFrame
        tolerance: Touch tolerance as an ATR multiple (default from
            TRENDLINE_TOLERANCE_ATR in strategy_spec.json).
        min_touches: Minimum touches to validate trendline (default from
            TRENDLINE_MIN_TOUCHES in strategy_spec.json).
        atr: Pre-computed ATR. If None it is calculated from ``df``.

    Returns:
        List of detected trendlines
    """
    if tolerance is None or min_touches is None:
        # Bound to the spec lazily to avoid a module-import cycle and to keep
        # these defaults drivable from strategy_spec.json (T20 drift guard).
        from ..strategies.strategy_spec import param
        try:
            if tolerance is None:
                tolerance = float(param('TRENDLINE_TOLERANCE_ATR'))
            if min_touches is None:
                min_touches = int(param('TRENDLINE_MIN_TOUCHES'))
        except Exception:
            tolerance = tolerance if tolerance is not None else 0.3
            min_touches = min_touches if min_touches is not None else 2

    if atr is None:
        # Imported lazily to avoid a circular import: support_resistance
        # imports find_swing_points from this module.
        from .support_resistance import calculate_atr
        atr = calculate_atr(df)

    tolerance_price = atr * tolerance

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
                if abs(price - expected) <= tolerance_price:
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
                if abs(price - expected) <= tolerance_price:
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

