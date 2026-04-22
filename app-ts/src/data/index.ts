/**
 * Data Module Index
 * 
 * Exports all data loading and broker adapter functionality.
 */

// Data loaders
export { CSVLoader } from './CSVLoader';

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
} from './UpstoxFeed';

