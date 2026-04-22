import { Candle, Signal, Trade, PartialTPConfig, DEFAULT_PARTIAL_TP_CONFIG, createPartialExits, Direction, TradeInstrument, ExecutionType } from '../types';
import { TradeRepository } from '../db/TradeRepository';
import { TradeStateMachine } from './TradeStateMachine';
import { RiskManager } from './RiskManager';
import { 
  processPartialExits, 
  applyPartialExit, 
  handleStopWithPartialExits,
  calculateUnrealizedPnl,
  getPartialExitsSummary,
} from './PartialProfitManager';
import { ExecutionSimulator } from './ExecutionSimulator';
import { MarketSegment, NSE_LOT_SIZES } from '../config/indianMarket';
import { 
  InstrumentSelector, 
  ExecutionConfig, 
  DEFAULT_EXECUTION_CONFIG,
  FnOInstrument,
  StrategyExecutionType,
} from './InstrumentSelector';

/**
 * Trailing stop configuration
 */
export interface TrailingStopConfig {
  enabled: boolean;
  type: 'breakeven' | 'step' | 'atr';
  breakevenTriggerR: number;     // Move to breakeven after X R profit
  stepSizeR: number;             // Trail in steps of X R
  atrMultiplier: number;         // ATR multiplier for ATR trailing
}

const DEFAULT_TRAILING_CONFIG: TrailingStopConfig = {
  enabled: true,
  type: 'breakeven',
  breakevenTriggerR: 1,
  stepSizeR: 0.5,
  atrMultiplier: 2,
};

/**
 * Paper Trading Engine
 * Handles simulated trade execution and management
 */
export class PaperTradingEngine {
  private repository: TradeRepository;
  private riskManager: RiskManager;
  private trailingConfig: TrailingStopConfig;
  private partialTPConfig: PartialTPConfig;
  private usePartialTPs: boolean;
  private executionSimulator: ExecutionSimulator;
  private useRealisticExecution: boolean;
  
  constructor(
    repository?: TradeRepository, 
    riskManager?: RiskManager,
    trailingConfig?: Partial<TrailingStopConfig>,
    partialTPConfig?: Partial<PartialTPConfig>,
    usePartialTPs: boolean = true,
    marketSegment: MarketSegment = 'NSE_EQUITY',
    useRealisticExecution: boolean = true
  ) {
    this.repository = repository || new TradeRepository();
    this.riskManager = riskManager || new RiskManager(undefined, this.repository);
    this.trailingConfig = { ...DEFAULT_TRAILING_CONFIG, ...trailingConfig };
    this.partialTPConfig = { ...DEFAULT_PARTIAL_TP_CONFIG, ...partialTPConfig };
    this.usePartialTPs = usePartialTPs;
    this.executionSimulator = new ExecutionSimulator(marketSegment);
    this.useRealisticExecution = useRealisticExecution;
  }
  
  /**
   * Set market segment for fee calculation
   */
  setMarketSegment(segment: MarketSegment): void {
    this.executionSimulator.setSegment(segment);
  }
  
  /**
   * Enable/disable realistic execution (slippage + fees)
   */
  setRealisticExecution(enabled: boolean): void {
    this.useRealisticExecution = enabled;
  }
  
  /**
   * Enable/disable partial profit taking
   */
  setPartialTPsEnabled(enabled: boolean): void {
    this.usePartialTPs = enabled;
  }
  
  /**
   * Update partial TP configuration
   */
  updatePartialTPConfig(config: Partial<PartialTPConfig>): void {
    this.partialTPConfig = { ...this.partialTPConfig, ...config };
  }
  
