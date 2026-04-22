import { Candle } from '../types';
import { findSwingPoints, BasicSwingPoint } from './swingPoints';

/**
 * Support/Resistance zone
 */
export interface SRZone {
  type: 'SUPPORT' | 'RESISTANCE';
  priceLevel: number;
  strength: number;        // Number of touches
  firstTouch: number;      // Timestamp
  lastTouch: number;       // Timestamp
  touches: number[];       // Array of touch prices
}

/**
 * Find support and resistance zones based on swing points
 * 
 * @param candles - Array of OHLCV candles
 * @param tolerance - Price tolerance for grouping (as ATR multiplier)
 * @param atr - Current ATR value
 * @param minTouches - Minimum touches to consider a valid zone
 */
export function findSRZones(
  candles: Candle[],
  atr: number,
  tolerance: number = 0.5,
  minTouches: number = 2
): SRZone[] {
  const swings = findSwingPoints(candles, 3, 3);
  const zones: SRZone[] = [];
  const tolerancePrice = atr * tolerance;
  
  // Group swing highs into resistance zones
  const highs = swings.filter(s => s.type === 'HIGH');
  const resistanceZones = groupSwingsIntoZones(highs, tolerancePrice, 'RESISTANCE');
  
  // Group swing lows into support zones
  const lows = swings.filter(s => s.type === 'LOW');
  const supportZones = groupSwingsIntoZones(lows, tolerancePrice, 'SUPPORT');
  
  // Filter by minimum touches
  return [...resistanceZones, ...supportZones].filter(z => z.strength >= minTouches);
}

/**
 * Group swing points into zones based on price proximity
 */
function groupSwingsIntoZones(
  swings: BasicSwingPoint[],
  tolerance: number,
  type: 'SUPPORT' | 'RESISTANCE'
): SRZone[] {
  if (swings.length === 0) return [];
  
  const zones: SRZone[] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < swings.length; i++) {
    if (used.has(i)) continue;
    
    const cluster: BasicSwingPoint[] = [swings[i]];
    used.add(i);
    
    // Find all swings within tolerance
    for (let j = i + 1; j < swings.length; j++) {
      if (used.has(j)) continue;
      
      const avgPrice = cluster.reduce((a, b) => a + b.price, 0) / cluster.length;
      if (Math.abs(swings[j].price - avgPrice) <= tolerance) {
        cluster.push(swings[j]);
        used.add(j);
      }
    }
    
    if (cluster.length > 0) {
      const prices = cluster.map(s => s.price);
      const timestamps = cluster.map(s => s.timestamp);
      
      zones.push({
        type,
        priceLevel: prices.reduce((a, b) => a + b, 0) / prices.length,
        strength: cluster.length,
        firstTouch: Math.min(...timestamps),
        lastTouch: Math.max(...timestamps),
        touches: prices
      });
    }
  }
  
  return zones;
}

/**
 * Check if price is at a support/resistance zone
 */
export function isPriceAtZone(
  price: number,
  zones: SRZone[],
  tolerance: number
): { atZone: boolean; zone: SRZone | null; zoneType: 'SUPPORT' | 'RESISTANCE' | null } {
  for (const zone of zones) {
    if (Math.abs(price - zone.priceLevel) <= tolerance) {
      return { atZone: true, zone, zoneType: zone.type };
    }
  }
  return { atZone: false, zone: null, zoneType: null };
}

/**
 * Find nearest support level below current price
 */
export function findNearestSupport(price: number, zones: SRZone[]): SRZone | null {
  const supports = zones
    .filter(z => z.type === 'SUPPORT' && z.priceLevel < price)
    .sort((a, b) => b.priceLevel - a.priceLevel);
  
  return supports.length > 0 ? supports[0] : null;
}

/**
 * Find nearest resistance level above current price
 */
export function findNearestResistance(price: number, zones: SRZone[]): SRZone | null {
  const resistances = zones
    .filter(z => z.type === 'RESISTANCE' && z.priceLevel > price)
    .sort((a, b) => a.priceLevel - b.priceLevel);
  
  return resistances.length > 0 ? resistances[0] : null;
}

