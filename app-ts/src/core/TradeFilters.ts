/**
 * Trade Filters
 * 
 * Composable filters that can be applied before taking a trade.
 * Each filter returns whether to proceed and why.
 * 
 * Usage:
 *   const filters = createTradeFilters(candles, htfCandles);
 *   const result = filters.applyAll(signal);
 *   if (!result.pass) {
 *     console.log(result.reason);
 *     return null;
 *   }
 */
import { Candle, Direction, Signal } from '../types';
import { MarketStructure, StructureTrend } from '../types/structure';
import { RegimeContext } from '../types/regime';
import { MTFContext } from '../types/mtf';
import { VolumeAnalysis, VolumeClassification } from '../indicators/volume';

import { analyzeStructure, getStructureSummary } from './StructureAnalyzer';
import { detectRegime, getRegimeSummary, isSignalAlignedWithRegime } from './RegimeDetector';
import { analyzeMTF, getMTFSummary, isSignalAlignedWithMTF } from './MTFAnalyzer';
import { analyzeVolume, getVolumeSignal, getVolumeSummary } from '../indicators/volume';

/**
 * Filter result
 */
export interface FilterResult {
  pass: boolean;
  filter: string;
  reason: string;
  confidence: number; // Adjustment to signal confidence (-0.2 to +0.2)
}

/**
 * Combined filter results
 */
export interface AllFiltersResult {
  pass: boolean;
  results: FilterResult[];
  failedFilters: string[];
  totalConfidenceAdjustment: number;
  summary: string;
}

/**
 * Filter configuration
 */
export interface FilterConfig {
  // Enable/disable individual filters
  useStructure: boolean;
  useRegime: boolean;
  useMTF: boolean;
  useVolume: boolean;
  
  // Filter strictness
  requireBullishStructureForLong: boolean;
  requireBearishStructureForShort: boolean;
  skipRangingRegime: boolean;
  requireHTFAlignment: boolean;
  skipLowVolume: boolean;
  
  // Thresholds
  minVolumeRatio: number;
  minHTFStrength: number;
}

/**
 * Default filter configuration
 */
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  useStructure: true,
  useRegime: true,
  useMTF: true,
  useVolume: true,
  
  requireBullishStructureForLong: true,
  requireBearishStructureForShort: true,
  skipRangingRegime: true,
  requireHTFAlignment: true,
  skipLowVolume: true,
  
  minVolumeRatio: 0.5,
  minHTFStrength: 0.3,
};

/**
 * Trade Filters class - applies all filters to a signal
 */
export class TradeFilters {
  private structure: MarketStructure;
  private regime: RegimeContext;
  private mtf: MTFContext | null;
  private volume: VolumeAnalysis;
  private config: FilterConfig;
  
  constructor(
    ltfCandles: Candle[],
    htfCandles: Candle[] | null,
    htfTimeframe: string = '4h',
    ltfTimeframe: string = '1h',
    config: Partial<FilterConfig> = {}
  ) {
    this.config = { ...DEFAULT_FILTER_CONFIG, ...config };
    
    // Analyze all contexts
    this.structure = analyzeStructure(ltfCandles);
    this.regime = detectRegime(ltfCandles);
    this.volume = analyzeVolume(ltfCandles);
    
    // MTF requires HTF data
    if (htfCandles && htfCandles.length > 50) {
      this.mtf = analyzeMTF(
        htfCandles,
        ltfCandles,
        htfTimeframe as any,
        ltfTimeframe as any
      );
    } else {
      this.mtf = null;
    }
  }
  
  /**
   * Apply all enabled filters to a signal
   */
  applyAll(signal: Signal): AllFiltersResult {
    const results: FilterResult[] = [];
    let totalConfidenceAdjustment = 0;
    
    // 1. Structure filter
    if (this.config.useStructure) {
      const structureResult = this.checkStructure(signal.direction);
      results.push(structureResult);
      totalConfidenceAdjustment += structureResult.confidence;
    }
    
    // 2. Regime filter
    if (this.config.useRegime) {
      const regimeResult = this.checkRegime(signal.direction);
      results.push(regimeResult);
      totalConfidenceAdjustment += regimeResult.confidence;
    }
    
    // 3. MTF filter
    if (this.config.useMTF && this.mtf) {
      const mtfResult = this.checkMTF(signal.direction);
      results.push(mtfResult);
      totalConfidenceAdjustment += mtfResult.confidence;
    }
    
    // 4. Volume filter
    if (this.config.useVolume) {
      const volumeResult = this.checkVolume();
      results.push(volumeResult);
      totalConfidenceAdjustment += volumeResult.confidence;
    }
    
    // Compile results
    const failedFilters = results.filter(r => !r.pass).map(r => r.filter);
    const pass = failedFilters.length === 0;
    
    const summary = this.getSummary(results);
    
    return {
      pass,
      results,
      failedFilters,
      totalConfidenceAdjustment,
      summary,
    };
  }
  
