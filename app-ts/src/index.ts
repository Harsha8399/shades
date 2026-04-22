/**
 * Shades - Trading Pattern Research Platform
 * 
 * Main entry point - uses barrel exports from each module
 */

// ============================================================
// Core Module - Pattern detection, trading engine, monitoring
// ============================================================
export {
  // Pattern detection
  PatternEngine,
  PatternRegistry,
  
  // Trading engine
  PaperTradingEngine,
  TrailingStopConfig,
  TradeStateMachine,
  RiskManager,
  ExecutionSimulator,
  defaultExecutionSimulator,
  
  // Live monitoring
  LiveMonitor,
  MultiSymbolMonitor,
  
  // Multi-timeframe analysis
  analyzeMTF,
  analyzeTimeframe,
  isSignalAlignedWithMTF,
  getMTFSummary,
  
  // Market analysis
  analyzeStructure,
  getStructureSummary,
  detectRegime,
  isSignalAlignedWithRegime,
  getRegimeSummary,
  
  // Trade filters
  TradeFilters,
  createTradeFilters,
  FilterConfig,
  DEFAULT_FILTER_CONFIG,
  
  // Partial profit management
  processPartialExits,
  applyPartialExit,
  handleStopWithPartialExits,
  calculateUnrealizedPnl,
  getPartialExitsSummary,
  
  // Candle utilities
  CandleResampler,
  NseCandleResampler,
  getHigherTimeframe,
  getTimeframeMinutes,
  TIMEFRAME_MINUTES,
  NSE_TIMEFRAME_MINUTES,
  NSE_MARKET_HOURS,
} from './core';

// ============================================================
// Patterns Module - Trading patterns and strategy builder
// ============================================================
export { BasePattern } from './patterns/BasePattern';
export { ConfluenceZonePattern } from './patterns/ConfluenceZonePattern';
export { TrendlineBreakPattern } from './patterns/TrendlineBreakPattern';
export { FibPullbackPattern } from './patterns/FibPullbackPattern';
export { SRRetestPattern } from './patterns/SRRetestPattern';
export { registerAllPatterns } from './patterns';
export { 
  buildStrategy, 
  loadStrategyFromFile, 
  GeneratedPattern, 
  EXAMPLE_STRATEGIES 
} from './patterns/StrategyBuilder';

// ============================================================
// Data Module - Data loading and broker adapters
// ============================================================
export {
  // Data loader
  CSVLoader,
  
  // Market calendar
  IndianMarketCalendar,
  
  // Broker adapters
  BrokerAdapter,
  BrokerCredentials,
  MockNseAdapter,
  createBrokerAdapter,
  NSE_TIMEFRAMES,
  
  // Angel One
  AngelOneAdapter,
  AngelOneCredentials,
  createAngelOneFromEnv,
  NSE_STOCK_TOKENS,
  INDEX_TOKENS,
  SymbolToken,
  
  // Upstox
  UpstoxFeed,
  UpstoxConfig,
  createUpstoxFeedFromEnv,
} from './data';

// ============================================================
// Database Module
// ============================================================
export { DatabaseConnection, TradeRepository } from './db';

// ============================================================
// Configuration Module
// ============================================================
export {
  DEFAULT_CONFIG,
  getConfig,
  RiskRules,
  INDIAN_MARKET_FEES,
  INDIAN_MARKET_HOURS,
  calculateTradeFees,
  applySlippage,
  getSlippagePercent,
  NSE_LOT_SIZES,
  MCX_LOT_SIZES,
} from './config';

// ============================================================
// Utilities Module
// ============================================================
export {
  retry,
  CircuitBreaker,
  RateLimiter,
  RetryConfig,
  RetryResult,
  DEFAULT_RETRY_CONFIG,
} from './utils';

// ============================================================
// Notifications & Reports
// ============================================================
export { NotificationService } from './notifications';
export { ReportGenerator, PerformanceReport } from './reports';

// ============================================================
// CLI Module
// ============================================================
export { Dashboard } from './cli/dashboard';

// ============================================================
// Types & Indicators (re-export all)
// ============================================================
export * from './types';
export * from './indicators';

// ============================================================
// Quick Start Functions
// ============================================================
import { PatternEngine } from './core/PatternEngine';
import { LiveMonitor } from './core/LiveMonitor';
import { registerAllPatterns } from './patterns';
import { Dashboard } from './cli/dashboard';
import { Timeframe } from './types';

/**
 * Quick start simulation
 */
export function runSimulation(
  csvPath: string,
  symbol: string,
  timeframe: Timeframe = '1h'
): void {
  console.log('\n=== SHADES - Trading Pattern Research Platform ===\n');
  
  // Register patterns
  registerAllPatterns();
  
  // Create monitor
  const monitor = new LiveMonitor({
    symbol,
    timeframe,
  });
  
  // Load and run
  monitor.loadFromCSV(csvPath);
  monitor.runSimulation();
  
  // Show dashboard
  const dashboard = new Dashboard();
  dashboard.showFullDashboard();
}

// If running directly
if (require.main === module) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           SHADES - Trading Pattern Research Platform         ║
║                                                              ║
║  Commands:                                                   ║
║    npm run dashboard    - Show trading dashboard             ║
║    npm run simulate     - Run simulation on CSV data         ║
║    npm run angelone     - Start Angel One live monitoring    ║
║                                                              ║
║  Usage:                                                      ║
║    npx ts-node src/cli/commands.ts simulate \\               ║
║      -f data/btcusdt_1h.csv -s BTCUSDT -t 1h                ║
║                                                              ║
║    npx ts-node src/cli/commands.ts angelone \\               ║
║      -s RELIANCE,TCS -t 15m                                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
}
