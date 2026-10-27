"""
Tests for the causal execution semantics of the backtesting engine.

Reference: ``docs/EXECUTION_SEMANTICS.md``.

Every test here uses explicit expected values so that a failure pinpoints
exactly which arithmetic or ordering rule broke.
"""
import numpy as np
import pandas as pd
import pytest

from conftest import (
    RecordingPattern,
    AlwaysSignalPattern,
    make_ohlcv,
    flat_bars,
)

from src.backtesting.engine import (
    BacktestEngine,
    BacktestConfig,
    run_backtest,
)


# ======================================================================
# 1. Signals must not see the forming candle
# ======================================================================

class TestSignalVisibility:
    """The strategy may only observe candles that have already closed."""

    def test_pattern_never_sees_the_forming_bar(self):
        """
        The pattern must receive data ending at the previous bar, never at the
        bar the engine is currently iterating over.
        """
        df = make_ohlcv(flat_bars(20))
        pattern = RecordingPattern()

        engine = BacktestEngine(BacktestConfig())
        engine.run(pattern, df, "TEST")

        assert len(pattern.calls) > 0
        full_index = list(df.index)
        for i, (frame, last_ts) in enumerate(
            zip(pattern.calls, pattern.seen_last_index)
        ):
            # The last visible bar must be the bar BEFORE the one being
            # processed, i.e. there must exist a later bar in the dataset.
            assert last_ts in full_index
            pos = full_index.index(last_ts)
            assert pos < len(full_index) - 1, (
                "pattern saw the final bar; the last bar is never a closed "
                "candle at decision time"
            )

    def test_pattern_never_sees_a_future_bar(self):
        """No timestamp handed to the pattern may be later than its last bar."""
        df = make_ohlcv(flat_bars(30))
        pattern = RecordingPattern()

        engine = BacktestEngine(BacktestConfig())
        engine.run(pattern, df, "TEST")

        for frame, last_ts in zip(pattern.calls, pattern.seen_last_index):
            assert frame.index.max() == last_ts
            assert (frame.index <= last_ts).all()

    def test_pattern_window_is_a_sliding_suffix_of_closed_bars(self):
        """
        Each call must receive a window that ENDS at the last closed bar and
        never extends into the future.

        The window is bounded to the pattern's required bar count so the
        backtest stays O(n) rather than O(n^2).
        """
        df = make_ohlcv(flat_bars(25))
        pattern = RecordingPattern()

        engine = BacktestEngine(BacktestConfig())
        engine.run(pattern, df, "TEST")

        full_index = list(df.index)
        required = pattern.get_required_bars()

        for frame, last_ts in zip(pattern.calls, pattern.seen_last_index):
            pos = full_index.index(last_ts)
            # The window ends exactly at the last closed bar.
            assert list(frame.index)[-1] == last_ts
            # The window contains only bars at or before that point.
            assert all(t <= last_ts for t in frame.index)
            # The window is bounded.
            assert len(frame) <= required

    def test_each_call_moves_the_window_forward_by_one_bar(self):
        """
        Successive calls must advance the window one bar at a time, so the
        engine never skips or re-reads history.
        """
        df = make_ohlcv(flat_bars(25))
        pattern = RecordingPattern()

        engine = BacktestEngine(BacktestConfig())
        engine.run(pattern, df, "TEST")

        last_positions = []
        full_index = list(df.index)
        for frame, last_ts in zip(pattern.calls, pattern.seen_last_index):
            last_positions.append(full_index.index(last_ts))

        # The end of the window must advance by exactly one bar per call.
        assert last_positions == list(
            range(last_positions[0], last_positions[0] + len(last_positions))
        )

    def test_no_signal_can_execute_on_its_own_bar(self):
        """
        A signal produced from bar T must be filled no earlier than bar T+1.
        """
        df = make_ohlcv(flat_bars(20))
        pattern = RecordingPattern(signal_on_call=1)

        result = run_backtest(pattern, df, "TEST")

        assert len(result.trades) == 1
        trade = result.trades[0]
        signal_time = trade["signal_time"]
        entry_time = trade["entry_time"]
        assert entry_time > signal_time, (
            f"entry {entry_time} must be strictly after signal {signal_time}"
        )


# ======================================================================
# 2. Regression: future candles cannot alter past signals
# ======================================================================

