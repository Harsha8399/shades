/**
 * Angel One SmartAPI Adapter
 * 
 * Full integration with Angel One's SmartAPI for:
 * - Authentication with TOTP (2FA)
 * - Historical candle data
 * - Real-time WebSocket market feed
 * - Order placement (for future use)
 * 
 * Prerequisites:
 * 1. Angel One trading account with SmartAPI access
 * 2. API Key from smartapi.angelone.in
 * 3. TOTP secret for 2FA
 * 4. Static IP registered (for live trading)
 * 
 * @see https://smartapi.angelone.in/docs
 */
import { Candle, Timeframe } from '../types';
import { BrokerAdapter, BrokerCredentials, BaseNseAdapter } from './NseAdapter';
import { retry, CircuitBreaker, RateLimiter, RetryResult } from '../utils/retry';

// Import SmartAPI SDK
let SmartAPI: any;
try {
  SmartAPI = require('smartapi-javascript').SmartAPI;
} catch (e) {
  console.warn('[AngelOne] SmartAPI SDK not installed. Run: npm install smartapi-javascript');
}

// Import TOTP generator
let totp: any;
try {
  totp = require('totp-generator').default || require('totp-generator');
} catch (e) {
  console.warn('[AngelOne] totp-generator not installed. Run: npm install totp-generator');
}

/**
 * Angel One credentials
 */
export interface AngelOneCredentials extends BrokerCredentials {
  apiKey: string;
  clientId: string;
  password: string;
  totpSecret: string;
}

/**
 * Angel One session data
 */
interface AngelOneSession {
  jwtToken: string;
  refreshToken: string;
  feedToken: string;
  clientCode: string;
}

/**
 * Symbol token mapping for Angel One
 * These are required for API calls (not the trading symbol)
 */
export interface SymbolToken {
  symbol: string;
  token: string;
  exchange: 'NSE' | 'BSE' | 'NFO' | 'MCX';
  symbolType: 'EQ' | 'FUTSTK' | 'FUTIDX' | 'OPTSTK' | 'OPTIDX';
}

/**
 * Timeframe to Angel One interval mapping
 */
const INTERVAL_MAP: Record<string, string> = {
  '1m': 'ONE_MINUTE',
  '3m': 'THREE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '10m': 'TEN_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '1h': 'ONE_HOUR',
  '1d': 'ONE_DAY',
};

/**
 * Popular NSE stock tokens (symbol -> token)
 * These are static for equity stocks
 */
export const NSE_STOCK_TOKENS: Record<string, string> = {
  'RELIANCE': '2885',
  'TCS': '11536',
  'HDFCBANK': '1333',
  'INFY': '1594',
  'ICICIBANK': '4963',
  'HINDUNILVR': '1394',
  'SBIN': '3045',
  'BHARTIARTL': '10604',
  'KOTAKBANK': '1922',
  'ITC': '1660',
  'LT': '11483',
  'HCLTECH': '7229',
  'AXISBANK': '5900',
  'MARUTI': '10999',
  'ASIANPAINT': '236',
  'TITAN': '3506',
  'BAJFINANCE': '317',
  'SUNPHARMA': '3351',
  'TATAMOTORS': '3456',
  'WIPRO': '3787',
  'NESTLEIND': '17963',
  'TECHM': '13538',
  'NTPC': '11630',
  'POWERGRID': '14977',
  'ONGC': '2475',
  'COALINDIA': '20374',
  'JSWSTEEL': '11723',
  'TATASTEEL': '3499',
  'INDUSINDBK': '5258',
  'BRITANNIA': '547',
  'M&M': '2031',
  'DRREDDY': '881',
  'CIPLA': '694',
  'BPCL': '526',
  'ADANIENT': '25',
  'ADANIPORTS': '15083',
};

/**
 * Index tokens
 */
export const INDEX_TOKENS: Record<string, string> = {
  'NIFTY': '99926000',
  'BANKNIFTY': '99926009',
  'NIFTYIT': '99926013',
};

/**
 * Angel One SmartAPI Adapter
 */
