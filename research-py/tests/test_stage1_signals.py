"""
Stage 1 signal-level parity test (Python side).

Compares the per-bar confluence factor set produced by the Python engine
against ``shared/fixtures/parity_signals.json``, which the TypeScript suite
asserts against as well.

This is the strongest parity assertion available: it compares the actual
strategy decision (which confluence factors are present on which bar), not
just intermediate indicator values.

Decisions: ``research-py/docs/STAGE1_PARITY_DECISIONS.md``
"""
import json
from pathlib import Path

import pytest

from conftest import load_shared_fixture

from src.indicators.support_resistance import (
    calculate_atr,
    find_sr_zones,
    is_price_at_zone,
)
from src.indicators.fibonacci import find_fib_retracement, is_price_at_fib_level
from src.indicators.trendlines import find_trendlines, get_trendline_price

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXPECTED_PATH = REPO_ROOT / 'shared' / 'fixtures' / 'parity_signals.json'

SR_LOOKBACK = 100
FIB_LOOKBACK = 50
TRENDLINE_TOLERANCE_ATR = 0.3
ZONE_TOLERANCE_ATR = 0.5


def compute_confluence_bars(df) -> list:
    """Reproduce the pattern's per-bar confluence detection."""
    rows = []

    for i in range(SR_LOOKBACK, len(df)):
        window = df.iloc[max(0, i - SR_LOOKBACK):i]
        if len(window) < 50:
            continue

        # The pattern computes the ATR over the full decision window.
        atr = calculate_atr(df.iloc[:i])
        tol = atr * ZONE_TOLERANCE_ATR
        price = window.iloc[-1]['close']

        factors = []

        zones = find_sr_zones(
            window.iloc[-SR_LOOKBACK:],
            tolerance_atr=ZONE_TOLERANCE_ATR,
            min_touches=2,
            atr=atr,
        )
        at_zone, _zone, zone_type = is_price_at_zone(price, zones, tol)
        if at_zone and zone_type:
            factors.append(f"sr_{zone_type.lower()}")

        fib = find_fib_retracement(window, lookback=FIB_LOOKBACK)
        if fib:
            at_fib, fib_level = is_price_at_fib_level(price, fib, tol)
            if at_fib and fib_level:
                factors.append(f"fib_{int(fib_level.ratio * 1000)}")

        trendlines = find_trendlines(
            window, tolerance=TRENDLINE_TOLERANCE_ATR, min_touches=2, atr=atr
        )
        for tl in trendlines[:3]:
            expected_price = get_trendline_price(tl, len(window) - 1)
            if abs(price - expected_price) <= tol:
                factors.append(f"trendline_{tl.type.lower()}")
                break

        if factors:
            rows.append({
                'bar': i,
                # Same format as the TypeScript dump, so the two files are
                # directly comparable. The fixture's naive timestamps are read
                # as UTC wall clock by both engines.
                'ts': df.index[i].strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                'price': round(float(price), 6),
                'factors': sorted(factors),
            })

    return rows


class TestStage1SignalParity:
    """The Python engine must produce the same confluence signals as TypeScript."""

    def test_confluence_signals_match_the_shared_expectations(self):
        assert EXPECTED_PATH.exists(), (
            f"shared signal expectations missing: {EXPECTED_PATH}. "
            f"Regenerate with: python scripts/gen_parity_signals.py"
        )
        expected = json.loads(EXPECTED_PATH.read_text())

        actual = compute_confluence_bars(load_shared_fixture())

        assert len(actual) == len(expected)
        assert len(actual) > 0

        for got, want in zip(actual, expected):
            assert got['bar'] == want['bar']
            assert got['ts'] == want['ts']
            assert got['price'] == pytest.approx(want['price'], abs=1e-6)
            assert got['factors'] == want['factors']

    def test_at_least_one_multi_factor_confluence_exists(self):
        """The fixture must exercise the multi-factor path, not just single factors."""
        rows = compute_confluence_bars(load_shared_fixture())
        multi = [r for r in rows if len(r['factors']) >= 2]
        assert len(multi) > 0
