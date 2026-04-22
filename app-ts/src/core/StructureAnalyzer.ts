/**
 * Market Structure Analyzer
 * 
 * Detects market structure through swing point analysis:
 * - Identifies swing highs and lows
 * - Labels as HH/HL/LH/LL based on context
 * - Detects Break of Structure (BOS) and Change of Character (CHoCH)
 * - Determines overall trend direction
 */
import { Candle } from '../types';
import {
  MarketStructure,
  SwingPoint,
  SwingType,
  StructureBreak,
  StructureTrend,
  StructureConfig,
  DEFAULT_STRUCTURE_CONFIG,
} from '../types/structure';

/**
 * Raw swing point before labeling
 */
interface RawSwing {
  index: number;
  price: number;
  isHigh: boolean;
  timestamp: number;
  strength: number;
}

/**
 * Analyze market structure from candle data
 */
export function analyzeStructure(
  candles: Candle[],
  config: Partial<StructureConfig> = {}
): MarketStructure {
  const cfg = { ...DEFAULT_STRUCTURE_CONFIG, ...config };
  
  // 1. Find raw swing points
  const rawSwings = findRawSwings(candles, cfg.swingLookback);
  
  // 2. Filter by strength
  const significantSwings = rawSwings.filter(s => s.strength >= cfg.minSwingStrength);
  
  // 3. Label swings as HH/HL/LH/LL
  const labeledSwings = labelSwings(significantSwings);
  
  // 4. Keep only recent swings
  const recentSwings = labeledSwings.slice(-cfg.structureDepth);
  
  // 5. Determine trend
  const trend = determineTrend(recentSwings);
  
  // 6. Get last/previous highs and lows
  const highs = recentSwings.filter(s => s.isHigh);
  const lows = recentSwings.filter(s => !s.isHigh);
  
  const lastHigh = highs.length > 0 ? highs[highs.length - 1] : null;
  const previousHigh = highs.length > 1 ? highs[highs.length - 2] : null;
  const lastLow = lows.length > 0 ? lows[lows.length - 1] : null;
  const previousLow = lows.length > 1 ? lows[lows.length - 2] : null;
  
  // 7. Check for structure break
  const currentPrice = candles[candles.length - 1].close;
  const structureBreak = detectStructureBreak(recentSwings, currentPrice, trend);
  
  // 8. Mark broken levels
  markBrokenLevels(recentSwings, currentPrice);
  
  // 9. Calculate trend strength
  const trendStrength = calculateTrendStrength(recentSwings);
  
  // 10. Check if making new highs/lows
  const currentHigh = candles[candles.length - 1].high;
  const currentLow = candles[candles.length - 1].low;
  const makingNewHigh = lastHigh ? currentHigh > lastHigh.price : false;
  const makingNewLow = lastLow ? currentLow < lastLow.price : false;
  
  return {
    trend,
    swings: recentSwings,
    lastHigh,
    lastLow,
    previousHigh,
    previousLow,
    structureBreak,
    keyResistance: lastHigh?.price ?? null,
    keySupport: lastLow?.price ?? null,
    trendStrength,
    makingNewHigh,
    makingNewLow,
  };
}

/**
 * Find raw swing highs and lows
 */
function findRawSwings(candles: Candle[], lookback: number): RawSwing[] {
  const swings: RawSwing[] = [];
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    // Check for swing high
    const isSwingHigh = checkSwingHigh(candles, i, lookback);
    if (isSwingHigh.isSwing) {
      swings.push({
        index: i,
        price: candles[i].high,
        isHigh: true,
        timestamp: candles[i].timestamp,
        strength: isSwingHigh.strength,
      });
    }
    
    // Check for swing low
    const isSwingLow = checkSwingLow(candles, i, lookback);
    if (isSwingLow.isSwing) {
      swings.push({
        index: i,
        price: candles[i].low,
        isHigh: false,
        timestamp: candles[i].timestamp,
        strength: isSwingLow.strength,
      });
    }
  }
  
  // Sort by index
  swings.sort((a, b) => a.index - b.index);
  
  return swings;
}