  /**
   * Process a new signal and potentially create a trade
   */
  processSignal(signal: Signal): Trade | null {
    // Check risk rules
    const riskCheck = this.riskManager.checkRisk(signal);
    
    if (!riskCheck.allowed) {
      console.log(`[PaperTrading] Signal rejected: ${riskCheck.reason}`);
      return null;
    }
    
    // Calculate position size
    const { quantity, riskAmount, riskPercent } = this.riskManager.calculatePositionSize(
      signal.entryPrice,
      signal.stopLoss,
      riskCheck.adjustedRiskPercent
    );
    
    if (quantity <= 0) {
      console.log('[PaperTrading] Invalid position size, skipping signal');
      return null;
    }
    
    // Create trade
    const trade = this.repository.createFromSignal(signal, quantity, riskAmount, riskPercent);
    
    // Set up partial exits if enabled
    if (this.usePartialTPs) {
      trade.partialExits = createPartialExits(
        signal.entryPrice,
        signal.stopLoss,
        signal.direction,
        this.partialTPConfig
      );
      trade.remainingQuantity = quantity;
      this.repository.save(trade);
    }
    
    console.log(`[PaperTrading] Trade created: ${trade.id.slice(0, 8)} | ${signal.patternName} | ${signal.direction} ${signal.symbol}`);
    console.log(`  Entry: ${signal.entryPrice.toFixed(2)} | SL: ${signal.stopLoss.toFixed(2)} | TP: ${signal.target.toFixed(2)}`);
    console.log(`  Quantity: ${quantity.toFixed(4)} | Risk: $${riskAmount.toFixed(2)} (${(riskPercent * 100).toFixed(1)}%)`);
    
    if (this.usePartialTPs && trade.partialExits.length > 0) {
      console.log(`  Partial TPs: TP1 @ ${trade.partialExits[0].level.toFixed(2)} | TP2 @ ${trade.partialExits[1].level.toFixed(2)} | TP3 @ ${trade.partialExits[2].level.toFixed(2)}`);
    }
    
    return trade;
  }
  
  /**
   * Process signal with F&O execution configuration
   */
  processSignalWithExecution(
    signal: Signal, 
    executionConfig: ExecutionConfig = DEFAULT_EXECUTION_CONFIG
  ): Trade | null {
    // For SPOT execution, use regular processing
    if (executionConfig.type === 'SPOT') {
      return this.processSignal(signal);
    }
    
    // Check risk rules
    const riskCheck = this.riskManager.checkRisk(signal);
    
    if (!riskCheck.allowed) {
      console.log(`[PaperTrading] Signal rejected: ${riskCheck.reason}`);
      return null;
    }
    
    // Select F&O instrument
    const fnoInstrument = InstrumentSelector.selectInstrument(
      signal.symbol,
      signal.entryPrice,
      signal.direction,
      executionConfig
    );
    
    if (!fnoInstrument) {
      console.log('[PaperTrading] Could not select F&O instrument');
      return null;
    }
    
    // Calculate position size for F&O
    const { numLots, riskAmount, riskPercent } = this.calculateFnOPositionSize(
      signal,
      fnoInstrument,
      executionConfig,
      riskCheck.adjustedRiskPercent || 0.02  // Default 2% risk
    );
    
    if (numLots <= 0) {
      console.log('[PaperTrading] Invalid position size for F&O, skipping signal');
      return null;
    }
    
    // Calculate quantity (for spot reference)
    const quantity = numLots * fnoInstrument.lotSize;
    
    // Create trade with F&O details
    const trade = this.repository.createFromSignal(signal, quantity, riskAmount, riskPercent);
    
    // Add F&O-specific fields
    trade.executionType = this.mapToExecutionType(executionConfig.type);
    trade.instrument = {
      symbol: fnoInstrument.symbol,
      type: fnoInstrument.instrumentType,
      strike: fnoInstrument.strike,
      expiry: fnoInstrument.expiryString,
      lotSize: fnoInstrument.lotSize,
      premium: fnoInstrument.premium,
      delta: fnoInstrument.delta,
      numLots,
    };
    
    // Set up partial exits if enabled
    if (this.usePartialTPs) {
      trade.partialExits = createPartialExits(
        signal.entryPrice,
        signal.stopLoss,
        signal.direction,
        this.partialTPConfig
      );
      trade.remainingQuantity = quantity;
    }
    
    this.repository.save(trade);
    
    console.log(`[PaperTrading] F&O Trade created: ${trade.id.slice(0, 8)} | ${signal.patternName} | ${signal.direction} ${signal.symbol}`);
    console.log(`  Instrument: ${fnoInstrument.symbol} | Type: ${fnoInstrument.instrumentType}`);
    console.log(`  Entry: ${signal.entryPrice.toFixed(2)} | SL: ${signal.stopLoss.toFixed(2)} | TP: ${signal.target.toFixed(2)}`);
    console.log(`  Lots: ${numLots} x ${fnoInstrument.lotSize} = ${quantity} units | Risk: $${riskAmount.toFixed(2)}`);
    
    if (fnoInstrument.delta) {
      console.log(`  Option Delta: ${fnoInstrument.delta.toFixed(2)} | Premium: ${fnoInstrument.premium.toFixed(2)}`);
    }
    
    return trade;
  }
  
