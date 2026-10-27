/**
 * Upstox API Feed
 * 
 * Integration with Upstox API for Indian market data:
 * - Historical OHLCV data (NSE, BSE, MCX)
 * - Real-time WebSocket feed
 * - Market status and trading hours
 * 
 * Requires Upstox account and API credentials.
 * Get API key from: https://developer.upstox.com/
 */
import { Candle, Timeframe } from '../types';
import { EventEmitter } from 'events';

/**
 * Upstox API configuration
 */
export interface UpstoxConfig {
  apiKey: string;
  apiSecret: string;
  redirectUri: string;
  accessToken?: string;
}

/**
 * Upstox instrument info
 */
export interface UpstoxInstrument {
  instrumentKey: string;      // e.g., "NSE_EQ|INE002A01018"
  symbol: string;             // e.g., "RELIANCE"
  exchange: 'NSE' | 'BSE' | 'MCX';
  segment: 'EQ' | 'FO' | 'CD' | 'COM';
  name: string;
  lotSize: number;
  tickSize: number;
  lastPrice?: number;
}

/**
 * Upstox OHLCV response format
 */
interface UpstoxOHLCV {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;  // Open Interest (for derivatives)
}

/**
 * WebSocket message types
 */
interface WSMessage {
  type: string;
  data?: any;
}

interface WSTickData {
  instrument_key: string;
  last_price: number;
  last_quantity: number;
  timestamp: number;
  oi?: number;
  depth?: {
    buy: Array<{ price: number; quantity: number; orders: number }>;
    sell: Array<{ price: number; quantity: number; orders: number }>;
  };
}

/**
 * Timeframe to Upstox interval mapping (V2 format)
 */
const TIMEFRAME_MAP_V2: Record<string, string> = {
  '1m': '1minute',
  '5m': '5minute',
  '15m': '15minute',
  '30m': '30minute',
  '1h': '1hour',
  '4h': '4hour',
  '1d': 'day',
  '1w': 'week',
};

/**
 * Timeframe to Upstox V3 unit/interval mapping
 * V3 uses separate unit and interval parameters
 * V3 supports:
 * - minutes: intervals 1 through 300 (1m, 5m, 15m, 30m, 60m, etc.)
 * - hours: intervals 1 through 5 (1h, 2h, 3h, 4h, 5h)
 * - days: interval 1
 * - weeks: interval 1
 * - months: interval 1
 */
export const TIMEFRAME_MAP_V3: Record<string, { unit: string; interval: string }> = {
  // Minutes (1-300)
  '1m': { unit: 'minutes', interval: '1' },
  '5m': { unit: 'minutes', interval: '5' },
  '15m': { unit: 'minutes', interval: '15' },
  '30m': { unit: 'minutes', interval: '30' },
  '1h': { unit: 'minutes', interval: '60' },  // 60 minutes = 1 hour
  // Hours (1-5)
  '2h': { unit: 'hours', interval: '2' },
  '3h': { unit: 'hours', interval: '3' },
  '4h': { unit: 'hours', interval: '4' },
  '5h': { unit: 'hours', interval: '5' },
  // Days, weeks, months (interval 1 only)
  '1d': { unit: 'days', interval: '1' },
  '1w': { unit: 'weeks', interval: '1' },
  '1mo': { unit: 'months', interval: '1' },
};

export const HISTORICAL_LIMITS: Record<string, { maxDays: number; unit: string; interval: string }> = {
  '1m':  { maxDays: 30,  unit: 'minutes', interval: '1' },
  '5m':  { maxDays: 30,  unit: 'minutes', interval: '5' },
  '15m': { maxDays: 30,  unit: 'minutes', interval: '15' },
  '30m': { maxDays: 90,  unit: 'minutes', interval: '30' },
  '1h':  { maxDays: 90,  unit: 'minutes', interval: '60' },
  '2h':  { maxDays: 90,  unit: 'hours', interval: '2' },
  '3h':  { maxDays: 90,  unit: 'hours', interval: '3' },
  '4h':  { maxDays: 90,  unit: 'hours', interval: '4' },
  '5h':  { maxDays: 90,  unit: 'hours', interval: '5' },
  '1d':  { maxDays: 3650, unit: 'days', interval: '1' },
  '1w':  { maxDays: 3650, unit: 'weeks', interval: '1' },
  '1mo': { maxDays: 3650, unit: 'months', interval: '1' },
};

