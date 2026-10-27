import { Signal, Trade } from '../types';
import { TradeRepository } from '../db/TradeRepository';
import { DEFAULT_CONFIG } from '../config/default';

/**
 * Risk check result
 */
export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
  adjustedRiskPercent?: number;
}

/**
 * Risk Manager
 * Handles position sizing and risk rule validation
 */
export class RiskManager {
  private capital: number;
  private maxRiskPerTrade: number;
  private maxOpenTrades: number;
  private minRiskReward: number;
  private maxDailyTrades: number;
  private repository: TradeRepository;
  
  constructor(
    capital?: number,
    repository?: TradeRepository
  ) {
    this.capital = capital || DEFAULT_CONFIG.initialCapital;
    this.maxRiskPerTrade = DEFAULT_CONFIG.riskRules.maxRiskPerTrade;
    this.maxOpenTrades = DEFAULT_CONFIG.riskRules.maxOpenTrades;
    this.minRiskReward = DEFAULT_CONFIG.riskRules.minRiskReward;
    this.maxDailyTrades = DEFAULT_CONFIG.riskRules.maxDailyTrades;
    this.repository = repository || new TradeRepository();
  }
  
  /**
   * Check if a new trade is allowed based on risk rules
   */
  checkRisk(signal: Signal): RiskCheckResult {
    // Rule 1: Check minimum R:R ratio
    if (signal.riskRewardRatio < this.minRiskReward) {
      return {
        allowed: false,
        reason: `Risk:Reward ratio ${signal.riskRewardRatio.toFixed(2)} below minimum ${this.minRiskReward}`,
      };
    }
    
    // Rule 2: Check max open trades
    const openTrades = this.repository.getOpenTrades();
    if (openTrades.length >= this.maxOpenTrades) {
      return {
        allowed: false,
        reason: `Maximum open trades (${this.maxOpenTrades}) reached`,
      };
    }
    
    // Rule 3: Check max daily trades
    const tradesToday = this.repository.countTradesToday();
    if (tradesToday >= this.maxDailyTrades) {
      return {
        allowed: false,
        reason: `Maximum daily trades (${this.maxDailyTrades}) reached`,
      };
    }
    
    // Rule 4: Check for duplicate signals (same pattern, same symbol, pending/open)
    const duplicates = openTrades.filter(t => 
      t.patternId === signal.patternId && 
      t.symbol === signal.symbol &&
      t.direction === signal.direction
    );
    if (duplicates.length > 0) {
      return {
        allowed: false,
        reason: 'Duplicate signal - already have open trade from same pattern',
      };
    }
    
    return {
      allowed: true,
      reason: 'All risk checks passed',
      adjustedRiskPercent: Math.min(signal.suggestedRiskPercent / 100, this.maxRiskPerTrade),
    };
  }
  
  /**
   * Calculate position size based on risk
   *
   * @param entryPrice - The price the order will actually fill at
   * @param stopLoss - The stop-loss price
   * @param riskPercent - Risk fraction to use (defaults to maxRiskPerTrade)
   * @param equity - Account equity AT THE MOMENT OF FILL. Defaults to the
   *   realised capital. The Python engine sizes on equity that includes the
   *   unrealised P&L of open positions, so the two engines would disagree on
   *   position size if this were left as realised capital only.
   */
  calculatePositionSize(
    entryPrice: number,
    stopLoss: number,
    riskPercent?: number,
    equity?: number
  ): { quantity: number; riskAmount: number; riskPercent: number } {
    const actualRiskPercent = riskPercent || this.maxRiskPerTrade;
    const baseEquity = equity ?? this.capital;
    const riskAmount = baseEquity * actualRiskPercent;
    
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    
    if (riskPerUnit === 0) {
      return { quantity: 0, riskAmount: 0, riskPercent: actualRiskPercent };
    }
    
    const quantity = riskAmount / riskPerUnit;
    
    return {
      quantity,
      riskAmount,
      riskPercent: actualRiskPercent,
    };
  }
  
  /**
   * Update capital (after trade closes)
   */
  updateCapital(pnl: number): void {
    this.capital += pnl;
    console.log(`[RiskManager] Capital updated: ${this.capital.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})`);
  }
  
  /**
   * Get current capital
   */
  getCapital(): number {
    return this.capital;
  }

  /**
   * Get account equity including the unrealised P&L of open positions.
   *
   * This is the equity basis the Python engine uses when sizing a position
   * (`_calculate_equity` in the backtest engine). Sizing on realised capital
   * alone would make the two engines disagree on position size whenever a
   * position is already open.
   *
   * @param markPrice - Optional mark price applied to every open position.
   *   When omitted, each position contributes its last recorded unrealised
   *   P&L.
   */
  getEquity(markPrice?: number): number {
    let equity = this.capital;

    for (const trade of this.repository.getOpenTrades()) {
      if (trade.entryPrice === null || trade.entryPrice === undefined) {
        continue;
      }

      if (markPrice !== undefined) {
        const unrealized = trade.direction === 'LONG'
          ? (markPrice - trade.entryPrice) * trade.quantity
          : (trade.entryPrice - markPrice) * trade.quantity;
        equity += unrealized;
      } else if (trade.unrealizedPnl !== null && trade.unrealizedPnl !== undefined) {
        equity += trade.unrealizedPnl;
      }
    }

    return equity;
  }
  
  /**
   * Get current open exposure
   */
  getOpenExposure(): { totalRisk: number; tradeCount: number } {
    const openTrades = this.repository.getOpenTrades();
    const totalRisk = openTrades.reduce((sum, t) => sum + t.riskAmount, 0);
    
    return {
      totalRisk,
      tradeCount: openTrades.length,
    };
  }
  
  /**
   * Check if drawdown circuit breaker should trigger
   */
  checkDrawdownCircuitBreaker(maxDrawdownPercent: number = 0.06): boolean {
    const stats = this.repository.getStats();
    const dailyPnl = stats.totalPnl;
    const dailyDrawdownPercent = Math.abs(dailyPnl) / this.capital;
    
    if (dailyPnl < 0 && dailyDrawdownPercent >= maxDrawdownPercent) {
      console.log(`[RiskManager] Circuit breaker triggered: ${(dailyDrawdownPercent * 100).toFixed(1)}% daily drawdown`);
      return true;
    }
    
    return false;
  }
}

export default RiskManager;

