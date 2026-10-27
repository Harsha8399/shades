import { Candle, MarketContext, Signal, Direction, ValidationResult, PatternConfig } from '../types';
import { BasePattern } from './BasePattern';
import {
  findSRZones,
  isPriceAtZone,
  findNearestSupport,
  findNearestResistance,
  calculateATR,
  findRecentSwingHigh,
  findRecentSwingLow,
  SRZone,
} from '../indicators';
import { isBullish, isBearish, getCandleBody, getLowerWick, getUpperWick } from '../types/candle';

/**
 * S/R Retest pattern configuration
 */
interface SRRetestConfig extends PatternConfig {
  parameters: {
    minZoneTouches: number;           // Minimum touches for valid zone
    lookbackBars: number;             // Bars to look back for zones
    toleranceATR: number;             // Zone tolerance in ATR
    requireFlip: boolean;             // Require S->R or R->S flip
    minRejectionWickRatio: number;    // Minimum wick:body ratio
    targetRR: number;                 // Target risk:reward ratio
  };
}

/**
 * Support/Resistance Retest Pattern
 * 
 * Trades retests of broken support/resistance levels:
 * 1. Identifies significant S/R zones
 * 2. Detects when price breaks through a zone
 * 3. Waits for price to retest the broken zone
 * 4. Enters on rejection candle at retest
 * 
 * Key concept: Broken support becomes resistance, broken resistance becomes support
 */
export class SRRetestPattern extends BasePattern {
  readonly id = 'sr-retest';
  readonly name = 'S/R Retest';
  readonly description = 'Trades retests of broken support/resistance levels (S/R flip)';
  readonly version = '1.0.0';
  
  declare config: SRRetestConfig;
  
  constructor(config?: Partial<SRRetestConfig>) {
    super();
    
    this.config = {
      enabled: true,
      timeframes: ['15m', '1h', '4h'],
      symbols: [],
      parameters: {
        minZoneTouches: 2,
        lookbackBars: 100,
        toleranceATR: 0.5,
        requireFlip: true,
        minRejectionWickRatio: 1.5,
        targetRR: 2,
        ...config?.parameters,
      },
      ...config,
    };
  }
  
