/**
 * Live Market Data Service
 * 
 * Unified interface for live market data from Upstox (and future Angel One).
 * Integrates with ConfigManager for credentials and provides real-time
 * candle data for the pattern engine.
 * Supports both WebSocket (real-time) and REST API (historical) modes.
 */
import { Candle, Timeframe } from '../types';
import { UpstoxFeed, UpstoxConfig, UpstoxInstrument } from './UpstoxFeed';
import { ConfigManager, UpstoxConfig as ConfigUpstoxConfig } from '../config/ConfigManager';

export interface MarketDataConfig {
  symbols: string[];
  timeframes: Timeframe[];
  updateIntervalMs: number;
  useWebSocket: boolean;
}

export interface LiveCandleUpdate {
  symbol: string;
  timeframe: Timeframe;
  candle: Candle;
  isComplete: boolean;
}

export interface LiveTickUpdate {
  symbol: string;
  instrumentKey: string;
  lastPrice: number;
  lastQuantity: number;
  timestamp: number;
  oi?: number;
  depth?: {
    buy: Array<{ price: number; quantity: number; orders: number }>;
    sell: Array<{ price: number; quantity: number; orders: number }>;
  };
}

export type CandleCallback = (update: LiveCandleUpdate) => void;
export type TickCallback = (update: LiveTickUpdate) => void;

/**
 * Running OHLCV state for one (symbol, timeframe) forming candle.
 */
interface FormingCandle {
  timestamp: number; // candle start time (floored to the timeframe)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class LiveMarketDataService {
  private static instance: LiveMarketDataService;
  private upstoxFeed: UpstoxFeed | null = null;
  private configManager: ConfigManager;
  private isRunning = false;
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private candleCallbacks: CandleCallback[] = [];
  private tickCallbacks: TickCallback[] = [];
  private currentCandles: Map<string, Candle> = new Map(); // key: `${symbol}:${timeframe}`
  private instrumentKeys: Map<string, string> = new Map(); // symbol -> instrumentKey
  private subscribedSymbols: Set<string> = new Set();
  private subscribedTimeframes: Set<Timeframe> = new Set();
  private useWebSocket = false;
  private wsConnected = false;
  private formingCandles: Map<string, FormingCandle> = new Map(); // key: `${symbol}:${timeframe}`
  private mockMode = false;
  private mockPriceBase: Map<string, number> = new Map(); // symbol -> base price

  private constructor() {
    this.configManager = ConfigManager.getInstance();
  }

  static getInstance(): LiveMarketDataService {
    if (!LiveMarketDataService.instance) {
      LiveMarketDataService.instance = new LiveMarketDataService();
    }
    return LiveMarketDataService.instance;
  }

  /**
   * Initialize the service with Upstox credentials
   * Returns true even without credentials (mock mode enabled)
   */
  async initialize(config?: { useWebSocket?: boolean; mockMode?: boolean }): Promise<boolean> {
    const upstoxConfig = this.configManager.getUpstox();
    const hasCredentials = upstoxConfig.apiKey && upstoxConfig.apiSecret;
    const mockMode = config?.mockMode ?? !hasCredentials;
    
    if (!hasCredentials || mockMode) {
      console.log('[LiveMarketData] No Upstox credentials or mock mode requested - running in MOCK mode');
      this.useWebSocket = false;
      this.mockMode = true;
      
      // Load instrument keys for mock mode
      this.loadInstrumentKeys();
      
      console.log('[LiveMarketData] Initialized in MOCK mode');
      return true;
    }

    const feedConfig: UpstoxConfig = {
      apiKey: upstoxConfig.apiKey!,
      apiSecret: upstoxConfig.apiSecret!,
      redirectUri: upstoxConfig.redirectUri || 'http://localhost:3000/callback',
      accessToken: upstoxConfig.accessToken,
    };

    this.upstoxFeed = new UpstoxFeed(feedConfig);
    this.useWebSocket = config?.useWebSocket ?? false;
    this.mockMode = false;

    // If we have an access token, set it
    if (upstoxConfig.accessToken) {
      this.upstoxFeed.setAccessToken(upstoxConfig.accessToken);
    }

    // Load popular instrument keys
    this.loadInstrumentKeys();

    // Set up WebSocket event handlers if using WebSocket
    if (this.useWebSocket) {
      this.setupWebSocketHandlers();
    }

    console.log(`[LiveMarketData] Initialized with Upstox (WebSocket: ${this.useWebSocket})`);
    return true;
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.upstoxFeed) return;

