"""
Phase 3 tests: multi-timeframe broader-trendline extractor.

Causality invariants from docs/stage3/MTF_TRENDLINE_DESIGN.md section 4:
the decisive test is the PREFIX test -- running the extractor on a prefix
and on the full series must give an identical result at the prefix's last
bar. That single test catches every lookahead path (L1-L6) at once.

No scoring or ranking rules are tested because none exist: the extractor
returns the SET of valid lines.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.indicators.mtf_trendlines import (  # noqa: E402
    BroaderTrendline,
    extract_broader_trendlines,
)


def _make_entry_df(n: int, start: str = "2024-01-01", freq: str = "1h"):
    """Deterministic entry-timeframe candles with a rising-then-falling
    shape that produces swing points on any timeframe."""
    idx = pd.date_range(start, periods=n, freq=freq)
    t = np.arange(n)
    # A sine wave guarantees regular swing highs and lows.
    base = 100 + 10 * np.sin(t / 6.0)
    rows = {
        "open": base,
        "high": base + 1.0,
        "low": base - 1.0,
        "close": base + 0.25,
        "volume": 1000.0,
    }
    return pd.DataFrame(rows, index=idx)


def _line_key(tl: BroaderTrendline):
    """Round a line to a comparable key (float-stable)."""
    return (
        tl.type,
        round(tl.slope, 10),
        round(tl.intercept, 10),
        tl.start_idx,
        tl.end_idx,
        tl.touches,
    )


class TestExtractorBasics:
    def test_returns_lines_from_sufficient_history(self):
        df = _make_entry_df(400)  # 400 hourly bars -> ~16 4h candles
        res = extract_broader_trendlines(df, "4h")
        assert res.n_htf_candles > 0
        # With a sine wave and 2-touch minimum, some lines should exist.
        assert len(res.trendlines) > 0
        for tl in res.trendlines:
            assert tl.type in ("SUPPORT", "RESISTANCE")
            assert tl.touches >= 2

    def test_no_lines_from_short_history(self):
        # Fewer bars than one HTF period -> no HTF candles -> no lines.
        df = _make_entry_df(2)
        res = extract_broader_trendlines(df, "4h")
        assert res.trendlines == []
        assert res.n_htf_candles == 0
        assert res.last_htf_close is None

    def test_no_fallback_on_missing_trendline(self):
        # A flat series has no swings, hence no trendlines. The extractor
        # must return an EMPTY SET -- never a fallback or default line.
        idx = pd.date_range("2024-01-01", periods=200, freq="1h")
        df = pd.DataFrame(
            {"open": 100.0, "high": 100.5, "low": 99.5, "close": 100.0,
             "volume": 1000.0},
            index=idx,
        )
        res = extract_broader_trendlines(df, "4h")
        assert res.trendlines == []
        assert res.n_htf_candles > 0  # HTF candles exist; lines do not

    def test_price_at_evaluation(self):
        df = _make_entry_df(400)
        res = extract_broader_trendlines(df, "4h")
        tl = res.trendlines[0]
        # price_at at the anchor close time must equal the line's value at
        # the anchor index.
        anchor_close = tl.anchor_timestamp + tl.htf_bar_delta
        p = tl.price_at(anchor_close)
        expected = tl.intercept + tl.slope * tl.anchor_index
        assert p == pytest.approx(expected)

        # Extrapolation: one full HTF period later adds exactly one slope.
        p2 = tl.price_at(anchor_close + tl.htf_bar_delta)
        assert p2 == pytest.approx(expected + tl.slope)


class TestExtractorCausality:
    def test_prefix_test_decisive(self):
        """THE decisive test: extractor output at a prefix's last bar must
        be identical whether or not future data is present. Covers L1-L6
        at once."""
        full = _make_entry_df(400)
        htf = "4h"

        full_res = extract_broader_trendlines(full, htf)

        for cut in (100, 200, 300, 380):
            prefix_res = extract_broader_trendlines(
                full.iloc[:cut], htf
            )
            # The full-series extractor must see the same HTF candles for
            # the prefix's decision: its HTF candle count at the prefix's
            # last bar equals the prefix run's count.
            # Compute the full-series result AS OF the prefix's last bar.
            as_of = cut - 1
            full_as_of = extract_broader_trendlines(full, htf, as_of_index=as_of)
            assert full_as_of.n_htf_candles == prefix_res.n_htf_candles
            assert (full_as_of.last_htf_close == prefix_res.last_htf_close)
            assert full_as_of.n_swing_highs == prefix_res.n_swing_highs
            assert full_as_of.n_swing_lows == prefix_res.n_swing_lows
            assert (sorted(map(_line_key, full_as_of.trendlines))
                    == sorted(map(_line_key, prefix_res.trendlines)))

    def test_appending_future_bars_does_not_change_lines(self):
        """L4: appending bars after the decision point must not change the
        line parameters evaluated at that decision."""
        full = _make_entry_df(400)
        k = 250

        as_of_full = extract_broader_trendlines(full, "4h", as_of_index=k)
        prefix = extract_broader_trendlines(full.iloc[:k + 1], "4h")

        assert (sorted(map(_line_key, as_of_full.trendlines))
                == sorted(map(_line_key, prefix.trendlines)))

    def test_no_forming_htf_candle_used(self):
        """L5: the last HTF candle must be complete at the decision bar.
        The extractor's last_htf_close must be <= the decision bar's
        timestamp + one entry bar (the earliest the decision could know)."""
        df = _make_entry_df(400)
        as_of = 250
        res = extract_broader_trendlines(df, "4h", as_of_index=as_of)
        decision_ts = df.index[as_of]
        # The last HTF candle's close must not exceed the decision time
        # plus one entry bar (the decision bar itself closes then).
        assert res.last_htf_close <= decision_ts + pd.Timedelta(hours=1)

    def test_htf_atr_independent_of_entry_bars(self):
        """L6: changing entry-timeframe bars AFTER the decision must not
        change the touch tolerance (ATR is HTF-only)."""
        df = _make_entry_df(400)
        k = 250
        res1 = extract_broader_trendlines(df, "4h", as_of_index=k)

        # Mutate far-future entry bars; the as-of result must not change.
        df2 = df.copy()
        df2.iloc[k + 1:, df2.columns.get_loc("high")] += 50.0
        res2 = extract_broader_trendlines(df2, "4h", as_of_index=k)

        assert (sorted(map(_line_key, res1.trendlines))
                == sorted(map(_line_key, res2.trendlines)))

    def test_as_of_index_validation(self):
        df = _make_entry_df(100)
        with pytest.raises(ValueError):
            extract_broader_trendlines(df, "4h", as_of_index=100)
        with pytest.raises(ValueError):
            extract_broader_trendlines(df, "4h", as_of_index=-1)


class TestSpecDriftGuard:
    """
    T20 drift guard: the extractor's default parameters (and the confluence
    pattern's tolerance constants) must follow strategy_spec.json. These
    values are `configurable: true` there; before this guard, each site
    re-literalized them, so a spec change silently left one engine -- or one
    indicator -- on the old value.
    """

    def test_extractor_defaults_equal_explicit_spec_values(self):
        """Running with no overrides must equal running with the spec values
        passed explicitly: this proves the defaults track the spec."""
        from src.indicators.mtf_trendlines import extract_broader_trendlines
        from src.strategies.strategy_spec import param

        df = _make_entry_df(400)
        base = extract_broader_trendlines(df, "4h")
        explicit = extract_broader_trendlines(
            df,
            "4h",
            swing_left_bars=int(param("SWING_LEFT_BARS")),
            swing_right_bars=int(param("SWING_RIGHT_BARS")),
            tolerance_atr=float(param("TRENDLINE_TOLERANCE_ATR")),
            min_touches=int(param("TRENDLINE_MIN_TOUCHES")),
        )
        assert (sorted(map(_line_key, base.trendlines))
                == sorted(map(_line_key, explicit.trendlines)))

    def test_trendline_helper_defaults_equal_spec_values(self):
        from src.indicators.trendlines import find_trendlines
        from src.strategies.strategy_spec import param

        df = _make_entry_df(300)
        base = find_trendlines(df)
        explicit = find_trendlines(
            df,
            tolerance=float(param("TRENDLINE_TOLERANCE_ATR")),
            min_touches=int(param("TRENDLINE_MIN_TOUCHES")),
        )
        base_keys = sorted((tl.type, tl.start_idx, tl.end_idx, tl.slope, tl.intercept) for tl in base)
        explicit_keys = sorted((tl.type, tl.start_idx, tl.end_idx, tl.slope, tl.intercept) for tl in explicit)
        assert base_keys == explicit_keys

    def test_confluence_constants_match_spec_values(self):
        import inspect
        from pathlib import Path
        import sys as _sys

        from src.patterns.confluence_zone import (
            MIN_TARGET_RR,
            TRENDLINE_TOLERANCE_ATR,
            SR_ZONE_TOLERANCE_ATR,
            SR_MIN_TOUCHES,
            TRENDLINE_MIN_TOUCHES,
        )
        from src.strategies.strategy_spec import param

        assert TRENDLINE_TOLERANCE_ATR == pytest.approx(param("TRENDLINE_TOLERANCE_ATR"))
        assert SR_ZONE_TOLERANCE_ATR == pytest.approx(param("SR_ZONE_TOLERANCE_ATR"))
        assert MIN_TARGET_RR == pytest.approx(param("MIN_TARGET_RR"))
        assert SR_MIN_TOUCHES == param("SR_MIN_TOUCHES")
        assert TRENDLINE_MIN_TOUCHES == param("TRENDLINE_MIN_TOUCHES")