  /**
   * Calculate position size for F&O trades
   */
  private calculateFnOPositionSize(
    signal: Signal,
    instrument: FnOInstrument,
    executionConfig: ExecutionConfig,
    adjustedRiskPercent: number
  ): { numLots: number; riskAmount: number; riskPercent: number } {
    const capital = this.riskManager.getCapital();
    const maxRisk = capital * adjustedRiskPercent;
    
    const spotRisk = Math.abs(signal.entryPrice - signal.stopLoss);
    
    let riskPerLot: number;
    
    if (executionConfig.type === 'FUTURES') {
      // Futures: full point movement
      riskPerLot = spotRisk * instrument.lotSize;
    } else {
      // Options: delta-adjusted movement
      const delta = executionConfig.optionDelta || instrument.delta || 0.5;
      riskPerLot = spotRisk * delta * instrument.lotSize;
    }
    
    if (riskPerLot <= 0) {
      return { numLots: 0, riskAmount: 0, riskPercent: 0 };
    }
    
    // Calculate number of lots we can afford
    const numLots = Math.floor(maxRisk / riskPerLot);
    const actualRiskAmount = numLots * riskPerLot;
    const actualRiskPercent = actualRiskAmount / capital;
    
    return {
      numLots: Math.max(1, numLots), // Minimum 1 lot
      riskAmount: actualRiskAmount,
      riskPercent: actualRiskPercent,
    };
  }
  
  /**
   * Map strategy execution type to trade execution type
   */
  private mapToExecutionType(strategyType: StrategyExecutionType): ExecutionType {
    switch (strategyType) {
      case 'SPOT':
        return 'SPOT';
      case 'FUTURES':
        return 'FUTURES';
      case 'OPTIONS_BUY_ATM':
      case 'OPTIONS_SELL_ATM':
        return 'OPTIONS';
      default:
        return 'SPOT';
    }
  }
  
  /**
   * Calculate P&L for futures trade
   */
  calculateFuturesPnl(
    entryPrice: number,
    exitPrice: number,
    lotSize: number,
    numLots: number,
    direction: Direction
  ): number {
    const pointMove = exitPrice - entryPrice;
    const directionMultiplier = direction === 'LONG' ? 1 : -1;
    return pointMove * directionMultiplier * lotSize * numLots;
  }
  
  /**
   * Calculate P&L for options trade
   */
  calculateOptionPnl(
    spotEntry: number,
    spotExit: number,
    optionEntryPremium: number,
    delta: number,
    lotSize: number,
    numLots: number,
    isBuy: boolean,
    direction: Direction
  ): number {
    // For option buyers: profit from price movement * delta
    // For option sellers: profit from premium decay (simplified)
    
    const spotMove = spotExit - spotEntry;
    const directionMultiplier = direction === 'LONG' ? 1 : -1;
    
    // Estimate option price change (simplified using delta)
    const optionPriceChange = spotMove * directionMultiplier * delta;
    
    if (isBuy) {
      // Buyer profits from option price increase
      return optionPriceChange * lotSize * numLots;
    } else {
      // Seller profits from option price decrease
      return -optionPriceChange * lotSize * numLots;
    }
  }
  
