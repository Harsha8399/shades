import { Direction, Timeframe } from './candle';

/**
 * Execution type for trading
 */
export type ExecutionType = 'SPOT' | 'FUTURES' | 'OPTIONS';

/**
 * F&O Instrument details for a trade
 */
export interface TradeInstrument {
  symbol: string;           // NIFTY24JAN22450CE or NIFTY24JANFUT
  type: 'FUTURE' | 'CE' | 'PE';
  strike?: number;          // For options
  expiry?: string;          // Expiry date string
  lotSize: number;
  premium?: number;         // Entry premium price
  delta?: number;           // For options (0.5 for ATM)
  numLots?: number;         // Number of lots traded
}

/**
 * Trade lifecycle states
 */
export type TradeState = 
  | 'PENDING'     // Signal generated, waiting for entry
  | 'OPEN'        // Position active
  | 'PARTIAL'     // Some profit taken, position still open
  | 'CLOSED'      // Exited at target
  | 'STOPPED'     // Exited at stop-loss
  | 'CANCELLED'   // Signal invalidated before entry
  | 'EXPIRED';    // Entry window expired

/**
 * Partial exit configuration (take profit level)
 */
export interface PartialExit {
  id: string;               // Unique identifier (tp1, tp2, tp3)
  level: number;            // Price level for this TP
  percentage: number;       // % of position to close (0-1)
  rMultiple: number;        // Target in R-multiples
  triggered: boolean;       // Has this TP been hit?
  exitPrice?: number;       // Actual exit price (with slippage)
  exitTime?: Date;          // When this TP was hit
  pnl?: number;             // P&L from this partial exit
}

/**
 * Default TP configuration for patterns
 */
export interface PartialTPConfig {
  tp1: { rMultiple: number; percentage: number };
  tp2: { rMultiple: number; percentage: number };
  tp3: { rMultiple: number; percentage: number };
  moveToBreakEvenAfter: 'TP1' | 'TP2' | null;
}

/**
 * Default partial TP configuration
 */
export const DEFAULT_PARTIAL_TP_CONFIG: PartialTPConfig = {
  tp1: { rMultiple: 1, percentage: 0.5 },     // 50% at 1R
  tp2: { rMultiple: 2, percentage: 0.3 },     // 30% at 2R
  tp3: { rMultiple: 3, percentage: 0.2 },     // 20% at 3R (runner)
  moveToBreakEvenAfter: 'TP1',
};

/**
 * State transition record for audit trail
 */
export interface StateTransition {
  from: TradeState | null;  // null for initial state
  to: TradeState;
  timestamp: Date;
  reason: string;
  price: number;
}

/**
 * Paper trade representation
 */
export interface Trade {
  // Identity
  id: string;
  patternId: string;
  patternName: string;
  
  // Underlying Instrument
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  
  // F&O Execution (optional - null for spot)
  executionType: ExecutionType;
  instrument?: TradeInstrument;   // Present for FUTURES/OPTIONS
  
  // State
  state: TradeState;
  stateHistory: StateTransition[];
  
  // Prices
  signalPrice: number;            // Price when signal generated
  entryPrice: number | null;      // Actual entry price
  initialStopLoss: number;
  currentStopLoss: number;        // May be trailed
  target: number;
  exitPrice: number | null;
  
  // Position Sizing
  quantity: number;
  remainingQuantity: number;      // Quantity still open after partial TPs
  riskAmount: number;             // $ at risk
  riskPercent: number;            // % of capital risked
  
  // Partial Profit Taking
  partialExits: PartialExit[];    // TP levels and their status
  realizedPnl: number;            // P&L from closed portions
  unrealizedPnl: number;          // P&L from open portion
  
  // Timestamps
  signalTime: Date;
  entryTime: Date | null;
  exitTime: Date | null;
  expiryTime: Date;               // Signal expires if not filled
  
  // Results (populated on close)
  pnl: number | null;             // Total P&L in $
  pnlPercent: number | null;      // Profit/Loss in %
  rMultiple: number | null;       // Result in R (risk units)
  averageExitPrice: number | null; // Weighted avg exit from partial TPs
  
