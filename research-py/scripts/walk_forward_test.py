#!/usr/bin/env python3
"""
Walk-Forward Optimization Script

This script performs walk-forward analysis to find optimal strategy parameters
while avoiding overfitting. It splits historical data into train/test windows,
optimizes on training data, and validates on test data.

Usage:
    python scripts/walk_forward_test.py --data data/nifty_1h.csv --strategy confluence
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple, Any
from datetime import datetime
from dataclasses import dataclass, asdict

import pandas as pd
import numpy as np
from itertools import product

# Add repo root to path so that `src.*` package imports resolve.
# The previous version added `<repo>/research-py/src` to sys.path and then
# imported `src.backtesting...`, which can never resolve.
import sys
from pathlib import Path
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))

from src.data.loaders import load_csv
from src.backtesting.engine import BacktestEngine, BacktestConfig
from src.patterns.confluence_zone import ConfluenceZonePattern
from src.patterns.base import BasePattern


@dataclass
class ParameterRange:
    """Defines a parameter and its search range"""
    name: str
    values: List[Any]


@dataclass
class OptimizationResult:
    """Result of a single optimization run"""
    params: Dict[str, Any]
    train_metrics: Dict[str, float]
    test_metrics: Dict[str, float]
    train_period: Tuple[str, str]
    test_period: Tuple[str, str]


@dataclass
class WalkForwardResult:
    """Complete walk-forward analysis result"""
    strategy: str
    windows: List[OptimizationResult]
    best_params: Dict[str, Any]
    average_test_sharpe: float
    average_test_winrate: float
    average_test_profit_factor: float
    robustness_score: float  # How consistent across windows


class WalkForwardOptimizer:
    """
    Walk-Forward Optimization Engine
    
    Performs out-of-sample testing with rolling windows to find
    robust parameters that generalize well.
    """
    
    def __init__(
        self,
        data: pd.DataFrame,
        train_pct: float = 0.7,
        n_windows: int = 4,
        min_trades: int = 20
    ):
        self.data = data
        self.train_pct = train_pct
        self.n_windows = n_windows
        self.min_trades = min_trades
        
    def generate_windows(self) -> List[Tuple[pd.DataFrame, pd.DataFrame]]:
        """Generate train/test windows using anchored walk-forward"""
        total_len = len(self.data)
        window_size = total_len // self.n_windows
        
        windows = []
        for i in range(self.n_windows):
            # Expanding window approach
            train_end = window_size * (i + 1)
            train_start = 0  # Anchored to start
            
            test_start = train_end
            test_end = min(test_start + window_size, total_len)
            
            if test_end > test_start:
                train_data = self.data.iloc[train_start:train_end].copy()
                test_data = self.data.iloc[test_start:test_end].copy()
                windows.append((train_data, test_data))
        
        return windows
    
    def generate_param_grid(
        self, 
        param_ranges: List[ParameterRange]
    ) -> List[Dict[str, Any]]:
        """Generate all parameter combinations"""
        names = [pr.name for pr in param_ranges]
        values = [pr.values for pr in param_ranges]
        
        combinations = list(product(*values))
        return [dict(zip(names, combo)) for combo in combinations]
    
    def create_pattern(
        self,
        strategy_name: str,
        params: Dict[str, Any]
    ) -> BasePattern:
        """Create pattern instance with given parameters"""
        if strategy_name == 'confluence':
            # The constructor takes a config dict; the individual keyword
            # arguments below are the names used by the parameter grid.
            config = {
                'min_confluence_factors': params.get('min_confluence', 2),
                'sr_zone_lookback': params.get('sr_lookback', 100),
                'min_rejection_wick_ratio': params.get('min_wick_ratio', 2.0),
                'target_rr': params.get('target_rr', 2.0),
            }
            return ConfluenceZonePattern(config)
        else:
            # Default to confluence
            return ConfluenceZonePattern()
    
    def run_backtest(
        self,
        data: pd.DataFrame,
        strategy_name: str,
        params: Dict[str, Any]
    ) -> Tuple[float, Dict[str, float]]:
        """Run backtest with given parameters and return metrics"""
        try:
            config = BacktestConfig(initial_capital=100000)
            engine = BacktestEngine(config)
            
            # Create pattern with params
            pattern = self.create_pattern(strategy_name, params)
            
            # Run backtest
            result = engine.run(pattern, data)
            
            if len(result.trades) < self.min_trades:
                return -999, {}  # Not enough trades
            
            # Extract metrics
            metrics = {
                'sharpe_ratio': result.metrics.sharpe_ratio if hasattr(result.metrics, 'sharpe_ratio') else 0,
                'win_rate': result.metrics.win_rate if hasattr(result.metrics, 'win_rate') else 0,
                'profit_factor': result.metrics.profit_factor if hasattr(result.metrics, 'profit_factor') else 0,
                'total_return': result.metrics.total_return if hasattr(result.metrics, 'total_return') else 0,
                'max_drawdown': result.metrics.max_drawdown if hasattr(result.metrics, 'max_drawdown') else 0,
            }
            
            # Primary objective: Sharpe ratio
            sharpe = metrics.get('sharpe_ratio', 0)
            if np.isnan(sharpe) or np.isinf(sharpe):
                sharpe = -999
                
            return sharpe, metrics
            
        except Exception as e:
            print(f"  Backtest error: {e}")
            return -999, {}
    
    def optimize_window(
        self,
        train_data: pd.DataFrame,
        test_data: pd.DataFrame,
        strategy_name: str,
        param_grid: List[Dict[str, Any]],
        verbose: bool = True
    ) -> OptimizationResult:
        """Optimize on train data, validate on test data"""
        
        best_train_sharpe = -999
        best_params = param_grid[0]
        best_train_metrics = {}
        
        # Find best params on training data
        for i, params in enumerate(param_grid):
            sharpe, metrics = self.run_backtest(train_data, strategy_name, params)
            
            if verbose and i % 10 == 0:
                print(f"  Testing param set {i+1}/{len(param_grid)}: Sharpe={sharpe:.2f}")
            
            if sharpe > best_train_sharpe:
                best_train_sharpe = sharpe
                best_params = params
                best_train_metrics = metrics
        
        # Validate on test data
        test_sharpe, test_metrics = self.run_backtest(
            test_data, strategy_name, best_params
        )
        
        train_period = (
            train_data.index[0].strftime('%Y-%m-%d') if hasattr(train_data.index[0], 'strftime') 
            else str(train_data.index[0]),
            train_data.index[-1].strftime('%Y-%m-%d') if hasattr(train_data.index[-1], 'strftime')
            else str(train_data.index[-1])
        )
        test_period = (
            test_data.index[0].strftime('%Y-%m-%d') if hasattr(test_data.index[0], 'strftime')
            else str(test_data.index[0]),
            test_data.index[-1].strftime('%Y-%m-%d') if hasattr(test_data.index[-1], 'strftime')
            else str(test_data.index[-1])
        )
        
        return OptimizationResult(
            params=best_params,
            train_metrics=best_train_metrics,
            test_metrics=test_metrics,
            train_period=train_period,
            test_period=test_period
        )
    
    def run(
        self,
        strategy_name: str,
        param_ranges: List[ParameterRange],
        verbose: bool = True
    ) -> WalkForwardResult:
        """Run complete walk-forward optimization"""
        
        windows = self.generate_windows()
        param_grid = self.generate_param_grid(param_ranges)
        
        if verbose:
            print(f"\n{'='*60}")
            print(f"Walk-Forward Optimization")
            print(f"Strategy: {strategy_name}")
            print(f"Windows: {len(windows)}")
            print(f"Parameter combinations: {len(param_grid)}")
            print(f"{'='*60}\n")
        
        results = []
        
        for i, (train_data, test_data) in enumerate(windows):
            if verbose:
                print(f"\nWindow {i+1}/{len(windows)}")
                print(f"  Train: {len(train_data)} candles")
                print(f"  Test: {len(test_data)} candles")
            
            result = self.optimize_window(
                train_data, test_data, strategy_name, param_grid, verbose
            )
            results.append(result)
            
            if verbose:
                print(f"  Best params: {result.params}")
                print(f"  Train Sharpe: {result.train_metrics.get('sharpe_ratio', 0):.2f}")
                print(f"  Test Sharpe: {result.test_metrics.get('sharpe_ratio', 0):.2f}")
        
        # Aggregate results
        test_sharpes = [r.test_metrics.get('sharpe_ratio', 0) for r in results]
        test_winrates = [r.test_metrics.get('win_rate', 0) for r in results]
        test_pfs = [r.test_metrics.get('profit_factor', 0) for r in results]
        
        # Find most common best params
        param_counts = {}
        for r in results:
            key = json.dumps(r.params, sort_keys=True)
            param_counts[key] = param_counts.get(key, 0) + 1
        
        most_common_params = json.loads(max(param_counts, key=param_counts.get))
        
        # Robustness score: consistency across windows
        sharpe_std = np.std(test_sharpes) if len(test_sharpes) > 1 else 0
        robustness = 1 / (1 + sharpe_std)  # Higher is better
        
        return WalkForwardResult(
            strategy=strategy_name,
            windows=results,
            best_params=most_common_params,
            average_test_sharpe=np.mean(test_sharpes),
            average_test_winrate=np.mean(test_winrates),
            average_test_profit_factor=np.mean(test_pfs),
            robustness_score=robustness
        )


# Strategy-specific parameter ranges
CONFLUENCE_PARAMS = [
    ParameterRange('sr_lookback', [50, 75, 100, 125, 150, 200]),
    ParameterRange('min_confluence', [2, 3]),
    ParameterRange('min_wick_ratio', [1.5, 2.0, 2.5, 3.0]),
    ParameterRange('target_rr', [1.5, 2.0, 2.5, 3.0]),
]

TRENDLINE_PARAMS = [
    ParameterRange('lookback', [50, 75, 100]),
    ParameterRange('min_touches', [2, 3]),
    ParameterRange('min_strength', [0.5, 0.7, 0.9]),
]

FIB_PARAMS = [
    ParameterRange('swing_lookback', [20, 30, 50]),
    ParameterRange('fib_tolerance', [0.01, 0.02, 0.03]),
    ParameterRange('target_rr', [1.5, 2.0, 2.5]),
]


def main():
    parser = argparse.ArgumentParser(description='Walk-Forward Optimization')
    parser.add_argument('--data', type=str, required=True, help='Path to CSV data file')
    parser.add_argument('--strategy', type=str, default='confluence', 
                       choices=['confluence', 'trendline', 'fib', 'sr_retest'],
                       help='Strategy to optimize')
    parser.add_argument('--windows', type=int, default=4, help='Number of walk-forward windows')
    parser.add_argument('--train-pct', type=float, default=0.7, help='Training percentage per window')
    parser.add_argument('--output', type=str, help='Output JSON file for results')
    
    args = parser.parse_args()
    
    # Load data
    print(f"Loading data from {args.data}...")
    data = load_csv(args.data)
    print(f"Loaded {len(data)} candles")
    
    # Select parameter ranges
    param_map = {
        'confluence': CONFLUENCE_PARAMS,
        'trendline': TRENDLINE_PARAMS,
        'fib': FIB_PARAMS,
    }
    param_ranges = param_map.get(args.strategy, CONFLUENCE_PARAMS)
    
    # Run optimization
    optimizer = WalkForwardOptimizer(
        data=data,
        train_pct=args.train_pct,
        n_windows=args.windows
    )
    
    result = optimizer.run(args.strategy, param_ranges)
    
    # Print summary
    print(f"\n{'='*60}")
    print("WALK-FORWARD OPTIMIZATION RESULTS")
    print(f"{'='*60}")
    print(f"\nStrategy: {result.strategy}")
    print(f"\nBest Parameters (most consistent across windows):")
    for key, value in result.best_params.items():
        print(f"  {key}: {value}")
    
    print(f"\nOut-of-Sample Performance (averages):")
    print(f"  Sharpe Ratio: {result.average_test_sharpe:.2f}")
    print(f"  Win Rate: {result.average_test_winrate:.1%}")
    print(f"  Profit Factor: {result.average_test_profit_factor:.2f}")
    print(f"  Robustness Score: {result.robustness_score:.2f}")
    
    print(f"\nWindow-by-Window Results:")
    for i, window in enumerate(result.windows):
        print(f"\n  Window {i+1}:")
        print(f"    Train: {window.train_period[0]} to {window.train_period[1]}")
        print(f"    Test: {window.test_period[0]} to {window.test_period[1]}")
        print(f"    Train Sharpe: {window.train_metrics.get('sharpe_ratio', 0):.2f}")
        print(f"    Test Sharpe: {window.test_metrics.get('sharpe_ratio', 0):.2f}")
    
    # Save to file if requested
    if args.output:
        output_data = {
            'strategy': result.strategy,
            'best_params': result.best_params,
            'average_test_sharpe': result.average_test_sharpe,
            'average_test_winrate': result.average_test_winrate,
            'average_test_profit_factor': result.average_test_profit_factor,
            'robustness_score': result.robustness_score,
            'windows': [
                {
                    'params': w.params,
                    'train_period': w.train_period,
                    'test_period': w.test_period,
                    'train_sharpe': w.train_metrics.get('sharpe_ratio', 0),
                    'test_sharpe': w.test_metrics.get('sharpe_ratio', 0),
                }
                for w in result.windows
            ],
            'timestamp': datetime.now().isoformat(),
        }
        
        with open(args.output, 'w') as f:
            json.dump(output_data, f, indent=2)
        print(f"\nResults saved to {args.output}")


if __name__ == '__main__':
    main()

