/**
 * Cross-engine parity tests.
 *
 * These lock in the execution rules that the TypeScript and Python engines
 * must share, as specified in `research-py/docs/EXECUTION_SEMANTICS.md`.
 *
 * The Python engine has its own suite (88 tests in research-py/tests). This
 * file asserts the *shared* invariants from the TypeScript side so that a
 * change to one engine cannot silently diverge from the other.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CSVLoader } from '../src/data/CSVLoader';
import { findSwingPoints } from '../src/indicators/swingPoints';
import { calculateFibLevels, FIB_RATIOS } from '../src/indicators/fibonacci';
import { findSRZones } from '../src/indicators/supportResistance';
import { findTrendlines } from '../src/indicators/trendlines';
import { makeCandles, flatCandles } from './helpers';

describe('Parity: timestamp interpretation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shades-parity-'));

  const write = (name: string, content: string): string => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads a naive datetime as UTC wall clock (matching Python)', () => {
    /**
     * Python: pandas.to_datetime("2024-01-17 14:00:00") -> naive 14:00.
     * The TS loader must produce the SAME instant, not the local-time
     * interpretation, otherwise the two engines disagree on bar boundaries.
     */
    const file = write(
      'naive.csv',
      'datetime,open,high,low,close,volume\n' +
        '2024-01-17 14:00:00,100,110,90,105,10\n' +
        '2024-01-17 15:00:00,105,115,95,110,20\n'
    );

    const candles = new CSVLoader().loadFromFile(file);

    expect(candles).toHaveLength(2);
    expect(candles[0].timestamp).toBe(Date.UTC(2024, 0, 17, 14, 0, 0));
    expect(candles[1].timestamp).toBe(Date.UTC(2024, 0, 17, 15, 0, 0));
  });

  it('reads an epoch-millisecond timestamp as milliseconds', () => {
    const file = write(
      'epochms.csv',
      'timestamp,open,high,low,close,volume\n' +
        '1705500000000,100,110,90,105,10\n'
    );

    const candles = new CSVLoader().loadFromFile(file);

    expect(candles).toHaveLength(1);
    expect(candles[0].timestamp).toBe(1705500000000);
  });

  it('reads an epoch-second timestamp as seconds', () => {
    const file = write(
      'epochsec.csv',
      'timestamp,open,high,low,close,volume\n' +
        '1705500000,100,110,90,105,10\n'
    );

    const candles = new CSVLoader().loadFromFile(file);

    expect(candles).toHaveLength(1);
    expect(candles[0].timestamp).toBe(1705500000000);
  });

  it('prefers the datetime column over an epoch timestamp column', () => {
    /**
     * The bundled research datasets carry both. Python prefers `datetime`;
     * the TS loader must agree.
     */
    const file = write(
      'both.csv',
      'datetime,timestamp,open,high,low,close,volume\n' +
        '2024-01-17 14:00:00,1705500000000,100,110,90,105,10\n'
    );

    const candles = new CSVLoader().loadFromFile(file);

    expect(candles).toHaveLength(1);
    expect(candles[0].timestamp).toBe(Date.UTC(2024, 0, 17, 14, 0, 0));
  });
});

describe('Parity: swing point confirmation', () => {
  it('never exposes a swing before its right-side confirmation bars exist', () => {
    // Same fixture as the Python test: a peak at index 5, rightBars = 3.
    const values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1];
    const rows: Array<[number, number, number, number]> = values.map((v) => [v, v, v, v]);
    const candles = makeCandles(rows);

    expect(findSwingPoints(candles.slice(0, 8), 3, 3)).toHaveLength(0);
    expect(findSwingPoints(candles.slice(0, 9), 3, 3)).toHaveLength(1);
  });
});

