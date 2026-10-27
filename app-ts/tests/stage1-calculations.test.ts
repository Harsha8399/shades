/**
 * Stage 1 deterministic unit tests for the TypeScript side.
 *
 * These mirror the Python suite in
 * `research-py/tests/test_stage1_calculations.py` so that both engines are
 * held to the same explicit expected values.
 *
 * Decisions: research-py/docs/STAGE1_PARITY_DECISIONS.md
 */
import * as path from 'path';

import { calculateATR } from '../src/indicators/atr';
import { findSRZones } from '../src/indicators/supportResistance';
import { findFibRetracement, calculateFibLevels } from '../src/indicators/fibonacci';
import { findTrendlines } from '../src/indicators/trendlines';
import { findSwingPoints } from '../src/indicators/swingPoints';
import { RiskManager } from '../src/core/RiskManager';
import { CandleResampler } from '../src/core/CandleResampler';
import { makeCandles } from './helpers';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'shared', 'fixtures', 'parity_15m.csv');

describe('D1: ATR uses Wilder smoothing', () => {
  it('equals the bar range when every range is constant', () => {
    const candles = makeCandles(
      Array.from({ length: 20 }, () => [100, 101, 99, 100] as [number, number, number, number])
    );
    expect(calculateATR(candles, 14)).toBeCloseTo(2.0, 9);
  });

  it('keeps the memory of wide ranges, so it exceeds a simple mean', () => {
    const rows: Array<[number, number, number, number]> = [
      ...Array.from({ length: 10 }, () => [100, 110, 90, 100] as [number, number, number, number]),
      ...Array.from({ length: 10 }, () => [100, 101, 99, 100] as [number, number, number, number]),
    ];
    const candles = makeCandles(rows);

    // Wilder's smoothed value after 10 wide and 10 narrow ranges.
    expect(calculateATR(candles, 14)).toBeCloseTo(9.988469143, 6);
  });

  it('reproduces the technicalindicators library ATR exactly', () => {
    /**
     * The repo's own standard (see ARCHITECTURE.md) is to use the library for
     * standard indicators. The custom implementation must therefore agree
     * with `technicalindicators` bit for bit, or the Python engine (which
     * mirrors this implementation) would drift from it.
     */
    const { ATR } = require('technicalindicators');

    const rows: Array<[number, number, number, number]> = [
      ...Array.from({ length: 10 }, () => [100, 110, 90, 100] as [number, number, number, number]),
      ...Array.from({ length: 10 }, () => [100, 101, 99, 100] as [number, number, number, number]),
    ];
    const candles = makeCandles(rows);

    const lib = ATR.calculate({
      high: candles.map((c: any) => c.high),
      low: candles.map((c: any) => c.low),
      close: candles.map((c: any) => c.close),
      period: 14,
    });

    expect(calculateATR(candles, 14)).toBeCloseTo(lib[lib.length - 1], 12);
  });

  it('falls back to the average bar range when there is not enough data', () => {
    const candles = makeCandles(
      Array.from({ length: 5 }, () => [100, 102, 98, 100] as [number, number, number, number])
    );
    // Each bar has a range of 4.
    expect(calculateATR(candles, 14)).toBeCloseTo(4.0, 9);
  });
});

describe('D4: Fibonacci anchors on confirmed swing points', () => {
  it('returns null when there is no swing pair', () => {
    const rows: Array<[number, number, number, number]> = [];
    for (let i = 1; i < 60; i++) rows.push([i, i + 1, i - 1, i]);
    const candles = makeCandles(rows);

    // A strictly monotonic series has no swing high AND low pair.
    expect(findFibRetracement(candles, 50)).toBeNull();
  });

  it('anchors on the last confirmed swing pair', () => {
    const { CSVLoader } = require('../src/data/CSVLoader');
    const candles = new CSVLoader().loadFromFile(FIXTURE);

    const window = candles.slice(-50);
    const swings = findSwingPoints(window, 5, 3);
    const highs = swings.filter((s: any) => s.type === 'HIGH');
    const lows = swings.filter((s: any) => s.type === 'LOW');

    expect(highs.length).toBeGreaterThan(0);
    expect(lows.length).toBeGreaterThan(0);

    const fib = findFibRetracement(candles, 50);
    expect(fib).not.toBeNull();
    expect(fib!.swingHigh).toBeCloseTo(highs[highs.length - 1].price, 6);
    expect(fib!.swingLow).toBeCloseTo(lows[lows.length - 1].price, 6);
  });

  it('computes the five book levels from the anchors', () => {
    const levels = calculateFibLevels(100, 80, 'UP');
    const byRatio = new Map(levels.map((l) => [l.ratio, l.price]));

    expect(byRatio.get(0.236)).toBeCloseTo(95.28, 6);
    expect(byRatio.get(0.382)).toBeCloseTo(92.36, 6);
    expect(byRatio.get(0.5)).toBeCloseTo(90.0, 6);
    expect(byRatio.get(0.618)).toBeCloseTo(87.64, 6);
    expect(byRatio.get(0.786)).toBeCloseTo(84.28, 6);
  });
});

