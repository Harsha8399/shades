/**
 * Candle Resampler
 * 
 * Converts lower timeframe candles to higher timeframe candles.
 * Essential for Multi-Timeframe Analysis (MTF).
 * 
 * Example: 1H candles -> 4H candles
 */
import { Candle, Timeframe } from '../types';

/**
 * Timeframe to minutes mapping
 */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

/**
 * NSE-specific timeframes
 * Trading day is 375 minutes (9:15 AM - 3:30 PM)
 */
export const NSE_TIMEFRAME_MINUTES: Record<string, number> = {
  '5m': 5,
  '15m': 15,
  '75m': 75,    // Popular in India: 5 candles per day
  '1h': 60,
  '1d': 375,    // Full NSE trading day
};

/**
 * NSE market hours (in IST)
 */
export const NSE_MARKET_HOURS = {
  openHour: 9,
  openMinute: 15,
  closeHour: 15,
  closeMinute: 30,
  tradingMinutes: 375,  // 6 hours 15 minutes
};

/**
 * Get minutes for a timeframe
 */
export function getTimeframeMinutes(tf: Timeframe): number {
  return TIMEFRAME_MINUTES[tf] || 60;
}

/**
 * Get the standard HTF for a given LTF
 */
export function getHigherTimeframe(ltf: Timeframe): Timeframe {
  switch (ltf) {
    case '1m': return '5m';
    case '5m': return '1h';
    case '15m': return '4h';
    case '1h': return '4h';
    case '4h': return '1d';
    case '1d': return '1w';
    default: return '4h';
  }
}

/**
 * Candle Resampler class
 */
export class CandleResampler {
  /**
   * Resample lower timeframe candles to a higher timeframe
   * 
   * @param candles Source candles (e.g., 1h)
   * @param sourceTfMinutes Source timeframe in minutes (e.g., 60)
   * @param targetTfMinutes Target timeframe in minutes (e.g., 240)
   * @returns Array of higher timeframe candles
   */
  static resample(
    candles: Candle[],
    sourceTfMinutes: number,
    targetTfMinutes: number
  ): Candle[] {
    if (candles.length === 0) {
      return [];
    }
    
    if (targetTfMinutes <= sourceTfMinutes) {
      console.warn('[CandleResampler] Target TF must be greater than source TF');
      return candles;
    }
    
    if (targetTfMinutes % sourceTfMinutes !== 0) {
      console.warn(`[CandleResampler] Target TF (${targetTfMinutes}) should be a multiple of source TF (${sourceTfMinutes})`);
    }
    
    const ratio = Math.floor(targetTfMinutes / sourceTfMinutes);
    const resampled: Candle[] = [];
    
    // Align to clean HTF boundaries
    // Find the first candle that starts a new HTF period
    const targetTfMs = targetTfMinutes * 60 * 1000;
    
    let startIndex = 0;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].timestamp % targetTfMs === 0) {
        startIndex = i;
        break;
      }
    }
    
    // Process in chunks
    for (let i = startIndex; i < candles.length; i += ratio) {
      const chunk = candles.slice(i, i + ratio);
      
      // Skip incomplete final candle
      if (chunk.length < ratio) {
        continue;
      }
      
      const htfCandle = this.aggregateCandles(chunk);
      resampled.push(htfCandle);
    }
    
    return resampled;
  }
  
  /**
   * Resample using timeframe strings
   */
  static resampleByTimeframe(
    candles: Candle[],
    sourceTimeframe: Timeframe,
    targetTimeframe: Timeframe
  ): Candle[] {
    const sourceMinutes = getTimeframeMinutes(sourceTimeframe);
    const targetMinutes = getTimeframeMinutes(targetTimeframe);
    
    return this.resample(candles, sourceMinutes, targetMinutes);
  }
  
  /**
   * Aggregate multiple candles into one
   */
  private static aggregateCandles(candles: Candle[]): Candle {
    if (candles.length === 0) {
      throw new Error('Cannot aggregate empty candle array');
    }
    
    const open = candles[0].open;
    const close = candles[candles.length - 1].close;
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const volume = candles.reduce((sum, c) => sum + (c.volume || 0), 0);
    const timestamp = candles[0].timestamp;
    
    return { timestamp, open, high, low, close, volume };
  }
  
  /**
   * Get the last N complete HTF candles from LTF data
   * Useful for getting just enough HTF data for analysis
   */
  static getLastNHTFCandles(
    candles: Candle[],
    sourceTimeframe: Timeframe,
    targetTimeframe: Timeframe,
    n: number
  ): Candle[] {
    const resampled = this.resampleByTimeframe(candles, sourceTimeframe, targetTimeframe);
    return resampled.slice(-n);
  }
}

/**
 * NSE-specific gap info
 */
export interface GapInfo {
  hasGap: boolean;
  gapType: 'UP' | 'DOWN' | 'NONE';
  gapPercent: number;
  previousClose: number;
  currentOpen: number;
}

