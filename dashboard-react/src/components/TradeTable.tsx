import { ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import type { Trade, TradeState } from '../types';

interface TradeTableProps {
  trades: Trade[];
  isLoading: boolean;
  showPattern?: boolean;
}

const stateConfig: Record<TradeState, { icon: React.ReactNode; color: string; label: string }> = {
  PENDING: { icon: <Clock size={14} />, color: 'text-yellow-400', label: 'Pending' },
  OPEN: { icon: <AlertCircle size={14} />, color: 'text-blue-400', label: 'Open' },
  CLOSED: { icon: <CheckCircle size={14} />, color: 'text-green-400', label: 'Closed' },
  STOPPED: { icon: <XCircle size={14} />, color: 'text-red-400', label: 'Stopped' },
  CANCELLED: { icon: <XCircle size={14} />, color: 'text-slate-400', label: 'Cancelled' },
  EXPIRED: { icon: <Clock size={14} />, color: 'text-slate-500', label: 'Expired' },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(price: number | null): string {
  if (price === null) return '-';
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPnl(pnl: number | null): string {
  if (pnl === null) return '-';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRMultiple(r: number | null): string {
  if (r === null) return '-';
  const sign = r >= 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}R`;
}

export function TradeTable({ trades, isLoading, showPattern = true }: TradeTableProps) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white">Recent Trades</h3>
        </div>
        <div className="card-body">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-bg-tertiary rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white">Recent Trades</h3>
        </div>
        <div className="card-body flex items-center justify-center h-48">
          <div className="text-slate-500">No trades yet</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Recent Trades</h3>
        <span className="text-sm text-slate-400">{trades.length} trades</span>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Direction</th>
              {showPattern && <th>Pattern</th>}
              <th>Entry</th>
              <th>Exit</th>
              <th>Status</th>
              <th className="text-right">P&L</th>
              <th className="text-right">R</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const state = stateConfig[trade.state];
              const pnlColor = trade.pnl === null ? '' : trade.pnl >= 0 ? 'profit-text' : 'loss-text';
              
              return (
                <tr key={trade.id} className="cursor-pointer">
                  <td className="font-mono text-sm text-slate-400">
                    {formatDate(trade.signalTime)}
                  </td>
                  <td className="font-medium">{trade.symbol}</td>
                  <td>
                    <span className={clsx(
                      'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
                      trade.direction === 'LONG' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-red-500/20 text-red-400'
                    )}>
                      {trade.direction === 'LONG' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {trade.direction}
                    </span>
                  </td>
                  {showPattern && (
                    <td className="text-slate-300">{trade.patternName}</td>
                  )}
                  <td className="font-mono">{formatPrice(trade.entryPrice || trade.signalPrice)}</td>
                  <td className="font-mono">{formatPrice(trade.exitPrice)}</td>
                  <td>
                    <span className={clsx('inline-flex items-center gap-1', state.color)}>
                      {state.icon}
                      <span className="text-xs">{state.label}</span>
                    </span>
                  </td>
                  <td className={clsx('text-right font-mono', pnlColor)}>
                    {formatPnl(trade.pnl)}
                  </td>
                  <td className={clsx('text-right font-mono', pnlColor)}>
                    {formatRMultiple(trade.rMultiple)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

