#!/usr/bin/env python3
"""
Dump the Python engine's trades for the trade-parity fixture, so they can be
compared with the TypeScript engine's trades.

Usage: python scripts/trade_parity_dump.py <fixture.csv> <out.json>
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'research-py'))

import warnings
warnings.filterwarnings('ignore')

from src.data.loaders import load_csv
from src.backtesting.engine import run_backtest, BacktestConfig
from src.patterns.confluence_zone import ConfluenceZonePattern

# Explicit numeric tolerances for the comparison. These are NOT used to
# conceal a discrepancy: the same tolerances are applied to the TypeScript
# dump, and any field that differs by more than its tolerance is reported.
PRICE_TOL = 1e-9
QTY_TOL = 1e-9
PNL_TOL = 1e-6
R_TOL = 1e-9
EQUITY_TOL = 1e-6


def dump(csv_path: str, out_path: str) -> None:
    data = load_csv(csv_path)

    # Costs are zeroed here so that the comparison isolates EXECUTION
    # mechanics (fill price, stop/target resolution, sizing) rather than the
    # two engines' structurally different cost models. The cost models are
    # compared separately in the divergence report.
    config = BacktestConfig(
        initial_capital=100_000,
        risk_per_trade=0.01,
        max_open_trades=5,
        commission=0.0,
        slippage=0.0,
        intrabar_policy='stop_first',
        fill_gaps_at_open=True,
        close_open_positions_at_end=True,
    )

    result = run_backtest(ConfluenceZonePattern(), data, 'TRADE_PARITY', config)

    trades = []
    for t in result.trades:
        trades.append({
            'id': t['id'],
            'direction': t['direction'],
            'signal_time': t['signal_time'].isoformat(),
            'entry_time': t['entry_time'].isoformat() if t.get('entry_time') else None,
            'entry_price': round(float(t['entry_price']), 10),
            'signal_price': round(float(t['signal_price']), 10),
            'stop_loss': round(float(t['stop_loss']), 10),
            'target': round(float(t['target']), 10),
            'exit_time': t.get('exit_time').isoformat() if t.get('exit_time') else None,
            'exit_price': round(float(t['exit_price']), 10),
            'exit_reason': t['exit_reason'],
            'size': round(float(t['size']), 10),
            'risk_amount': round(float(t['risk_amount']), 10),
            'gross_pnl': round(float(t['pnl'] + t['commission']), 10),
            'net_pnl': round(float(t['pnl']), 10),
            'commission': round(float(t['commission']), 10),
            'r_multiple': round(float(t['r_multiple']), 10),
            'confluence_factors': sorted(t['confluence_factors']),
        })

    equity = [round(float(v), 10) for v in result.equity_curve.tolist()]

    payload = {
        'row_count': len(data),
        'trade_count': len(trades),
        'trades': trades,
        'equity_curve': equity,
        'equity_timestamps': [ts.isoformat() for ts in result.equity_curve.index],
        'final_equity': round(float(result.equity_curve.iloc[-1]), 10) if len(equity) else 0.0,
        'open_positions_at_end': len(result.open_positions_at_end),
        'tolerances': {
            'price': PRICE_TOL,
            'quantity': QTY_TOL,
            'pnl': PNL_TOL,
            'r_multiple': R_TOL,
            'equity': EQUITY_TOL,
        },
    }

    Path(out_path).write_text(json.dumps(payload, indent=2))
    print(f'wrote {out_path} ({len(trades)} trades)')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit('Usage: python trade_parity_dump.py <fixture.csv> <out.json>')
    dump(sys.argv[1], sys.argv[2])
