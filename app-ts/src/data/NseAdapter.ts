/**
 * NSE Broker Adapter
 * 
 * Abstract interface for connecting to Indian stock brokers.
 * Implementations can be created for:
 * - Shoonya (Finvasia) - Free API
 * - Angel One (SmartAPI) - Free for clients
 * - Fyers - Good documentation
 * - Zerodha (Kite Connect) - Rs 2000/month
 * 
 * This module provides:
 * 1. Abstract BrokerAdapter interface
 * 2. Market gap handling for NSE (9:15 AM - 3:30 PM)
 * 3. 75-minute candle support (NSE-specific)
 */
import { Candle, Timeframe } from '../types';
import { IndianMarketCalendar } from './IndianMarketCalendar';

/**
 * Broker adapter interface
 */
export interface BrokerAdapter {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Authentication
  authenticate(credentials: BrokerCredentials): Promise<boolean>;
  refreshToken(): Promise<void>;
  
  // Data
  subscribe(symbol: string, timeframe: Timeframe): void;
  unsubscribe(symbol: string): void;
  getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
  getHistoricalData(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Candle[]>;
  
  // Orders (for future live trading)
  // placeOrder(order: Order): Promise<OrderResult>;
  // cancelOrder(orderId: string): Promise<boolean>;
  // getPositions(): Promise<Position[]>;
}

/**
 * Broker credentials
 */
export interface BrokerCredentials {
  apiKey: string;
  apiSecret?: string;
  userId?: string;
  password?: string;
  totp?: string;  // For 2FA
}

/**
 * Market session info
 */
export interface MarketSession {
  isOpen: boolean;
  currentSession: 'PRE_OPEN' | 'TRADING' | 'POST_CLOSE' | 'CLOSED';
  nextOpenTime?: Date;
  lastClosePrice?: number;
  todayOpenPrice?: number;
  gapPercent?: number;
}

/**
 * NSE-specific timeframes
 * NSE trading day is 375 minutes (9:15 AM - 3:30 PM)
 */
export const NSE_TIMEFRAMES = {
  '5m': 5,
  '15m': 15,
  '75m': 75,   // 5 candles per day (popular in India)
  '1h': 60,
  '1d': 375,   // Full trading day
} as const;

/**
 * Gap detection for overnight gaps
 */
export interface GapInfo {
  hasGap: boolean;
  gapType: 'UP' | 'DOWN' | 'NONE';
  gapPercent: number;
  previousClose: number;
  currentOpen: number;
}

/**
 * Base NSE Adapter with common functionality
 */
export abstract class BaseNseAdapter implements BrokerAdapter {
  protected connected: boolean = false;
  protected calendar: IndianMarketCalendar;
  protected subscriptions: Map<string, Timeframe[]> = new Map();
  protected lastPrices: Map<string, number> = new Map();
  
  constructor() {
    this.calendar = new IndianMarketCalendar('NSE');
  }
  
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract authenticate(credentials: BrokerCredentials): Promise<boolean>;
  abstract refreshToken(): Promise<void>;
  abstract getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
  abstract getHistoricalData(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Candle[]>;
  
  isConnected(): boolean {
    return this.connected;
  }
  
  subscribe(symbol: string, timeframe: Timeframe): void {
    const subs = this.subscriptions.get(symbol) || [];
    if (!subs.includes(timeframe)) {
      subs.push(timeframe);
      this.subscriptions.set(symbol, subs);
    }
  }
  
  unsubscribe(symbol: string): void {
    this.subscriptions.delete(symbol);
    this.lastPrices.delete(symbol);
  }
  
  /**
   * Get current market session info
   */
  getMarketSession(): MarketSession {
    const status = this.calendar.getMarketStatus();
    
    return {
      isOpen: status.isOpen,
      currentSession: status.session,
      nextOpenTime: status.timeUntilOpen 
        ? new Date(Date.now() + (status.timeUntilOpen.hours * 3600000) + (status.timeUntilOpen.minutes * 60000))
        : undefined,
    };
  }
  
  /**
   * Detect gap between previous close and current open
   */
  detectGap(previousClose: number, currentOpen: number): GapInfo {
    const gapPercent = ((currentOpen - previousClose) / previousClose) * 100;
    const hasGap = Math.abs(gapPercent) > 0.5;  // Consider >0.5% as a gap
    
    let gapType: 'UP' | 'DOWN' | 'NONE' = 'NONE';
    if (gapPercent > 0.5) gapType = 'UP';
    else if (gapPercent < -0.5) gapType = 'DOWN';
    
    return {
      hasGap,
      gapType,
      gapPercent,
      previousClose,
      currentOpen,
    };
  }
  
  /**
   * Check if candle is first candle of the day (9:15 AM)
   */
  isFirstCandleOfDay(candle: Candle): boolean {
    const date = new Date(candle.timestamp);
    return date.getHours() === 9 && date.getMinutes() <= 15;
  }
  
  /**
   * Check if candle is last candle of the day (3:30 PM)
   */
  isLastCandleOfDay(candle: Candle, timeframeMinutes: number): boolean {
    const date = new Date(candle.timestamp);
    const endTime = 15 * 60 + 30;  // 3:30 PM in minutes
    const candleEndMinutes = date.getHours() * 60 + date.getMinutes() + timeframeMinutes;
    
    return candleEndMinutes >= endTime;
  }
  
  /**
   * Add gap info to candle notes (for first candle of day)
   */
  annotateGap(candle: Candle, previousDayClose: number): Candle & { gap?: GapInfo } {
    if (!this.isFirstCandleOfDay(candle)) {
      return candle;
    }
    
    const gap = this.detectGap(previousDayClose, candle.open);
    
    return {
      ...candle,
      gap,
    };
  }
}

/**
 * Mock adapter for testing (no real broker connection)
 */
export class MockNseAdapter extends BaseNseAdapter {
  private mockData: Map<string, Candle[]> = new Map();
  
