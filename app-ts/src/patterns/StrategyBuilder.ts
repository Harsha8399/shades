/**
 * Strategy Builder
 * 
 * Converts strategy definitions (from books, JSON files, or user input)
 * into executable Pattern classes.
 * 
 * This allows traders to describe their strategies in a simple format
 * without writing code, and the builder creates the trading logic.
 */
import { Candle, MarketContext, Signal, Direction, ValidationResult, PatternConfig, Timeframe } from '../types';
import { BasePattern } from './BasePattern';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateADX,
  getCurrentATR,
  getCurrentRSI,
} from '../indicators/technical';
import { findSRZones, findNearestSupport, findNearestResistance } from '../indicators/supportResistance';
import { calculateATR } from '../indicators/atr';
import { v4 as uuidv4 } from 'uuid';

/**
 * Execution configuration for F&O trading
 */
export interface ExecutionDefinition {
  type: 'SPOT' | 'FUTURES' | 'OPTIONS_BUY_ATM' | 'OPTIONS_SELL_ATM';
  optionType?: 'CE' | 'PE' | 'AUTO';  // AUTO = CE for LONG, PE for SHORT
  futuresPremiumPercent?: number;      // Default 0.5%
  optionDelta?: number;                // Default 0.5 for ATM
}

/**
 * Strategy definition format (can be from JSON file)
 */
export interface StrategyDefinition {
  // Metadata
  name: string;
  description: string;
  version?: string;
  author?: string;
  
  // Entry conditions
  entry: {
    long?: StrategyCondition[];
    short?: StrategyCondition[];
  };
  
  // Exit conditions
  exit: {
    stopLoss: StopLossDefinition;
    target: TargetDefinition;
    trailingStop?: TrailingStopDefinition;
  };
  
  // Filters (optional)
  filters?: {
    trendFilter?: TrendFilterDefinition;
    volumeFilter?: VolumeFilterDefinition;
    timeFilter?: TimeFilterDefinition;
  };
  
  // Execution configuration (F&O support)
  execution?: ExecutionDefinition;
  
  // Configuration
  config: {
    timeframes: Timeframe[];
    instruments: string[];
    minConfidence?: number;
  };
}

/**
 * Condition types for entry/exit
 */
export type ConditionOperator = 
  | 'crosses_above' 
  | 'crosses_below' 
  | 'above' 
  | 'below' 
  | 'between'
  | 'equals';

export interface StrategyCondition {
  indicator: IndicatorType;
  params?: Record<string, number>;
  operator: ConditionOperator;
  value: IndicatorType | number;
  valueParams?: Record<string, number>;
}

export type IndicatorType = 
  | 'price' | 'close' | 'open' | 'high' | 'low'
  | 'sma' | 'ema' | 'rsi' | 'macd' | 'macd_signal' | 'macd_histogram'
  | 'bb_upper' | 'bb_middle' | 'bb_lower'
  | 'stoch_k' | 'stoch_d'
  | 'adx' | 'atr'
  | 'volume' | 'volume_avg'
  | 'support' | 'resistance';

export interface StopLossDefinition {
  type: 'atr' | 'percent' | 'fixed' | 'swing' | 'structure';
  value: number;  // ATR multiplier, percentage, or fixed value
}

export interface TargetDefinition {
  type: 'rr' | 'atr' | 'percent' | 'fixed' | 'structure';
  value: number;
}

export interface TrailingStopDefinition {
  type: 'atr' | 'percent' | 'step';
  activationR: number;  // Activate after X R profit
  value: number;
}

export interface TrendFilterDefinition {
  indicator: 'ema' | 'sma' | 'adx';
  period: number;
  condition: 'above' | 'below' | 'strong';
  threshold?: number;
}

export interface VolumeFilterDefinition {
  minRatio: number;  // Minimum volume ratio vs average
  period: number;
}

export interface TimeFilterDefinition {
  allowedHours?: { start: number; end: number };
  allowedDays?: number[];  // 0 = Sunday, 6 = Saturday
  excludeDates?: string[];
}

/**
 * Generated Pattern from Strategy Definition
 */
export class GeneratedPattern extends BasePattern {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  
  private definition: StrategyDefinition;
  private previousValues: Map<string, number[]> = new Map();
  
  constructor(definition: StrategyDefinition) {
    super();
    
    this.definition = definition;
    this.id = `strategy-${definition.name.toLowerCase().replace(/\s+/g, '-')}-${uuidv4().slice(0, 8)}`;
    this.name = definition.name;
    this.description = definition.description;
    this.version = definition.version || '1.0.0';
    
    this.config = {
      enabled: true,
      timeframes: definition.config.timeframes,
      symbols: definition.config.instruments,
      parameters: {},
    };
  }
  
