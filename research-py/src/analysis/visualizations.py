"""
Visualization utilities for backtest analysis.
"""
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from typing import List, Dict, Any, Optional
from datetime import datetime


def plot_equity_curve(
    equity_curve: pd.Series,
    title: str = "Equity Curve",
    initial_capital: float = 100000,
    save_path: Optional[str] = None,
) -> None:
    """
    Plot the equity curve over time.
    
    Args:
        equity_curve: Series of equity values with DatetimeIndex
        title: Plot title
        initial_capital: Starting capital for reference line
        save_path: Optional path to save the figure
    """
    fig, ax = plt.subplots(figsize=(12, 6))
    
    ax.plot(equity_curve.index, equity_curve.values, 'b-', linewidth=1.5, label='Equity')
    ax.axhline(y=initial_capital, color='gray', linestyle='--', alpha=0.7, label='Initial Capital')
    
    # Fill positive/negative areas
    ax.fill_between(
        equity_curve.index,
        initial_capital,
        equity_curve.values,
        where=equity_curve.values >= initial_capital,
        alpha=0.3,
        color='green',
    )
    ax.fill_between(
        equity_curve.index,
        initial_capital,
        equity_curve.values,
        where=equity_curve.values < initial_capital,
        alpha=0.3,
        color='red',
    )
    
    ax.set_xlabel('Date')
    ax.set_ylabel('Equity ($)')
    ax.set_title(title)
    ax.legend(loc='upper left')
    ax.grid(True, alpha=0.3)
    
    # Format x-axis dates
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    plt.xticks(rotation=45)
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"Saved equity curve to {save_path}")
    else:
        plt.show()


def plot_drawdown(
    equity_curve: pd.Series,
    title: str = "Drawdown",
    save_path: Optional[str] = None,
) -> None:
    """
    Plot the drawdown over time.
    
    Args:
        equity_curve: Series of equity values with DatetimeIndex
        title: Plot title
        save_path: Optional path to save the figure
    """
    # Calculate running maximum
    running_max = equity_curve.expanding().max()
    
    # Calculate drawdown percentage
    drawdown = (equity_curve - running_max) / running_max * 100
    
    fig, ax = plt.subplots(figsize=(12, 4))
    
    ax.fill_between(drawdown.index, 0, drawdown.values, alpha=0.7, color='red')
    ax.plot(drawdown.index, drawdown.values, 'r-', linewidth=0.5)
    
    ax.set_xlabel('Date')
    ax.set_ylabel('Drawdown (%)')
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    
    # Add max drawdown annotation
    max_dd = drawdown.min()
    max_dd_date = drawdown.idxmin()
    ax.annotate(
        f'Max DD: {max_dd:.1f}%',
        xy=(max_dd_date, max_dd),
        xytext=(10, -30),
        textcoords='offset points',
        fontsize=10,
        color='darkred',
        arrowprops=dict(arrowstyle='->', color='darkred'),
    )
    
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    plt.xticks(rotation=45)
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"Saved drawdown chart to {save_path}")
    else:
        plt.show()


def plot_trade_distribution(
    trades: List[Dict[str, Any]],
    title: str = "Trade P&L Distribution",
    save_path: Optional[str] = None,
) -> None:
    """
    Plot the distribution of trade P&L.
    
    Args:
        trades: List of trade dictionaries with 'pnl' and 'r_multiple' keys
        title: Plot title
        save_path: Optional path to save the figure
    """
    if not trades:
        print("No trades to plot")
        return
    
    pnls = [t.get('pnl', 0) for t in trades if 'pnl' in t]
    r_multiples = [t.get('r_multiple', 0) for t in trades if 'r_multiple' in t]
    
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # P&L histogram
    ax1 = axes[0]
    colors = ['green' if p > 0 else 'red' for p in pnls]
    ax1.bar(range(len(pnls)), pnls, color=colors, alpha=0.7)
    ax1.axhline(y=0, color='black', linestyle='-', linewidth=0.5)
    ax1.set_xlabel('Trade #')
    ax1.set_ylabel('P&L ($)')
    ax1.set_title('P&L by Trade')
    ax1.grid(True, alpha=0.3)
    
    # R-multiple histogram
    ax2 = axes[1]
    bins = np.arange(min(r_multiples) - 0.5, max(r_multiples) + 0.5, 0.5)
    ax2.hist(r_multiples, bins=bins, edgecolor='black', alpha=0.7)
    ax2.axvline(x=0, color='black', linestyle='-', linewidth=0.5)
    ax2.axvline(x=np.mean(r_multiples), color='blue', linestyle='--', 
                label=f'Mean: {np.mean(r_multiples):.2f}R')
    ax2.set_xlabel('R-Multiple')
    ax2.set_ylabel('Frequency')
    ax2.set_title('R-Multiple Distribution')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    
    plt.suptitle(title, fontsize=14, fontweight='bold')
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"Saved trade distribution to {save_path}")
    else:
        plt.show()


