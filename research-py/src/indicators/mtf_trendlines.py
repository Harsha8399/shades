"""
Multi-timeframe broader-trendline extractor.

Implements the design in ``docs/stage3/MTF_TRENDLINE_DESIGN.md``:

    entry-timeframe candles
            |
            +-(1) resample to the higher time frame (drop the forming HTF candle)
            +-(2) find confirmed swings on the HTF series
            +-(3) build candidate trendlines from same-type swing pairs
            |       (keep those with >= TRENDLINE_MIN_TOUCHES touches)
            +-(4) return the SET of valid lines -- no scoring, no ranking
            +-(5) evaluate each line at the entry bar (caller picks the
                  binding one)

Causality invariants (design doc section 4):

    L1  the HTF series used at decision time t contains only HTF candles
        that closed at or before t
    L2  every swing used is confirmed at or before t
    L3  a trendline is built only from confirmed swings
    L4  the line's construction must not depend on data after the entry bar
    L5  no partial HTF candle is ever emitted
    L6  the ATR used for touch tolerance is computed on the HTF series only

No scoring, no weights, no invented selection criteria. The book (p.19)
both claims "more touchpoints, stronger trendline" and warns that a line
hit often is weaker -- the halves conflict, so a touch-count ranking is
not derivable. The extractor returns the set of valid lines; the stop
rule (Phase 4) takes the binding one.
"""
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd

from .support_resistance import calculate_atr
from .trendlines import (
    ConfirmedSwing,
    filter_confirmed_swings,
    find_confirmed_swings,
)
from ..data.loaders import resample_ohlcv, resample_30m_to_1h_session_aligned


@dataclass
class BroaderTrendline:
    """
    A candidate broader trendline expressed on the HTF bar axis.

    ``slope`` is per HTF bar; ``intercept`` is the price at HTF index 0.
    ``price_at`` maps an entry timestamp onto the HTF axis so the caller
    never does index arithmetic (design doc section 6).
    """
    type: str            # 'SUPPORT' or 'RESISTANCE'
    slope: float         # price change per HTF bar
    intercept: float     # price at htf index 0
    start_idx: int       # first HTF bar index used
    end_idx: int         # second HTF bar index used
    touches: int         # touch count (informational, NOT a score)
    # Evaluation anchor: timestamp of the last completed HTF candle at the
    # decision time, and the HTF bar duration in the same units.
    anchor_index: int
    anchor_timestamp: pd.Timestamp
    htf_bar_delta: pd.Timedelta

    def price_at(self, entry_timestamp: pd.Timestamp) -> float:
        """
        Evaluate the line at an entry timestamp.

        Mapping rule (design doc section 6): the line's price at the last
        completed HTF bar, extrapolated along the line's own slope by the
        fraction of an HTF period between that bar's close and the entry
        timestamp:

            price = intercept + slope * (anchor_index + (entry_ts -
                    anchor_close_time) / htf_bar_delta)

        ``anchor_timestamp`` is the OPEN time of the anchor HTF bar; its
        close time is ``anchor_timestamp + htf_bar_delta``.
        """
        anchor_close = self.anchor_timestamp + self.htf_bar_delta
        frac = (entry_timestamp - anchor_close) / self.htf_bar_delta
        return self.intercept + self.slope * (self.anchor_index + frac)


@dataclass
class MtfTrendlineResult:
    """Extractor output: the set of valid lines plus diagnostics."""
    trendlines: List[BroaderTrendline]
    # Diagnostics (design doc section 7): how the extraction behaved, so a
    # silent dependence on dataset length is measurable rather than hidden.
    n_htf_candles: int          # completed HTF candles available
    n_swing_highs: int          # confirmed swings used
    n_swing_lows: int
    last_htf_close: Optional[pd.Timestamp]  # close time of the last HTF candle


def _timeframe_to_offset(timeframe: str) -> pd.Timedelta:
    """Convert a timeframe string to a Timedelta."""
    m = {
        '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
        '1h': '1h', '4h': '4h', '1d': '1D', '1w': '7D',
    }
    return pd.Timedelta(m.get(timeframe, timeframe))