  async connect(): Promise<void> {
    console.log('[MockNseAdapter] Connected (mock mode)');
    this.connected = true;
  }
  
  async disconnect(): Promise<void> {
    console.log('[MockNseAdapter] Disconnected');
    this.connected = false;
  }
  
  async authenticate(credentials: BrokerCredentials): Promise<boolean> {
    console.log('[MockNseAdapter] Authenticated (mock mode)');
    return true;
  }
  
  async refreshToken(): Promise<void> {
    console.log('[MockNseAdapter] Token refreshed (mock mode)');
  }
  
  async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null> {
    const data = this.mockData.get(symbol);
    if (!data || data.length === 0) return null;
    return data[data.length - 1];
  }
  
  async getHistoricalData(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Candle[]> {
    const data = this.mockData.get(symbol) || [];
    return data.filter(c => {
      const ts = new Date(c.timestamp);
      return ts >= from && ts <= to;
    });
  }
  
  /**
   * Load mock data from CSV (for testing)
   */
  loadMockData(symbol: string, candles: Candle[]): void {
    this.mockData.set(symbol, candles);
  }
}

/**
 * Shoonya (Finvasia) Adapter Skeleton
 * 
 * To implement:
 * 1. npm install shoonya-api (or use their Python SDK via child process)
 * 2. Implement connect() with WebSocket
 * 3. Implement getHistoricalData() with their REST API
 */
export class ShoonyaAdapter extends BaseNseAdapter {
  private apiKey: string = '';
  private userId: string = '';
  private sessionToken: string = '';
  
  async connect(): Promise<void> {
    // TODO: Implement Shoonya WebSocket connection
    // Reference: https://github.com/Shoonya-Dev/ShoonyaApi-py
    throw new Error('ShoonyaAdapter not yet implemented. Use MockNseAdapter for testing.');
  }
  
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  
  async authenticate(credentials: BrokerCredentials): Promise<boolean> {
    this.apiKey = credentials.apiKey;
    this.userId = credentials.userId || '';
    
    // TODO: Call Shoonya login API
    // POST https://api.shoonya.com/NorenWClientTP/QuickAuth
    
    throw new Error('ShoonyaAdapter authentication not yet implemented');
  }
  
  async refreshToken(): Promise<void> {
    // Shoonya tokens are valid for the trading day
    throw new Error('ShoonyaAdapter refreshToken not yet implemented');
  }
  
  async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null> {
    // TODO: Use Shoonya's GetQuotes or subscribe to WebSocket
    throw new Error('ShoonyaAdapter getLatestCandle not yet implemented');
  }
  
  async getHistoricalData(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Candle[]> {
    // TODO: Call Shoonya's TPSeries API
    // POST https://api.shoonya.com/NorenWClientTP/TPSeries
    throw new Error('ShoonyaAdapter getHistoricalData not yet implemented');
  }
}

/**
 * Angel One (SmartAPI) Adapter Skeleton
 * 
 * To implement:
 * 1. npm install smartapi-javascript (Angel One official SDK)
 * 2. Create TOTP secret for 2FA
 * 3. Implement methods using SmartAPI
 */
export class AngelOneAdapter extends BaseNseAdapter {
  private apiKey: string = '';
  private clientId: string = '';
  private jwtToken: string = '';
  
  async connect(): Promise<void> {
    // TODO: Implement Angel One WebSocket
    // Reference: https://smartapi.angelbroking.com/docs
    throw new Error('AngelOneAdapter not yet implemented. Use MockNseAdapter for testing.');
  }
  
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  
  async authenticate(credentials: BrokerCredentials): Promise<boolean> {
    this.apiKey = credentials.apiKey;
    this.clientId = credentials.userId || '';
    
    // TODO: Call Angel One login API with TOTP
    // POST https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword
    
    throw new Error('AngelOneAdapter authentication not yet implemented');
  }
  
  async refreshToken(): Promise<void> {
    // TODO: Call generateToken API
    throw new Error('AngelOneAdapter refreshToken not yet implemented');
  }
  
  async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null> {
    // TODO: Use SmartAPI's getLTP or getCandleData
    throw new Error('AngelOneAdapter getLatestCandle not yet implemented');
  }
  
  async getHistoricalData(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Candle[]> {
    // TODO: Call getCandleData API
    throw new Error('AngelOneAdapter getHistoricalData not yet implemented');
  }
}

/**
 * Factory to create broker adapter
 */
export function createBrokerAdapter(broker: 'mock' | 'shoonya' | 'angelone'): BrokerAdapter {
  switch (broker) {
    case 'mock':
      return new MockNseAdapter();
    case 'shoonya':
      return new ShoonyaAdapter();
    case 'angelone':
      return new AngelOneAdapter();
    default:
      return new MockNseAdapter();
  }
}

export default {
  MockNseAdapter,
  ShoonyaAdapter,
  AngelOneAdapter,
  createBrokerAdapter,
  NSE_TIMEFRAMES,
};

