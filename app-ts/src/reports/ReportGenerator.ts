/**
 * Performance Report Generator
 * 
 * Generates comprehensive trading performance reports including:
 * - Trade summary statistics
 * - Best/worst performing patterns and instruments
 * - Equity curve and drawdown analysis
 * - Distribution analysis
 * 
 * Outputs as HTML for browser viewing or PDF export.
 */
import { Trade, TradeState } from '../types';
import { TradeRepository } from '../db/TradeRepository';

/**
 * Report period type
 */
export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';

/**
 * Performance metrics for reports
 */
export interface ReportMetrics {
  // Trade counts
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  openTrades: number;
  
  // Rates
  winRate: number;
  lossRate: number;
  
  // P&L
  totalPnl: number;
  totalWins: number;
  totalLosses: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  
  // Ratios
  profitFactor: number;
  avgRiskReward: number;
  expectancy: number;
  
  // Risk
  maxDrawdown: number;
  maxDrawdownPercent: number;
  avgDrawdown: number;
  
  // Streaks
  currentStreak: number;
  longestWinStreak: number;
  longestLossStreak: number;
  
  // Capital
  startingCapital: number;
  endingCapital: number;
  returnPercent: number;
}

/**
 * Pattern performance breakdown
 */
export interface PatternPerformance {
  patternName: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  profitFactor: number;
}

/**
 * Symbol performance breakdown
 */
export interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}

/**
 * Distribution data
 */
export interface TradeDistribution {
  byDayOfWeek: Record<string, { trades: number; pnl: number }>;
  byHour: Record<number, { trades: number; pnl: number }>;
  byPnlRange: Record<string, number>;
}

/**
 * Complete report data
 */
export interface PerformanceReport {
  period: ReportPeriod;
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  
  metrics: ReportMetrics;
  patternPerformance: PatternPerformance[];
  symbolPerformance: SymbolPerformance[];
  distribution: TradeDistribution;
  equityCurve: { date: Date; equity: number }[];
  
  // Raw data for custom analysis
  trades: Trade[];
}

/**
 * Report Generator class
 */
export class ReportGenerator {
  private repository: TradeRepository;
  private initialCapital: number;
  
  constructor(repository: TradeRepository, initialCapital: number = 100000) {
    this.repository = repository;
    this.initialCapital = initialCapital;
  }
  
  /**
   * Generate report for a specific period
   */
  generateReport(
    period: ReportPeriod,
    startDate?: Date,
    endDate?: Date
  ): PerformanceReport {
    const now = new Date();
    
    // Calculate date range based on period
    let start: Date;
    let end: Date = endDate || now;
    
    if (startDate) {
      start = startDate;
    } else {
      switch (period) {
        case 'daily':
          start = new Date(now);
          start.setHours(0, 0, 0, 0);
          break;
        case 'weekly':
          start = new Date(now);
          start.setDate(start.getDate() - 7);
          break;
        case 'monthly':
          start = new Date(now);
          start.setMonth(start.getMonth() - 1);
          break;
        default:
          start = new Date(now);
          start.setMonth(start.getMonth() - 1);
      }
    }
    
    // Get trades in range
    const allTrades = this.repository.getAll();
    const trades = allTrades.filter((t: Trade) => {
      const tradeDate = t.entryTime || t.signalTime;
      return tradeDate >= start && tradeDate <= end;
    });
    
    // Calculate metrics
    const metrics = this.calculateMetrics(trades);
    const patternPerformance = this.calculatePatternPerformance(trades);
    const symbolPerformance = this.calculateSymbolPerformance(trades);
    const distribution = this.calculateDistribution(trades);
    const equityCurve = this.calculateEquityCurve(trades);
    
    return {
      period,
      startDate: start,
      endDate: end,
      generatedAt: now,
      metrics,
      patternPerformance,
      symbolPerformance,
      distribution,
      equityCurve,
      trades,
    };
  }
  