    this.upstoxFeed.on('connected', () => {
      this.wsConnected = true;
      console.log('[LiveMarketData] WebSocket connected');
      
      // Subscribe to all currently subscribed symbols
      const instrumentKeys = Array.from(this.subscribedSymbols)
        .map(s => this.getInstrumentKey(s))
        .filter((k): k is string => k !== undefined);
      
      if (instrumentKeys.length > 0) {
        this.upstoxFeed!.subscribeToInstruments(instrumentKeys);
      }
    });

    this.upstoxFeed.on('disconnected', (event) => {
      this.wsConnected = false;
      console.log('[LiveMarketData] WebSocket disconnected');
    });

    this.upstoxFeed.on('tick', (tick: any) => {
      this.handleTickData(tick);
    });

    this.upstoxFeed.on('error', (error: Error) => {
      console.error('[LiveMarketData] WebSocket error:', error.message);
    });

    this.upstoxFeed.on('reconnect_failed', () => {
      console.error('[LiveMarketData] WebSocket reconnection failed, falling back to polling');
      this.useWebSocket = false;
      this.startPolling();
    });
  }

  /**
   * Handle incoming tick data and build candles
   */
  private handleTickData(tick: any): void {
    const { instrumentKey, lastPrice, lastQuantity, timestamp, oi, depth } = tick;
    
    // Find symbol for this instrument key
    let symbol: string | undefined;
    for (const [sym, key] of this.instrumentKeys) {
      if (key === instrumentKey) {
        symbol = sym;
        break;
      }
    }
    
    if (!symbol) return;

    // Emit tick update
    const tickUpdate: LiveTickUpdate = {
      symbol,
      instrumentKey,
      lastPrice,
      lastQuantity,
      timestamp,
      oi,
      depth,
    };

    for (const callback of this.tickCallbacks) {
      try {
        callback(tickUpdate);
      } catch (error) {
        console.error('[LiveMarketData] Tick callback error:', error);
      }
    }

    // Build/update candles from ticks for each timeframe
    for (const timeframe of this.subscribedTimeframes) {
      this.updateCandleFromTick(symbol, timeframe, tick);
    }
  }

/**
 * Update candle from tick data.
 *
 * O(1) per tick: keeps a running OHLCV accumulator per (symbol, timeframe).
 * The previous implementation re-filtered a 1000-tick buffer and rebuilt the
 * candle from scratch on every tick (map/filter/max/min/reduce), which is
 * millions of element visits per second at realistic NSE tick rates across
 * symbols x timeframes. The emitted updates are unchanged: every tick emits
 * the forming candle of the CURRENT window; isComplete flips true on the
 * first tick of a new window (the old candle is complete).
 */
