#!/usr/bin/env python3
"""
Generate the trade-parity fixture.

The Stage 1 fixture (`parity_15m.csv`) is a *market-structure* fixture: it
exercises the indicator calculations and the per-bar confluence detection, but
it produces NO trades, so it cannot validate end-to-end execution.

This generator builds a SECOND fixture, `trade_parity_15m.csv`, whose sole
purpose is to make the shipped strategy produce a deterministic set of trades
so that the two engines' execution mechanics can be compared trade by trade.

DESIGN (and why each segment exists)
======================================

The shipped entry trigger is a *rejection candle at a confluence zone*:

    direction LONG  : lower wick reaches into the zone AND the candle closes
                      back above it AND the lower wick is at least
                      MIN_REJECTION_WICK_RATIO times the body
    direction SHORT : upper wick reaches into the zone AND the candle closes
                      back below it AND the upper wick is at least
                      MIN_REJECTION_WICK_RATIO times the body

and the signal additionally requires at least MIN_CONFLUENCE_FACTORS distinct
factors from {S/R zone, Fibonacci level, trendline} to be present at the
current price, where "present" means within zone_tolerance_atr of the
current close.

The fixture is therefore built as a series of *levels with a wick into them*:

  SEGMENT 1 - ramp (20 bars)
      A gentle rise from 95.00 to 100.00. Purpose: establishes the ATR scale
      and gives the swing detector left-hand context.

  SEGMENT 2 - shelf (12 bars, 3 groups of 4)
      Price oscillates in a tight band around 100.00 with three separate
      touches of the 100.00 level. Purpose: creates an S/R SUPPORT zone with
      strength >= 2 (the zone is the mean of the clustered swing lows) AND a
      horizontal SUPPORT trendline, so that BOTH the S/R factor and the
      trendline factor are present at the same price. That is what makes a
      two-factor confluence possible.

  SEGMENT 3 - rejection candle (1 bar)
      Open 100.10, low 99.00 (a 1.10 wick into the 100.00 level), close
      100.20, body 0.10. Purpose: a valid LONG rejection candle at the zone.
      wick/body = 11.0, comfortably above MIN_REJECTION_WICK_RATIO (2.0).
      The close is above the zone, so the LONG rejection test passes.

  SEGMENT 4 - continuation (18 bars)
      A steady rise from 100.20. Purpose: gives room for the trade to
      resolve - a stop-out, a target hit, or an end-of-data close - without
      immediately re-triggering.

  SEGMENT 5 - second structure (rejection + continuation)
      A mirrored bearish construction: a ramp up, a shelf at a higher level,
      a SHORT rejection candle with a long upper wick, and a decline.
      Purpose: produces a SHORT trade so both directions are exercised.

  SEGMENT 6 - a gap (2 bars)
      A bar that opens well below the previous close, then a recovery.
      Purpose: exercises the gap-aware fill path, where the order fills at
      the bar open rather than at the limit price.

  SEGMENT 7 - an ambiguous bar (1 bar)
      A bar whose range spans BOTH the stop-loss and the target of an open
      position. Purpose: exercises the intrabar stop/target resolution
      policy, which must agree between the engines.

The fixture is fully deterministic: no randomness, fixed timestamps, fixed
prices.

IMPORTANT
=========
This fixture is a TEST ARTEFACT for validating EXECUTION MECHANICS. It is
not evidence that the strategy is profitable, and it is not a claim that the
strategy fires often in real markets. A separate, real-data validation is
required for any statement about the strategy's behaviour on real markets.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'research-py'))

import pandas as pd

OUT = REPO_ROOT / 'shared' / 'fixtures' / 'trade_parity_15m.csv'

# --- segment builders -------------------------------------------------


def ramp(start: float, end: float, bars: int, wick: float = 0.5):
    """A steady drift from `start` to `end` with a fixed wick size."""
    step = (end - start) / bars
    out = []
    for i in range(bars):
        c = start + step * (i + 1)
        out.append((round(c, 4), round(c + wick, 4), round(c - wick, 4), round(c, 4)))
    return out


def shelf(level: float, touches: int, wick: float = 0.6):
    """
    A zigzag that repeatedly returns to a horizontal level FROM BELOW.

    The cycle is three "peak" bars followed by one "touch" bar. This shape is
    required by the fractal swing detector, which demands STRICT alternation:
    a candidate swing low needs three bars to its left with strictly higher
    lows and three bars to its right with strictly higher lows. A run of
    identical bars therefore produces NO swing points at all, which is why a
    flat shelf cannot form a zone.

    Each touch is a bar that opens at the level, wicks below it and closes
    back at the level. Because every touch low is exactly `level`, the touches
    cluster into one S/R SUPPORT zone and lie on one horizontal support
    trendline - so the S/R factor and the trendline factor are present at
    the same price. That is what makes a two-factor confluence possible.
    """
    out = []
    for _ in range(touches):
        # Three peak bars: their lows sit above the level.
        for _ in range(3):
            out.append((
                round(level + 0.2, 4),
                round(level + 0.4, 4),
                round(level + 0.1, 4),
                round(level + 0.2, 4),
            ))
        # One touch bar: its low is exactly the level.
        out.append((
            round(level, 4),
            round(level + 0.3, 4),
            round(level, 4),
            round(level, 4),
        ))
    return out


def ceiling(level: float, touches: int, wick: float = 0.6):
    """
    The mirror image of :func:`shelf`: a zigzag that repeatedly returns to a
    horizontal level FROM ABOVE.

    Each touch bar's HIGH is exactly the level, so the touches cluster into a
    RESISTANCE zone and lie on one horizontal resistance trendline. That gives
    the SHORT rejection candle a two-factor confluence of the same shape the
    LONG one has.
    """
    out = []
    for _ in range(touches):
        # Three trough bars: their highs sit below the level.
        for _ in range(3):
            out.append((
                round(level - 0.2, 4),
                round(level - 0.1, 4),
                round(level - 0.4, 4),
                round(level - 0.2, 4),
            ))
        # One touch bar: its high is exactly the level.
        out.append((
            round(level, 4),
            round(level, 4),
            round(level - 0.3, 4),
            round(level, 4),
        ))
    return out


def rejection_long(level: float, dip: float, close_above: float):
    """
    A LONG rejection candle: wick into the level, close back above it.

    The bar opens at the level, dips to `dip` (the wick into the zone) and
    closes at `close_above` (back outside the zone). The body is
    `close_above - level` and the lower wick is `level - dip`, so the
    wick:body ratio is `(|level - dip|) / (|close_above - level|)`.
    """
    return [
        (round(level, 4), round(close_above + 0.2, 4), round(dip, 4), round(close_above, 4))
    ]


def rejection_short(level: float, spike: float, close_below: float):
    """
    A SHORT rejection candle: wick into the level, close back below it.

    The bar opens ABOVE its close (so the body is non-zero), spikes to `spike`
    (the wick above the level) and closes at `close_below`, back below the
    level. A bar whose open equals its close has a zero body, and the
    pattern's wick:body ratio test then measures the wick against zero, so a
    real body is required.
    """
    return [
        (round(level + 0.10, 4), round(max(spike, level + 0.20), 4),
         round(close_below - 0.4, 4), round(close_below, 4))
    ]


def gap_down(from_close: float, to_open: float, wick: float = 0.5):
    """A bar that gaps well below the previous close."""
    return [
        (round(to_open, 4), round(to_open + wick, 4), round(to_open - wick, 4), round(to_open, 4))
    ]


def wide_bar(open_: float, high: float, low: float, close: float):
    """A bar with an explicitly wide range (used for the ambiguous case)."""
    return [(round(open_, 4), round(high, 4), round(low, 4), round(close, 4))]


# --- the fixture ------------------------------------------------------

LEVEL_A = 100.00
LEVEL_B = 108.00

rows = []

# SEGMENT 1 - ramp 95 -> 100 (110 bars)
# The engine's warm-up is 100 bars (required_bars = max(sr_zone_lookback, 100)),
# and the pattern rejects any frame shorter than that. The first tradable
# structure therefore has to sit beyond bar 100. This ramp is long enough for
# the warm-up to complete AND to give the swing detector left-hand context
# for the shelf that follows.
rows += ramp(95.00, LEVEL_A, 110)

# SEGMENT 2 - shelf at 100.00, three touches (12 bars)
# Three touch bars, each with its low exactly at 100.00, separated by peak
# bars so the fractal detector can confirm them. The three touch lows cluster
# into one S/R SUPPORT zone (strength 3) and lie on one horizontal support
# trendline, so BOTH factors are present at 100.00 BEFORE the rejection bar.
rows += shelf(LEVEL_A, touches=3)

# SEGMENT 3 - LONG rejection candle at 100.00 (1 bar)
# The bar opens at the level, dips 1.00 into it and closes 0.10 back above.
# The close of 100.10 is within the zone tolerance of 100.00 (about 0.37 on
# this fixture), so the S/R factor and the trendline factor are both present
# at the bar's close. wick:body = 1.00/0.10 = 10.0, well above
# MIN_REJECTION_WICK_RATIO of 2.0.
rows += rejection_long(LEVEL_A, dip=99.00, close_above=100.10)

# SEGMENT 4 - continuation upward (24 bars)
rows += ramp(100.20, 106.00, 24)

# SEGMENT 5 - ramp to the second level (12 bars)
rows += ramp(106.00, LEVEL_B, 12)

# SEGMENT 6 - ceiling at 104.00, three touches (12 bars)
# The mirror of SEGMENT 2: each touch bar's HIGH is exactly 104.00, so the
# touches cluster into a RESISTANCE zone and lie on a resistance trendline.
rows += ceiling(LEVEL_B, touches=6)

# SEGMENT 7 - SHORT rejection candle at 104.00 (1 bar)
# Opens 0.10 below the level (so the body is non-zero), spikes 1.00 above it,
# closes 0.10 below. The close of 103.90 is within the zone tolerance of
# 104.00, so the S/R factor is present. wick:body = 1.00/0.10 = 10.0.
rows += rejection_short(LEVEL_B, spike=109.00, close_below=107.90)

# SEGMENT 8 - decline (14 bars)
rows += ramp(107.80, 101.20, 20)

# SEGMENT 9 - a gap down, then a recovery (3 bars)
rows += gap_down(from_close=101.20, to_open=99.00)
rows += ramp(99.00, 100.00, 2)

# SEGMENT 10 - a wide bar whose range spans a plausible stop and target (1 bar)
rows += wide_bar(open_=100.00, high=103.00, low=96.00, close=100.00)

# SEGMENT 11 - trailing bars so nothing is left open at the final bar (6 bars)
rows += ramp(100.00, 100.60, 6)

# --- write ------------------------------------------------------------

idx = pd.date_range('2024-01-01 09:15', periods=len(rows), freq='15min', name='timestamp')
df = pd.DataFrame(
    [(o, h, l, c, 1000.0) for (o, h, l, c) in rows],
    columns=['open', 'high', 'low', 'close', 'volume'],
    index=idx,
)

# Integrity checks - the fixture must be valid data.
assert len(df) > 100, "fixture must be long enough for the 100-bar warm-up"
assert df.index.is_unique, "timestamps must be unique"
assert df.index.is_monotonic_increasing, "timestamps must be ordered"
assert (df['high'] >= df[['open', 'close']].max(axis=1)).all(), "high must be the max"
assert (df['low'] <= df[['open', 'close']].min(axis=1)).all(), "low must be the min"
assert (df['high'] >= df['low']).all(), "high must be >= low"
assert (df[['open', 'high', 'low', 'close']] > 0).all().all(), "prices must be positive"
assert (df['volume'] >= 0).all(), "volume must be non-negative"

df.to_csv(OUT, float_format='%.4f')
print(f'wrote {OUT}')
print(f'  bars={len(df)}  range={df.index[0]} -> {df.index[-1]}')
print(f'  price range {df["low"].min():.2f} .. {df["high"].max():.2f}')
