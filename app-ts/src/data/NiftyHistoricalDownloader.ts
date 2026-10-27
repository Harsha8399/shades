/**
 * NIFTY 50 Historical Data Downloader
 * 
 * Downloads and caches historical candle data for NIFTY 50 index from Upstox API.
 * Includes validation, pagination, caching, and market session awareness.
 */

import * as fs from 'fs';
import * as path from 'path';
import { UpstoxFeed } from './UpstoxFeed';
import { Candle, Timeframe } from '../types';
import { IndianMarketCalendar, MarketSession } from './IndianMarketCalendar';
import { HISTORICAL_LIMITS } from './UpstoxFeed';

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  cacheDir: string;
  maxAgeDays: number;
}

/**
 * Download configuration
 */
export interface DownloadConfig {
  instrumentKey: string;
  timeframe: Timeframe;
  fromDate: Date;
  toDate: Date;
  cacheConfig: CacheConfig;
}

/**
 * Validation result for downloaded candles
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalCandles: number;
    duplicates: number;
    missingIntervals: number;
    invalidOHLC: number;
    outsideSession: number;
  };
}

/**
 * Download result with metadata
 */
export interface DownloadResult {
  success: boolean;
  candles: Candle[];
  fromCache: boolean;
  validation: ValidationResult;
  metadata: {
    instrumentKey: string;
    timeframe: Timeframe;
    requestedFrom: Date;
    requestedTo: Date;
    actualFrom: Date | null;
    actualTo: Date | null;
    downloadTimeMs: number;
    cachedAt: Date | null;
  };
  error?: string;
}

/**
 * NIFTY 50 Index instrument keys
 */
export const NIFTY_INSTRUMENT_KEYS = {
  NIFTY50: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  NIFTYIT: 'NSE_INDEX|Nifty IT',
  NIFTYMIDCAP: 'NSE_INDEX|NIFTY MIDCAP 100',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
} as const;

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  cacheDir: path.resolve('./data/nifty-cache'),
  maxAgeDays: 7,
};

/**
 * NIFTY Historical Data Downloader
 */
export class NiftyHistoricalDownloader {
  private upstoxFeed: UpstoxFeed;
  private marketCalendar: IndianMarketCalendar;
  private cacheConfig: CacheConfig;

  constructor(upstoxFeed: UpstoxFeed, cacheConfig: CacheConfig = DEFAULT_CACHE_CONFIG) {
    this.upstoxFeed = upstoxFeed;
    this.marketCalendar = new IndianMarketCalendar();
    this.cacheConfig = cacheConfig;
    
    // Ensure cache directory exists
    if (this.cacheConfig.enabled && !fs.existsSync(this.cacheConfig.cacheDir)) {
      fs.mkdirSync(this.cacheConfig.cacheDir, { recursive: true });
    }
  }