/**
 * Check if bar is a swing high
 */
function checkSwingHigh(
  candles: Candle[],
  index: number,
  lookback: number
): { isSwing: boolean; strength: number } {
  const high = candles[index].high;
  let strength = 0;
  
  // Check left side
  for (let i = 1; i <= lookback; i++) {
    if (index - i < 0) break;
    if (candles[index - i].high < high) {
      strength++;
    } else {
      break;
    }
  }
  
  // Check right side
  for (let i = 1; i <= lookback; i++) {
    if (index + i >= candles.length) break;
    if (candles[index + i].high < high) {
      strength++;
    } else {
      break;
    }
  }
  
  return {
    isSwing: strength >= lookback,
    strength: Math.floor(strength / 2),
  };
}

/**
 * Check if bar is a swing low
 */
function checkSwingLow(
  candles: Candle[],
  index: number,
  lookback: number
): { isSwing: boolean; strength: number } {
  const low = candles[index].low;
  let strength = 0;
  
  // Check left side
  for (let i = 1; i <= lookback; i++) {
    if (index - i < 0) break;
    if (candles[index - i].low > low) {
      strength++;
    } else {
      break;
    }
  }
  
  // Check right side
  for (let i = 1; i <= lookback; i++) {
    if (index + i >= candles.length) break;
    if (candles[index + i].low > low) {
      strength++;
    } else {
      break;
    }
  }
  
  return {
    isSwing: strength >= lookback,
    strength: Math.floor(strength / 2),
  };
}

/**
 * Label swings as HH/HL/LH/LL based on previous swings
 */
function labelSwings(rawSwings: RawSwing[]): SwingPoint[] {
  const labeled: SwingPoint[] = [];
  
  let lastLabeledHigh: SwingPoint | null = null;
  let lastLabeledLow: SwingPoint | null = null;
  
  for (const swing of rawSwings) {
    let type: SwingType;
    
    if (swing.isHigh) {
      // Compare to last high
      if (!lastLabeledHigh) {
        type = 'HH'; // First high, assume HH
      } else if (swing.price > lastLabeledHigh.price) {
        type = 'HH';
      } else {
        type = 'LH';
      }
      
      const labeled_swing: SwingPoint = {
        index: swing.index,
        price: swing.price,
        type,
        timestamp: swing.timestamp,
        isHigh: true,
        strength: swing.strength,
        broken: false,
      };
      
      labeled.push(labeled_swing);
      lastLabeledHigh = labeled_swing;
    } else {
      // Compare to last low
      if (!lastLabeledLow) {
        type = 'HL'; // First low, assume HL
      } else if (swing.price > lastLabeledLow.price) {
        type = 'HL';
      } else {
        type = 'LL';
      }
      
      const labeled_swing: SwingPoint = {
        index: swing.index,
        price: swing.price,
        type,
        timestamp: swing.timestamp,
        isHigh: false,
        strength: swing.strength,
        broken: false,
      };
      
      labeled.push(labeled_swing);
      lastLabeledLow = labeled_swing;
    }
  }
  
  return labeled;
}

/**
 * Determine overall trend from swing sequence
 */
function determineTrend(swings: SwingPoint[]): StructureTrend {
  if (swings.length < 4) {
    return 'NEUTRAL';
  }
  
  // Count recent swing types
  const recent = swings.slice(-6);
  let bullishCount = 0;
  let bearishCount = 0;
  
  for (const swing of recent) {
    if (swing.type === 'HH' || swing.type === 'HL') {
      bullishCount++;
    } else {
      bearishCount++;
    }
  }
  
  // Need clear majority
  if (bullishCount >= 4) {
    return 'BULLISH';
  } else if (bearishCount >= 4) {
    return 'BEARISH';
  }
  
  return 'NEUTRAL';
}

/**
 * Detect Break of Structure or Change of Character
 */