class TestRetrospectiveStability:
    """
    Regression tests for the look-ahead bias that the original engine had.
    """

    def test_future_candles_cannot_change_earlier_signals(self):
        """
        Run the backtest over the first N bars, then over the full dataset.

        The decisions (entries) taken within the first N bars must be
        IDENTICAL, and any trade that COMPLETED before the truncation point
        must be identical in every field.

        Note: a position still open at the truncation point is force-closed at
        the end of the available data in the short run, so its exit *time* can
        legitimately differ between the two runs. Its entry, entry price and
        P&L must still match.
        """
        df = make_ohlcv(flat_bars(60))
        pattern_a = AlwaysSignalPattern()
        pattern_b = AlwaysSignalPattern()

        # Short run: only the first 30 bars are available.
        short = run_backtest(pattern_a, df.iloc[:30], "TEST")
        # Long run: 60 bars are available, so more *future* information exists.
        long = run_backtest(pattern_b, df, "TEST")

        assert len(short.trades) > 0
        assert len(long.trades) > 0

        cutoff = df.index[29]

        for i, trade in enumerate(short.trades):
            later = long.trades[i]

            # The entry decision must be identical.
            assert later["entry_time"] == trade["entry_time"]
            assert later["entry_price"] == pytest.approx(trade["entry_price"])
            assert later["size"] == pytest.approx(trade["size"])
            assert later["pnl"] == pytest.approx(trade["pnl"])

            # A trade that had already closed before the cutoff must match
            # in every field, including its exit.
            if trade.get("exit_time") is not None and trade["exit_time"] < cutoff:
                assert later["exit_time"] == trade["exit_time"]
                assert later["exit_price"] == pytest.approx(trade["exit_price"])
                assert later["exit_reason"] == trade["exit_reason"]

    def test_trades_completed_before_the_cutoff_are_fully_identical(self):
        """
        With data that actually completes trades (via stop-losses), every
        trade that closed before the cutoff must be byte-identical between a
        truncated run and a full run.
        """
        # A zig-zag that repeatedly hits the stop-loss at 95.
        rows = []
        for i in range(60):
            if i % 2 == 0:
                rows.append((100, 101, 94, 96))   # breaks the stop at 95
            else:
                rows.append((96, 101, 95, 100))

        df = make_ohlcv(rows)
        short = run_backtest(AlwaysSignalPattern(), df.iloc[:30], "TEST")
        long = run_backtest(AlwaysSignalPattern(), df, "TEST")

        cutoff = df.index[29]
        completed_short = [
            t for t in short.trades
            if t.get("exit_time") is not None and t["exit_time"] < cutoff
        ]
        completed_long = [
            t for t in long.trades
            if t.get("exit_time") is not None and t["exit_time"] < cutoff
        ]

        assert len(completed_short) > 0
        assert len(completed_short) == len(completed_long)

        for a, b in zip(completed_short, completed_long):
            assert a["id"] == b["id"]
            assert a["entry_time"] == b["entry_time"]
            assert a["exit_time"] == b["exit_time"]
            assert a["entry_price"] == pytest.approx(b["entry_price"])
            assert a["exit_price"] == pytest.approx(b["exit_price"])
            assert a["exit_reason"] == b["exit_reason"]
            assert a["pnl"] == pytest.approx(b["pnl"])
            assert a["r_multiple"] == pytest.approx(b["r_multiple"])

    def test_truncating_the_future_preserves_past_equity(self):
        """
        The equity curve computed on a truncated dataset must match the
        corresponding prefix of the full equity curve.
        """
        df = make_ohlcv(flat_bars(60))
        short = run_backtest(AlwaysSignalPattern(), df.iloc[:30], "TEST")
        long = run_backtest(AlwaysSignalPattern(), df, "TEST")

        short_eq = short.equity_curve
        long_eq = long.equity_curve.iloc[: len(short_eq)]

        # The final point of the short run is forced to realised capital after
        # the end-of-data close, so compare the interior points exactly and
        # allow the last point to differ by that adjustment.
        pd.testing.assert_series_equal(
            short_eq.iloc[:-1], long_eq.iloc[: len(short_eq) - 1],
            check_names=False, rtol=1e-12,
        )


# ======================================================================
# 3. Order execution timing
# ======================================================================