def plot_monthly_returns(
    equity_curve: pd.Series,
    title: str = "Monthly Returns",
    save_path: Optional[str] = None,
) -> None:
    """
    Plot monthly returns as a heatmap.
    
    Args:
        equity_curve: Series of equity values with DatetimeIndex
        title: Plot title
        save_path: Optional path to save the figure
    """
    # Calculate monthly returns
    monthly = equity_curve.resample('M').last()
    monthly_returns = monthly.pct_change() * 100
    
    if len(monthly_returns) < 2:
        print("Not enough data for monthly returns")
        return
    
    # Create a pivot table for heatmap
    df = pd.DataFrame({
        'year': monthly_returns.index.year,
        'month': monthly_returns.index.month,
        'return': monthly_returns.values,
    })
    
    pivot = df.pivot(index='year', columns='month', values='return')
    
    # Month labels
    month_labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    
    fig, ax = plt.subplots(figsize=(12, 4))
    
    # Create heatmap
    im = ax.imshow(pivot.values, cmap='RdYlGn', aspect='auto', vmin=-10, vmax=10)
    
    # Labels
    ax.set_xticks(range(12))
    ax.set_xticklabels(month_labels)
    ax.set_yticks(range(len(pivot.index)))
    ax.set_yticklabels(pivot.index)
    
    # Add colorbar
    cbar = fig.colorbar(im, ax=ax, label='Return (%)')
    
    # Add text annotations
    for i in range(len(pivot.index)):
        for j in range(12):
            val = pivot.values[i, j]
            if not np.isnan(val):
                color = 'white' if abs(val) > 5 else 'black'
                ax.text(j, i, f'{val:.1f}', ha='center', va='center', 
                       color=color, fontsize=8)
    
    ax.set_title(title)
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"Saved monthly returns to {save_path}")
    else:
        plt.show()


def create_backtest_report(
    equity_curve: pd.Series,
    trades: List[Dict[str, Any]],
    metrics: Any,
    title: str = "Backtest Report",
    save_path: Optional[str] = None,
) -> None:
    """
    Create a comprehensive backtest report with multiple charts.
    
    Args:
        equity_curve: Series of equity values
        trades: List of trade dictionaries
        metrics: BacktestMetrics object
        title: Report title
        save_path: Optional path to save the figure
    """
    fig = plt.figure(figsize=(16, 12))
    
    # Title
    fig.suptitle(title, fontsize=16, fontweight='bold', y=0.98)
    
    # Layout: 3 rows
    # Row 1: Equity curve (full width)
    ax1 = plt.subplot2grid((3, 2), (0, 0), colspan=2)
    
    # Row 2: Drawdown (left), Trade distribution (right)
    ax2 = plt.subplot2grid((3, 2), (1, 0))
    ax3 = plt.subplot2grid((3, 2), (1, 1))
    
    # Row 3: Statistics (left), R-multiple distribution (right)
    ax4 = plt.subplot2grid((3, 2), (2, 0))
    ax5 = plt.subplot2grid((3, 2), (2, 1))
    
    # 1. Equity Curve
    initial = equity_curve.iloc[0] if len(equity_curve) > 0 else 100000
    ax1.plot(equity_curve.index, equity_curve.values, 'b-', linewidth=1.5)
    ax1.axhline(y=initial, color='gray', linestyle='--', alpha=0.7)
    ax1.fill_between(
        equity_curve.index, initial, equity_curve.values,
        where=equity_curve.values >= initial, alpha=0.3, color='green'
    )
    ax1.fill_between(
        equity_curve.index, initial, equity_curve.values,
        where=equity_curve.values < initial, alpha=0.3, color='red'
    )
    ax1.set_title('Equity Curve')
    ax1.set_ylabel('Equity ($)')
    ax1.grid(True, alpha=0.3)
    
    # 2. Drawdown
    running_max = equity_curve.expanding().max()
    drawdown = (equity_curve - running_max) / running_max * 100
    ax2.fill_between(drawdown.index, 0, drawdown.values, alpha=0.7, color='red')
    ax2.set_title('Drawdown')
    ax2.set_ylabel('Drawdown (%)')
    ax2.grid(True, alpha=0.3)
    
    # 3. Trade P&L
    if trades:
        pnls = [t.get('pnl', 0) for t in trades if 'pnl' in t]
        colors = ['green' if p > 0 else 'red' for p in pnls]
        ax3.bar(range(len(pnls)), pnls, color=colors, alpha=0.7)
        ax3.axhline(y=0, color='black', linestyle='-', linewidth=0.5)
    ax3.set_title('Trade P&L')
    ax3.set_xlabel('Trade #')
    ax3.set_ylabel('P&L ($)')
    ax3.grid(True, alpha=0.3)
    
    # 4. Statistics text
    ax4.axis('off')
    stats_text = f"""
    PERFORMANCE METRICS
    ─────────────────────────────
    Total Trades:      {metrics.total_trades}
    Win Rate:          {metrics.win_rate:.1%}
    Profit Factor:     {metrics.profit_factor:.2f}
    
    Avg Win:           ${metrics.avg_win:.2f}
    Avg Loss:          ${metrics.avg_loss:.2f}
    Expectancy:        ${metrics.expectancy:.2f}
    
    Avg R-Multiple:    {metrics.avg_r_multiple:.2f}R
    Max Drawdown:      {metrics.max_drawdown:.1%}
    
    Sharpe Ratio:      {metrics.sharpe_ratio:.2f}
    Sortino Ratio:     {metrics.sortino_ratio:.2f}
    
    Total Return:      {metrics.total_return:.1%}
    Total P&L:         ${metrics.total_pnl:.2f}
    """
    ax4.text(0.1, 0.9, stats_text, transform=ax4.transAxes, fontsize=10,
             verticalalignment='top', fontfamily='monospace',
             bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.5))
    
    # 5. R-Multiple distribution
    if trades:
        r_multiples = [t.get('r_multiple', 0) for t in trades if 'r_multiple' in t]
        if r_multiples:
            ax5.hist(r_multiples, bins=20, edgecolor='black', alpha=0.7)
            ax5.axvline(x=0, color='black', linestyle='-', linewidth=0.5)
            ax5.axvline(x=np.mean(r_multiples), color='blue', linestyle='--')
    ax5.set_title('R-Multiple Distribution')
    ax5.set_xlabel('R-Multiple')
    ax5.set_ylabel('Frequency')
    ax5.grid(True, alpha=0.3)
    
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"Saved backtest report to {save_path}")
    else:
        plt.show()

