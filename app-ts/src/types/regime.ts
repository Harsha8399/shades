/**
 * Market Regime Types
 * 
 * "Know when NOT to trade" - The best traders know that regime matters.
 * Trend-following strategies fail in ranging markets.
 * Mean-reversion strategies fail in trending markets.
 */

/**
 * Market trend regime based on ADX and EMA relationship
 */
export type MarketRegime =
  | 'STRONG_TREND_UP'    // ADX > 40, EMA20 > EMA50
  | 'WEAK_TREND_UP'      // ADX 25-40, EMA20 > EMA50
  | 'RANGING'            // ADX < 25
  | 'WEAK_TREND_DOWN'    // ADX 25-40, EMA20 < EMA50
  | 'STRONG_TREND_DOWN'; // ADX > 40, EMA20 < EMA50

/**
 * Volatility regime based on ATR
 */
export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

/**
 * Complete regime context for trading decisions
 */
export interface RegimeContext {
  // Current regime classification
  regime: MarketRegime;
  volatility: VolatilityRegime;
  
  // Underlying indicators
  adx: number;              // Average Directional Index (0-100)
  plusDI: number;           // +DI for bullish pressure
  minusDI: number;          // -DI for bearish pressure
  
  // EMA values
  ema20: number;
  ema50: number;
  emaSpread: number;        // % difference between EMAs
  
  // Volatility metrics
  atr: number;
  atrPercent: number;       // ATR as % of price
  
  // Regime stability
  regimeAge: number;        // Bars since regime started
  isStable: boolean;        // Has been in regime for 10+ bars
  
  // Trading guidance
  tradeable: boolean;       // Should we trade in this regime?
  tradeDirection: 'LONG' | 'SHORT' | 'BOTH' | 'NONE';
  
  // Adjustments
  stopMultiplier: number;   // Multiply SL by this (wider in high vol)
  targetMultiplier: number; // Multiply TP by this
}

/**
 * Configuration for regime detection
 */
export interface RegimeConfig {
  adxPeriod: number;           // Period for ADX (default: 14)
  emaPeriods: [number, number]; // Fast and slow EMA (default: [20, 50])
  atrPeriod: number;           // Period for ATR (default: 14)
  
  // ADX thresholds
  rangingThreshold: number;    // Below this = ranging (default: 25)
  strongTrendThreshold: number; // Above this = strong trend (default: 40)
  
  // Volatility thresholds (as % of price)
  lowVolThreshold: number;     // Below = low volatility (default: 0.5)
  highVolThreshold: number;    // Above = high volatility (default: 2.0)
  extremeVolThreshold: number; // Above = extreme volatility (default: 4.0)
  
  // Stability
  minRegimeAge: number;        // Bars to confirm stable (default: 10)
}

/**
 * Default regime configuration
 */
export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  adxPeriod: 14,
  emaPeriods: [20, 50],
  atrPeriod: 14,
  rangingThreshold: 25,
  strongTrendThreshold: 40,
  lowVolThreshold: 0.5,
  highVolThreshold: 2.0,
  extremeVolThreshold: 4.0,
  minRegimeAge: 10,
};

/**
 * Which patterns work in which regimes
 */
export const REGIME_PATTERN_COMPATIBILITY: Record<MarketRegime, string[]> = {
  'STRONG_TREND_UP': ['breakout', 'pullback', 'trendline-break'],
  'WEAK_TREND_UP': ['pullback', 'confluence-zone', 'fib-pullback'],
  'RANGING': ['mean-reversion', 'sr-retest', 'range-bound'],
  'WEAK_TREND_DOWN': ['pullback', 'confluence-zone', 'fib-pullback'],
  'STRONG_TREND_DOWN': ['breakout', 'pullback', 'trendline-break'],
};

