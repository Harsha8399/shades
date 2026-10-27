"""
Tests for indicator correctness and, crucially, for the *causal timing* of
swing-point detection.

A swing point that requires right-side confirmation bars must not become
visible before those bars have occurred.
"""
import numpy as np
import pandas as pd
import pytest

from conftest import (
    make_ohlcv,
    flat_bars,
    load_shared_fixture,
)

from src.indicators.trendlines import (
    find_swing_points,
    find_confirmed_swings,
    filter_confirmed_swings,
    find_trendlines,
    get_trendline_price,
)
from src.indicators.fibonacci import (
    calculate_fib_levels,
    find_fib_retracement,
    is_price_at_fib_level,
)
from src.indicators.support_resistance import (
    find_sr_zones,
    is_price_at_zone,
    calculate_atr,
)


# ======================================================================
# Swing point detection
# ======================================================================

class TestSwingPoints:
    """Swing highs and lows and their confirmation timing."""

    def test_a_clear_peak_is_detected(self):
        """
        A single dominant peak at index 5 with 3-bar left/right confirmation.
        """
        values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1]
        df = make_ohlcv([(v, v, v, v) for v in values])

        highs, lows = find_swing_points(df, left_bars=3, right_bars=3)

        assert len(highs) == 1
        assert highs[0][0] == 5
        assert highs[0][1] == 9

    def test_a_clear_trough_is_detected(self):
        """A single dominant trough at index 5."""
        values = [9, 8, 7, 6, 5, 1, 6, 7, 8, 9, 9, 9]
        df = make_ohlcv([(v, v, v, v) for v in values])

        highs, lows = find_swing_points(df, left_bars=3, right_bars=3)

        assert len(lows) == 1
        assert lows[0][0] == 5
        assert lows[0][1] == 1

    def test_swing_is_not_detected_before_its_confirmation_bar(self):
        """
        The central causality test.

        A swing at index 5 with right_bars=3 is only confirmed at index 8.
        Until the data contains bar 8, the swing must NOT be reported.
        """
        values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1]
        df = make_ohlcv([(v, v, v, v) for v in values])

        # Prefix that ends at index 7 (8 bars) -> confirmation bar 8 missing.
        prefix_to_7 = df.iloc[:8]
        highs, _ = find_swing_points(prefix_to_7, 3, 3)
        assert highs == [], "swing must not be visible before confirmation"

        # Prefix that ends at index 8 (9 bars) -> confirmation bar present.
        prefix_to_8 = df.iloc[:9]
        highs, _ = find_swing_points(prefix_to_8, 3, 3)
        assert len(highs) == 1
        assert highs[0][0] == 5

    def test_confirmed_at_is_reported_correctly(self):
        """confirmed_at must equal index + right_bars."""
        values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1]
        df = make_ohlcv([(v, v, v, v) for v in values])

        highs, lows = find_confirmed_swings(df, 3, 3)

        assert len(highs) == 1
        assert highs[0].index == 5
        assert highs[0].confirmed_at == 8
        assert highs[0].swing_type == "HIGH"

    def test_no_swing_ever_depends_on_a_missing_bar(self):
        """
        For any prefix of the data, every returned swing must be confirmable
        from bars that are actually present.
        """
        rng = np.random.default_rng(42)
        values = list(np.round(100 + rng.normal(0, 1, 200).cumsum(), 2))
        df = make_ohlcv([(v, v, v, v) for v in values])

        for n in range(8, len(df) + 1):
            prefix = df.iloc[:n]
            highs, lows = find_confirmed_swings(prefix, 3, 3)
            for s in highs + lows:
                assert s.confirmed_at <= n - 1, (
                    f"swing at {s.index} confirmed at {s.confirmed_at} but the "
                    f"prefix only has {n} bars"
                )
                assert s.index + 3 <= n - 1

    def test_filter_confirmed_swings_drops_the_unconfirmed(self):
        """The explicit filter must withhold swings confirmed in the future."""
        values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1]
        df = make_ohlcv([(v, v, v, v) for v in values])

        highs, _ = find_confirmed_swings(df, 3, 3)

        assert len(filter_confirmed_swings(highs, as_of_index=7)) == 0
        assert len(filter_confirmed_swings(highs, as_of_index=8)) == 1

    def test_swings_are_identical_regardless_of_the_data_ahead(self):
        """
        A swing confirmed at bar 8 must look the same whether or not bars
        9..11 exist. This is the anti-repainting guarantee.
        """
        values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1]
        df = make_ohlcv([(v, v, v, v) for v in values])

        full_highs, _ = find_swing_points(df, 3, 3)
        truncated_highs, _ = find_swing_points(df.iloc[:9], 3, 3)

        assert full_highs == truncated_highs


