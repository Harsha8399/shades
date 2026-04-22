import { Pattern, PatternConfig, Candle, MarketContext, Signal, Direction, ValidationResult } from '../types';

/**
 * Base class for patterns with common functionality
 */
export abstract class BasePattern implements Pattern {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly version: string;
  
  config: PatternConfig;
  
  constructor(config?: Partial<PatternConfig>) {
    this.config = {
      enabled: true,
      timeframes: ['1h', '4h'],
      symbols: [],
      parameters: {},
      ...config,
    };
  }
  
  /**
   * Must be implemented by subclasses
   */
  abstract detectSignal(candles: Candle[], context: MarketContext): Signal | null;
  
  /**
   * Calculate stop-loss - can be overridden
   */
  abstract calculateStopLoss(entryPrice: number, direction: Direction, candles: Candle[]): number;
  
  /**
   * Calculate target - can be overridden
   */
  calculateTarget(
    entryPrice: number,
    stopLoss: number,
    direction: Direction,
    _candles: Candle[]
  ): number {
    const risk = Math.abs(entryPrice - stopLoss);
    const targetRR = (this.config.parameters.targetRR as number) || 2;
    
    return direction === 'LONG'
      ? entryPrice + (risk * targetRR)
      : entryPrice - (risk * targetRR);
  }
  
  /**
   * Default validation
   */
  validate(candles: Candle[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    const required = this.getRequiredCandleCount();
    if (candles.length < required) {
      errors.push(`Insufficient candles: need ${required}, got ${candles.length}`);
    }
    
    // Check for valid OHLCV data
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle || lastCandle.high < lastCandle.low) {
      errors.push('Invalid candle data: high < low');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Default required candle count
   */
  getRequiredCandleCount(): number {
    return 100;
  }
  
  /**
   * Build a signal object
   */
  protected buildSignal(
    direction: Direction,
    entryPrice: number,
    stopLoss: number,
    target: number,
    context: MarketContext,
    candles: Candle[],
    confluenceFactors: string[],
    confidence: number
  ): Signal {
    const currentCandle = candles[candles.length - 1];
    const riskRewardRatio = Math.abs(target - entryPrice) / Math.abs(entryPrice - stopLoss);
    
    // Calculate invalidation price (opposite side of entry from SL)
    const invalidationPrice = direction === 'LONG'
      ? stopLoss - Math.abs(entryPrice - stopLoss) * 0.5
      : stopLoss + Math.abs(stopLoss - entryPrice) * 0.5;
    
    return {
      patternId: this.id,
      patternName: this.name,
      symbol: context.symbol,
      direction,
      timeframe: context.timeframe,
      timestamp: currentCandle.timestamp,
      entryPrice,
      stopLoss,
      target,
      confidence,
      confluenceFactors,
      invalidationPrice,
      riskRewardRatio,
      suggestedRiskPercent: 1.0,
    };
  }
}

export default BasePattern;