class TestOrderExecution:
    """Orders become actionable only on the bar after the signal."""

    def test_entry_occurs_on_the_bar_after_the_signal(self):
        """
        Signal on call 1 (bar index 4, given required_bars=5).
        The order may fill on bar index 5 at the earliest.
        """
        df = make_ohlcv(flat_bars(20))
        pattern = RecordingPattern(signal_on_call=1, entry=100.0)

        result = run_backtest(pattern, df, "TEST")

        assert len(result.trades) == 1
        trade = result.trades[0]

        signal_bar_pos = list(df.index).index(trade["signal_time"])
        entry_bar_pos = list(df.index).index(trade["entry_time"])

        assert signal_bar_pos == 4      # required_bars - 1
        assert entry_bar_pos == 5       # exactly the next bar
        assert entry_bar_pos > signal_bar_pos

    def test_order_does_not_fill_on_signal_bar_even_if_price_touches(self):
        """
        If the signal bar's own range would have reached the entry price, the
        order must still wait for the following bar.
        """
        # Bar 4 (the signal bar) has a low of 90, well below the entry of 100.
        rows = flat_bars(20)
        rows[4] = (100, 101, 90, 100)
        df = make_ohlcv(rows)

        pattern = RecordingPattern(signal_on_call=1, entry=100.0)
        result = run_backtest(pattern, df, "TEST")

        trade = result.trades[0]
        entry_bar_pos = list(df.index).index(trade["entry_time"])
        assert entry_bar_pos == 5

    def test_position_cannot_be_exited_on_its_entry_bar(self):
        """
        A position opened on bar N must not also be closed on bar N, even if
        bar N's range spans the stop-loss.
        """
        rows = flat_bars(20)
        rows[5] = (100, 101, 90, 100)   # entry bar also hits the stop
        df = make_ohlcv(rows)

        pattern = RecordingPattern(signal_on_call=1, entry=100.0, stop=95.0)
        result = run_backtest(pattern, df, "TEST")

        trade = result.trades[0]
        entry_bar_pos = list(df.index).index(trade["entry_time"])
        exit_bar_pos = list(df.index).index(trade["exit_time"])
        assert exit_bar_pos > entry_bar_pos

    def test_no_order_fills_when_price_never_reaches_entry(self):
        """
        If price never comes back to the entry, no trade is recorded.

        A buy limit at 50 with the market trading in 90..100 is never
        marketable, so the order must stay pending forever.
        """
        rows = [(95, 100, 90, 95) for _ in range(20)]
        df = make_ohlcv(rows)

        pattern = RecordingPattern(signal_on_call=1, entry=50.0)
        result = run_backtest(pattern, df, "TEST")

        assert len(result.trades) == 0

    def test_a_marketable_limit_fills_immediately_at_the_market(self):
        """
        A buy limit ABOVE the market is immediately marketable and fills at
        the market price, not at the limit price. This is the gap rule.
        """
        rows = [(95, 100, 90, 95) for _ in range(20)]
        df = make_ohlcv(rows)

        cfg = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0,
        )
        pattern = RecordingPattern(
            signal_on_call=1, entry=500.0, stop=94.0, target=110.0,
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert len(result.trades) == 1
        # Filled at the bar open (95), not at the limit price of 500.
        assert result.trades[0]["entry_price"] == pytest.approx(95.0)

    def test_short_order_needs_price_to_rise_to_the_entry(self):
        """
        A short order above the market is not filled while price stays below.
        """
        rows = [(95, 100, 90, 95) for _ in range(20)]
        df = make_ohlcv(rows)

        pattern = RecordingPattern(
            signal_on_call=1, direction="SHORT", entry=500.0,
            stop=510.0, target=450.0,
        )
        result = run_backtest(pattern, df, "TEST")

        assert len(result.trades) == 0


# ======================================================================
# 3b. DIV-11: ORDER_FILL_CONDITION = touch_only (book p.16 / p.17)
# ======================================================================

class TestOrderFillCondition:
    """
    Book rule: fill when price touches the entry, without candle-close
    confirmation. A wick that reaches the entry is enough even if the bar
    closes back on the wrong side. close-beyond is explicitly rejected by
    p.17.
    """

    def test_long_fills_on_wick_touch_even_if_close_stays_above(self):
        """
        Long limit at 100. Bar trades down to 99.5 (touch) but closes at
        100.5 (still above entry). Under touch_only this MUST fill; under
        close-confirmation it would not.
        """
        rows = [(100, 101, 99, 100) for _ in range(20)]
        # Signal on call 1 => pending from bar 1; fill attempted from bar 2.
        rows[2] = (101.0, 101.5, 99.5, 100.5)
        df = make_ohlcv(rows)

        cfg = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0, fill_gaps_at_open=False,
        )
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0,
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert len(result.trades) == 1
        assert result.trades[0]["entry_price"] == pytest.approx(100.0)

    def test_short_fills_on_wick_touch_even_if_close_stays_below(self):
        """
        Short limit at 100. Bar spikes to 100.5 (touch) but closes at 99.5.
        Must fill under touch_only.
        """
        rows = [(100, 101, 99, 100) for _ in range(20)]
        rows[2] = (99.5, 100.5, 99.0, 99.5)
        df = make_ohlcv(rows)

        cfg = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0, fill_gaps_at_open=False,
        )
        pattern = RecordingPattern(
            signal_on_call=1, direction="SHORT",
            entry=100.0, stop=105.0, target=90.0,
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert len(result.trades) == 1
        assert result.trades[0]["entry_price"] == pytest.approx(100.0)


# ======================================================================
# 4. Profit and loss arithmetic
# ======================================================================

class TestPnlCalculation:
    """Explicit expected values for long and short P&L."""

    @staticmethod
    def _single_trade(entry, stop, target, direction, rows, config=None):
        """Run a one-shot pattern and return the resulting trade."""
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1,
            direction=direction,
            entry=entry,
            stop=stop,
            target=target,
        )
        result = run_backtest(pattern, df, "TEST", config)
        assert len(result.trades) == 1, "expected exactly one trade"
        return result.trades[0]

    def test_long_win_uses_exact_expected_pnl(self):
        """
        Zero-cost long: entry 100, exit at target 110, size 200 units
        (risk 1% of 100000 = 1000, risk per unit = 5 -> size 200).

        Gross P&L = (110 - 100) * 200 = 2000.
        """
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)   # bar 6 reaches the target of 110
        df_rows = rows

        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
        )
        trade = self._single_trade(
            entry=100.0, stop=95.0, target=110.0,
            direction="LONG", rows=df_rows, config=cfg,
        )

        assert trade["exit_reason"] == "TARGET"
        assert trade["entry_price"] == pytest.approx(100.0)
        assert trade["exit_price"] == pytest.approx(110.0)
        assert trade["size"] == pytest.approx(200.0)
        assert trade["pnl"] == pytest.approx(2000.0)
        assert trade["r_multiple"] == pytest.approx(2.0)

    def test_short_win_uses_exact_expected_pnl(self):
        """
        Short entry 100, stop 105, target 90. Risk per unit = 5, size 200.
        Gross P&L = (100 - 90) * 200 = 2000.
        """
        rows = flat_bars(20)
        rows[6] = (100, 100, 89, 90)    # bar 6 reaches the target of 90
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
        )
        trade = self._single_trade(
            entry=100.0, stop=105.0, target=90.0,
            direction="SHORT", rows=rows, config=cfg,
        )

        assert trade["exit_reason"] == "TARGET"
        assert trade["size"] == pytest.approx(200.0)
        assert trade["pnl"] == pytest.approx(2000.0)
        assert trade["r_multiple"] == pytest.approx(2.0)

    def test_long_stop_loss_loss_is_exact(self):
        """
        Long entry 100, stop 95, size 200.
        Gross P&L = (95 - 100) * 200 = -1000, i.e. exactly -1R.
        """
        rows = flat_bars(20)
        rows[6] = (100, 100, 94, 96)    # bar 6 breaks the stop at 95
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
        )
        trade = self._single_trade(
            entry=100.0, stop=95.0, target=110.0,
            direction="LONG", rows=rows, config=cfg,
        )

        assert trade["exit_reason"] == "STOPPED"
        assert trade["exit_price"] == pytest.approx(95.0)
        assert trade["pnl"] == pytest.approx(-1000.0)
        assert trade["r_multiple"] == pytest.approx(-1.0)

    def test_short_stop_loss_loss_is_exact(self):
        """
        Short entry 100, stop 105, size 200.
        Gross P&L = (100 - 105) * 200 = -1000, i.e. exactly -1R.
        """
        rows = flat_bars(20)
        rows[6] = (100, 106, 100, 105)  # bar 6 breaks the stop at 105
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
        )
        trade = self._single_trade(
            entry=100.0, stop=105.0, target=90.0,
            direction="SHORT", rows=rows, config=cfg,
        )

        assert trade["exit_reason"] == "STOPPED"
        assert trade["pnl"] == pytest.approx(-1000.0)
        assert trade["r_multiple"] == pytest.approx(-1.0)


