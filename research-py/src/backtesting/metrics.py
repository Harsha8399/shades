"""
Performance metrics using quantstats/empyrical libraries.

This module uses battle-tested libraries instead of custom implementations:
- quantstats: Comprehensive portfolio analytics
- empyrical: Risk metrics from Quantopian

Custom implementations are kept as fallback.
"""
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

# Try to import quantstats, fall back to custom if not available
try:
    import quantstats as qs
    HAS_QUANTSTATS = True
except ImportError:
    HAS_QUANTSTATS = False
    print("Warning: quantstats not installed. Using fallback calculations.")

try:
    import empyrical as ep
    HAS_EMPYRICAL = True
except ImportError:
    HAS_EMPYRICAL = False


@dataclass
class BacktestMetrics:
    """Comprehensive backtesting metrics."""
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    expectancy: float
    avg_r_multiple: float
    max_drawdown: float
    max_drawdown_duration: int  # In bars
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float
    total_return: float
    total_pnl: float
    cagr: float
    volatility: float
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'total_trades': self.total_trades,
            'winning_trades': self.winning_trades,
            'losing_trades': self.losing_trades,
            'win_rate': self.win_rate,
            'avg_win': self.avg_win,
            'avg_loss': self.avg_loss,
            'profit_factor': self.profit_factor,
            'expectancy': self.expectancy,
            'avg_r_multiple': self.avg_r_multiple,
            'max_drawdown': self.max_drawdown,
            'max_drawdown_duration': self.max_drawdown_duration,
            'sharpe_ratio': self.sharpe_ratio,
            'sortino_ratio': self.sortino_ratio,
            'calmar_ratio': self.calmar_ratio,
            'total_return': self.total_return,
            'total_pnl': self.total_pnl,
            'cagr': self.cagr,
            'volatility': self.volatility,
        }
    
    def __str__(self) -> str:
        return f"""
========== BACKTEST METRICS ==========
Total Trades:      {self.total_trades}
Winning Trades:    {self.winning_trades}
Losing Trades:     {self.losing_trades}
Win Rate:          {self.win_rate:.1%}

Avg Win:           ${self.avg_win:.2f}
Avg Loss:          ${self.avg_loss:.2f}
Profit Factor:     {self.profit_factor:.2f}
Expectancy:        ${self.expectancy:.2f}
Avg R-Multiple:    {self.avg_r_multiple:.2f}R

Max Drawdown:      {self.max_drawdown:.1%}
Max DD Duration:   {self.max_drawdown_duration} bars
Sharpe Ratio:      {self.sharpe_ratio:.2f}
Sortino Ratio:     {self.sortino_ratio:.2f}
Calmar Ratio:      {self.calmar_ratio:.2f}

CAGR:              {self.cagr:.1%}
Volatility:        {self.volatility:.1%}
Total Return:      {self.total_return:.1%}
Total P&L:         ${self.total_pnl:.2f}
======================================
"""


def calculate_metrics(
    trades: List[Dict[str, Any]],
    equity_curve: pd.Series,
    initial_capital: float,
) -> BacktestMetrics:
    """
    Calculate comprehensive backtest metrics using quantstats when available.
    
    Args:
        trades: List of trade dictionaries with 'pnl' and 'r_multiple' keys
        equity_curve: Series of equity values over time
        initial_capital: Starting capital
    
    Returns:
        BacktestMetrics object
    """
    if not trades:
        return _empty_metrics()
    
    # Trade statistics (always custom - trade-specific)
    trade_stats = _calculate_trade_stats(trades)
    
    # Portfolio metrics (use libraries when available)
    portfolio_stats = _calculate_portfolio_stats(equity_curve, initial_capital)
    
    return BacktestMetrics(
        total_trades=trade_stats['total_trades'],
        winning_trades=trade_stats['winning_trades'],
        losing_trades=trade_stats['losing_trades'],
        win_rate=trade_stats['win_rate'],
        avg_win=trade_stats['avg_win'],
        avg_loss=trade_stats['avg_loss'],
        profit_factor=trade_stats['profit_factor'],
        expectancy=trade_stats['expectancy'],
        avg_r_multiple=trade_stats['avg_r_multiple'],
        max_drawdown=portfolio_stats['max_drawdown'],
        max_drawdown_duration=portfolio_stats['max_drawdown_duration'],
        sharpe_ratio=portfolio_stats['sharpe_ratio'],
        sortino_ratio=portfolio_stats['sortino_ratio'],
        calmar_ratio=portfolio_stats['calmar_ratio'],
        total_return=portfolio_stats['total_return'],
        total_pnl=trade_stats['total_pnl'],
        cagr=portfolio_stats['cagr'],
        volatility=portfolio_stats['volatility'],
    )


