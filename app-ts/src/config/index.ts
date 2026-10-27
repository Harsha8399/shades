/**
 * Configuration Module Index
 */

export { DEFAULT_CONFIG, RiskRules, getConfig } from './default';

export {
  // Indian market fees
  INDIAN_MARKET_FEES,
  DEFAULT_FEES,
  INDIAN_MARKET_HOURS,
  calculateTradeFees,
  applySlippage,
  getSlippagePercent,
  NSE_LOT_SIZES,
  MCX_LOT_SIZES,
  MarketSegment,
  FeeStructure,
  // F&O configuration
  FNO_CONFIG,
  FnOConfigEntry,
  getFnOConfig,
  getStrikeInterval,
  getATMStrike,
} from './indianMarket';

// Config Manager
export { 
  ConfigManager, 
  RuntimeConfig,
  AccountConfig,
  TradeConfig,
  IndicatorConfig,
  LLMConfig,
  UpstoxConfig,
} from './ConfigManager';

// Broker Profiles
export {
  BrokerId,
  BrokerProfile,
  BROKER_PROFILES,
  getBrokerProfile,
  getBrokerFees,
} from './brokers';

// Trading Presets
export {
  PresetMode,
  PresetConfig,
  PRESETS,
  getPreset,
  applyPreset,
} from './presets';

