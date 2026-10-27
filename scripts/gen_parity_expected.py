#!/usr/bin/env python3
"""
Regenerate shared/fixtures/parity_expected.json from the Python engine.

The expected values are then asserted by BOTH the Python and the TypeScript
test suites, so neither engine can drift from the other without a failure.

Usage: python scripts/gen_parity_expected.py
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'research-py'))

import warnings
warnings.filterwarnings('ignore')

from src.data.loaders import load_csv
from src.indicators.support_resistance import calculate_atr, find_sr_zones
from src.indicators.fibonacci import find_fib_retracement
from src.indicators.trendlines import find_trendlines, find_swing_points

FIXTURE = REPO_ROOT / 'shared' / 'fixtures' / 'parity_15m.csv'
OUT = REPO_ROOT / 'shared' / 'fixtures' / 'parity_expected.json'

SR_LOOKBACK = 100
FIB_LOOKBACK = 50
TRENDLINE_TOLERANCE_ATR = 0.3

df = load_csv(str(FIXTURE))
atr = calculate_atr(df)

fib = find_fib_retracement(df, lookback=FIB_LOOKBACK)
trendlines = find_trendlines(
    df, tolerance=TRENDLINE_TOLERANCE_ATR, min_touches=2, atr=atr
)
swing_highs, swing_lows = find_swing_points(df, 3, 3)

expected = {
    'row_count': len(df),
    'atr': round(atr, 10),
    'sr_zones': [
        {
            'type': z.type,
            'price_level': round(float(z.price_level), 6),
            'strength': int(z.strength),
        }
        for z in find_sr_zones(
            df.iloc[-SR_LOOKBACK:], tolerance_atr=0.5, min_touches=2, atr=atr
        )
    ],
    'fib': None if fib is None else {
        'swing_high': round(float(fib.swing_high), 6),
        'swing_low': round(float(fib.swing_low), 6),
        'direction': fib.direction,
        'levels': [
            {'ratio': round(float(l.ratio), 6), 'price': round(float(l.price), 6)}
            for l in fib.levels
        ],
    },
    'swing_highs': [[int(i), round(float(p), 6)] for i, p in swing_highs],
    'swing_lows': [[int(i), round(float(p), 6)] for i, p in swing_lows],
    'trendlines': [
        {
            'type': t.type,
            'slope': round(float(t.slope), 10),
            'intercept': round(float(t.intercept), 10),
            'start_idx': int(t.start_idx),
            'end_idx': int(t.end_idx),
            'touches': int(t.touches),
        }
        for t in trendlines
    ],
}

OUT.write_text(json.dumps(expected, indent=2, sort_keys=True))
print(f'wrote {OUT}')
print(f"  rows={expected['row_count']} atr={expected['atr']} "
      f"zones={len(expected['sr_zones'])} trendlines={len(expected['trendlines'])} "
      f"fib={'yes' if expected['fib'] else 'none'}")
