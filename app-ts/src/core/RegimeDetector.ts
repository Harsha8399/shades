/**
 * Market Regime Detector
 * 
 * Detects the current market regime to filter trades:
 * - Trending vs Ranging (using ADX)
 * - Bullish vs Bearish (using EMA cross)
 * - High vs Low volatility (using ATR)
 */
import { Candle } from '../types';
import {
  MarketRegime,
  VolatilityRegime,
  RegimeContext,
  RegimeConfig,
  DEFAULT_REGIME_CONFIG,
} from '../types/regime';
import {
  calculateADX,
  calculateSMA,
  calculateEMA,
  getCurrentATR,
} from '../indicators/technical';

/**
 * Cached regime for stability detection
 */
interface RegimeCache {
  lastRegime: MarketRegime | null;
  regimeStartIndex: number;
}

const cache: RegimeCache = {
  lastRegime: null,
  regimeStartIndex: 0,
};

/**
 * Detect current market regime
 */
export function detectRegime(
  candles: Candle[],
  config: Partial<RegimeConfig> = {}
): RegimeContext {
  const cfg = { ...DEFAULT_REGIME_CONFIG, ...config };
  
  if (candles.length < 60) {
    return getDefaultRegime(candles);
  }
  
  // Calculate indicators
  const adxData = calculateADX(candles, cfg.adxPeriod);
  const latestADX = adxData.length > 0 ? adxData[adxData.length - 1] : { adx: 0, pdi: 0, mdi: 0 };
  
  const closes = candles.map(c => c.close);
  const ema20Values = calculateEMA(closes, cfg.emaPeriods[0]);
  const ema50Values = calculateEMA(closes, cfg.emaPeriods[1]);
  
  const ema20 = ema20Values.length > 0 ? ema20Values[ema20Values.length - 1] : candles[candles.length - 1].close;
  const ema50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : candles[candles.length - 1].close;
  
  const atr = getCurrentATR(candles, cfg.atrPeriod);
  const currentPrice = candles[candles.length - 1].close;
  const atrPercent = (atr / currentPrice) * 100;
  
  // Determine regime
  const regime = classifyRegime(latestADX.adx, ema20, ema50, cfg);
  
  // Determine volatility
  const volatility = classifyVolatility(atrPercent, cfg);
  
  // Calculate EMA spread
  const emaSpread = ((ema20 - ema50) / ema50) * 100;
  
  // Track regime age
  const currentIndex = candles.length - 1;
  if (regime !== cache.lastRegime) {
    cache.lastRegime = regime;
    cache.regimeStartIndex = currentIndex;
  }
  const regimeAge = currentIndex - cache.regimeStartIndex;
  const isStable = regimeAge >= cfg.minRegimeAge;
  
  // Determine tradability and direction
  const { tradeable, tradeDirection } = getTradingGuidance(regime, volatility, isStable);
  
  // Calculate multipliers for stops/targets
  const { stopMultiplier, targetMultiplier } = getMultipliers(volatility);
  
  return {
    regime,
    volatility,
    adx: latestADX.adx,
    plusDI: latestADX.pdi,
    minusDI: latestADX.mdi,
    ema20,
    ema50,
    emaSpread,
    atr,
    atrPercent,
    regimeAge,
    isStable,
    tradeable,
    tradeDirection,
    stopMultiplier,
    targetMultiplier,
  };
}

/**
 * Classify the market regime based on ADX and EMA
 */
function classifyRegime(
  adx: number,
  ema20: number,
  ema50: number,
  config: RegimeConfig
): MarketRegime {
  const isBullish = ema20 > ema50;
  
  if (adx < config.rangingThreshold) {
    return 'RANGING';
  }
  
  if (adx >= config.strongTrendThreshold) {
    return isBullish ? 'STRONG_TREND_UP' : 'STRONG_TREND_DOWN';
  }
  
  return isBullish ? 'WEAK_TREND_UP' : 'WEAK_TREND_DOWN';
}