  /**
   * Download historical data with pagination support
   */
  async download(config: DownloadConfig): Promise<DownloadResult> {
    const startTime = Date.now();
    const { instrumentKey, timeframe, fromDate, toDate, cacheConfig } = config;
    
    // Check cache first
    if (cacheConfig.enabled) {
      const cached = this.loadFromCache(instrumentKey, timeframe, fromDate, toDate, cacheConfig);
      if (cached) {
        const validation = this.validateCandles(cached.candles, timeframe, fromDate, toDate);
        return {
          success: true,
          candles: cached.candles,
          fromCache: true,
          validation,
          metadata: {
            instrumentKey,
            timeframe,
            requestedFrom: fromDate,
            requestedTo: toDate,
            actualFrom: cached.metadata.actualFrom,
            actualTo: cached.metadata.actualTo,
            downloadTimeMs: Date.now() - startTime,
            cachedAt: cached.metadata.cachedAt,
          },
        };
      }
    }

    // Download from API with pagination
    const limit = HISTORICAL_LIMITS[timeframe];
    if (!limit) {
      return {
        success: false,
        candles: [],
        fromCache: false,
        validation: { isValid: false, errors: [`Unsupported timeframe: ${timeframe}`], warnings: [], stats: { totalCandles: 0, duplicates: 0, missingIntervals: 0, invalidOHLC: 0, outsideSession: 0 } },
        metadata: {
          instrumentKey,
          timeframe,
          requestedFrom: fromDate,
          requestedTo: toDate,
          actualFrom: null,
          actualTo: null,
          downloadTimeMs: Date.now() - startTime,
          cachedAt: null,
        },
        error: `Unsupported timeframe: ${timeframe}`,
      };
    }

    try {
      // Calculate date chunks for pagination
      const chunks = this.calculateDateChunks(fromDate, toDate, limit.maxDays);
      const allCandles: Candle[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[NiftyDownloader] Downloading chunk ${i + 1}/${chunks.length}: ${chunk.from.toISOString()} to ${chunk.to.toISOString()}`);
        
        try {
          const chunkCandles = await this.upstoxFeed.getHistoricalData(
            instrumentKey,
            timeframe,
            chunk.from,
            chunk.to
          );
          
          allCandles.push(...chunkCandles);
          
          // Small delay to respect rate limits
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (chunkError) {
          console.error(`[NiftyDownloader] Chunk ${i + 1} failed:`, chunkError);
          // Continue with other chunks
        }
      }

      // Deduplicate and sort
      const uniqueCandles = this.deduplicateCandles(allCandles);
      
      // Validate
      const validation = this.validateCandles(uniqueCandles, timeframe, fromDate, toDate);
      
      // Save to cache
      if (cacheConfig.enabled && uniqueCandles.length > 0) {
        this.saveToCache(instrumentKey, timeframe, uniqueCandles, fromDate, toDate, cacheConfig);
      }

      return {
        success: true,
        candles: uniqueCandles,
        fromCache: false,
        validation,
        metadata: {
          instrumentKey,
          timeframe,
          requestedFrom: fromDate,
          requestedTo: toDate,
          actualFrom: uniqueCandles.length > 0 ? new Date(uniqueCandles[0].timestamp) : null,
          actualTo: uniqueCandles.length > 0 ? new Date(uniqueCandles[uniqueCandles.length - 1].timestamp) : null,
          downloadTimeMs: Date.now() - startTime,
          cachedAt: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        candles: [],
        fromCache: false,
        validation: { isValid: false, errors: [error instanceof Error ? error.message : 'Unknown error'], warnings: [], stats: { totalCandles: 0, duplicates: 0, missingIntervals: 0, invalidOHLC: 0, outsideSession: 0 } },
        metadata: {
          instrumentKey,
          timeframe,
          requestedFrom: fromDate,
          requestedTo: toDate,
          actualFrom: null,
          actualTo: null,
          downloadTimeMs: Date.now() - startTime,
          cachedAt: null,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download NIFTY 50 data specifically
   */
  async downloadNifty50(
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date,
    cacheConfig: CacheConfig = DEFAULT_CACHE_CONFIG
  ): Promise<DownloadResult> {
    return this.download({
      instrumentKey: NIFTY_INSTRUMENT_KEYS.NIFTY50,
      timeframe,
      fromDate,
      toDate,
      cacheConfig,
    });
  }

  /**
   * Calculate date chunks for pagination based on API limits
   */
  private calculateDateChunks(fromDate: Date, toDate: Date, maxDays: number): Array<{ from: Date; to: Date }> {
    const chunks: Array<{ from: Date; to: Date }> = [];
    let currentFrom = new Date(fromDate);
    
    while (currentFrom < toDate) {
      const chunkTo = new Date(currentFrom);
      chunkTo.setDate(chunkTo.getDate() + maxDays - 1);
      
      if (chunkTo > toDate) {
        chunkTo.setTime(toDate.getTime());
      }
      
      chunks.push({
        from: new Date(currentFrom),
        to: new Date(chunkTo),
      });
      
      currentFrom = new Date(chunkTo);
      currentFrom.setDate(currentFrom.getDate() + 1);
    }
    
    return chunks;
  }

  /**
   * Generate cache file path
   */
  private getCachePath(instrumentKey: string, timeframe: Timeframe, fromDate: Date, toDate: Date): string {
    const safeKey = instrumentKey.replace(/[|]/g, '_');
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];
    return path.join(this.cacheConfig.cacheDir, `${safeKey}_${timeframe}_${fromStr}_${toStr}.json`);
  }

  /**
   * Save candles to cache
   */
  private saveToCache(
    instrumentKey: string,
    timeframe: Timeframe,
    candles: Candle[],
    fromDate: Date,
    toDate: Date,
    cacheConfig: CacheConfig
  ): void {
    if (!cacheConfig.enabled) return;
    
    const cachePath = this.getCachePath(instrumentKey, timeframe, new Date(candles[0].timestamp), new Date(candles[candles.length - 1].timestamp));
    const cacheData = {
      metadata: {
        instrumentKey,
        timeframe,
        actualFrom: new Date(candles[0].timestamp).toISOString(),
        actualTo: new Date(candles[candles.length - 1].timestamp).toISOString(),
        cachedAt: new Date().toISOString(),
        count: candles.length,
      },
      candles: candles.map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    };
    
    fs.writeFileSync(cachePath, JSON.stringify(cacheData));
    console.log(`[NiftyDownloader] Cached ${candles.length} candles to ${cachePath}`);
  }

  /**
   * Load candles from cache if valid
   */
  private loadFromCache(
    instrumentKey: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date,
    cacheConfig: CacheConfig
  ): { candles: Candle[]; metadata: any } | null {
    if (!cacheConfig.enabled) return null;
    
    const cachePath = this.getCachePath(instrumentKey, timeframe, fromDate, toDate);
    if (!fs.existsSync(cachePath)) return null;
    
    try {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const cachedAt = new Date(cacheData.metadata.cachedAt);
      const maxAgeMs = cacheConfig.maxAgeDays * 24 * 60 * 60 * 1000;
      
      // Check if cache is expired
      if (Date.now() - cachedAt.getTime() > maxAgeMs) {
        console.log(`[NiftyDownloader] Cache expired for ${cachePath}`);
        return null;
      }
      
      // Check if cache covers requested range
      const cachedFrom = new Date(cacheData.metadata.actualFrom).getTime();
      const cachedTo = new Date(cacheData.metadata.actualTo).getTime();
      const requestedFrom = fromDate.getTime();
      const requestedTo = toDate.getTime();
      
      if (cachedFrom > requestedFrom || cachedTo < requestedTo) {
        console.log(`[NiftyDownloader] Cache doesn't cover requested range`);
        return null;
      }
      
      const candles = cacheData.candles.map((c: any) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      
      return {
        candles,
        metadata: cacheData.metadata,
      };
    } catch (error) {
      console.error('[NiftyDownloader] Cache read error:', error);
      return null;
    }
  }

  /**
   * Deduplicate candles by timestamp
   */
  private deduplicateCandles(candles: Candle[]): Candle[] {
    const seen = new Map<number, Candle>();
    
    for (const candle of candles) {
      const existing = seen.get(candle.timestamp);
      if (!existing || candle.volume > existing.volume) {
        seen.set(candle.timestamp, candle);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Validate downloaded candles
   */
  validateCandles(candles: Candle[], timeframe: Timeframe, requestedFrom: Date, requestedTo: Date): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let duplicates = 0;
    let missingIntervals = 0;
    let invalidOHLC = 0;
    let outsideSession = 0;
    
    if (candles.length === 0) {
      errors.push('No candles downloaded');
      return {
        isValid: false,
        errors,
        warnings,
        stats: { totalCandles: 0, duplicates: 0, missingIntervals: 0, invalidOHLC: 0, outsideSession: 0 },
      };
    }
    
    // Sort by timestamp
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    
    // Check for duplicates
    const seen = new Set<number>();
    for (const c of sorted) {
      if (seen.has(c.timestamp)) {
        duplicates++;
      }
      seen.add(c.timestamp);
    }
    
    // Validate OHLC
    for (const c of sorted) {
      if (c.high < c.low) {
        invalidOHLC++;
      }
      if (c.open < c.low || c.open > c.high || c.close < c.low || c.close > c.high) {
        invalidOHLC++;
      }
      if (c.volume < 0) {
        invalidOHLC++;
      }
    }
    
    // Check for missing intervals
    const timeframeMs = this.getTimeframeMs(timeframe);
    for (let i = 1; i < sorted.length; i++) {
      const expectedDiff = timeframeMs;
      const actualDiff = sorted[i].timestamp - sorted[i - 1].timestamp;
      if (actualDiff > expectedDiff * 1.5) { // Allow 50% tolerance
        missingIntervals++;
      }
    }
    
    // Check market sessions (simplified - check if timestamp falls within NSE trading hours)
    for (const c of sorted) {
      const session = this.getSessionForTimestamp(c.timestamp);
      if (session === 'CLOSED') {
        outsideSession++;
      }
    }
    
    // Check range coverage
    const firstCandle = new Date(sorted[0].timestamp);
    const lastCandle = new Date(sorted[sorted.length - 1].timestamp);
    
    if (firstCandle > new Date(requestedFrom.getTime() + 24 * 60 * 60 * 1000)) {
      warnings.push(`Data starts ${this.formatDateDiff(firstCandle, requestedFrom)} after requested start`);
    }
    
    if (lastCandle < new Date(requestedTo.getTime() - 24 * 60 * 60 * 1000)) {
      warnings.push(`Data ends ${this.formatDateDiff(requestedTo, lastCandle)} before requested end`);
    }
    
    // Outside session warning
    if (outsideSession > sorted.length * 0.1) {
      warnings.push(`${outsideSession} candles (${((outsideSession / sorted.length) * 100).toFixed(1)}%) fall outside regular market hours`);
    }
    
    if (duplicates > 0) {
      warnings.push(`${duplicates} duplicate timestamps found and removed`);
    }
    
    if (missingIntervals > 0) {
      warnings.push(`${missingIntervals} intervals with gaps larger than expected`);
    }
    
    if (invalidOHLC > 0) {
      errors.push(`${invalidOHLC} candles with invalid OHLC data`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      stats: {
        totalCandles: sorted.length,
        duplicates,
        missingIntervals,
        invalidOHLC,
        outsideSession,
      },
    };
  }
  
  /**
   * Get market session for a specific timestamp (simplified version)
   * Checks if timestamp falls within NSE trading hours
   */
  private getSessionForTimestamp(timestamp: number): 'PRE_OPEN' | 'TRADING' | 'POST_CLOSE' | 'CLOSED' {
    const date = new Date(timestamp);
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
    
    // Check weekends (Saturday=6, Sunday=0 in UTC, but NSE is IST)
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(timestamp + istOffset);
    const istDay = istTime.getDay();
    
    if (istDay === 0 || istDay === 6) { // Sunday or Saturday
      return 'CLOSED';
    }
    
    // Check holidays (simplified - would need holiday calendar)
    // For now, skip holiday check
    
    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();
    const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    // NSE hours: 9:15-15:30 IST
    // Pre-open: 9:00-9:15
    // Trading: 9:15-15:30
    // Post-close: 15:30-16:00
    
    if (this.isTimeInRange(currentTime, '09:00', '09:15')) {
      return 'PRE_OPEN';
    }
    if (this.isTimeInRange(currentTime, '09:15', '15:30')) {
      return 'TRADING';
    }
    if (this.isTimeInRange(currentTime, '15:30', '16:00')) {
      return 'POST_CLOSE';
    }
    
    return 'CLOSED';
  }
  
  /**
   * Get timeframe in milliseconds
   */
  private getTimeframeMs(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return map[timeframe] || 60 * 1000;
  }
  
  private formatDateDiff(later: Date, earlier: Date): string {
    const diffMs = later.getTime() - earlier.getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  }
  
  /**
   * Check if time is in range (HH:MM format)
   */
  private isTimeInRange(time: string, start: string, end: string): boolean {
    return time >= start && time <= end;
  }
  
  /**
   * Clear cache for specific instrument/timeframe
   */
  clearCache(instrumentKey?: string, timeframe?: Timeframe): number {
    if (!this.cacheConfig.enabled) return 0;
    
    let count = 0;
    if (!fs.existsSync(this.cacheConfig.cacheDir)) return 0;
    
    const files = fs.readdirSync(this.cacheConfig.cacheDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      let shouldDelete = true;
      if (instrumentKey) {
        const safeKey = instrumentKey.replace(/[|]/g, '_');
        if (!file.startsWith(`${safeKey}_`)) shouldDelete = false;
      }
      if (timeframe) {
        if (!file.includes(`_${timeframe}_`)) shouldDelete = false;
      }
      
      if (shouldDelete) {
        fs.unlinkSync(path.join(this.cacheConfig.cacheDir, file));
        count++;
      }
    }
    
    console.log(`[NiftyDownloader] Cleared ${count} cache files`);
    return count;
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { fileCount: number; totalSizeBytes: number; oldestEntry: Date | null; newestEntry: Date | null } {
    if (!this.cacheConfig.enabled || !fs.existsSync(this.cacheConfig.cacheDir)) {
      return { fileCount: 0, totalSizeBytes: 0, oldestEntry: null, newestEntry: null };
    }
    
    const files = fs.readdirSync(this.cacheConfig.cacheDir).filter(f => f.endsWith('.json'));
    let totalSize = 0;
    let oldest: Date | null = null;
    let newest: Date | null = null;
    
    for (const file of files) {
      const stat = fs.statSync(path.join(this.cacheConfig.cacheDir, file));
      totalSize += stat.size;
      
      if (!oldest || stat.mtime < oldest) oldest = stat.mtime;
      if (!newest || stat.mtime > newest) newest = stat.mtime;
    }
    
    return {
      fileCount: files.length,
      totalSizeBytes: totalSize,
      oldestEntry: oldest,
      newestEntry: newest,
    };
  }
}

export default NiftyHistoricalDownloader;