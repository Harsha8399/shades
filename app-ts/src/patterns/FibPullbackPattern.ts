import { Candle, MarketContext, Signal, Direction, ValidationResult, PatternConfig } from '../types';
import { BasePattern } from './BasePattern';
import {
  findFibRetracement,
  isPriceAtFibLevel,
  getKeyFibLevels,
  calculateATR,
  findRecentSwingHigh,
  findRecentSwingLow,
  detectTrend,
  FibRetracement,
} from '../indicators';
import { isBullish, isBearish, getCandleBody, getLowerWick, getUpperWick } from '../types/candle';

/**
 * Fibonacci Pullback pattern configuration
 */
interface FibPullbackConfig extends PatternConfig {
  parameters: {
    fibLevels: number[];              // Fib levels to trade (default: [0.5, 0.618, 0.786])
    toleranceATR: number;             // Zone tolerance in ATR
    requireTrendAlignment: boolean;   // Require trend confirmation
    minSwingSize: number;             // Minimum swing size in ATR
    targetRR: number;                 // Target risk:reward ratio
  };
}

/**
 * Fibonacci Pullback Pattern
 * 
 * Detects pullbacks to key Fibonacci retracement levels in trending markets:
 * 1. Identifies the trend direction
 * 2. Measures the swing high to swing low
 * 3. Calculates Fibonacci retracement levels
 * 4. Enters on rejection at key levels (50%, 61.8%, 78.6%)
 */
export class FibPullbackPattern extends BasePattern {
  readonly id = 'fib-pullback';
  readonly name = 'Fibonacci Pullback';
  readonly description = 'Trades pullbacks to key Fibonacci retracement levels in trending markets';
  readonly version = '1.0.0';
  
  declare config: FibPullbackConfig;
  
  constructor(config?: Partial<FibPullbackConfig>) {
    super();
    
    this.config = {
      enabled: true,
      timeframes: ['1h', '4h', '1d'],
      symbols: [],
      parameters: {
        fibLevels: [0.5, 0.618, 0.786],
        toleranceATR: 0.3,
        requireTrendAlignment: true,
        minSwingSize: 2,
        targetRR: 2,
        ...config?.parameters,
      },
      ...config,
    };
  }
  
  /**
   * Detect Fibonacci pullback signal
   */
  detectSignal(candles: Candle[], context: MarketContext): Signal | null {
    const { parameters } = this.config;
    const atr = context.atr;
    const tolerance = atr * parameters.toleranceATR;
    
    // Check trend if required
    if (parameters.requireTrendAlignment) {
      const trend = detectTrend(candles, 4);
      if (trend === 'RANGE') {
        return null; // Need clear trend
      }
    }
    
    // Find Fibonacci retracement
    const fibRetracement = findFibRetracement(candles, 50);
    
    if (!fibRetracement) {
      return null;
    }
    
    // Check swing size
    const swingSize = Math.abs(fibRetracement.swingHigh - fibRetracement.swingLow);
    if (swingSize < atr * parameters.minSwingSize) {
      return null;
    }
    
    // Get current price
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;
    
    // Check if at a key Fib level
    const { atFib, level } = isPriceAtFibLevel(currentPrice, fibRetracement, tolerance);
    
    if (!atFib || !level) {
      return null;
    }
    
    // Check if it's a key level we want to trade
    if (!parameters.fibLevels.includes(level.ratio)) {
      return null;
    }
    
    // Determine direction based on retracement direction
    const direction: Direction = fibRetracement.direction === 'UP' ? 'LONG' : 'SHORT';
    
    // Check for rejection candle
    if (!this.isRejectionCandle(currentCandle, direction, level.price, tolerance)) {
      return null;
    }
    
    // Calculate entry, SL, TP
    const entryPrice = currentCandle.close;
    const stopLoss = this.calculateStopLoss(entryPrice, direction, candles);
    const target = this.calculateTarget(entryPrice, stopLoss, direction, candles);
    
    // Validate R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(target - entryPrice);
    const riskReward = reward / risk;
    
    if (riskReward < 1.5) {
      return null;
    }
    
    const confluenceFactors = [
      `fib_${Math.round(level.ratio * 1000)}`,
      `swing_${fibRetracement.direction.toLowerCase()}`,
    ];
    
    if (context.trend === (direction === 'LONG' ? 'UP' : 'DOWN')) {
      confluenceFactors.push('trend_aligned');
    }
    
    const confidence = this.calculateConfidence(level.ratio, riskReward);
    
    return this.buildSignal(
      direction,
      entryPrice,
      stopLoss,
      target,
      context,
      candles,
      confluenceFactors,
      confidence
    );
  }
  