  // Metadata
  confluenceFactors: string[];
  notes: string[];
  tags: string[];
}

/**
 * Filters for querying trades
 */
export interface TradeFilters {
  states?: TradeState[];
  patterns?: string[];
  symbols?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  minRMultiple?: number;
  maxRMultiple?: number;
}

/**
 * Trade statistics summary
 */
export interface TradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRMultiple: number;
  totalPnl: number;
}

/**
 * Calculate R-multiple for a closed trade
 */
export function calculateRMultiple(trade: Trade): number | null {
  if (trade.exitPrice === null || trade.entryPrice === null) {
    return null;
  }
  
  const risk = Math.abs(trade.entryPrice - trade.initialStopLoss);
  if (risk === 0) return null;
  
  const pnl = trade.direction === 'LONG'
    ? trade.exitPrice - trade.entryPrice
    : trade.entryPrice - trade.exitPrice;
  
  return pnl / risk;
}

/**
 * Check if trade is in a terminal state
 */
export function isTradeComplete(trade: Trade): boolean {
  return ['CLOSED', 'STOPPED', 'CANCELLED', 'EXPIRED'].includes(trade.state);
}

/**
 * Check if trade is active (can be updated)
 */
export function isTradeActive(trade: Trade): boolean {
  return ['PENDING', 'OPEN', 'PARTIAL'].includes(trade.state);
}

/**
 * Create partial exit levels from config
 */
export function createPartialExits(
  entryPrice: number,
  stopLoss: number,
  direction: Direction,
  config: PartialTPConfig = DEFAULT_PARTIAL_TP_CONFIG
): PartialExit[] {
  const risk = Math.abs(entryPrice - stopLoss);
  
  const exits: PartialExit[] = [];
  
  // TP1
  const tp1Price = direction === 'LONG'
    ? entryPrice + (risk * config.tp1.rMultiple)
    : entryPrice - (risk * config.tp1.rMultiple);
  
  exits.push({
    id: 'tp1',
    level: tp1Price,
    percentage: config.tp1.percentage,
    rMultiple: config.tp1.rMultiple,
    triggered: false,
  });
  
  // TP2
  const tp2Price = direction === 'LONG'
    ? entryPrice + (risk * config.tp2.rMultiple)
    : entryPrice - (risk * config.tp2.rMultiple);
  
  exits.push({
    id: 'tp2',
    level: tp2Price,
    percentage: config.tp2.percentage,
    rMultiple: config.tp2.rMultiple,
    triggered: false,
  });
  
  // TP3
  const tp3Price = direction === 'LONG'
    ? entryPrice + (risk * config.tp3.rMultiple)
    : entryPrice - (risk * config.tp3.rMultiple);
  
  exits.push({
    id: 'tp3',
    level: tp3Price,
    percentage: config.tp3.percentage,
    rMultiple: config.tp3.rMultiple,
    triggered: false,
  });
  
  return exits;
}

/**
 * Calculate weighted average exit price from partial exits
 */
export function calculateAverageExitPrice(partialExits: PartialExit[]): number | null {
  const triggeredExits = partialExits.filter(e => e.triggered && e.exitPrice);
  
  if (triggeredExits.length === 0) return null;
  
  let totalValue = 0;
  let totalPercentage = 0;
  
  for (const exit of triggeredExits) {
    totalValue += (exit.exitPrice ?? 0) * exit.percentage;
    totalPercentage += exit.percentage;
  }
  
  return totalPercentage > 0 ? totalValue / totalPercentage : null;
}

/**
 * Get total realized P&L from partial exits
 */
export function getTotalRealizedPnl(partialExits: PartialExit[]): number {
  return partialExits
    .filter(e => e.triggered)
    .reduce((sum, e) => sum + (e.pnl ?? 0), 0);
}

/**
 * Check if all partial exits have been triggered
 */
export function allPartialExitsTriggered(partialExits: PartialExit[]): boolean {
  return partialExits.every(e => e.triggered);
}

/**
 * Get next untriggered partial exit
 */
export function getNextPartialExit(partialExits: PartialExit[]): PartialExit | null {
  return partialExits.find(e => !e.triggered) ?? null;
}