private updateCandleFromTick(symbol: string, timeframe: Timeframe, tick: any): void {
    const key = `${symbol}:${timeframe}`;
    const timestamp = tick.timestamp;
    const price = tick.lastPrice;
    const volume = tick.lastQuantity || 0;

    const timeframeMs = this.getTimeframeMs(timeframe);
    const candleStart = Math.floor(timestamp / timeframeMs) * timeframeMs;

    const state = this.formingCandles.get(key);

    // Stale tick from an already-completed window: nothing observable changes.
    if (state && candleStart < state.timestamp) {
      return;
    }

    if (!state || candleStart !== state.timestamp) {
      // A new window: the previous forming candle is complete. Reset the
      // accumulator from this tick.
      this.formingCandles.set(key, {
        timestamp: candleStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
    } else {
      // Same window: fold the tick into the running OHLCV.
      state.high = Math.max(state.high, price);
      state.low = Math.min(state.low, price);
      state.close = price;
      state.volume += volume;
    }

    const forming = this.formingCandles.get(key)!;
    const candle: Candle = {
      timestamp: forming.timestamp,
      open: forming.open,
      high: forming.high,
      low: forming.low,
      close: forming.close,
      volume: forming.volume,
    };

    const previousCandle = this.currentCandles.get(key);
    const isComplete = !previousCandle || candle.timestamp !== previousCandle.timestamp;

    this.currentCandles.set(key, candle);

    const update: LiveCandleUpdate = {
      symbol,
      timeframe,
      candle,
      isComplete,
    };

    for (const callback of this.candleCallbacks) {
      try {
        callback(update);
      } catch (error) {
        console.error('[LiveMarketData] Candle callback error:', error);
      }
    }

    if (isComplete) {
      console.log(`[LiveMarketData] New ${timeframe} candle for ${symbol}: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
    }
  }

  /**
   * Get timeframe in milliseconds
   */
  private getTimeframeMs(timeframe: Timeframe): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return map[timeframe] || 60 * 1000;
  }

  /**
   * Load instrument key mappings
   */
  private loadInstrumentKeys(): void {
    if (!this.upstoxFeed) return;
    
    const popular = this.upstoxFeed.getPopularNSEStocks();
    for (const [symbol, key] of Object.entries(popular)) {
      this.instrumentKeys.set(symbol, key);
    }
    
    // Add index keys
    this.instrumentKeys.set('NIFTY', 'NSE_INDEX|Nifty 50');
    this.instrumentKeys.set('BANKNIFTY', 'NSE_INDEX|Nifty Bank');
    this.instrumentKeys.set('FINNIFTY', 'NSE_INDEX|Nifty Fin Service');
  }

  /**
   * Get instrument key for a symbol
   */
  getInstrumentKey(symbol: string): string | undefined {
    return this.instrumentKeys.get(symbol.toUpperCase());
  }

  /**
   * Subscribe to live updates for symbols and timeframes
   */
  async subscribe(symbols: string[], timeframes: Timeframe[], options?: { useWebSocket?: boolean }): Promise<void> {
    // Update WebSocket preference if provided
    if (options?.useWebSocket !== undefined) {
      this.useWebSocket = options.useWebSocket;
    }

    for (const symbol of symbols) {
      const upperSymbol = symbol.toUpperCase();
      this.subscribedSymbols.add(upperSymbol);
      
      // Get instrument key
      const instrumentKey = this.getInstrumentKey(upperSymbol);
      if (!instrumentKey) {
        console.warn(`[LiveMarketData] No instrument key for ${upperSymbol}`);
        continue;
      }
      
      // Initialize mock base price if not set
      if (this.mockMode && !this.mockPriceBase.has(upperSymbol)) {
        this.mockPriceBase.set(upperSymbol, 2500 + Math.random() * 500);
      }
    }

    for (const tf of timeframes) {
      this.subscribedTimeframes.add(tf);
    }

    // Connect WebSocket if enabled and not in mock mode
    if (this.useWebSocket && this.upstoxFeed && !this.mockMode) {
      try {
        await this.upstoxFeed.connectWebSocket();
      } catch (error) {
        console.error('[LiveMarketData] WebSocket connection failed, falling back to polling:', error);
        this.useWebSocket = false;
      }
    }

    // Start polling or mock data generation
    if (!this.useWebSocket || this.mockMode) {
      this.startPolling();
    }
    
    console.log(`[LiveMarketData] Subscribed to ${symbols.length} symbols, ${timeframes.length} timeframes (WebSocket: ${this.useWebSocket}, Mock: ${this.mockMode})`);
    return Promise.resolve();
  }

  /**
   * Unsubscribe from symbols/timeframes
   */
  unsubscribe(symbols?: string[], timeframes?: Timeframe[]): void {
    if (symbols) {
      for (const symbol of symbols) {
        this.subscribedSymbols.delete(symbol.toUpperCase());
      }
    }
    
    if (timeframes) {
      for (const tf of timeframes) {
        this.subscribedTimeframes.delete(tf);
      }
    }

    // Update WebSocket subscriptions
    if (this.useWebSocket && this.upstoxFeed && this.upstoxFeed.isWebSocketConnected()) {
      const allKeys = Array.from(this.subscribedSymbols)
        .map(s => this.getInstrumentKey(s))
        .filter((k): k is string => k !== undefined);
      
      // Unsubscribe from all, then resubscribe to remaining
      this.upstoxFeed.unsubscribeFromInstruments(allKeys);
      if (allKeys.length > 0) {
        this.upstoxFeed.subscribeToInstruments(allKeys);
      }
    }

    // Restart polling with updated subscriptions
    if (!this.useWebSocket) {
      this.startPolling();
    }
  }

  /**
   * Start polling for all subscribed symbols/timeframes (fallback method)
   * In mock mode, generates synthetic candle data
   */
  private startPolling(): void {
    // Clear existing intervals
    for (const interval of this.updateIntervals.values()) {
      clearInterval(interval);
    }
    this.updateIntervals.clear();

    if (this.subscribedSymbols.size === 0 || this.subscribedTimeframes.size === 0) {
      return;
    }

    // Poll every 15 seconds for intraday, 1 minute for 1m
    const pollIntervals: Record<Timeframe, number> = {
      '1m': 15000,
      '5m': 30000,
      '15m': 60000,
      '30m': 60000,
      '1h': 300000,
      '4h': 300000,
      '1d': 3600000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };

    for (const symbol of this.subscribedSymbols) {
      const instrumentKey = this.getInstrumentKey(symbol);
      if (!instrumentKey && !this.mockMode) continue;

      for (const timeframe of this.subscribedTimeframes) {
        const intervalMs = pollIntervals[timeframe] || 60000;
        const key = `${symbol}:${timeframe}`;

        // Initial fetch/emit
        if (this.mockMode) {
          this.emitMockCandle(symbol, timeframe, instrumentKey || 'MOCK');
        } else {
          this.fetchAndEmit(symbol, timeframe, instrumentKey!);
        }

        // Set up interval
        const interval = setInterval(() => {
          if (this.mockMode) {
            this.emitMockCandle(symbol, timeframe, instrumentKey || 'MOCK');
          } else {
            this.fetchAndEmit(symbol, timeframe, instrumentKey!);
          }
        }, intervalMs);

        this.updateIntervals.set(key, interval);
      }
    }

    console.log(`[LiveMarketData] Started ${this.mockMode ? 'mock data generation' : 'polling'} for ${this.subscribedSymbols.size} symbols`);
  }

  /**
   * Emit a mock candle update (for demo mode without real credentials)
   */
  private emitMockCandle(symbol: string, timeframe: Timeframe, instrumentKey: string): void {
    // Get or create base price for this symbol
    let basePrice = this.mockPriceBase.get(symbol);
    if (!basePrice) {
      basePrice = 2500 + Math.random() * 500;
      this.mockPriceBase.set(symbol, basePrice);
    }

    // Generate realistic price movement
    const volatility = 0.002; // 0.2% per candle
    const drift = (Math.random() - 0.5) * 0.001; // slight random drift
    const change = basePrice * (drift + (Math.random() - 0.5) * volatility);
    const newPrice = Math.max(basePrice + change, basePrice * 0.8); // floor at 80% of base

    // Update base price with mean reversion
    this.mockPriceBase.set(symbol, basePrice * 0.99 + newPrice * 0.01);

    // Create OHLC from the price movement
    const open = basePrice;
    const close = newPrice;
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);
    const volume = Math.floor(100000 + Math.random() * 500000);

    // Determine candle timestamp (aligned to timeframe)
    const now = Date.now();
    const tfMs = this.getTimeframeMs(timeframe);
    const timestamp = Math.floor(now / tfMs) * tfMs;

    const candle: Candle = {
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    };

    const key = `${symbol}:${timeframe}`;
    const previousCandle = this.currentCandles.get(key);
    
    // Check if candle is complete (new timestamp)
    const isComplete = !previousCandle || candle.timestamp !== previousCandle.timestamp;
    
    // Update stored candle
    this.currentCandles.set(key, candle);

    // Emit to callbacks
    const update: LiveCandleUpdate = {
      symbol,
      timeframe,
      candle,
      isComplete,
    };

    for (const callback of this.candleCallbacks) {
      try {
        callback(update);
      } catch (error) {
        console.error('[LiveMarketData] Callback error:', error);
      }
    }

    if (isComplete) {
      console.log(`[LiveMarketData] Mock ${timeframe} candle for ${symbol}: O=${open.toFixed(2)} H=${high.toFixed(2)} L=${low.toFixed(2)} C=${close.toFixed(2)}`);
    }
  }

  /**
   * Fetch latest candle and emit update (REST API fallback)
   */
  private async fetchAndEmit(symbol: string, timeframe: Timeframe, instrumentKey: string): Promise<void> {
    if (!this.upstoxFeed || !this.upstoxFeed.isAuthenticated()) {
      return;
    }

    try {
      // Get intraday data for today
      const candles = await this.upstoxFeed.getIntradayDataV3(instrumentKey, timeframe);
      
      if (candles.length === 0) return;

      const latestCandle = candles[candles.length - 1];
      const key = `${symbol}:${timeframe}`;
      const previousCandle = this.currentCandles.get(key);
      
      // Check if candle is complete (new timestamp)
      const isComplete = !previousCandle || latestCandle.timestamp !== previousCandle.timestamp;
      
      // Update stored candle
      this.currentCandles.set(key, latestCandle);

      // Emit to callbacks
      const update: LiveCandleUpdate = {
        symbol,
        timeframe,
        candle: latestCandle,
        isComplete,
      };

      for (const callback of this.candleCallbacks) {
        try {
          callback(update);
        } catch (error) {
          console.error('[LiveMarketData] Callback error:', error);
        }
      }

      if (isComplete) {
        console.log(`[LiveMarketData] New ${timeframe} candle for ${symbol}: O=${latestCandle.open} H=${latestCandle.high} L=${latestCandle.low} C=${latestCandle.close}`);
      }
    } catch (error: any) {
      console.error(`[LiveMarketData] Error fetching ${symbol} ${timeframe}:`, error.message);
    }
  }

  /**
   * Register callback for live candle updates
   */
  onCandleUpdate(callback: CandleCallback): () => void {
    this.candleCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.candleCallbacks.indexOf(callback);
      if (index > -1) {
        this.candleCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Register callback for live tick updates
   */
  onTickUpdate(callback: TickCallback): () => void {
    this.tickCallbacks.push(callback);
    
    return () => {
      const index = this.tickCallbacks.indexOf(callback);
      if (index > -1) {
        this.tickCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get historical data for backtesting/initialization
   */
  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    days: number = 30
  ): Promise<Candle[]> {
    if (!this.upstoxFeed || !this.upstoxFeed.isAuthenticated()) {
      throw new Error('Upstox not authenticated');
    }

    const instrumentKey = this.getInstrumentKey(symbol);
    if (!instrumentKey) {
      throw new Error(`No instrument key for ${symbol}`);
    }

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    return this.upstoxFeed.getHistoricalData(instrumentKey, timeframe, fromDate, toDate);
  }

  /**
   * Get current quote for a symbol
   * In mock mode, returns synthetic quote
   */
  async getQuote(symbol: string): Promise<{
    lastPrice: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null> {
    const upperSymbol = symbol.toUpperCase();
    
    if (this.mockMode) {
      const basePrice = this.mockPriceBase.get(upperSymbol) || 2500 + Math.random() * 500;
      const change = (Math.random() - 0.5) * basePrice * 0.01;
      const lastPrice = basePrice + change;
      
      return {
        lastPrice,
        open: basePrice,
        high: Math.max(basePrice, lastPrice) * 1.002,
        low: Math.min(basePrice, lastPrice) * 0.998,
        close: lastPrice,
        volume: Math.floor(100000 + Math.random() * 500000),
      };
    }
    
    if (!this.upstoxFeed || !this.upstoxFeed.isAuthenticated()) {
      return null;
    }

    const instrumentKey = this.getInstrumentKey(upperSymbol);
    if (!instrumentKey) return null;

    try {
      return await this.upstoxFeed.getQuote(instrumentKey);
    } catch (error) {
      console.error(`[LiveMarketData] Quote error for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get market status
   * In mock mode, returns synthetic status
   */
  async getMarketStatus(): Promise<{ exchange: string; status: 'OPEN' | 'CLOSED' }[]> {
    if (this.mockMode) {
      return [
        { exchange: 'NSE', status: 'OPEN' },
        { exchange: 'BSE', status: 'OPEN' },
        { exchange: 'MCX', status: 'OPEN' },
      ];
    }
    
    if (!this.upstoxFeed || !this.upstoxFeed.isAuthenticated()) {
      return [];
    }

    try {
      return await this.upstoxFeed.getMarketStatus();
    } catch (error) {
      console.error('[LiveMarketData] Market status error:', error);
      return [];
    }
  }

  /**
   * Search for instruments
   * In mock mode, returns synthetic results
   */
  async searchInstruments(query: string): Promise<UpstoxInstrument[]> {
    if (this.mockMode) {
      const mockInstruments: UpstoxInstrument[] = [
        { instrumentKey: 'NSE_EQ|INE002A01018', symbol: 'RELIANCE', exchange: 'NSE', segment: 'EQ', name: 'Reliance Industries Ltd', lotSize: 1, tickSize: 0.05 },
        { instrumentKey: 'NSE_EQ|INE467B01029', symbol: 'TCS', exchange: 'NSE', segment: 'EQ', name: 'Tata Consultancy Services Ltd', lotSize: 1, tickSize: 0.05 },
        { instrumentKey: 'NSE_EQ|INE009A01021', symbol: 'INFY', exchange: 'NSE', segment: 'EQ', name: 'Infosys Ltd', lotSize: 1, tickSize: 0.05 },
      ];
      return mockInstruments.filter(inst => inst.symbol.toLowerCase().includes(query.toLowerCase()) || inst.name.toLowerCase().includes(query.toLowerCase()));
    }
    
    if (!this.upstoxFeed || !this.upstoxFeed.isAuthenticated()) {
      return [];
    }

    try {
      return await this.upstoxFeed.searchInstruments(query);
    } catch (error) {
      console.error('[LiveMarketData] Search error:', error);
      return [];
    }
  }

/**
   * Check if service is running
   */
  isActive(): boolean {
    if (this.mockMode) return true;
    return this.upstoxFeed?.isAuthenticated() === true;
  }

  /**
   * Check if WebSocket is connected
   */
  isWebSocketConnected(): boolean {
    if (this.mockMode) return true;
    return this.wsConnected;
  }

  /**
   * Stop all polling and WebSocket
   */
  stop(): void {
    // Clear polling intervals
    for (const interval of this.updateIntervals.values()) {
      clearInterval(interval);
    }
    this.updateIntervals.clear();

    // Disconnect WebSocket
    if (this.upstoxFeed) {
      this.upstoxFeed.disconnectWebSocket();
    }
    this.wsConnected = false;
    this.isRunning = false;
    this.mockMode = false;
    console.log('[LiveMarketData] Stopped');
  }

  /**
   * Get current cached candle
   */
  getCurrentCandle(symbol: string, timeframe: Timeframe): Candle | undefined {
    return this.currentCandles.get(`${symbol.toUpperCase()}:${timeframe}`);
  }
}

export default LiveMarketDataService;