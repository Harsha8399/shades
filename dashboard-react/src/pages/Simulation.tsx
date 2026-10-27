import { useState, useEffect } from 'react';
import { CandlestickChart, TradeTable } from '../components';
import { api } from '../api/client';
import type { Trade } from '../types';

interface DataFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface SimulationResult {
  id: string;
  status: string;
  tradesGenerated: number;
  symbol: string;
  timeframe: string;
  filePath: string;
  duration: number;
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  trades: Trade[];
}

export function Simulation() {
  const [dataFiles, setDataFiles] = useState<DataFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [filters, setFilters] = useState<boolean>(true);
  const [looseFilters, setLooseFilters] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extract unique symbols from data files
  const availableSymbols = useMemo(() => {
    const symbols = new Set<string>();
    dataFiles.forEach(file => {
      // Try to extract symbol from filename (e.g., "RELIANCE_15m.csv" -> "RELIANCE")
      const match = file.name.match(/^([A-Z]+)_/);
      if (match) symbols.add(match[1]);
    });
    return Array.from(symbols).sort();
  }, [dataFiles]);

  // Auto-populate symbol when file is selected
  useEffect(() => {
    if (selectedFile) {
      const file = dataFiles.find(f => f.path === selectedFile);
      if (file) {
        const match = file.name.match(/^([A-Z]+)_/);
        if (match) setSymbol(match[1]);
      }
    }
  }, [selectedFile, dataFiles]);

  // Load data files on mount
  useEffect(() => {
    async function loadFiles() {
      try {
        const res = await api.simulation.getDataFiles();
        setDataFiles(res.files);
        if (res.files.length > 0 && !selectedFile) {
          setSelectedFile(res.files[0].path);
        }
      } catch (err) {
        console.error('Failed to load data files:', err);
        setError('Failed to load data files. Is the API server running?');
      }
    }
    loadFiles();
  }, []);

  const handleRun = async () => {
    if (!selectedFile || !symbol) {
      setError('Please select a data file and symbol');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.simulation.run({
        filePath: selectedFile,
        symbol,
        timeframe,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        filters,
        looseFilters,
      });

      if (res.status === 'completed') {
        setResult(res);
      } else {
        setError(res.error || 'Simulation failed');
      }
    } catch (err: any) {
      setError(err.message || 'Simulation failed');
    } finally {
      setIsRunning(false);
    }
  };

  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Historical Simulation</h1>
        <p className="text-slate-400 mt-1">Run strategy backtests on historical data with date range selection</p>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white">Simulation Parameters</h3>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Data File */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Data File</label>
              <select
                value={selectedFile}
                onChange={e => setSelectedFile(e.target.value)}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {dataFiles.map(file => (
                  <option key={file.path} value={file.path}>
                    {file.name} ({new Date(file.modified).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>

            {/* Symbol */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Symbol</label>
              <select
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {availableSymbols.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="">Custom...</option>
              </select>
            </div>

            {/* Timeframe */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Timeframe</label>
              <select
                value={timeframe}
                onChange={e => setTimeframe(e.target.value)}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {timeframes.map(tf => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>

            {/* Strategy */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Strategy</label>
              <select
                value="confluence-zone-em2"
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled
              >
                <option value="confluence-zone-em2">Confluence Zone + EM2 (Implemented)</option>
                <option value="trendline-break" disabled>Trendline Break (TS only)</option>
                <option value="fib-pullback" disabled>Fib Pullback (TS only)</option>
                <option value="sr-retest" disabled>S/R Retest (TS only)</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Only Confluence Zone is implemented in both engines</p>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Start Date</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="YYYY-MM-DDTHH:MM"
              />
              <p className="text-xs text-slate-500 mt-1">Optional. Leave empty for full range.</p>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">End Date</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="YYYY-MM-DDTHH:MM"
              />
              <p className="text-xs text-slate-500 mt-1">Optional. Leave empty for full range.</p>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleRun}
                disabled={isRunning || !selectedFile || !symbol}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded transition-colors"
              >
                {isRunning ? 'Running...' : 'Run Simulation'}
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 border-t border-slate-800 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters}
                onChange={e => setFilters(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-700 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-slate-300">Enable Trade Filters (Structure, Regime, MTF, Volume)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={looseFilters}
                onChange={e => setLooseFilters(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-700 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-slate-300">Loose Filters (Minimal Filtering)</span>
            </label>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-l-4 border-red-500">
          <div className="card-body">
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="card">
            <div className="card-header flex justify-between items-center">
              <h3 className="text-lg font-semibold text-white">Results</h3>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-400">{result.tradesGenerated} trades generated</span>
                <span className="text-slate-400">{result.candles.length} candles processed</span>
                <span className="text-slate-400">Duration: {result.duration}ms</span>
              </div>
            </div>
          </div>

          {/* Candlestick Chart */}
          <CandlestickChart
            candles={result.candles}
            trades={result.trades}
            isLoading={false}
            timeframe={timeframe}
          />

          {/* Trade Table */}
          <TradeTable trades={result.trades} isLoading={false} />
        </div>
      )}
    </div>
  );
}

// Need to import useMemo
import { useMemo } from 'react';