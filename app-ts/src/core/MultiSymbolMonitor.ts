import { Candle, Timeframe } from '../types';
import { PatternEngine } from './PatternEngine';
import { PaperTradingEngine } from './PaperTradingEngine';
import { CSVLoader } from '../data/CSVLoader';
import { DEFAULT_CONFIG } from '../config/default';
import { CandleResampler, getHigherTimeframe } from './CandleResampler';

/**
 * Symbol data configuration
 */
interface SymbolConfig {
  symbol: string;
  dataPath: string;
  timeframe: Timeframe;
}

/**
 * Symbol state during monitoring
 */
interface SymbolState {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentIndex: number;
  allCandles: Candle[];
}

/**
 * Multi-Symbol Live Monitor
 * Processes multiple symbols simultaneously
 */
export class MultiSymbolMonitor {
  private symbols: Map<string, SymbolState> = new Map();
  private patternEngine: PatternEngine;
  private paperTrading: PaperTradingEngine;
  private isRunning: boolean = false;
  private candleBufferSize: number;
  
  constructor(
    patternEngine?: PatternEngine,
    paperTrading?: PaperTradingEngine
  ) {
    this.patternEngine = patternEngine || new PatternEngine();
    this.paperTrading = paperTrading || new PaperTradingEngine();
    this.candleBufferSize = DEFAULT_CONFIG.monitor.candleBufferSize;
  }
  
  /**
   * Add a symbol to monitor
   */
  addSymbol(config: SymbolConfig): number {
    const loader = new CSVLoader();
    const candles = loader.loadFromFile(config.dataPath);
    
    const state: SymbolState = {
      symbol: config.symbol,
      timeframe: config.timeframe,
      candles: [],
      currentIndex: 0,
      allCandles: candles,
    };
    
    this.symbols.set(config.symbol, state);
    
    console.log(`[MultiSymbol] Added ${config.symbol}: ${candles.length} candles`);
    return candles.length;
  }
  
  /**
   * Add multiple symbols
   */
  addSymbols(configs: SymbolConfig[]): void {
    for (const config of configs) {
      this.addSymbol(config);
    }
    console.log(`[MultiSymbol] Total symbols: ${this.symbols.size}`);
  }
  
  /**
   * Run simulation on all symbols
   */
  runSimulation(): void {
    if (this.symbols.size === 0) {
      console.error('[MultiSymbol] No symbols added');
      return;
    }
    
    this.isRunning = true;
    
    // Find the common date range
    const { startTime, endTime } = this.getCommonDateRange();
    console.log(`[MultiSymbol] Date range: ${new Date(startTime).toISOString()} - ${new Date(endTime).toISOString()}`);
    
    // Initialize all symbols to start time
    for (const state of this.symbols.values()) {
      state.currentIndex = state.allCandles.findIndex(c => c.timestamp >= startTime);
      if (state.currentIndex < 0) state.currentIndex = 0;
      state.candles = [];
    }
    
    const minRequired = this.patternEngine.getMinRequiredCandles();
    console.log(`[MultiSymbol] Starting simulation. Min candles required: ${minRequired}`);
    
    let totalProcessed = 0;
    let hasMoreData = true;
    
    while (hasMoreData && this.isRunning) {
      hasMoreData = false;
      
      // Process one candle from each symbol
      for (const state of this.symbols.values()) {
        if (state.currentIndex < state.allCandles.length) {
          const candle = state.allCandles[state.currentIndex];
          this.processCandle(state, candle);
          state.currentIndex++;
          hasMoreData = true;
          totalProcessed++;
        }
      }
      
      // Progress logging
      if (totalProcessed % 500 === 0) {
        console.log(`[MultiSymbol] Processed ${totalProcessed} candles total`);
      }
    }
    
    this.isRunning = false;
    console.log(`[MultiSymbol] Simulation complete. Processed ${totalProcessed} candles across ${this.symbols.size} symbols.`);
    
    this.printSummary();
  }
  
