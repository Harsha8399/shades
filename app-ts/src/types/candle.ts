/**
 * OHLCV Candle representation
 */
export interface Candle {
  timestamp: number;  // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Supported timeframes
 */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * Trade direction
 */
export type Direction = 'LONG' | 'SHORT';

/**
 * Market context computed from candles
 */
export interface MarketContext {
  symbol: string;
  timeframe: Timeframe;
  atr: number;                              // Average True Range
  trend: 'UP' | 'DOWN' | 'RANGE';
  volatility: 'LOW' | 'NORMAL' | 'HIGH';
}

/**
 * Get candle body size (absolute)
 */
export function getCandleBody(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

/**
 * Get upper wick size
 */
export function getUpperWick(candle: Candle): number {
  return candle.high - Math.max(candle.open, candle.close);
}

/**
 * Get lower wick size
 */
export function getLowerWick(candle: Candle): number {
  return Math.min(candle.open, candle.close) - candle.low;
}

/**
 * Check if candle is bullish (close >= open, doji counts as bullish)
 */
export function isBullish(candle: Candle): boolean {
  return candle.close >= candle.open;
}

/**
 * Check if candle is bearish (close <= open, doji counts as bearish)
 */
export function isBearish(candle: Candle): boolean {
  return candle.close <= candle.open;
}

/**
 * Get candle range (high - low)
 */
export function getCandleRange(candle: Candle): number {
  return candle.high - candle.low;
}

