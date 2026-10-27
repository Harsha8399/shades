import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Play,
  StopCircle,
  Wifi,
  WifiOff,
  Activity,
  DollarSign,
  Target,
  ShieldAlert,
  AlertCircle,
  Loader2,
  Settings,
} from 'lucide-react';
import { api } from '../api/client';
import type { Trade, ScanResult } from '../types';

interface MarketDataStatus {
  isActive: boolean;
  subscribedSymbols: string[];
  subscribedTimeframes: string[];
}

interface Quote {
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export function Live() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [marketDataStatus, setMarketDataStatus] = useState<MarketDataStatus | null>(null);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [scanResults, setScanResults] = useState<Map<string, ScanResult>>(new Map());
  const [paperTrades, setPaperTrades] = useState<Trade[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('RELIANCE');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('15m');
  const [scanInterval, setScanInterval] = useState<number>(60000);
  const [enablePaperTrading, setEnablePaperTrading] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);

  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  const scanResultsRef = useRef(scanResults);
  scanResultsRef.current = scanResults;

  const availableSymbols = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT', 'NIFTY', 'BANKNIFTY'];
  const availableTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.liveScanner.getStatus();
      setConnectionState(res.isActive ? 'connected' : 'disconnected');
    } catch (err) {
      console.error('Failed to fetch live scanner status:', err);
      setConnectionState('error');
    }
  }, []);

  const fetchMarketDataStatus = useCallback(async () => {
    try {
      const res = await api.liveScanner.getMarketDataStatus();
      setMarketDataStatus(res);
    } catch (err) {
      console.error('Failed to fetch market data status:', err);
    }
  }, []);

  const fetchQuotes = useCallback(async () => {
    if (!marketDataStatus?.subscribedSymbols) return;
    
    const newQuotes = new Map<string, Quote>();
    for (const symbol of marketDataStatus.subscribedSymbols) {
      try {
        const quote = await api.liveScanner.getQuote(symbol);
        if (quote) {
          newQuotes.set(symbol, quote);
        }
      } catch (err) {
        // Ignore quote errors
      }
    }
    setQuotes(newQuotes);
  }, [marketDataStatus?.subscribedSymbols]);

  const fetchScanResults = useCallback(async () => {
    try {
      const res = await api.liveScanner.getResults();
      const resultsMap = new Map<string, ScanResult>();
      for (const result of res.results) {
        const key = `${result.symbol}:${result.timeframe}`;
        resultsMap.set(key, result);
      }
      setScanResults(resultsMap);
      setLastScanTime(new Date());
    } catch (err) {
      console.error('Failed to fetch scan results:', err);
    }
  }, []);

  const fetchPaperTrades = useCallback(async () => {
    try {
      const res = await api.liveScanner.getPaperTrades();
      setPaperTrades(res.trades || []);
    } catch (err) {
      console.error('Failed to fetch paper trades:', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchStatus(),
      fetchMarketDataStatus(),
      fetchQuotes(),
      fetchScanResults(),
      fetchPaperTrades(),
    ]);
  }, [fetchStatus, fetchMarketDataStatus, fetchQuotes, fetchScanResults, fetchPaperTrades]);

  // Auto-refresh when connected
  useEffect(() => {
    refreshAll();
    
    if (connectionState === 'connected') {
      const interval = setInterval(refreshAll, 5000);
      return () => clearInterval(interval);
    }
  }, [connectionState, refreshAll]);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    setConnectionState('connecting');
    
    try {
      await api.liveScanner.start({
        symbols: [selectedSymbol],
        timeframes: [selectedTimeframe as any],
        scanIntervalMs: scanInterval,
        enablePaperTrading,
      });
      
      // Wait a bit for initialization
      await new Promise(r => setTimeout(r, 2000));
      await refreshAll();
      setConnectionState('connected');
    } catch (err: any) {
      setError(err.message || 'Failed to start live scanner');
      setConnectionState('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      await api.liveScanner.stop();
      await refreshAll();
      setConnectionState('disconnected');
      setScanResults(new Map());
      setQuotes(new Map());
      setPaperTrades([]);
    } catch (err: any) {
      setError(err.message || 'Failed to stop live scanner');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigure = async () => {
    try {
      await api.liveScanner.configure({
        symbols: [selectedSymbol],
        timeframes: [selectedTimeframe as any],
        scanIntervalMs: scanInterval,
        enablePaperTrading,
      });
      await refreshAll();
    } catch (err: any) {
      setError(err.message || 'Failed to configure scanner');
    }
  };

  const getConnectionIcon = () => {
    switch (connectionState) {
      case 'connected': return <Wifi className="text-green-400" size={16} />;
      case 'connecting':
      case 'reconnecting': return <Loader2 className="animate-spin text-yellow-400" size={16} />;
      case 'error': return <AlertCircle className="text-red-400" size={16} />;
      default: return <WifiOff className="text-slate-500" size={16} />;
    }
  };

  const getConnectionText = () => {
    switch (connectionState) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'reconnecting': return 'Reconnecting...';
      case 'error': return 'Connection Error';
      default: return 'Disconnected';
    }
};

// Get current signal for selected symbol/timeframe
  const currentSignal = scanResults.get(`${selectedSymbol}:${selectedTimeframe}`)?.signal || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
          <Activity className="text-accent" size={32} />
          Live Market Scanner
        </h1>
        <p className="text-slate-400 mt-1">Real-time pattern detection with Upstox market data</p>
      </div>

      {/* Connection Status & Controls */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Connection</h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-bg-tertiary">
              {getConnectionIcon()}
              <span className="text-sm font-medium text-white">{getConnectionText()}</span>
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Symbol</label>
              <select
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                disabled={connectionState === 'connected' || isLoading}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                {availableSymbols.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Timeframe</label>
              <select
                value={selectedTimeframe}
                onChange={e => setSelectedTimeframe(e.target.value)}
                disabled={connectionState === 'connected' || isLoading}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                {availableTimeframes.map(tf => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Scan Interval (ms)</label>
              <input
                type="number"
                value={scanInterval}
                onChange={e => setScanInterval(parseInt(e.target.value) || 60000)}
                min={1000}
                max={3600000}
                step={1000}
                disabled={connectionState === 'connected' || isLoading}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enablePaperTrading}
                  onChange={e => setEnablePaperTrading(e.target.checked)}
                  disabled={connectionState === 'connected' || isLoading}
                  className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-700 rounded focus:ring-blue-500 disabled:opacity-50"
                />
                <span className="text-sm text-slate-300">Paper Trading</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {connectionState === 'disconnected' || connectionState === 'error' ? (
              <button
                onClick={handleStart}
                disabled={isLoading}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-900/50 text-white font-medium rounded-lg transition-colors"
              >
                <Play size={16} />
                <span>Start Scanner</span>
              </button>
            ) : (
              <>
                <button
                  onClick={handleConfigure}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-white font-medium rounded-lg transition-colors"
                >
                  <Settings size={16} />
                  <span>Reconfigure</span>
                </button>
                <button
                  onClick={handleStop}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-900/50 text-white font-medium rounded-lg transition-colors"
                >
                  <StopCircle size={16} />
                  <span>Stop Scanner</span>
                </button>
              </>
            )}
            
            {isLoading && <Loader2 className="animate-spin text-slate-400" size={20} />}
            
            {error && (
              <span className="text-red-400 text-sm flex-1">{error}</span>
            )}
          </div>

          {/* Market Data Status */}
          {marketDataStatus && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Market Data:</span>
                <span className={marketDataStatus.isActive ? 'text-green-400' : 'text-red-400'}>
                  {marketDataStatus.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Symbols: {marketDataStatus.subscribedSymbols.join(', ') || 'None'}
              </div>
              <div className="text-xs text-slate-500">
                Timeframes: {marketDataStatus.subscribedTimeframes.join(', ') || 'None'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Current Quotes */}
      {quotes.size > 0 && (
        <div className="card">
          <div className="card-header flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Live Quotes</h3>
            <span className="text-xs text-slate-500">Updated: {new Date().toLocaleTimeString()}</span>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {Array.from(quotes.entries()).map(([symbol, quote]) => (
                <div key={symbol} className="bg-bg-secondary border border-slate-700/50 rounded-lg p-3">
                  <div className="font-semibold text-white">{symbol}</div>
                  <div className="text-2xl font-mono font-bold text-white">₹{quote.lastPrice.toFixed(2)}</div>
                  <div className={`text-sm ${quote.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%)
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Vol: {quote.volume.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Current Signal */}
      {currentSignal && (
        <div className="card border-yellow-500/30">
          <div className="card-header flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Activity className="text-yellow-400" size={20} />
              Active Signal
            </h3>
            <span className="text-xs text-slate-500">Last scan: {lastScanTime?.toLocaleTimeString()}</span>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-bg-secondary rounded-lg">
                <div className="text-xs text-slate-400">Direction</div>
                <div className={`text-2xl font-bold ${currentSignal.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                  {currentSignal.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {currentSignal.direction === 'LONG' ? 'BUY CE candidate' : 'BUY PE candidate'}
                </div>
              </div>
              <div className="p-3 bg-bg-secondary rounded-lg">
                <div className="text-xs text-slate-400">Entry</div>
                <div className="text-xl font-mono font-bold text-white">₹{currentSignal.entryPrice.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-bg-secondary rounded-lg">
                <div className="text-xs text-slate-400">Stop Loss</div>
                <div className="text-xl font-mono font-bold text-red-400">₹{currentSignal.stopLoss.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-bg-secondary rounded-lg">
                <div className="text-xs text-slate-400">Target</div>
                <div className="text-xl font-mono font-bold text-green-400">₹{currentSignal.target.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-bg-secondary rounded-lg md:col-span-2">
                <div className="text-xs text-slate-400">Confluence Factors</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {currentSignal.confluenceFactors.map((factor: string, i: number) => (
                    <span key={i} className="bg-slate-800 text-slate-200 text-xs px-2 py-1 rounded">{factor}</span>
                  ))}
                </div>
              </div>
              <div className="p-3 bg-bg-secondary rounded-lg">
                <div className="text-xs text-slate-400">Confidence</div>
                <div className="text-xl font-bold text-white">{(currentSignal.confidence * 100).toFixed(0)}%</div>
              </div>
              <div className="p-3 bg-bg-secondary rounded-lg">
                <div className="text-xs text-slate-400">R:R</div>
                <div className="text-xl font-bold text-white">1:{currentSignal.riskRewardRatio.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
              <ShieldAlert size={14} className="inline-block mr-1" />
              <strong>Directional candidate only:</strong> LONG = BUY CE candidate, SHORT = BUY PE candidate. No options contract has been selected.
            </div>
          </div>
        </div>
      )}

      {/* Live Chart */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Live Chart</h3>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400">{quotes.size} live quotes</span>
            <span className="text-slate-400">{scanResults.size} scan results</span>
          </div>
        </div>
        <div className="card-body">
          {/* 
            For live mode, we don't have historical candles from the API yet.
            We'll show a placeholder that explains this. 
            In production, this would connect to a WebSocket or polling endpoint
            that provides the full candle history.
          */}
          <div className="h-[400px] flex items-center justify-center bg-bg-secondary/50 rounded-lg">
            <div className="text-center">
              <Activity size={48} className="text-slate-600 mx-auto mb-4" />
              <div className="text-slate-400 text-lg mb-2">Live Chart</div>
              <div className="text-slate-500 text-sm max-w-md mx-auto">
                Connect to Upstox to see live candles. The chart will display completed candles 
                as they form, with signal markers at their exact timestamps.
              </div>
              {currentSignal && (
                <div className="mt-4 p-3 bg-bg-tertiary rounded-lg inline-block max-w-md">
                  <div className="text-xs text-slate-400">Next signal will appear here when detected</div>
                  <div className="text-sm font-mono text-white mt-1">
                    {currentSignal.direction === 'LONG' ? '▲' : '▼'} {currentSignal.direction} @ ₹{currentSignal.entryPrice.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Paper Trades */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <DollarSign className="text-accent" size={20} />
            Paper Trades
          </h3>
          <span className="text-sm text-slate-400">{paperTrades.length} trades</span>
        </div>
        <div className="card-body">
          {paperTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48">
              <Target size={40} className="text-slate-600 mb-3" />
              <div className="text-slate-400 mb-1">No paper trades yet</div>
              <div className="text-slate-500 text-sm">Start the scanner and wait for signals</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-sm text-slate-400">
                    <th className="pb-2 pr-4">Symbol</th>
                    <th className="pb-2 pr-4">Dir</th>
                    <th className="pb-2 pr-4">Entry</th>
                    <th className="pb-2 pr-4">SL</th>
                    <th className="pb-2 pr-4">Target</th>
                    <th className="pb-2 pr-4">State</th>
                    <th className="pb-2 pr-4">P&L</th>
                    <th className="pb-2 pr-4">R</th>
                  </tr>
                </thead>
                <tbody>
                  {paperTrades.map(trade => (
                    <tr key={trade.id} className="border-b border-slate-800/50">
                      <td className="py-3 pr-4 text-white font-medium">{trade.symbol}</td>
                      <td className="py-3 pr-4">
                        <span className={trade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                          {trade.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-white">{trade.entryPrice ? `₹${trade.entryPrice.toFixed(2)}` : '—'}</td>
                      <td className="py-3 pr-4 font-mono text-red-400">₹{trade.currentStopLoss.toFixed(2)}</td>
                      <td className="py-3 pr-4 font-mono text-green-400">₹{trade.target.toFixed(2)}</td>
                      <td className="py-3 pr-4">
                        <span className={clsx(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          trade.state === 'OPEN' && 'bg-green-500/20 text-green-400',
                          trade.state === 'PENDING' && 'bg-yellow-500/20 text-yellow-400',
                          trade.state === 'CLOSED' && 'bg-blue-500/20 text-blue-400',
                          trade.state === 'STOPPED' && 'bg-red-500/20 text-red-400',
                          trade.state === 'CANCELLED' && 'bg-slate-500/20 text-slate-400',
                        )}>
                          {trade.state}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono">
                        {trade.pnl !== null && trade.pnl !== undefined ? (
                          <span className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono">
                        {trade.rMultiple !== null && trade.rMultiple !== undefined ? (
                          <span className={trade.rMultiple >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {trade.rMultiple.toFixed(2)}R
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* All Scan Results */}
      {scanResults.size > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-white">All Scan Results</h3>
          </div>
          <div className="card-body">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-sm text-slate-400">
                    <th className="pb-2 pr-4">Symbol</th>
                    <th className="pb-2 pr-4">TF</th>
                    <th className="pb-2 pr-4">Signal</th>
                    <th className="pb-2 pr-4">Entry</th>
                    <th className="pb-2 pr-4">SL</th>
                    <th className="pb-2 pr-4">Target</th>
                    <th className="pb-2 pr-4">Confidence</th>
                    <th className="pb-2 pr-4">Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(scanResults.entries()).map(([key, result]) => (
                    <tr key={key} className="border-b border-slate-800/50">
                      <td className="py-3 pr-4 text-white font-medium">{result.symbol}</td>
                      <td className="py-3 pr-4 text-slate-300">{result.timeframe}</td>
                      <td className="py-3 pr-4">
                        {result.signal ? (
                          <span className={result.signal.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                            {result.signal.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
                          </span>
                        ) : (
                          <span className="text-slate-500">No Signal</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-white">
                        {result.signal ? `₹${result.signal.entryPrice.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-red-400">
                        {result.signal ? `₹${result.signal.stopLoss.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-green-400">
                        {result.signal ? `₹${result.signal.target.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-white">
                        {result.signal ? `{(result.signal.confidence * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-300">
                        {result.confluenceFactors.join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Need to import clsx
import clsx from 'clsx';