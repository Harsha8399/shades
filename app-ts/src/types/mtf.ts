/**
 * Multi-Timeframe Analysis Types
 * 
 * "Trade WITH the trend" - Higher timeframe alignment dramatically improves win rate.
 * A pullback entry on 1H that aligns with Daily uptrend is far more reliable.
 */
import { Timeframe, Direction } from './candle';

/**
 * Bias direction for a timeframe
 */
export type TrendBias = 'LONG' | 'SHORT' | 'NEUTRAL';

/**
 * Trend strength classification
 */
export type TrendStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

/**
 * Bias analysis for a single timeframe
 */
export interface TimeframeBias {
  timeframe: Timeframe;
  bias: TrendBias;
  strength: TrendStrength;
  strengthScore: number;  // 0-1 numerical strength
  
  // Trend indicators
  ema20: number;
  ema50: number;
  ema200?: number;        // For HTF
  
  // Key levels from this timeframe
  keyResistance: number[];
  keySupport: number[];
  
  // When this was calculated
  lastUpdated: Date;
  barsAnalyzed: number;
}

/**
 * Multi-timeframe context combining HTF and LTF
 */
export interface MTFContext {
  // Higher timeframe (trend filter)
  htf: TimeframeBias;
  
  // Lower timeframe (entry timing)
  ltf: TimeframeBias;
  
  // Alignment status
  aligned: boolean;         // HTF and LTF agree on direction
  alignmentType: 'PERFECT' | 'PARTIAL' | 'NONE' | 'COUNTER';
  
  // Trading implications
  recommendedDirection: TrendBias;
  confluenceBonus: number;  // Extra confidence when aligned (0-0.2)
  
  // Key levels from HTF that matter for LTF
  htfLevelsNearby: number[];
  priceRelativeToHTFLevels: 'ABOVE' | 'BELOW' | 'AT' | 'BETWEEN';
}

/**
 * Configuration for MTF analysis
 */
export interface MTFConfig {
  htfTimeframe: Timeframe;  // Higher timeframe to check
  ltfTimeframe: Timeframe;  // Lower timeframe for entries
  
  // EMA periods
  fastEMA: number;          // Default: 20
  slowEMA: number;          // Default: 50
  trendEMA: number;         // Default: 200 (for HTF)
  
  // Alignment thresholds
  minHTFStrength: number;   // Min HTF strength to trade (default: 0.3)
  
  // Level proximity
  levelProximityATR: number; // How close price must be to HTF level (default: 1.0)
}

/**
 * Default MTF configuration
 */
export const DEFAULT_MTF_CONFIG: MTFConfig = {
  htfTimeframe: '4h',
  ltfTimeframe: '1h',
  fastEMA: 20,
  slowEMA: 50,
  trendEMA: 200,
  minHTFStrength: 0.3,
  levelProximityATR: 1.0,
};

/**
 * Standard timeframe hierarchy for MTF analysis
 */
export const TIMEFRAME_HIERARCHY: Record<Timeframe, Timeframe> = {
  '1m': '15m',
  '5m': '1h',
  '15m': '4h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
  '1w': '1w', // Weekly is top
};

/**
 * Get the higher timeframe for any given timeframe
 */
export function getHTFFor(ltf: Timeframe): Timeframe {
  return TIMEFRAME_HIERARCHY[ltf];
}

