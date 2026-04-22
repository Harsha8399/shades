/**
 * Default configuration for the trading platform
 */
export const DEFAULT_CONFIG = {
  // Capital settings
  initialCapital: 100000,
  
  // Risk management rules
  riskRules: {
    maxRiskPerTrade: 0.02,        // 2% max per trade
    maxOpenTrades: 3,             // Keep simple for MVP
    minRiskReward: 1.5,
    maxDailyTrades: 5,            // Simple daily limit
  },
  
  // Trade settings
  trade: {
    defaultExpiryHours: 24,       // Signal expiry
    slippagePercent: 0.001,       // 0.1% slippage assumption
  },
  
  // Monitor settings
  monitor: {
    pollIntervalMs: 1000,         // Poll interval for live monitor
    candleBufferSize: 2000,       // Max candles to keep in memory (increased for MTF analysis)
  },
  
  // Logging
  logging: {
    level: 'info',
    logToFile: true,
    logDir: './logs',
  },
} as const;

/**
 * Risk rules interface
 */
export interface RiskRules {
  maxRiskPerTrade: number;
  maxOpenTrades: number;
  minRiskReward: number;
  maxDailyTrades: number;
}

/**
 * Get config value with default fallback
 */
export function getConfig<K extends keyof typeof DEFAULT_CONFIG>(
  key: K
): typeof DEFAULT_CONFIG[K] {
  return DEFAULT_CONFIG[key];
}

