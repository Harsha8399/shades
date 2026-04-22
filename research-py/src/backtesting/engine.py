"""
Backtesting engine for the research lab.
"""
import pandas as pd
import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from ..patterns.base import BasePattern, Signal
from .metrics import calculate_metrics, BacktestMetrics


@dataclass
class BacktestConfig:
    """Configuration for backtesting."""
    initial_capital: float = 100_000
    risk_per_trade: float = 0.01      # 1% risk per trade
    max_open_trades: int = 5
    commission: float = 0.001          # 0.1%
    slippage: float = 0.0005          # 0.05%


@dataclass
class BacktestResult:
    """Results from a backtest run."""
    metrics: BacktestMetrics
    trades: List[Dict[str, Any]]
    equity_curve: pd.Series
    config: BacktestConfig


class BacktestEngine:
    """
    Event-driven backtesting engine with realistic simulation.
    """
    
    def __init__(self, config: Optional[BacktestConfig] = None):
        self.config = config or BacktestConfig()
        self.capital = self.config.initial_capital
        self.equity_curve: List[float] = []
        self.trades: List[Dict[str, Any]] = []
        self.open_positions: Dict[str, Dict[str, Any]] = {}
    
    def reset(self):
        """Reset the engine state."""
        self.capital = self.config.initial_capital
        self.equity_curve = []
        self.trades = []
        self.open_positions = {}
    
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
        
        required_bars = pattern.get_required_bars()
        
        print(f"[Backtest] Starting backtest: {pattern.name}")
        print(f"[Backtest] Data: {len(data)} bars, Required: {required_bars}")
        print(f"[Backtest] Capital: ${self.config.initial_capital:,.2f}")
        print()
        
        for i in range(required_bars, len(data)):
            current_bar = data.iloc[i]
            history = data.iloc[max(0, i - required_bars):i + 1]
            
            # 1. Update open positions (check SL/TP)
            self._update_positions(current_bar)
            
            # 2. Check for new signals
            if len(self.open_positions) < self.config.max_open_trades:
                signal = pattern.detect_signal(history, symbol)
                
                if signal is not None:
                    # Apply skip-trade rules
                    if self._should_skip_trade(signal, history):
                        continue
                    
                    # Calculate position size
                    position_size = self._calculate_position_size(
                        signal.entry_price,
                        signal.stop_loss
                    )
                    
                    # Simulate entry with slippage
                    entry_price = self._apply_slippage(
                        signal.entry_price,
                        signal.direction
                    )
                    
                    # Open position
                    self._open_position(signal, entry_price, position_size)
            
            # 3. Record equity
            self.equity_curve.append(self._calculate_equity(current_bar))
            
            # Progress logging
            if i % 500 == 0:
                print(f"[Backtest] Processed {i}/{len(data)} bars...")
        
        print(f"\n[Backtest] Complete. {len(self.trades)} trades executed.")
        
        # Compile results
        equity_series = pd.Series(
            self.equity_curve,
            index=data.index[required_bars:required_bars + len(self.equity_curve)]
        )
        
        metrics = calculate_metrics(
            self.trades,
            equity_series,
            self.config.initial_capital
        )
        
        return BacktestResult(
            metrics=metrics,
            trades=self.trades,
            equity_curve=equity_series,
            config=self.config,
        )
    
    def _update_positions(self, bar: pd.Series) -> None:
        """Check and update all open positions."""
        closed = []
        
        for trade_id, position in self.open_positions.items():
            # Check stop-loss
            if position['direction'] == 'LONG':
                if bar['low'] <= position['stop_loss']:
                    self._close_position(trade_id, position['stop_loss'], 'STOPPED')
                    closed.append(trade_id)
                elif bar['high'] >= position['target']:
                    self._close_position(trade_id, position['target'], 'TARGET')
                    closed.append(trade_id)
            else:  # SHORT
                if bar['high'] >= position['stop_loss']:
                    self._close_position(trade_id, position['stop_loss'], 'STOPPED')
                    closed.append(trade_id)
                elif bar['low'] <= position['target']:
                    self._close_position(trade_id, position['target'], 'TARGET')
                    closed.append(trade_id)
        
        for trade_id in closed:
            del self.open_positions[trade_id]
    
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
    
    def _calculate_position_size(self, entry_price: float, stop_loss: float) -> float:
        """Calculate position size based on risk."""
        risk_amount = self.capital * self.config.risk_per_trade
        risk_per_unit = abs(entry_price - stop_loss)
        
        if risk_per_unit == 0:
            return 0
        
        return risk_amount / risk_per_unit
    
    def _apply_slippage(self, price: float, direction: str) -> float:
        """Apply slippage to entry price."""
        slippage = price * self.config.slippage
        
        if direction == 'LONG':
            return price + slippage
        else:
            return price - slippage
    
    def _open_position(self, signal: Signal, entry_price: float, size: float) -> None:
        """Open a new position."""
        trade_id = f"trade_{len(self.trades) + 1}"
        
        risk_per_unit = abs(entry_price - signal.stop_loss)
        risk_amount = size * risk_per_unit
        
        position = {
            'id': trade_id,
            'pattern_id': signal.pattern_id,
            'pattern_name': signal.pattern_name,
            'direction': signal.direction,
            'entry_price': entry_price,
            'stop_loss': signal.stop_loss,
            'target': signal.target,
            'size': size,
            'risk_amount': risk_amount,
            'entry_time': signal.timestamp,
            'confluence_factors': signal.confluence_factors,
        }
        
        self.open_positions[trade_id] = position
        
        print(f"  [OPEN] {signal.direction} @ {entry_price:.2f} | SL: {signal.stop_loss:.2f} | TP: {signal.target:.2f} | Size: {size:.4f}")
    
    def _close_position(self, trade_id: str, exit_price: float, exit_reason: str) -> None:
        """Close a position and record the trade."""
        position = self.open_positions[trade_id]
        
        # Apply slippage to exit
        slippage = exit_price * self.config.slippage
        if position['direction'] == 'LONG':
            exit_price = exit_price - slippage
        else:
            exit_price = exit_price + slippage
        
        # Apply commission
        commission = (position['entry_price'] + exit_price) * position['size'] * self.config.commission
        
        # Calculate P&L
        if position['direction'] == 'LONG':
            pnl_per_unit = exit_price - position['entry_price']
        else:
            pnl_per_unit = position['entry_price'] - exit_price
        
        gross_pnl = pnl_per_unit * position['size']
        net_pnl = gross_pnl - commission
        
        # Calculate R-multiple
        risk_per_unit = abs(position['entry_price'] - position['stop_loss'])
        r_multiple = pnl_per_unit / risk_per_unit if risk_per_unit > 0 else 0
        
        # Update capital
        self.capital += net_pnl
        
        # Record trade
        trade = {
            **position,
            'exit_price': exit_price,
            'exit_reason': exit_reason,
            'pnl': net_pnl,
            'pnl_percent': (net_pnl / position['risk_amount']) * 100 if position['risk_amount'] > 0 else 0,
            'r_multiple': r_multiple,
            'commission': commission,
        }
        
        self.trades.append(trade)
        
        result_str = "WIN" if net_pnl > 0 else "LOSS"
        print(f"  [{exit_reason}] {result_str} @ {exit_price:.2f} | P&L: ${net_pnl:.2f} ({r_multiple:.2f}R)")
    
    def _calculate_equity(self, current_bar: pd.Series) -> float:
        """Calculate current equity including open positions."""
        equity = self.capital
        
        for position in self.open_positions.values():
            if position['direction'] == 'LONG':
                unrealized = (current_bar['close'] - position['entry_price']) * position['size']
            else:
                unrealized = (position['entry_price'] - current_bar['close']) * position['size']
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
        config: Optional backtest configuration
    
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

