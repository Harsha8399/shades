/**
 * Live Pattern Scanner
 * 
 * Real-time pattern detection using live market data.
 * Integrates LiveMarketDataService with PatternEngine for continuous scanning.
 */
import { Candle, Timeframe, Signal } from '../types';
import { PatternEngine } from '../core/PatternEngine';
import { LiveMarketDataService, LiveCandleUpdate } from '../data/LiveMarketDataService';
import { registerAllPatterns } from '../patterns';
import { PaperTradingEngine } from '../core/PaperTradingEngine';
import { TradeRepository } from '../db/TradeRepository';

export interface ScannerConfig {
  symbols: string[];
  timeframes: Timeframe[];
  scanIntervalMs: number;
  enablePaperTrading: boolean;
  useWebSocket?: boolean;
}

export interface ScanResult {
  symbol: string;
  timeframe: Timeframe;
  signal: Signal | null;
  confluenceFactors: string[];
  timestamp: Date;
}

export type ScanCallback = (result: ScanResult) => void;

export class LivePatternScanner {
  private static instance: LivePatternScanner;
  private marketDataService: LiveMarketDataService;
  private patternEngine: PatternEngine;
  private paperTradingEngine: PaperTradingEngine | null = null;
  private tradeRepository: TradeRepository;
  private config: ScannerConfig;
  private isScanning = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private scanCallbacks: ScanCallback[] = [];
  private lastScanResults: Map<string, ScanResult> = new Map();
  private candlesBuffer: Map<string, Candle[]> = new Map(); // key: `${symbol}:${timeframe}`
  private latestFormingCandles: Map<string, Candle> = new Map(); // key: `${symbol}:${timeframe}`

