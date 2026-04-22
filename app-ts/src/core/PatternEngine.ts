import { Candle, MarketContext, Signal, Pattern, Timeframe } from '../types';
import { PatternRegistry } from './PatternRegistry';
import { calculateATR, detectTrend, getVolatilityRegime } from '../indicators';
import { TradeFilters, FilterConfig, DEFAULT_FILTER_CONFIG } from './TradeFilters';

/**
 * Pattern detection engine
 * Runs all registered patterns against candle data
 */
export class PatternEngine {
  private registry: PatternRegistry;
  private filterConfig: FilterConfig;
  private useFilters: boolean;
  
  constructor(
    registry?: PatternRegistry,
    filterConfig?: Partial<FilterConfig>,
    useFilters: boolean = true
  ) {
    this.registry = registry || PatternRegistry.getInstance();
    this.filterConfig = { ...DEFAULT_FILTER_CONFIG, ...filterConfig };
    this.useFilters = useFilters;
  }
  
  /**
   * Enable/disable trade filters
   */
  setFiltersEnabled(enabled: boolean): void {
    this.useFilters = enabled;
  }
  
  /**
   * Update filter configuration
   */
  updateFilterConfig(config: Partial<FilterConfig>): void {
    this.filterConfig = { ...this.filterConfig, ...config };
  }
  
  /**
   * Build market context from candles
   */
  buildMarketContext(candles: Candle[], symbol: string, timeframe: MarketContext['timeframe']): MarketContext {
    return {
      symbol,
      timeframe,
      atr: calculateATR(candles, 14),
      trend: detectTrend(candles, 4),
      volatility: getVolatilityRegime(candles, 14, 50),
    };
  }
  
  /**
   * Run all enabled patterns on candles
   * Returns array of detected signals
   * @param htfCandles - Optional higher timeframe candles for MTF analysis
   */
  detectSignals(
    candles: Candle[],
    symbol: string,
    timeframe: Timeframe,
    htfCandles?: Candle[]
  ): Signal[] {
    const signals: Signal[] = [];
    
    // Build market context
    const context = this.buildMarketContext(candles, symbol, timeframe);
    
    // Build trade filters if enabled
    const filters = this.useFilters 
      ? new TradeFilters(candles, htfCandles ?? null, '4h', timeframe, this.filterConfig)
      : null;
    
    // Get patterns applicable to this timeframe and symbol
    const patterns = this.registry.getEnabled().filter(p => 
      p.config.timeframes.includes(timeframe) &&
      (p.config.symbols.length === 0 || p.config.symbols.includes(symbol))
    );
    
    // Run each pattern
    for (const pattern of patterns) {
      try {
        // Validate pattern has enough data
        const validation = pattern.validate(candles);
        if (!validation.isValid) {
          continue;
        }
        
        // Detect signal
        let signal = pattern.detectSignal(candles, context);
        
        if (signal) {
          // Apply trade filters if enabled
          if (filters) {
            const filterResult = filters.applyAll(signal);
            
            if (!filterResult.pass) {
              console.log(`[PatternEngine] Signal filtered out: ${pattern.name} - ${filterResult.failedFilters.join(', ')}`);
              continue;
            }
            
            // Adjust confidence based on filter results
            signal.confidence = Math.min(1, Math.max(0, 
              signal.confidence + filterResult.totalConfidenceAdjustment
            ));
            
            // Add filter confluence factors
            for (const result of filterResult.results) {
              if (result.pass && result.confidence > 0) {
                signal.confluenceFactors.push(result.filter);
              }
            }
          }
          
          signals.push(signal);
          console.log(`[PatternEngine] Signal detected: ${pattern.name} - ${signal.direction} (conf: ${(signal.confidence * 100).toFixed(0)}%)`);
        }
      } catch (error) {
        console.error(`[PatternEngine] Error running pattern ${pattern.id}:`, error);
      }
    }
    
    return signals;
  }
  
  /**
   * Run a specific pattern
   * @param htfCandles - Optional higher timeframe candles for MTF analysis
   */
  runPattern(
    patternId: string,
    candles: Candle[],
    symbol: string,
    timeframe: Timeframe,
    htfCandles?: Candle[]
  ): Signal | null {
    const pattern = this.registry.get(patternId);
    
    if (!pattern) {
      console.error(`Pattern ${patternId} not found`);
      return null;
    }
    
    if (!pattern.config.enabled) {
      console.warn(`Pattern ${patternId} is disabled`);
      return null;
    }
    
    const context = this.buildMarketContext(candles, symbol, timeframe);
    const validation = pattern.validate(candles);
    
    if (!validation.isValid) {
      console.warn(`Pattern validation failed: ${validation.errors.join(', ')}`);
      return null;
    }
    
    let signal = pattern.detectSignal(candles, context);
    
    // Apply filters if enabled
    if (signal && this.useFilters) {
      const filters = new TradeFilters(candles, htfCandles ?? null, '4h', timeframe, this.filterConfig);
      const filterResult = filters.applyAll(signal);
      
      if (!filterResult.pass) {
        console.log(`[PatternEngine] Signal filtered: ${filterResult.failedFilters.join(', ')}`);
        return null;
      }
      
      signal.confidence = Math.min(1, Math.max(0, 
        signal.confidence + filterResult.totalConfidenceAdjustment
      ));
    }
    
    return signal;
  }
  
  /**
   * Get current filter analysis for a symbol
   */
  getFilterAnalysis(
    candles: Candle[],
    htfCandles?: Candle[]
  ): TradeFilters {
    return new TradeFilters(candles, htfCandles ?? null, '4h', '1h', this.filterConfig);
  }
  
  /**
   * Get minimum required candles for all enabled patterns
   */
  getMinRequiredCandles(): number {
    const patterns = this.registry.getEnabled();
    if (patterns.length === 0) return 100;
    
    return Math.max(...patterns.map(p => p.getRequiredCandleCount()));
  }
  
  /**
   * Validate candles are sufficient for pattern detection
   */
  validateCandles(candles: Candle[]): { valid: boolean; required: number; actual: number } {
    const required = this.getMinRequiredCandles();
    return {
      valid: candles.length >= required,
      required,
      actual: candles.length,
    };
  }
}

export default PatternEngine;

