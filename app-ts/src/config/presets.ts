/**
 * Trading Presets
 * 
 * Pre-configured settings for different trading styles.
 * Simple mode uses these presets to map a single slider to multiple settings.
 */
import { RiskRules } from './default';
import { FilterConfig, DEFAULT_FILTER_CONFIG } from '../core/TradeFilters';

/**
 * Preset mode
 */
export type PresetMode = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' | 'CUSTOM';

/**
 * Preset configuration
 */
export interface PresetConfig {
  mode: PresetMode;
  name: string;
  description: string;
  risk: RiskRules;
  filters: Partial<FilterConfig>;
  trade: {
    slippagePercent: number;
    expiryHours: number;
  };
  indicators: {
    rsiPeriod: number;
    atrPeriod: number;
    emaFast: number;
    emaSlow: number;
    emaTrend: number;
  };
}

/**
 * Conservative preset - Low risk, high filters
 */
export const CONSERVATIVE_PRESET: PresetConfig = {
  mode: 'CONSERVATIVE',
  name: 'Conservative',
  description: 'Low risk, high quality trades only',
  risk: {
    maxRiskPerTrade: 0.01,      // 1% per trade
    maxOpenTrades: 2,           // Max 2 positions
    minRiskReward: 2.0,         // Minimum 2:1 R:R
    maxDailyTrades: 3,          // Max 3 trades per day
  },
  filters: {
    useStructure: true,
    useRegime: true,
    useMTF: true,
    useVolume: true,
    requireBullishStructureForLong: true,
    requireBearishStructureForShort: true,
    skipRangingRegime: true,
    requireHTFAlignment: true,
    skipLowVolume: true,
    minVolumeRatio: 1.2,        // 20% above average
    minHTFStrength: 0.5,        // Strong trend required
  },
  trade: {
    slippagePercent: 0.0015,    // 0.15% (conservative estimate)
    expiryHours: 48,            // Longer expiry window
  },
  indicators: {
    rsiPeriod: 14,
    atrPeriod: 14,
    emaFast: 9,
    emaSlow: 21,
    emaTrend: 200,
  },
};

/**
 * Moderate preset - Balanced approach
 */
export const MODERATE_PRESET: PresetConfig = {
  mode: 'MODERATE',
  name: 'Moderate',
  description: 'Balanced risk and opportunity',
  risk: {
    maxRiskPerTrade: 0.02,      // 2% per trade
    maxOpenTrades: 3,           // Max 3 positions
    minRiskReward: 1.5,         // Minimum 1.5:1 R:R
    maxDailyTrades: 5,          // Max 5 trades per day
  },
  filters: {
    useStructure: true,
    useRegime: true,
    useMTF: true,
    useVolume: true,
    requireBullishStructureForLong: true,
    requireBearishStructureForShort: true,
    skipRangingRegime: false,   // Allow ranging markets
    requireHTFAlignment: true,
    skipLowVolume: true,
    minVolumeRatio: 0.8,        // 80% of average
    minHTFStrength: 0.3,        // Moderate trend
  },
  trade: {
    slippagePercent: 0.001,     // 0.1% (default)
    expiryHours: 24,            // Standard expiry
  },
  indicators: {
    rsiPeriod: 14,
    atrPeriod: 14,
    emaFast: 9,
    emaSlow: 21,
    emaTrend: 200,
  },
};

/**
 * Aggressive preset - High risk, low filters
 */
export const AGGRESSIVE_PRESET: PresetConfig = {
  mode: 'AGGRESSIVE',
  name: 'Aggressive',
  description: 'High risk, more trading opportunities',
  risk: {
    maxRiskPerTrade: 0.05,      // 5% per trade
    maxOpenTrades: 5,           // Max 5 positions
    minRiskReward: 1.2,         // Minimum 1.2:1 R:R
    maxDailyTrades: 10,         // Max 10 trades per day
  },
  filters: {
    useStructure: false,        // No structure requirement
    useRegime: false,           // Trade in all regimes
    useMTF: false,              // No HTF alignment
    useVolume: false,           // No volume filter
    requireBullishStructureForLong: false,
    requireBearishStructureForShort: false,
    skipRangingRegime: false,
    requireHTFAlignment: false,
    skipLowVolume: false,
    minVolumeRatio: 0.3,        // Very low threshold
    minHTFStrength: 0.1,        // Weak trend OK
  },
  trade: {
    slippagePercent: 0.0008,    // 0.08% (optimistic)
    expiryHours: 12,            // Shorter expiry
  },
  indicators: {
    rsiPeriod: 9,               // Faster RSI
    atrPeriod: 10,              // Faster ATR
    emaFast: 5,
    emaSlow: 13,
    emaTrend: 50,               // Shorter trend filter
  },
};

/**
 * All presets
 */
export const PRESETS: Record<PresetMode, PresetConfig> = {
  CONSERVATIVE: CONSERVATIVE_PRESET,
  MODERATE: MODERATE_PRESET,
  AGGRESSIVE: AGGRESSIVE_PRESET,
  CUSTOM: MODERATE_PRESET, // Custom uses moderate as base
};

/**
 * Get preset by mode
 */
export function getPreset(mode: PresetMode): PresetConfig {
  return PRESETS[mode] || PRESETS.MODERATE;
}

/**
 * Apply preset to configuration
 */
export function applyPreset(mode: PresetMode): {
  risk: RiskRules;
  filters: FilterConfig;
  trade: PresetConfig['trade'];
  indicators: PresetConfig['indicators'];
} {
  const preset = getPreset(mode);
  
  return {
    risk: preset.risk,
    filters: { ...DEFAULT_FILTER_CONFIG, ...preset.filters },
    trade: preset.trade,
    indicators: preset.indicators,
  };
}

export default {
  PRESETS,
  getPreset,
  applyPreset,
};