  /**
   * Calculate P&L for a trade based on its execution type
   */
  calculateTradePnl(trade: Trade, exitPrice: number): number {
    if (!trade.entryPrice) return 0;
    
    // SPOT execution
    if (trade.executionType === 'SPOT' || !trade.instrument) {
      const pnl = trade.direction === 'LONG'
        ? (exitPrice - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - exitPrice) * trade.quantity;
      return pnl;
    }
    
    const { instrument } = trade;
    const numLots = instrument.numLots || 1;
    
    // FUTURES execution
    if (trade.executionType === 'FUTURES') {
      return this.calculateFuturesPnl(
        trade.entryPrice,
        exitPrice,
        instrument.lotSize,
        numLots,
        trade.direction
      );
    }
    
    // OPTIONS execution
    if (trade.executionType === 'OPTIONS') {
      const isBuy = true; // Simplified - would need to track from executionConfig
      return this.calculateOptionPnl(
        trade.entryPrice,
        exitPrice,
        instrument.premium || 0,
        instrument.delta || 0.5,
        instrument.lotSize,
        numLots,
        isBuy,
        trade.direction
      );
    }
    
    return 0;
  }
  
  /**
   * Update all open trades with new candle data
   */
  updateTrades(candle: Candle): void {
    const openTrades = this.repository.getOpenTrades();
    
    for (const trade of openTrades) {
      try {
        this.updateTrade(trade, candle);
      } catch (error) {
        console.error(`[PaperTrading] Error updating trade ${trade.id}:`, error);
      }
    }
  }
  
