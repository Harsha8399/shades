/**
 * Partial Profit Manager
 * 
 * Handles the logic for taking partial profits at multiple levels:
 * - TP1: Take 50% at 1R, move stop to break-even
 * - TP2: Take 30% at 2R, trail stop
 * - TP3: Let 20% run as a "runner"
 */
import { Candle, Trade, Direction, PartialExit, PartialTPConfig, DEFAULT_PARTIAL_TP_CONFIG } from '../types';

/**
 * Result of processing partial exits
 */
export interface PartialExitResult {
  exitTriggered: boolean;
  exitId?: string;
  exitPrice?: number;
  exitQuantity?: number;
  pnl?: number;
  newStopLoss?: number;
  allExitsComplete?: boolean;
}

/**
 * Check if a price level was hit by a candle
 */
function priceHit(level: number, candle: Candle, direction: Direction): boolean {
  if (direction === 'LONG') {
    // For long, TP is above entry - check if high reached it
    return candle.high >= level;
  } else {
    // For short, TP is below entry - check if low reached it
    return candle.low <= level;
  }
}

/**
 * Process partial exits for a trade
 */
export function processPartialExits(
  trade: Trade,
  candle: Candle,
  config: PartialTPConfig = DEFAULT_PARTIAL_TP_CONFIG
): PartialExitResult {
  if (!trade.entryPrice || trade.partialExits.length === 0) {
    return { exitTriggered: false };
  }
  
  // Find next untriggered exit
  const nextExit = trade.partialExits.find(e => !e.triggered);
  
  if (!nextExit) {
    return { exitTriggered: false, allExitsComplete: true };
  }
  
  // Check if this level was hit
  if (!priceHit(nextExit.level, candle, trade.direction)) {
    return { exitTriggered: false };
  }
  
  // Calculate exit details
  const exitPrice = getExitPrice(nextExit.level, candle, trade.direction);
  const exitQuantity = trade.quantity * nextExit.percentage;
  const pnl = calculatePartialPnl(trade.entryPrice, exitPrice, exitQuantity, trade.direction);
  
  // Mark as triggered
  nextExit.triggered = true;
  nextExit.exitPrice = exitPrice;
  nextExit.exitTime = new Date();
  nextExit.pnl = pnl;
  
  // Determine if we should move stop to break-even
  let newStopLoss: number | undefined;
  
  if (nextExit.id === 'tp1' && config.moveToBreakEvenAfter === 'TP1') {
    newStopLoss = trade.entryPrice;
  } else if (nextExit.id === 'tp2' && config.moveToBreakEvenAfter === 'TP2') {
    newStopLoss = trade.entryPrice;
  }
  
  // Check if all exits are now complete
  const allExitsComplete = trade.partialExits.every(e => e.triggered);
  
  return {
    exitTriggered: true,
    exitId: nextExit.id,
    exitPrice,
    exitQuantity,
    pnl,
    newStopLoss,
    allExitsComplete,
  };
}

/**
 * Get actual exit price (accounting for potential gaps)
 */
function getExitPrice(level: number, candle: Candle, direction: Direction): number {
  // In real trading, might not get exact level due to gaps
  // For paper trading, we use the level or the open if gapped past
  
  if (direction === 'LONG') {
    // If opened above our level, we exit at open (gap up)
    if (candle.open >= level) {
      return candle.open;
    }
    return level;
  } else {
    // If opened below our level, we exit at open (gap down)
    if (candle.open <= level) {
      return candle.open;
    }
    return level;
  }
}

/**
 * Calculate P&L for a partial exit
 */
function calculatePartialPnl(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  direction: Direction
): number {
  if (direction === 'LONG') {
    return (exitPrice - entryPrice) * quantity;
  } else {
    return (entryPrice - exitPrice) * quantity;
  }
}

/**
 * Update trade after partial exit
 */