/**
 * Upstox API base URLs
 */
export const UPSTOX_API_BASE_V2 = 'https://api.upstox.com/v2';
export const UPSTOX_API_BASE_V3 = 'https://api.upstox.com/v3';
export const UPSTOX_AUTH_URL = 'https://api.upstox.com/v2/login/authorization/dialog';
export const UPSTOX_WS_URL = 'wss://api.upstox.com/v2/feed/market-data-feed';

/**
 * WebSocket subscription modes
 */
export type WSMode = 'ltpc' | 'full' | 'full_d30' | 'option_greeks';

/**
 * WebSocket message types
 */
interface WSMessage {
  type: string;
  data?: any;
}

interface WSTickData {
  instrument_key: string;
  last_price: number;
  last_quantity: number;
  timestamp: number;
  oi?: number;
  depth?: {
    buy: Array<{ price: number; quantity: number; orders: number }>;
    sell: Array<{ price: number; quantity: number; orders: number }>;
  };
}

/**
 * Upstox Feed class
 */
export class UpstoxFeed extends EventEmitter {
  private config: UpstoxConfig;
  private accessToken: string | null = null;
  private instruments: Map<string, UpstoxInstrument> = new Map();
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private subscribedKeys: Set<string> = new Set(); // instrumentKey
  private subscribedModes: Map<string, WSMode> = new Map(); // instrumentKey -> mode
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;
  private wsUrl: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  constructor(config: UpstoxConfig) {
    super();
    this.config = config;
    this.accessToken = config.accessToken || null;
  }
  
  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.apiKey,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
    });
    
    return `${UPSTOX_AUTH_URL}?${params.toString()}`;
  }
  
  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(authCode: string): Promise<string> {
    const response = await fetch(`${UPSTOX_API_BASE_V2}/login/authorization/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        code: authCode,
        client_id: this.config.apiKey,
        client_secret: this.config.apiSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to exchange auth code: ${response.statusText}`);
    }
    
    const data = await response.json() as { access_token: string };
    this.accessToken = data.access_token;
    
    return this.accessToken;
  }
  
  /**
   * Set access token directly
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }
  
  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!this.accessToken;
  }
  
  /**
   * Make authenticated API request (V2 base)
   */
  private async apiRequest<T = any>(endpoint: string, method: string = 'GET'): Promise<T> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call exchangeCode() first.');
    }
    
    const response = await fetch(`${UPSTOX_API_BASE_V2}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${body}`);
    }
    
    return response.json() as Promise<T>;
  }
  
  /**
   * Make authenticated API request (V3 base for historical data)
   */
  private async apiRequestV3<T = any>(endpoint: string, method: string = 'GET'): Promise<T> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call exchangeCode() first.');
    }
    
    const response = await fetch(`${UPSTOX_API_BASE_V3}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`V3 API request failed: ${response.status} ${response.statusText} - ${body}`);
    }
    
    return response.json() as Promise<T>;
  }
  
  /**
   * Parse Upstox timestamp string to UTC epoch milliseconds.
   * Upstox returns naive IST timestamps (e.g., "2024-01-01 09:15:00").
   * This function handles:
   * - Naive timestamps (assumed IST): appends +05:30
   * - Timestamps with explicit offset (e.g., +05:30, Z): uses as-is
   * - Rejects malformed timestamps with clear error
   */
  private static parseUpstoxTimestamp(ts: string): number {
    const trimmed = ts.trim();
    
    // Check if timestamp already has explicit timezone (Z or +/-HH:MM)
    const hasExplicitZone = /[Zz]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed);
    const withZone = hasExplicitZone ? trimmed : `${trimmed}+05:30`;
    
    const epochMs = new Date(withZone).getTime();
    if (isNaN(epochMs)) {
      throw new Error(`Invalid Upstox timestamp: "${ts}"`);
    }
    return epochMs;
  }

  /**
   * Get historical candle data using V3 API
   * V3 endpoint: /historical-candle/:instrument_key/:unit/:interval/:to_date/:from_date
   * V3 supports: minutes (1-300), hours (1-5), days/weeks/months (1)
   * Historical limits per V3:
   * - minutes 1-15: 1 month
   * - minutes >15: 1 quarter
   * - hours: 1 quarter
   * - days: 1 decade
   * - weeks/months: no limit
   */
  /**
   * Get historical candle data, optionally merging with intraday data for current day
   * @param includeIntraday - If true and toDate is today (in IST), fetch and merge intraday data
   */
  async getHistoricalData(
    instrumentKey: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date,
    includeIntraday: boolean = false
  ): Promise<Candle[]> {
    // If includeIntraday is true and toDate is today (in IST), we need to merge
    if (includeIntraday) {
      return this.getHistoricalDataWithIntraday(instrumentKey, timeframe, fromDate, toDate);
    }
    
    const mapping = TIMEFRAME_MAP_V3[timeframe];
    if (!mapping) {
      throw new Error(`Unsupported timeframe for V3 API: ${timeframe}. Supported: ${Object.keys(TIMEFRAME_MAP_V3).join(', ')}`);
    }
    return this.getHistoricalDataV3(instrumentKey, timeframe, fromDate, toDate);
  }
  
  /**
   * Get historical data merged with intraday data for the current day
   * This is used when the replay end date is "now" to get the latest available candles
   */
  private async getHistoricalDataWithIntraday(
    instrumentKey: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date
  ): Promise<Candle[]> {
    // Determine if toDate is today in IST
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const toDateIST = new Date(toDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    
    const isToday = toDateIST.toDateString() === nowIST.toDateString()
    
    if (!isToday) {
      // If not today, just use historical endpoint
      return this.getHistoricalDataV3(instrumentKey, timeframe, fromDate, toDate)
    }
    
    // Fetch historical data up to yesterday (to avoid overlap)
    const yesterdayIST = new Date(nowIST)
    yesterdayIST.setDate(yesterdayIST.getDate() - 1)
    const yesterdayUTC = new Date(yesterdayIST.toLocaleString('en-US', { timeZone: 'UTC' }))
    
    let historicalCandles: Candle[] = []
    try {
      // Only fetch historical if fromDate is before today
      const fromDateIST = new Date(fromDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      if (fromDateIST < nowIST) {
        historicalCandles = await this.getHistoricalDataV3(instrumentKey, timeframe, fromDate, yesterdayUTC)
      }
    } catch (error) {
      console.warn('[UpstoxFeed] Historical data fetch failed, continuing with intraday only:', error)
    }
    
    // Fetch intraday data for today
    let intradayCandles: Candle[] = []
    try {
      intradayCandles = await this.getIntradayDataV3(instrumentKey, timeframe)
    } catch (error) {
      console.warn('[UpstoxFeed] Intraday data fetch failed, using historical only:', error)
    }
    
    // Merge and deduplicate
    const allCandles = [...historicalCandles, ...intradayCandles]
    
    // Sort by timestamp
    allCandles.sort((a, b) => a.timestamp - b.timestamp)
    
    // Deduplicate by timestamp (keep the last one)
    const deduped: Candle[] = []
    for (const c of allCandles) {
      if (deduped.length === 0 || deduped[deduped.length - 1].timestamp !== c.timestamp) {
        deduped.push(c)
      }
    }
    
    // Filter to requested range (fromDate to toDate)
    const filtered = deduped.filter(c => c.timestamp >= fromDate.getTime() && c.timestamp <= toDate.getTime())
    
    return filtered
  }
  
  private async getHistoricalDataV3(
    instrumentKey: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date
  ): Promise<Candle[]> {
    const mapping = TIMEFRAME_MAP_V3[timeframe];
    if (!mapping) {
      throw new Error(`Unsupported timeframe for V3 API: ${timeframe}`);
    }
    const { unit, interval } = mapping;
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];
    const endpoint = `/historical-candle/${encodeURIComponent(instrumentKey)}/${unit}/${interval}/${to}/${from}`;
    const response = await this.apiRequestV3<{ data?: { candles?: any[][] } }>(endpoint);
    if (!response.data || !response.data.candles) {
      return [];
    }
    return response.data.candles.map((c: any[]) => ({
      timestamp: UpstoxFeed.parseUpstoxTimestamp(c[0]),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5] || 0,
    })).reverse();
  }

  /**
   * Get historical candle data using legacy V2 API (fallback)
   */
  async getHistoricalDataV2(
    instrumentKey: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date
  ): Promise<Candle[]> {
    const interval = TIMEFRAME_MAP_V2[timeframe];
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];
    
    const endpoint = `/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${to}/${from}`;
    
    const response = await this.apiRequest<{ data?: { candles?: any[][] } }>(endpoint);
    
    if (!response.data || !response.data.candles) {
      return [];
    }
    
return response.data.candles.map((c: any[]) => ({
      timestamp: UpstoxFeed.parseUpstoxTimestamp(c[0]),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5] || 0,
    })).reverse();
  }

  /**
   * Get intraday candle data (today's data) using V3 API
   * Uses the V3 intraday endpoint for current-day data
   */
  async getIntradayDataV3(
    instrumentKey: string,
    timeframe: Timeframe
  ): Promise<Candle[]> {
    const mapping = TIMEFRAME_MAP_V3[timeframe];
    if (!mapping) {
      throw new Error(`Unsupported timeframe for V3 intraday API: ${timeframe}`);
    }
    const { unit, interval } = mapping;
    const endpoint = `/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${unit}/${interval}`;
    const response = await this.apiRequestV3<{ data?: { candles?: any[][] } }>(endpoint);
    if (!response.data || !response.data.candles) {
      return [];
    }
    return response.data.candles.map((c: any[]) => ({
      timestamp: UpstoxFeed.parseUpstoxTimestamp(c[0]),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5] || 0,
    })).reverse();
  }
  
  /**
   * Get intraday candle data using legacy V2 API
   */
  async getIntradayDataV2(
    instrumentKey: string,
    timeframe: Timeframe
  ): Promise<Candle[]> {
    const interval = TIMEFRAME_MAP_V2[timeframe];
    
    const endpoint = `/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${interval}`;
    
    const response = await this.apiRequest<{ data?: { candles?: any[][] } }>(endpoint);
    
    if (!response.data || !response.data.candles) {
      return [];
    }
    
return response.data.candles.map((c: any[]) => ({
      timestamp: UpstoxFeed.parseUpstoxTimestamp(c[0]),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5] || 0,
    })).reverse();
  }

  /**
   * Get market quote (current price)
   */
  async getQuote(instrumentKey: string): Promise<{
    lastPrice: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> {
    const endpoint = `/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKey)}`;
    
    const response = await this.apiRequest(endpoint);
    
    const quote = response.data[instrumentKey];
    if (!quote) {
      throw new Error(`Quote not found for ${instrumentKey}`);
    }
    
    return {
      lastPrice: quote.last_price,
      open: quote.ohlc.open,
      high: quote.ohlc.high,
      low: quote.ohlc.low,
      close: quote.ohlc.close,
      volume: quote.volume,
    };
  }
  
  /**
   * Get market status
   */
  async getMarketStatus(): Promise<{
    exchange: string;
    status: 'OPEN' | 'CLOSED';
  }[]> {
    const endpoint = '/market/status';
    const response = await this.apiRequest(endpoint);
    
    return response.data.map((m: any) => ({
      exchange: m.exchange,
      status: m.status === 'Open' ? 'OPEN' : 'CLOSED',
    }));
  }
  
  /**
   * Search for instruments
   */
  async searchInstruments(query: string, exchange?: string): Promise<UpstoxInstrument[]> {
    // Note: Upstox requires downloading the full instrument list
    // This is a simplified search implementation
    let endpoint = `/instrument/search?query=${encodeURIComponent(query)}`;
    if (exchange) {
      endpoint += `&exchange=${exchange}`;
    }
    
    const response = await this.apiRequest(endpoint);
    
    return response.data.map((i: any) => ({
      instrumentKey: i.instrument_key,
      symbol: i.trading_symbol,
      exchange: i.exchange,
      segment: i.segment,
      name: i.name,
      lotSize: i.lot_size || 1,
      tickSize: i.tick_size || 0.05,
    }));
  }
  
  /**
   * Get popular NSE stocks instrument keys
   */
  getPopularNSEStocks(): Record<string, string> {
    return {
      'RELIANCE': 'NSE_EQ|INE002A01018',
      'TCS': 'NSE_EQ|INE467B01029',
      'INFY': 'NSE_EQ|INE009A01021',
      'HDFCBANK': 'NSE_EQ|INE040A01034',
      'ICICIBANK': 'NSE_EQ|INE090A01021',
      'SBIN': 'NSE_EQ|INE062A01020',
      'BHARTIARTL': 'NSE_EQ|INE397D01024',
      'ITC': 'NSE_EQ|INE154A01025',
      'KOTAKBANK': 'NSE_EQ|INE237A01028',
      'LT': 'NSE_EQ|INE018A01030',
      'HINDUNILVR': 'NSE_EQ|INE030A01027',
      'AXISBANK': 'NSE_EQ|INE238A01034',
      'MARUTI': 'NSE_EQ|INE585B01010',
      'BAJFINANCE': 'NSE_EQ|INE296A01024',
      'TATAMOTORS': 'NSE_EQ|INE155A01022',
      'NIFTY50': 'NSE_INDEX|Nifty 50',
      'NIFTY': 'NSE_INDEX|Nifty 50',
    };
  }
  
  /**
   * Get popular MCX commodities instrument keys
   */
  getPopularMCXCommodities(): Record<string, string> {
    // Note: MCX instrument keys change based on expiry
    // These are placeholders - you need to fetch current contracts
    return {
      'GOLD': 'MCX_FO|GOLD',       // Need to append expiry
      'SILVER': 'MCX_FO|SILVER',
      'CRUDEOIL': 'MCX_FO|CRUDEOIL',
      'NATURALGAS': 'MCX_FO|NATURALGAS',
      'COPPER': 'MCX_FO|COPPER',
    };
  }
  
  /**
   * Get index instrument keys
   */
  getIndexKeys(): Record<string, string> {
    return {
      'NIFTY50': 'NSE_INDEX|Nifty 50',
      'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
      'NIFTYIT': 'NSE_INDEX|Nifty IT',
      'NIFTYMIDCAP': 'NSE_INDEX|NIFTY MIDCAP 100',
    };
  }

  /**
   * Connect to Upstox WebSocket for real-time market data
   */
  async connectWebSocket(): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call exchangeCode() or setAccessToken() first.');
    }

    if (this.wsConnected && this.ws) {
      console.log('[UpstoxFeed] WebSocket already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Upstox WebSocket URL with authorization
        const wsUrl = `${UPSTOX_WS_URL}?authorization=${this.accessToken}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[UpstoxFeed] WebSocket connected');
          this.wsConnected = true;
          this.reconnectAttempts = 0;
          
          // Resubscribe to previously subscribed instruments
          if (this.subscribedKeys.size > 0) {
            this.subscribeToInstruments(Array.from(this.subscribedKeys), 'full');
          }
          
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('[UpstoxFeed] Error parsing WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[UpstoxFeed] WebSocket error:', error);
          this.emit('error', error);
        };

        this.ws.onclose = (event) => {
          console.log('[UpstoxFeed] WebSocket closed:', event.code, event.reason);
          this.wsConnected = false;
          this.ws = null;
          this.emit('disconnected', event);
          
          // Attempt reconnection
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[UpstoxFeed] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
          } else {
            console.error('[UpstoxFeed] Max reconnection attempts reached');
            this.emit('reconnect_failed');
          }
        };

        // Timeout for connection
        setTimeout(() => {
          if (!this.wsConnected) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Subscribe to real-time market data for instruments
   */
  subscribeToInstruments(instrumentKeys: string[], mode: WSMode = 'full'): void {
    if (!this.wsConnected || !this.ws) {
      console.warn('[UpstoxFeed] WebSocket not connected. Call connectWebSocket() first.');
      return;
    }

    const newKeys = instrumentKeys.filter(key => !this.subscribedKeys.has(key));
    if (newKeys.length === 0) return;

    // Upstox WebSocket subscription format
    const message = {
      method: 'subscribe',
      instruments: newKeys.map(key => ({
        instrument_key: key,
        mode: mode
      }))
    };

    this.ws!.send(JSON.stringify(message));
    
    for (const key of newKeys) {
      this.subscribedKeys.add(key);
      this.subscribedModes.set(key, mode);
    }
    
    console.log(`[UpstoxFeed] Subscribed to ${newKeys.length} instruments in ${mode} mode`);
  }

  /**
   * Unsubscribe from instruments
   */
  unsubscribeFromInstruments(instrumentKeys: string[]): void {
    if (!this.wsConnected || !this.ws) return;

    const message = {
      method: 'unsubscribe',
      instruments: instrumentKeys.map(key => ({
        instrument_key: key
      }))
    };

    this.ws!.send(JSON.stringify(message));
    
    for (const key of instrumentKeys) {
      this.subscribedKeys.delete(key);
      this.subscribedModes.delete(key);
    }
    
    console.log(`[UpstoxFeed] Unsubscribed from ${instrumentKeys.length} instruments`);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(message: any): void {
    // Handle different message types from Upstox
    switch (message.type) {
      case 'tick':
      case 'ltpc':
      case 'full':
        if (message.data) {
          this.handleTickData(message.data);
        }
        break;
      case 'subscribe':
      case 'unsubscribe':
        console.log(`[UpstoxFeed] ${message.type} acknowledged:`, message.data);
        break;
      case 'error':
        console.error('[UpstoxFeed] WebSocket error message:', message.data);
        this.emit('error', new Error(message.data?.message || 'Unknown error'));
        break;
      default:
        // Handle direct tick data (Upstox sends tick data directly)
        if (message.instrument_key || message.data?.instrument_key) {
          this.handleTickData(message.data || message);
        }
    }
  }

  /**
   * Handle tick data and emit events
   */
  private handleTickData(data: WSTickData): void {
    const tick = {
      instrumentKey: data.instrument_key,
      lastPrice: data.last_price,
      lastQuantity: data.last_quantity,
      timestamp: data.timestamp,
      oi: data.oi,
      depth: data.depth,
    };

    // Emit tick event for real-time processing
    this.emit('tick', tick);
    
    // Also emit symbol-specific event
    this.emit(`tick:${data.instrument_key}`, tick);
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this.wsConnected = false;
      console.log('[UpstoxFeed] WebSocket disconnected');
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isWebSocketConnected(): boolean {
    return this.wsConnected && this.ws !== null;
  }

  /**
   * Get subscribed instrument keys
   */
  getSubscribedKeys(): string[] {
    return Array.from(this.subscribedKeys);
  }

  /**
   * Get subscribed instrument keys with their modes
   */
  getSubscribedKeysWithModes(): Map<string, WSMode> {
    return new Map(this.subscribedModes);
  }
}

/**
 * Create Upstox feed from environment variables
 */
export function createUpstoxFeedFromEnv(): UpstoxFeed {
  const apiKey = process.env.UPSTOX_API_KEY;
  const apiSecret = process.env.UPSTOX_API_SECRET;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI || 'http://localhost:3000/callback';
  const accessToken = process.env.UPSTOX_ACCESS_TOKEN;
  
  if (!apiKey || !apiSecret) {
    throw new Error('UPSTOX_API_KEY and UPSTOX_API_SECRET environment variables required');
  }
  
  return new UpstoxFeed({
    apiKey,
    apiSecret,
    redirectUri,
    accessToken,
  });
}

export default UpstoxFeed;

