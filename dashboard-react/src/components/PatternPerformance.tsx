import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { PatternInfo } from '../types';

interface PatternPerformanceProps {
  patterns: PatternInfo[];
  isLoading: boolean;
}

export function PatternPerformance({ patterns, isLoading }: PatternPerformanceProps) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white">Pattern Performance</h3>
        </div>
        <div className="card-body h-64 flex items-center justify-center">
          <div className="animate-pulse text-slate-500">Loading...</div>
        </div>
      </div>
    );
  }

  const chartData = patterns
    .filter(p => p.stats && p.stats.totalTrades > 0)
    .map(p => ({
      name: p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name,
      fullName: p.name,
      winRate: (p.stats?.winRate || 0) * 100,
      trades: p.stats?.totalTrades || 0,
      profitFactor: p.stats?.profitFactor || 0,
    }));

  if (chartData.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white">Pattern Performance</h3>
        </div>
        <div className="card-body h-64 flex items-center justify-center">
          <div className="text-slate-500">No pattern data available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text-lg font-semibold text-white">Pattern Performance</h3>
      </div>
      <div className="card-body h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              type="number" 
              domain={[0, 100]} 
              stroke="#64748b"
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis 
              type="category" 
              dataKey="name" 
              stroke="#64748b"
              fontSize={12}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#e2e8f0',
              }}
              formatter={(value) => [
                `${Number(value ?? 0).toFixed(1)}%`,
                'Win Rate'
              ]}
              labelFormatter={(label) => {
                const pattern = chartData.find(p => p.name === label);
                return `${pattern?.fullName} (${pattern?.trades} trades)`;
              }}
            />
            <Bar dataKey="winRate" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`}
                  fill={entry.winRate >= 50 ? '#22c55e' : '#ef4444'}
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