  private constructor() {
    this.marketDataService = LiveMarketDataService.getInstance();
    this.tradeRepository = new TradeRepository();
    
    // Initialize pattern engine
    registerAllPatterns();
    this.patternEngine = new PatternEngine();
    
    // Default config
    this.config = {
      symbols: ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'NIFTY', 'BANKNIFTY'],
      timeframes: ['15m', '1h', '4h'],
      scanIntervalMs: 60000, // 1 minute
      enablePaperTrading: true,
    };
  }

  static getInstance(): LivePatternScanner {
    if (!LivePatternScanner.instance) {
      LivePatternScanner.instance = new LivePatternScanner();
    }
    return LivePatternScanner.instance;
  }

  /**
   * Configure the scanner
   */
  configure(config: Partial<ScannerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Initialize and start scanning
   */
  async start(): Promise<void> {
    if (this.isScanning) {
      console.warn('[LiveScanner] Already scanning');
      return;
    }

    // Initialize market data service
    const initialized = await this.marketDataService.initialize({ useWebSocket: this.config.useWebSocket ?? true });
    if (!initialized) {
      throw new Error('Failed to initialize market data service. Check Upstox credentials.');
    }

    // Subscribe to market data
    await this.marketDataService.subscribe(this.config.symbols, this.config.timeframes);

    // Register for candle updates
    this.marketDataService.onCandleUpdate(this.handleCandleUpdate.bind(this));

    // Initialize paper trading if enabled
    if (this.config.enablePaperTrading) {
      this.paperTradingEngine = new PaperTradingEngine(
        this.tradeRepository,
        undefined,
        undefined,
        undefined,
        true,
        'NSE_EQUITY',
        true
      );
    }

    // Start periodic scanning
    this.startPeriodicScan();

    this.isScanning = true;
    console.log('[LiveScanner] Started scanning', this.config.symbols.length, 'symbols on', this.config.timeframes.length, 'timeframes');
  }

  /**
   * Stop scanning
   */
  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    this.marketDataService.stop();
    this.isScanning = false;
    console.log('[LiveScanner] Stopped');
  }

  /**
   * Handle incoming candle updates
   */
  private handleCandleUpdate(update: LiveCandleUpdate): void {
    const key = `${update.symbol}:${update.timeframe}`;

    // Update buffer
    if (!this.candlesBuffer.has(key)) {
      this.candlesBuffer.set(key, []);
    }

    const buffer = this.candlesBuffer.get(key)!;

    // DEFECT FIX: the feed emits one update per tick, and every update for
    // the same in-progress candle carries the SAME timestamp. Pushing all of
    // them filled the 200-candle buffer with a few minutes of duplicated
    // prices and made the pattern engine read a still-forming candle.
    //
    // The buffer must hold at most one entry per timestamp: the latest
    // update for a timestamp REPLACES the previous one, and a completed
    // candle is appended once.
    const last = buffer.length > 0 ? buffer[buffer.length - 1] : undefined;

    if (last && last.timestamp === update.candle.timestamp) {
      // Same forming candle: replace it with the newer version.
      buffer[buffer.length - 1] = update.candle;
    } else {
      buffer.push(update.candle);
      // Keep last 200 candles
      if (buffer.length > 200) {
        buffer.shift();
      }
    }

    // Track the latest forming candle for paper trade updates
    this.latestFormingCandles.set(key, update.candle);

    // Update paper trades on EVERY candle update (both forming and completed)
    // This ensures stop-loss/target hits are detected intrabar.
    if (this.config.enablePaperTrading && this.paperTradingEngine) {
      this.updatePaperTrades(update.symbol, update.candle);
    }

    // If candle is complete, trigger immediate scan
    if (update.isComplete && buffer.length >= 50) {
      this.scanSymbol(update.symbol, update.timeframe);
    }
  }

  /**
   * Start periodic full scan
   */
  private startPeriodicScan(): void {
    this.scanInterval = setInterval(() => {
      this.scanAll();
    }, this.config.scanIntervalMs);
  }

  /**
   * Scan all subscribed symbols
   */
  private async scanAll(): Promise<void> {
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        await this.scanSymbol(symbol, timeframe);
      }
    }
  }

  /**
   * Scan a single symbol/timeframe
   */
  private async scanSymbol(symbol: string, timeframe: Timeframe): Promise<ScanResult | null> {
    const key = `${symbol}:${timeframe}`;
    const candles = this.candlesBuffer.get(key);
    
    if (!candles || candles.length < 50) {
      return null;
    }

    try {
      // Detect signals (all patterns do their own confluence/context work)
      const signals = this.patternEngine.detectSignals(candles, symbol, timeframe);
      
      // Use first signal if any
      const signal = signals.length > 0 ? signals[0] : null;
      
      // Get confluence factors
      const confluenceFactors = signal ? this.extractConfluenceFactors(signal) : [];
      
      const result: ScanResult = {
        symbol,
        timeframe,
        signal,
        confluenceFactors,
        timestamp: new Date(),
      };

      // Store result
      this.lastScanResults.set(key, result);

      // Notify callbacks
      for (const callback of this.scanCallbacks) {
        try {
          callback(result);
        } catch (error) {
          console.error('[LiveScanner] Callback error:', error);
        }
      }

      // Execute paper trade if signal and enabled
      if (signal && this.config.enablePaperTrading && this.paperTradingEngine) {
        this.executePaperTrade(signal, symbol, timeframe);
      }

      return result;
    } catch (error: any) {
      console.error(`[LiveScanner] Error scanning ${symbol} ${timeframe}:`, error.message);
      return null;
    }
  }

  /**
   * Extract confluence factors from signal
   */
  private extractConfluenceFactors(signal: Signal): string[] {
    // Signal already has confluenceFactors array
    return signal.confluenceFactors || [];
  }

  /**
   * Execute paper trade
   */
  private executePaperTrade(signal: Signal, symbol: string, timeframe: Timeframe): void {
    if (!this.paperTradingEngine) return;

    try {
      // Ensure signal has required fields for processSignal
      const fullSignal = {
        ...signal,
        symbol,
        timeframe,
        patternName: signal.patternName || 'Confluence Zone + Entry Model 2',
      };

      const trade = this.paperTradingEngine.processSignal(fullSignal);

      if (trade) {
        console.log(`[LiveScanner] Paper trade opened: ${trade.id.slice(0, 8)} ${signal.direction} ${symbol} @ ${signal.entryPrice}`);
      } else {
        console.log(`[LiveScanner] Paper trade rejected for ${symbol}`);
      }
    } catch (error: any) {
      console.error('[LiveScanner] Paper trade error:', error.message);
    }
  }

  /**
   * Update paper trades with the latest forming candle
   * Called on every tick/candle update to detect intrabar stop-loss/target hits
   */
  private updatePaperTrades(symbol: string, formingCandle: Candle): void {
    if (!this.paperTradingEngine) return;

    try {
      // PaperTradingEngine.updateTrades iterates all open trades and updates them
      // against the given candle. It correctly handles PENDING (entry fill),
      // OPEN (stop/target), and PARTIAL states.
      // We pass the forming candle which has the latest high/low for intrabar checks.
      this.paperTradingEngine.updateTrades(formingCandle);
    } catch (error: any) {
      console.error(`[LiveScanner] Paper trade update error for ${symbol}:`, error.message);
    }
  }

  /**
   * Register callback for scan results
   */
  onScanResult(callback: ScanCallback): () => void {
    this.scanCallbacks.push(callback);
    
    return () => {
      const index = this.scanCallbacks.indexOf(callback);
      if (index > -1) {
        this.scanCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get last scan result for a symbol/timeframe
   */
  getLastResult(symbol: string, timeframe: Timeframe): ScanResult | undefined {
    return this.lastScanResults.get(`${symbol}:${timeframe}`);
  }

  /**
   * Get all last results
   */
  getAllResults(): ScanResult[] {
    return Array.from(this.lastScanResults.values());
  }

  /**
   * Get active signals (signals from last scan)
   */
  getActiveSignals(): ScanResult[] {
    return Array.from(this.lastScanResults.values()).filter(r => r.signal !== null);
  }

  /**
   * Get paper trading engine
   */
  getPaperTradingEngine(): PaperTradingEngine | null {
    return this.paperTradingEngine;
  }

  /**
   * Get market data service
   */
  getMarketDataService(): LiveMarketDataService {
    return this.marketDataService;
  }

  /**
   * Get candles buffer for testing
   */
  getCandlesBuffer(): Map<string, Candle[]> {
    return this.candlesBuffer;
  }

  /**
   * Get latest forming candles for testing
   */
  getLatestFormingCandles(): Map<string, Candle> {
    return this.latestFormingCandles;
  }

  /**
   * Check if scanning
   */
  isActive(): boolean {
    return this.isScanning;
  }
}

export default LivePatternScanner;