/**
 * Statistics API Routes
 */
import { Router, Request, Response } from 'express';
import { TradeRepository } from '../../db/TradeRepository';
import { Trade, TradeState } from '../../types';

interface TradeStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  stoppedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgRMultiple: number;
  maxDrawdown: number;
  bestTrade: number;
  worstTrade: number;
}

interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
}

export function createStatsRouter(repository: TradeRepository): Router {
  const router = Router();

  /**
   * GET /api/stats
   * Get overall trading statistics
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const trades = repository.getAll();
      const stats = calculateStats(trades);
      res.json(stats);
    } catch (error) {
      console.error('Error calculating stats:', error);
      res.status(500).json({ error: 'Failed to calculate stats' });
    }
  });

  /**
   * GET /api/stats/equity
   * Get equity curve data
   */
  router.get('/equity', (req: Request, res: Response) => {
    try {
      const trades = repository.getAll();
      const equity = calculateEquityCurve(trades);
      res.json({ equity });
    } catch (error) {
      console.error('Error calculating equity:', error);
      res.status(500).json({ error: 'Failed to calculate equity' });
    }
  });

  /**
   * GET /api/stats/daily
   * Get daily P&L breakdown
   */
  router.get('/daily', (req: Request, res: Response) => {
    try {
      const trades = repository.getAll();
      const daily = calculateDailyStats(trades);
      res.json({ daily });
    } catch (error) {
      console.error('Error calculating daily stats:', error);
      res.status(500).json({ error: 'Failed to calculate daily stats' });
    }
  });

  /**
   * GET /api/stats/by-pattern
   * Get stats grouped by pattern
   */
  router.get('/by-pattern', (req: Request, res: Response) => {
    try {
      const trades = repository.getAll();
      const byPattern = calculateStatsByPattern(trades);
      res.json({ patterns: byPattern });
    } catch (error) {
      console.error('Error calculating pattern stats:', error);
      res.status(500).json({ error: 'Failed to calculate pattern stats' });
    }
  });

  return router;
}

function calculateStats(trades: Trade[]): TradeStats {
  const closedTrades = trades.filter(t => 
    t.state === 'CLOSED' || t.state === 'STOPPED'
  );
  
  const openTrades = trades.filter(t => 
    t.state === 'OPEN' || t.state === 'PENDING'
  );
  
  const stoppedTrades = trades.filter(t => t.state === 'STOPPED');
  
  const winners = closedTrades.filter(t => (t.pnl ?? 0) > 0);
  const losers = closedTrades.filter(t => (t.pnl ?? 0) < 0);
  
  const pnls = closedTrades.map(t => t.pnl ?? 0);
  const winPnls = winners.map(t => t.pnl ?? 0);
  const lossPnls = losers.map(t => Math.abs(t.pnl ?? 0));
  const rMultiples = closedTrades.map(t => t.rMultiple ?? 0);
  
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const totalWins = winPnls.reduce((a, b) => a + b, 0);
  const totalLosses = lossPnls.reduce((a, b) => a + b, 0);
  
  return {
    totalTrades: trades.length,
    openTrades: openTrades.length,
    closedTrades: closedTrades.length,
    stoppedTrades: stoppedTrades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: closedTrades.length > 0 
      ? winners.length / closedTrades.length 
      : 0,
    totalPnl,
    avgPnl: closedTrades.length > 0 
      ? totalPnl / closedTrades.length 
      : 0,
    avgWin: winners.length > 0 
      ? totalWins / winners.length 
      : 0,
    avgLoss: losers.length > 0 
      ? totalLosses / losers.length 
      : 0,
    profitFactor: totalLosses > 0 
      ? totalWins / totalLosses 
      : totalWins > 0 ? Infinity : 0,
    avgRMultiple: rMultiples.length > 0 
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length 
      : 0,
    maxDrawdown: calculateMaxDrawdown(closedTrades),
    bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
    worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
  };
}

function calculateEquityCurve(trades: Trade[]): EquityPoint[] {
  const closedTrades = trades
    .filter(t => t.state === 'CLOSED' || t.state === 'STOPPED')
    .filter(t => t.exitTime !== null)
    .sort((a, b) => (a.exitTime?.getTime() ?? 0) - (b.exitTime?.getTime() ?? 0));
  
  const initialCapital = 100000; // Default
  let equity = initialCapital;
  let peak = equity;
  
  const curve: EquityPoint[] = [{
    timestamp: closedTrades[0]?.signalTime?.toISOString() ?? new Date().toISOString(),
    equity: initialCapital,
    drawdown: 0,
  }];
  
  for (const trade of closedTrades) {
    equity += trade.pnl ?? 0;
    peak = Math.max(peak, equity);
    const drawdown = (peak - equity) / peak;
    
    curve.push({
      timestamp: trade.exitTime?.toISOString() ?? new Date().toISOString(),
      equity,
      drawdown,
    });
  }
  
  return curve;
}

function calculateMaxDrawdown(trades: Trade[]): number {
  const sorted = trades
    .filter(t => t.exitTime !== null)
    .sort((a, b) => (a.exitTime?.getTime() ?? 0) - (b.exitTime?.getTime() ?? 0));
  
  let equity = 100000;
  let peak = equity;
  let maxDD = 0;
  
  for (const trade of sorted) {
    equity += trade.pnl ?? 0;
    peak = Math.max(peak, equity);
    const dd = (peak - equity) / peak;
    maxDD = Math.max(maxDD, dd);
  }
  
  return maxDD;
}

function calculateDailyStats(trades: Trade[]): Record<string, { pnl: number; trades: number }> {
  const daily: Record<string, { pnl: number; trades: number }> = {};
  
  for (const trade of trades) {
    if (trade.state !== 'CLOSED' && trade.state !== 'STOPPED') continue;
    if (!trade.exitTime) continue;
    
    const date = trade.exitTime.toISOString().split('T')[0];
    
    if (!daily[date]) {
      daily[date] = { pnl: 0, trades: 0 };
    }
    
    daily[date].pnl += trade.pnl ?? 0;
    daily[date].trades += 1;
  }
  
  return daily;
}

function calculateStatsByPattern(trades: Trade[]): Record<string, TradeStats> {
  const byPattern: Record<string, Trade[]> = {};
  
  for (const trade of trades) {
    if (!byPattern[trade.patternName]) {
      byPattern[trade.patternName] = [];
    }
    byPattern[trade.patternName].push(trade);
  }
  
  const result: Record<string, TradeStats> = {};
  
  for (const [pattern, patternTrades] of Object.entries(byPattern)) {
    result[pattern] = calculateStats(patternTrades);
  }
  
  return result;
}

