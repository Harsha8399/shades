import { Candle, Direction, MarketContext, Timeframe } from './candle';
import { Signal } from './signal';

/**
 * Validation result for pattern checks
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Pattern configuration
 */
export interface PatternConfig {
  enabled: boolean;
  timeframes: Timeframe[];
  symbols: string[];
  parameters: Record<string, number | string | boolean | number[]>;
}

/**
 * Core Pattern Interface - All patterns must implement this
 */
export interface Pattern {
  // Identity
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  
  // Configuration
  config: PatternConfig;
  
  /**
   * Detect if pattern conditions are met
   * Returns null if no signal, Signal object if conditions met
   * @param absoluteCandleIndex - Optional absolute index in the full replay dataset
   */
  detectSignal(
    candles: Candle[],
    context: MarketContext,
    absoluteCandleIndex?: number
  ): Signal | null;
  
  /**
   * Calculate stop-loss price based on pattern logic
   */
  calculateStopLoss(
    entryPrice: number,
    direction: Direction,
    candles: Candle[]
  ): number;
  
  /**
   * Calculate target price based on pattern logic
   */
  calculateTarget(
    entryPrice: number,
    stopLoss: number,
    direction: Direction,
    candles: Candle[]
  ): number;
  
  /**
   * Optional: Update trailing stop based on price action
   * Returns new stop price or null if no update
   */
  updateTrailingStop?(
    currentPrice: number,
    currentStop: number,
    direction: Direction,
    candles: Candle[]
  ): number | null;
  
  /**
   * Validate that pattern has enough data and correct config
   */
  validate(candles: Candle[]): ValidationResult;
  
  /**
   * Minimum candles required for pattern detection
   */
  getRequiredCandleCount(): number;
}

/**
 * Pattern metadata for registry
 */
export interface PatternInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  requiredCandles: number;
  supportedTimeframes: Timeframe[];
}