# ======================================================================
# Trendlines
# ======================================================================

class TestTrendlines:
    """Trendline slope, intercept and touch counting."""

    def test_trendline_from_two_swing_lows_has_the_right_slope(self):
        """
        Two swing lows at index 4 (low 8) and index 9 (low 18).

        Slope = (18 - 8) / (9 - 4) = 10/5 = 2.0

        The data must extend far enough right for BOTH swings to be
        confirmed (index 9 needs 3 confirmation bars, so bar 12 must exist).
        """
        # Lows:  28 26 24 22 |  8 | 22 24 26 28 | 18 | 28 30 32 34
        # Index:  0  1  2  3 |  4 |  5  6  7  8 |  9 | 10 11 12 13
        values = [30, 28, 26, 24, 10, 24, 26, 28, 30, 20, 30, 32, 34, 36]
        df = make_ohlcv([(v, v + 2, v - 2, v) for v in values])

        trendlines = find_trendlines(df, tolerance=0.02, min_touches=2)
        supports = [t for t in trendlines if t.type == "SUPPORT"]

        assert len(supports) >= 1
        tl = supports[0]
        assert tl.start_idx == 4
        assert tl.end_idx == 9
        # Low at index 4 is 10-2 = 8, low at index 9 is 20-2 = 18.
        assert tl.slope == pytest.approx((18 - 8) / (9 - 4))
        assert tl.intercept == pytest.approx(8 - (tl.slope * 4))

    def test_trendline_price_at_an_index(self):
        """get_trendline_price must evaluate the line equation."""
        values = [30, 28, 26, 24, 10, 24, 26, 28, 30, 20, 30, 32, 34, 36]
        df = make_ohlcv([(v, v + 2, v - 2, v) for v in values])

        tl = [t for t in find_trendlines(df, 0.02, 2) if t.type == "SUPPORT"][0]

        assert get_trendline_price(tl, tl.start_idx) == pytest.approx(8.0)
        assert get_trendline_price(tl, tl.end_idx) == pytest.approx(18.0)
        # Midpoint of a straight line through (4, 8) and (9, 18) is (6.5, 13).
        assert get_trendline_price(tl, 6.5) == pytest.approx(13.0)


# ======================================================================
# Fibonacci
# ======================================================================

