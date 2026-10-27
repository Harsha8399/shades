import { Candle, Timeframe } from '../types';
import { PatternEngine } from './PatternEngine';
import { PaperTradingEngine } from './PaperTradingEngine';
import { CSVLoader } from '../data/CSVLoader';
import { DEFAULT_CONFIG } from '../config/default';
import { CandleResampler, NseCandleResampler, getHigherTimeframe, getTimeframeMinutes } from './CandleResampler';

/**
 * Monitor configuration
 */
interface MonitorConfig {
  symbol: string;
  timeframe: Timeframe;
  pollIntervalMs?: number;
  candleBufferSize?: number;
}

/**
 * Live Monitor
 * Processes candles and runs pattern detection
 */
export class LiveMonitor {
  private config: Required<MonitorConfig>;
  private candles: Candle[] = [];
  private patternEngine: PatternEngine;
  private paperTrading: PaperTradingEngine;
  private isRunning: boolean = false;
  private currentIndex: number = 0;
  private allCandles: Candle[] = [];
  
  constructor(
    config: MonitorConfig,
    patternEngine?: PatternEngine,
    paperTrading?: PaperTradingEngine
  ) {
    this.config = {
      pollIntervalMs: DEFAULT_CONFIG.monitor.pollIntervalMs,
      candleBufferSize: DEFAULT_CONFIG.monitor.candleBufferSize,
      ...config,
    };
    
    this.patternEngine = patternEngine || new PatternEngine();
    this.paperTrading = paperTrading || new PaperTradingEngine();
  }
  
  /**
   * Get all loaded candles (for charting)
   */
  getAllCandles(): Candle[] {
    return this.allCandles;
  }

  /**
   * Load historical data from CSV
   */
  loadFromCSV(filePath: string, startDate?: number, endDate?: number): number {
    const loader = new CSVLoader();
    this.allCandles = loader.loadFromFile(filePath, startDate, endDate);
    
    // Handle empty data case
    if (this.allCandles.length === 0) {
      console.log('[LiveMonitor] No candles loaded (empty date range or no data in range)');
      return 0;
    }
    
    // Infer timeframe if not set
    if (!this.config.timeframe) {
      this.config.timeframe = CSVLoader.inferTimeframe(this.allCandles);
    }
    
    console.log(`[LiveMonitor] Loaded ${this.allCandles.length} candles from ${filePath}`);
    console.log(`[LiveMonitor] Timeframe: ${this.config.timeframe}`);
    console.log(`[LiveMonitor] Date range: ${new Date(this.allCandles[0]?.timestamp).toISOString()} - ${new Date(this.allCandles[this.allCandles.length - 1]?.timestamp).toISOString()}`);
    
    return this.allCandles.length;
  }
  
  /**
   * Add a candle to the buffer
   */
  addCandle(candle: Candle): void {
    this.candles.push(candle);
    
    // Trim buffer if needed
    if (this.candles.length > this.config.candleBufferSize) {
      this.candles = this.candles.slice(-this.config.candleBufferSize);
    }
  }
  
  /**
   * Check if a symbol is an NSE symbol
   * NSE symbols in this codebase use simple names like 'RELIANCE', 'NIFTY50', etc.
   * We check against the known NSE instrument keys from UpstoxFeed
   */
  private isNseSymbol(symbol: string): boolean {
    const nseSymbols = [
      'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN',
      'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT', 'HINDUNILVR', 'AXISBANK',
      'MARUTI', 'BAJFINANCE', 'TATAMOTORS', 'NIFTY50', 'NIFTY', 'BANKNIFTY',
      'NIFTYIT', 'NIFTYMIDCAP', 'FINNIFTY'
    ];
    return nseSymbols.includes(symbol.toUpperCase());
  }

  /**
   * Process a single candle
   *
   * Execution semantics (see research-py/docs/EXECUTION_SEMANTICS.md):
   * the strategy decides on CLOSED candles only. The candle currently being
   * processed is the forming bar, so it must not be visible to the pattern
   * engine. The forming candle is used for execution (stop / target checks
   * against the open book) but never for detection.
   */
  processCandle(candle: Candle): void {
    // The buffer holds only CLOSED candles. The forming candle is not added.
    const closedCandles = this.candles;

    // Check minimum candles for pattern detection
    const minRequired = this.patternEngine.getMinRequiredCandles();
    if (closedCandles.length < minRequired) {
      // Still manage any open trades against the forming candle.
      this.paperTrading.updateTrades(candle);
      this.addCandle(candle);
      return;
    }

    // Generate HTF candles for Multi-Timeframe Analysis (CRITICAL for trend filtering)
    // Built from closed candles only, so the HTF filter never sees a forming
    // higher-timeframe bar.
    const htfTimeframe = getHigherTimeframe(this.config.timeframe);
    let htfCandles: Candle[];
    
    // Use NSE-specific session-aware resampler for 30m → 1h on NSE symbols
    const isNse30mTo1h = this.config.timeframe === '30m' && htfTimeframe === '1h' && this.isNseSymbol(this.config.symbol);
    if (isNse30mTo1h) {
      htfCandles = NseCandleResampler.resample30mTo1hSessionAligned(closedCandles);
    } else {
      htfCandles = CandleResampler.resampleByTimeframe(
        closedCandles,
        this.config.timeframe,
        htfTimeframe
      );
    }

    // Need minimum HTF candles for analysis
    const minHTFCandles = 50;
    const validHTFCandles = htfCandles.length >= minHTFCandles ? htfCandles : undefined;

    // Detect new signals using CLOSED candles only. A signal emitted here is
    // actionable from the forming candle onwards.
    const signals = this.patternEngine.detectSignals(
      closedCandles,
      this.config.symbol,
      this.config.timeframe,
      validHTFCandles
    );

    // Process signals
    for (const signal of signals) {
      this.paperTrading.processSignal(signal);
    }

    // Execute against the forming candle. This must happen AFTER detection so
    // a pending order just created from the closed candles is allowed to fill
    // on THIS bar's range, matching the research engine's per-bar order
    // (engine.py: detect -> execute pending -> update positions) and the
    // trade-parity harness. A position filled on this candle is not also
    // exit-checked on it: updateTrades iterates each trade once and the
    // PENDING->OPEN transition returns without an exit.
    this.paperTrading.updateTrades(candle);

    // The candle has now closed: it becomes available to the strategy on the
    // NEXT call.
    this.addCandle(candle);
  }
  