  /**
   * Process a single candle for a symbol
   */
  private processCandle(state: SymbolState, candle: Candle): void {
    // Add to buffer
    state.candles.push(candle);
    
    // Trim buffer
    if (state.candles.length > this.candleBufferSize) {
      state.candles = state.candles.slice(-this.candleBufferSize);
    }
    
    // Check minimum candles
    const minRequired = this.patternEngine.getMinRequiredCandles();
    if (state.candles.length < minRequired) {
      return;
    }
    
    // Update existing trades for this symbol
    const openTrades = this.paperTrading.getOpenTrades().filter(t => t.symbol === state.symbol);
    if (openTrades.length > 0) {
      this.paperTrading.updateTrades(candle);
    }
    
    // Generate HTF candles for Multi-Timeframe Analysis
    const htfTimeframe = getHigherTimeframe(state.timeframe);
    const htfCandles = CandleResampler.resampleByTimeframe(
      state.candles,
      state.timeframe,
      htfTimeframe
    );
    
    // Need minimum HTF candles for analysis
    const minHTFCandles = 50;
    const validHTFCandles = htfCandles.length >= minHTFCandles ? htfCandles : undefined;
    
    // Detect new signals (with HTF data for trend filtering)
    const signals = this.patternEngine.detectSignals(
      state.candles,
      state.symbol,
      state.timeframe,
      validHTFCandles
    );
    
    // Process signals
    for (const signal of signals) {
      this.paperTrading.processSignal(signal);
    }
  }
  
  /**
   * Get common date range across all symbols
   */
  private getCommonDateRange(): { startTime: number; endTime: number } {
    let maxStart = 0;
    let minEnd = Infinity;
    
    for (const state of this.symbols.values()) {
      if (state.allCandles.length === 0) continue;
      
      const first = state.allCandles[0].timestamp;
      const last = state.allCandles[state.allCandles.length - 1].timestamp;
      
      maxStart = Math.max(maxStart, first);
      minEnd = Math.min(minEnd, last);
    }
    
    return { startTime: maxStart, endTime: minEnd };
  }
  
  /**
   * Stop monitoring
   */
  stop(): void {
    this.isRunning = false;
  }
  
  /**
   * Print trading summary
   */
  printSummary(): void {
    const stats = this.paperTrading.getStats();
    const capital = this.paperTrading.getCapital();
    
    console.log('\n========== MULTI-SYMBOL TRADING SUMMARY ==========');
    console.log(`Symbols Monitored: ${this.symbols.size}`);
    console.log(`  ${Array.from(this.symbols.keys()).join(', ')}`);
    console.log('');
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Winning: ${stats.winningTrades} | Losing: ${stats.losingTrades}`);
    console.log(`Win Rate: ${(stats.winRate * 100).toFixed(1)}%`);
    console.log(`Avg Win: $${stats.avgWin.toFixed(2)} | Avg Loss: $${stats.avgLoss.toFixed(2)}`);
    console.log(`Profit Factor: ${stats.profitFactor.toFixed(2)}`);
    console.log(`Expectancy: $${stats.expectancy.toFixed(2)}`);
    console.log(`Avg R-Multiple: ${stats.avgRMultiple.toFixed(2)}R`);
    console.log(`Total P&L: $${stats.totalPnl.toFixed(2)}`);
    console.log(`Final Capital: $${capital.toFixed(2)}`);
    console.log('==================================================\n');
  }
  
  /**
   * Get trading stats
   */
  getStats() {
    return this.paperTrading.getStats();
  }
  
  /**
   * Get open trades
   */
  getOpenTrades() {
    return this.paperTrading.getOpenTrades();
  }
  
  /**
   * Get symbol-specific stats
   */
  getSymbolStats(symbol: string) {
    const allTrades = this.paperTrading.getOpenTrades();
    // Note: Would need to extend TradeRepository to filter by symbol
    return allTrades.filter(t => t.symbol === symbol);
  }
}

export default MultiSymbolMonitor;

