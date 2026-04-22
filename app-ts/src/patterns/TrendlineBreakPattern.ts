import { Candle, MarketContext, Signal, Direction, ValidationResult, PatternConfig } from '../types';
import { BasePattern } from './BasePattern';
import {
  findTrendlines,
  getTrendlinePrice,
  calculateATR,
  findRecentSwingHigh,
  findRecentSwingLow,
  Trendline,
} from '../indicators';
import { isBullish, isBearish } from '../types/candle';

/**
 * Trendline Break pattern configuration
 */
interface TrendlineBreakConfig extends PatternConfig {
  parameters: {
    minTrendlineTouches: number;      // Minimum touches for valid trendline
    breakConfirmationBars: number;    // Bars to confirm break
    retestToleranceATR: number;       // Tolerance for retest
    requireRetest: boolean;           // Wait for retest before entry
    targetRR: number;                 // Target risk:reward ratio
  };
}

/**
 * Trendline Break Pattern
 * 
 * Detects when price breaks through a significant trendline:
 * 1. Identifies trendlines with multiple touches
 * 2. Detects when price closes beyond the trendline
 * 3. Optionally waits for retest of broken trendline
 * 4. Entry on confirmation candle
 */
export class TrendlineBreakPattern extends BasePattern {
  readonly id = 'trendline-break';
  readonly name = 'Trendline Break';
  readonly description = 'Detects breakouts from significant trendlines with optional retest';
  readonly version = '1.0.0';
  
  declare config: TrendlineBreakConfig;
  
  constructor(config?: Partial<TrendlineBreakConfig>) {
    super();
    
    this.config = {
      enabled: true,
      timeframes: ['15m', '1h', '4h'],
      symbols: [],
      parameters: {
        minTrendlineTouches: 3,
        breakConfirmationBars: 2,
        retestToleranceATR: 0.3,
        requireRetest: false,
        targetRR: 2,
        ...config?.parameters,
      },
      ...config,
    };
  }
  
  /**
   * Detect trendline break signal
   */
  detectSignal(candles: Candle[], context: MarketContext): Signal | null {
    const { parameters } = this.config;
    const atr = context.atr;
    const tolerance = atr * parameters.retestToleranceATR;
    
    // Find trendlines
    const trendlines = findTrendlines(candles, atr, 0.3);
    
    if (trendlines.length === 0) {
      return null;
    }
    
    // Filter for significant trendlines
    const significantTrendlines = trendlines.filter(
      tl => tl.touches >= parameters.minTrendlineTouches
    );
    
    if (significantTrendlines.length === 0) {
      return null;
    }
    
    // Check for break of each trendline
    for (const trendline of significantTrendlines.slice(0, 3)) {
      const breakResult = this.detectBreak(candles, trendline, tolerance);
      
      if (breakResult.broken) {
        // Determine direction based on trendline type
        const direction: Direction = trendline.type === 'RESISTANCE' ? 'LONG' : 'SHORT';
        
        // If requiring retest, check for it
        if (parameters.requireRetest && !breakResult.retested) {
          continue;
        }
        
        // Get entry price
        const currentCandle = candles[candles.length - 1];
        const entryPrice = currentCandle.close;
        
        // Calculate SL and TP
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
          `trendline_${trendline.type.toLowerCase()}_break`,
          `touches_${trendline.touches}`,
        ];
        
        if (breakResult.retested) {
          confluenceFactors.push('retest_confirmed');
        }
        
        const confidence = this.calculateConfidence(trendline, breakResult);
        
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
   * Detect if trendline is broken
   */
  private detectBreak(
    candles: Candle[],
    trendline: Trendline,
    tolerance: number
  ): { broken: boolean; retested: boolean; breakIndex: number } {
    const { breakConfirmationBars } = this.config.parameters;
    const currentIndex = candles.length - 1;
    
    // Look for break in recent bars
    for (let i = currentIndex - breakConfirmationBars; i >= trendline.endIndex + 1; i--) {
      if (i < 0) break;
      
      const expectedPrice = getTrendlinePrice(trendline, i);
      const candle = candles[i];
      
      let broken = false;
      
      if (trendline.type === 'RESISTANCE') {
        // Break above resistance
        broken = candle.close > expectedPrice + tolerance;
      } else {
        // Break below support
        broken = candle.close < expectedPrice - tolerance;
      }
      
      if (broken) {
        // Check for confirmation
        let confirmed = true;
        for (let j = i + 1; j <= Math.min(i + breakConfirmationBars, currentIndex); j++) {
          const confirmPrice = getTrendlinePrice(trendline, j);
          const confirmCandle = candles[j];
          
          if (trendline.type === 'RESISTANCE') {
            if (confirmCandle.close <= confirmPrice) {
              confirmed = false;
              break;
            }
          } else {
            if (confirmCandle.close >= confirmPrice) {
              confirmed = false;
              break;
            }
          }
        }
        
        if (confirmed) {
          // Check for retest
          let retested = false;
          for (let j = i + 1; j <= currentIndex; j++) {
            const retestPrice = getTrendlinePrice(trendline, j);
            const retestCandle = candles[j];
            
            if (trendline.type === 'RESISTANCE') {
              // Retest from above
              if (retestCandle.low <= retestPrice + tolerance && 
                  retestCandle.close > retestPrice) {
                retested = true;
                break;
              }
            } else {
              // Retest from below
              if (retestCandle.high >= retestPrice - tolerance && 
                  retestCandle.close < retestPrice) {
                retested = true;
                break;
              }
            }
          }
          
          return { broken: true, retested, breakIndex: i };
        }
      }
    }
    
    return { broken: false, retested: false, breakIndex: -1 };
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
      const recentLows = candles.slice(-10).map(c => c.low);
      return Math.min(...recentLows) - (entryPrice - Math.min(...recentLows)) * 0.1;
    } else {
      const swingHigh = findRecentSwingHigh(candles, 3);
      if (swingHigh) {
        const buffer = (swingHigh.price - entryPrice) * 0.1;
        return swingHigh.price + buffer;
      }
      const recentHighs = candles.slice(-10).map(c => c.high);
      return Math.max(...recentHighs) + (Math.max(...recentHighs) - entryPrice) * 0.1;
    }
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(trendline: Trendline, breakResult: { retested: boolean }): number {
    let confidence = 0.3;
    
    // More touches = higher confidence
    confidence += Math.min(trendline.touches / 10, 0.3);
    
    // Trendline strength
    confidence += trendline.strength * 0.2;
    
    // Retest confirmation adds confidence
    if (breakResult.retested) {
      confidence += 0.2;
    }
    
    return Math.min(confidence, 1);
  }
  
  /**
   * Get required candle count
   */
  getRequiredCandleCount(): number {
    return 80;
  }
}

export default TrendlineBreakPattern;