describe('D5: trendline tolerance is ATR-scaled', () => {
  it('changes the touch count when the ATR changes', () => {
    const { CSVLoader } = require('../src/data/CSVLoader');
    const candles = new CSVLoader().loadFromFile(FIXTURE);

    const narrow = findTrendlines(candles, 0.5, 0.3);
    const wide = findTrendlines(candles, 20.0, 0.3);

    const narrowTouch = Math.max(...narrow.map((t: any) => t.touches));
    const wideTouch = Math.max(...wide.map((t: any) => t.touches));

    expect(wideTouch).toBeGreaterThan(narrowTouch);
    expect(narrowTouch).toBe(4);
    expect(wideTouch).toBe(14);
  });
});

describe('D3: S/R zones use the ATR supplied by the caller', () => {
  it('clusters more swings when a larger ATR is supplied', () => {
    const values = [
      30, 28, 26, 24, 12,
      24, 26, 28, 30, 12,
      24, 26, 28, 30, 12,
      24, 26, 28, 30,
    ];
    const candles = makeCandles(
      values.map((v) => [v, v + 2, v - 2, v] as [number, number, number, number])
    );

    const tight = findSRZones(candles, 1.0, 0.5, 2);
    const loose = findSRZones(candles, 20.0, 0.5, 2);

    const tightSupport = tight.filter((z) => z.type === 'SUPPORT');
    const looseSupport = loose.filter((z) => z.type === 'SUPPORT');

    expect(tightSupport.length).toBeGreaterThanOrEqual(1);
    expect(looseSupport.some((z) => z.strength === 3)).toBe(true);
  });
});

describe('D8: risk sizing uses the equity supplied by the caller', () => {
  it('sizes from the supplied equity, not the stale capital', () => {
    const manager = new RiskManager(100_000);

    // equity 100_000, 2% risk, stop 5 below entry -> 2000/5 = 400 units
    const base = manager.calculatePositionSize(100, 95);
    expect(base.quantity).toBeCloseTo(400, 6);

    // With 200_000 of equity the same stop must double the size.
    const doubled = manager.calculatePositionSize(100, 95, undefined, 200_000);
    expect(doubled.quantity).toBeCloseTo(800, 6);

    // With no equity supplied the realised capital is used.
    const stale = manager.calculatePositionSize(100, 95);
    expect(stale.quantity).toBeCloseTo(base.quantity, 6);
  });

  it('returns zero quantity when the stop equals the entry', () => {
    const manager = new RiskManager(100_000);
    const result = manager.calculatePositionSize(100, 100);
    expect(result.quantity).toBe(0);
  });
});

describe('D9: the resampler never emits an in-progress HTF bar', () => {
  it('drops a trailing partial period', () => {
    // 10 hourly candles -> 4h buckets of 4. The last bucket (candles 8-9)
    // is incomplete and must not be emitted.
    const candles = makeCandles(
      Array.from({ length: 10 }, (_, i) => [100 + i, 101 + i, 99 + i, 100 + i] as [number, number, number, number])
    );

    const resampled = CandleResampler.resample(candles, 60, 240);

    // Only the two complete buckets (candles 0-3 and 4-7) are emitted.
    expect(resampled.length).toBe(2);
  });

  it('emits the final bucket when the period is genuinely complete', () => {
    // Exactly 8 hourly candles -> two complete 4h buckets.
    const candles = makeCandles(
      Array.from({ length: 8 }, (_, i) => [100 + i, 101 + i, 99 + i, 100 + i] as [number, number, number, number])
    );

    const resampled = CandleResampler.resample(candles, 60, 240);

    expect(resampled.length).toBe(2);
  });

  it('never emits a bar whose range extends beyond the last input candle', () => {
    // 12 hourly candles: buckets are 0-3, 4-7, 8-11. All are complete.
    const candles = makeCandles(
      Array.from({ length: 12 }, (_, i) => [100 + i, 101 + i, 99 + i, 100 + i] as [number, number, number, number])
    );

    const resampled = CandleResampler.resample(candles, 60, 240);

    expect(resampled.length).toBe(3);
    const lastInput = candles[candles.length - 1];
    const lastOutput = resampled[resampled.length - 1];
    expect(lastOutput.high).toBeLessThanOrEqual(
      Math.max(...candles.map((c) => c.high))
    );
    expect(lastOutput.timestamp).toBeLessThanOrEqual(lastInput.timestamp);
  });
});