# ======================================================================
# 5. Ambiguous candles: both stop and target in one bar
# ======================================================================

class TestAmbiguousBars:
    """A bar whose range spans both the stop and the target."""

    def _ambiguous_rows(self):
        # Bar 6 spans 90..120, hitting stop 95 and target 110.
        rows = flat_bars(20)
        rows[6] = (100, 120, 90, 100)
        return rows

    def test_stop_first_policy_is_the_default(self):
        """Default policy resolves ambiguity in favour of the stop."""
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
        )
        df = make_ohlcv(self._ambiguous_rows())
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        trade = result.trades[0]
        assert trade["exit_reason"] == "STOPPED"
        assert trade["exit_price"] == pytest.approx(95.0)
        assert trade["pnl"] == pytest.approx(-1000.0)

    def test_target_first_policy_resolves_the_other_way(self):
        """Explicitly selecting target_first flips the outcome."""
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
            intrabar_policy="target_first",
        )
        df = make_ohlcv(self._ambiguous_rows())
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        trade = result.trades[0]
        assert trade["exit_reason"] == "TARGET"
        assert trade["exit_price"] == pytest.approx(110.0)
        assert trade["pnl"] == pytest.approx(2000.0)

    def test_worst_case_policy_takes_the_stop_for_a_long(self):
        """worst_case must not be better than stop_first for a long."""
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
            intrabar_policy="worst_case",
        )
        df = make_ohlcv(self._ambiguous_rows())
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert result.trades[0]["exit_reason"] == "STOPPED"

    def test_intrabar_policy_uses_finer_grained_data(self):
        """
        With sub-bar data, the first sub-bar that touches a level decides.
        The first sub-bar dips to 90 (stop) before reaching 110 (target),
        so the stop must be taken.
        """
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
            intrabar_policy="intrabar",
        )

        rows = flat_bars(20)
        rows[6] = (100, 120, 90, 100)
        df = make_ohlcv(rows)

        # Build sub-bar data for the ambiguous bar (2024-01-01 06:00).
        parent_ts = df.index[6]
        sub = pd.DataFrame(
            [
                (100, 100, 90, 95, 5),    # dips to the stop first
                (95, 115, 95, 110, 5),   # only later reaches the target
            ],
            columns=["open", "high", "low", "close", "volume"],
            index=pd.DatetimeIndex([parent_ts, parent_ts + pd.Timedelta(minutes=30)]),
        )
        cfg.intrabar_data = sub

        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert result.trades[0]["exit_reason"] == "STOPPED"

    def test_intrabar_policy_can_select_the_target(self):
        """
        When the sub-bars reach the target before the stop, the target wins.
        """
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.0,
            intrabar_policy="intrabar",
        )

        rows = flat_bars(20)
        rows[6] = (100, 120, 90, 100)
        df = make_ohlcv(rows)

        parent_ts = df.index[6]
        sub = pd.DataFrame(
            [
                (100, 112, 100, 110, 5),  # reaches the target first
                (110, 115, 90, 95, 5),    # the stop only comes later
            ],
            columns=["open", "high", "low", "close", "volume"],
            index=pd.DatetimeIndex([parent_ts, parent_ts + pd.Timedelta(minutes=30)]),
        )
        cfg.intrabar_data = sub

        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert result.trades[0]["exit_reason"] == "TARGET"


