import { v4 as uuidv4 } from 'uuid';
import { DatabaseConnection } from './Database';
import { Trade, TradeState, TradeFilters, TradeStats, StateTransition } from '../types';
import { Signal } from '../types';

/**
 * Database row representation of a trade
 */
interface TradeRow {
  id: string;
  pattern_id: string;
  pattern_name: string;
  symbol: string;
  timeframe: string;
  direction: string;
  state: string;
  signal_price: number;
  entry_price: number | null;
  initial_stop_loss: number;
  current_stop_loss: number;
  target: number;
  exit_price: number | null;
  quantity: number;
  risk_amount: number;
  risk_percent: number;
  signal_time: string;
  entry_time: string | null;
  exit_time: string | null;
  expiry_time: string;
  pnl: number | null;
  pnl_percent: number | null;
  r_multiple: number | null;
  confluence_factors: string;
  notes: string;
  tags: string;
  state_history: string;
}

/**
 * Repository for trade CRUD operations
 */
export class TradeRepository {
  private db: DatabaseConnection;
  
  constructor(db?: DatabaseConnection) {
    this.db = db || DatabaseConnection.getInstance();
  }
  
  /**
   * Convert database row to Trade object
   */
  private rowToTrade(row: TradeRow): Trade {
    return {
      id: row.id,
      patternId: row.pattern_id,
      patternName: row.pattern_name,
      symbol: row.symbol,
      timeframe: row.timeframe as Trade['timeframe'],
      direction: row.direction as Trade['direction'],
      executionType: 'SPOT',  // Default - F&O info not stored in DB yet
      state: row.state as TradeState,
      signalPrice: row.signal_price,
      entryPrice: row.entry_price,
      initialStopLoss: row.initial_stop_loss,
      currentStopLoss: row.current_stop_loss,
      target: row.target,
      exitPrice: row.exit_price,
      quantity: row.quantity,
      remainingQuantity: row.quantity, // Default to full quantity
      riskAmount: row.risk_amount,
      riskPercent: row.risk_percent,
      partialExits: [],  // Not stored in DB yet
      realizedPnl: 0,
      unrealizedPnl: 0,
      signalTime: new Date(row.signal_time),
      entryTime: row.entry_time ? new Date(row.entry_time) : null,
      exitTime: row.exit_time ? new Date(row.exit_time) : null,
      expiryTime: new Date(row.expiry_time),
      pnl: row.pnl,
      pnlPercent: row.pnl_percent,
      rMultiple: row.r_multiple,
      averageExitPrice: row.exit_price, // Use exit price as average
      confluenceFactors: JSON.parse(row.confluence_factors),
      notes: JSON.parse(row.notes),
      tags: JSON.parse(row.tags),
      stateHistory: JSON.parse(row.state_history),
    };
  }
  
  /**
   * Create a new trade from a signal
   */
  createFromSignal(signal: Signal, quantity: number, riskAmount: number, riskPercent: number): Trade {
    const now = new Date();
    const expiryTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    
    const trade: Trade = {
      id: uuidv4(),
      patternId: signal.patternId,
      patternName: signal.patternName,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      executionType: 'SPOT',  // Default - can be updated by PaperTradingEngine for F&O
      state: 'PENDING',
      stateHistory: [{
        from: null,
        to: 'PENDING',
        timestamp: now,
        reason: 'Signal generated',
        price: signal.entryPrice
      }],
      signalPrice: signal.entryPrice,
      entryPrice: null,
      initialStopLoss: signal.stopLoss,
      currentStopLoss: signal.stopLoss,
      target: signal.target,
      exitPrice: null,
      quantity,
      remainingQuantity: quantity,
      riskAmount,
      riskPercent,
      partialExits: [],
      realizedPnl: 0,
      unrealizedPnl: 0,
      signalTime: now,
      entryTime: null,
      exitTime: null,
      expiryTime,
      pnl: null,
      pnlPercent: null,
      rMultiple: null,
      averageExitPrice: null,
      confluenceFactors: signal.confluenceFactors,
      notes: [],
      tags: [],
    };
    
    this.save(trade);
    return trade;
  }
  