/**
 * Classify volatility based on ATR%
 */
function classifyVolatility(
  atrPercent: number,
  config: RegimeConfig
): VolatilityRegime {
  if (atrPercent >= config.extremeVolThreshold) {
    return 'EXTREME';
  } else if (atrPercent >= config.highVolThreshold) {
    return 'HIGH';
  } else if (atrPercent <= config.lowVolThreshold) {
    return 'LOW';
  }
  return 'NORMAL';
}

/**
 * Get trading guidance based on regime
 */
function getTradingGuidance(
  regime: MarketRegime,
  volatility: VolatilityRegime,
  isStable: boolean
): { tradeable: boolean; tradeDirection: 'LONG' | 'SHORT' | 'BOTH' | 'NONE' } {
  // Don't trade in extreme volatility
  if (volatility === 'EXTREME') {
    return { tradeable: false, tradeDirection: 'NONE' };
  }
  
  // Don't trade unstable regimes
  if (!isStable) {
    return { tradeable: false, tradeDirection: 'NONE' };
  }
  
  // Ranging = difficult for trend-following
  if (regime === 'RANGING') {
    return { tradeable: false, tradeDirection: 'NONE' };
  }
  
  // Trending = trade in direction
  if (regime === 'STRONG_TREND_UP' || regime === 'WEAK_TREND_UP') {
    return { tradeable: true, tradeDirection: 'LONG' };
  }
  
  if (regime === 'STRONG_TREND_DOWN' || regime === 'WEAK_TREND_DOWN') {
    return { tradeable: true, tradeDirection: 'SHORT' };
  }
  
  return { tradeable: true, tradeDirection: 'BOTH' };
}

/**
 * Get stop/target multipliers based on volatility
 */
function getMultipliers(volatility: VolatilityRegime): {
  stopMultiplier: number;
  targetMultiplier: number;
} {
  switch (volatility) {
    case 'LOW':
      return { stopMultiplier: 0.8, targetMultiplier: 0.8 };
    case 'HIGH':
      return { stopMultiplier: 1.5, targetMultiplier: 1.5 };
    case 'EXTREME':
      return { stopMultiplier: 2.0, targetMultiplier: 2.0 };
    default:
      return { stopMultiplier: 1.0, targetMultiplier: 1.0 };
  }
}

/**
 * Get default regime when not enough data
 */
function getDefaultRegime(candles: Candle[]): RegimeContext {
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  
  return {
    regime: 'RANGING',
    volatility: 'NORMAL',
    adx: 0,
    plusDI: 0,
    minusDI: 0,
    ema20: currentPrice,
    ema50: currentPrice,
    emaSpread: 0,
    atr: 0,
    atrPercent: 0,
    regimeAge: 0,
    isStable: false,
    tradeable: false,
    tradeDirection: 'NONE',
    stopMultiplier: 1.0,
    targetMultiplier: 1.0,
  };
}

/**
 * Check if a signal direction matches the regime
 */
export function isSignalAlignedWithRegime(
  direction: 'LONG' | 'SHORT',
  regime: RegimeContext
): boolean {
  if (!regime.tradeable) {
    return false;
  }
  
  if (regime.tradeDirection === 'BOTH') {
    return true;
  }
  
  return regime.tradeDirection === direction;
}

/**
 * Get regime summary for logging
 */
export function getRegimeSummary(regime: RegimeContext): string {
  const parts = [
    `Regime: ${regime.regime}`,
    `Vol: ${regime.volatility}`,
    `ADX: ${regime.adx.toFixed(1)}`,
    `EMA Spread: ${regime.emaSpread.toFixed(2)}%`,
    regime.tradeable ? `Trade: ${regime.tradeDirection}` : 'No Trade',
  ];
  
  return parts.join(' | ');
}

export default {
  detectRegime,
  isSignalAlignedWithRegime,
  getRegimeSummary,
};