def _calculate_trade_stats(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate trade-level statistics (custom - no library for this)."""
    pnls = [t.get('pnl', 0) for t in trades if 'pnl' in t]
    r_multiples = [t.get('r_multiple', 0) for t in trades if 'r_multiple' in t]
    
    winning = [p for p in pnls if p > 0]
    losing = [p for p in pnls if p < 0]
    
    total_trades = len(pnls)
    winning_trades = len(winning)
    losing_trades = len(losing)
    
    win_rate = winning_trades / total_trades if total_trades > 0 else 0
    avg_win = sum(winning) / winning_trades if winning_trades > 0 else 0
    avg_loss = abs(sum(losing) / losing_trades) if losing_trades > 0 else 0
    
    total_win = sum(winning)
    total_loss = abs(sum(losing))
    
    profit_factor = total_win / total_loss if total_loss > 0 else float('inf') if total_win > 0 else 0
    total_pnl = sum(pnls)
    expectancy = total_pnl / total_trades if total_trades > 0 else 0
    avg_r_multiple = sum(r_multiples) / len(r_multiples) if r_multiples else 0
    
    return {
        'total_trades': total_trades,
        'winning_trades': winning_trades,
        'losing_trades': losing_trades,
        'win_rate': win_rate,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'profit_factor': profit_factor,
        'expectancy': expectancy,
        'avg_r_multiple': avg_r_multiple,
        'total_pnl': total_pnl,
    }


def _calculate_portfolio_stats(equity_curve: pd.Series, initial_capital: float) -> Dict[str, Any]:
    """Calculate portfolio-level statistics using quantstats/empyrical."""
    if len(equity_curve) < 2:
        return _empty_portfolio_stats()
    
    # Calculate returns
    returns = equity_curve.pct_change().dropna()
    
    if HAS_QUANTSTATS:
        return _calculate_with_quantstats(returns, equity_curve, initial_capital)
    elif HAS_EMPYRICAL:
        return _calculate_with_empyrical(returns, equity_curve, initial_capital)
    else:
        return _calculate_fallback(returns, equity_curve, initial_capital)


def _calculate_with_quantstats(
    returns: pd.Series, 
    equity_curve: pd.Series, 
    initial_capital: float
) -> Dict[str, Any]:
    """Use quantstats for metrics calculation."""
    # Suppress quantstats output
    import warnings
    warnings.filterwarnings('ignore')
    
    max_dd = qs.stats.max_drawdown(returns)
    sharpe = qs.stats.sharpe(returns)
    sortino = qs.stats.sortino(returns)
    calmar = qs.stats.calmar(returns)
    cagr = qs.stats.cagr(returns)
    volatility = qs.stats.volatility(returns)
    
    # Drawdown duration (custom - quantstats doesn't expose this easily)
    dd_duration = _calculate_drawdown_duration(equity_curve)
    
    final_equity = equity_curve.iloc[-1]
    total_return = (final_equity - initial_capital) / initial_capital
    
    return {
        'max_drawdown': abs(max_dd) if not pd.isna(max_dd) else 0,
        'max_drawdown_duration': dd_duration,
        'sharpe_ratio': sharpe if not pd.isna(sharpe) else 0,
        'sortino_ratio': sortino if not pd.isna(sortino) else 0,
        'calmar_ratio': calmar if not pd.isna(calmar) else 0,
        'cagr': cagr if not pd.isna(cagr) else 0,
        'volatility': volatility if not pd.isna(volatility) else 0,
        'total_return': total_return,
    }


def _calculate_with_empyrical(
    returns: pd.Series, 
    equity_curve: pd.Series, 
    initial_capital: float
) -> Dict[str, Any]:
    """Use empyrical for metrics calculation."""
    max_dd = ep.max_drawdown(returns)
    sharpe = ep.sharpe_ratio(returns)
    sortino = ep.sortino_ratio(returns)
    calmar = ep.calmar_ratio(returns)
    cagr = ep.annual_return(returns)
    volatility = ep.annual_volatility(returns)
    
    dd_duration = _calculate_drawdown_duration(equity_curve)
    final_equity = equity_curve.iloc[-1]
    total_return = (final_equity - initial_capital) / initial_capital
    
    return {
        'max_drawdown': abs(max_dd) if not pd.isna(max_dd) else 0,
        'max_drawdown_duration': dd_duration,
        'sharpe_ratio': sharpe if not pd.isna(sharpe) else 0,
        'sortino_ratio': sortino if not pd.isna(sortino) else 0,
        'calmar_ratio': calmar if not pd.isna(calmar) else 0,
        'cagr': cagr if not pd.isna(cagr) else 0,
        'volatility': volatility if not pd.isna(volatility) else 0,
        'total_return': total_return,
    }


def _calculate_fallback(
    returns: pd.Series, 
    equity_curve: pd.Series, 
    initial_capital: float
) -> Dict[str, Any]:
    """Fallback custom calculations when libraries not available."""
    # Max drawdown
    running_max = equity_curve.expanding().max()
    drawdown = (equity_curve - running_max) / running_max
    max_dd = abs(drawdown.min())
    
    # Drawdown duration
    dd_duration = _calculate_drawdown_duration(equity_curve)
    
    # Sharpe ratio
    if returns.std() > 0:
        sharpe = (returns.mean() / returns.std()) * np.sqrt(252)
    else:
        sharpe = 0
    
    # Sortino ratio
    downside = returns[returns < 0]
    if len(downside) > 0 and downside.std() > 0:
        sortino = (returns.mean() / downside.std()) * np.sqrt(252)
    else:
        sortino = float('inf') if returns.mean() > 0 else 0
    
    # Total return
    final_equity = equity_curve.iloc[-1]
    total_return = (final_equity - initial_capital) / initial_capital
    
    # CAGR (approximate)
    years = len(equity_curve) / 252
    if years > 0:
        cagr = (final_equity / initial_capital) ** (1 / years) - 1
    else:
        cagr = 0
    
    # Volatility
    volatility = returns.std() * np.sqrt(252)
    
    # Calmar
    calmar = cagr / max_dd if max_dd > 0 else 0
    
    return {
        'max_drawdown': max_dd,
        'max_drawdown_duration': dd_duration,
        'sharpe_ratio': sharpe,
        'sortino_ratio': sortino,
        'calmar_ratio': calmar,
        'cagr': cagr,
        'volatility': volatility,
        'total_return': total_return,
    }


def _calculate_drawdown_duration(equity_curve: pd.Series) -> int:
    """Calculate maximum drawdown duration in bars."""
    running_max = equity_curve.expanding().max()
    in_drawdown = equity_curve < running_max
    
    max_duration = 0
    current_duration = 0
    
    for is_in_dd in in_drawdown:
        if is_in_dd:
            current_duration += 1
            max_duration = max(max_duration, current_duration)
        else:
            current_duration = 0
    
    return max_duration


def _empty_metrics() -> BacktestMetrics:
    """Return empty metrics object."""
    return BacktestMetrics(
        total_trades=0, winning_trades=0, losing_trades=0,
        win_rate=0, avg_win=0, avg_loss=0, profit_factor=0,
        expectancy=0, avg_r_multiple=0, max_drawdown=0,
        max_drawdown_duration=0, sharpe_ratio=0, sortino_ratio=0,
        calmar_ratio=0, total_return=0, total_pnl=0, cagr=0, volatility=0,
    )


def _empty_portfolio_stats() -> Dict[str, Any]:
    """Return empty portfolio stats."""
    return {
        'max_drawdown': 0, 'max_drawdown_duration': 0,
        'sharpe_ratio': 0, 'sortino_ratio': 0, 'calmar_ratio': 0,
        'cagr': 0, 'volatility': 0, 'total_return': 0,
    }


# Convenience functions using quantstats
def generate_report(
    returns: pd.Series,
    benchmark: Optional[pd.Series] = None,
    output_path: str = "backtest_report.html"
) -> None:
    """Generate full HTML report using quantstats."""
    if not HAS_QUANTSTATS:
        print("quantstats not installed. Install with: pip install quantstats")
        return
    
    qs.reports.html(returns, benchmark=benchmark, output=output_path)
    print(f"Report saved to {output_path}")


def plot_returns(returns: pd.Series, title: str = "Strategy Returns") -> None:
    """Plot returns using quantstats."""
    if not HAS_QUANTSTATS:
        print("quantstats not installed.")
        return
    
    qs.plots.returns(returns, title=title)
