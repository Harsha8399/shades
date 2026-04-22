/**
 * Technical Indicators using technicalindicators library
 * 
 * This module wraps the battle-tested technicalindicators package
 * for reliable, verified calculations.
 */
import {
  ATR as TI_ATR,
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
  ADX,
} from 'technicalindicators';
import { Candle } from '../types';

/**
 * Calculate ATR using technicalindicators library
 */
export function calculateATR_TI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    // Fallback for insufficient data
    const ranges = candles.map(c => c.high - c.low);
    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }
  
  const result = TI_ATR.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });
  
  return result.length > 0 ? result[result.length - 1] : 0;
}

/**
 * Calculate SMA
 */
export function calculateSMA(values: number[], period: number): number[] {
  return SMA.calculate({ values, period });
}

/**
 * Calculate EMA
 */
export function calculateEMA(values: number[], period: number): number[] {
  return EMA.calculate({ values, period });
}

/**
 * Calculate RSI
 */
export function calculateRSI(candles: Candle[], period: number = 14): number[] {
  return RSI.calculate({
    values: candles.map(c => c.close),
    period,
  });
}

/**
 * Calculate MACD
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { MACD: number; signal: number; histogram: number }[] {
  const result = MACD.calculate({
    values: candles.map(c => c.close),
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  
  return result.map(r => ({
    MACD: r.MACD ?? 0,
    signal: r.signal ?? 0,
    histogram: r.histogram ?? 0,
  }));
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number }[] {
  return BollingerBands.calculate({
    values: candles.map(c => c.close),
    period,
    stdDev,
  });
}

/**
 * Calculate Stochastic
 */
export function calculateStochastic(
  candles: Candle[],
  period: number = 14,
  signalPeriod: number = 3
): { k: number; d: number }[] {
  return Stochastic.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
    signalPeriod,
  });
}

/**
 * Calculate ADX (Average Directional Index)
 */
export function calculateADX(candles: Candle[], period: number = 14): { adx: number; pdi: number; mdi: number }[] {
  return ADX.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });
}

/**
 * Get current ATR value using library
 */
export function getCurrentATR(candles: Candle[], period: number = 14): number {
  return calculateATR_TI(candles, period);
}

/**
 * Get current RSI value
 */
export function getCurrentRSI(candles: Candle[], period: number = 14): number {
  const rsi = calculateRSI(candles, period);
  return rsi.length > 0 ? rsi[rsi.length - 1] : 50;
}

/**
 * Check if RSI is overbought
 */
export function isOverbought(candles: Candle[], threshold: number = 70): boolean {
  return getCurrentRSI(candles) > threshold;
}

/**
 * Check if RSI is oversold
 */
export function isOversold(candles: Candle[], threshold: number = 30): boolean {
  return getCurrentRSI(candles) < threshold;
}