def extract_broader_trendlines(
    entry_df: pd.DataFrame,
    htf_timeframe: str,
    as_of_index: Optional[int] = None,
    swing_left_bars: Optional[int] = None,
    swing_right_bars: Optional[int] = None,
    tolerance_atr: Optional[float] = None,
    min_touches: Optional[int] = None,
    entry_timeframe: Optional[str] = None,  # Optional: entry timeframe to select correct resampler
) -> MtfTrendlineResult:
    """
    Extract the set of valid broader trendlines for a decision at
    ``as_of_index`` on the entry time frame.

    Args:
        entry_df: Entry-timeframe OHLCV DataFrame with a DatetimeIndex.
            May contain bars AFTER the decision bar; they are ignored for
            the HTF series (invariant L1) -- the HTF series is built only
            from bars up to the decision bar.
        htf_timeframe: The broader time frame (e.g. '4h'). Read from the
            spec's MTF_TIMEFRAME_HIERARCHY by the caller; this function
            does not hard-code a mapping.
        as_of_index: Entry-frame bar index of the decision. Defaults to
            the last bar of ``entry_df``.
        swing_left_bars / swing_right_bars: Swing parameters. Per the
            spec's HTF_SWING_PARAMS = reuse_entry_timeframe policy, the
            caller passes the same values used on the entry time frame.
        tolerance_atr: Touch tolerance as an ATR multiple
            (TRENDLINE_TOLERANCE_ATR).
        min_touches: Minimum touches for a valid line
            (TRENDLINE_MIN_TOUCHES).
        entry_timeframe: Optional entry timeframe (e.g., '30m'). Used to
            select NSE-specific session-aware resampling for 30m→1h.

    Returns:
        MtfTrendlineResult with the (unsorted, unordered) set of valid
        lines. Empty list if no valid line exists -- the caller applies
        HTF_TRENDLINE_MISSING_BEHAVIOUR; this function never falls back.
    """
    if as_of_index is None:
        as_of_index = len(entry_df) - 1
    if as_of_index < 0 or as_of_index >= len(entry_df):
        raise ValueError(f"as_of_index {as_of_index} out of range")

    # Spec defaults (T20 drift guard): these values are configurable in
    # strategy_spec.json, so the defaults here must follow the spec, with a
    # literal fallback when the spec is unavailable.
    if None in (swing_left_bars, swing_right_bars, tolerance_atr, min_touches):
        from ..strategies.strategy_spec import param
        try:
            if swing_left_bars is None:
                swing_left_bars = int(param('SWING_LEFT_BARS'))
            if swing_right_bars is None:
                swing_right_bars = int(param('SWING_RIGHT_BARS'))
            if tolerance_atr is None:
                tolerance_atr = float(param('TRENDLINE_TOLERANCE_ATR'))
            if min_touches is None:
                min_touches = int(param('TRENDLINE_MIN_TOUCHES'))
        except Exception:
            swing_left_bars = swing_left_bars if swing_left_bars is not None else 3
            swing_right_bars = swing_right_bars if swing_right_bars is not None else 3
            tolerance_atr = tolerance_atr if tolerance_atr is not None else 0.3
            min_touches = min_touches if min_touches is not None else 2

    # --- (1) HTF series: only bars up to the decision bar (L1), and only
    # completed HTF candles (L5, via resample_ohlcv's drop_forming_bar).
    history = entry_df.iloc[:as_of_index + 1]

    # Use NSE-specific session-aware resampler for 30m entry -> 1h HTF
    is_nse_30m_to_1h = entry_timeframe == '30m' and htf_timeframe == '1h'
    if is_nse_30m_to_1h:
        htf = resample_30m_to_1h_session_aligned(history)
    else:
        htf = resample_ohlcv(history, htf_timeframe, drop_forming_bar=True)

    n_htf = len(htf)
    if n_htf == 0:
        return MtfTrendlineResult(
            trendlines=[], n_htf_candles=0, n_swing_highs=0,
            n_swing_lows=0, last_htf_close=None,
        )

    htf_delta = _timeframe_to_offset(htf_timeframe)
    last_htf_close = htf.index[-1] + htf_delta

    # --- (2) confirmed swings on the HTF series (L2, L3).
    highs, lows = find_confirmed_swings(
        htf, left_bars=swing_left_bars, right_bars=swing_right_bars
    )
    # A swing is usable only if confirmed by the last completed HTF candle.
    # find_confirmed_swings already guarantees confirmed_at <= len-1, so
    # this filter is a no-op here -- but it is applied explicitly so the
    # invariant is enforced by construction, not by convention.
    as_of_htf = n_htf - 1
    highs = filter_confirmed_swings(highs, as_of_htf)
    lows = filter_confirmed_swings(lows, as_of_htf)

    # --- (3) candidate lines from same-type swing pairs, filtered by
    # touches. ATR computed on the HTF series only (L6).
    atr = calculate_atr(htf)
    tol_price = atr * tolerance_atr

    def build(swings: List[ConfirmedSwing], line_type: str) -> List[BroaderTrendline]:
        # Vectorized build: the pair loop stays O(S^2), but each pair's touch
        # scan is a single NumPy pass over the swing arrays instead of an
        # inner Python loop (was O(S^3)). Results are identical: the i/j
        # anchors are exact hits, so the vectorized count (`<= tol_price`)
        # includes them exactly like the old `touches = 2` base.
        out: List[BroaderTrendline] = []
        inds = np.array([s.index for s in swings], dtype=float)
        prices = np.array([s.price for s in swings], dtype=float)
        for i in range(len(swings) - 1):
            for j in range(i + 1, len(swings)):
                s1, s2 = swings[i], swings[j]
                denom = inds[j] - inds[i]
                if denom == 0:
                    continue
                slope = (prices[j] - prices[i]) / denom
                intercept = prices[i] - slope * inds[i]
                expected = intercept + slope * inds
                close_enough = np.abs(prices - expected) <= tol_price
                n_hits = int(close_enough.sum())
                # The two anchors are always touches (the old loop started at
                # `touches = 2`); float round-trip can fail the tolerance for
                # them, so force-count them to keep the value identical.
                if not close_enough[i]:
                    n_hits += 1
                if not close_enough[j]:
                    n_hits += 1
                if n_hits >= min_touches:
                    out.append(BroaderTrendline(
                        type=line_type,
                        slope=slope,
                        intercept=intercept,
                        start_idx=s1.index,
                        end_idx=s2.index,
                        touches=n_hits,
                        anchor_index=as_of_htf,
                        anchor_timestamp=htf.index[-1],
                        htf_bar_delta=htf_delta,
                    ))
        return out

    support = build(lows, 'SUPPORT')
    resistance = build(highs, 'RESISTANCE')

    return MtfTrendlineResult(
        trendlines=support + resistance,
        n_htf_candles=n_htf,
        n_swing_highs=len(highs),
        n_swing_lows=len(lows),
        last_htf_close=last_htf_close,
    )
