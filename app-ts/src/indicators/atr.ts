import { Candle } from '../types';

/**
 * Calculate True Range for a single candle
 */
export function calculateTrueRange(current: Candle, previous: Candle | null): number {
  const highLow = current.high - current.low;
  
  if (!previous) {
    return highLow;
  }
  
  const highPrevClose = Math.abs(current.high - previous.close);
  const lowPrevClose = Math.abs(current.low - previous.close);
  
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Calculate Average True Range (ATR)
 *
 * Wilder's smoothing, reproducing the `technicalindicators` library's ATR
 * exactly. The library's convention is:
 *   * True Range[0] is high-low (there is no previous close on the first
 *     bar) and is NOT used for seeding.
 *   * The ATR is seeded with the simple mean of True Range[1 .. period].
 *   * Each subsequent bar applies ((atr * (period - 1)) + tr) / period.
 *
 * The Python research engine implements the same algorithm, so the two
 * engines derive identical ATR-derived tolerances.
 *
 * @param candles - Array of OHLCV candles
 * @param period - ATR period (default: 14)
 * @returns ATR value
 */
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    // Not enough data, return simple range average
    const ranges = candles.map(c => c.high - c.low);
    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }
  
  // True ranges. The first bar has no previous close, so its true range is
  // just high - low.
  const trueRanges: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    const previous = i > 0 ? candles[i - 1] : null;
    trueRanges.push(calculateTrueRange(current, previous));
  }
  
  // Seed with the simple mean of TR[1..period]. TR[0] has no previous close
  // and is excluded, matching the library.
  let atr = trueRanges.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period + 1; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }
  
  return atr;
}

/**
 * Calculate ATR as percentage of price
 */
export function calculateATRPercent(candles: Candle[], period: number = 14): number {
  const atr = calculateATR(candles, period);
  const currentPrice = candles[candles.length - 1].close;
  return (atr / currentPrice) * 100;
}

/**
 * Determine volatility regime based on ATR
 */
export function getVolatilityRegime(
  candles: Candle[],
  period: number = 14,
  lookback: number = 50
): 'LOW' | 'NORMAL' | 'HIGH' {
  if (candles.length < lookback) {
    return 'NORMAL';
  }
  
  const currentATR = calculateATR(candles, period);
  
  // Calculate historical ATR values for comparison
  const historicalATRs: number[] = [];
  for (let i = period + 1; i <= lookback && i <= candles.length; i++) {
    const slice = candles.slice(0, candles.length - lookback + i);
    if (slice.length >= period + 1) {
      historicalATRs.push(calculateATR(slice, period));
    }
  }
  
  if (historicalATRs.length === 0) {
    return 'NORMAL';
  }
  
  const avgATR = historicalATRs.reduce((a, b) => a + b, 0) / historicalATRs.length;
  const ratio = currentATR / avgATR;
  
  if (ratio < 0.7) return 'LOW';
  if (ratio > 1.5) return 'HIGH';
  return 'NORMAL';
}