  /**
   * Update a single trade with new candle data
   */
  private updateTrade(trade: Trade, candle: Candle): void {
    const currentPrice = candle.close;
    
    if (trade.state === 'PENDING') {
      // Check expiry
      if (new Date() > trade.expiryTime) {
        const updated = TradeStateMachine.expireTrade(trade, currentPrice);
        this.repository.save(updated);
        console.log(`[PaperTrading] Trade expired: ${trade.id.slice(0, 8)}`);
        return;
      }
      
      // Check if entry price is hit
      if (this.isEntryHit(trade, candle)) {
        let entryPrice = trade.signalPrice;
        
        // Apply slippage if realistic execution is enabled
        if (this.useRealisticExecution) {
          const entryResult = this.executionSimulator.simulateEntry(
            trade.signalPrice,
            trade.quantity,
            trade.direction
          );
          entryPrice = entryResult.executedPrice;
          
          // Store execution details in notes
          trade.notes.push(`Entry slippage: ${entryResult.slippageAmount.toFixed(2)}`);
          trade.notes.push(`Entry fees: ${entryResult.fees.total.toFixed(2)}`);
          
          console.log(`[PaperTrading] ${this.executionSimulator.getExecutionSummary(entryResult)}`);
        }
        
        const updated = TradeStateMachine.openTrade(trade, entryPrice);
        this.repository.save(updated);
        console.log(`[PaperTrading] Trade opened: ${trade.id.slice(0, 8)} @ ${entryPrice.toFixed(2)}`);
      }
      
      // Check invalidation
      if (this.isInvalidated(trade, candle)) {
        const updated = TradeStateMachine.cancelTrade(trade, 'Price invalidated entry', currentPrice);
        this.repository.save(updated);
        console.log(`[PaperTrading] Trade cancelled (invalidated): ${trade.id.slice(0, 8)}`);
      }
      
    } else if (trade.state === 'OPEN' || trade.state === 'PARTIAL') {
      // Check stop-loss first
      if (this.isStopHit(trade, candle)) {
        let exitPrice = trade.currentStopLoss;
        let exitFees = 0;
        
        // Apply slippage on exit (stop-loss gets worse fill)
        if (this.useRealisticExecution && trade.entryPrice) {
          const exitResult = this.executionSimulator.simulateExit(
            trade.currentStopLoss,
            trade.remainingQuantity || trade.quantity,
            trade.direction
          );
          exitPrice = exitResult.executedPrice;
          exitFees = exitResult.fees.total;
          
          trade.notes.push(`Stop slippage: ${exitResult.slippageAmount.toFixed(2)}`);
          trade.notes.push(`Exit fees: ${exitFees.toFixed(2)}`);
        }
        
        // Handle stop with partial exits if applicable
        if (trade.partialExits && trade.partialExits.length > 0) {
          const updated = handleStopWithPartialExits(trade, exitPrice);
          // Deduct fees from P&L
          if (this.useRealisticExecution && updated.pnl !== null) {
            updated.pnl -= exitFees;
          }
          this.repository.save(updated);
          this.riskManager.updateCapital(updated.pnl || 0);
          console.log(`[PaperTrading] Trade stopped (partial): ${trade.id.slice(0, 8)} @ ${exitPrice.toFixed(2)} | Net P&L: ${updated.pnl?.toFixed(2) || 0}`);
        } else {
          const updated = TradeStateMachine.stopTrade(trade, exitPrice);
          // Deduct fees from P&L
          if (this.useRealisticExecution && updated.pnl !== null) {
            updated.pnl -= exitFees;
          }
          this.repository.save(updated);
          this.riskManager.updateCapital(updated.pnl || 0);
          console.log(`[PaperTrading] Trade stopped: ${trade.id.slice(0, 8)} @ ${exitPrice.toFixed(2)} | Net P&L: ${updated.pnl?.toFixed(2) || 0}`);
        }
        return;
      }
      
      // Process partial exits if enabled
      if (this.usePartialTPs && trade.partialExits && trade.partialExits.length > 0) {
        const partialResult = processPartialExits(trade, candle, this.partialTPConfig);
        
        if (partialResult.exitTriggered) {
          const updated = applyPartialExit(trade, partialResult);
          this.repository.save(updated);
          
          // Update capital with realized P&L
          if (partialResult.pnl) {
            this.riskManager.updateCapital(partialResult.pnl);
          }
          
          console.log(`[PaperTrading] Partial exit (${partialResult.exitId}): ${trade.id.slice(0, 8)} @ ${partialResult.exitPrice?.toFixed(2)} | P&L: ${partialResult.pnl?.toFixed(2)}`);
          console.log(`  ${getPartialExitsSummary(updated)}`);
          
          // If stop was moved to break-even, log it
          if (partialResult.newStopLoss !== undefined) {
            console.log(`  Stop moved to break-even: ${partialResult.newStopLoss.toFixed(2)}`);
          }
          
          // If all exits complete, trade is done
          if (partialResult.allExitsComplete) {
            console.log(`[PaperTrading] All TPs hit: ${trade.id.slice(0, 8)} | Total P&L: ${updated.pnl?.toFixed(2) || 0}`);
          }
          
          return;
        }
      } else {
        // Original target check (no partial TPs)
        if (this.isTargetHit(trade, candle)) {
          let exitPrice = trade.target;
          let exitFees = 0;
          
          // Apply slippage on target exit
          if (this.useRealisticExecution && trade.entryPrice) {
            const exitResult = this.executionSimulator.simulateExit(
              trade.target,
              trade.quantity,
              trade.direction
            );
            exitPrice = exitResult.executedPrice;
            exitFees = exitResult.fees.total;
            
            trade.notes.push(`Target slippage: ${exitResult.slippageAmount.toFixed(2)}`);
            trade.notes.push(`Exit fees: ${exitFees.toFixed(2)}`);
          }
          
          const updated = TradeStateMachine.closeTrade(trade, exitPrice);
          // Deduct fees from P&L
          if (this.useRealisticExecution && updated.pnl !== null) {
            updated.pnl -= exitFees;
          }
          this.repository.save(updated);
          this.riskManager.updateCapital(updated.pnl || 0);
          console.log(`[PaperTrading] Trade closed: ${trade.id.slice(0, 8)} @ ${exitPrice.toFixed(2)} | Net P&L: ${updated.pnl?.toFixed(2) || 0}`);
          return;
        }
      }
      
      // Update trailing stop
      if (this.trailingConfig.enabled) {
        this.updateTrailingStop(trade, candle);
      }
      
      // Update unrealized P&L
      if (trade.entryPrice) {
        trade.unrealizedPnl = calculateUnrealizedPnl(trade, candle.close);
      }
    }
  }
  
