import { Candle, MarketContext, Signal, Direction, ValidationResult, PatternConfig } from '../types';
import { BasePattern } from './BasePattern';
import {
  findSRZones,
  findFibRetracement,
  findTrendlines,
  isPriceAtZone,
  isPriceAtFibLevel,
  isPriceAtTrendline,
  findRecentSwingHigh,
  findRecentSwingLow,
  findNearestSupport,
  findNearestResistance,
  calculateATR,
  SRZone,
  FibLevel,
  Trendline,
} from '../indicators';
import { isBullish, isBearish, getUpperWick, getLowerWick, getCandleBody } from '../types/candle';

/**
 * Confluence Zone pattern configuration
 */
interface ConfluenceZoneConfig extends PatternConfig {
  parameters: {
    minConfluenceFactors: number;     // Minimum factors required (default: 2)
    srZoneLookback: number;           // Bars to look for S/R (default: 100)
    fibLevels: number[];              // Fib levels to check (default: [0.5, 0.618, 0.786])
    zoneToleranceATR: number;         // Zone width in ATR (default: 0.5)
    minRejectionWickRatio: number;    // Wick:body ratio for rejection (default: 2.0)
    targetRR: number;                 // Target risk:reward ratio
  };
}

/**
 * Confluence result from analysis
 */
interface ConfluenceResult {
  hasConfluence: boolean;
  factors: string[];
  direction: Direction | null;
  zoneLevel: number;
  zoneBreakPrice: number;
  srZone: SRZone | null;
  fibLevel: FibLevel | null;
  trendline: Trendline | null;
}

/**
 * Confluence Zone + Entry Model 2 Pattern
 * 
 * Detects high-probability entry points where multiple technical factors align:
 * 1. Support/Resistance Zone - Historical price level with multiple touches
 * 2. Fibonacci Level - 50%, 61.8%, or 78.6% retracement
 * 3. Trendline - Dynamic support/resistance
 * 4. Entry Model 2 - Rejection candle at confluence (wick into zone, close outside)
 */
export class ConfluenceZonePattern extends BasePattern {
  readonly id = 'confluence-zone-em2';
  readonly name = 'Confluence Zone + Entry Model 2';
  readonly description = 'Detects rejection candles at zones where S/R, Fib, and trendline align';
  readonly version = '1.0.0';
  
  declare config: ConfluenceZoneConfig;
  
  constructor(config?: Partial<ConfluenceZoneConfig>) {
    super();
    
    this.config = {
      enabled: true,
      timeframes: ['15m', '1h', '4h'],
      symbols: [],
      parameters: {
        minConfluenceFactors: 2,
        srZoneLookback: 100,
        fibLevels: [0.5, 0.618, 0.786],
        zoneToleranceATR: 0.5,
        minRejectionWickRatio: 2.0,
        targetRR: 2,
        ...config?.parameters,
      },
      ...config,
    };
  }
  
  /**
   * Detect confluence zone signal
   */
  detectSignal(candles: Candle[], context: MarketContext): Signal | null {
    const { parameters } = this.config;
    const currentCandle = candles[candles.length - 1];
    const tolerance = context.atr * parameters.zoneToleranceATR;
    
    // 1. Find all confluence factors
    const confluenceResult = this.findConfluence(candles, context, tolerance);
    
    if (!confluenceResult.hasConfluence || 
        confluenceResult.factors.length < parameters.minConfluenceFactors ||
        !confluenceResult.direction) {
      return null;
    }
    
    // 2. Check for Entry Model 2 (rejection candle)
    const rejection = this.detectRejectionCandle(
      currentCandle,
      confluenceResult.direction,
      confluenceResult.zoneLevel,
      tolerance
    );
    
    if (!rejection.isValid) {
      return null;
    }
    
    // 3. Build and return signal
    const direction = confluenceResult.direction;
    const entryPrice = currentCandle.close;
    const stopLoss = this.calculateStopLoss(entryPrice, direction, candles);
    const target = this.calculateTarget(entryPrice, stopLoss, direction, candles);
    
    // Validate R:R ratio
    const riskReward = Math.abs(target - entryPrice) / Math.abs(entryPrice - stopLoss);
    if (riskReward < 1.5) {
      return null;
    }
    
    const confidence = this.calculateConfidence(confluenceResult.factors.length, rejection.strength);
    
    return this.buildSignal(
      direction,
      entryPrice,
      stopLoss,
      target,
      context,
      candles,
      confluenceResult.factors,
      confidence
    );
  }
  
