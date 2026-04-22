import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Play,
  Plus,
  X,
  FileText,
  TrendingUp,
  TrendingDown,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  DollarSign,
  Target,
  ShieldAlert,
  Clock,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Types ───────────────────────────────────────────────

interface DataFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface SimResult {
  id: string;
  status: string;
  tradesGenerated: number;
  symbol: string;
  timeframe: string;
  duration: number;
  error?: string;
}

interface OpenTrade {
  id: string;
  symbol: string;
  direction: string;
  patternName: string;
  entryPrice: number | null;
  signalPrice: number;
  currentStopLoss: number;
  target: number;
  quantity: number;
  state: string;
  entryTime: string | null;
  signalTime: string;
}

// ─── Main Page ───────────────────────────────────────────

export function PaperTrading() {
  const [tab, setTab] = useState<'simulate' | 'manual' | 'open'>('open');
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);

  const refreshOpenTrades = useCallback(async () => {
    try {
      setIsLoadingTrades(true);
      const res = await api.getTrades({ state: 'OPEN', limit: 50 });
      setOpenTrades(res.trades);
    } catch {
      console.error('Failed to load open trades');
    } finally {
      setIsLoadingTrades(false);
    }
  }, []);

  useEffect(() => {
    refreshOpenTrades();
  }, [refreshOpenTrades]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
          <TrendingUp className="text-accent" size={32} />
          Paper Trading
        </h1>
        <p className="text-slate-400 mt-1">Run simulations, create manual trades, and manage open positions</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700/50 pb-0">
        {([
          { key: 'open', label: 'Open Trades', icon: Target, count: openTrades.length },
          { key: 'manual', label: 'New Trade', icon: Plus },
          { key: 'simulate', label: 'Run Simulation', icon: Play },
        ] as const).map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors',
              tab === key
                ? 'border-accent text-white'
                : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600'
            )}
          >
            <Icon size={16} />
            {label}
            {count !== undefined && count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-accent/20 text-accent rounded-full">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'open' && <OpenTradesPanel trades={openTrades} isLoading={isLoadingTrades} onRefresh={refreshOpenTrades} />}
      {tab === 'manual' && <ManualTradeForm onCreated={() => { setTab('open'); refreshOpenTrades(); }} />}
      {tab === 'simulate' && <SimulationPanel onComplete={refreshOpenTrades} />}
    </div>
  );
}

// ─── Open Trades Panel ───────────────────────────────────