# ======================================================================
# 6. Costs: commission and slippage
# ======================================================================

class TestCosts:
    """Fees and slippage must be applied on both sides, consistently."""

    def test_slippage_moves_the_entry_against_the_trader(self):
        """
        Long entry at 100 with 0.1% slippage must fill at 100.1.
        """
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.001,
        )
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert result.trades[0]["entry_price"] == pytest.approx(100.1)

    def test_slippage_moves_the_exit_against_the_trader(self):
        """
        Long exit at target 110 with 0.1% slippage must fill at 109.89.
        """
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.001,
        )
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert result.trades[0]["exit_price"] == pytest.approx(110 * 0.999)

    def test_short_slippage_directions_are_mirrored(self):
        """Short entry fills lower, short exit fills higher."""
        rows = flat_bars(20)
        rows[6] = (100, 100, 89, 90)
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.0,
            slippage=0.001,
        )
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1, direction="SHORT",
            entry=100.0, stop=105.0, target=90.0,
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert result.trades[0]["entry_price"] == pytest.approx(100 * 0.999)
        assert result.trades[0]["exit_price"] == pytest.approx(90 * 1.001)

    def test_commission_is_charged_on_both_sides(self):
        """
        Entry 100 (size 200) and exit 110 (size 200).
        Notional both sides = 100*200 + 110*200 = 20000 + 22000 = 42000.
        Commission 0.1% => 42.
        Gross P&L = 2000, net P&L = 2000 - 42 = 1958.
        """
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)
        cfg = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,
            commission=0.001,
            slippage=0.0,
        )
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        trade = result.trades[0]
        assert trade["commission"] == pytest.approx(42.0)
        assert trade["pnl"] == pytest.approx(1958.0)

    def test_costs_reduce_profit_but_are_never_credited(self):
        """A winning trade must earn strictly less once costs are applied."""
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)

        free = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0,
        )
        costly = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.001, slippage=0.001,
        )

        df = make_ohlcv(rows)
        p1 = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        p2 = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        r_free = run_backtest(p1, df, "TEST", free)
        r_costly = run_backtest(p2, df, "TEST", costly)

        assert r_costly.trades[0]["pnl"] < r_free.trades[0]["pnl"]