  /**
   * Update trailing stop for open trade
   */
  private updateTrailingStop(trade: Trade, candle: Candle): void {
    if (!trade.entryPrice) return;
    
    const currentPrice = candle.close;
    const entryPrice = trade.entryPrice;
    const initialRisk = Math.abs(entryPrice - trade.initialStopLoss);
    
    if (initialRisk === 0) return;
    
    // Calculate current profit in R
    const currentProfitR = trade.direction === 'LONG'
      ? (currentPrice - entryPrice) / initialRisk
      : (entryPrice - currentPrice) / initialRisk;
    
    let newStopLoss: number | null = null;
    
    switch (this.trailingConfig.type) {
      case 'breakeven':
        // Move to breakeven after X R profit
        if (currentProfitR >= this.trailingConfig.breakevenTriggerR) {
          if (trade.currentStopLoss !== entryPrice) {
            newStopLoss = entryPrice;
          }
        }
        break;
        
      case 'step':
        // Trail in steps
        const stepsAhead = Math.floor(currentProfitR / this.trailingConfig.stepSizeR);
        if (stepsAhead > 0) {
          const trailedStop = trade.direction === 'LONG'
            ? entryPrice + ((stepsAhead - 1) * this.trailingConfig.stepSizeR * initialRisk)
            : entryPrice - ((stepsAhead - 1) * this.trailingConfig.stepSizeR * initialRisk);
          
          // Only update if new stop is better
          if (trade.direction === 'LONG' && trailedStop > trade.currentStopLoss) {
            newStopLoss = trailedStop;
          } else if (trade.direction === 'SHORT' && trailedStop < trade.currentStopLoss) {
            newStopLoss = trailedStop;
          }
        }
        break;
        
      case 'atr':
        // Trail at X ATR from current price
        // This requires ATR to be passed in, for now use simple trailing
        const trailDistance = initialRisk * this.trailingConfig.atrMultiplier;
        const atrStop = trade.direction === 'LONG'
          ? currentPrice - trailDistance
          : currentPrice + trailDistance;
        
        if (trade.direction === 'LONG' && atrStop > trade.currentStopLoss) {
          newStopLoss = atrStop;
        } else if (trade.direction === 'SHORT' && atrStop < trade.currentStopLoss) {
          newStopLoss = atrStop;
        }
        break;
    }
    
    // Update stop if changed
    if (newStopLoss !== null && newStopLoss !== trade.currentStopLoss) {
      const oldStop = trade.currentStopLoss;
      trade.currentStopLoss = newStopLoss;
      trade.notes.push(`Trailing stop: ${oldStop.toFixed(2)} -> ${newStopLoss.toFixed(2)}`);
      this.repository.save(trade);
      console.log(`[PaperTrading] Trailing stop updated: ${trade.id.slice(0, 8)} | ${oldStop.toFixed(2)} -> ${newStopLoss.toFixed(2)}`);
    }
  }
  
  /**
   * Check if entry is hit
   */
  private isEntryHit(trade: Trade, candle: Candle): boolean {
    // For simplicity, trigger entry when price touches signal price
    const signalPrice = trade.signalPrice;
    
    if (trade.direction === 'LONG') {
      return candle.low <= signalPrice && candle.close >= signalPrice;
    } else {
      return candle.high >= signalPrice && candle.close <= signalPrice;
    }
  }
  
  /**
   * Check if trade is invalidated (price moved too far against)
   */
  private isInvalidated(trade: Trade, candle: Candle): boolean {
    // If price breaks stop before entry, invalidate
    if (trade.direction === 'LONG') {
      return candle.low < trade.initialStopLoss;
    } else {
      return candle.high > trade.initialStopLoss;
    }
  }
  
  /**
   * Check if stop-loss is hit
   */
  private isStopHit(trade: Trade, candle: Candle): boolean {
    if (trade.direction === 'LONG') {
      return candle.low <= trade.currentStopLoss;
    } else {
      return candle.high >= trade.currentStopLoss;
    }
  }
  
  /**
   * Check if target is hit
   */
  private isTargetHit(trade: Trade, candle: Candle): boolean {
    if (trade.direction === 'LONG') {
      return candle.high >= trade.target;
    } else {
      return candle.low <= trade.target;
    }
  }
  
  /**
   * Get open trades
   */
  getOpenTrades(): Trade[] {
    return this.repository.getOpenTrades();
  }
  
  /**
   * Get trade statistics
   */
  getStats() {
    return this.repository.getStats();
  }
  
  /**
   * Get current capital
   */
  getCapital(): number {
    return this.riskManager.getCapital();
  }
}

export default PaperTradingEngine;

