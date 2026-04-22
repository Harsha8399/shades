"""
Parameter optimization using vectorbt.

This module provides vectorized backtesting for fast parameter optimization.
It can test thousands of parameter combinations in parallel.

Usage:
    from optimization.vectorbt_optimizer import optimize_pattern
    
    results = optimize_pattern(
        data=df,
        pattern_class=ConfluenceZonePattern,
        param_grid={
            'atr_multiplier': [1.5, 2.0, 2.5, 3.0],
            'min_confluence': [2, 3, 4],
            'target_rr': [1.5, 2.0, 2.5, 3.0],
        }
    )
"""
import pandas as pd
import numpy as np
from itertools import product
from typing import Dict, List, Any, Type, Optional, Tuple
from dataclasses import dataclass
import warnings

# Try to import vectorbt
try:
    import vectorbt as vbt
    HAS_VECTORBT = True
except ImportError:
    HAS_VECTORBT = False
    print("Warning: vectorbt not installed. Using fallback optimization.")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.patterns.base import BasePattern
from src.backtesting.engine import BacktestEngine, BacktestConfig


@dataclass
class OptimizationResult:
    """Results from parameter optimization."""
    best_params: Dict[str, Any]
    best_sharpe: float
    best_returns: float
    all_results: pd.DataFrame
    param_grid: Dict[str, List[Any]]


def generate_param_combinations(param_grid: Dict[str, List[Any]]) -> List[Dict[str, Any]]:
    """Generate all combinations of parameters."""
    keys = list(param_grid.keys())
    values = list(param_grid.values())
    
    combinations = []
    for combo in product(*values):
        combinations.append(dict(zip(keys, combo)))
    
    return combinations


def optimize_pattern_fallback(
    data: pd.DataFrame,
    pattern_class: Type[BasePattern],
    param_grid: Dict[str, List[Any]],
    symbol: str = "TEST",
    config: Optional[BacktestConfig] = None,
    n_jobs: int = 1,
) -> OptimizationResult:
    """
    Fallback optimization using sequential backtesting.
    
    This is slower than vectorbt but works without the dependency.
    """
    combinations = generate_param_combinations(param_grid)
    print(f"Testing {len(combinations)} parameter combinations...")
    
    results = []
    
    for i, params in enumerate(combinations):
        if (i + 1) % 10 == 0:
            print(f"  Progress: {i + 1}/{len(combinations)}")
        
        try:
            # Create pattern with parameters
            pattern = pattern_class(**params)
            
            # Run backtest
            engine = BacktestEngine(config)
            result = engine.run(pattern, data, symbol)
            
            # Store results
            results.append({
                **params,
                'sharpe': result.metrics.sharpe_ratio,
                'sortino': result.metrics.sortino_ratio,
                'total_return': result.metrics.total_return,
                'max_drawdown': result.metrics.max_drawdown,
                'profit_factor': result.metrics.profit_factor,
                'win_rate': result.metrics.win_rate,
                'total_trades': result.metrics.total_trades,
                'total_pnl': result.metrics.total_pnl,
            })
        except Exception as e:
            print(f"  Error with params {params}: {e}")
            continue
    
    if not results:
        raise ValueError("No successful backtests")
    
    # Convert to DataFrame
    results_df = pd.DataFrame(results)
    
    # Find best by Sharpe
    best_idx = results_df['sharpe'].idxmax()
    best_row = results_df.loc[best_idx]
    
    best_params = {k: best_row[k] for k in param_grid.keys()}
    
    return OptimizationResult(
        best_params=best_params,
        best_sharpe=best_row['sharpe'],
        best_returns=best_row['total_return'],
        all_results=results_df,
        param_grid=param_grid,
    )