describe('Parity: Fibonacci levels', () => {
  it('produces the same five levels and prices as the Python engine', () => {
    /**
     * Python: calculate_fib_levels(200, 100, 'UP')
     *   0.236 -> 176.4
     *   0.382 -> 161.8
     *   0.5   -> 150.0
     *   0.618 -> 138.2
     *   0.786 -> 121.4
     */
    const levels = calculateFibLevels(200, 100, 'UP');
    const byRatio = new Map(levels.map((l) => [l.ratio, l.price]));

    expect([...byRatio.keys()].sort((a, b) => a - b)).toEqual([
      0.236, 0.382, 0.5, 0.618, 0.786,
    ]);
    expect(byRatio.get(0.236)).toBeCloseTo(176.4, 6);
    expect(byRatio.get(0.382)).toBeCloseTo(161.8, 6);
    expect(byRatio.get(0.5)).toBeCloseTo(150.0, 6);
    expect(byRatio.get(0.618)).toBeCloseTo(138.2, 6);
    expect(byRatio.get(0.786)).toBeCloseTo(121.4, 6);
  });

  it('uses the same ratio list as Python', () => {
    expect(FIB_RATIOS).toEqual([0.236, 0.382, 0.5, 0.618, 0.786]);
  });

  it('mirrors the Python DOWN-direction arithmetic', () => {
    /**
     * Python: calculate_fib_levels(200, 100, 'DOWN')
     *   0.236 -> 123.6
     *   0.786 -> 178.6
     */
    const levels = calculateFibLevels(200, 100, 'DOWN');
    const byRatio = new Map(levels.map((l) => [l.ratio, l.price]));

    expect(byRatio.get(0.236)).toBeCloseTo(123.6, 6);
    expect(byRatio.get(0.786)).toBeCloseTo(178.6, 6);
  });
});

describe('Parity: support/resistance zones', () => {
  it('clusters repeated lows into one zone with the same touch count', () => {
    /**
     * Python fixture: three lows at 10, each confirmed with 3 right-side
     * bars. Expected: one SUPPORT zone, strength 3, level 10.0.
     */
    const values = [
      30, 28, 26, 24, 12,
      24, 26, 28, 30, 12,
      24, 26, 28, 30, 12,
      24, 26, 28, 30,
    ];
    const rows: Array<[number, number, number, number]> = values.map((v) => [v, v + 2, v - 2, v]);
    const candles = makeCandles(rows);

    const zones = findSRZones(candles, 4, 0.5, 2);
    const supports = zones.filter((z) => z.type === 'SUPPORT');

    expect(supports.length).toBeGreaterThanOrEqual(1);
    expect(supports[0].strength).toBe(3);
    expect(supports[0].priceLevel).toBeCloseTo(10, 6);
  });
});

describe('Parity: trendline geometry', () => {
  it('produces the same slope and intercept as the Python engine', () => {
    /**
     * Python fixture: lows at index 4 (8) and index 9 (18).
     * Slope = (18 - 8) / (9 - 4) = 2.0
     */
    const values = [30, 28, 26, 24, 10, 24, 26, 28, 30, 20, 30, 32, 34, 36];
    const rows: Array<[number, number, number, number]> = values.map((v) => [v, v + 2, v - 2, v]);
    const candles = makeCandles(rows);

    const trendlines = findTrendlines(candles, 4, 0.02);
    const supports = trendlines.filter((t) => t.type === 'SUPPORT');

    expect(supports.length).toBeGreaterThanOrEqual(1);
    const tl = supports[0];
    expect(tl.startIndex).toBe(4);
    expect(tl.endIndex).toBe(9);
    expect(tl.slope).toBeCloseTo(2.0, 6);
    expect(tl.intercept).toBeCloseTo(8 - 2.0 * 4, 6);
  });
});

describe('Parity: data integrity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shades-parity2-'));

  const write = (name: string, content: string): string => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects a bar whose high is below its low', () => {
    const file = write(
      'invalid.csv',
      'timestamp,open,high,low,close,volume\n' +
        '1705500000000,100,50,90,105,10\n'
    );

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(String(args[0]));
    let candles: any[] = [];
    try {
      candles = new CSVLoader().loadFromFile(file);
    } finally {
      console.warn = originalWarn;
    }

    expect(candles).toHaveLength(0);
    expect(warnings.some((w) => w.includes('invalid OHLC'))).toBe(true);
  });

  it('rejects a bar whose close is outside its high/low range', () => {
    const file = write(
      'invalid2.csv',
      'timestamp,open,high,low,close,volume\n' +
        '1705500000000,100,110,90,200,10\n'
    );

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(String(args[0]));
    let candles: any[] = [];
    try {
      candles = new CSVLoader().loadFromFile(file);
    } finally {
      console.warn = originalWarn;
    }

    expect(candles).toHaveLength(0);
    expect(warnings.some((w) => w.includes('invalid OHLC'))).toBe(true);
  });

  it('sorts out-of-order rows by timestamp', () => {
    const file = write(
      'unordered.csv',
      'timestamp,open,high,low,close,volume\n' +
        '1705503600000,105,115,95,110,20\n' +
        '1705500000000,100,110,90,105,10\n'
    );

    const candles = new CSVLoader().loadFromFile(file);

    expect(candles).toHaveLength(2);
    expect(candles[0].timestamp).toBeLessThan(candles[1].timestamp);
  });
});
