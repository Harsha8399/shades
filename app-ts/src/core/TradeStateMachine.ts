import { Trade, TradeState, StateTransition } from '../types';

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<TradeState, TradeState[]> = {
  PENDING: ['OPEN', 'CANCELLED', 'EXPIRED'],
  OPEN: ['PARTIAL', 'CLOSED', 'STOPPED'],
  PARTIAL: ['PARTIAL', 'CLOSED', 'STOPPED'],  // Can take more partials or close
  CLOSED: [],
  STOPPED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/**
 * Trade State Machine
 * Manages trade lifecycle and ensures valid state transitions
 */
export class TradeStateMachine {
  /**
   * Check if a state transition is valid
   */
  static isValidTransition(from: TradeState, to: TradeState): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }
  
  /**
   * Get allowed next states for current state
   */
  static getAllowedTransitions(state: TradeState): TradeState[] {
    return VALID_TRANSITIONS[state];
  }
  
  /**
   * Check if trade is in a terminal state
   */
  static isTerminal(state: TradeState): boolean {
    return VALID_TRANSITIONS[state].length === 0;
  }
  
  /**
   * Transition trade to new state
   *
   * @param atTime Optional timestamp for the transition. When the engine is
   *   replaying historical candles this MUST be the originating candle's
   *   timestamp, so that a replayed trade is directly comparable with the
   *   research engine bar for bar. When omitted, the wall clock is used
   *   (live trading), which is the correct default for that case.
   * @throws Error if transition is invalid
   */
  static transition(trade: Trade, newState: TradeState, reason: string, price: number, atTime?: Date): Trade {
    if (!this.isValidTransition(trade.state, newState)) {
      throw new Error(
        `Invalid state transition: ${trade.state} -> ${newState}. ` +
        `Allowed: ${VALID_TRANSITIONS[trade.state].join(', ')}`
      );
    }
    
    const transition: StateTransition = {
      from: trade.state,
      to: newState,
      timestamp: atTime ?? new Date(),
      reason,
      price,
    };
    
    trade.stateHistory.push(transition);
    trade.state = newState;
    
    return trade;
  }
  
  /**
   * Open a pending trade (trigger entry)
   */
  static openTrade(trade: Trade, entryPrice: number, atTime?: Date): Trade {
    if (trade.state !== 'PENDING') {
      throw new Error(`Cannot open trade in state ${trade.state}`);
    }
    
    trade = this.transition(trade, 'OPEN', 'Entry triggered', entryPrice, atTime);
    trade.entryPrice = entryPrice;
    trade.entryTime = atTime ?? new Date();
    
    return trade;
  }
  
  /**
   * Close trade at target
   */
  static closeTrade(trade: Trade, exitPrice: number, atTime?: Date): Trade {
    if (trade.state !== 'OPEN') {
      throw new Error(`Cannot close trade in state ${trade.state}`);
    }
    
    trade = this.transition(trade, 'CLOSED', 'Target hit', exitPrice, atTime);
    trade.exitPrice = exitPrice;
    trade.exitTime = atTime ?? new Date();
    
    // Calculate P&L
    trade = this.calculatePnL(trade);
    
    return trade;
  }
  
  /**
   * Stop trade at stop-loss
   */
  static stopTrade(trade: Trade, exitPrice: number, atTime?: Date): Trade {
    if (trade.state !== 'OPEN') {
      throw new Error(`Cannot stop trade in state ${trade.state}`);
    }
    
    trade = this.transition(trade, 'STOPPED', 'Stop-loss hit', exitPrice, atTime);
    trade.exitPrice = exitPrice;
    trade.exitTime = atTime ?? new Date();
    
    // Calculate P&L
    trade = this.calculatePnL(trade);
    
    return trade;
  }
  
  /**
   * Cancel a pending trade
   */
  static cancelTrade(trade: Trade, reason: string, price: number, atTime?: Date): Trade {
    if (trade.state !== 'PENDING') {
      throw new Error(`Cannot cancel trade in state ${trade.state}`);
    }
    
    return this.transition(trade, 'CANCELLED', reason, price, atTime);
  }
  
  /**
   * Expire a pending trade
   */
  static expireTrade(trade: Trade, price: number, atTime?: Date): Trade {
    if (trade.state !== 'PENDING') {
      throw new Error(`Cannot expire trade in state ${trade.state}`);
    }
    
    return this.transition(trade, 'EXPIRED', 'Entry window expired', price, atTime);
  }
  
  /**
   * Calculate P&L for closed trade
   */
  private static calculatePnL(trade: Trade): Trade {
    if (trade.entryPrice === null || trade.exitPrice === null) {
      return trade;
    }
    
    const pnlPerUnit = trade.direction === 'LONG'
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
    
    trade.pnl = pnlPerUnit * trade.quantity;
    trade.pnlPercent = (pnlPerUnit / trade.entryPrice) * 100;
    
    // Calculate R-multiple
    const risk = Math.abs(trade.entryPrice - trade.initialStopLoss);
    trade.rMultiple = risk > 0 ? pnlPerUnit / risk : 0;
    
    return trade;
  }
  
  /**
   * Update trailing stop
   */
  static updateTrailingStop(trade: Trade, newStopLoss: number): Trade {
    if (trade.state !== 'OPEN') {
      throw new Error(`Cannot update stop for trade in state ${trade.state}`);
    }
    
    // Validate new stop is better than current
    if (trade.direction === 'LONG' && newStopLoss <= trade.currentStopLoss) {
      throw new Error('New stop must be higher for long trades');
    }
    if (trade.direction === 'SHORT' && newStopLoss >= trade.currentStopLoss) {
      throw new Error('New stop must be lower for short trades');
    }
    
    trade.currentStopLoss = newStopLoss;
    trade.notes.push(`Trailing stop updated to ${newStopLoss.toFixed(2)}`);
    
    return trade;
  }
}

export default TradeStateMachine;

