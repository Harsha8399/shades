/**
 * Execution Simulator
 * 
 * Simulates realistic trade execution with:
 * - Slippage on entry and exit
 * - Brokerage fees
 * - Taxes (STT, stamp duty, GST)
 * - Exchange charges
 */
import { Trade, Direction } from '../types';
import {
  MarketSegment,
  FeeStructure,
  INDIAN_MARKET_FEES,
  calculateTradeFees,
  applySlippage,
} from '../config/indianMarket';

/**
 * Execution result with all costs
 */
export interface ExecutionResult {
  executedPrice: number;       // Price after slippage
  slippageAmount: number;      // Slippage cost
  fees: {
    brokerage: number;
    stt: number;
    exchangeCharges: number;
    sebiCharges: number;
    stampDuty: number;
    gst: number;
    total: number;
  };
  netPrice: number;            // Effective price including all costs
}

/**
 * Trade P&L breakdown
 */
export interface PnLBreakdown {
  grossPnl: number;            // Before fees
  totalFees: number;           // Entry + exit fees
  netPnl: number;              // After fees
  feesAsPercent: number;       // Fees as % of trade value
}

/**
 * Execution Simulator class
 */
export class ExecutionSimulator {
  private segment: MarketSegment;
  private fees: FeeStructure;
  
  constructor(segment: MarketSegment = 'NSE_EQUITY') {
    this.segment = segment;
    this.fees = INDIAN_MARKET_FEES[segment];
  }
  
  /**
   * Set market segment
   */
  setSegment(segment: MarketSegment): void {
    this.segment = segment;
    this.fees = INDIAN_MARKET_FEES[segment];
  }
  
  /**
   * Simulate entry execution
   */
  simulateEntry(
    idealPrice: number,
    quantity: number,
    direction: Direction
  ): ExecutionResult {
    // For entry: LONG = buy (price goes up), SHORT = sell (price goes down)
    const isBuy = direction === 'LONG';
    
    // Apply slippage
    const executedPrice = applySlippage(idealPrice, isBuy, this.segment);
    const slippageAmount = Math.abs(executedPrice - idealPrice) * quantity;
    
    // Calculate fees
    const tradeValue = executedPrice * quantity;
    const feeDetails = calculateTradeFees(tradeValue, this.segment, isBuy);
    
    // Net price (effective cost per unit)
    const netPrice = isBuy
      ? executedPrice + (feeDetails.totalFees / quantity)
      : executedPrice - (feeDetails.totalFees / quantity);
    
    return {
      executedPrice,
      slippageAmount,
      fees: {
        brokerage: feeDetails.brokerage,
        stt: feeDetails.stt,
        exchangeCharges: feeDetails.exchangeCharges,
        sebiCharges: feeDetails.sebiCharges,
        stampDuty: feeDetails.stampDuty,
        gst: feeDetails.gst,
        total: feeDetails.totalFees,
      },
      netPrice,
    };
  }
  
  /**
   * Simulate exit execution
   */
  simulateExit(
    idealPrice: number,
    quantity: number,
    direction: Direction
  ): ExecutionResult {
    // For exit: LONG = sell (price goes down), SHORT = buy (price goes up)
    const isBuy = direction === 'SHORT';
    
    // Apply slippage
    const executedPrice = applySlippage(idealPrice, isBuy, this.segment);
    const slippageAmount = Math.abs(executedPrice - idealPrice) * quantity;
    
    // Calculate fees
    const tradeValue = executedPrice * quantity;
    const feeDetails = calculateTradeFees(tradeValue, this.segment, isBuy);
    
    // Net price
    const netPrice = isBuy
      ? executedPrice + (feeDetails.totalFees / quantity)
      : executedPrice - (feeDetails.totalFees / quantity);
    
    return {
      executedPrice,
      slippageAmount,
      fees: {
        brokerage: feeDetails.brokerage,
        stt: feeDetails.stt,
        exchangeCharges: feeDetails.exchangeCharges,
        sebiCharges: feeDetails.sebiCharges,
        stampDuty: feeDetails.stampDuty,
        gst: feeDetails.gst,
        total: feeDetails.totalFees,
      },
      netPrice,
    };
  }
  
  /**
   * Calculate full P&L breakdown for a completed trade
   */
  calculatePnLBreakdown(
    entryPrice: number,
    exitPrice: number,
    quantity: number,
    direction: Direction
  ): PnLBreakdown {
    // Simulate entry
    const entry = this.simulateEntry(entryPrice, quantity, direction);
    
    // Simulate exit
    const exit = this.simulateExit(exitPrice, quantity, direction);
    
    // Calculate gross P&L (without fees)
    const grossPnl = direction === 'LONG'
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
    
    // Total fees
    const totalFees = entry.fees.total + exit.fees.total + entry.slippageAmount + exit.slippageAmount;
    
    // Net P&L
    const netPnl = grossPnl - totalFees;
    
    // Fees as percentage
    const tradeValue = entryPrice * quantity;
    const feesAsPercent = (totalFees / tradeValue) * 100;
    
    return {
      grossPnl,
      totalFees,
      netPnl,
      feesAsPercent,
    };
  }
  
  /**
   * Get execution summary for logging
   */
  getExecutionSummary(result: ExecutionResult): string {
    return `Executed @ ${result.executedPrice.toFixed(2)} | ` +
           `Slippage: ${result.slippageAmount.toFixed(2)} | ` +
           `Fees: ${result.fees.total.toFixed(2)} | ` +
           `Net: ${result.netPrice.toFixed(2)}`;
  }
  
  /**
   * Get P&L summary for logging
   */
  getPnLSummary(breakdown: PnLBreakdown): string {
    return `Gross: ${breakdown.grossPnl.toFixed(2)} | ` +
           `Fees: ${breakdown.totalFees.toFixed(2)} (${breakdown.feesAsPercent.toFixed(2)}%) | ` +
           `Net: ${breakdown.netPnl.toFixed(2)}`;
  }
}

/**
 * Default execution simulator instance
 */
export const defaultExecutionSimulator = new ExecutionSimulator('NSE_EQUITY');

export default ExecutionSimulator;