# ======================================================================
# 7. Position sizing
# ======================================================================

class TestPositionSizing:
    """Fixed fractional risk sizing."""

    def test_size_equals_risk_amount_over_risk_per_unit(self):
        """
        equity 100000, risk 1% => 1000 at risk.
        entry 100, stop 95 => 5 per unit => size 200.
        """
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)
        cfg = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0,
        )
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        trade = result.trades[0]
        assert trade["size"] == pytest.approx(200.0)
        assert trade["risk_amount"] == pytest.approx(1000.0)

    def test_wider_stop_yields_smaller_position(self):
        """A wider stop must reduce the position size proportionally."""
        rows = flat_bars(20)
        rows[6] = (100, 111, 100, 110)
        cfg = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0,
        )
        df = make_ohlcv(rows)

        p_tight = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=95.0, target=120.0
        )
        p_wide = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=90.0, target=120.0
        )

        r_tight = run_backtest(p_tight, df, "TEST", cfg)
        r_wide = run_backtest(p_wide, df, "TEST", cfg)

        assert r_tight.trades[0]["size"] == pytest.approx(200.0)
        assert r_wide.trades[0]["size"] == pytest.approx(100.0)

    def test_zero_risk_distance_yields_no_position(self):
        """A stop equal to the entry must not create a position."""
        rows = flat_bars(20)
        cfg = BacktestConfig(
            initial_capital=100_000, risk_per_trade=0.01,
            commission=0.0, slippage=0.0,
        )
        df = make_ohlcv(rows)
        pattern = RecordingPattern(
            signal_on_call=1, entry=100.0, stop=100.0, target=110.0
        )
        result = run_backtest(pattern, df, "TEST", cfg)

        assert len(result.trades) == 0


# ======================================================================
# 8. Data integrity handling
# ======================================================================

