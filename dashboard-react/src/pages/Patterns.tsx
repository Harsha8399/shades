import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PatternInfo } from '../types';
import { Layers, Activity, Clock } from 'lucide-react';
import clsx from 'clsx';

export function Patterns() {
  const [patterns, setPatterns] = useState<PatternInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPatterns() {
      try {
        setIsLoading(true);
        const res = await api.getPatterns();
        setPatterns(res.patterns);
        setError(null);
      } catch (err) {
        setError('Failed to load patterns');
        console.error('Patterns fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchPatterns();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Patterns</h1>
          <p className="text-slate-400 mt-1">Trading pattern configurations and performance</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="card-body">
                <div className="h-6 w-48 bg-bg-tertiary rounded mb-4"></div>
                <div className="h-4 w-full bg-bg-tertiary rounded mb-2"></div>
                <div className="h-4 w-3/4 bg-bg-tertiary rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Patterns</h1>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Patterns</h1>
        <p className="text-slate-400 mt-1">Trading pattern configurations and performance</p>
      </div>

      {/* Pattern Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {patterns.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} />
        ))}
      </div>

      {patterns.length === 0 && (
        <div className="card">
          <div className="card-body flex items-center justify-center h-48">
            <div className="text-slate-500">No patterns registered</div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PatternCardProps {
  pattern: PatternInfo;
}

function PatternCard({ pattern }: PatternCardProps) {
  const stats = pattern.stats;
  const hasStats = stats && stats.totalTrades > 0;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="card-header flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent/20 rounded-lg">
            <Layers className="text-accent" size={24} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{pattern.name}</h3>
            <p className="text-xs text-slate-500">v{pattern.version}</p>
          </div>
        </div>
        <span className={clsx(
          'px-2 py-1 rounded text-xs font-medium',
          pattern.enabled 
            ? 'bg-green-500/20 text-green-400' 
            : 'bg-slate-500/20 text-slate-400'
        )}>
          {pattern.enabled ? 'Active' : 'Disabled'}
        </span>
      </div>

      {/* Description */}
      <div className="px-6 py-4 border-b border-slate-700/50">
        <p className="text-sm text-slate-400">{pattern.description}</p>
      </div>

      {/* Config */}
      <div className="px-6 py-4 border-b border-slate-700/50 flex flex-wrap gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Clock size={14} className="text-slate-500" />
          <span className="text-slate-400">Timeframes:</span>
          <span className="text-white">{pattern.timeframes.join(', ')}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Activity size={14} className="text-slate-500" />
          <span className="text-slate-400">Candles:</span>
          <span className="text-white">{pattern.requiredCandles}</span>
        </div>
      </div>

      {/* Stats */}
      {hasStats ? (
        <div className="card-body grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-white">
              {stats.totalTrades}
            </div>
            <div className="text-xs text-slate-500">Trades</div>
          </div>
          <div className="text-center">
            <div className={clsx(
              'text-xl font-bold font-mono',
              stats.winRate >= 0.5 ? 'text-profit' : 'text-loss'
            )}>
              {(stats.winRate * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">Win Rate</div>
          </div>
          <div className="text-center">
            <div className={clsx(
              'text-xl font-bold font-mono',
              stats.profitFactor >= 1 ? 'text-profit' : 'text-loss'
            )}>
              {stats.profitFactor.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500">Profit Factor</div>
          </div>
          <div className="text-center">
            <div className={clsx(
              'text-xl font-bold font-mono',
              stats.avgRMultiple >= 0 ? 'text-profit' : 'text-loss'
            )}>
              {stats.avgRMultiple.toFixed(2)}R
            </div>
            <div className="text-xs text-slate-500">Avg R</div>
          </div>
        </div>
      ) : (
        <div className="card-body flex items-center justify-center h-20">
          <div className="text-slate-500 text-sm">No trading data yet</div>
        </div>
      )}
    </div>
  );
}