export function applyPartialExit(
  trade: Trade,
  result: PartialExitResult
): Trade {
  if (!result.exitTriggered) {
    return trade;
  }
  
  // Update remaining quantity
  trade.remainingQuantity -= result.exitQuantity ?? 0;
  
  // Update realized P&L
  trade.realizedPnl = (trade.realizedPnl ?? 0) + (result.pnl ?? 0);
  
  // Update stop loss if needed
  if (result.newStopLoss !== undefined) {
    trade.currentStopLoss = result.newStopLoss;
  }
  
  // Update state
  if (result.allExitsComplete) {
    // All TPs hit - trade is closed
    trade.state = 'CLOSED';
    trade.exitTime = new Date();
    trade.pnl = trade.realizedPnl;
    trade.averageExitPrice = calculateWeightedAverageExit(trade.partialExits);
  } else if (trade.state === 'OPEN') {
    // Some TPs hit - move to PARTIAL state
    trade.state = 'PARTIAL';
  }
  
  return trade;
}

/**
 * Calculate weighted average exit price
 */
function calculateWeightedAverageExit(partialExits: PartialExit[]): number | null {
  const triggered = partialExits.filter(e => e.triggered && e.exitPrice);
  
  if (triggered.length === 0) return null;
  
  let totalValue = 0;
  let totalWeight = 0;
  
  for (const exit of triggered) {
    totalValue += (exit.exitPrice ?? 0) * exit.percentage;
    totalWeight += exit.percentage;
  }
  
  return totalWeight > 0 ? totalValue / totalWeight : null;
}

/**
 * Handle stop loss with remaining quantity
 */
export function handleStopWithPartialExits(
  trade: Trade,
  stopPrice: number
): Trade {
  // Calculate loss on remaining quantity
  const remainingPnl = trade.direction === 'LONG'
    ? (stopPrice - (trade.entryPrice ?? 0)) * trade.remainingQuantity
    : ((trade.entryPrice ?? 0) - stopPrice) * trade.remainingQuantity;
  
  // Total P&L is realized + remaining
  trade.pnl = trade.realizedPnl + remainingPnl;
  trade.unrealizedPnl = 0;
  trade.state = 'STOPPED';
  trade.exitTime = new Date();
  trade.exitPrice = stopPrice;
  
  // If we had any partial TPs, include them in average
  if (trade.partialExits.some(e => e.triggered)) {
    // Weight the stop price with remaining quantity
    const triggeredExits = trade.partialExits.filter(e => e.triggered);
    let totalValue = triggeredExits.reduce((sum, e) => sum + (e.exitPrice ?? 0) * e.percentage, 0);
    let totalWeight = triggeredExits.reduce((sum, e) => sum + e.percentage, 0);
    
    // Add stop price weighted by remaining
    const remainingPercentage = trade.remainingQuantity / trade.quantity;
    totalValue += stopPrice * remainingPercentage;
    totalWeight += remainingPercentage;
    
    trade.averageExitPrice = totalValue / totalWeight;
  } else {
    trade.averageExitPrice = stopPrice;
  }
  
  return trade;
}

/**
 * Calculate current unrealized P&L
 */
export function calculateUnrealizedPnl(trade: Trade, currentPrice: number): number {
  if (!trade.entryPrice || trade.remainingQuantity <= 0) {
    return 0;
  }
  
  if (trade.direction === 'LONG') {
    return (currentPrice - trade.entryPrice) * trade.remainingQuantity;
  } else {
    return (trade.entryPrice - currentPrice) * trade.remainingQuantity;
  }
}

/**
 * Get summary of partial exits for logging
 */
export function getPartialExitsSummary(trade: Trade): string {
  const triggered = trade.partialExits.filter(e => e.triggered);
  const pending = trade.partialExits.filter(e => !e.triggered);
  
  const parts = [
    `Triggered: ${triggered.length}/${trade.partialExits.length}`,
    `Realized: $${trade.realizedPnl.toFixed(2)}`,
    `Remaining: ${((trade.remainingQuantity / trade.quantity) * 100).toFixed(0)}%`,
  ];
  
  return parts.join(' | ');
}

export default {
  processPartialExits,
  applyPartialExit,
  handleStopWithPartialExits,
  calculateUnrealizedPnl,
  getPartialExitsSummary,
};