  /**
   * Calculate performance metrics
   */
  private calculateMetrics(trades: Trade[]): ReportMetrics {
    const closedTrades = trades.filter(t => 
      t.state === 'CLOSED' || t.state === 'STOPPED'
    );
    const openTrades = trades.filter(t => 
      t.state === 'OPEN' || t.state === 'PARTIAL'
    );
    
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
    
    const totalWins = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
    
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    const expectancy = closedTrades.length > 0 
      ? (winRate * avgWin) - ((1 - winRate) * avgLoss)
      : 0;
    
    // Calculate drawdown
    const { maxDrawdown, maxDrawdownPercent, avgDrawdown } = this.calculateDrawdown(closedTrades);
    
    // Calculate streaks
    const { currentStreak, longestWinStreak, longestLossStreak } = this.calculateStreaks(closedTrades);
    
    // Calculate avg R:R
    const avgRR = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => {
          const rr = t.target && t.initialStopLoss && t.entryPrice
            ? Math.abs(t.target - t.entryPrice) / Math.abs(t.entryPrice - t.initialStopLoss)
            : 0;
          return sum + rr;
        }, 0) / closedTrades.length
      : 0;
    
    return {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      openTrades: openTrades.length,
      
      winRate,
      lossRate: 1 - winRate,
      
      totalPnl,
      totalWins,
      totalLosses,
      avgWin,
      avgLoss,
      largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl || 0)) : 0,
      largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl || 0)) : 0,
      
      profitFactor,
      avgRiskReward: avgRR,
      expectancy,
      
      maxDrawdown,
      maxDrawdownPercent,
      avgDrawdown,
      
      currentStreak,
      longestWinStreak,
      longestLossStreak,
      
      startingCapital: this.initialCapital,
      endingCapital: this.initialCapital + totalPnl,
      returnPercent: (totalPnl / this.initialCapital) * 100,
    };
  }
  
  /**
   * Calculate pattern performance breakdown
   */
  private calculatePatternPerformance(trades: Trade[]): PatternPerformance[] {
    const byPattern = new Map<string, Trade[]>();
    
    for (const trade of trades) {
      const pattern = trade.patternName;
      if (!byPattern.has(pattern)) {
        byPattern.set(pattern, []);
      }
      byPattern.get(pattern)!.push(trade);
    }
    
    return Array.from(byPattern.entries()).map(([patternName, patternTrades]) => {
      const closedTrades = patternTrades.filter(t => 
        t.state === 'CLOSED' || t.state === 'STOPPED'
      );
      const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
      const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      const totalWins = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
      const totalLosses = Math.abs(
        closedTrades.filter(t => (t.pnl || 0) < 0)
          .reduce((sum, t) => sum + (t.pnl || 0), 0)
      );
      
      return {
        patternName,
        trades: patternTrades.length,
        wins: wins.length,
        winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : 0,
        totalPnl,
        avgPnl: closedTrades.length > 0 ? totalPnl / closedTrades.length : 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      };
    }).sort((a, b) => b.totalPnl - a.totalPnl);
  }
  
  /**
   * Calculate symbol performance breakdown
   */
  private calculateSymbolPerformance(trades: Trade[]): SymbolPerformance[] {
    const bySymbol = new Map<string, Trade[]>();
    
    for (const trade of trades) {
      const symbol = trade.symbol;
      if (!bySymbol.has(symbol)) {
        bySymbol.set(symbol, []);
      }
      bySymbol.get(symbol)!.push(trade);
    }
    
    return Array.from(bySymbol.entries()).map(([symbol, symbolTrades]) => {
      const closedTrades = symbolTrades.filter(t => 
        t.state === 'CLOSED' || t.state === 'STOPPED'
      );
      const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
      const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      
      return {
        symbol,
        trades: symbolTrades.length,
        wins: wins.length,
        winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : 0,
        totalPnl,
        avgPnl: closedTrades.length > 0 ? totalPnl / closedTrades.length : 0,
      };
    }).sort((a, b) => b.totalPnl - a.totalPnl);
  }
  
  /**
   * Calculate trade distribution
   */
  private calculateDistribution(trades: Trade[]): TradeDistribution {
    const byDayOfWeek: Record<string, { trades: number; pnl: number }> = {
      'Sunday': { trades: 0, pnl: 0 },
      'Monday': { trades: 0, pnl: 0 },
      'Tuesday': { trades: 0, pnl: 0 },
      'Wednesday': { trades: 0, pnl: 0 },
      'Thursday': { trades: 0, pnl: 0 },
      'Friday': { trades: 0, pnl: 0 },
      'Saturday': { trades: 0, pnl: 0 },
    };
    
    const byHour: Record<number, { trades: number; pnl: number }> = {};
    for (let h = 0; h < 24; h++) {
      byHour[h] = { trades: 0, pnl: 0 };
    }
    
    const byPnlRange: Record<string, number> = {
      '< -5%': 0,
      '-5% to -2%': 0,
      '-2% to 0%': 0,
      '0% to 2%': 0,
      '2% to 5%': 0,
      '> 5%': 0,
    };
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (const trade of trades) {
      const date = trade.entryTime || trade.signalTime;
      const pnl = trade.pnl || 0;
      const pnlPercent = (pnl / this.initialCapital) * 100;
      
      // By day of week
      const day = days[date.getDay()];
      byDayOfWeek[day].trades++;
      byDayOfWeek[day].pnl += pnl;
      
      // By hour
      const hour = date.getHours();
      byHour[hour].trades++;
      byHour[hour].pnl += pnl;
      
      // By P&L range
      if (pnlPercent < -5) {
        byPnlRange['< -5%']++;
      } else if (pnlPercent < -2) {
        byPnlRange['-5% to -2%']++;
      } else if (pnlPercent < 0) {
        byPnlRange['-2% to 0%']++;
      } else if (pnlPercent < 2) {
        byPnlRange['0% to 2%']++;
      } else if (pnlPercent < 5) {
        byPnlRange['2% to 5%']++;
      } else {
        byPnlRange['> 5%']++;
      }
    }
    
    return { byDayOfWeek, byHour, byPnlRange };
  }
  
  /**
   * Calculate equity curve
   */
  private calculateEquityCurve(trades: Trade[]): { date: Date; equity: number }[] {
    const sortedTrades = [...trades]
      .filter(t => t.state === 'CLOSED' || t.state === 'STOPPED')
      .sort((a, b) => {
        const dateA = a.exitTime || a.entryTime || a.signalTime;
        const dateB = b.exitTime || b.entryTime || b.signalTime;
        return dateA.getTime() - dateB.getTime();
      });
    
    let equity = this.initialCapital;
    const curve: { date: Date; equity: number }[] = [];
    
    for (const trade of sortedTrades) {
      equity += trade.pnl || 0;
      const date = trade.exitTime || trade.entryTime || trade.signalTime;
      curve.push({ date, equity });
    }
    
    return curve;
  }
  
  /**
   * Calculate drawdown metrics
   */
  private calculateDrawdown(trades: Trade[]): {
    maxDrawdown: number;
    maxDrawdownPercent: number;
    avgDrawdown: number;
  } {
    if (trades.length === 0) {
      return { maxDrawdown: 0, maxDrawdownPercent: 0, avgDrawdown: 0 };
    }
    
    const sortedTrades = [...trades].sort((a, b) => {
      const dateA = a.exitTime || a.entryTime || a.signalTime;
      const dateB = b.exitTime || b.entryTime || b.signalTime;
      return dateA.getTime() - dateB.getTime();
    });
    
    let peak = this.initialCapital;
    let equity = this.initialCapital;
    let maxDrawdown = 0;
    const drawdowns: number[] = [];
    
    for (const trade of sortedTrades) {
      equity += trade.pnl || 0;
      
      if (equity > peak) {
        peak = equity;
      }
      
      const drawdown = peak - equity;
      if (drawdown > 0) {
        drawdowns.push(drawdown);
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }
    
    const avgDrawdown = drawdowns.length > 0
      ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length
      : 0;
    
    return {
      maxDrawdown,
      maxDrawdownPercent: (maxDrawdown / peak) * 100,
      avgDrawdown,
    };
  }
  
  /**
   * Calculate win/loss streaks
   */
  private calculateStreaks(trades: Trade[]): {
    currentStreak: number;
    longestWinStreak: number;
    longestLossStreak: number;
  } {
    if (trades.length === 0) {
      return { currentStreak: 0, longestWinStreak: 0, longestLossStreak: 0 };
    }
    
    const sortedTrades = [...trades].sort((a, b) => {
      const dateA = a.exitTime || a.entryTime || a.signalTime;
      const dateB = b.exitTime || b.entryTime || b.signalTime;
      return dateA.getTime() - dateB.getTime();
    });
    
    let currentStreak = 0;
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let winStreak = 0;
    let lossStreak = 0;
    
    for (const trade of sortedTrades) {
      const isWin = (trade.pnl || 0) > 0;
      
      if (isWin) {
        winStreak++;
        lossStreak = 0;
        currentStreak = winStreak;
        if (winStreak > longestWinStreak) {
          longestWinStreak = winStreak;
        }
      } else {
        lossStreak++;
        winStreak = 0;
        currentStreak = -lossStreak;
        if (lossStreak > longestLossStreak) {
          longestLossStreak = lossStreak;
        }
      }
    }
    
    return { currentStreak, longestWinStreak, longestLossStreak };
  }
  
  /**
   * Generate HTML report
   */
  generateHTML(report: PerformanceReport): string {
    const { metrics, patternPerformance, symbolPerformance } = report;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Performance Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      font-size: 2rem;
      color: #00ff88;
      margin-bottom: 0.5rem;
    }
    h2 {
      font-size: 1.25rem;
      color: #00ff88;
      margin: 2rem 0 1rem;
      border-bottom: 1px solid #333;
      padding-bottom: 0.5rem;
    }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 12px;
      padding: 1.25rem;
      border: 1px solid #333;
    }
    .card-label { color: #888; font-size: 0.85rem; margin-bottom: 0.25rem; }
    .card-value { font-size: 1.5rem; font-weight: bold; }
    .positive { color: #00ff88; }
    .negative { color: #ff4444; }
    .neutral { color: #888; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    th, td {
      text-align: left;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #333;
    }
    th {
      background: #1a1a2e;
      color: #00ff88;
      font-weight: 500;
    }
    tr:hover { background: rgba(0, 255, 136, 0.05); }
    .footer {
      margin-top: 3rem;
      text-align: center;
      color: #555;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Trading Performance Report</h1>
    <p class="subtitle">
      ${report.startDate.toLocaleDateString()} - ${report.endDate.toLocaleDateString()} |
      Generated: ${report.generatedAt.toLocaleString()}
    </p>
    
    <h2>Summary</h2>
    <div class="grid">
      <div class="card">
        <div class="card-label">Total Trades</div>
        <div class="card-value">${metrics.totalTrades}</div>
      </div>
      <div class="card">
        <div class="card-label">Win Rate</div>
        <div class="card-value ${metrics.winRate >= 0.5 ? 'positive' : 'negative'}">
          ${(metrics.winRate * 100).toFixed(1)}%
        </div>
      </div>
      <div class="card">
        <div class="card-label">Total P&L</div>
        <div class="card-value ${metrics.totalPnl >= 0 ? 'positive' : 'negative'}">
          ₹${metrics.totalPnl.toFixed(2)}
        </div>
      </div>
      <div class="card">
        <div class="card-label">Return</div>
        <div class="card-value ${metrics.returnPercent >= 0 ? 'positive' : 'negative'}">
          ${metrics.returnPercent.toFixed(2)}%
        </div>
      </div>
      <div class="card">
        <div class="card-label">Profit Factor</div>
        <div class="card-value ${metrics.profitFactor >= 1 ? 'positive' : 'negative'}">
          ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}
        </div>
      </div>
      <div class="card">
        <div class="card-label">Max Drawdown</div>
        <div class="card-value negative">
          ${metrics.maxDrawdownPercent.toFixed(2)}%
        </div>
      </div>
      <div class="card">
        <div class="card-label">Expectancy</div>
        <div class="card-value ${metrics.expectancy >= 0 ? 'positive' : 'negative'}">
          ₹${metrics.expectancy.toFixed(2)}
        </div>
      </div>
      <div class="card">
        <div class="card-label">Avg R:R</div>
        <div class="card-value ${metrics.avgRiskReward >= 1.5 ? 'positive' : 'neutral'}">
          ${metrics.avgRiskReward.toFixed(2)}
        </div>
      </div>
    </div>
    
    <h2>Win/Loss Analysis</h2>
    <div class="grid">
      <div class="card">
        <div class="card-label">Winning Trades</div>
        <div class="card-value positive">${metrics.winningTrades}</div>
      </div>
      <div class="card">
        <div class="card-label">Losing Trades</div>
        <div class="card-value negative">${metrics.losingTrades}</div>
      </div>
      <div class="card">
        <div class="card-label">Average Win</div>
        <div class="card-value positive">₹${metrics.avgWin.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-label">Average Loss</div>
        <div class="card-value negative">₹${metrics.avgLoss.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-label">Largest Win</div>
        <div class="card-value positive">₹${metrics.largestWin.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-label">Largest Loss</div>
        <div class="card-value negative">₹${metrics.largestLoss.toFixed(2)}</div>
      </div>
    </div>
    
    <h2>Pattern Performance</h2>
    <table>
      <thead>
        <tr>
          <th>Pattern</th>
          <th>Trades</th>
          <th>Wins</th>
          <th>Win Rate</th>
          <th>Total P&L</th>
          <th>Avg P&L</th>
          <th>PF</th>
        </tr>
      </thead>
      <tbody>
        ${patternPerformance.map(p => `
          <tr>
            <td>${p.patternName}</td>
            <td>${p.trades}</td>
            <td>${p.wins}</td>
            <td class="${p.winRate >= 0.5 ? 'positive' : 'negative'}">${(p.winRate * 100).toFixed(1)}%</td>
            <td class="${p.totalPnl >= 0 ? 'positive' : 'negative'}">₹${p.totalPnl.toFixed(2)}</td>
            <td class="${p.avgPnl >= 0 ? 'positive' : 'negative'}">₹${p.avgPnl.toFixed(2)}</td>
            <td>${p.profitFactor === Infinity ? '∞' : p.profitFactor.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    <h2>Symbol Performance</h2>
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Trades</th>
          <th>Wins</th>
          <th>Win Rate</th>
          <th>Total P&L</th>
          <th>Avg P&L</th>
        </tr>
      </thead>
      <tbody>
        ${symbolPerformance.map(s => `
          <tr>
            <td>${s.symbol}</td>
            <td>${s.trades}</td>
            <td>${s.wins}</td>
            <td class="${s.winRate >= 0.5 ? 'positive' : 'negative'}">${(s.winRate * 100).toFixed(1)}%</td>
            <td class="${s.totalPnl >= 0 ? 'positive' : 'negative'}">₹${s.totalPnl.toFixed(2)}</td>
            <td class="${s.avgPnl >= 0 ? 'positive' : 'negative'}">₹${s.avgPnl.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    <h2>Streaks</h2>
    <div class="grid">
      <div class="card">
        <div class="card-label">Current Streak</div>
        <div class="card-value ${metrics.currentStreak >= 0 ? 'positive' : 'negative'}">
          ${metrics.currentStreak > 0 ? '+' : ''}${metrics.currentStreak}
        </div>
      </div>
      <div class="card">
        <div class="card-label">Longest Win Streak</div>
        <div class="card-value positive">${metrics.longestWinStreak}</div>
      </div>
      <div class="card">
        <div class="card-label">Longest Loss Streak</div>
        <div class="card-value negative">${metrics.longestLossStreak}</div>
      </div>
    </div>
    
    <div class="footer">
      <p>Shades Trading Research Platform | Report generated automatically</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }
  
  /**
   * Save report to file
   */
  saveReport(report: PerformanceReport, filePath: string): void {
    const fs = require('fs');
    const html = this.generateHTML(report);
    fs.writeFileSync(filePath, html);
    console.log(`Report saved to ${filePath}`);
  }
}

export default ReportGenerator;