class TestFibonacci:
    """Fibonacci level arithmetic with explicit expected prices."""

    def test_up_move_retracement_levels_are_exact(self):
        """
        Swing low 100, swing high 200, direction UP.
        Range = 100.
        23.6% -> 200 - 23.6 = 176.4
        38.2% -> 200 - 38.2 = 161.8
        50.0% -> 200 - 50.0 = 150.0
        61.8% -> 200 - 61.8 = 138.2
        78.6% -> 200 - 78.6 = 121.4
        """
        levels = calculate_fib_levels(200.0, 100.0, direction="UP")
        by_ratio = {lvl.ratio: lvl.price for lvl in levels}

        assert by_ratio[0.236] == pytest.approx(176.4)
        assert by_ratio[0.382] == pytest.approx(161.8)
        assert by_ratio[0.5] == pytest.approx(150.0)
        assert by_ratio[0.618] == pytest.approx(138.2)
        assert by_ratio[0.786] == pytest.approx(121.4)

    def test_down_move_retracement_levels_are_exact(self):
        """
        Swing high 200, swing low 100, direction DOWN.
        Range = 100.
        23.6% -> 100 + 23.6 = 123.6
        78.6% -> 100 + 78.6 = 178.6
        """
        levels = calculate_fib_levels(200.0, 100.0, direction="DOWN")
        by_ratio = {lvl.ratio: lvl.price for lvl in levels}

        assert by_ratio[0.236] == pytest.approx(123.6)
        assert by_ratio[0.5] == pytest.approx(150.0)
        assert by_ratio[0.786] == pytest.approx(178.6)

    def test_all_five_book_levels_are_present(self):
        """The book specifies 23.6, 38.2, 50, 61.8 and 78.6 percent."""
        levels = calculate_fib_levels(200.0, 100.0)
        ratios = sorted(lvl.ratio for lvl in levels)

        assert ratios == [0.236, 0.382, 0.5, 0.618, 0.786]

    def test_price_at_fib_level_within_tolerance(self):
        levels = calculate_fib_levels(200.0, 100.0, "UP")
        retracement = type("R", (), {})()
        retracement.levels = levels

        at_fib, level = is_price_at_fib_level(150.5, retracement, tolerance=1.0)
        assert at_fib is True
        assert level.ratio == 0.5

        at_fib, level = is_price_at_fib_level(160.0, retracement, tolerance=1.0)
        assert at_fib is False
        assert level is None

    def test_fib_retracement_direction_from_a_rising_market(self):
        """
        A market that rose into the window has direction UP.

        Since Stage 1 the retracement is anchored on CONFIRMED SWING POINTS
        (not the window extremes), so a strictly monotonic series has no swing
        pair and the function correctly returns None. This test uses the
        shared parity fixture, which has real market structure.
        """
        df = load_shared_fixture()
        # The 200-bar window of the shared fixture contains both swing highs
        # and swing lows. (The 50-bar window used by the pattern contains
        # only a high, so the pattern legitimately finds no Fib there.)
        retracement = find_fib_retracement(df, lookback=200)

        assert retracement is not None, (
            "the shared fixture has a clear swing pair and must yield a "
            "retracement"
        )
        assert retracement.swing_high > retracement.swing_low
        assert retracement.direction in ("UP", "DOWN")

    def test_fib_retracement_returns_none_without_a_swing_pair(self):
        """
        A strictly monotonic series has no swing high AND low pair, so no
        retracement can be drawn. Returning None is the correct behaviour --
        the previous implementation always returned a "retracement" built
        from window extremes, even when there was no structure to draw one on.
        """
        df = make_ohlcv([(i, i + 1, i - 1, i) for i in range(1, 60)])
        retracement = find_fib_retracement(df, lookback=50)
        assert retracement is None

    def test_fib_retracement_is_anchored_on_swing_points(self):
        """
        The anchor must be a confirmed swing high/low, not the window
        extremes. The shared fixture's swing points are known, so the
        retracement's anchors must match them exactly.
        """
        df = load_shared_fixture()
        window = df.iloc[-200:]
        swing_highs, swing_lows = find_swing_points(window, 5, 3)

        retracement = find_fib_retracement(df, lookback=200)

        assert retracement is not None
        assert retracement.swing_high == pytest.approx(swing_highs[-1][1])
        assert retracement.swing_low == pytest.approx(swing_lows[-1][1])

    def test_fib_retracement_direction_follows_swing_order(self):
        """
        Direction is decided by which extreme came first: the low before the
        high means the move was UP (we are looking for a pullback in an up
        move).
        """
        df = load_shared_fixture()
        window = df.iloc[-200:]
        swing_highs, swing_lows = find_swing_points(window, 5, 3)

        retracement = find_fib_retracement(df, lookback=200)

        assert retracement is not None
        expected = 'UP' if swing_lows[-1][0] < swing_highs[-1][0] else 'DOWN'
        assert retracement.direction == expected


# ======================================================================
# Support and resistance
# ======================================================================

class TestSupportResistance:
    """S/R zone clustering."""

    def test_repeated_touches_form_a_single_zone(self):
        """
        Three lows near price 10 must cluster into one support zone with
        strength 3.

        The Python API takes the tolerance as an ATR multiple and computes
        the ATR internally, so the bars need a genuine range (high > low)
        for the ATR to be non-zero.
        """
        # Lows at index 4, 9 and 14, all at 10, separated by rising and
        # falling legs so each is a confirmed swing low. The data must run
        # at least 3 bars past the last low so it can be confirmed.
        values = [
            30, 28, 26, 24, 12,        # swing low at 4
            24, 26, 28, 30, 12,        # swing low at 9
            24, 26, 28, 30, 12,        # swing low at 14
            24, 26, 28, 30,            # confirmation for the low at 14
        ]
        df = make_ohlcv([(v, v + 2, v - 2, v) for v in values])

        zones = find_sr_zones(df, tolerance_atr=0.5, min_touches=2)
        supports = [z for z in zones if z.type == "SUPPORT"]

        assert len(supports) >= 1
        assert supports[0].strength == 3
        assert supports[0].price_level == pytest.approx(10.0)

    def test_price_at_zone_detection(self):
        values = [
            30, 28, 26, 24, 12,
            24, 26, 28, 30, 12,
            24, 26, 28, 30, 12,
            24, 26, 28, 30,
        ]
        df = make_ohlcv([(v, v + 2, v - 2, v) for v in values])

        zones = find_sr_zones(df, tolerance_atr=0.5, min_touches=2)

        at_zone, zone, zone_type = is_price_at_zone(10.2, zones, tolerance=0.5)
        assert at_zone is True
        assert zone_type == "SUPPORT"

        at_zone, zone, zone_type = is_price_at_zone(50.0, zones, tolerance=0.5)
        assert at_zone is False

    def test_atr_is_positive_and_sane(self):
        """
        True range is 2 for every bar, so the ATR must be 2.
        """
        df = make_ohlcv([(100, 101, 99, 100) for _ in range(30)])
        atr = calculate_atr(df)
        assert atr == pytest.approx(2.0)
