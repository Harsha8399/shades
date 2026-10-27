"""
Backtesting engine for the research lab.

Execution semantics are specified in ``docs/EXECUTION_SEMANTICS.md``.

Summary of the chronology (bar index ``i``):

    1. DECIDE  - the strategy sees bars 0..i-1 only; bar i-1 has closed
    2. EXECUTE - the resulting order fills against bar i (the next bar)
    3. EXIT    - positions opened before bar i are checked for stop/target
    4. MARK    - account equity is recorded at bar i's close

A signal therefore never fills on the candle that produced it, and the
strategy never observes a forming candle.
"""
import pandas as pd
import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Literal
from ..patterns.base import BasePattern, Signal
from .metrics import calculate_metrics, BacktestMetrics
from ..data.loaders import infer_bars_per_year, validate_ohlcv


IntrabarPolicy = Literal['stop_first', 'target_first', 'worst_case', 'intrabar']


@dataclass
class BacktestConfig:
    """Configuration for backtesting."""
    initial_capital: float = 100_000
    risk_per_trade: float = 0.01      # 1% risk per trade
    max_open_trades: int = 5
    commission: float = 0.001          # 0.1% per side, on notional
    slippage: float = 0.0005          # 0.05% per side

    # --- execution semantics (see docs/EXECUTION_SEMANTICS.md) ---
    # How to resolve a bar whose range spans BOTH the stop-loss and the target.
    # 'stop_first' is the default because it is the conservative assumption.
    intrabar_policy: IntrabarPolicy = 'stop_first'
    # Optional finer-grained series used when intrabar_policy == 'intrabar'.
    intrabar_data: Optional[pd.DataFrame] = None
    # Fill gap-through orders at the bar open rather than at the limit price.
    fill_gaps_at_open: bool = True
    # Bars per year used to annualise metrics. None => derived from the data.
    periods_per_year: Optional[float] = None
    # Close positions still open on the final bar at that bar's close.
    close_open_positions_at_end: bool = True
    # Enforce OHLCV integrity rules before running.
    validate_data: bool = True


@dataclass
class BacktestResult:
    """Results from a backtest run."""
    metrics: BacktestMetrics
    trades: List[Dict[str, Any]]
    equity_curve: pd.Series
    config: BacktestConfig
    # Positions that were still open when the data ran out. Exposed so the
    # caller can see exactly how much of the result rests on unrealised
    # exposure rather than closed trades.
    open_positions_at_end: List[Dict[str, Any]] = field(default_factory=list)


