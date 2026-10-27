/**
 * Candle Resampler
 * 
 * Converts lower timeframe candles to higher timeframe candles.
 * Essential for Multi-Timeframe Analysis (MTF).
 * 
 * Example: 1H candles -> 4H candles
 */
import { Candle, Timeframe } from '../types';
import { getSpec } from '../strategies/strategySpec';

/**
 * Timeframe to minutes mapping
 */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
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
  '30m': 30,
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
 * NSE market hours in UTC (IST = UTC+5:30)
 * 09:15 IST = 03:45 UTC, 15:30 IST = 10:00 UTC
 */
export const NSE_MARKET_HOURS_UTC = {
  openHour: 3,
  openMinute: 45,
  closeHour: 10,
  closeMinute: 0,
  tradingMinutes: 375,
};

/**
 * IST offset in milliseconds
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Get minutes for a timeframe
 */
export function getTimeframeMinutes(tf: Timeframe): number {
  return TIMEFRAME_MINUTES[tf] || 60;
}

/**
 * Get the standard HTF for a given LTF from the shared strategy specification.
 * Falls back to hardcoded mapping if spec is unavailable.
 */
export function getHigherTimeframe(ltf: Timeframe): Timeframe {
  try {
    const spec = getSpec();
    const hierarchy = spec.value<Record<Timeframe, Timeframe>>('MTF_TIMEFRAME_HIERARCHY');
    if (hierarchy && hierarchy[ltf]) {
      return hierarchy[ltf];
    }
  } catch {
    // Spec unavailable, use fallback
  }
  // Fallback mapping (matches current hardcoded values)
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

      // DEFECT FIX: a chunk that is full but is the LAST chunk may still be an
      // in-progress higher-timeframe period -- the lower-timeframe candle that
      // would complete it has not arrived yet. Emitting it would let the MTF
      // filter see a partially-formed HTF candle, violating principle P5 of
      // research-py/docs/EXECUTION_SEMANTICS.md ("Higher-timeframe filters
      // use only completed higher-timeframe candles").
      //
      // The final chunk is therefore dropped unless it is the very last
      // lower-timeframe candle in the input (i.e. the period is genuinely
      // complete).
      const isLastChunk = i + ratio >= candles.length;
      const chunkEndsAtLastCandle = i + ratio === candles.length;

      if (isLastChunk && !chunkEndsAtLastCandle) {
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
   * Group candles by trading day (IST calendar date)
   * Internal timestamps are UTC; NSE session is 09:15-15:30 IST = 03:45-10:00 UTC
   */
  static groupByTradingDay(candles: Candle[]): Record<string, Candle[]> {
    const groups: Record<string, Candle[]> = {};
    
    for (const candle of candles) {
      const date = new Date(candle.timestamp);
      
      // Trading day grouping uses IST calendar date
      // Convert UTC timestamp to IST date by adding IST offset
      const istDate = new Date(candle.timestamp + IST_OFFSET_MS);
      const dateKey = istDate.toISOString().split('T')[0];
      
      // Only include candles within trading hours (03:45 - 10:00 UTC = 09:15-15:30 IST)
      const hours = date.getUTCHours();
      const minutes = date.getUTCMinutes();
      const timeMinutes = hours * 60 + minutes;
      
      const openMinutes = NSE_MARKET_HOURS_UTC.openHour * 60 + NSE_MARKET_HOURS_UTC.openMinute;
      const closeMinutes = NSE_MARKET_HOURS_UTC.closeHour * 60 + NSE_MARKET_HOURS_UTC.closeMinute;
      
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
   * Validate that a day's candles start at the expected session open (09:15 IST = 03:45 UTC)
   * Returns true if valid, false if missing opening candle or misaligned
   */
  private static validateSessionOpen(dayCandles: Candle[]): boolean {
    if (dayCandles.length === 0) return false;
    const firstCandle = dayCandles[0];
    const date = new Date(firstCandle.timestamp);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const timeMinutes = hours * 60 + minutes;
    const expectedOpenMinutes = NSE_MARKET_HOURS_UTC.openHour * 60 + NSE_MARKET_HOURS_UTC.openMinute;
    return timeMinutes === expectedOpenMinutes;
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
   * Uses UTC methods since timestamps are in UTC
   */
  static isFirstCandleOfDay(candle: Candle): boolean {
    const date = new Date(candle.timestamp);
    return date.getUTCHours() === NSE_MARKET_HOURS_UTC.openHour && 
           date.getUTCMinutes() <= NSE_MARKET_HOURS_UTC.openMinute + 5;
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

  /**
   * Resample NSE 30m candles to 1h session-aligned candles.
   * 
   * NSE session: 09:15–15:30 IST (375 minutes = 12.5 × 30m periods)
   * Complete 1h pairs (6 pairs per normal session):
   *   09:15 + 09:45 → 09:15–10:15
   *   10:15 + 10:45 → 10:15–11:15
   *   11:15 + 11:45 → 11:15–12:15
   *   12:15 + 12:45 → 12:15–13:15
   *   13:15 + 13:45 → 13:15–14:15
   *   14:15 + 14:45 → 14:15–15:15
   * 
   * The 15:15 30m candle (if present) is a partial interval and is NOT paired.
   * Candles are grouped by trading day; never paired across days or gaps.
   * Missing opening candle (not at 09:15 IST) causes the entire day to be skipped.
   * 
   * @param candles Source 30m candles (timestamps in UTC, representing IST candle starts)
   * @returns Session-aligned 1h candles
   */
  static resample30mTo1hSessionAligned(candles: Candle[]): Candle[] {
    if (candles.length < 2) return [];
    
    const expectedIntervalMs = 30 * 60 * 1000; // 30 minutes
    const resampled: Candle[] = [];
    const dayGroups = this.groupByTradingDay(candles);
    
    for (const day of Object.keys(dayGroups).sort()) {
      const dayCandles = dayGroups[day];
      
      // Validate session opens at expected time (09:15 IST = 03:45 UTC)
      // Missing or misaligned opening candle invalidates the entire day's pairing
      if (!this.validateSessionOpen(dayCandles)) {
        continue;
      }
      
      // Pair consecutive 30m candles within the session: (0,1), (2,3), ...
      for (let i = 0; i + 1 < dayCandles.length; i += 2) {
        const c1 = dayCandles[i];
        const c2 = dayCandles[i + 1];
        
        // Validate exact expected interval (no missing candles, no gaps)
        const actualInterval = c2.timestamp - c1.timestamp;
        if (actualInterval !== expectedIntervalMs) {
          // Gap or missing candle: skip this pair
          continue;
        }
        
        // Valid pair: aggregate into 1h candle
        const htfCandle = this.aggregateCandlesStatic([c1, c2]);
        resampled.push(htfCandle);
      }
    }
    
    return resampled;
  }
}

export default CandleResampler;

