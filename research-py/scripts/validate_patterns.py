#!/usr/bin/env python3
"""
Validate all trading patterns on historical data.

Runs backtests on each pattern across BTC and ETH data,
generates comparison metrics, and saves results.

Usage:
    python validate_patterns.py                    # Run all validations
    python validate_patterns.py --pattern confluence  # Specific pattern
    python validate_patterns.py --report           # Generate HTML report
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

import pandas as pd
import numpy as np

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data.loaders import load_csv
from src.backtesting.engine import BacktestEngine, BacktestConfig, BacktestResult
from src.backtesting.metrics import BacktestMetrics
from src.patterns.base import BasePattern
from src.patterns.confluence_zone import ConfluenceZonePattern

# Try to import quantstats for reports
try:
    import quantstats as qs
    HAS_QUANTSTATS = True
except ImportError:
    HAS_QUANTSTATS = False


def get_all_patterns() -> List[BasePattern]:
    """Get all available patterns for testing."""
    return [
        ConfluenceZonePattern(),
        # Add more patterns as they're implemented in Python
        # TrendlineBreakPattern(),
        # FibPullbackPattern(),
        # SRRetestPattern(),
    ]


def get_all_data_files(data_dir: Path) -> Dict[str, Path]:
    """Get all available data files."""
    files = {}
    
    for f in data_dir.glob('*.csv'):
        # Skip sample file
        if 'sample' in f.name:
            continue
        files[f.stem] = f
    
    return files


def run_validation(
    pattern: BasePattern,
    data: pd.DataFrame,
    symbol: str,
    config: BacktestConfig = None,
) -> BacktestResult:
    """
    Run validation backtest for a pattern.
    
    Args:
        pattern: Pattern to test
        data: OHLCV DataFrame
        symbol: Symbol name
        config: Backtest configuration
    
    Returns:
        BacktestResult
    """
    if config is None:
        config = BacktestConfig(
            initial_capital=100_000,
            risk_per_trade=0.01,  # 1%
            max_open_trades=3,
            commission=0.001,
            slippage=0.0005,
        )
    
    engine = BacktestEngine(config)
    return engine.run(pattern, data, symbol)


def format_results_table(results: List[Dict[str, Any]]) -> str:
    """Format results as a nice ASCII table."""
    if not results:
        return "No results"
    
    # Headers
    headers = [
        'Pattern', 'Symbol', 'Trades', 'Win Rate', 
        'Profit Factor', 'Sharpe', 'Max DD', 'Total Return'
    ]
    
    # Calculate column widths
    widths = [len(h) for h in headers]
    rows = []
    
    for r in results:
        row = [
            r['pattern'][:20],
            r['symbol'],
            str(r['trades']),
            f"{r['win_rate']:.1%}",
            f"{r['profit_factor']:.2f}",
            f"{r['sharpe']:.2f}",
            f"{r['max_dd']:.1%}",
            f"{r['total_return']:.1%}",
        ]
        rows.append(row)
        
        for i, val in enumerate(row):
            widths[i] = max(widths[i], len(val))
    
    # Build table
    sep = '+' + '+'.join('-' * (w + 2) for w in widths) + '+'
    header_row = '|' + '|'.join(f' {h:<{w}} ' for h, w in zip(headers, widths)) + '|'
    
    lines = [sep, header_row, sep]
    
    for row in rows:
        line = '|' + '|'.join(f' {v:<{w}} ' for v, w in zip(row, widths)) + '|'
        lines.append(line)
    
    lines.append(sep)
    
    return '\n'.join(lines)


def save_results_csv(results: List[Dict[str, Any]], output_path: Path):
    """Save results to CSV."""
    df = pd.DataFrame(results)
    df.to_csv(output_path, index=False)
    print(f"Results saved to {output_path}")


def generate_quantstats_report(
    result: BacktestResult,
    pattern_name: str,
    symbol: str,
    output_dir: Path,
):
    """Generate quantstats HTML report."""
    if not HAS_QUANTSTATS:
        print("quantstats not installed, skipping HTML report")
        return
    
    returns = result.equity_curve.pct_change().dropna()
    
    if len(returns) < 10:
        print(f"Insufficient data for {pattern_name} report")
        return
    
    filename = f"{pattern_name}_{symbol}_report.html"
    output_path = output_dir / filename
    
    try:
        qs.reports.html(returns, output=str(output_path), title=f"{pattern_name} - {symbol}")
        print(f"Report saved to {output_path}")
    except Exception as e:
        print(f"Error generating report: {e}")


def main():
    parser = argparse.ArgumentParser(description='Validate trading patterns')
    parser.add_argument('--pattern', type=str, help='Specific pattern to test')
    parser.add_argument('--symbol', type=str, help='Specific symbol to test')
    parser.add_argument('--report', action='store_true', help='Generate HTML reports')
    parser.add_argument('--data-dir', type=str, default=None, help='Data directory')
    parser.add_argument('--output-dir', type=str, default=None, help='Output directory')
    
    args = parser.parse_args()
    
    # Set directories
    base_dir = Path(__file__).parent.parent
    data_dir = Path(args.data_dir) if args.data_dir else base_dir / 'data'
    output_dir = Path(args.output_dir) if args.output_dir else base_dir / 'results'
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 60)
    print("TRADING PATTERN VALIDATION")
    print("=" * 60)
    print(f"Data directory: {data_dir}")
    print(f"Output directory: {output_dir}")
    print()
    
    # Get patterns and data
    patterns = get_all_patterns()
    data_files = get_all_data_files(data_dir)
    
    if not data_files:
        print("No data files found! Run download_data.py first.")
        sys.exit(1)
    
    print(f"Found {len(patterns)} patterns:")
    for p in patterns:
        print(f"  - {p.name}")
    
    print(f"\nFound {len(data_files)} data files:")
    for name, path in data_files.items():
        print(f"  - {name}")
    
    print()
    
    # Filter by args
    if args.pattern:
        patterns = [p for p in patterns if args.pattern.lower() in p.name.lower()]
    
    if args.symbol:
        data_files = {k: v for k, v in data_files.items() if args.symbol.lower() in k.lower()}
    
    # Run validations
    all_results = []
    all_backtest_results = {}
    
    for pattern in patterns:
        for data_name, data_path in data_files.items():
            print(f"\n{'='*60}")
            print(f"Testing: {pattern.name} on {data_name}")
            print('='*60)
            
            # Load data
            data = load_csv(str(data_path))
            
            if len(data) < pattern.get_required_bars() + 100:
                print(f"Insufficient data ({len(data)} bars), skipping...")
                continue
            
            # Run backtest
            result = run_validation(pattern, data, data_name)
            
            # Store result
            key = f"{pattern.name}_{data_name}"
            all_backtest_results[key] = result
            
            # Extract metrics
            m = result.metrics
            result_dict = {
                'pattern': pattern.name,
                'symbol': data_name,
                'trades': m.total_trades,
                'win_rate': m.win_rate,
                'profit_factor': m.profit_factor,
                'sharpe': m.sharpe_ratio,
                'sortino': m.sortino_ratio,
                'max_dd': m.max_drawdown,
                'total_return': m.total_return,
                'total_pnl': m.total_pnl,
                'avg_r_multiple': m.avg_r_multiple,
                'expectancy': m.expectancy,
            }
            all_results.append(result_dict)
            
            # Print metrics
            print(m)
            
            # Generate report if requested
            if args.report:
                generate_quantstats_report(result, pattern.id, data_name, output_dir)
    
    # Print summary table
    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)
    print(format_results_table(all_results))
    
    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    csv_path = output_dir / f'validation_results_{timestamp}.csv'
    save_results_csv(all_results, csv_path)
    
    # Save latest results
    latest_path = output_dir / 'validation_results_latest.csv'
    save_results_csv(all_results, latest_path)
    
    print("\nValidation complete!")
    
    # Summary stats
    if all_results:
        df = pd.DataFrame(all_results)
        print(f"\nOverall Statistics:")
        print(f"  Total pattern-symbol combinations: {len(all_results)}")
        print(f"  Total trades across all tests: {df['trades'].sum()}")
        print(f"  Average win rate: {df['win_rate'].mean():.1%}")
        print(f"  Average Sharpe: {df['sharpe'].mean():.2f}")
        print(f"  Average max drawdown: {df['max_dd'].mean():.1%}")


if __name__ == '__main__':
    main()