  /**
   * Find confluence at current price
   */
  private findConfluence(
    candles: Candle[],
    context: MarketContext,
    tolerance: number
  ): ConfluenceResult {
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;
    const { parameters } = this.config;
    
    const factors: string[] = [];
    let srZone: SRZone | null = null;
    let fibLevel: FibLevel | null = null;
    let trendline: Trendline | null = null;
    let direction: Direction | null = null;
    let zoneLevel = currentPrice;
    
    // 1. Check S/R zones
    const srZones = findSRZones(
      candles.slice(-parameters.srZoneLookback),
      context.atr,
      0.5,
      2
    );
    
    const srResult = isPriceAtZone(currentPrice, srZones, tolerance);
    if (srResult.atZone && srResult.zone) {
      srZone = srResult.zone;
      zoneLevel = srZone.priceLevel;
      factors.push(`sr_${srResult.zoneType?.toLowerCase()}`);
      
      // Determine direction from S/R type
      direction = srResult.zoneType === 'SUPPORT' ? 'LONG' : 'SHORT';
    }
    
    // 2. Check Fibonacci levels
    const fibRetracement = findFibRetracement(candles, 50);
    if (fibRetracement) {
      const fibResult = isPriceAtFibLevel(currentPrice, fibRetracement, tolerance);
      if (fibResult.atFib && fibResult.level) {
        fibLevel = fibResult.level;
        factors.push(`fib_${Math.round(fibResult.level.ratio * 1000)}`);
        
        // Determine direction from fib retracement direction
        if (!direction) {
          direction = fibRetracement.direction === 'UP' ? 'LONG' : 'SHORT';
        }
      }
    }
    
    // 3. Check trendlines
    const trendlines = findTrendlines(candles, context.atr, 0.3);
    if (trendlines.length > 0) {
      const currentIndex = candles.length - 1;
      const tlResult = isPriceAtTrendline(currentPrice, currentIndex, trendlines, tolerance);
      if (tlResult.atTrendline && tlResult.trendline) {
        trendline = tlResult.trendline;
        factors.push(`trendline_${tlResult.trendline.type.toLowerCase()}`);
        
        // Confirm or set direction
        if (!direction) {
          direction = tlResult.trendline.type === 'SUPPORT' ? 'LONG' : 'SHORT';
        }
      }
    }
    
    // Calculate zone break price (invalidation)
    const zoneBreakPrice = direction === 'LONG'
      ? zoneLevel - tolerance * 2
      : zoneLevel + tolerance * 2;
    
    return {
      hasConfluence: factors.length >= parameters.minConfluenceFactors,
      factors,
      direction,
      zoneLevel,
      zoneBreakPrice,
      srZone,
      fibLevel,
      trendline,
    };
  }
  
  /**
   * Detect Entry Model 2 - rejection candle
   * A rejection candle has a wick into the zone but closes outside
   */
  private detectRejectionCandle(
    candle: Candle,
    direction: Direction,
    zoneLevel: number,
    tolerance: number
  ): { isValid: boolean; strength: number } {
    const body = getCandleBody(candle);
    const upperWick = getUpperWick(candle);
    const lowerWick = getLowerWick(candle);
    
    const { minRejectionWickRatio } = this.config.parameters;
    
    if (direction === 'LONG') {
      // For long: bullish candle with lower wick into support zone
      // Wick should be longer than body
      const wickRatio = body > 0 ? lowerWick / body : lowerWick;
      
      // Check wick touches zone
      const wickTouchesZone = candle.low <= zoneLevel + tolerance;
      
      // Check close is above zone
      const closeAboveZone = candle.close > zoneLevel;
      
      // Check it's a bullish or doji candle
      const isBullishOrDoji = isBullish(candle) || body < (candle.high - candle.low) * 0.1;
      
      const isValid = wickTouchesZone && closeAboveZone && wickRatio >= minRejectionWickRatio && isBullishOrDoji;
      
      return {
        isValid,
        strength: isValid ? Math.min(wickRatio / minRejectionWickRatio, 2) : 0,
      };
    } else {
      // For short: bearish candle with upper wick into resistance zone
      const wickRatio = body > 0 ? upperWick / body : upperWick;
      
      // Check wick touches zone
      const wickTouchesZone = candle.high >= zoneLevel - tolerance;
      
      // Check close is below zone
      const closeBelowZone = candle.close < zoneLevel;
      
      // Check it's a bearish or doji candle
      const isBearishOrDoji = isBearish(candle) || body < (candle.high - candle.low) * 0.1;
      
      const isValid = wickTouchesZone && closeBelowZone && wickRatio >= minRejectionWickRatio && isBearishOrDoji;
      
      return {
        isValid,
        strength: isValid ? Math.min(wickRatio / minRejectionWickRatio, 2) : 0,
      };
    }
  }
  
