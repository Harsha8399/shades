/**
 * Data Module Index
 * 
 * Exports all data loading and broker adapter functionality.
 */

// Data loaders
export { CSVLoader } from './CSVLoader';
export { 
  NiftyHistoricalDownloader, 
  NiftyHistoricalDownloader as NiftyDownloader,
  NIFTY_INSTRUMENT_KEYS, 
  DEFAULT_CACHE_CONFIG,
  type CacheConfig, 
  type DownloadConfig, 
  type ValidationResult, 
  type DownloadResult 
} from './NiftyHistoricalDownloader';

// Market calendar
export { IndianMarketCalendar, Exchange, MarketSession as CalendarSession } from './IndianMarketCalendar';

// Broker adapters
export {
  // Base adapter
  BrokerAdapter,
  BrokerCredentials,
  BaseNseAdapter,
  MockNseAdapter,
  ShoonyaAdapter,
  createBrokerAdapter,
  NSE_TIMEFRAMES,
  GapInfo,
} from './NseAdapter';

export {
  // Angel One
  AngelOneAdapter,
  AngelOneCredentials,
  createAngelOneFromEnv,
  NSE_STOCK_TOKENS,
  INDEX_TOKENS,
  SymbolToken,
} from './AngelOneAdapter';

export {
  // Upstox
  UpstoxFeed,
  UpstoxConfig,
  UpstoxInstrument,
  createUpstoxFeedFromEnv,
  HISTORICAL_LIMITS,
  TIMEFRAME_MAP_V3,
  UPSTOX_API_BASE_V2,
  UPSTOX_API_BASE_V3,
} from './UpstoxFeed';