class TestDataIntegrity:
    """Duplicate, out-of-order and invalid candles must be handled."""

    def test_duplicate_timestamps_are_rejected(self):
        from src.data.loaders import validate_ohlcv, DataValidationError

        df = make_ohlcv(flat_bars(5))
        df = pd.concat([df, df.iloc[[2]]])
        df = df.sort_index()

        with pytest.raises(DataValidationError, match="Duplicate timestamps"):
            validate_ohlcv(df)

    def test_duplicate_timestamps_can_be_deduplicated(self):
        from src.data.loaders import validate_ohlcv

        df = make_ohlcv(flat_bars(5))
        df = pd.concat([df, df.iloc[[2]]]).sort_index()

        cleaned = validate_ohlcv(df, on_duplicate="last")
        assert len(cleaned) == 5
        assert cleaned.index.is_unique

    def test_out_of_order_timestamps_are_sorted(self):
        from src.data.loaders import validate_ohlcv

        df = make_ohlcv(flat_bars(5))
        shuffled = df.iloc[[2, 0, 4, 1, 3]]

        cleaned = validate_ohlcv(shuffled)
        assert cleaned.index.is_monotonic_increasing
        assert list(cleaned.index) == list(df.index)

    def test_invalid_ohlc_relationships_are_rejected(self):
        from src.data.loaders import validate_ohlcv, DataValidationError

        df = make_ohlcv(flat_bars(3))
        df.iloc[1, df.columns.get_loc("high")] = 50.0  # high below low

        with pytest.raises(DataValidationError, match="invalid OHLC"):
            validate_ohlcv(df)

    def test_close_outside_the_bar_range_is_rejected(self):
        from src.data.loaders import validate_ohlcv, DataValidationError

        df = make_ohlcv(flat_bars(3))
        df.iloc[1, df.columns.get_loc("close")] = 200.0  # close above high

        with pytest.raises(DataValidationError, match="invalid OHLC"):
            validate_ohlcv(df)

    def test_non_positive_prices_are_rejected(self):
        from src.data.loaders import validate_ohlcv, DataValidationError

        # A bar whose prices are all negative is internally consistent
        # (high >= low) but is not a valid price, so the positivity rule
        # must be the one that fires.
        df = make_ohlcv([(-10, -5, -15, -8) for _ in range(3)])

        with pytest.raises(DataValidationError, match="non-positive"):
            validate_ohlcv(df)

    def test_engine_rejects_invalid_data(self):
        """The engine refuses to run on invalid data."""
        df = make_ohlcv(flat_bars(20))
        df.iloc[3, df.columns.get_loc("high")] = 1.0

        engine = BacktestEngine(BacktestConfig(validate_data=True))
        with pytest.raises(ValueError):
            engine.run(RecordingPattern(), df, "TEST")


# ======================================================================
# 9. Reproducibility
# ======================================================================

class TestReproducibility:
    """Identical inputs must produce identical outputs."""

    def test_two_identical_runs_match_exactly(self):
        df = make_ohlcv(flat_bars(60))

        r1 = run_backtest(AlwaysSignalPattern(), df, "TEST")
        r2 = run_backtest(AlwaysSignalPattern(), df, "TEST")

        assert len(r1.trades) == len(r2.trades)
        for t1, t2 in zip(r1.trades, r2.trades):
            assert t1["id"] == t2["id"]
            assert t1["entry_time"] == t2["entry_time"]
            assert t1["exit_time"] == t2["exit_time"]
            assert t1["entry_price"] == pytest.approx(t2["entry_price"])
            assert t1["exit_price"] == pytest.approx(t2["exit_price"])
            assert t1["pnl"] == pytest.approx(t2["pnl"])

        pd.testing.assert_series_equal(
            r1.equity_curve, r2.equity_curve, check_names=False
        )

    def test_trade_ids_are_unique(self):
        """
        The old engine keyed open positions by ``trade_{len(trades)+1}``, which
        collided for overlapping positions and silently overwrote them.
        """
        df = make_ohlcv(flat_bars(80))
        result = run_backtest(AlwaysSignalPattern(), df, "TEST")

        ids = [t["id"] for t in result.trades]
        assert len(ids) == len(set(ids))

    def test_equity_ends_consistent_with_closed_trades(self):
        """
        Final equity must equal initial capital plus the sum of closed-trade
        P&L, once every position has been closed.
        """
        df = make_ohlcv(flat_bars(80))
        result = run_backtest(AlwaysSignalPattern(), df, "TEST")

        expected = result.config.initial_capital + sum(t["pnl"] for t in result.trades)
        assert float(result.equity_curve.iloc[-1]) == pytest.approx(expected, rel=1e-9)

    def test_engine_reset_clears_state(self):
        df = make_ohlcv(flat_bars(40))
        engine = BacktestEngine(BacktestConfig())
        engine.run(AlwaysSignalPattern(), df, "TEST")
        first = len(engine.trades)

        engine.reset()
        assert engine.trades == []
        assert engine.open_positions == {}
        assert engine.pending_orders == []
        assert engine.capital == engine.config.initial_capital

        engine.run(AlwaysSignalPattern(), df, "TEST")
        assert len(engine.trades) == first