def optimize_pattern_vectorbt(
    data: pd.DataFrame,
    pattern_class: Type[BasePattern],
    param_grid: Dict[str, List[Any]],
    symbol: str = "TEST",
) -> OptimizationResult:
    """
    Vectorized parameter optimization using vectorbt.
    
    This is much faster for large parameter grids.
    """
    if not HAS_VECTORBT:
        raise ImportError("vectorbt not installed")
    
    combinations = generate_param_combinations(param_grid)
    print(f"Testing {len(combinations)} parameter combinations with vectorbt...")
    
    # For each combination, generate entry/exit signals
    all_entries = []
    all_exits = []
    param_names = []
    
    for params in combinations:
        try:
            pattern = pattern_class(**params)
            
            # Generate signals for entire dataset
            entries, exits = _generate_signals_vectorized(pattern, data, symbol)
            
            all_entries.append(entries)
            all_exits.append(exits)
            param_names.append(str(params))
        except Exception as e:
            print(f"Error generating signals for {params}: {e}")
            continue
    
    if not all_entries:
        raise ValueError("No valid signal generations")
    
    # Stack signals
    entries_matrix = np.column_stack(all_entries)
    exits_matrix = np.column_stack(all_exits)
    
    # Run vectorbt portfolio simulation
    close = data['close'].values
    
    portfolio = vbt.Portfolio.from_signals(
        close=np.tile(close.reshape(-1, 1), len(all_entries)),
        entries=entries_matrix,
        exits=exits_matrix,
        init_cash=100000,
        fees=0.001,
        slippage=0.0005,
    )
    
    # Get metrics
    sharpe = portfolio.sharpe_ratio()
    returns = portfolio.total_return()
    max_dd = portfolio.max_drawdown()
    
    # Build results DataFrame
    results = []
    for i, (params, name) in enumerate(zip(combinations[:len(all_entries)], param_names)):
        results.append({
            **params,
            'sharpe': sharpe[i] if not np.isnan(sharpe[i]) else 0,
            'total_return': returns[i] if not np.isnan(returns[i]) else 0,
            'max_drawdown': max_dd[i] if not np.isnan(max_dd[i]) else 0,
        })
    
    results_df = pd.DataFrame(results)
    
    # Find best
    best_idx = results_df['sharpe'].idxmax()
    best_row = results_df.loc[best_idx]
    best_params = {k: best_row[k] for k in param_grid.keys()}
    
    return OptimizationResult(
        best_params=best_params,
        best_sharpe=best_row['sharpe'],
        best_returns=best_row['total_return'],
        all_results=results_df,
        param_grid=param_grid,
    )