function detectStructureBreak(
  swings: SwingPoint[],
  currentPrice: number,
  trend: StructureTrend
): StructureBreak | null {
  if (swings.length < 4) {
    return null;
  }
  
  const lows = swings.filter(s => !s.isHigh);
  const highs = swings.filter(s => s.isHigh);
  
  const lastLow = lows.length > 0 ? lows[lows.length - 1] : null;
  const lastHigh = highs.length > 0 ? highs[highs.length - 1] : null;
  
  // In bullish trend, watch for break below last HL
  if (trend === 'BULLISH' && lastLow && lastLow.type === 'HL') {
    if (currentPrice < lastLow.price) {
      // Breaking below HL in uptrend = potential CHoCH
      return {
        type: 'CHoCH',
        level: lastLow.price,
        index: lastLow.index,
        direction: 'BEARISH',
        significance: 'MAJOR',
      };
    }
  }
  
  // In bearish trend, watch for break above last LH
  if (trend === 'BEARISH' && lastHigh && lastHigh.type === 'LH') {
    if (currentPrice > lastHigh.price) {
      // Breaking above LH in downtrend = potential CHoCH
      return {
        type: 'CHoCH',
        level: lastHigh.price,
        index: lastHigh.index,
        direction: 'BULLISH',
        significance: 'MAJOR',
      };
    }
  }
  
  // Check for BOS (Break of Structure) - continuation
  if (trend === 'BULLISH' && lastHigh && lastHigh.type === 'HH') {
    // Already made HH, continuation confirmed
    if (currentPrice > lastHigh.price) {
      return {
        type: 'BOS',
        level: lastHigh.price,
        index: lastHigh.index,
        direction: 'BULLISH',
        significance: 'MINOR',
      };
    }
  }
  
  if (trend === 'BEARISH' && lastLow && lastLow.type === 'LL') {
    if (currentPrice < lastLow.price) {
      return {
        type: 'BOS',
        level: lastLow.price,
        index: lastLow.index,
        direction: 'BEARISH',
        significance: 'MINOR',
      };
    }
  }
  
  return null;
}

/**
 * Mark swing levels that have been broken
 */
function markBrokenLevels(swings: SwingPoint[], currentPrice: number): void {
  for (const swing of swings) {
    if (swing.broken) continue;
    
    if (swing.isHigh && currentPrice > swing.price) {
      swing.broken = true;
    } else if (!swing.isHigh && currentPrice < swing.price) {
      swing.broken = true;
    }
  }
}

/**
 * Calculate trend strength based on consecutive matching swings
 */
function calculateTrendStrength(swings: SwingPoint[]): number {
  if (swings.length < 2) return 0;
  
  const recent = swings.slice(-8);
  let consecutive = 0;
  let maxConsecutive = 0;
  let lastBullish: boolean | null = null;
  
  for (const swing of recent) {
    const isBullish = swing.type === 'HH' || swing.type === 'HL';
    
    if (lastBullish === null) {
      consecutive = 1;
    } else if (isBullish === lastBullish) {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 1;
    }
    
    lastBullish = isBullish;
  }
  
  // Normalize to 0-1
  return Math.min(maxConsecutive / 6, 1);
}

/**
 * Get a simple structure summary for logging
 */
export function getStructureSummary(structure: MarketStructure): string {
  const parts = [
    `Trend: ${structure.trend}`,
    `Strength: ${(structure.trendStrength * 100).toFixed(0)}%`,
  ];
  
  if (structure.lastHigh) {
    parts.push(`Last High: ${structure.lastHigh.type} @ ${structure.lastHigh.price.toFixed(2)}`);
  }
  if (structure.lastLow) {
    parts.push(`Last Low: ${structure.lastLow.type} @ ${structure.lastLow.price.toFixed(2)}`);
  }
  if (structure.structureBreak) {
    parts.push(`${structure.structureBreak.type}: ${structure.structureBreak.direction}`);
  }
  
  return parts.join(' | ');
}

export default { analyzeStructure, getStructureSummary };

