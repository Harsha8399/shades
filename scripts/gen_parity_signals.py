#!/usr/bin/env python3
"""
Regenerate shared/fixtures/parity_signals.json from the Python engine.

These are the per-bar confluence factors the strategy actually produces, and
they are asserted by BOTH the Python and the TypeScript test suites.

Usage: python scripts/gen_parity_signals.py
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'research-py'))

import warnings
warnings.filterwarnings('ignore')

from src.data.loaders import load_csv
from src.indicators.support_resistance import (
    calculate_atr,
    find_sr_zones,
    is_price_at_zone,
)
from src.indicators.fibonacci import find_fib_retracement, is_price_at_fib_level
from src.indicators.trendlines import find_trendlines, get_trendline_price

FIXTURE = REPO_ROOT / 'shared' / 'fixtures' / 'parity_15m.csv'
OUT = REPO_ROOT / 'shared' / 'fixtures' / 'parity_signals.json'

SR_LOOKBACK = 100
FIB_LOOKBACK = 50
TRENDLINE_TOLERANCE_ATR = 0.3
ZONE_TOLERANCE_ATR = 0.5

df = load_csv(str(FIXTURE))
rows = []

for i in range(SR_LOOKBACK, len(df)):
    window = df.iloc[max(0, i - SR_LOOKBACK):i]
    if len(window) < 50:
        continue

    # The pattern computes the ATR over the full decision window.
    atr = calculate_atr(df.iloc[:i])
    tol = atr * ZONE_TOLERANCE_ATR
    price = window.iloc[-1]['close']

    factors = []

    zones = find_sr_zones(
        window.iloc[-SR_LOOKBACK:], tolerance_atr=ZONE_TOLERANCE_ATR,
        min_touches=2, atr=atr,
    )
    at_zone, _zone, zone_type = is_price_at_zone(price, zones, tol)
    if at_zone and zone_type:
        factors.append(f"sr_{zone_type.lower()}")

    fib = find_fib_retracement(window, lookback=FIB_LOOKBACK)
    if fib:
        at_fib, fib_level = is_price_at_fib_level(price, fib, tol)
        if at_fib and fib_level:
            factors.append(f"fib_{int(fib_level.ratio * 1000)}")

    trendlines = find_trendlines(
        window, tolerance=TRENDLINE_TOLERANCE_ATR, min_touches=2, atr=atr
    )
    for tl in trendlines[:3]:
        expected = get_trendline_price(tl, len(window) - 1)
        if abs(price - expected) <= tol:
            factors.append(f"trendline_{tl.type.lower()}")
            break

    if factors:
        rows.append({
            'bar': i,
            # Same format as the TypeScript dump, so the two files are
            # directly comparable. The fixture's naive timestamps are read as
            # UTC wall clock by both engines.
            'ts': df.index[i].strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            'price': round(float(price), 6),
            'factors': sorted(factors),
        })

OUT.write_text(json.dumps(rows, indent=1))
print(f'wrote {OUT} ({len(rows)} confluence bars)')
