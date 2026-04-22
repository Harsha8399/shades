/**
 * Volume Analysis Module
 * 
 * "Volume confirms price." - Every profitable trader knows this.
 * 
 * High volume on a breakout = more likely to follow through
 * High volume rejection = strong buyer/seller interest
 * Low volume moves often reverse
 */
import { Candle } from '../types';

/**
 * Volume classification based on ratio to average
 */
export type VolumeClassification = 'LOW' | 'NORMAL' | 'HIGH' | 'CLIMAX';

/**
 * Volume trend direction
 */
export type VolumeTrend = 'INCREASING' | 'DECREASING' | 'STABLE';

/**
 * Complete volume analysis result
 */
export interface VolumeAnalysis {
  currentVolume: number;
  averageVolume: number;
  volumeRatio: number;           // Current / Average
  classification: VolumeClassification;
  trend: VolumeTrend;
  
  // Additional context
  isAboveAverage: boolean;
  percentAboveAverage: number;   // e.g., 50 means 50% above
  
  // Volume-price relationship
  volumePriceDivergence: boolean; // Price up but volume down = warning
  
  // Recent volume stats
  highestRecent: number;
  lowestRecent: number;
}

/**
 * Configuration for volume analysis
 */
export interface VolumeConfig {
  averagePeriod: number;      // Period for average calculation (default: 20)
  trendPeriod: number;        // Period for trend detection (default: 5)
  lowThreshold: number;       // Ratio below this = LOW (default: 0.5)
  highThreshold: number;      // Ratio above this = HIGH (default: 1.5)
  climaxThreshold: number;    // Ratio above this = CLIMAX (default: 3.0)
}

/**
 * Default volume configuration
 */
export const DEFAULT_VOLUME_CONFIG: VolumeConfig = {
  averagePeriod: 20,
  trendPeriod: 5,
  lowThreshold: 0.5,
  highThreshold: 1.5,
  climaxThreshold: 3.0,
};

/**
 * Analyze volume characteristics
 */
export function analyzeVolume(
  candles: Candle[],
  config: Partial<VolumeConfig> = {}
): VolumeAnalysis {
  const cfg = { ...DEFAULT_VOLUME_CONFIG, ...config };
  
  if (candles.length < cfg.averagePeriod) {
    // Not enough data, return neutral
    return {
      currentVolume: candles[candles.length - 1]?.volume ?? 0,
      averageVolume: 0,
      volumeRatio: 1,
      classification: 'NORMAL',
      trend: 'STABLE',
      isAboveAverage: false,
      percentAboveAverage: 0,
      volumePriceDivergence: false,
      highestRecent: 0,
      lowestRecent: 0,
    };
  }
  
  const currentVolume = candles[candles.length - 1].volume;
  
  // Calculate average volume
  const recentCandles = candles.slice(-cfg.averagePeriod);
  const averageVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / cfg.averagePeriod;
  
  // Calculate ratio
  const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : 1;
  
  // Classify volume
  const classification = classifyVolume(volumeRatio, cfg);
  
  // Determine trend
  const trend = calculateVolumeTrend(candles, cfg.trendPeriod);
  
  // Calculate additional stats
  const volumes = recentCandles.map(c => c.volume);
  const highestRecent = Math.max(...volumes);
  const lowestRecent = Math.min(...volumes);
  
  // Check for volume-price divergence
  const volumePriceDivergence = detectVolumePriceDivergence(candles, cfg.trendPeriod);
  
  return {
    currentVolume,
    averageVolume,
    volumeRatio,
    classification,
    trend,
    isAboveAverage: volumeRatio > 1,
    percentAboveAverage: (volumeRatio - 1) * 100,
    volumePriceDivergence,
    highestRecent,
    lowestRecent,
  };
}

/**
 * Classify volume based on ratio thresholds
 */
function classifyVolume(ratio: number, config: VolumeConfig): VolumeClassification {
  if (ratio >= config.climaxThreshold) {
    return 'CLIMAX';
  } else if (ratio >= config.highThreshold) {
    return 'HIGH';
  } else if (ratio <= config.lowThreshold) {
    return 'LOW';
  }
  return 'NORMAL';
}