  /**
   * Calculate stop-loss based on recent swing
   */
  calculateStopLoss(entryPrice: number, direction: Direction, candles: Candle[]): number {
    if (direction === 'LONG') {
      const swingLow = findRecentSwingLow(candles, 3);
      if (swingLow) {
        const buffer = (entryPrice - swingLow.price) * 0.1;
        return swingLow.price - buffer;
      }
      // Fallback: use recent low with buffer
      const recentLows = candles.slice(-10).map(c => c.low);
      const minLow = Math.min(...recentLows);
      return minLow - (entryPrice - minLow) * 0.1;
    } else {
      const swingHigh = findRecentSwingHigh(candles, 3);
      if (swingHigh) {
        const buffer = (swingHigh.price - entryPrice) * 0.1;
        return swingHigh.price + buffer;
      }
      // Fallback: use recent high with buffer
      const recentHighs = candles.slice(-10).map(c => c.high);
      const maxHigh = Math.max(...recentHighs);
      return maxHigh + (maxHigh - entryPrice) * 0.1;
    }
  }
  
  /**
   * Calculate target based on structure levels (DYNAMIC TARGETS)
   * Instead of fixed R:R, target the next structural level
   */
  calculateTarget(
    entryPrice: number,
    stopLoss: number,
    direction: Direction,
    candles: Candle[]
  ): number {
    const risk = Math.abs(entryPrice - stopLoss);
    const minRR = 1.5;  // Minimum acceptable R:R
    const defaultRR = this.config.parameters.targetRR || 2.5;
    
    // Find structural zones
    const atr = calculateATR(candles, 14);
    const zones = findSRZones(candles, atr, 0.5, 2);
    
    if (direction === 'LONG') {
      // Find the nearest resistance above entry
      const resistance = findNearestResistance(entryPrice, zones);
      
      if (resistance) {
        const distanceToResistance = resistance.priceLevel - entryPrice;
        const rMultiple = distanceToResistance / risk;
        
        // If resistance offers > minRR, target slightly before it
        if (rMultiple >= minRR) {
          // Exit 0.2% before the level (avoid the exact level where orders cluster)
          const targetPrice = resistance.priceLevel * 0.998;
          return targetPrice;
        }
      }
      
      // Fallback: use fixed R:R if no good structure target
      return entryPrice + (risk * defaultRR);
      
    } else {
      // Find the nearest support below entry
      const support = findNearestSupport(entryPrice, zones);
      
      if (support) {
        const distanceToSupport = entryPrice - support.priceLevel;
        const rMultiple = distanceToSupport / risk;
        
        // If support offers > minRR, target slightly above it
        if (rMultiple >= minRR) {
          // Exit 0.2% above the level
          const targetPrice = support.priceLevel * 1.002;
          return targetPrice;
        }
      }
      
      // Fallback: use fixed R:R if no good structure target
      return entryPrice - (risk * defaultRR);
    }
  }
  
  /**
   * Calculate confidence score based on confluence factors and rejection strength
   */
  private calculateConfidence(factorCount: number, rejectionStrength: number): number {
    // Base confidence from factor count
    let confidence = Math.min(factorCount / 4, 0.6);
    
    // Add rejection strength
    confidence += Math.min(rejectionStrength * 0.2, 0.4);
    
    return Math.min(confidence, 1);
  }
  
  /**
   * Validate pattern has enough data
   */
  validate(candles: Candle[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (candles.length < this.getRequiredCandleCount()) {
      errors.push(`Insufficient candles: need ${this.getRequiredCandleCount()}, got ${candles.length}`);
    }
    
    if (this.config.parameters.minConfluenceFactors < 2) {
      warnings.push('minConfluenceFactors < 2 may produce low-quality signals');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Get required candle count
   */
  getRequiredCandleCount(): number {
    return Math.max(this.config.parameters.srZoneLookback, 100);
  }
}

export default ConfluenceZonePattern;

