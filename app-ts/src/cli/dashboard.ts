import Table from 'cli-table3';
import { Trade, TradeStats } from '../types';
import { TradeRepository } from '../db/TradeRepository';

/**
 * CLI Dashboard
 * Displays trading information in the terminal
 */
export class Dashboard {
  private repository: TradeRepository;
  
  constructor(repository?: TradeRepository) {
    this.repository = repository || new TradeRepository();
  }
  
  /**
   * Display open trades table
   */
  showOpenTrades(): void {
    const trades = this.repository.getOpenTrades();
    
    if (trades.length === 0) {
      console.log('\nNo open trades.\n');
      return;
    }
    
    const table = new Table({
      head: ['ID', 'Pattern', 'Symbol', 'Dir', 'State', 'Entry', 'SL', 'TP', 'Qty'],
      style: { head: ['cyan'] },
    });
    
    for (const trade of trades) {
      table.push([
        trade.id.slice(0, 8),
        trade.patternName.slice(0, 15),
        trade.symbol,
        trade.direction,
        trade.state,
        trade.entryPrice?.toFixed(2) || trade.signalPrice.toFixed(2),
        trade.currentStopLoss.toFixed(2),
        trade.target.toFixed(2),
        trade.quantity.toFixed(4),
      ]);
    }
    
    console.log('\n=== OPEN TRADES ===');
    console.log(table.toString());
  }
  
  /**
   * Display closed trades table
   */
  showClosedTrades(limit: number = 10): void {
    const trades = this.repository.getFiltered({
      states: ['CLOSED', 'STOPPED', 'CANCELLED', 'EXPIRED'],
    }).slice(0, limit);
    
    if (trades.length === 0) {
      console.log('\nNo closed trades.\n');
      return;
    }
    
    const table = new Table({
      head: ['ID', 'Pattern', 'Symbol', 'Dir', 'Result', 'P&L', 'R', 'Entry', 'Exit'],
      style: { head: ['cyan'] },
    });
    
    for (const trade of trades) {
      const pnlStr = trade.pnl !== null 
        ? `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}`
        : '-';
      const rStr = trade.rMultiple !== null
        ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
        : '-';
      
      table.push([
        trade.id.slice(0, 8),
        trade.patternName.slice(0, 15),
        trade.symbol,
        trade.direction,
        trade.state,
        pnlStr,
        rStr,
        trade.entryPrice?.toFixed(2) || '-',
        trade.exitPrice?.toFixed(2) || '-',
      ]);
    }
    
    console.log(`\n=== RECENT TRADES (last ${limit}) ===`);
    console.log(table.toString());
  }
  
  /**
   * Display all trades
   */
  showAllTrades(): void {
    const trades = this.repository.getAll();
    
    if (trades.length === 0) {
      console.log('\nNo trades found.\n');
      return;
    }
    
    const table = new Table({
      head: ['ID', 'Pattern', 'Symbol', 'Dir', 'State', 'P&L', 'R', 'Signal Time'],
      style: { head: ['cyan'] },
    });
    
    for (const trade of trades) {
      const pnlStr = trade.pnl !== null 
        ? `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}`
        : '-';
      const rStr = trade.rMultiple !== null
        ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
        : '-';
      
      table.push([
        trade.id.slice(0, 8),
        trade.patternName.slice(0, 15),
        trade.symbol,
        trade.direction,
        trade.state,
        pnlStr,
        rStr,
        trade.signalTime.toISOString().slice(0, 16),
      ]);
    }
    
    console.log('\n=== ALL TRADES ===');
    console.log(table.toString());
  }
  
