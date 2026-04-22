/**
 * Market Structure Types
 * 
 * Market structure is how professional traders read price action.
 * Higher Highs + Higher Lows = Uptrend
 * Lower Lows + Lower Highs = Downtrend
 */

/**
 * Swing point classification
 * HH = Higher High, HL = Higher Low (bullish)
 * LH = Lower High, LL = Lower Low (bearish)
 */
export type SwingType = 'HH' | 'HL' | 'LH' | 'LL';

/**
 * A significant swing point in price
 */
export interface SwingPoint {
  index: number;
  price: number;
  type: SwingType;
  timestamp: number;
  isHigh: boolean;  // true = swing high, false = swing low
  strength: number; // Number of bars confirming this swing
  broken: boolean;  // Has this level been broken?
  brokenAt?: number; // Index where it was broken
}

/**
 * Break of Structure types
 * BOS = Break of Structure (trend continuation signal)
 * CHoCH = Change of Character (potential reversal signal)
 */
export type StructureBreakType = 'BOS' | 'CHoCH';

/**
 * Structure break event
 */
export interface StructureBreak {
  type: StructureBreakType;
  level: number;
  index: number;
  direction: 'BULLISH' | 'BEARISH';
  significance: 'MINOR' | 'MAJOR';
}

/**
 * Overall market structure state
 */
export type StructureTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

/**
 * Complete market structure analysis
 */
export interface MarketStructure {
  trend: StructureTrend;
  swings: SwingPoint[];
  
  // Most recent swing points
  lastHigh: SwingPoint | null;
  lastLow: SwingPoint | null;
  
  // Previous swings for comparison
  previousHigh: SwingPoint | null;
  previousLow: SwingPoint | null;
  
  // Structure break detection
  structureBreak: StructureBreak | null;
  
  // Key levels derived from structure
  keyResistance: number | null;
  keySupport: number | null;
  
  // Trend strength based on consecutive HH/HL or LL/LH
  trendStrength: number; // 0-1
  
  // Is price making new structure?
  makingNewHigh: boolean;
  makingNewLow: boolean;
}

/**
 * Configuration for structure analysis
 */
export interface StructureConfig {
  swingLookback: number;     // Bars to confirm swing (default: 5)
  minSwingStrength: number;  // Minimum strength to count (default: 2)
  structureDepth: number;    // How many swings to track (default: 10)
}

/**
 * Default structure configuration
 */
export const DEFAULT_STRUCTURE_CONFIG: StructureConfig = {
  swingLookback: 5,
  minSwingStrength: 2,
  structureDepth: 10,
};

