import { useEffect, useState } from 'react';
import { StatsCards, EquityChart, TradeTable, PatternPerformance } from '../components';
import { api } from '../api/client';
import type { TradeStats, EquityPoint, Trade, PatternInfo } from '../types';

export function Dashboard() {
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [patterns, setPatterns] = useState<PatternInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        const [statsRes, equityRes, tradesRes, patternsRes] = await Promise.all([
          api.getStats(),
          api.getEquity(),
          api.getTrades({ limit: 10 }),
          api.getPatterns(),
        ]);
        
        setStats(statsRes);
        setEquity(equityRes.equity);
        setTrades(tradesRes.trades);
        setPatterns(patternsRes.patterns);
        setError(null);
      } catch (err) {
        setError('Failed to load dashboard data. Is the API server running?');
        console.error('Dashboard fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="text-red-400 text-lg mb-4">{error}</div>
        <div className="text-slate-500 text-sm">
          Run <code className="bg-bg-tertiary px-2 py-1 rounded">npm run api</code> in the app-ts directory
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1">Paper trading performance overview</p>
      </div>

      {/* Stats Cards */}
      <StatsCards stats={stats} isLoading={isLoading} />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EquityChart data={equity} isLoading={isLoading} />
        <PatternPerformance patterns={patterns} isLoading={isLoading} />
      </div>

      {/* Recent Trades */}
      <TradeTable trades={trades} isLoading={isLoading} />
    </div>
  );
}

