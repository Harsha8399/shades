/**
 * Multi-Timeframe Analyzer
 * 
 * Analyzes higher and lower timeframes to ensure trade alignment:
 * - HTF provides trend direction (the "bias")
 * - LTF provides entry timing
 * - Only trade when aligned = better win rate
 */
import { Candle, Timeframe, Direction } from '../types';
import {
  TimeframeBias,
  MTFContext,
  MTFConfig,
  TrendBias,
  TrendStrength,
  DEFAULT_MTF_CONFIG,
  getHTFFor,
} from '../types/mtf';
import { calculateEMA, calculateSMA } from '../indicators/technical';
import { findSRZones } from '../indicators/supportResistance';

/**
 * Analyze multi-timeframe context
 */
export function analyzeMTF(
  htfCandles: Candle[],
  ltfCandles: Candle[],
  htfTimeframe: Timeframe,
  ltfTimeframe: Timeframe,
  config: Partial<MTFConfig> = {}
): MTFContext {
  const cfg = { ...DEFAULT_MTF_CONFIG, ...config };
  
  // Analyze each timeframe
  const htf = analyzeTimeframe(htfCandles, htfTimeframe, cfg, true);
  const ltf = analyzeTimeframe(ltfCandles, ltfTimeframe, cfg, false);
  
  // Determine alignment
  const alignmentType = getAlignmentType(htf.bias, ltf.bias);
  const aligned = alignmentType === 'PERFECT' || alignmentType === 'PARTIAL';
  
  // Get recommended direction
  const recommendedDirection = getRecommendedDirection(htf, ltf);
  
  // Calculate confluence bonus
  const confluenceBonus = calculateConfluenceBonus(alignmentType, htf.strengthScore, ltf.strengthScore);
  
  // Find HTF levels near current price
  const currentPrice = ltfCandles.length > 0 ? ltfCandles[ltfCandles.length - 1].close : 0;
  const htfLevelsNearby = findNearbyLevels(htf, currentPrice, cfg);
  const priceRelativeToHTFLevels = getPriceRelation(currentPrice, htf);
  
  return {
    htf,
    ltf,
    aligned,
    alignmentType,
    recommendedDirection,
    confluenceBonus,
    htfLevelsNearby,
    priceRelativeToHTFLevels,
  };
}

/**
 * Analyze a single timeframe for bias
 */
export function analyzeTimeframe(
  candles: Candle[],
  timeframe: Timeframe,
  config: MTFConfig,
  isHTF: boolean
): TimeframeBias {
  if (candles.length < config.slowEMA + 10) {
    return getDefaultBias(timeframe);
  }
  
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  
  // Calculate EMAs
  const ema20Values = calculateEMA(closes, config.fastEMA);
  const ema50Values = calculateEMA(closes, config.slowEMA);
  
  const ema20 = ema20Values[ema20Values.length - 1];
  const ema50 = ema50Values[ema50Values.length - 1];
  
  let ema200: number | undefined;
  if (isHTF && candles.length >= config.trendEMA + 10) {
    const ema200Values = calculateEMA(closes, config.trendEMA);
    ema200 = ema200Values[ema200Values.length - 1];
  }
  
  // Determine bias
  const { bias, strength, strengthScore } = determineBias(
    currentPrice,
    ema20,
    ema50,
    ema200
  );
  
  // Find key levels
  const { keyResistance, keySupport } = findKeyLevels(candles);
  
  return {
    timeframe,
    bias,
    strength,
    strengthScore,
    ema20,
    ema50,
    ema200,
    keyResistance,
    keySupport,
    lastUpdated: new Date(),
    barsAnalyzed: candles.length,
  };
}

/**
 * Determine bias from EMA configuration
 */
function determineBias(
  price: number,
  ema20: number,
  ema50: number,
  ema200?: number
): { bias: TrendBias; strength: TrendStrength; strengthScore: number } {
  let bullishPoints = 0;
  let totalPoints = 0;
  
  // Price above EMAs
  if (price > ema20) bullishPoints += 1;
  totalPoints += 1;
  
  if (price > ema50) bullishPoints += 1;
  totalPoints += 1;
  
  if (ema200 !== undefined) {
    if (price > ema200) bullishPoints += 1;
    totalPoints += 1;
  }
  
  // EMA alignment
  if (ema20 > ema50) bullishPoints += 1.5;
  totalPoints += 1.5;
  
  if (ema200 !== undefined && ema50 > ema200) bullishPoints += 1;
  totalPoints += 1;
  
  // Calculate score
  const score = bullishPoints / totalPoints;
  
  // Determine bias
  let bias: TrendBias;
  if (score >= 0.65) {
    bias = 'LONG';
  } else if (score <= 0.35) {
    bias = 'SHORT';
  } else {
    bias = 'NEUTRAL';
  }
  
  // Determine strength
  let strength: TrendStrength;
  const extremity = Math.abs(score - 0.5) * 2; // 0-1
  
  if (bias === 'NEUTRAL') {
    strength = 'NONE';
  } else if (extremity >= 0.7) {
    strength = 'STRONG';
  } else if (extremity >= 0.4) {
    strength = 'MODERATE';
  } else {
    strength = 'WEAK';
  }
  
  return { bias, strength, strengthScore: extremity };
}

/**
 * Find key support/resistance levels
 */
