#!/usr/bin/env python3
"""
Synthetic EXECUTION-parity harness for the Python research engine.

WHY THIS EXISTS
===============

The trade-parity fixture (`trade_parity_15m.csv`) drives the *shipped
strategy* and therefore only exercises the scenarios the strategy happens to
produce: in practice a LONG and a SHORT that both exit at their target.

The execution contract in `research-py/docs/EXECUTION_SEMANTICS.md` governs
far more than that: stop-loss exits, gap-aware fills, ambiguous bars that
span both the stop and the target, commission and slippage, and equity-based
sizing. Those mechanics must agree between the engines whether or not the
strategy happens to trigger them.

THIS IS A TEST ARTEFACT AND IS NOT EVIDENCE OF ANYTHING ABOUT THE STRATEGY.
The signals below are CONTROLLED, hand-written inputs. They are not produced
by `ConfluenceZonePattern` and they say nothing about whether the strategy
finds real setups, nor about profitability.

The TypeScript counterpart is `app-ts/src/cli/executionParityDump.ts`, which
drives the real `PaperTradingEngine` with the same controlled signals.

Usage: python scripts/execution_parity_dump.py <out.json>
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'research-py'))

import warnings
warnings.filterwarnings('ignore')

import pandas as pd

from src.backtesting.engine import BacktestEngine, BacktestConfig
from src.patterns.base import BasePattern, Signal

OUT = REPO_ROOT / 'shared' / 'fixtures' / 'execution_parity.json'

# --- explicit numeric tolerances ------------------------------------
PRICE_TOL = 1e-9
QTY_TOL = 1e-6
PNL_TOL = 1e-6
R_TOL = 1e-9
EQUITY_TOL = 1e-6

# --- execution scenario definitions ---------------------------------
# Each scenario is a controlled signal plus the bars that follow it.
# `bars_after` are the bars the engine will replay after the signal bar.
#
# entry_price / stop_loss / target are chosen so that each scenario hits
# exactly one intended outcome.
SCENARIOS = [
    {
        'id': 'LONG_STOP_LOSS',
        'description': 'A long whose stop-loss is reached; the exit must be at the stop.',
        'direction': 'LONG',
        'entry_price': 100.0,
        'stop_loss': 98.0,
        'target': 110.0,
        'bars_after': [
            # (open, high, low, close)
            (100.0, 100.5, 99.5, 100.0),   # entry fills here (low <= 100)
            (100.0, 100.2, 97.5, 98.0),    # stop at 98.0 is hit
        ],
        'expect_exit_reason': 'STOPPED',
    },
    {
        'id': 'LONG_TARGET',
        'description': 'A long whose target is reached.',
        'direction': 'LONG',
        'entry_price': 100.0,
        'stop_loss': 98.0,
        'target': 102.0,
        'bars_after': [
            (100.0, 100.5, 99.5, 100.0),
            (100.0, 102.5, 99.8, 102.0),   # target at 102.0 is hit
        ],
        'expect_exit_reason': 'TARGET',
    },
    {
        'id': 'SHORT_STOP_LOSS',
        'description': 'A short whose stop-loss is reached.',
        'direction': 'SHORT',
        'entry_price': 100.0,
        'stop_loss': 102.0,
        'target': 90.0,
        'bars_after': [
            (100.0, 100.5, 99.5, 100.0),
            (100.0, 102.5, 99.8, 102.0),   # stop at 102.0 is hit
        ],
        'expect_exit_reason': 'STOPPED',
    },
    {
        'id': 'SHORT_TARGET',
        'description': 'A short whose target is reached.',
        'direction': 'SHORT',
        'entry_price': 100.0,
        'stop_loss': 102.0,
        'target': 98.0,
        'bars_after': [
            (100.0, 100.5, 99.5, 100.0),
            (100.0, 100.2, 97.5, 98.0),   # target at 98.0 is hit
        ],
        'expect_exit_reason': 'TARGET',
    },
    {
        'id': 'LONG_GAP_FILL',
        'description': (
            'A long order whose next bar gaps BELOW the entry price. It must '
            'still FILL on touch (DIV-11). On the fill price the engines '
            'differ by the recorded DIV-06 rule: the Python engine fills at '
            'the bar OPEN (95.0) via fill_gaps_at_open; the TypeScript engine '
            'fills at the LIMIT (100.0) because entry-gap handling is not '
            'implemented there yet.'
        ),
        'direction': 'LONG',
        'entry_price': 100.0,
        'stop_loss': 90.0,
        'target': 120.0,
        'bars_after': [
            (95.0, 95.5, 94.0, 95.0),    # opens below the entry -> fills at open
            (95.0, 95.2, 94.5, 95.0),
        ],
        'expect_exit_reason': 'END_OF_DATA',
    },
    {
        'id': 'AMBIGUOUS_BAR_STOP_FIRST',
        'description': (
            'A long whose exit bar spans BOTH the stop and the target. The '
            'documented default policy is stop_first, so the stop must win.'
        ),
        'direction': 'LONG',
        'entry_price': 100.0,
        'stop_loss': 98.0,
        'target': 102.0,
        'bars_after': [
            (100.0, 100.5, 99.5, 100.0),
            (100.0, 103.0, 97.0, 100.0),   # spans 97..103: stop AND target
        ],
        'expect_exit_reason': 'STOPPED',
    },
    {
        'id': 'SAME_BAR_NO_EXIT',
        'description': (
            'A long whose entry bar also spans the stop. The position must '
            'NOT be exited on the bar it was opened.'
        ),
        'direction': 'LONG',
        'entry_price': 100.0,
        'stop_loss': 99.0,
        'target': 120.0,
        'bars_after': [
            (100.0, 100.5, 98.0, 100.0),   # entry fills AND spans the stop
            (100.0, 100.2, 99.8, 100.0),
        ],
        'expect_exit_reason': 'END_OF_DATA',
    },
]


class _ControlledPattern(BasePattern):
    """
    A pattern that emits a SINGLE controlled signal on a given bar.

    This is a test double. It replaces the strategy so that the execution
    mechanics can be exercised deterministically, independently of whether the
    real strategy would have produced a signal.
    """

    def __init__(self, spec, signal_bar_index):
        super().__init__({})
        self._spec = spec
        self._signal_bar_index = signal_bar_index

    @property
    def id(self):
        return 'controlled-execution-parity'

    @property
    def name(self):
        return 'Controlled Execution Parity Signal'

    def detect_signal(self, df, symbol=''):
        # The engine hands us the closed-candle history, whose last bar is
        # the bar BEFORE the current one. The signal is emitted when the
        # history's last bar is the designated signal bar.
        if len(df) == 0:
            return None
        if len(df) - 1 != self._signal_bar_index:
            return None

        return Signal(
            pattern_id=self.id,
            pattern_name=self.name,
            direction=self._spec['direction'],
            timestamp=df.index[-1],
            entry_price=self._spec['entry_price'],
            stop_loss=self._spec['stop_loss'],
            target=self._spec['target'],
            confidence=1.0,
            confluence_factors=['controlled'],
            risk_reward_ratio=2.0,
        )

    def calculate_stop_loss(self, entry_price, direction, df):
        return self._spec['stop_loss']

    def get_required_bars(self):
        return 1


def build_bars(spec):
    """
    Build the bar series for a scenario.

    A leading warm-up bar precedes the signal bar so that the engine has a
    closed candle to signal on and so the ATR is well defined.
    """
    rows = [(100.0, 100.2, 99.8, 100.0)]
    for (o, h, l, c) in spec['bars_after']:
        rows.append((o, h, l, c))
    idx = pd.date_range('2024-01-01 09:15', periods=len(rows), freq='15min')
    df = pd.DataFrame(
        rows, columns=['open', 'high', 'low', 'close'], index=idx
    )
    df['volume'] = 1000.0
    return df


def run_scenario(spec, costs):
    """Run one scenario through the research engine and return its trade."""
    bars = build_bars(spec)
    # The signal bar is bar 0 (the warm-up bar); the engine decides on the
    # NEXT bar, so the order can fill on the first `bars_after` bar.
    pattern = _ControlledPattern(spec, signal_bar_index=0)

    config = BacktestConfig(
        initial_capital=100_000,
        risk_per_trade=0.01,
        max_open_trades=5,
        commission=costs['commission'],
        slippage=costs['slippage'],
        intrabar_policy='stop_first',
        fill_gaps_at_open=True,
        close_open_positions_at_end=True,
    )

    engine = BacktestEngine(config)
    result = engine.run(pattern, bars, 'EXEC_PARITY')

    if not result.trades:
        return None

    t = result.trades[0]
    return {
        'id': spec['id'],
        'direction': t['direction'],
        'signal_time': t['signal_time'].isoformat(),
        'entry_time': t['entry_time'].isoformat() if t.get('entry_time') else None,
        'entry_price': round(float(t['entry_price']), 10),
        'stop_loss': round(float(t['stop_loss']), 10),
        'target': round(float(t['target']), 10),
        'exit_time': t.get('exit_time').isoformat() if t.get('exit_time') else None,
        'exit_price': round(float(t['exit_price']), 10),
        'exit_reason': t['exit_reason'],
        'size': round(float(t['size']), 6),
        'risk_amount': round(float(t['risk_amount']), 6),
        'gross_pnl': round(float(t['pnl'] + t['commission']), 10),
        'net_pnl': round(float(t['pnl']), 10),
        'commission': round(float(t['commission']), 10),
        'r_multiple': round(float(t['r_multiple']), 10),
    }


def main():
    payloads = {}

    for cost_set in (
        {'name': 'zero_costs', 'commission': 0.0, 'slippage': 0.0},
        {'name': 'with_costs', 'commission': 0.001, 'slippage': 0.0005},
    ):
        results = []
        for spec in SCENARIOS:
            trade = run_scenario(spec, cost_set)
            if trade is None:
                results.append({'id': spec['id'], 'error': 'no trade produced'})
                continue
            trade['expect_exit_reason'] = spec['expect_exit_reason']
            trade['description'] = spec['description']
            results.append(trade)
        payloads[cost_set['name']] = results

    payload = {
        'note': (
            'Synthetic EXECUTION-parity scenarios. The signals are CONTROLLED '
            'test inputs, not outputs of the trading strategy. They validate '
            'execution mechanics only and say nothing about the strategy.'
        ),
        'scenarios': [s['id'] for s in SCENARIOS],
        'results': payloads,
        'tolerances': {
            'price': PRICE_TOL,
            'quantity': QTY_TOL,
            'pnl': PNL_TOL,
            'r_multiple': R_TOL,
            'equity': EQUITY_TOL,
        },
    }

    OUT.write_text(json.dumps(payload, indent=2))
    print(f'wrote {OUT}')
    for name, results in payloads.items():
        print(f'  {name}: {len(results)} scenarios')


if __name__ == '__main__':
    main()