def _generate_signals_vectorized(
    pattern: BasePattern,
    data: pd.DataFrame,
    symbol: str,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate entry/exit signals for entire dataset.
    
    Returns boolean arrays for entries and exits.
    """
    n = len(data)
    entries = np.zeros(n, dtype=bool)
    exits = np.zeros(n, dtype=bool)
    
    required_bars = pattern.get_required_bars()
    
    in_position = False
    entry_price = 0
    stop_loss = 0
    target = 0
    direction = None
    
    for i in range(required_bars, n):
        current_bar = data.iloc[i]
        
        if in_position:
            # Check exit conditions
            if direction == 'LONG':
                if current_bar['low'] <= stop_loss:
                    exits[i] = True
                    in_position = False
                elif current_bar['high'] >= target:
                    exits[i] = True
                    in_position = False
            else:  # SHORT
                if current_bar['high'] >= stop_loss:
                    exits[i] = True
                    in_position = False
                elif current_bar['low'] <= target:
                    exits[i] = True
                    in_position = False
        else:
            # Check for entry signal
            history = data.iloc[max(0, i - required_bars):i + 1]
            signal = pattern.detect_signal(history, symbol)
            
            if signal is not None:
                entries[i] = True
                in_position = True
                entry_price = signal.entry_price
                stop_loss = signal.stop_loss
                target = signal.target
                direction = signal.direction
    
    return entries, exits


def optimize_pattern(
    data: pd.DataFrame,
    pattern_class: Type[BasePattern],
    param_grid: Dict[str, List[Any]],
    symbol: str = "TEST",
    config: Optional[BacktestConfig] = None,
    use_vectorbt: bool = True,
) -> OptimizationResult:
    """
    Optimize pattern parameters.
    
    Args:
        data: OHLCV DataFrame
        pattern_class: Pattern class to optimize
        param_grid: Dictionary of parameter names to lists of values
        symbol: Trading symbol
        config: Backtest configuration
        use_vectorbt: Whether to use vectorbt (faster) or fallback
    
    Returns:
        OptimizationResult with best parameters and all results
    """
    if use_vectorbt and HAS_VECTORBT:
        try:
            return optimize_pattern_vectorbt(data, pattern_class, param_grid, symbol)
        except Exception as e:
            print(f"vectorbt optimization failed: {e}")
            print("Falling back to sequential optimization...")
    
    return optimize_pattern_fallback(data, pattern_class, param_grid, symbol, config)


def plot_optimization_results(results: OptimizationResult, param_x: str, param_y: str):
    """
    Plot heatmap of optimization results.
    
    Args:
        results: OptimizationResult from optimize_pattern
        param_x: Parameter name for x-axis
        param_y: Parameter name for y-axis
    """
    import matplotlib.pyplot as plt
    import seaborn as sns
    
    df = results.all_results
    
    # Create pivot table for heatmap
    pivot = df.pivot_table(
        values='sharpe',
        index=param_y,
        columns=param_x,
        aggfunc='mean'
    )
    
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # Sharpe heatmap
    sns.heatmap(
        pivot,
        ax=axes[0],
        annot=True,
        fmt='.2f',
        cmap='RdYlGn',
        center=0,
    )
    axes[0].set_title(f'Sharpe Ratio by {param_x} vs {param_y}')
    
    # Returns heatmap
    pivot_returns = df.pivot_table(
        values='total_return',
        index=param_y,
        columns=param_x,
        aggfunc='mean'
    )
    
    sns.heatmap(
        pivot_returns,
        ax=axes[1],
        annot=True,
        fmt='.1%',
        cmap='RdYlGn',
        center=0,
    )
    axes[1].set_title(f'Total Return by {param_x} vs {param_y}')
    
    plt.tight_layout()
    return fig


def walk_forward_validation(
    data: pd.DataFrame,
    pattern_class: Type[BasePattern],
    param_grid: Dict[str, List[Any]],
    symbol: str = "TEST",
    train_ratio: float = 0.7,
    n_folds: int = 5,
) -> pd.DataFrame:
    """
    Perform walk-forward validation to detect overfitting.
    
    Splits data into train/test folds, optimizes on train,
    evaluates on test.
    
    Args:
        data: OHLCV DataFrame
        pattern_class: Pattern class to optimize
        param_grid: Parameter grid
        symbol: Trading symbol
        train_ratio: Ratio of data for training in each fold
        n_folds: Number of walk-forward folds
    
    Returns:
        DataFrame with in-sample and out-of-sample results
    """
    n = len(data)
    fold_size = n // n_folds
    
    results = []
    
    for fold in range(n_folds):
        print(f"\n=== Fold {fold + 1}/{n_folds} ===")
        
        # Calculate fold boundaries
        start_idx = fold * fold_size
        end_idx = min(start_idx + fold_size, n)
        
        if end_idx - start_idx < 200:
            print("Fold too small, skipping")
            continue
        
        fold_data = data.iloc[start_idx:end_idx]
        
        # Split into train/test
        train_size = int(len(fold_data) * train_ratio)
        train_data = fold_data.iloc[:train_size]
        test_data = fold_data.iloc[train_size:]
        
        print(f"Train: {len(train_data)} bars, Test: {len(test_data)} bars")
        
        # Optimize on train
        try:
            opt_result = optimize_pattern(
                train_data, pattern_class, param_grid, symbol, use_vectorbt=False
            )
            
            # Evaluate on test with best params
            pattern = pattern_class(**opt_result.best_params)
            engine = BacktestEngine()
            test_result = engine.run(pattern, test_data, symbol)
            
            results.append({
                'fold': fold + 1,
                **opt_result.best_params,
                'train_sharpe': opt_result.best_sharpe,
                'train_return': opt_result.best_returns,
                'test_sharpe': test_result.metrics.sharpe_ratio,
                'test_return': test_result.metrics.total_return,
                'overfit_ratio': opt_result.best_sharpe / max(test_result.metrics.sharpe_ratio, 0.01),
            })
        except Exception as e:
            print(f"Error in fold {fold + 1}: {e}")
            continue
    
    return pd.DataFrame(results)


# CLI entry point
if __name__ == "__main__":
    import sys
    from src.data.loaders import load_csv
    from src.patterns.confluence_zone import ConfluenceZonePattern
    
    if len(sys.argv) < 2:
        print("Usage: python vectorbt_optimizer.py <csv_file>")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    
    print("Loading data...")
    data = load_csv(csv_path)
    print(f"Loaded {len(data)} bars")
    
    # Example parameter grid
    param_grid = {
        'atr_multiplier': [1.5, 2.0, 2.5],
        'min_confluence': [2, 3],
    }
    
    print("\nOptimizing parameters...")
    result = optimize_pattern(
        data,
        ConfluenceZonePattern,
        param_grid,
        use_vectorbt=False,  # Use fallback for reliability
    )
    
    print("\n" + "=" * 50)
    print("OPTIMIZATION RESULTS")
    print("=" * 50)
    print(f"Best Parameters: {result.best_params}")
    print(f"Best Sharpe: {result.best_sharpe:.2f}")
    print(f"Best Return: {result.best_returns:.1%}")
    print("\nAll Results:")
    print(result.all_results.to_string())