  /**
   * Save trade to database
   */
  save(trade: Trade): void {
    this.db.run(`
      INSERT OR REPLACE INTO trades (
        id, pattern_id, pattern_name, symbol, timeframe, direction, state,
        signal_price, entry_price, initial_stop_loss, current_stop_loss, target, exit_price,
        quantity, risk_amount, risk_percent,
        signal_time, entry_time, exit_time, expiry_time,
        pnl, pnl_percent, r_multiple,
        confluence_factors, notes, tags, state_history,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      trade.id,
      trade.patternId,
      trade.patternName,
      trade.symbol,
      trade.timeframe,
      trade.direction,
      trade.state,
      trade.signalPrice,
      trade.entryPrice,
      trade.initialStopLoss,
      trade.currentStopLoss,
      trade.target,
      trade.exitPrice,
      trade.quantity,
      trade.riskAmount,
      trade.riskPercent,
      trade.signalTime.toISOString(),
      trade.entryTime?.toISOString() || null,
      trade.exitTime?.toISOString() || null,
      trade.expiryTime.toISOString(),
      trade.pnl,
      trade.pnlPercent,
      trade.rMultiple,
      JSON.stringify(trade.confluenceFactors),
      JSON.stringify(trade.notes),
      JSON.stringify(trade.tags),
      JSON.stringify(trade.stateHistory),
    ]);
  }
  
  /**
   * Get trade by ID
   */
  getById(id: string): Trade | null {
    const row = this.db.get<TradeRow>('SELECT * FROM trades WHERE id = ?', [id]);
    return row ? this.rowToTrade(row) : null;
  }
  
  /**
   * Get all trades
   */
  getAll(): Trade[] {
    const rows = this.db.all<TradeRow>('SELECT * FROM trades ORDER BY signal_time DESC');
    return rows.map(row => this.rowToTrade(row));
  }
  
  /**
   * Get trades by state
   */
  getByState(state: TradeState): Trade[] {
    const rows = this.db.all<TradeRow>('SELECT * FROM trades WHERE state = ? ORDER BY signal_time DESC', [state]);
    return rows.map(row => this.rowToTrade(row));
  }
  
  /**
   * Get open trades (PENDING or OPEN)
   */
  getOpenTrades(): Trade[] {
    const rows = this.db.all<TradeRow>(
      'SELECT * FROM trades WHERE state IN (?, ?) ORDER BY signal_time DESC',
      ['PENDING', 'OPEN']
    );
    return rows.map(row => this.rowToTrade(row));
  }
  
  /**
   * Get trades with filters
   */
  getFiltered(filters: TradeFilters): Trade[] {
    let sql = 'SELECT * FROM trades WHERE 1=1';
    const params: unknown[] = [];
    
    if (filters.states && filters.states.length > 0) {
      sql += ` AND state IN (${filters.states.map(() => '?').join(',')})`;
      params.push(...filters.states);
    }
    
    if (filters.patterns && filters.patterns.length > 0) {
      sql += ` AND pattern_id IN (${filters.patterns.map(() => '?').join(',')})`;
      params.push(...filters.patterns);
    }
    
    if (filters.symbols && filters.symbols.length > 0) {
      sql += ` AND symbol IN (${filters.symbols.map(() => '?').join(',')})`;
      params.push(...filters.symbols);
    }
    
    if (filters.dateFrom) {
      sql += ' AND signal_time >= ?';
      params.push(filters.dateFrom.toISOString());
    }
    
    if (filters.dateTo) {
      sql += ' AND signal_time <= ?';
      params.push(filters.dateTo.toISOString());
    }
    
    sql += ' ORDER BY signal_time DESC';
    
    const rows = this.db.all<TradeRow>(sql, params);
    return rows.map(row => this.rowToTrade(row));
  }
  
  /**
   * Update trade state
   */
  updateState(trade: Trade, newState: TradeState, reason: string, price: number): Trade {
    const transition: StateTransition = {
      from: trade.state,
      to: newState,
      timestamp: new Date(),
      reason,
      price
    };
    
    trade.stateHistory.push(transition);
    trade.state = newState;
    
    this.save(trade);
    return trade;
  }
  
  /**
   * Calculate trade statistics
   */
  getStats(filters?: TradeFilters): TradeStats {
    const trades = filters ? this.getFiltered(filters) : this.getAll();
    const closedTrades = trades.filter(t => t.state === 'CLOSED' || t.state === 'STOPPED');
    
    const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.pnl || 0) < 0);
    
    const totalWin = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
    
    const avgWin = winningTrades.length > 0 ? totalWin / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLoss / losingTrades.length : 0;
    
    return {
      totalTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
      avgWin,
      avgLoss,
      profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0,
      expectancy: closedTrades.length > 0 
        ? (totalWin - totalLoss) / closedTrades.length 
        : 0,
      avgRMultiple: closedTrades.length > 0
        ? closedTrades.reduce((sum, t) => sum + (t.rMultiple || 0), 0) / closedTrades.length
        : 0,
      totalPnl: totalWin - totalLoss,
    };
  }
  
  /**
   * Count trades today
   */
  countTradesToday(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const row = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM trades WHERE signal_time >= ?',
      [today.toISOString()]
    );
    
    return row?.count || 0;
  }
  
  /**
   * Delete trade
   */
  delete(id: string): void {
    this.db.run('DELETE FROM trades WHERE id = ?', [id]);
  }
}

export default TradeRepository;