  /**
   * Detect S/R retest signal
   */
  detectSignal(candles: Candle[], context: MarketContext): Signal | null {
    const { parameters } = this.config;
    const atr = context.atr;
    const tolerance = atr * parameters.toleranceATR;
    
    // Find S/R zones
    const zones = findSRZones(
      candles.slice(-parameters.lookbackBars),
      atr,
      0.5,
      parameters.minZoneTouches
    );
    
    if (zones.length === 0) {
      return null;
    }
    
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;
    
    // Check for retest at each zone
    for (const zone of zones) {
      const retestResult = this.checkRetest(candles, zone, tolerance);
      
      if (retestResult.isRetest) {
        // Determine direction based on flip
        let direction: Direction;
        
        if (parameters.requireFlip) {
          // Broken support becomes resistance -> SHORT
          // Broken resistance becomes support -> LONG
          if (zone.type === 'SUPPORT' && retestResult.flipped) {
            direction = 'SHORT'; // Was support, now resistance
          } else if (zone.type === 'RESISTANCE' && retestResult.flipped) {
            direction = 'LONG'; // Was resistance, now support
          } else {
            continue;
          }
        } else {
          // Trade in direction of the zone type
          direction = zone.type === 'SUPPORT' ? 'LONG' : 'SHORT';
        }
        
        // Check for rejection candle
        if (!this.isRejectionCandle(currentCandle, direction, zone.priceLevel, tolerance)) {
          continue;
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
          continue;
        }
        
        const confluenceFactors = [
          `sr_retest`,
          `zone_strength_${zone.strength}`,
        ];
        
        if (retestResult.flipped) {
          confluenceFactors.push('sr_flip');
        }
        
        const confidence = this.calculateConfidence(zone, retestResult);
        
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
    }
    
    return null;
  }
  
  /**
   * Check if price is retesting a zone after breaking it
   * 
   * The required temporal sequence for a flip/retest is:
   *   1. Price was on the FAR side of the zone (wasOnOtherSide)
   *   2. Price then broke THROUGH the zone (brokeThrough)
   *   3. Price is now back at the zone (atZone) — the retest
   *
   * The previous implementation set both flags in a single forward scan
   * without caring about their order, which allowed false positives where
   * price returned to the zone from the same side it had always been on.
   */
  private checkRetest(
    candles: Candle[],
    zone: SRZone,
    tolerance: number
  ): { isRetest: boolean; flipped: boolean } {
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;

    // Check if current price is at the zone
    const atZone = Math.abs(currentPrice - zone.priceLevel) <= tolerance;

    if (!atZone) {
      return { isRetest: false, flipped: false };
    }

    // Look back through recent history for the required sequence.
    const lookback = Math.min(20, candles.length - 1);
    const historyStart = candles.length - lookback;

    // Phase 1: find the earliest bar where price was on the FAR side.
    // Phase 2: find a break AFTER that bar.
    // If both phases succeed, the current atZone constitutes a retest.

    if (zone.type === 'SUPPORT') {
      // Flip scenario: support was tested from ABOVE, price broke BELOW,
      // now retesting from below as new resistance.
      let farSideEndIndex = -1;
      for (let i = historyStart; i < candles.length - 1; i++) {
        if (candles[i].close > zone.priceLevel + tolerance) {
          farSideEndIndex = i;
          break; // take the earliest occurrence
        }
      }

      if (farSideEndIndex === -1) {
        // Price was never clearly above support in the lookback window
        const flipped = false;
        return { isRetest: atZone && !this.config.parameters.requireFlip, flipped };
      }

      // Look for a break BELOW support after farSideEndIndex
      let brokeThrough = false;
      for (let i = farSideEndIndex + 1; i < candles.length - 1; i++) {
        if (candles[i].close < zone.priceLevel - tolerance) {
          brokeThrough = true;
          break;
        }
      }

      const flipped = brokeThrough;
      const isRetest = atZone && (flipped || !this.config.parameters.requireFlip);
      return { isRetest, flipped };

    } else {
      // zone.type === 'RESISTANCE'
      // Flip scenario: resistance was tested from BELOW, price broke ABOVE,
      // now retesting from above as new support.
      let farSideEndIndex = -1;
      for (let i = historyStart; i < candles.length - 1; i++) {
        if (candles[i].close < zone.priceLevel - tolerance) {
          farSideEndIndex = i;
          break;
        }
      }

      if (farSideEndIndex === -1) {
        const flipped = false;
        return { isRetest: atZone && !this.config.parameters.requireFlip, flipped };
      }

      // Look for a break ABOVE resistance after farSideEndIndex
      let brokeThrough = false;
      for (let i = farSideEndIndex + 1; i < candles.length - 1; i++) {
        if (candles[i].close > zone.priceLevel + tolerance) {
          brokeThrough = true;
          break;
        }
      }

      const flipped = brokeThrough;
      const isRetest = atZone && (flipped || !this.config.parameters.requireFlip);
      return { isRetest, flipped };
    }
  }
  
  /**
   * Check if candle is a rejection candle
   */
  private isRejectionCandle(
    candle: Candle,
    direction: Direction,
    zoneLevel: number,
    tolerance: number
  ): boolean {
    const body = getCandleBody(candle);
    const upperWick = getUpperWick(candle);
    const lowerWick = getLowerWick(candle);
    const { minRejectionWickRatio } = this.config.parameters;
    
    if (direction === 'LONG') {
      // Bullish rejection from support
      const wickRatio = body > 0 ? lowerWick / body : lowerWick;
      const wickTouchesZone = candle.low <= zoneLevel + tolerance;
      const closesAbove = candle.close > zoneLevel;
      
      return wickTouchesZone && closesAbove && wickRatio >= minRejectionWickRatio;
    } else {
      // Bearish rejection from resistance
      const wickRatio = body > 0 ? upperWick / body : upperWick;
      const wickTouchesZone = candle.high >= zoneLevel - tolerance;
      const closesBelow = candle.close < zoneLevel;
      
      return wickTouchesZone && closesBelow && wickRatio >= minRejectionWickRatio;
    }
  }
  
  /**
   * Calculate stop-loss
   */
  calculateStopLoss(entryPrice: number, direction: Direction, candles: Candle[]): number {
    if (direction === 'LONG') {
      const swingLow = findRecentSwingLow(candles, 3);
      if (swingLow) {
        const buffer = (entryPrice - swingLow.price) * 0.1;
        return swingLow.price - buffer;
      }
      return candles.slice(-10).reduce((min, c) => Math.min(min, c.low), Infinity) * 0.99;
    } else {
      const swingHigh = findRecentSwingHigh(candles, 3);
      if (swingHigh) {
        const buffer = (swingHigh.price - entryPrice) * 0.1;
        return swingHigh.price + buffer;
      }
      return candles.slice(-10).reduce((max, c) => Math.max(max, c.high), 0) * 1.01;
    }
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(zone: SRZone, retestResult: { flipped: boolean }): number {
    let confidence = 0.3;
    
    // Zone strength
    confidence += Math.min(zone.strength / 10, 0.3);
    
    // S/R flip adds confidence
    if (retestResult.flipped) {
      confidence += 0.2;
    }
    
    return Math.min(confidence, 1);
  }
  
  /**
   * Get required candle count
   */
  getRequiredCandleCount(): number {
    return this.config.parameters.lookbackBars;
  }
}

export default SRRetestPattern;

