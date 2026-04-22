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
 * Timeframe to Upstox interval mapping
 */
const TIMEFRAME_MAP: Record<Timeframe, string> = {
  '1m': '1minute',
  '5m': '5minute',
  '15m': '15minute',
  '1h': '1hour',
  '4h': '4hour',
  '1d': 'day',
  '1w': 'week',
};

/**
 * Upstox API base URLs
 */
const UPSTOX_API_BASE = 'https://api.upstox.com/v2';
const UPSTOX_AUTH_URL = 'https://api.upstox.com/v2/login/authorization/dialog';

/**
 * Upstox Feed class
 */
export class UpstoxFeed {
  private config: UpstoxConfig;
  private accessToken: string | null = null;
  private instruments: Map<string, UpstoxInstrument> = new Map();
  
  constructor(config: UpstoxConfig) {
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
    const response = await fetch(`${UPSTOX_API_BASE}/login/authorization/token`, {
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
    return this.accessToken !== null;
  }
  
  /**
   * Make authenticated API request
   */
  private async apiRequest<T = any>(endpoint: string, method: string = 'GET'): Promise<T> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call exchangeCode() first.');
    }
    
    const response = await fetch(`${UPSTOX_API_BASE}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }
    
    return response.json() as Promise<T>;
  }
  
  /**
   * Get historical candle data
   */
  async getHistoricalData(
    instrumentKey: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date
  ): Promise<Candle[]> {
    const interval = TIMEFRAME_MAP[timeframe];
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];
    
    const endpoint = `/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${to}/${from}`;
    
    const response = await this.apiRequest<{ data?: { candles?: any[][] } }>(endpoint);
    
    if (!response.data || !response.data.candles) {
      return [];
    }
    
    // Convert Upstox format to our Candle format
    // Upstox returns: [timestamp, open, high, low, close, volume, oi]
    return response.data.candles.map((c: any[]) => ({
      timestamp: new Date(c[0]).getTime(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5] || 0,
    })).reverse(); // Upstox returns newest first
  }
  
  /**
   * Get intraday candle data (today's data)
   */
  async getIntradayData(
    instrumentKey: string,
    timeframe: Timeframe
  ): Promise<Candle[]> {
    const interval = TIMEFRAME_MAP[timeframe];
    
    const endpoint = `/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${interval}`;
    
    const response = await this.apiRequest<{ data?: { candles?: any[][] } }>(endpoint);
    
    if (!response.data || !response.data.candles) {
      return [];
    }
    
    return response.data.candles.map((c: any[]) => ({
      timestamp: new Date(c[0]).getTime(),
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

