/**
 * Shared helpers for the TypeScript engine tests.
 */
import { Candle } from '../src/types';

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Build a Candle[] from tuples of (open, high, low, close).
 * `startMs` defaults to a fixed epoch so tests are deterministic.
 */
export function makeCandles(
  rows: Array<[number, number, number, number]>,
  startMs: number = Date.UTC(2024, 0, 1, 0, 0, 0),
  stepMs: number = HOUR_MS
): Candle[] {
  return rows.map(([open, high, low, close], i) => ({
    timestamp: startMs + i * stepMs,
    open,
    high,
    low,
    close,
    volume: 1000,
  }));
}

/**
 * N identical flat candles.
 */
export function flatCandles(
  n: number,
  o = 100,
  h = 101,
  l = 99,
  c = 100
): Candle[] {
  const rows: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) rows.push([o, h, l, c]);
  return makeCandles(rows);
}