/**
 * NSE Candle Resampler
 * 
 * Extends CandleResampler with NSE-specific features:
 * - 75-minute candles (5 per day)
 * - Market gap detection
 * - Session-aware resampling
 */
export class NseCandleResampler extends CandleResampler {
  /**
   * Resample to 75-minute candles (NSE-specific)
   * 
   * 75-minute candles are popular in Indian markets because:
   * - Trading day = 375 minutes
   * - 375 / 75 = 5 clean candles per day
   * 
   * Candle times: 9:15, 10:30, 11:45, 13:00, 14:15 (closes at 15:30)
   */
  static resampleTo75Min(candles: Candle[], sourceMinutes: number): Candle[] {
    if (candles.length === 0) return [];
    
    const targetMinutes = 75;
    const ratio = Math.floor(targetMinutes / sourceMinutes);
    
    const resampled: Candle[] = [];
    const dayGroups = this.groupByTradingDay(candles);
    
    for (const dayCandles of Object.values(dayGroups)) {
      // Each trading day should produce 5 candles
      for (let i = 0; i < dayCandles.length; i += ratio) {
        const chunk = dayCandles.slice(i, i + ratio);
        if (chunk.length >= ratio * 0.8) {  // Allow 80% of candles (for incomplete sessions)
          const htfCandle = this.aggregateCandlesStatic(chunk);
          resampled.push(htfCandle);
        }
      }
    }
    
    return resampled;
  }
  
  /**
   * Group candles by trading day
   */
  static groupByTradingDay(candles: Candle[]): Record<string, Candle[]> {
    const groups: Record<string, Candle[]> = {};
    
    for (const candle of candles) {
      const date = new Date(candle.timestamp);
      const dateKey = date.toISOString().split('T')[0];
      
      // Only include candles within trading hours (9:15 - 15:30 IST)
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const timeMinutes = hours * 60 + minutes;
      
      const openMinutes = NSE_MARKET_HOURS.openHour * 60 + NSE_MARKET_HOURS.openMinute;
      const closeMinutes = NSE_MARKET_HOURS.closeHour * 60 + NSE_MARKET_HOURS.closeMinute;
      
      if (timeMinutes >= openMinutes && timeMinutes <= closeMinutes) {
        if (!groups[dateKey]) {
          groups[dateKey] = [];
        }
        groups[dateKey].push(candle);
      }
    }
    
    return groups;
  }
  
  /**
   * Detect overnight gaps between trading sessions
   */
  static detectGaps(candles: Candle[]): { candle: Candle; gap: GapInfo }[] {
    const gaps: { candle: Candle; gap: GapInfo }[] = [];
    const dayGroups = this.groupByTradingDay(candles);
    const days = Object.keys(dayGroups).sort();
    
    for (let i = 1; i < days.length; i++) {
      const prevDay = dayGroups[days[i - 1]];
      const currDay = dayGroups[days[i]];
      
      if (prevDay.length > 0 && currDay.length > 0) {
        const previousClose = prevDay[prevDay.length - 1].close;
        const currentOpen = currDay[0].open;
        
        const gapPercent = ((currentOpen - previousClose) / previousClose) * 100;
        const hasGap = Math.abs(gapPercent) > 0.5;  // >0.5% is a gap
        
        if (hasGap) {
          gaps.push({
            candle: currDay[0],
            gap: {
              hasGap,
              gapType: gapPercent > 0 ? 'UP' : 'DOWN',
              gapPercent,
              previousClose,
              currentOpen,
            },
          });
        }
      }
    }
    
    return gaps;
  }
  
  /**
   * Check if a candle is the first candle of the trading day
   */
  static isFirstCandleOfDay(candle: Candle): boolean {
    const date = new Date(candle.timestamp);
    return date.getHours() === NSE_MARKET_HOURS.openHour && 
           date.getMinutes() <= NSE_MARKET_HOURS.openMinute + 5;
  }
  
  /**
   * Get gap-adjusted entry recommendation
   * If there's a gap up, wait for retest before LONG
   * If there's a gap down, wait for retest before SHORT
   */
  static getGapAdjustedBias(gap: GapInfo): 'WAIT' | 'PROCEED' {
    // Large gaps (>2%) often retrace
    if (Math.abs(gap.gapPercent) > 2) {
      return 'WAIT';
    }
    return 'PROCEED';
  }
  
  /**
   * Static aggregate helper (for use in static methods)
   */
  private static aggregateCandlesStatic(candles: Candle[]): Candle {
    if (candles.length === 0) {
      throw new Error('Cannot aggregate empty candle array');
    }
    
    return {
      timestamp: candles[0].timestamp,
      open: candles[0].open,
      high: Math.max(...candles.map(c => c.high)),
      low: Math.min(...candles.map(c => c.low)),
      close: candles[candles.length - 1].close,
      volume: candles.reduce((sum, c) => sum + (c.volume || 0), 0),
    };
  }
}

export default CandleResampler;

