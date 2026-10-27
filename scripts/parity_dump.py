#!/usr/bin/env python3
"""
Stage 1 diagnostic: dump the Python engine's indicator outputs for the shared
parity fixture, so they can be compared with the TypeScript engine's outputs.

Usage:
    python scripts/parity_dump.py python <fixture.csv> <out.json>
    python scripts/parity_dump.py typescript <fixture.csv> <out.json>
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'research-py'))


def dump_python(csv_path: str, out_path: str) -> None:
    import warnings
    warnings.filterwarnings('ignore')

    from src.data.loaders import load_csv
    from src.indicators.support_resistance import find_sr_zones, calculate_atr
    from src.indicators.fibonacci import find_fib_retracement
    from src.indicators.trendlines import find_trendlines, find_swing_points

    df = load_csv(csv_path)

    # Mirror the PATTERN-level call sites so the dump reflects what the
    # strategy actually computes (see research-py/docs/STAGE1_PARITY_DECISIONS.md).
    atr = calculate_atr(df)
    zones = find_sr_zones(
        df.iloc[-100:], tolerance_atr=0.5, min_touches=2, atr=atr
    )
    fib = find_fib_retracement(df, lookback=50)
    trendlines = find_trendlines(
        df, tolerance=0.3, min_touches=2, atr=atr
    )
    swing_highs, swing_lows = find_swing_points(df, 3, 3)

    payload = {
        'row_count': len(df),
        'atr': round(float(atr), 10),
        'atr_tolerance_0_5': round(float(atr) * 0.5, 10),
        'swing_highs': [[int(i), round(float(p), 6)] for i, p in swing_highs],
        'swing_lows': [[int(i), round(float(p), 6)] for i, p in swing_lows],
        'sr_zones': [
            {
                'type': z.type,
                'price_level': round(float(z.price_level), 6),
                'strength': int(z.strength),
            }
            for z in zones
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

    Path(out_path).write_text(json.dumps(payload, indent=2, sort_keys=True))
    print(f'wrote {out_path}')


def dump_typescript(csv_path: str, out_path: str) -> None:
    """Run the TS dump via ts-node."""
    import subprocess
    app_ts = REPO_ROOT / 'app-ts'
    script = REPO_ROOT / 'scripts' / 'parity_dump.ts'
    subprocess.run(
        ['npx', 'ts-node', str(script), csv_path, out_path],
        cwd=app_ts,
        check=True,
    )


if __name__ == '__main__':
    mode = sys.argv[1]
    csv_path = sys.argv[2]
    out_path = sys.argv[3]
    if mode == 'python':
        dump_python(csv_path, out_path)
    elif mode == 'typescript':
        dump_typescript(csv_path, out_path)
    else:
        raise SystemExit(f'unknown mode: {mode}')