  /**
   * Check if candle is a rejection at the Fib level
   */
  private isRejectionCandle(
    candle: Candle,
    direction: Direction,
    fibLevel: number,
    tolerance: number
  ): boolean {
    const body = getCandleBody(candle);
    const upperWick = getUpperWick(candle);
    const lowerWick = getLowerWick(candle);
    
    if (direction === 'LONG') {
      // Bullish rejection: wick touches fib level, closes above
      const wickTouches = candle.low <= fibLevel + tolerance;
      const closesAbove = candle.close > fibLevel;
      const hasWickRejection = lowerWick > body * 0.5;
      
      return wickTouches && closesAbove && hasWickRejection && isBullish(candle);
    } else {
      // Bearish rejection: wick touches fib level, closes below
      const wickTouches = candle.high >= fibLevel - tolerance;
      const closesBelow = candle.close < fibLevel;
      const hasWickRejection = upperWick > body * 0.5;
      
      return wickTouches && closesBelow && hasWickRejection && isBearish(candle);
    }
  }
  
  /**
   * Calculate stop-loss
   */
  calculateStopLoss(entryPrice: number, direction: Direction, candles: Candle[]): number {
    // Find Fib retracement again to use swing extremes
    const fibRetracement = findFibRetracement(candles, 50);
    
    if (fibRetracement) {
      if (direction === 'LONG') {
        // Stop below swing low
        const buffer = (fibRetracement.swingHigh - fibRetracement.swingLow) * 0.1;
        return fibRetracement.swingLow - buffer;
      } else {
        // Stop above swing high
        const buffer = (fibRetracement.swingHigh - fibRetracement.swingLow) * 0.1;
        return fibRetracement.swingHigh + buffer;
      }
    }
    
    // Fallback to swing points
    if (direction === 'LONG') {
      const swingLow = findRecentSwingLow(candles, 3);
      return swingLow ? swingLow.price * 0.99 : entryPrice * 0.98;
    } else {
      const swingHigh = findRecentSwingHigh(candles, 3);
      return swingHigh ? swingHigh.price * 1.01 : entryPrice * 1.02;
    }
  }
  
  /**
   * Calculate target - use Fibonacci extensions
   */
  calculateTarget(
    entryPrice: number,
    stopLoss: number,
    direction: Direction,
    candles: Candle[]
  ): number {
    const fibRetracement = findFibRetracement(candles, 50);
    
    if (fibRetracement) {
      if (direction === 'LONG') {
        // Target the swing high or 127.2% extension
        return fibRetracement.swingHigh;
      } else {
        // Target the swing low or 127.2% extension
        return fibRetracement.swingLow;
      }
    }
    
    // Fallback to R:R based target
    const risk = Math.abs(entryPrice - stopLoss);
    return direction === 'LONG'
      ? entryPrice + risk * this.config.parameters.targetRR
      : entryPrice - risk * this.config.parameters.targetRR;
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(fibRatio: number, riskReward: number): number {
    let confidence = 0.3;
    
    // Golden ratio (0.618) gets highest confidence
    if (fibRatio === 0.618) {
      confidence += 0.3;
    } else if (fibRatio === 0.5) {
      confidence += 0.2;
    } else if (fibRatio === 0.786) {
      confidence += 0.15;
    }
    
    // Higher R:R adds confidence
    confidence += Math.min(riskReward / 10, 0.2);
    
    return Math.min(confidence, 1);
  }
  
  /**
   * Get required candle count
   */
  getRequiredCandleCount(): number {
    return 60;
  }
}

export default FibPullbackPattern;