/**
 * Calculate volume trend over recent bars
 */
function calculateVolumeTrend(candles: Candle[], period: number): VolumeTrend {
  if (candles.length < period + 1) {
    return 'STABLE';
  }
  
  const recent = candles.slice(-period);
  const older = candles.slice(-(period * 2), -period);
  
  if (older.length === 0) {
    return 'STABLE';
  }
  
  const recentAvg = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const olderAvg = older.reduce((s, c) => s + c.volume, 0) / older.length;
  
  const change = (recentAvg - olderAvg) / olderAvg;
  
  if (change > 0.2) {
    return 'INCREASING';
  } else if (change < -0.2) {
    return 'DECREASING';
  }
  return 'STABLE';
}

/**
 * Detect volume-price divergence
 * 
 * Divergence occurs when:
 * - Price making higher highs but volume decreasing = bearish divergence
 * - Price making lower lows but volume decreasing = bullish divergence
 */
function detectVolumePriceDivergence(candles: Candle[], period: number): boolean {
  if (candles.length < period + 1) {
    return false;
  }
  
  const recent = candles.slice(-period);
  const first = recent[0];
  const last = recent[recent.length - 1];
  
  const priceUp = last.close > first.close;
  const volumeUp = last.volume > first.volume;
  
  // Divergence = price and volume moving in opposite directions
  return priceUp !== volumeUp;
}

/**
 * Check if current volume confirms a breakout
 */
export function isBreakoutConfirmed(
  candles: Candle[],
  minRatio: number = 1.5
): boolean {
  const analysis = analyzeVolume(candles);
  return analysis.volumeRatio >= minRatio;
}

/**
 * Check if current volume confirms a rejection
 */
export function isRejectionConfirmed(
  candles: Candle[],
  minRatio: number = 1.2
): boolean {
  const analysis = analyzeVolume(candles);
  const currentCandle = candles[candles.length - 1];
  
  // Rejection = above average volume + wick > body
  const body = Math.abs(currentCandle.close - currentCandle.open);
  const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
  const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
  const maxWick = Math.max(upperWick, lowerWick);
  
  return analysis.volumeRatio >= minRatio && maxWick > body;
}

/**
 * Get volume-based trading recommendation
 */
export function getVolumeSignal(analysis: VolumeAnalysis): {
  shouldTrade: boolean;
  confidence: number;
  warning: string | null;
} {
  // LOW volume = don't trade, moves often fail
  if (analysis.classification === 'LOW') {
    return {
      shouldTrade: false,
      confidence: 0,
      warning: 'Low volume - signal may fail',
    };
  }
  
  // CLIMAX volume = caution, could be exhaustion
  if (analysis.classification === 'CLIMAX') {
    return {
      shouldTrade: true,
      confidence: 0.6,
      warning: 'Climax volume - potential exhaustion',
    };
  }
  
  // HIGH volume = good confirmation
  if (analysis.classification === 'HIGH') {
    return {
      shouldTrade: true,
      confidence: 0.9,
      warning: null,
    };
  }
  
  // Volume-price divergence = warning
  if (analysis.volumePriceDivergence) {
    return {
      shouldTrade: true,
      confidence: 0.7,
      warning: 'Volume-price divergence detected',
    };
  }
  
  // NORMAL volume = OK but not ideal
  return {
    shouldTrade: true,
    confidence: 0.8,
    warning: null,
  };
}

/**
 * Get volume summary for logging
 */
export function getVolumeSummary(analysis: VolumeAnalysis): string {
  const ratio = `${analysis.volumeRatio.toFixed(2)}x avg`;
  const trend = analysis.trend.toLowerCase();
  return `Volume: ${analysis.classification} (${ratio}, ${trend})`;
}

export default {
  analyzeVolume,
  isBreakoutConfirmed,
  isRejectionConfirmed,
  getVolumeSignal,
  getVolumeSummary,
};