  /**
   * Display trading statistics
   */
  showStats(): void {
    const stats = this.repository.getStats();
    
    console.log('\n=== TRADING STATISTICS ===');
    console.log('');
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Winning Trades:   ${stats.winningTrades}`);
    console.log(`Losing Trades:    ${stats.losingTrades}`);
    console.log(`Win Rate:         ${(stats.winRate * 100).toFixed(1)}%`);
    console.log('');
    console.log(`Avg Win:          $${stats.avgWin.toFixed(2)}`);
    console.log(`Avg Loss:         $${stats.avgLoss.toFixed(2)}`);
    console.log(`Profit Factor:    ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`);
    console.log(`Expectancy:       $${stats.expectancy.toFixed(2)}`);
    console.log('');
    console.log(`Avg R-Multiple:   ${stats.avgRMultiple.toFixed(2)}R`);
    console.log(`Total P&L:        $${stats.totalPnl.toFixed(2)}`);
    console.log('');
  }
  
  /**
   * Display pattern leaderboard
   */
  showPatternLeaderboard(): void {
    const allTrades = this.repository.getAll();
    const patternStats: Map<string, { 
      name: string; 
      trades: number; 
      wins: number; 
      pnl: number; 
      rSum: number 
    }> = new Map();
    
    // Aggregate by pattern
    for (const trade of allTrades) {
      if (trade.state !== 'CLOSED' && trade.state !== 'STOPPED') continue;
      
      const existing = patternStats.get(trade.patternId) || {
        name: trade.patternName,
        trades: 0,
        wins: 0,
        pnl: 0,
        rSum: 0,
      };
      
      existing.trades++;
      if ((trade.pnl || 0) > 0) existing.wins++;
      existing.pnl += trade.pnl || 0;
      existing.rSum += trade.rMultiple || 0;
      
      patternStats.set(trade.patternId, existing);
    }
    
    if (patternStats.size === 0) {
      console.log('\nNo pattern statistics available.\n');
      return;
    }
    
    const table = new Table({
      head: ['Pattern', 'Trades', 'Win Rate', 'Total P&L', 'Avg R'],
      style: { head: ['cyan'] },
    });
    
    // Sort by total P&L
    const sorted = Array.from(patternStats.entries())
      .sort((a, b) => b[1].pnl - a[1].pnl);
    
    for (const [_, stats] of sorted) {
      const winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;
      const avgR = stats.trades > 0 ? stats.rSum / stats.trades : 0;
      
      table.push([
        stats.name.slice(0, 25),
        stats.trades.toString(),
        `${winRate.toFixed(1)}%`,
        `$${stats.pnl.toFixed(2)}`,
        `${avgR.toFixed(2)}R`,
      ]);
    }
    
    console.log('\n=== PATTERN LEADERBOARD ===');
    console.log(table.toString());
  }
  
  /**
   * Display single trade details
   */
  showTradeDetails(tradeId: string): void {
    // Find trade by partial ID
    const allTrades = this.repository.getAll();
    const trade = allTrades.find(t => t.id.startsWith(tradeId));
    
    if (!trade) {
      console.log(`\nTrade not found: ${tradeId}\n`);
      return;
    }
    
    console.log('\n=== TRADE DETAILS ===');
    console.log(`ID:              ${trade.id}`);
    console.log(`Pattern:         ${trade.patternName}`);
    console.log(`Symbol:          ${trade.symbol}`);
    console.log(`Timeframe:       ${trade.timeframe}`);
    console.log(`Direction:       ${trade.direction}`);
    console.log(`State:           ${trade.state}`);
    console.log('');
    console.log(`Signal Price:    ${trade.signalPrice.toFixed(2)}`);
    console.log(`Entry Price:     ${trade.entryPrice?.toFixed(2) || '-'}`);
    console.log(`Initial SL:      ${trade.initialStopLoss.toFixed(2)}`);
    console.log(`Current SL:      ${trade.currentStopLoss.toFixed(2)}`);
    console.log(`Target:          ${trade.target.toFixed(2)}`);
    console.log(`Exit Price:      ${trade.exitPrice?.toFixed(2) || '-'}`);
    console.log('');
    console.log(`Quantity:        ${trade.quantity.toFixed(4)}`);
    console.log(`Risk Amount:     $${trade.riskAmount.toFixed(2)}`);
    console.log(`Risk Percent:    ${(trade.riskPercent * 100).toFixed(1)}%`);
    console.log('');
    console.log(`Signal Time:     ${trade.signalTime.toISOString()}`);
    console.log(`Entry Time:      ${trade.entryTime?.toISOString() || '-'}`);
    console.log(`Exit Time:       ${trade.exitTime?.toISOString() || '-'}`);
    console.log(`Expiry Time:     ${trade.expiryTime.toISOString()}`);
    console.log('');
    console.log(`P&L:             ${trade.pnl !== null ? `$${trade.pnl.toFixed(2)}` : '-'}`);
    console.log(`P&L %:           ${trade.pnlPercent !== null ? `${trade.pnlPercent.toFixed(2)}%` : '-'}`);
    console.log(`R-Multiple:      ${trade.rMultiple !== null ? `${trade.rMultiple.toFixed(2)}R` : '-'}`);
    console.log('');
    console.log(`Confluence:      ${trade.confluenceFactors.join(', ') || '-'}`);
    console.log(`Notes:           ${trade.notes.join(', ') || '-'}`);
    console.log(`Tags:            ${trade.tags.join(', ') || '-'}`);
    console.log('');
    
    if (trade.stateHistory.length > 0) {
      console.log('State History:');
      for (const transition of trade.stateHistory) {
        console.log(`  ${transition.from || 'null'} -> ${transition.to} @ ${transition.price.toFixed(2)} (${transition.reason})`);
      }
    }
    console.log('');
  }
  
  /**
   * Display full dashboard
   */
  showFullDashboard(): void {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           SHADES - Trading Pattern Research Platform         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    this.showStats();
    this.showOpenTrades();
    this.showClosedTrades(5);
    this.showPatternLeaderboard();
  }
}

export default Dashboard;