export class AngelOneAdapter extends BaseNseAdapter {
  private smartApi: any = null;
  private session: AngelOneSession | null = null;
  private credentials: AngelOneCredentials | null = null;
  private wsClient: any = null;
  private candleBuffer: Map<string, Candle[]> = new Map();
  private priceCallbacks: Map<string, (candle: Candle) => void> = new Map();
  
  // Error handling components
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  
  constructor() {
    super();
    
    if (!SmartAPI) {
      console.error('[AngelOne] SmartAPI SDK not available');
    }
    
    // Initialize circuit breaker: opens after 5 failures, resets after 60s
    this.circuitBreaker = new CircuitBreaker(5, 60000, 3);
    
    // Initialize rate limiter: 10 requests per second (Angel One limit)
    this.rateLimiter = new RateLimiter(10, 10);
  }
  
  /**
   * Connect to Angel One API
   */
  async connect(): Promise<void> {
    if (!this.credentials) {
      throw new Error('Credentials not set. Call authenticate() first.');
    }
    
    if (!SmartAPI) {
      throw new Error('SmartAPI SDK not installed. Run: npm install smartapi-javascript');
    }
    
    try {
      // Initialize SmartAPI client
      this.smartApi = new SmartAPI({
        api_key: this.credentials.apiKey,
        client_code: this.credentials.clientId,
        totp: this.generateTOTP(),
        password: this.credentials.password,
      });
      
      // Generate session
      const sessionData = await this.smartApi.generateSession(
        this.credentials.clientId,
        this.credentials.password,
        this.generateTOTP()
      );
      
      if (sessionData.status === false) {
        throw new Error(sessionData.message || 'Failed to generate session');
      }
      
      this.session = {
        jwtToken: sessionData.data.jwtToken,
        refreshToken: sessionData.data.refreshToken,
        feedToken: sessionData.data.feedToken,
        clientCode: this.credentials.clientId,
      };
      
      this.connected = true;
      console.log('[AngelOne] Connected successfully');
      console.log(`[AngelOne] Client: ${this.credentials.clientId}`);
      
    } catch (error: any) {
      console.error('[AngelOne] Connection failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Disconnect from API
   */
  async disconnect(): Promise<void> {
    try {
      if (this.smartApi && this.session) {
        await this.smartApi.logout({ clientcode: this.session.clientCode });
      }
      
      if (this.wsClient) {
        this.wsClient.close();
        this.wsClient = null;
      }
      
      this.session = null;
      this.connected = false;
      console.log('[AngelOne] Disconnected');
      
    } catch (error: any) {
      console.error('[AngelOne] Disconnect error:', error.message);
    }
  }
  
  /**
   * Authenticate with credentials
   */
  async authenticate(credentials: BrokerCredentials): Promise<boolean> {
    const angelCreds = credentials as AngelOneCredentials;
    
    if (!angelCreds.apiKey || !angelCreds.clientId || !angelCreds.password || !angelCreds.totpSecret) {
      throw new Error('Missing required credentials: apiKey, clientId, password, totpSecret');
    }
    
    this.credentials = angelCreds;
    
    try {
      await this.connect();
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Refresh session token
   */
  async refreshToken(): Promise<void> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    try {
      const tokenData = await this.smartApi.generateToken({
        refreshToken: this.session.refreshToken,
      });
      
      if (tokenData.status === false) {
        throw new Error('Token refresh failed');
      }
      
      this.session.jwtToken = tokenData.data.jwtToken;
      this.session.refreshToken = tokenData.data.refreshToken;
      
      console.log('[AngelOne] Token refreshed');
      
    } catch (error: any) {
      console.error('[AngelOne] Token refresh failed:', error.message);
      // Try to reconnect
      await this.connect();
    }
  }
  
  /**
   * Generate TOTP code
   */
  private generateTOTP(): string {
    if (!totp) {
      throw new Error('totp-generator not installed');
    }
    
    if (!this.credentials?.totpSecret) {
      throw new Error('TOTP secret not configured');
    }
    
    return totp(this.credentials.totpSecret);
  }
  
  /**
   * Get symbol token
   */
  getSymbolToken(symbol: string, exchange: string = 'NSE'): string {
    const upperSymbol = symbol.toUpperCase();
    
    // Check in stock tokens
    if (NSE_STOCK_TOKENS[upperSymbol]) {
      return NSE_STOCK_TOKENS[upperSymbol];
    }
    
    // Check in index tokens
    if (INDEX_TOKENS[upperSymbol]) {
      return INDEX_TOKENS[upperSymbol];
    }
    
    throw new Error(`Symbol token not found for ${symbol}. Add it to NSE_STOCK_TOKENS.`);
  }
  
  /**
   * Get historical candle data (with retry and rate limiting)
   */
  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    const interval = INTERVAL_MAP[timeframe];
    if (!interval) {
      throw new Error(`Unsupported timeframe: ${timeframe}`);
    }
    
    const symbolToken = this.getSymbolToken(symbol);
    const exchange = symbol.toUpperCase() in INDEX_TOKENS ? 'NSE' : 'NSE';
    
    // Format dates for Angel One API
    const fromDate = this.formatDate(from);
    const toDate = this.formatDate(to);
    
    // Use circuit breaker and retry
    return this.circuitBreaker.execute(async () => {
      // Rate limit
      await this.rateLimiter.acquire();
      
      // Retry with exponential backoff
      const result = await retry(async () => {
        const response = await this.smartApi.getCandleData({
          exchange: exchange,
          symboltoken: symbolToken,
          interval: interval,
          fromdate: fromDate,
          todate: toDate,
        });
        
        if (response.status === false) {
          throw new Error(response.message || 'Failed to fetch candle data');
        }
        
        return response;
      }, { maxRetries: 3 });
      
      if (!result.success || !result.result) {
        throw result.error || new Error('Failed to fetch candle data');
      }
      
      // Convert to our Candle format
      const candles: Candle[] = result.result.data.map((c: any[]) => ({
        timestamp: new Date(c[0]).getTime(),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5] || 0,
      }));
      
      console.log(`[AngelOne] Fetched ${candles.length} candles for ${symbol}`);
      
      return candles;
    });
  }
  
  /**
   * Get latest candle (current price)
   */
  async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    try {
      const symbolToken = this.getSymbolToken(symbol);
      const exchange = symbol.toUpperCase() in INDEX_TOKENS ? 'NSE' : 'NSE';
      
      const response = await this.smartApi.ltpData(exchange, symbol, symbolToken);
      
      if (response.status === false) {
        return null;
      }
      
      const ltp = response.data.ltp;
      
      // Create a basic candle from LTP
      return {
        timestamp: Date.now(),
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: 0,
      };
      
    } catch (error: any) {
      console.error(`[AngelOne] Failed to get LTP: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Get full quote (with retry and rate limiting)
   */
  async getQuote(symbol: string): Promise<{
    ltp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    change: number;
    changePercent: number;
  } | null> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    try {
      // Rate limit
      await this.rateLimiter.acquire();
      
      const symbolToken = this.getSymbolToken(symbol);
      const exchange = symbol.toUpperCase() in INDEX_TOKENS ? 'NSE' : 'NSE';
      
      // Retry with shorter timeout for quotes
      const result = await retry(async () => {
        const response = await this.smartApi.getQuote({
          mode: 'FULL',
          exchangeTokens: {
            [exchange]: [symbolToken],
          },
        });
        
        if (response.status === false) {
          throw new Error(response.message || 'Failed to get quote');
        }
        
        return response;
      }, { maxRetries: 2, baseDelayMs: 500 });
      
      if (!result.success || !result.result?.data?.fetched?.[0]) {
        return null;
      }
      
      const quote = result.result.data.fetched[0];
      
      return {
        ltp: quote.ltp,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        volume: quote.totalTradedVolume,
        change: quote.netChange,
        changePercent: quote.percentChange,
      };
      
    } catch (error: any) {
      console.error(`[AngelOne] Failed to get quote: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Get circuit breaker state
   */
  getCircuitState(): string {
    return this.circuitBreaker.getState();
  }
  
  /**
   * Reset circuit breaker (for manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log('[AngelOne] Circuit breaker reset');
  }
  
  /**
   * Subscribe to real-time price updates via WebSocket
   */
  subscribeToFeed(
    symbols: string[],
    onPrice: (symbol: string, candle: Candle) => void
  ): void {
    if (!this.session) {
      throw new Error('Not connected');
    }
    
    // Store callbacks
    for (const symbol of symbols) {
      this.priceCallbacks.set(symbol, (candle) => onPrice(symbol, candle));
    }
    
    // Note: Angel One WebSocket requires their specific SDK setup
    // This is a simplified implementation
    console.log(`[AngelOne] Subscribed to ${symbols.length} symbols`);
    console.log('[AngelOne] Note: For real WebSocket, use SmartWebSocket SDK');
    
    // For now, use polling as fallback
    this.startPolling(symbols);
  }
  
  /**
   * Polling fallback for price updates
   */
  private startPolling(symbols: string[], intervalMs: number = 5000): void {
    const pollInterval = setInterval(async () => {
      if (!this.connected) {
        clearInterval(pollInterval);
        return;
      }
      
      for (const symbol of symbols) {
        try {
          const candle = await this.getLatestCandle(symbol, '1m');
          const callback = this.priceCallbacks.get(symbol);
          
          if (candle && callback) {
            callback(candle);
          }
        } catch (error) {
          // Ignore errors in polling
        }
      }
    }, intervalMs);
  }
  
  /**
   * Format date for Angel One API
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
  
  /**
   * Get user profile
   */
  async getProfile(): Promise<any> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    try {
      const response = await this.smartApi.getProfile();
      return response.data;
    } catch (error: any) {
      console.error(`[AngelOne] Failed to get profile: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get funds and margin
   */
  async getFunds(): Promise<any> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    try {
      const response = await this.smartApi.getRMS();
      return response.data;
    } catch (error: any) {
      console.error(`[AngelOne] Failed to get funds: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Place order (for future use - NOT for current paper trading)
   */
  async placeOrder(params: {
    symbol: string;
    exchange: string;
    transactionType: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
    productType: 'INTRADAY' | 'DELIVERY' | 'MARGIN';
    quantity: number;
    price?: number;
    triggerPrice?: number;
  }): Promise<{ orderId: string } | null> {
    if (!this.smartApi || !this.session) {
      throw new Error('Not connected');
    }
    
    // Safety check - don't allow orders in current version
    console.warn('[AngelOne] Order placement is disabled in paper trading mode');
    console.warn('[AngelOne] Enable only after thorough testing');
    
    return null;
    
    /*
    // Uncomment for live trading (AFTER TESTING)
    try {
      const symbolToken = this.getSymbolToken(params.symbol);
      
      const orderParams = {
        variety: 'NORMAL',
        tradingsymbol: params.symbol,
        symboltoken: symbolToken,
        transactiontype: params.transactionType,
        exchange: params.exchange,
        ordertype: params.orderType,
        producttype: params.productType,
        duration: 'DAY',
        price: params.price || 0,
        triggerprice: params.triggerPrice || 0,
        quantity: params.quantity,
      };
      
      const response = await this.smartApi.placeOrder(orderParams);
      
      if (response.status === false) {
        throw new Error(response.message || 'Order placement failed');
      }
      
      return { orderId: response.data.orderid };
      
    } catch (error: any) {
      console.error(`[AngelOne] Order failed: ${error.message}`);
      throw error;
    }
    */
  }
}

/**
 * Create Angel One adapter from environment variables
 */
export function createAngelOneFromEnv(): AngelOneAdapter {
  const apiKey = process.env.ANGELONE_API_KEY;
  const clientId = process.env.ANGELONE_CLIENT_ID;
  const password = process.env.ANGELONE_PASSWORD;
  const totpSecret = process.env.ANGELONE_TOTP_SECRET;
  
  if (!apiKey || !clientId || !password || !totpSecret) {
    throw new Error(
      'Missing Angel One credentials. Set ANGELONE_API_KEY, ANGELONE_CLIENT_ID, ' +
      'ANGELONE_PASSWORD, and ANGELONE_TOTP_SECRET environment variables.'
    );
  }
  
  const adapter = new AngelOneAdapter();
  adapter.authenticate({
    apiKey,
    clientId,
    userId: clientId,
    password,
    totpSecret,
  } as AngelOneCredentials);
  
  return adapter;
}

export default AngelOneAdapter;

