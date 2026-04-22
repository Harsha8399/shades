/**
 * Core Module Index
 * 
 * Exports all core trading engine functionality.
 */

// Pattern detection
export { PatternEngine } from './PatternEngine';
export { PatternRegistry } from './PatternRegistry';

// Trading engine
export { PaperTradingEngine, TrailingStopConfig } from './PaperTradingEngine';
export { TradeStateMachine } from './TradeStateMachine';
export { RiskManager } from './RiskManager';
export { ExecutionSimulator, defaultExecutionSimulator } from './ExecutionSimulator';

// Live monitoring
export { LiveMonitor } from './LiveMonitor';
export { MultiSymbolMonitor } from './MultiSymbolMonitor';

// Multi-timeframe analysis
export { 
  analyzeMTF, 
  analyzeTimeframe, 
  isSignalAlignedWithMTF, 
  getMTFSummary 
} from './MTFAnalyzer';

// Market analysis
export { 
  analyzeStructure, 
  getStructureSummary 
} from './StructureAnalyzer';

export { 
  detectRegime, 
  isSignalAlignedWithRegime, 
  getRegimeSummary 
} from './RegimeDetector';

// Trade filters
export { 
  TradeFilters, 
  createTradeFilters, 
  FilterConfig, 
  DEFAULT_FILTER_CONFIG 
} from './TradeFilters';

// Partial profit management
export { 
  processPartialExits, 
  applyPartialExit, 
  handleStopWithPartialExits,
  calculateUnrealizedPnl,
  getPartialExitsSummary,
} from './PartialProfitManager';

// Candle utilities
export { 
  CandleResampler, 
  NseCandleResampler,
  getHigherTimeframe, 
  getTimeframeMinutes, 
  TIMEFRAME_MINUTES,
  NSE_TIMEFRAME_MINUTES,
  NSE_MARKET_HOURS,
} from './CandleResampler';

// F&O Instrument Selection
export {
  InstrumentSelector,
  ExecutionType,
  StrategyExecutionType,
  OptionType,
  FnOInstrument,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
  FNO_CONFIG as INSTRUMENT_FNO_CONFIG,
} from './InstrumentSelector';