  /**
   * Detect signal based on strategy definition
   */
  detectSignal(candles: Candle[], context: MarketContext): Signal | null {
    // Check filters first
    if (this.definition.filters) {
      if (!this.passesFilters(candles, context)) {
        return null;
      }
    }
    
    // Check for LONG entry
    if (this.definition.entry.long) {
      if (this.checkConditions(candles, this.definition.entry.long)) {
        return this.buildTradeSignal(candles, context, 'LONG');
      }
    }
    
    // Check for SHORT entry
    if (this.definition.entry.short) {
      if (this.checkConditions(candles, this.definition.entry.short)) {
        return this.buildTradeSignal(candles, context, 'SHORT');
      }
    }
    
    return null;
  }
  
  /**
   * Check if all conditions are met
   */
  private checkConditions(candles: Candle[], conditions: StrategyCondition[]): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(candles, condition)) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Evaluate a single condition
   */
  private evaluateCondition(candles: Candle[], condition: StrategyCondition): boolean {
    const currentValue = this.getIndicatorValue(candles, condition.indicator, condition.params);
    
    let compareValue: number;
    if (typeof condition.value === 'number') {
      compareValue = condition.value;
    } else {
      compareValue = this.getIndicatorValue(candles, condition.value, condition.valueParams);
    }
    
    // Get previous values for crossover detection
    const key = `${condition.indicator}-${JSON.stringify(condition.params)}`;
    const prevValues = this.previousValues.get(key) || [];
    const prevValue = prevValues[prevValues.length - 1];
    
    // Store current value for next iteration
    this.previousValues.set(key, [...prevValues.slice(-10), currentValue]);
    
    switch (condition.operator) {
      case 'above':
        return currentValue > compareValue;
      case 'below':
        return currentValue < compareValue;
      case 'equals':
        return Math.abs(currentValue - compareValue) < 0.0001;
      case 'crosses_above':
        return prevValue !== undefined && prevValue <= compareValue && currentValue > compareValue;
      case 'crosses_below':
        return prevValue !== undefined && prevValue >= compareValue && currentValue < compareValue;
      default:
        return false;
    }
  }
  
  /**
   * Get indicator value
   */
  private getIndicatorValue(
    candles: Candle[],
    indicator: IndicatorType,
    params?: Record<string, number>
  ): number {
    const closes = candles.map(c => c.close);
    const currentCandle = candles[candles.length - 1];
    const period = params?.period || 14;
    
    switch (indicator) {
      case 'price':
      case 'close':
        return currentCandle.close;
      case 'open':
        return currentCandle.open;
      case 'high':
        return currentCandle.high;
      case 'low':
        return currentCandle.low;
      case 'sma': {
        const sma = calculateSMA(closes, period);
        return sma[sma.length - 1] || currentCandle.close;
      }
      case 'ema': {
        const ema = calculateEMA(closes, period);
        return ema[ema.length - 1] || currentCandle.close;
      }
      case 'rsi':
        return getCurrentRSI(candles, period);
      case 'macd': {
        const macd = calculateMACD(candles, params?.fast || 12, params?.slow || 26, params?.signal || 9);
        return macd.length > 0 ? macd[macd.length - 1].MACD || 0 : 0;
      }
      case 'macd_signal': {
        const macd = calculateMACD(candles, params?.fast || 12, params?.slow || 26, params?.signal || 9);
        return macd.length > 0 ? macd[macd.length - 1].signal || 0 : 0;
      }
      case 'macd_histogram': {
        const macd = calculateMACD(candles, params?.fast || 12, params?.slow || 26, params?.signal || 9);
        return macd.length > 0 ? macd[macd.length - 1].histogram || 0 : 0;
      }
      case 'bb_upper': {
        const bb = calculateBollingerBands(candles, period, params?.stdDev || 2);
        return bb.length > 0 ? bb[bb.length - 1].upper : currentCandle.close;
      }
      case 'bb_middle': {
        const bb = calculateBollingerBands(candles, period, params?.stdDev || 2);
        return bb.length > 0 ? bb[bb.length - 1].middle : currentCandle.close;
      }
      case 'bb_lower': {
        const bb = calculateBollingerBands(candles, period, params?.stdDev || 2);
        return bb.length > 0 ? bb[bb.length - 1].lower : currentCandle.close;
      }
      case 'stoch_k': {
        const stoch = calculateStochastic(candles, period, params?.d || 3);
        return stoch.length > 0 ? stoch[stoch.length - 1].k : 50;
      }
      case 'stoch_d': {
        const stoch = calculateStochastic(candles, period, params?.d || 3);
        return stoch.length > 0 ? stoch[stoch.length - 1].d : 50;
      }
      case 'adx': {
        const adx = calculateADX(candles, period);
        return adx.length > 0 ? adx[adx.length - 1].adx : 0;
      }
      case 'atr':
        return getCurrentATR(candles, period);
      case 'volume':
        return currentCandle.volume;
      case 'volume_avg': {
        const volumes = candles.slice(-period).map(c => c.volume);
        return volumes.reduce((a, b) => a + b, 0) / period;
      }
      default:
        return 0;
    }
  }
  
  /**
   * Check if passes all filters
   */
  private passesFilters(candles: Candle[], context: MarketContext): boolean {
    const filters = this.definition.filters!;
    
    // Trend filter
    if (filters.trendFilter) {
      const tf = filters.trendFilter;
      const closes = candles.map(c => c.close);
      const currentPrice = closes[closes.length - 1];
      
      if (tf.indicator === 'ema' || tf.indicator === 'sma') {
        const maValues = tf.indicator === 'ema' 
          ? calculateEMA(closes, tf.period)
          : calculateSMA(closes, tf.period);
        const maValue = maValues[maValues.length - 1] || currentPrice;
        
        if (tf.condition === 'above' && currentPrice <= maValue) return false;
        if (tf.condition === 'below' && currentPrice >= maValue) return false;
      }
      
      if (tf.indicator === 'adx' && tf.condition === 'strong') {
        const adx = calculateADX(candles, tf.period);
        const adxValue = adx.length > 0 ? adx[adx.length - 1].adx : 0;
        if (adxValue < (tf.threshold || 25)) return false;
      }
    }
    
    // Volume filter
    if (filters.volumeFilter) {
      const vf = filters.volumeFilter;
      const currentVolume = candles[candles.length - 1].volume;
      const avgVolume = candles.slice(-vf.period).reduce((a, c) => a + c.volume, 0) / vf.period;
      const ratio = currentVolume / avgVolume;
      
      if (ratio < vf.minRatio) return false;
    }
    
    // Time filter
    if (filters.timeFilter) {
      const tf = filters.timeFilter;
      const now = new Date();
      
      if (tf.allowedHours) {
        const hour = now.getHours();
        if (hour < tf.allowedHours.start || hour > tf.allowedHours.end) return false;
      }
      
      if (tf.allowedDays) {
        const day = now.getDay();
        if (!tf.allowedDays.includes(day)) return false;
      }
    }
    
    return true;
  }
  
  /**
   * Build trade signal
   */
  private buildTradeSignal(candles: Candle[], context: MarketContext, direction: Direction): Signal {
    const currentCandle = candles[candles.length - 1];
    const entryPrice = currentCandle.close;
    const stopLoss = this.calculateStopLoss(entryPrice, direction, candles);
    const target = this.calculateTarget(entryPrice, stopLoss, direction, candles);
    
    const confidence = this.definition.config.minConfidence || 0.7;
    
    return this.buildSignal(
      direction,
      entryPrice,
      stopLoss,
      target,
      context,
      candles,
      [`strategy:${this.name}`],
      confidence
    );
  }
  
  /**
   * Calculate stop-loss based on definition
   */
  calculateStopLoss(entryPrice: number, direction: Direction, candles: Candle[]): number {
    const sl = this.definition.exit.stopLoss;
    const atr = calculateATR(candles, 14);
    
    switch (sl.type) {
      case 'atr': {
        const distance = atr * sl.value;
        return direction === 'LONG' ? entryPrice - distance : entryPrice + distance;
      }
      case 'percent': {
        const distance = entryPrice * (sl.value / 100);
        return direction === 'LONG' ? entryPrice - distance : entryPrice + distance;
      }
      case 'fixed': {
        return direction === 'LONG' ? entryPrice - sl.value : entryPrice + sl.value;
      }
      case 'swing': {
        // Use recent swing high/low
        const lookback = Math.min(20, candles.length);
        const recentCandles = candles.slice(-lookback);
        
        if (direction === 'LONG') {
          const minLow = Math.min(...recentCandles.map(c => c.low));
          return minLow - (atr * 0.5);  // Buffer below swing low
        } else {
          const maxHigh = Math.max(...recentCandles.map(c => c.high));
          return maxHigh + (atr * 0.5);  // Buffer above swing high
        }
      }
      case 'structure': {
        const zones = findSRZones(candles, atr, 0.5, 2);
        if (direction === 'LONG') {
          const support = findNearestSupport(entryPrice, zones);
          return support ? support.priceLevel - (atr * 0.5) : entryPrice - (atr * 2);
        } else {
          const resistance = findNearestResistance(entryPrice, zones);
          return resistance ? resistance.priceLevel + (atr * 0.5) : entryPrice + (atr * 2);
        }
      }
      default:
        return direction === 'LONG' ? entryPrice - (atr * 2) : entryPrice + (atr * 2);
    }
  }
  
  /**
   * Calculate target based on definition
   */
  calculateTarget(entryPrice: number, stopLoss: number, direction: Direction, candles: Candle[]): number {
    const target = this.definition.exit.target;
    const risk = Math.abs(entryPrice - stopLoss);
    const atr = calculateATR(candles, 14);
    
    switch (target.type) {
      case 'rr': {
        const distance = risk * target.value;
        return direction === 'LONG' ? entryPrice + distance : entryPrice - distance;
      }
      case 'atr': {
        const distance = atr * target.value;
        return direction === 'LONG' ? entryPrice + distance : entryPrice - distance;
      }
      case 'percent': {
        const distance = entryPrice * (target.value / 100);
        return direction === 'LONG' ? entryPrice + distance : entryPrice - distance;
      }
      case 'fixed': {
        return direction === 'LONG' ? entryPrice + target.value : entryPrice - target.value;
      }
      case 'structure': {
        const zones = findSRZones(candles, atr, 0.5, 2);
        if (direction === 'LONG') {
          const resistance = findNearestResistance(entryPrice, zones);
          const structureTarget = resistance ? resistance.priceLevel * 0.998 : entryPrice + (risk * 2);
          // Ensure minimum RR
          return Math.max(structureTarget, entryPrice + (risk * 1.5));
        } else {
          const support = findNearestSupport(entryPrice, zones);
          const structureTarget = support ? support.priceLevel * 1.002 : entryPrice - (risk * 2);
          return Math.min(structureTarget, entryPrice - (risk * 1.5));
        }
      }
      default:
        return direction === 'LONG' ? entryPrice + (risk * 2) : entryPrice - (risk * 2);
    }
  }
  
  /**
   * Validate strategy definition
   */
  validate(candles: Candle[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (candles.length < 100) {
      errors.push('Insufficient candles for strategy (need at least 100)');
    }
    
    if (!this.definition.entry.long && !this.definition.entry.short) {
      errors.push('Strategy must define at least one entry condition (long or short)');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  getRequiredCandleCount(): number {
    return 100;
  }
}

/**
 * Build a pattern from strategy definition
 */
export function buildStrategy(definition: StrategyDefinition): GeneratedPattern {
  return new GeneratedPattern(definition);
}

/**
 * Load strategy from JSON file
 */
export function loadStrategyFromFile(filePath: string): StrategyDefinition {
  const fs = require('fs');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as StrategyDefinition;
}

/**
 * Example strategy definitions for reference
 */
export const EXAMPLE_STRATEGIES: StrategyDefinition[] = [
  {
    name: 'EMA Crossover',
    description: 'Buy when fast EMA crosses above slow EMA',
    entry: {
      long: [
        { indicator: 'ema', params: { period: 20 }, operator: 'crosses_above', value: 'ema', valueParams: { period: 50 } },
        { indicator: 'close', operator: 'above', value: 'ema', valueParams: { period: 200 } },
      ],
      short: [
        { indicator: 'ema', params: { period: 20 }, operator: 'crosses_below', value: 'ema', valueParams: { period: 50 } },
        { indicator: 'close', operator: 'below', value: 'ema', valueParams: { period: 200 } },
      ],
    },
    exit: {
      stopLoss: { type: 'atr', value: 2 },
      target: { type: 'rr', value: 2 },
    },
    filters: {
      trendFilter: { indicator: 'adx', period: 14, condition: 'strong', threshold: 25 },
    },
    config: {
      timeframes: ['1h', '4h', '1d'],
      instruments: [],
    },
  },
  {
    name: 'RSI Oversold Bounce',
    description: 'Buy when RSI is oversold and starts rising',
    entry: {
      long: [
        { indicator: 'rsi', params: { period: 14 }, operator: 'crosses_above', value: 30 },
        { indicator: 'close', operator: 'above', value: 'ema', valueParams: { period: 200 } },
      ],
    },
    exit: {
      stopLoss: { type: 'swing', value: 1 },
      target: { type: 'structure', value: 1 },
    },
    filters: {
      volumeFilter: { minRatio: 1.2, period: 20 },
    },
    config: {
      timeframes: ['1h', '4h'],
      instruments: [],
    },
  },
];

export default { buildStrategy, loadStrategyFromFile, EXAMPLE_STRATEGIES };

