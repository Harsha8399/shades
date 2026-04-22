import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { EquityPoint } from '../types';

interface EquityChartProps {
  data: EquityPoint[];
  isLoading: boolean;
}

export function EquityChart({ data, isLoading }: EquityChartProps) {
  const chartData = useMemo(() => {
    return data.map((point) => ({
      ...point,
      date: new Date(point.timestamp).toLocaleDateString(),
      equityFormatted: point.equity,
      drawdownPercent: (point.drawdown * 100).toFixed(2),
    }));
  }, [data]);

  const initialEquity = chartData[0]?.equity || 100000;
  const currentEquity = chartData[chartData.length - 1]?.equity || 100000;
  const totalReturn = ((currentEquity - initialEquity) / initialEquity) * 100;
  const maxDrawdown = Math.max(...data.map(d => d.drawdown)) * 100;

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Equity Curve</h3>
        </div>
        <div className="card-body h-80 flex items-center justify-center">
          <div className="animate-pulse text-slate-500">Loading chart...</div>
        </div>
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Equity Curve</h3>
        </div>
        <div className="card-body h-80 flex items-center justify-center">
          <div className="text-slate-500">Not enough data to display chart</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Equity Curve</h3>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-slate-400">Total Return: </span>
            <span className={totalReturn >= 0 ? 'text-profit' : 'text-loss'}>
              {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%
            </span>
          </div>
          <div>
            <span className="text-slate-400">Max DD: </span>
            <span className="text-loss">-{maxDrawdown.toFixed(2)}%</span>
          </div>
        </div>
      </div>
      <div className="card-body h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              dataKey="date" 
              stroke="#64748b" 
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              stroke="#64748b" 
              fontSize={12}
              tickLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#e2e8f0',
              }}
              formatter={(value) => [`$${Number(value ?? 0).toLocaleString()}`, 'Equity']}
              labelStyle={{ color: '#94a3b8' }}
            />
            <ReferenceLine 
              y={initialEquity} 
              stroke="#64748b" 
              strokeDasharray="5 5"
              label={{ value: 'Initial', fill: '#64748b', fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="equityFormatted"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#equityGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