  /**
   * Run simulation on loaded data
   */
  runSimulation(startIndex?: number): void {
    if (this.allCandles.length === 0) {
      console.error('[LiveMonitor] No data loaded. Call loadFromCSV first.');
      return;
    }
    
    const minRequired = this.patternEngine.getMinRequiredCandles();
    if (this.allCandles.length < minRequired) {
      console.log(`[LiveMonitor] Insufficient data for pattern detection. Need ${minRequired} candles, have ${this.allCandles.length}.`);
      this.currentIndex = this.allCandles.length;
      this.isRunning = false;
      return;
    }
    
    this.currentIndex = startIndex || 0;
    this.candles = [];
    this.isRunning = true;
    
    console.log(`[LiveMonitor] Starting simulation from index ${this.currentIndex}`);
    console.log(`[LiveMonitor] Minimum candles required: ${minRequired}`);
    
    // Process all candles
    while (this.currentIndex < this.allCandles.length && this.isRunning) {
      const candle = this.allCandles[this.currentIndex];
      this.processCandle(candle);
      this.currentIndex++;
      
      // Log progress every 100 candles
      if (this.currentIndex % 100 === 0) {
        console.log(`[LiveMonitor] Processed ${this.currentIndex}/${this.allCandles.length} candles`);
      }
    }
    
    this.isRunning = false;
    console.log(`[LiveMonitor] Simulation complete. Processed ${this.currentIndex} candles.`);
    
    // Print summary
    this.printSummary();
  }
  
  /**
   * Run live monitoring (simulated with delay)
   */
  async runLive(startIndex?: number): Promise<void> {
    if (this.allCandles.length === 0) {
      console.error('[LiveMonitor] No data loaded. Call loadFromCSV first.');
      return;
    }
    
    this.currentIndex = startIndex || 0;
    this.candles = [];
    this.isRunning = true;
    
    console.log(`[LiveMonitor] Starting live monitoring from index ${this.currentIndex}`);
    
    while (this.currentIndex < this.allCandles.length && this.isRunning) {
      const candle = this.allCandles[this.currentIndex];
      
      console.log(`\n[${new Date(candle.timestamp).toISOString()}] Candle: O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)}`);
      
      this.processCandle(candle);
      this.currentIndex++;
      
      // Wait for poll interval
      await this.sleep(this.config.pollIntervalMs);
    }
    
    this.isRunning = false;
    console.log('[LiveMonitor] Live monitoring stopped.');
    this.printSummary();
  }
  
  /**
   * Step through one candle at a time (for debugging)
   */
  step(): Candle | null {
    if (this.currentIndex >= this.allCandles.length) {
      console.log('[LiveMonitor] No more candles');
      return null;
    }
    
    const candle = this.allCandles[this.currentIndex];
    this.processCandle(candle);
    this.currentIndex++;
    
    return candle;
  }
  
  /**
   * Stop the monitor
   */
  stop(): void {
    this.isRunning = false;
    console.log('[LiveMonitor] Stopping...');
  }
  
  /**
   * Print trading summary
   */
  printSummary(): void {
    const stats = this.paperTrading.getStats();
    const capital = this.paperTrading.getCapital();
    
    console.log('\n========== TRADING SUMMARY ==========');
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Winning: ${stats.winningTrades} | Losing: ${stats.losingTrades}`);
    console.log(`Win Rate: ${(stats.winRate * 100).toFixed(1)}%`);
    console.log(`Avg Win: $${stats.avgWin.toFixed(2)} | Avg Loss: $${stats.avgLoss.toFixed(2)}`);
    console.log(`Profit Factor: ${stats.profitFactor.toFixed(2)}`);
    console.log(`Expectancy: $${stats.expectancy.toFixed(2)}`);
    console.log(`Avg R-Multiple: ${stats.avgRMultiple.toFixed(2)}R`);
    console.log(`Total P&L: $${stats.totalPnl.toFixed(2)}`);
    console.log(`Final Capital: $${capital.toFixed(2)}`);
    console.log('======================================\n');
  }
  
  /**
   * Get current open trades
   */
  getOpenTrades() {
    return this.paperTrading.getOpenTrades();
  }
  
  /**
   * Get trading stats
   */
  getStats() {
    return this.paperTrading.getStats();
  }
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default LiveMonitor;