class BacktestEngine:
    """
    Event-driven backtesting engine with causal execution semantics.
    """

    def __init__(self, config: Optional[BacktestConfig] = None):
        self.config = config or BacktestConfig()
        self.capital = self.config.initial_capital
        self.equity_curve: List[float] = []
        self.trades: List[Dict[str, Any]] = []
        self.open_positions: Dict[str, Dict[str, Any]] = {}
        self.pending_orders: List[Dict[str, Any]] = []
        self._next_trade_id = 1
        self._equity_timestamps: List[Any] = []
        self._bar_duration = pd.Timedelta(minutes=1)

    def reset(self):
        """Reset the engine state."""
        self.capital = self.config.initial_capital
        self.equity_curve = []
        self.trades = []
        self.open_positions = {}
        self.pending_orders = []
        self._next_trade_id = 1
        self._equity_timestamps = []

    def run(
        self,
        pattern: BasePattern,
        data: pd.DataFrame,
        symbol: str = "TEST",
    ) -> BacktestResult:
        """
        Run backtest on historical data.

        Args:
            pattern: Pattern to test
            data: OHLCV DataFrame with DatetimeIndex
            symbol: Trading symbol

        Returns:
            BacktestResult with metrics, trades, and equity curve
        """
        self.reset()

        if self.config.validate_data:
            data = validate_ohlcv(data)

        required_bars = pattern.get_required_bars()

        if len(data) <= required_bars:
            # Not enough data to produce a single decision point.
            empty_equity = pd.Series(dtype=float)
            return BacktestResult(
                metrics=calculate_metrics([], empty_equity, self.config.initial_capital),
                trades=[],
                equity_curve=empty_equity,
                config=self.config,
                open_positions_at_end=[],
            )

        # Duration of one bar, used to align finer-grained intrabar data.
        self._bar_duration = self._infer_bar_duration(data)

        print(f"[Backtest] Starting backtest: {pattern.name}")
        print(f"[Backtest] Data: {len(data)} bars, Required: {required_bars}")
        print(f"[Backtest] Capital: ${self.config.initial_capital:,.2f}")
        print()

        for i in range(required_bars, len(data)):
            current_bar = data.iloc[i]

            # --- 1. DECIDE -------------------------------------------------
            # The strategy sees bars 0..i-1 only. Bar i is still forming and
            # must not influence the decision.
            #
            # The window is a SLIDING one of the same length the pattern
            # requires, ending at the last CLOSED bar (i-1). Ending the
            # window at i-1 is what makes the decision causal; keeping the
            # window bounded is what stops the backtest from becoming
            # O(n^2) in the number of bars.
            window_start = max(0, i - required_bars)
            history = data.iloc[window_start:i]
            signal = None
            if len(self.open_positions) < self.config.max_open_trades:
                signal = pattern.detect_signal(history, symbol)
                if signal is not None and self._should_skip_trade(signal, history):
                    signal = None

            # --- 2. EXECUTE ------------------------------------------------
            # Orders fill against bar i, the bar AFTER the one that produced
            # the signal. A signal can never fill on its own candle.
            if signal is not None:
                self.pending_orders.append({
                    'signal': signal,
                    'signal_bar_index': i - 1,
                })
            self._execute_pending_orders(current_bar, i)

            # --- 3. EXIT ----------------------------------------------------
            # Positions opened before bar i may be exited by bar i.
            self._update_positions(current_bar, i)

            # --- 4. MARK TO MARKET -----------------------------------------
            self.equity_curve.append(self._calculate_equity(current_bar))
            self._equity_timestamps.append(current_bar.name)

            if i % 500 == 0:
                print(f"[Backtest] Processed {i}/{len(data)} bars...")

        # Close anything still open at the end of the data.
        if self.config.close_open_positions_at_end and self.open_positions:
            last_bar = data.iloc[-1]
            last_index = len(data) - 1
            for trade_id in list(self.open_positions.keys()):
                position = self.open_positions[trade_id]
                # A position opened on the final bar cannot also be exited on
                # the final bar. It is left open and reported separately.
                if position.get('entry_bar_index') == last_index:
                    continue
                self._close_position(
                    trade_id, last_bar['close'], 'END_OF_DATA', bar=last_bar,
                )

        # After the end-of-data closure no positions remain open, so the final
        # account state is exactly the realised capital. Make the last equity
        # point reflect that so the curve and the trade list agree.
        if self.equity_curve:
            self.equity_curve[-1] = self.capital

        print(f"\n[Backtest] Complete. {len(self.trades)} trades executed.")

        equity_series = pd.Series(
            self.equity_curve,
            index=pd.Index(self._equity_timestamps),
            dtype=float,
        )

        metrics = calculate_metrics(
            self.trades,
            equity_series,
            self.config.initial_capital,
            periods_per_year=(
                self.config.periods_per_year or infer_bars_per_year(data)
            ),
        )

        return BacktestResult(
            metrics=metrics,
            trades=self.trades,
            equity_curve=equity_series,
            config=self.config,
            open_positions_at_end=list(self.open_positions.values()),
        )

    @staticmethod
    def _infer_bar_duration(data: pd.DataFrame) -> pd.Timedelta:
        """Median spacing between bars, used to align intrabar data."""
        if len(data) < 2:
            return pd.Timedelta(minutes=1)
        deltas = data.index.to_series().diff().dropna()
        if len(deltas) == 0:
            return pd.Timedelta(minutes=1)
        return deltas.median()

    # ------------------------------------------------------------------
    # Order lifecycle
    # ------------------------------------------------------------------

    def _execute_pending_orders(self, bar: pd.Series, bar_index: int) -> None:
        """
        Fill any pending orders that the current bar can satisfy.

        An order queued on bar ``i-1`` is first eligible on bar ``i``, so a
        signal never fills on the candle that produced it.
        """
        if not self.pending_orders:
            return

        remaining = []
        for order in self.pending_orders:
            signal = order['signal']
            fill_price = self._resolve_entry_fill(signal, bar)
            if fill_price is None:
                remaining.append(order)
                continue

            # Size using the equity current at execution time (not the equity
            # from the signal bar) and the price we will actually pay.
            equity = self._calculate_equity(bar)
            size = self._calculate_position_size(
                fill_price, signal.stop_loss, equity,
            )
            if size <= 0:
                continue

            self._open_position(signal, fill_price, size, bar, bar_index)

        self.pending_orders = remaining

    def _resolve_entry_fill(
        self,
        signal: Signal,
        bar: pd.Series,
    ) -> Optional[float]:
        """
        Determine whether the current bar can fill the order, and at what price.

        Returns:
            The fill price (slippage-adjusted), or None if the bar does not
            reach the entry price.
        """
        entry = signal.entry_price
        direction = signal.direction

        if direction == 'LONG':
            if bar['low'] > entry:
                return None  # price never came down to the entry
        else:
            if bar['high'] < entry:
                return None  # price never came up to the entry

        # Gap handling: if the bar opened beyond the entry, the order fills at
        # the open (a worse or better price than the limit, as reality
        # dictates) rather than at a price the market never offered.
        if self.config.fill_gaps_at_open:
            if direction == 'LONG' and bar['open'] < entry:
                return self._apply_slippage(entry, direction, at_open=True, bar=bar)
            if direction == 'SHORT' and bar['open'] > entry:
                return self._apply_slippage(entry, direction, at_open=True, bar=bar)

        return self._apply_slippage(entry, direction, at_open=False, bar=bar)

    def _apply_slippage(
        self,
        price: float,
        direction: str,
        at_open: bool,
        bar: Optional[pd.Series] = None,
    ) -> float:
        """Apply slippage against the trader to a fill price."""
        base = price
        if at_open and bar is not None:
            base = bar['open']
        slippage = base * self.config.slippage
        return base + slippage if direction == 'LONG' else base - slippage

    def _open_position(
        self,
        signal: Signal,
        entry_price: float,
        size: float,
        bar: pd.Series,
        bar_index: int,
    ) -> None:
        """Open a new position at the given (already slippage-adjusted) price."""
        trade_id = f"trade_{self._next_trade_id}"
        self._next_trade_id += 1

        risk_per_unit = abs(entry_price - signal.stop_loss)
        risk_amount = size * risk_per_unit

        position = {
            'id': trade_id,
            'pattern_id': signal.pattern_id,
            'pattern_name': signal.pattern_name,
            'direction': signal.direction,
            'signal_price': signal.entry_price,
            'entry_price': entry_price,
            'stop_loss': signal.stop_loss,
            'target': signal.target,
            'size': size,
            'risk_amount': risk_amount,
            'signal_time': signal.timestamp,
            'entry_time': bar.name,
            'entry_bar_index': bar_index,
            'confluence_factors': signal.confluence_factors,
        }

        self.open_positions[trade_id] = position

        print(
            f"  [OPEN] {signal.direction} @ {entry_price:.2f} | "
            f"SL: {signal.stop_loss:.2f} | TP: {signal.target:.2f} | Size: {size:.4f}"
        )

    def _update_positions(self, bar: pd.Series, bar_index: int) -> None:
        """
        Check open positions against the current bar for exits.

        A position opened on this bar is excluded: its entry fill and its exit
        conditions were both established by the same candle, and the intrabar
        sequence is unknown.
        """
        closed = []

        for trade_id, position in self.open_positions.items():
            if position.get('entry_bar_index') == bar_index:
                continue

            outcome = self._resolve_exit(position, bar)
            if outcome is None:
                continue

            exit_price, reason = outcome
            self._close_position(trade_id, exit_price, reason, bar=bar)
            closed.append(trade_id)

        for trade_id in closed:
            if trade_id in self.open_positions:
                del self.open_positions[trade_id]

    def _resolve_exit(
        self,
        position: Dict[str, Any],
        bar: pd.Series,
    ) -> Optional[tuple]:
        """
        Determine whether the bar triggers an exit for the position.

        Handles the ambiguous case where the bar's range spans BOTH the
        stop-loss and the target, according to ``config.intrabar_policy``.

        Returns:
            (exit_price, reason) or None if no exit is triggered.
        """
        direction = position['direction']
        stop = position['stop_loss']
        target = position['target']

        if direction == 'LONG':
            stop_hit = bar['low'] <= stop
            target_hit = bar['high'] >= target
        else:
            stop_hit = bar['high'] >= stop
            target_hit = bar['low'] <= target

        if not stop_hit and not target_hit:
            return None

        if stop_hit and target_hit:
            # Ambiguous bar: both levels were reached. Resolve by policy.
            policy = self.config.intrabar_policy

            if policy == 'target_first':
                return (target, 'TARGET')

            if policy == 'intrabar' and self.config.intrabar_data is not None:
                resolved = self._resolve_intrabar(position, bar)
                if resolved is not None:
                    return resolved

            # 'stop_first' (default), 'worst_case' and any fallback.
            # The stop is always the losing side of the trade, so choosing it
            # is both conservative and the worst of the two outcomes.
            return (stop, 'STOPPED')

        if stop_hit:
            return (stop, 'STOPPED')
        return (target, 'TARGET')

    def _resolve_intrabar(
        self,
        position: Dict[str, Any],
        bar: pd.Series,
    ) -> Optional[tuple]:
        """
        Resolve an ambiguous bar using finer-grained data when available.

        The sub-bars covering the current bar are examined in order; the first
        one that reaches the stop or the target decides the outcome.

        Returns None when the finer-grained data is unusable.
        """
        intrabar = self.config.intrabar_data
        if intrabar is None or len(intrabar) == 0:
            return None

        if not isinstance(intrabar.index, pd.DatetimeIndex):
            return None
        if not isinstance(bar.name, pd.Timestamp):
            return None

        start = bar.name
        end = bar.name + self._bar_duration
        window = intrabar[(intrabar.index >= start) & (intrabar.index < end)]
        if len(window) == 0:
            return None

        direction = position['direction']
        stop = position['stop_loss']
        target = position['target']

        for _, sub in window.iterrows():
            if direction == 'LONG':
                stop_hit = sub['low'] <= stop
                target_hit = sub['high'] >= target
            else:
                stop_hit = sub['high'] >= stop
                target_hit = sub['low'] <= target

            if stop_hit:
                return (stop, 'STOPPED')
            if target_hit:
                return (target, 'TARGET')

        return None

    def _close_position(
        self,
        trade_id: str,
        exit_price: float,
        exit_reason: str,
        bar: Optional[pd.Series] = None,
    ) -> None:
        """Close a position and record the trade."""
        position = self.open_positions[trade_id]

        # Slippage applied against the trader.
        slippage = exit_price * self.config.slippage
        if position['direction'] == 'LONG':
            exit_price = exit_price - slippage
        else:
            exit_price = exit_price + slippage

        # Commission on the executed notional, both sides.
        entry_notional = position['entry_price'] * position['size']
        exit_notional = exit_price * position['size']
        commission = (entry_notional + exit_notional) * self.config.commission

        if position['direction'] == 'LONG':
            pnl_per_unit = exit_price - position['entry_price']
        else:
            pnl_per_unit = position['entry_price'] - exit_price

        gross_pnl = pnl_per_unit * position['size']
        net_pnl = gross_pnl - commission

        # R-multiple measured against the ACTUAL entry fill.
        risk_per_unit = abs(position['entry_price'] - position['stop_loss'])
        r_multiple = pnl_per_unit / risk_per_unit if risk_per_unit > 0 else 0

        self.capital += net_pnl

        trade = {
            **position,
            'exit_price': exit_price,
            'exit_reason': exit_reason,
            'pnl': net_pnl,
            'pnl_percent': (
                (net_pnl / position['risk_amount']) * 100
                if position['risk_amount'] > 0 else 0
            ),
            'r_multiple': r_multiple,
            'commission': commission,
        }
        if bar is not None:
            trade['exit_time'] = bar.name

        self.trades.append(trade)

        result_str = "WIN" if net_pnl > 0 else "LOSS"
        print(
            f"  [{exit_reason}] {result_str} @ {exit_price:.2f} | "
            f"P&L: ${net_pnl:.2f} ({r_multiple:.2f}R)"
        )

    # ------------------------------------------------------------------
    # Sizing, filters and equity
    # ------------------------------------------------------------------

    def _should_skip_trade(self, signal: Signal, history: pd.DataFrame) -> bool:
        """Apply skip-trade rules to prevent overtrading."""
        # Rule 1: No trades after 2 consecutive losses
        recent_trades = self.trades[-2:] if len(self.trades) >= 2 else []
        if len(recent_trades) == 2:
            if all(t.get('pnl', 0) < 0 for t in recent_trades):
                return True

        # Rule 2: Minimum R:R threshold
        if signal.risk_reward_ratio < 1.5:
            return True

        return False

    def _calculate_position_size(
        self,
        entry_price: float,
        stop_loss: float,
        equity: Optional[float] = None,
    ) -> float:
        """
        Calculate position size based on risk.

        Sizing uses the equity current at execution time so that the risk
        budget reflects the account as it is when the order is filled, rather
        than a stale value from the signal bar.
        """
        if equity is None:
            equity = self.capital
        risk_amount = equity * self.config.risk_per_trade
        risk_per_unit = abs(entry_price - stop_loss)

        if risk_per_unit == 0:
            return 0

        return risk_amount / risk_per_unit

    def _calculate_equity(self, current_bar: pd.Series) -> float:
        """Calculate current equity including open positions."""
        equity = self.capital

        for position in self.open_positions.values():
            if position['direction'] == 'LONG':
                unrealized = (
                    (current_bar['close'] - position['entry_price'])
                    * position['size']
                )
            else:
                unrealized = (
                    (position['entry_price'] - current_bar['close'])
                    * position['size']
                )
            equity += unrealized

        return equity


def run_backtest(
    pattern: BasePattern,
    data: pd.DataFrame,
    symbol: str = "TEST",
    config: Optional[BacktestConfig] = None,
) -> BacktestResult:
    """
    Convenience function to run a backtest.

    Args:
        pattern: Pattern to test
        data: OHLCV DataFrame
        symbol: Trading symbol
        config: Backtest configuration

    Returns:
        BacktestResult
    """
    engine = BacktestEngine(config)
    return engine.run(pattern, data, symbol)


# CLI entry point
if __name__ == "__main__":
    import sys
    from ..data.loaders import load_csv
    from ..patterns.confluence_zone import ConfluenceZonePattern

    if len(sys.argv) < 2:
        print("Usage: python -m src.backtesting.engine <csv_file>")
        sys.exit(1)

    csv_path = sys.argv[1]

    print("Loading data...")
    data = load_csv(csv_path)

    print(f"Loaded {len(data)} bars")
    print(f"Date range: {data.index[0]} to {data.index[-1]}")
    print()

    pattern = ConfluenceZonePattern()
    result = run_backtest(pattern, data)

    print(result.metrics)

