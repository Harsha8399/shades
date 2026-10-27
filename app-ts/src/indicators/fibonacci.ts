import { Candle } from '../types';
import { findSwingPoints } from './swingPoints';

/**
 * Fibonacci level
 */
export interface FibLevel {
  ratio: number;           // 0.382, 0.5, 0.618, etc.
  price: number;
  label: string;           // "38.2%", "50%", "61.8%"
}

/**
 * Fibonacci retracement result
 */
export interface FibRetracement {
  swingHigh: number;
  swingLow: number;
  direction: 'UP' | 'DOWN';  // Direction of the move being retraced
  levels: FibLevel[];
}

/**
 * Standard Fibonacci ratios
 */
export const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];

/**
 * Calculate Fibonacci retracement levels
 * 
 * @param swingHigh - High point of the swing
 * @param swingLow - Low point of the swing
 * @param direction - Direction of the original move
 * @param ratios - Optional custom Fibonacci ratios (defaults to standard FIB_RATIOS)
 */
export function calculateFibLevels(
  swingHigh: number,
  swingLow: number,
  direction: 'UP' | 'DOWN',
  ratios: number[] = FIB_RATIOS
): FibLevel[] {
  const range = swingHigh - swingLow;
  const levels: FibLevel[] = [];
  
  for (const ratio of ratios) {
    let price: number;
    
    if (direction === 'UP') {
      // Retracement of up move (measuring from high going down)
      price = swingHigh - (range * ratio);
    } else {
      // Retracement of down move (measuring from low going up)
      price = swingLow + (range * ratio);
    }
    
    levels.push({
      ratio,
      price,
      label: `${(ratio * 100).toFixed(1)}%`
    });
  }
  
  return levels;
}

/**
 * Find Fibonacci retracement from recent swing
 * 
 * @param candles - Array of OHLCV candles
 * @param lookback - How far back to look for swing (default: 50)
 * @param ratios - Optional custom Fibonacci ratios (defaults to standard FIB_RATIOS)
 */
export function findFibRetracement(candles: Candle[], lookback: number = 50, ratios?: number[]): FibRetracement | null {
  const window = candles.slice(-lookback);
  if (window.length === 0) return null;

  // Confirmed swing points inside the window.
  const swings = findSwingPoints(window, 5, 3);
  
  if (swings.length === 0) {
    return null;
  }

  // Scan from most recent to oldest, taking the first HIGH and the first LOW
  // found. The previous implementation looked only at the last 4 swings and
  // returned null when they did not contain both a high and a low, which
  // silently dropped the Fibonacci confirmation factor depending on the shape
  // of the recent swings. The Python engine now matches this behaviour.
  const highs = swings.filter(s => s.type === 'HIGH');
  const lows = swings.filter(s => s.type === 'LOW');
  
  if (highs.length === 0 || lows.length === 0) {
    return null;
  }
  
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  
  // Determine direction based on which came first
  const direction: 'UP' | 'DOWN' = lastLow.index < lastHigh.index ? 'UP' : 'DOWN';
  
  const levels = calculateFibLevels(lastHigh.price, lastLow.price, direction, ratios);
  
  return {
    swingHigh: lastHigh.price,
    swingLow: lastLow.price,
    direction,
    levels
  };
}

/**
 * Check if price is at a Fibonacci level
 */
export function isPriceAtFibLevel(
  price: number,
  fibRetracement: FibRetracement,
  tolerance: number
): { atFib: boolean; level: FibLevel | null } {
  for (const level of fibRetracement.levels) {
    if (Math.abs(price - level.price) <= tolerance) {
      return { atFib: true, level };
    }
  }
  return { atFib: false, level: null };
}

/**
 * Get key Fibonacci levels (50%, 61.8%, 78.6%)
 */
export function getKeyFibLevels(fibRetracement: FibRetracement): FibLevel[] {
  const keyRatios = [0.5, 0.618, 0.786];
  return fibRetracement.levels.filter(l => keyRatios.includes(l.ratio));
}

/**
 * Calculate Fibonacci extension levels
 */
export function calculateFibExtensions(
  swingHigh: number,
  swingLow: number,
  direction: 'UP' | 'DOWN'
): FibLevel[] {
  const range = swingHigh - swingLow;
  const extensionRatios = [1.272, 1.618, 2.0, 2.618];
  const levels: FibLevel[] = [];
  
  for (const ratio of extensionRatios) {
    let price: number;
    
    if (direction === 'UP') {
      price = swingLow + (range * ratio);
    } else {
      price = swingHigh - (range * ratio);
    }
    
    levels.push({
      ratio,
      price,
      label: `${(ratio * 100).toFixed(1)}%`
    });
  }
  
  return levels;
}