  /**
   * Check market structure filter
   */
  private checkStructure(direction: Direction): FilterResult {
    const trend = this.structure.trend;
    
    // For LONG, prefer bullish or neutral structure
    if (direction === 'LONG') {
      if (trend === 'BEARISH' && this.config.requireBullishStructureForLong) {
        return {
          pass: false,
          filter: 'structure',
          reason: 'Bearish structure - avoid longs',
          confidence: 0,
        };
      }
      
      // Bonus for bullish structure
      if (trend === 'BULLISH') {
        return {
          pass: true,
          filter: 'structure',
          reason: 'Bullish structure confirmed',
          confidence: 0.1,
        };
      }
    }
    
    // For SHORT, prefer bearish or neutral structure
    if (direction === 'SHORT') {
      if (trend === 'BULLISH' && this.config.requireBearishStructureForShort) {
        return {
          pass: false,
          filter: 'structure',
          reason: 'Bullish structure - avoid shorts',
          confidence: 0,
        };
      }
      
      // Bonus for bearish structure
      if (trend === 'BEARISH') {
        return {
          pass: true,
          filter: 'structure',
          reason: 'Bearish structure confirmed',
          confidence: 0.1,
        };
      }
    }
    
    // Neutral is OK but no bonus
    return {
      pass: true,
      filter: 'structure',
      reason: `Structure: ${trend}`,
      confidence: 0,
    };
  }
  
  /**
   * Check market regime filter
   */
  private checkRegime(direction: Direction): FilterResult {
    // Skip ranging markets
    if (this.regime.regime === 'RANGING' && this.config.skipRangingRegime) {
      return {
        pass: false,
        filter: 'regime',
        reason: 'Ranging market - skip trade',
        confidence: 0,
      };
    }
    
    // Check direction alignment
    if (!isSignalAlignedWithRegime(direction, this.regime)) {
      return {
        pass: false,
        filter: 'regime',
        reason: `Regime favors ${this.regime.tradeDirection}, signal is ${direction}`,
        confidence: 0,
      };
    }
    
    // Strong trend bonus
    if (this.regime.regime.includes('STRONG')) {
      return {
        pass: true,
        filter: 'regime',
        reason: 'Strong trend regime',
        confidence: 0.1,
      };
    }
    
    return {
      pass: true,
      filter: 'regime',
      reason: `Regime: ${this.regime.regime}`,
      confidence: 0,
    };
  }
  
  /**
   * Check MTF alignment filter
   */
  private checkMTF(direction: Direction): FilterResult {
    if (!this.mtf) {
      return {
        pass: true,
        filter: 'mtf',
        reason: 'No HTF data available',
        confidence: 0,
      };
    }
    
    const { aligned, reason } = isSignalAlignedWithMTF(
      direction,
      this.mtf,
      this.config.minHTFStrength
    );
    
    if (!aligned && this.config.requireHTFAlignment) {
      return {
        pass: false,
        filter: 'mtf',
        reason,
        confidence: 0,
      };
    }
    
    // Return with confluence bonus if aligned
    return {
      pass: true,
      filter: 'mtf',
      reason: aligned ? 'HTF aligned' : 'HTF neutral',
      confidence: this.mtf.confluenceBonus,
    };
  }
  
  /**
   * Check volume filter
   */
  private checkVolume(): FilterResult {
    const volumeSignal = getVolumeSignal(this.volume);
    
    if (!volumeSignal.shouldTrade && this.config.skipLowVolume) {
      return {
        pass: false,
        filter: 'volume',
        reason: volumeSignal.warning ?? 'Low volume',
        confidence: 0,
      };
    }
    
    // High volume bonus
    if (this.volume.classification === 'HIGH') {
      return {
        pass: true,
        filter: 'volume',
        reason: 'High volume confirmation',
        confidence: 0.1,
      };
    }
    
    return {
      pass: true,
      filter: 'volume',
      reason: `Volume: ${this.volume.classification}`,
      confidence: volumeSignal.warning ? -0.05 : 0,
    };
  }
  
  /**
   * Get summary of all contexts for logging
   */
  private getSummary(results: FilterResult[]): string {
    const parts = [
      getStructureSummary(this.structure),
      getRegimeSummary(this.regime),
      getVolumeSummary(this.volume),
    ];
    
    if (this.mtf) {
      parts.push(getMTFSummary(this.mtf));
    }
    
    return parts.join(' || ');
  }
  
  /**
   * Get individual analysis results
   */
  getStructure(): MarketStructure {
    return this.structure;
  }
  
  getRegime(): RegimeContext {
    return this.regime;
  }
  
  getMTF(): MTFContext | null {
    return this.mtf;
  }
  
  getVolume(): VolumeAnalysis {
    return this.volume;
  }
}

/**
 * Create trade filters instance
 */
export function createTradeFilters(
  ltfCandles: Candle[],
  htfCandles: Candle[] | null = null,
  config: Partial<FilterConfig> = {}
): TradeFilters {
  return new TradeFilters(ltfCandles, htfCandles, '4h', '1h', config);
}

export default TradeFilters;