function OpenTradesPanel({ trades, isLoading, onRefresh }: { trades: OpenTrade[]; isLoading: boolean; onRefresh: () => void }) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [showCloseModal, setShowCloseModal] = useState<string | null>(null);

  const handleClose = async (tradeId: string) => {
    if (!closePrice || parseFloat(closePrice) <= 0) return;
    setClosingId(tradeId);
    try {
      await api.closeTrade(tradeId, parseFloat(closePrice));
      setShowCloseModal(null);
      setClosePrice('');
      onRefresh();
    } catch (err) {
      console.error('Failed to close trade:', err);
    } finally {
      setClosingId(null);
    }
  };

  const handleDelete = async (tradeId: string) => {
    if (!confirm('Delete this trade permanently?')) return;
    try {
      await api.deleteTrade(tradeId);
      onRefresh();
    } catch (err) {
      console.error('Failed to delete trade:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-body flex items-center justify-center h-48">
          <Loader2 className="animate-spin text-accent" size={32} />
        </div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="card">
        <div className="card-body flex flex-col items-center justify-center h-48">
          <Target size={40} className="text-slate-600 mb-3" />
          <div className="text-slate-400 mb-1">No open trades</div>
          <div className="text-slate-500 text-sm">Create a manual trade or run a simulation to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {trades.map((trade) => (
        <div key={trade.id} className="card">
          <div className="card-body">
            <div className="flex items-start justify-between">
              {/* Trade info */}
              <div className="flex items-center gap-4">
                <div className={clsx(
                  'p-2 rounded-lg',
                  trade.direction === 'LONG' ? 'bg-green-500/20' : 'bg-red-500/20'
                )}>
                  {trade.direction === 'LONG'
                    ? <ArrowUpRight className="text-green-400" size={20} />
                    : <ArrowDownRight className="text-red-400" size={20} />
                  }
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-lg">{trade.symbol}</span>
                    <span className={clsx(
                      'text-xs px-2 py-0.5 rounded font-medium',
                      trade.direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    )}>
                      {trade.direction}
                    </span>
                    <span className="text-xs text-slate-500 bg-bg-tertiary px-2 py-0.5 rounded">{trade.patternName}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-slate-400">
                    <span>Entry: <span className="text-white font-mono">₹{(trade.entryPrice || trade.signalPrice).toLocaleString()}</span></span>
                    <span>SL: <span className="text-red-400 font-mono">₹{trade.currentStopLoss.toLocaleString()}</span></span>
                    <span>Target: <span className="text-green-400 font-mono">₹{trade.target.toLocaleString()}</span></span>
                    <span>Qty: <span className="text-white font-mono">{trade.quantity}</span></span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {showCloseModal === trade.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={closePrice}
                      onChange={e => setClosePrice(e.target.value)}
                      placeholder="Exit price"
                      className="w-32 bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-1.5 text-white text-sm focus:border-accent focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleClose(trade.id)}
                      disabled={closingId === trade.id}
                      className="px-3 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 disabled:opacity-50"
                    >
                      {closingId === trade.id ? <Loader2 size={14} className="animate-spin" /> : 'Close'}
                    </button>
                    <button
                      onClick={() => { setShowCloseModal(null); setClosePrice(''); }}
                      className="p-1.5 text-slate-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowCloseModal(trade.id)}
                      className="px-3 py-1.5 bg-bg-tertiary text-slate-300 text-sm rounded-lg hover:bg-slate-600 transition-colors"
                    >
                      Close Trade
                    </button>
                    <button
                      onClick={() => handleDelete(trade.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Manual Trade Form ───────────────────────────────────

function ManualTradeForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    symbol: '',
    direction: 'LONG' as 'LONG' | 'SHORT',
    entryPrice: '',
    stopLoss: '',
    target: '',
    quantity: '',
    timeframe: '15m',
    patternName: 'Manual Trade',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const riskReward = (() => {
    const entry = parseFloat(form.entryPrice);
    const sl = parseFloat(form.stopLoss);
    const tgt = parseFloat(form.target);
    if (!entry || !sl || !tgt) return null;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tgt - entry);
    return risk > 0 ? (reward / risk).toFixed(2) : null;
  })();

  const riskAmount = (() => {
    const entry = parseFloat(form.entryPrice);
    const sl = parseFloat(form.stopLoss);
    const qty = parseFloat(form.quantity);
    if (!entry || !sl || !qty) return null;
    return (Math.abs(entry - sl) * qty).toFixed(2);
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsSubmitting(true);

    try {
      await api.createTrade({
        symbol: form.symbol.toUpperCase(),
        direction: form.direction,
        entryPrice: parseFloat(form.entryPrice),
        stopLoss: parseFloat(form.stopLoss),
        target: parseFloat(form.target),
        quantity: parseFloat(form.quantity),
        timeframe: form.timeframe,
        patternName: form.patternName,
        notes: form.notes,
      });
      setSuccess(true);
      // Reset form
      setForm(prev => ({ ...prev, symbol: '', entryPrice: '', stopLoss: '', target: '', quantity: '', notes: '' }));
      setTimeout(() => { onCreated(); }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to create trade');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card max-w-2xl">
      <div className="card-header">
        <h3 className="text-lg font-semibold text-white">Create Manual Paper Trade</h3>
      </div>
      <form onSubmit={handleSubmit} className="card-body space-y-5">
        {/* Direction toggle */}
        <div>
          <label className="block text-sm text-slate-400 mb-2">Direction</label>
          <div className="flex gap-2">
            {(['LONG', 'SHORT'] as const).map(dir => (
              <button
                key={dir}
                type="button"
                onClick={() => setForm(prev => ({ ...prev, direction: dir }))}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all',
                  form.direction === dir
                    ? dir === 'LONG'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                      : 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : 'bg-bg-tertiary text-slate-400 border border-transparent hover:border-slate-600'
                )}
              >
                {dir === 'LONG' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {dir}
              </button>
            ))}
          </div>
        </div>

        {/* Symbol + Timeframe */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Symbol</label>
            <input
              type="text"
              required
              value={form.symbol}
              onChange={e => setForm(prev => ({ ...prev, symbol: e.target.value }))}
              placeholder="e.g., RELIANCE"
              className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Timeframe</label>
            <select
              value={form.timeframe}
              onChange={e => setForm(prev => ({ ...prev, timeframe: e.target.value }))}
              className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
            >
              {['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Prices */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Entry Price</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500 text-sm">₹</span>
              <input
                type="number"
                required
                step="0.01"
                value={form.entryPrice}
                onChange={e => setForm(prev => ({ ...prev, entryPrice: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Stop Loss</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500 text-sm">₹</span>
              <input
                type="number"
                required
                step="0.01"
                value={form.stopLoss}
                onChange={e => setForm(prev => ({ ...prev, stopLoss: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-bg-tertiary border border-red-500/30 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:border-red-400 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Target</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500 text-sm">₹</span>
              <input
                type="number"
                required
                step="0.01"
                value={form.target}
                onChange={e => setForm(prev => ({ ...prev, target: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-bg-tertiary border border-green-500/30 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:border-green-400 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Quantity + Pattern */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Quantity</label>
            <input
              type="number"
              required
              min="1"
              value={form.quantity}
              onChange={e => setForm(prev => ({ ...prev, quantity: e.target.value }))}
              placeholder="e.g., 10"
              className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Pattern / Label</label>
            <input
              type="text"
              value={form.patternName}
              onChange={e => setForm(prev => ({ ...prev, patternName: e.target.value }))}
              placeholder="Manual Trade"
              className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm text-slate-400 mb-1">Notes (optional)</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Entry reason, confluence factors..."
            rows={2}
            className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none resize-none placeholder-slate-600"
          />
        </div>

        {/* Risk info */}
        {(riskReward || riskAmount) && (
          <div className="flex gap-6 p-3 bg-bg-tertiary/50 rounded-lg text-sm">
            {riskReward && (
              <div className="flex items-center gap-2">
                <ShieldAlert size={14} className={parseFloat(riskReward) >= 1.5 ? 'text-green-400' : 'text-yellow-400'} />
                <span className="text-slate-400">R:R</span>
                <span className={clsx('font-mono font-medium', parseFloat(riskReward) >= 1.5 ? 'text-green-400' : 'text-yellow-400')}>
                  1:{riskReward}
                </span>
              </div>
            )}
            {riskAmount && (
              <div className="flex items-center gap-2">
                <DollarSign size={14} className="text-slate-400" />
                <span className="text-slate-400">Risk</span>
                <span className="font-mono font-medium text-white">₹{riskAmount}</span>
              </div>
            )}
          </div>
        )}

        {/* Error / Success */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
            <CheckCircle size={14} />
            Trade created successfully!
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all',
            isSubmitting
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : form.direction === 'LONG'
                ? 'bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
          )}
        >
          {isSubmitting ? (
            <><Loader2 size={16} className="animate-spin" /> Creating...</>
          ) : (
            <><Plus size={16} /> Create {form.direction} Trade</>
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Simulation Panel ────────────────────────────────────

function SimulationPanel({ onComplete }: { onComplete: () => void }) {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<DataFile | null>(null);
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1h');
  const [filters, setFilters] = useState(true);
  const [looseFilters, setLooseFilters] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFiles() {
      try {
        setIsLoadingFiles(true);
        const res = await api.simulation.getDataFiles();
        setFiles(res.files);
      } catch {
        console.error('Failed to load data files');
      } finally {
        setIsLoadingFiles(false);
      }
    }
    loadFiles();
  }, []);

  // Auto-detect symbol from filename
  useEffect(() => {
    if (selectedFile && !symbol) {
      const name = selectedFile.name.replace('.csv', '');
      // Try to extract symbol: reliance_15m -> RELIANCE, btc_usdt_1h -> BTCUSDT
      const parts = name.split('_');
      if (parts.length >= 2) {
        // Check if last part looks like a timeframe
        const lastPart = parts[parts.length - 1];
        const isTimeframe = /^\d+[mhd]$/i.test(lastPart);
        if (isTimeframe) {
          const sym = parts.slice(0, -1).join('').toUpperCase();
          setSymbol(sym);
          setTimeframe(lastPart.toLowerCase());
        } else {
          setSymbol(parts.join('').toUpperCase());
        }
      } else {
        setSymbol(name.toUpperCase());
      }
    }
  }, [selectedFile, symbol]);

  const runSimulation = async () => {
    if (!selectedFile || !symbol) return;
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.simulation.run({
        filePath: selectedFile.path,
        symbol: symbol.toUpperCase(),
        timeframe,
        filters,
        looseFilters,
      });
      setResult(res);
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Simulation failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* File Selection */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText size={18} className="text-accent" />
            Select Data File
          </h3>
        </div>
        <div className="card-body">
          {isLoadingFiles ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="animate-spin text-accent" size={24} />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8">
              <FileText size={40} className="text-slate-600 mx-auto mb-3" />
              <div className="text-slate-400 mb-2">No CSV files found</div>
              <div className="text-slate-500 text-sm">
                Place CSV files in <code className="bg-bg-tertiary px-2 py-0.5 rounded">app-ts/data/</code> or <code className="bg-bg-tertiary px-2 py-0.5 rounded">research-py/data/</code>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
              {files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => { setSelectedFile(file); setSymbol(''); }}
                  className={clsx(
                    'flex items-center gap-3 p-3 rounded-lg text-left transition-all',
                    selectedFile?.path === file.path
                      ? 'bg-accent/10 border border-accent/40'
                      : 'bg-bg-tertiary hover:bg-bg-tertiary/80 border border-transparent'
                  )}
                >
                  <FileText size={16} className={selectedFile?.path === file.path ? 'text-accent' : 'text-slate-500'} />
                  <div>
                    <div className="text-sm text-white">{file.name}</div>
                    <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Configuration */}
      {selectedFile && (
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-white">Configuration</h3>
          </div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  placeholder="e.g., RELIANCE"
                  className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                  className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
                >
                  {['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters}
                  onChange={e => setFilters(e.target.checked)}
                  className="rounded border-slate-600 bg-bg-tertiary text-accent focus:ring-accent"
                />
                <Filter size={14} className="text-slate-400" />
                <span className="text-slate-300">Trade Filters</span>
              </label>
              {filters && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={looseFilters}
                    onChange={e => setLooseFilters(e.target.checked)}
                    className="rounded border-slate-600 bg-bg-tertiary text-accent focus:ring-accent"
                  />
                  <span className="text-slate-300">Loose Mode</span>
                </label>
              )}
            </div>

            {/* Run button */}
            <button
              onClick={runSimulation}
              disabled={isRunning || !symbol}
              className={clsx(
                'w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all',
                isRunning || !symbol
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent/80 shadow-lg shadow-accent/20'
              )}
            >
              {isRunning ? (
                <><Loader2 size={16} className="animate-spin" /> Running Simulation...</>
              ) : (
                <><Play size={16} /> Run Simulation</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card border-green-500/20">
          <div className="card-body">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="text-green-400" size={24} />
              <h3 className="text-lg font-semibold text-white">Simulation Complete</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-bg-tertiary rounded-lg">
                <div className="text-2xl font-bold font-mono text-white">{result.tradesGenerated}</div>
                <div className="text-xs text-slate-500 mt-1">Trades Generated</div>
              </div>
              <div className="text-center p-3 bg-bg-tertiary rounded-lg">
                <div className="text-lg font-medium text-white">{result.symbol}</div>
                <div className="text-xs text-slate-500 mt-1">Symbol</div>
              </div>
              <div className="text-center p-3 bg-bg-tertiary rounded-lg">
                <div className="text-lg font-medium text-white">{result.timeframe}</div>
                <div className="text-xs text-slate-500 mt-1">Timeframe</div>
              </div>
              <div className="text-center p-3 bg-bg-tertiary rounded-lg">
                <div className="text-lg font-medium font-mono text-white">{(result.duration / 1000).toFixed(1)}s</div>
                <div className="text-xs text-slate-500 mt-1">Duration</div>
              </div>
            </div>
            <p className="text-slate-400 text-sm mt-4">
              View your trades on the <a href="/trades" className="text-accent hover:underline">Trades page</a> or check the <a href="/" className="text-accent hover:underline">Dashboard</a> for performance stats.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
