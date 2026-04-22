#!/usr/bin/env python3
"""
Run parameter optimization on trading patterns.

This script optimizes pattern parameters using the downloaded historical data
and generates reports on the best configurations.

Usage:
    python run_optimization.py                    # Run all
    python run_optimization.py --pattern confluence  # Specific pattern
    python run_optimization.py --walk-forward     # With walk-forward validation
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data.loaders import load_csv
from src.patterns.confluence_zone import ConfluenceZonePattern
from src.optimization.vectorbt_optimizer import (
    optimize_pattern,
    walk_forward_validation,
    plot_optimization_results,
    OptimizationResult,
)


def get_pattern_configs():
    """Get optimization configurations for each pattern."""
    return {
        'confluence_zone': {
            'class': ConfluenceZonePattern,
            'param_grid': {
                'atr_multiplier': [1.5, 2.0, 2.5, 3.0],
                'min_confluence': [2, 3, 4],
            },
        },
        # Add more patterns as they're implemented in Python
    }


def run_single_optimization(
    pattern_name: str,
    pattern_config: dict,
    data: pd.DataFrame,
    symbol: str,
    output_dir: Path,
) -> OptimizationResult:
    """Run optimization for a single pattern."""
    print(f"\n{'='*60}")
    print(f"Optimizing: {pattern_name}")
    print(f"{'='*60}")
    print(f"Parameter grid: {pattern_config['param_grid']}")
    
    n_combinations = 1
    for values in pattern_config['param_grid'].values():
        n_combinations *= len(values)
    print(f"Total combinations: {n_combinations}")
    
    result = optimize_pattern(
        data=data,
        pattern_class=pattern_config['class'],
        param_grid=pattern_config['param_grid'],
        symbol=symbol,
        use_vectorbt=False,  # Use fallback for reliability
    )
    
    print(f"\nBest Parameters: {result.best_params}")
    print(f"Best Sharpe: {result.best_sharpe:.2f}")
    print(f"Best Return: {result.best_returns:.1%}")
    
    # Save results
    csv_path = output_dir / f'{pattern_name}_optimization.csv'
    result.all_results.to_csv(csv_path, index=False)
    print(f"Results saved to {csv_path}")
    
    # Generate heatmap if we have 2 parameters
    param_names = list(pattern_config['param_grid'].keys())
    if len(param_names) >= 2:
        try:
            fig = plot_optimization_results(result, param_names[0], param_names[1])
            plot_path = output_dir / f'{pattern_name}_heatmap.png'
            fig.savefig(plot_path, dpi=150, bbox_inches='tight')
            plt.close(fig)
            print(f"Heatmap saved to {plot_path}")
        except Exception as e:
            print(f"Could not generate heatmap: {e}")
    
    return result


def run_walk_forward(
    pattern_name: str,
    pattern_config: dict,
    data: pd.DataFrame,
    symbol: str,
    output_dir: Path,
) -> pd.DataFrame:
    """Run walk-forward validation for a pattern."""
    print(f"\n{'='*60}")
    print(f"Walk-Forward Validation: {pattern_name}")
    print(f"{'='*60}")
    
    results = walk_forward_validation(
        data=data,
        pattern_class=pattern_config['class'],
        param_grid=pattern_config['param_grid'],
        symbol=symbol,
        train_ratio=0.7,
        n_folds=3,  # Fewer folds for faster execution
    )
    
    if len(results) > 0:
        print("\nWalk-Forward Results:")
        print(results.to_string())
        
        # Calculate summary
        avg_overfit = results['overfit_ratio'].mean()
        avg_train_sharpe = results['train_sharpe'].mean()
        avg_test_sharpe = results['test_sharpe'].mean()
        
        print(f"\nSummary:")
        print(f"  Avg Train Sharpe: {avg_train_sharpe:.2f}")
        print(f"  Avg Test Sharpe:  {avg_test_sharpe:.2f}")
        print(f"  Avg Overfit Ratio: {avg_overfit:.2f}x")
        
        if avg_overfit > 2:
            print("  ⚠️  WARNING: High overfit ratio suggests parameter overfitting")
        else:
            print("  ✅ Overfit ratio is acceptable")
        
        # Save
        csv_path = output_dir / f'{pattern_name}_walk_forward.csv'
        results.to_csv(csv_path, index=False)
        print(f"\nResults saved to {csv_path}")
    
    return results


def main():
    parser = argparse.ArgumentParser(description='Run parameter optimization')
    parser.add_argument('--pattern', type=str, help='Specific pattern to optimize')
    parser.add_argument('--symbol', type=str, default='btc_usdt_1h', help='Data file to use')
    parser.add_argument('--walk-forward', action='store_true', help='Run walk-forward validation')
    parser.add_argument('--data-dir', type=str, default=None)
    parser.add_argument('--output-dir', type=str, default=None)
    
    args = parser.parse_args()
    
    # Set directories
    base_dir = Path(__file__).parent.parent
    data_dir = Path(args.data_dir) if args.data_dir else base_dir / 'data'
    output_dir = Path(args.output_dir) if args.output_dir else base_dir / 'results'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 60)
    print("PARAMETER OPTIMIZATION")
    print("=" * 60)
    print(f"Data directory: {data_dir}")
    print(f"Output directory: {output_dir}")
    
    # Load data
    data_file = data_dir / f"{args.symbol}.csv"
    if not data_file.exists():
        print(f"Data file not found: {data_file}")
        print("Available files:")
        for f in data_dir.glob('*.csv'):
            print(f"  - {f.stem}")
        sys.exit(1)
    
    print(f"Loading: {data_file}")
    data = load_csv(str(data_file))
    print(f"Loaded {len(data)} bars from {data.index[0]} to {data.index[-1]}")
    
    # Get pattern configs
    all_configs = get_pattern_configs()
    
    # Filter by pattern if specified
    if args.pattern:
        filtered = {k: v for k, v in all_configs.items() if args.pattern.lower() in k.lower()}
        if not filtered:
            print(f"Pattern not found: {args.pattern}")
            print(f"Available: {list(all_configs.keys())}")
            sys.exit(1)
        all_configs = filtered
    
    # Run optimizations
    all_results = {}
    
    for pattern_name, config in all_configs.items():
        try:
            if args.walk_forward:
                result = run_walk_forward(pattern_name, config, data, args.symbol, output_dir)
            else:
                result = run_single_optimization(pattern_name, config, data, args.symbol, output_dir)
            all_results[pattern_name] = result
        except Exception as e:
            print(f"Error optimizing {pattern_name}: {e}")
            import traceback
            traceback.print_exc()
    
    # Final summary
    print("\n" + "=" * 60)
    print("OPTIMIZATION COMPLETE")
    print("=" * 60)
    
    for pattern_name, result in all_results.items():
        if isinstance(result, OptimizationResult):
            print(f"\n{pattern_name}:")
            print(f"  Best Params: {result.best_params}")
            print(f"  Best Sharpe: {result.best_sharpe:.2f}")
            print(f"  Best Return: {result.best_returns:.1%}")
    
    print(f"\nResults saved to: {output_dir}")


if __name__ == '__main__':
    main()