function findKeyLevels(candles: Candle[]): {
  keyResistance: number[];
  keySupport: number[];
} {
  if (candles.length < 50) {
    return { keyResistance: [], keySupport: [] };
  }
  
  // Use swing highs/lows as key levels
  const highs: number[] = [];
  const lows: number[] = [];
  
  for (let i = 5; i < candles.length - 5; i++) {
    const isSwingHigh = candles.slice(i - 5, i).every(c => c.high < candles[i].high) &&
                        candles.slice(i + 1, i + 6).every(c => c.high < candles[i].high);
    const isSwingLow = candles.slice(i - 5, i).every(c => c.low > candles[i].low) &&
                       candles.slice(i + 1, i + 6).every(c => c.low > candles[i].low);
    
    if (isSwingHigh) highs.push(candles[i].high);
    if (isSwingLow) lows.push(candles[i].low);
  }
  
  // Get most significant (most recent)
  return {
    keyResistance: highs.slice(-3),
    keySupport: lows.slice(-3),
  };
}

/**
 * Get alignment type between HTF and LTF
 */
function getAlignmentType(
  htfBias: TrendBias,
  ltfBias: TrendBias
): 'PERFECT' | 'PARTIAL' | 'NONE' | 'COUNTER' {
  if (htfBias === 'NEUTRAL' || ltfBias === 'NEUTRAL') {
    return 'NONE';
  }
  
  if (htfBias === ltfBias) {
    return 'PERFECT';
  }
  
  // Opposite directions (htf and ltf disagree)
  return 'COUNTER';
}

/**
 * Get recommended trade direction
 */
function getRecommendedDirection(htf: TimeframeBias, ltf: TimeframeBias): TrendBias {
  // HTF takes precedence
  if (htf.bias !== 'NEUTRAL' && htf.strengthScore >= 0.4) {
    return htf.bias;
  }
  
  // Fall back to LTF if HTF is weak
  return ltf.bias;
}

/**
 * Calculate confluence bonus for aligned trades
 */
function calculateConfluenceBonus(
  alignmentType: 'PERFECT' | 'PARTIAL' | 'NONE' | 'COUNTER',
  htfStrength: number,
  ltfStrength: number
): number {
  switch (alignmentType) {
    case 'PERFECT':
      // Up to 0.2 bonus based on combined strength
      return 0.1 + (0.1 * (htfStrength + ltfStrength) / 2);
    case 'PARTIAL':
      return 0.05;
    case 'COUNTER':
      return -0.1; // Penalty for counter-trend
    default:
      return 0;
  }
}

/**
 * Find HTF levels near current price
 */
function findNearbyLevels(
  htf: TimeframeBias,
  currentPrice: number,
  config: MTFConfig
): number[] {
  const allLevels = [...htf.keyResistance, ...htf.keySupport];
  const priceRange = currentPrice * 0.02; // Within 2%
  
  return allLevels.filter(level => 
    Math.abs(level - currentPrice) <= priceRange
  );
}

/**
 * Get price relation to HTF levels
 */
function getPriceRelation(
  currentPrice: number,
  htf: TimeframeBias
): 'ABOVE' | 'BELOW' | 'AT' | 'BETWEEN' {
  const nearResistance = htf.keyResistance.some(r => 
    Math.abs(r - currentPrice) / currentPrice < 0.005
  );
  const nearSupport = htf.keySupport.some(s => 
    Math.abs(s - currentPrice) / currentPrice < 0.005
  );
  
  if (nearResistance) return 'AT';
  if (nearSupport) return 'AT';
  
  const aboveAllResistance = htf.keyResistance.every(r => currentPrice > r);
  const belowAllSupport = htf.keySupport.every(s => currentPrice < s);
  
  if (aboveAllResistance) return 'ABOVE';
  if (belowAllSupport) return 'BELOW';
  
  return 'BETWEEN';
}

/**
 * Get default bias when not enough data
 */
function getDefaultBias(timeframe: Timeframe): TimeframeBias {
  return {
    timeframe,
    bias: 'NEUTRAL',
    strength: 'NONE',
    strengthScore: 0,
    ema20: 0,
    ema50: 0,
    keyResistance: [],
    keySupport: [],
    lastUpdated: new Date(),
    barsAnalyzed: 0,
  };
}

/**
 * Check if a signal aligns with MTF context
 */
export function isSignalAlignedWithMTF(
  direction: Direction,
  mtf: MTFContext,
  minHTFStrength: number = 0.3
): { aligned: boolean; reason: string } {
  // Check if HTF is strong enough
  if (mtf.htf.strengthScore < minHTFStrength) {
    return { aligned: false, reason: 'HTF trend too weak' };
  }
  
  // Check alignment
  if (mtf.alignmentType === 'COUNTER') {
    return { aligned: false, reason: 'Counter-trend trade' };
  }
  
  // Check direction match
  if (mtf.htf.bias !== 'NEUTRAL' && mtf.htf.bias !== direction) {
    return { aligned: false, reason: `HTF bias is ${mtf.htf.bias}, signal is ${direction}` };
  }
  
  return { aligned: true, reason: 'Aligned with HTF' };
}

/**
 * Get MTF summary for logging
 */
export function getMTFSummary(mtf: MTFContext): string {
  const parts = [
    `HTF: ${mtf.htf.bias} (${mtf.htf.strength})`,
    `LTF: ${mtf.ltf.bias} (${mtf.ltf.strength})`,
    `Alignment: ${mtf.alignmentType}`,
    `Rec: ${mtf.recommendedDirection}`,
  ];
  
  if (mtf.confluenceBonus !== 0) {
    parts.push(`Bonus: ${mtf.confluenceBonus > 0 ? '+' : ''}${(mtf.confluenceBonus * 100).toFixed(0)}%`);
  }
  
  return parts.join(' | ');
}

export default {
  analyzeMTF,
  analyzeTimeframe,
  isSignalAlignedWithMTF,
  getMTFSummary,
};

