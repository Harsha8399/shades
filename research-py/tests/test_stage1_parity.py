"""
Stage 1 cross-engine parity tests (Python side).

These assert that the Python engine produces EXACTLY the values listed in
``shared/fixtures/parity_expected.json``, which is the same file the
TypeScript suite asserts against. Neither engine can drift from the other
without a test failure.

Decisions: ``research-py/docs/STAGE1_PARITY_DECISIONS.md``
"""
import json
from pathlib import Path

import pytest

from conftest import load_shared_fixture

from src.indicators.support_resistance import calculate_atr, find_sr_zones
from src.indicators.fibonacci import find_fib_retracement
from src.indicators.trendlines import find_trendlines, find_swing_points

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXPECTED_PATH = REPO_ROOT / 'shared' / 'fixtures' / 'parity_expected.json'

SR_LOOKBACK = 100
FIB_LOOKBACK = 50
TRENDLINE_TOLERANCE_ATR = 0.3


@pytest.fixture(scope="module")
def expected():
    assert EXPECTED_PATH.exists(), (
        f"shared expectations missing: {EXPECTED_PATH}. "
        f"Regenerate with: python scripts/gen_parity_expected.py"
    )
    return json.loads(EXPECTED_PATH.read_text())


@pytest.fixture(scope="module")
def df():
    return load_shared_fixture()


@pytest.fixture(scope="module")
def atr(df):
    return calculate_atr(df)


class TestStage1Parity:
    """The Python engine must match the shared expected values exactly."""

    def test_row_count(self, df, expected):
        assert len(df) == expected['row_count']

    def test_atr_uses_wilders_smoothing(self, df, expected, atr):
        """D1: ATR must be Wilder's smoothing, matching the TS engine."""
        assert round(float(atr), 10) == pytest.approx(expected['atr'], abs=1e-9)

    def test_swing_highs(self, df, expected):
        """D2: swing detection was already identical; it must stay so."""
        swing_highs, _ = find_swing_points(df, 3, 3)
        got = [[int(i), round(float(p), 6)] for i, p in swing_highs]
        assert got == expected['swing_highs']

    def test_swing_lows(self, df, expected):
        """D2."""
        _, swing_lows = find_swing_points(df, 3, 3)
        got = [[int(i), round(float(p), 6)] for i, p in swing_lows]
        assert got == expected['swing_lows']

    def test_sr_zones(self, df, expected, atr):
        """D3: identical zone levels and touch counts."""
        zones = find_sr_zones(
            df.iloc[-SR_LOOKBACK:], tolerance_atr=0.5, min_touches=2, atr=atr
        )
        got = [
            {
                'type': z.type,
                'price_level': round(float(z.price_level), 6),
                'strength': int(z.strength),
            }
            for z in zones
        ]
        assert got == expected['sr_zones']

    def test_fibonacci_retracement(self, df, expected):
        """D4: anchored on confirmed swing points, not window extremes."""
        fib = find_fib_retracement(df, lookback=FIB_LOOKBACK)

        if expected['fib'] is None:
            assert fib is None
            return

        assert fib is not None
        assert round(float(fib.swing_high), 6) == pytest.approx(
            expected['fib']['swing_high'], abs=1e-6
        )
        assert round(float(fib.swing_low), 6) == pytest.approx(
            expected['fib']['swing_low'], abs=1e-6
        )
        assert fib.direction == expected['fib']['direction']

        got_levels = [
            {'ratio': round(float(l.ratio), 6), 'price': round(float(l.price), 6)}
            for l in fib.levels
        ]
        assert got_levels == expected['fib']['levels']

    def test_trendlines(self, df, expected, atr):
        """D5: ATR-multiple tolerance, identical set of trendlines."""
        trendlines = find_trendlines(
            df, tolerance=TRENDLINE_TOLERANCE_ATR, min_touches=2, atr=atr
        )
        got = [
            {
                'type': t.type,
                'slope': round(float(t.slope), 10),
                'intercept': round(float(t.intercept), 10),
                'start_idx': int(t.start_idx),
                'end_idx': int(t.end_idx),
                'touches': int(t.touches),
            }
            for t in trendlines
        ]

        def key(t):
            return (
                f"{t['type']}|{t['slope']}|{t['intercept']}|"
                f"{t['start_idx']}|{t['end_idx']}|{t['touches']}"
            )

        assert sorted(key(t) for t in got) == sorted(
            key(t) for t in expected['trendlines']
        )

    def test_determinism(self, df, expected, atr):
        """Repeated runs must produce identical results."""
        first = find_sr_zones(
            df.iloc[-SR_LOOKBACK:], tolerance_atr=0.5, min_touches=2, atr=atr
        )
        second = find_sr_zones(
            df.iloc[-SR_LOOKBACK:], tolerance_atr=0.5, min_touches=2, atr=atr
        )
        assert [z.price_level for z in first] == [z.price_level for z in second]
