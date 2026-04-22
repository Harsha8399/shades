import { useEffect, useState } from 'react';
import { TradeTable } from '../components';
import { api } from '../api/client';
import type { Trade, TradeState } from '../types';
import clsx from 'clsx';

const stateFilters: { value: TradeState | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'STOPPED', label: 'Stopped' },
];

export function Trades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<TradeState | 'ALL'>('ALL');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTrades() {
      try {
        setIsLoading(true);
        const params: any = { limit: 100 };
        if (stateFilter !== 'ALL') {
          params.state = stateFilter;
        }
        const res = await api.getTrades(params);
        setTrades(res.trades);
        setError(null);
      } catch (err) {
        setError('Failed to load trades');
        console.error('Trades fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchTrades();
  }, [stateFilter]);

  // Calculate stats for filtered trades
  const closedTrades = trades.filter(t => t.state === 'CLOSED' || t.state === 'STOPPED');
  const winners = closedTrades.filter(t => (t.pnl || 0) > 0);
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winRate = closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Trades</h1>
          <p className="text-slate-400 mt-1">All paper trading history</p>
        </div>
        
        {/* Quick Stats */}
        <div className="flex gap-6 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold font-mono text-white">{trades.length}</div>
            <div className="text-slate-500">Total</div>
          </div>
          <div className="text-center">
            <div className={clsx('text-2xl font-bold font-mono', totalPnl >= 0 ? 'text-profit' : 'text-loss')}>
              ${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-slate-500">P&L</div>
          </div>
          <div className="text-center">
            <div className={clsx('text-2xl font-bold font-mono', winRate >= 50 ? 'text-profit' : 'text-loss')}>
              {winRate.toFixed(0)}%
            </div>
            <div className="text-slate-500">Win Rate</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {stateFilters.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setStateFilter(value)}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              stateFilter === value
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-slate-400 hover:bg-bg-tertiary hover:text-white'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Trade Table */}
      <TradeTable trades={trades} isLoading={isLoading} />
    </div>
  );
}

