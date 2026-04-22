/**
 * Context Builder
 * 
 * Gathers trading data from the repository and formats it as
 * AnalysisContext for LLM consumption. This is the bridge between
 * the trading engine's data layer and the LLM analysis layer.
 */
import { TradeRepository } from '../db/TradeRepository';
import { Trade } from '../types';
import { AnalysisContext } from './types';

/**
 * Build a complete analysis context from the trade repository
 */
export function buildContextFromRepository(
  repository: TradeRepository,
  options: {
    includeRecentTrades?: boolean;
    recentTradeLimit?: number;
    includeDailyPnl?: boolean;
    includeEquityCurve?: boolean;
  } = {}
): AnalysisContext {
  const {
    includeRecentTrades = true,
    recentTradeLimit = 20,
    includeDailyPnl = true,
    includeEquityCurve = true,
  } = options;

  const allTrades = repository.getAll();
  const closedTrades = allTrades.filter(
    t => t.state === 'CLOSED' || t.state === 'STOPPED'
  );

  const context: AnalysisContext = {};

  // 1. Overall stats
  context.stats = calculateStats(allTrades, closedTrades);

  // 2. Per-pattern breakdown
  context.patternStats = calculatePatternStats(closedTrades);

  // 3. Recent trades
  if (includeRecentTrades) {
    context.recentTrades = allTrades
      .sort((a, b) => {
        const aTime = (a.exitTime || a.entryTime || a.signalTime).getTime();
        const bTime = (b.exitTime || b.entryTime || b.signalTime).getTime();
        return bTime - aTime;
      })
      .slice(0, recentTradeLimit)
      .map(t => ({
        patternName: t.patternName,
        symbol: t.symbol,
        direction: t.direction,
        state: t.state,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        rMultiple: t.rMultiple,
        confluenceFactors: t.confluenceFactors || [],
        notes: t.notes || [],
      }));
  }

  // 4. Daily P&L
  if (includeDailyPnl) {
    context.dailyPnl = calculateDailyPnl(closedTrades);
  }

  // 5. Equity curve
  if (includeEquityCurve) {
    context.equityCurve = calculateEquityCurve(closedTrades);
  }

  return context;
}


/**
 * Build a minimal context from raw stats (when no repository access)
 */
export function buildContextFromStats(stats: Record<string, any>): AnalysisContext {
  return {
    stats: {
      totalTrades: stats.totalTrades || 0,
      winRate: stats.winRate || 0,
      profitFactor: stats.profitFactor || 0,
      avgRMultiple: stats.avgRMultiple || 0,
      maxDrawdown: stats.maxDrawdown || 0,
      totalPnl: stats.totalPnl || 0,
      avgWin: stats.avgWin || 0,
      avgLoss: stats.avgLoss || 0,
      bestTrade: stats.bestTrade || 0,
      worstTrade: stats.worstTrade || 0,
    },
  };
}


// ─── Internal Helpers ─────────────────────────────────────

function calculateStats(
  allTrades: Trade[],
  closedTrades: Trade[]
): AnalysisContext['stats'] {
  const winners = closedTrades.filter(t => (t.pnl ?? 0) > 0);
  const losers = closedTrades.filter(t => (t.pnl ?? 0) < 0);

  const winPnls = winners.map(t => t.pnl ?? 0);
  const lossPnls = losers.map(t => Math.abs(t.pnl ?? 0));
  const totalWins = winPnls.reduce((a, b) => a + b, 0);
  const totalLosses = lossPnls.reduce((a, b) => a + b, 0);
  const pnls = closedTrades.map(t => t.pnl ?? 0);
  const rMultiples = closedTrades.map(t => t.rMultiple ?? 0);

  // Streak calculation
  let currentStreak = 0;
  let longestWin = 0;
  let longestLoss = 0;
  let tempWin = 0;
  let tempLoss = 0;

  const sorted = closedTrades
    .filter(t => t.exitTime)
    .sort((a, b) => (a.exitTime?.getTime() ?? 0) - (b.exitTime?.getTime() ?? 0));

  for (const trade of sorted) {
    if ((trade.pnl ?? 0) > 0) {
      tempWin++;
      tempLoss = 0;
      longestWin = Math.max(longestWin, tempWin);
      currentStreak = tempWin;
    } else {
      tempLoss++;
      tempWin = 0;
      longestLoss = Math.max(longestLoss, tempLoss);
      currentStreak = -tempLoss;
    }
  }

  // Max drawdown
  let equity = 100000;
  let peak = equity;
  let maxDD = 0;
  for (const trade of sorted) {
    equity += trade.pnl ?? 0;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
  }

  return {
    totalTrades: allTrades.length,
    winRate: closedTrades.length > 0 ? winners.length / closedTrades.length : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0),
    avgRMultiple: rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0,
    maxDrawdown: maxDD,
    totalPnl: pnls.reduce((a, b) => a + b, 0),
    avgWin: winners.length > 0 ? totalWins / winners.length : 0,
    avgLoss: losers.length > 0 ? totalLosses / losers.length : 0,
    bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
    worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
  };
}


function calculatePatternStats(closedTrades: Trade[]): AnalysisContext['patternStats'] {
  const byPattern: Record<string, Trade[]> = {};
  for (const t of closedTrades) {
    if (!byPattern[t.patternName]) byPattern[t.patternName] = [];
    byPattern[t.patternName].push(t);
  }

  const result: NonNullable<AnalysisContext['patternStats']> = {};
  for (const [name, trades] of Object.entries(byPattern)) {
    const wins = trades.filter(t => (t.pnl ?? 0) > 0);
    const totalWins = wins.map(t => t.pnl ?? 0).reduce((a, b) => a + b, 0);
    const totalLosses = trades
      .filter(t => (t.pnl ?? 0) < 0)
      .map(t => Math.abs(t.pnl ?? 0))
      .reduce((a, b) => a + b, 0);
    const rMultiples = trades.map(t => t.rMultiple ?? 0);

    result[name] = {
      trades: trades.length,
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0),
      avgRMultiple: rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0,
      totalPnl: trades.map(t => t.pnl ?? 0).reduce((a, b) => a + b, 0),
    };
  }

  return result;
}


function calculateDailyPnl(closedTrades: Trade[]): Record<string, { pnl: number; trades: number }> {
  const daily: Record<string, { pnl: number; trades: number }> = {};
  for (const t of closedTrades) {
    if (!t.exitTime) continue;
    const date = t.exitTime.toISOString().split('T')[0];
    if (!daily[date]) daily[date] = { pnl: 0, trades: 0 };
    daily[date].pnl += t.pnl ?? 0;
    daily[date].trades += 1;
  }
  return daily;
}


function calculateEquityCurve(closedTrades: Trade[]): Array<{ equity: number; drawdown: number }> {
  const sorted = closedTrades
    .filter(t => t.exitTime)
    .sort((a, b) => (a.exitTime?.getTime() ?? 0) - (b.exitTime?.getTime() ?? 0));

  let equity = 100000;
  let peak = equity;
  const curve: Array<{ equity: number; drawdown: number }> = [{ equity, drawdown: 0 }];

  for (const trade of sorted) {
    equity += trade.pnl ?? 0;
    peak = Math.max(peak, equity);
    curve.push({ equity, drawdown: (peak - equity) / peak });
  }

  return curve;
}
