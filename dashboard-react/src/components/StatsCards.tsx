import { TrendingUp, Target, Activity, DollarSign } from 'lucide-react';
import clsx from 'clsx';
import type { TradeStats } from '../types';

interface StatsCardsProps {
  stats: TradeStats | null;
  isLoading: boolean;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  subtext?: string;
}

function StatCard({ label, value, icon, trend, subtext }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-bg-tertiary rounded-lg">
          {icon}
        </div>
        {trend && (
          <span className={clsx(
            'text-xs font-medium px-2 py-1 rounded-full',
            trend === 'up' && 'bg-green-500/20 text-green-400',
            trend === 'down' && 'bg-red-500/20 text-red-400',
            trend === 'neutral' && 'bg-slate-500/20 text-slate-400',
          )}>
            {trend === 'up' ? '+' : trend === 'down' ? '-' : '~'}
          </span>
        )}
      </div>
      <div className={clsx(
        'stat-value',
        trend === 'up' && 'text-profit',
        trend === 'down' && 'text-loss',
      )}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {subtext && (
        <div className="text-xs text-slate-500 mt-2">{subtext}</div>
      )}
    </div>
  );
}

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="stat-card animate-pulse">
            <div className="h-12 w-12 bg-bg-tertiary rounded-lg mb-4"></div>
            <div className="h-8 w-24 bg-bg-tertiary rounded mb-2"></div>
            <div className="h-4 w-16 bg-bg-tertiary rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  const totalPnlTrend = stats.totalPnl > 0 ? 'up' : stats.totalPnl < 0 ? 'down' : 'neutral';
  const winRateTrend = stats.winRate >= 0.5 ? 'up' : 'down';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        label="Total P&L"
        value={`$${stats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={<DollarSign className="text-accent" size={24} />}
        trend={totalPnlTrend}
        subtext={`${stats.closedTrades} closed trades`}
      />
      
      <StatCard
        label="Win Rate"
        value={`${(stats.winRate * 100).toFixed(1)}%`}
        icon={<Target className="text-accent" size={24} />}
        trend={winRateTrend}
        subtext={`${stats.winningTrades}W / ${stats.losingTrades}L`}
      />
      
      <StatCard
        label="Profit Factor"
        value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
        icon={<TrendingUp className="text-accent" size={24} />}
        trend={stats.profitFactor >= 1.5 ? 'up' : stats.profitFactor >= 1 ? 'neutral' : 'down'}
        subtext={`Avg R: ${stats.avgRMultiple.toFixed(2)}`}
      />
      
      <StatCard
        label="Open Trades"
        value={stats.openTrades}
        icon={<Activity className="text-accent" size={24} />}
        subtext={`Total: ${stats.totalTrades}`}
      />
    </div>
  );
}

