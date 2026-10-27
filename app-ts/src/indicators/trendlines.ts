import { Candle } from '../types';
import { findSwingPoints, BasicSwingPoint } from './swingPoints';

/**
 * Minimum number of swing-point touches required for a valid trendline.
 * Spec: TRENDLINE_MIN_TOUCHES = 2 (book-derived: "At least two touchpoints
 * are required to draw a trendline." — p.6).  Exported so ConfluenceZonePattern
 * and any other caller can import the same constant rather than hardcoding 2.
 */
export const TRENDLINE_MIN_TOUCHES = 2;

/**
 * Trendline representation
 */
export interface Trendline {
  type: 'SUPPORT' | 'RESISTANCE';
  slope: number;           // Price change per bar
  intercept: number;       // Starting price
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  touches: number;
  strength: number;        // R-squared or similar
}

/**
 * Calculate trendline from two points
 */
function calculateTrendline(
  point1: BasicSwingPoint,
  point2: BasicSwingPoint,
  type: 'SUPPORT' | 'RESISTANCE'
): Trendline {
  const slope = (point2.price - point1.price) / (point2.index - point1.index);
  const intercept = point1.price - (slope * point1.index);
  
  return {
    type,
    slope,
    intercept,
    startIndex: point1.index,
    endIndex: point2.index,
    startPrice: point1.price,
    endPrice: point2.price,
    touches: 2,
    strength: 0
  };
}

/**
 * Get price at a specific bar index for a trendline
 */
export function getTrendlinePrice(trendline: Trendline, index: number): number {
  return trendline.intercept + (trendline.slope * index);
}

/**
 * Find trendlines from swing points
 * 
 * @param candles - Array of OHLCV candles
 * @param atr - Current ATR value (used to compute absolute tolerance)
 * @param tolerance - Touch tolerance as an ATR multiple (default: 0.3 per spec TRENDLINE_TOLERANCE_ATR)
 */
export function findTrendlines(
  candles: Candle[],
  atr: number,
  tolerance: number = 0.3
): Trendline[] {
  const swings = findSwingPoints(candles, 3, 3);
  const trendlines: Trendline[] = [];
  const tolerancePrice = atr * tolerance;
  
  // Find support trendlines (connecting lows)
  const lows = swings.filter(s => s.type === 'LOW');
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const trendline = calculateTrendline(lows[i], lows[j], 'SUPPORT');
      
      // Count additional touches
      let touches = 2;
      for (let k = 0; k < lows.length; k++) {
        if (k === i || k === j) continue;
        const expectedPrice = getTrendlinePrice(trendline, lows[k].index);
        if (Math.abs(lows[k].price - expectedPrice) <= tolerancePrice) {
          touches++;
        }
      }
      
      if (touches >= TRENDLINE_MIN_TOUCHES) {
        trendline.touches = touches;
        trendline.strength = touches / lows.length;
        trendlines.push(trendline);
      }
    }
  }
  
  // Find resistance trendlines (connecting highs)
  const highs = swings.filter(s => s.type === 'HIGH');
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const trendline = calculateTrendline(highs[i], highs[j], 'RESISTANCE');
      
      // Count additional touches
      let touches = 2;
      for (let k = 0; k < highs.length; k++) {
        if (k === i || k === j) continue;
        const expectedPrice = getTrendlinePrice(trendline, highs[k].index);
        if (Math.abs(highs[k].price - expectedPrice) <= tolerancePrice) {
          touches++;
        }
      }
      
      if (touches >= TRENDLINE_MIN_TOUCHES) {
        trendline.touches = touches;
        trendline.strength = touches / highs.length;
        trendlines.push(trendline);
      }
    }
  }
  
  // Sort by strength
  return trendlines.sort((a, b) => b.strength - a.strength);
}

/**
 * Check if price is at a trendline
 */
export function isPriceAtTrendline(
  price: number,
  index: number,
  trendlines: Trendline[],
  tolerance: number
): { atTrendline: boolean; trendline: Trendline | null } {
  for (const trendline of trendlines) {
    const expectedPrice = getTrendlinePrice(trendline, index);
    if (Math.abs(price - expectedPrice) <= tolerance) {
      return { atTrendline: true, trendline };
    }
  }
  return { atTrendline: false, trendline: null };
}

/**
 * Project trendline to future bar
 */
export function projectTrendline(trendline: Trendline, barsAhead: number): number {
  const futureIndex = trendline.endIndex + barsAhead;
  return getTrendlinePrice(trendline, futureIndex);
}

