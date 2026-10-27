import { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  RotateCw,
  Target,
  Gauge,
  History,
  AlertTriangle,
  Stethoscope,
  FlaskConical,
  Filter,
  Info,
} from 'lucide-react';
import { api } from '../api/client';
import { ReplayChart } from '../components/ReplayChart';
import { PredictionInspector } from '../components/PredictionInspector';
import type {
  Prediction,
  ReplayStatus,
  Metrics,
  Diagnostics,
  CandleData,
  StrategyFunnel,
  FilteredSignal,
  DecisionTrace,
  CandidateSignal,
} from '../types/replay';

interface DataFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

type DirFilter = 'ALL' | 'LONG' | 'SHORT';
type OutcomeFilter = 'ALL' | 'CORRECT' | 'INCORRECT' | 'TIE' | 'INCONCLUSIVE';
type TraceOutcomeFilter = 'ALL' | 'SIGNAL' | 'NO_SIGNAL' | 'FILTERED' | 'ERROR';
type CandidateStatusFilter = 'ALL' | 'ACCEPTED' | 'FILTERED' | 'PENDING_FILTERS' | 'ERROR';

interface StrategyConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedTimeframes: string[];
  parameters: Record<string, any>;
  symbols: string[];
  enabled: boolean;
}

export function Replay() {
  const [dataFiles, setDataFiles] = useState<DataFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [dataSource, setDataSource] = useState<'csv' | 'api'>('api');
  const [symbol, setSymbol] = useState<string>('NIFTY50');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [endDate, setEndDate] = useState<string>('');
  const [candleCount, setCandleCount] = useState<string>('100');
  const [speed, setSpeed] = useState<number>(0);
  const [horizon, setHorizon] = useState<number>(5);
  const [filters, setFilters] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [replayId, setReplayId] = useState<string>('');
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(['confluence-zone-em2']);
  const [strategyConfig, setStrategyConfig] = useState<Record<string, Record<string, any>>>({
    'confluence-zone-em2': {
      useSupportResistance: true,
      useFibonacci: true,
      useTrendline: true,
      useRejectionCandle: true,
      useMinimumConfluence: true,
      useMinimumRiskReward: true,
      minConfluenceFactors: 2,
      minRejectionWickRatio: 2.0,
      targetRR: 2,
    },
    'trendline-break': {
      minTrendlineTouches: 3,
      breakConfirmationBars: 2,
      retestToleranceATR: 0.3,
      requireRetest: false,
      targetRR: 2,
    },
    'fib-pullback': {
      fibLevels: [0.5, 0.618, 0.786],
      toleranceATR: 0.3,
      requireTrendAlignment: true,
      minSwingSize: 2,
      targetRR: 2,
    },
    'sr-retest': {
      minZoneTouches: 2,
      lookbackBars: 100,
      toleranceATR: 0.5,
      requireFlip: true,
      minRejectionWickRatio: 1.5,
      targetRR: 2,
    },
  });
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [filteredSignals, setFilteredSignals] = useState<FilteredSignal[]>([]);
  const [candidateSignals, setCandidateSignals] = useState<CandidateSignal[]>([]);
  const [decisionTraces, setDecisionTraces] = useState<DecisionTrace[]>([]);
  const [traceOutcomeFilter, setTraceOutcomeFilter] = useState<TraceOutcomeFilter>('ALL');
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<CandidateStatusFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirFilter, setDirFilter] = useState<DirFilter>('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [showNoTrade, setShowNoTrade] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // NIFTY download state
  const [niftyDownload, setNiftyDownload] = useState<{
    loading: boolean;
    result?: any;
    error?: string;
  }>({ loading: false });

  const [showDownload, setShowDownload] = useState<boolean>(false);
  
  const niftyFromDate = useMemo(() => 
    endDate 
      ? new Date(new Date(endDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  , [endDate]);
  
  const niftyToDate = useMemo(() => 
    endDate ? new Date(endDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  , [endDate]);

  const handleNiftyDownload = async () => {
    setNiftyDownload({ loading: true, error: undefined });
    try {
      const res = await api.replay.downloadNifty({
        timeframe,
        fromDate: niftyFromDate,
        toDate: niftyToDate,
        cacheConfig: { enabled: true, cacheDir: './data/nifty-cache', maxAgeDays: 7 },
      });
      setNiftyDownload({ loading: false, result: res.data });
    } catch (err) {
      setNiftyDownload({ loading: false, error: err instanceof Error ? err.message : 'Download failed' });
    }
  };

  const availableSymbols = useMemo(() => {
    if (dataSource === 'api') {
      return [
        'NIFTY50',
        'BANKNIFTY',
        'NIFTYIT',
        'NIFTYMIDCAP',
        'FINNIFTY',
        'RELIANCE', 
        'TCS', 
        'INFY', 
        'HDFCBANK', 
        'ICICIBANK', 
        'SBIN', 
        'BHARTIARTL', 
        'ITC', 
        'KOTAKBANK', 
        'LT', 
        'HINDUNILVR', 
        'AXISBANK', 
        'MARUTI', 
        'BAJFINANCE', 
        'TATAMOTORS'
      ];
    }
    const symbols = new Set<string>();
    dataFiles.forEach(file => {
      const match = file.name.match(/^([A-Za-z]+)_/);
      if (match) symbols.add(match[1].toUpperCase());
    });
    return Array.from(symbols).sort();
  }, [dataFiles, dataSource]);

  useEffect(() => {
    if (dataSource !== 'csv') return;

    async function loadFiles() {
      try {
        const res = await api.replay.getDataFiles();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource]);

  // Fetch available strategies and their supported timeframes
  useEffect(() => {
    async function loadStrategies() {
      try {
        interface StrategiesResponse {
          success: boolean;
          strategies: StrategyConfig[];
        }
        const res = await api.get<StrategiesResponse>('/replay/strategies');
        if (res.success && res.strategies) {
          setStrategies(res.strategies);
          if (!res.strategies.find((s: StrategyConfig) => selectedStrategies.includes(s.id))) {
            setSelectedStrategies([res.strategies[0]?.id || '']);
          }
        }
      } catch (err) {
        console.error('Failed to load strategies:', err);
      }
    }
    loadStrategies();
  }, []);

  /** Select a data file and auto-derive the symbol from its name */
  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath);
    const file = dataFiles.find(f => f.path === filePath);
    const match = file?.name.match(/^([A-Za-z]+)_/);
    if (match) setSymbol(match[1].toUpperCase());
  };

  const refreshPredictions = async () => {
    try {
      const res = await api.replay.getPredictions(replayId);
      setPredictions(res.predictions);
    } catch (err) {
      console.error('Failed to load predictions:', err);
    }
  };

  const refreshDiagnostics = async () => {
    try {
      const res = await api.replay.getDiagnostics(replayId);
      // New API returns array of diagnostics per strategy
      if (Array.isArray(res.diagnostics)) {
        // Use the first strategy's diagnostics for backward compatibility, or merge if needed
        setDiagnostics(res.diagnostics[0]?.diagnostics || null);
      } else {
        setDiagnostics(res.diagnostics);
      }
    } catch (err) {
      console.error('Failed to load diagnostics:', err);
    }
  };

  const refreshFilteredSignals = async () => {
    try {
      const res = await api.replay.getFilteredSignals(replayId);
      setFilteredSignals(res.filteredSignals || []);
    } catch (err) {
      console.error('Failed to load filtered signals:', err);
    }
  };

  const refreshCandidateSignals = async () => {
    try {
      const res = await api.replay.getCandidateSignals(replayId);
      setCandidateSignals(res.candidateSignals || []);
    } catch (err) {
      console.error('Failed to load candidate signals:', err);
    }
  };

  const refreshDecisionTraces = async () => {
    try {
      const res = await api.replay.getDecisionTraces(replayId);
      setDecisionTraces(res.decisionTraces || []);
    } catch (err) {
      console.error('Failed to load decision traces:', err);
    }
  };

  const loadReplayData = async () => {
    try {
      const candlesRes = await api.replay.getCandles(replayId);
      setCandles(candlesRes.candles);

      const predsRes = await api.replay.getPredictions(replayId);
      setPredictions(predsRes.predictions);

      try {
        const metricsRes = await api.replay.getMetrics(replayId);
        setMetrics(metricsRes.metrics);
      } catch (err) {
        console.error('Failed to load metrics:', err);
      }

      await refreshDiagnostics();
      await refreshFilteredSignals();
      await refreshCandidateSignals();
      await refreshDecisionTraces();
    } catch (err) {
      console.error('Failed to load replay data:', err);
    }
  };

  // Poll replay status while running
  useEffect(() => {
    if (!replayId || !isRunning) return;

    const poll = async () => {
      try {
        const res = await api.replay.getStatus(replayId);
        const s = res.status;
        setStatus(s);

        if (s.status === 'COMPLETED' || s.status === 'STOPPED') {
          setIsRunning(false);
          await loadReplayData();
        } else if (s.status === 'RUNNING') {
          // Live-update predictions and diagnostics while running
          await refreshPredictions();
          refreshDiagnostics();
        }
      } catch (err) {
        console.error('Failed to poll replay status:', err);
      }
    };

    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayId, isRunning]);

  const handleStart = async () => {
    if (dataSource === 'csv' && (!selectedFile || !symbol)) {
      setError('Please select a data file and symbol');
      return;
    }
    if (dataSource === 'api' && !symbol) {
      setError('Please select a symbol');
      return;
    }

    setError(null);
    setCandles([]);
    setPredictions([]);
    setMetrics(null);
    setDiagnostics(null);
    setSelectedId(null);
    setStatus(null);

    try {
      const body: Parameters<typeof api.replay.start>[0] = {
        dataSource,
        symbol,
        timeframe,
        strategyIds: selectedStrategies,
        endDate: endDate || undefined,
        candleCount: parseInt(candleCount) || 100,
        speed,
        evaluationHorizon: { candles: horizon },
        filtersEnabled: filters,
        looseFilters: false,
        strategyConfig: selectedStrategies.length > 0 ? strategyConfig : undefined,
      };

      if (dataSource === 'csv') {
        body.filePath = selectedFile;
      }

      const res = await api.replay.start(body);

      setReplayId(res.id);
      setStatus(res.status);
      setIsRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start replay');
    }
  };

  const handlePause = async () => {
    try {
      const res = await api.replay.pause(replayId);
      setStatus(res.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause replay');
    }
  };

  const handleResume = async () => {
    try {
      const res = await api.replay.resume(replayId);
      setStatus(res.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume replay');
    }
  };

  const handleStop = async () => {
    try {
      setIsRunning(false);
      const res = await api.replay.stop(replayId);
      setStatus(res.status);
      if (res.result) {
        setCandles(res.result.candles);
        setPredictions(res.result.predictions);
        setMetrics(res.result.metrics);
        setDiagnostics(res.result.diagnostics);
        if (res.result.filteredSignals) {
          setFilteredSignals(res.result.filteredSignals);
        }
        if (res.result.candidateSignals) {
          setCandidateSignals(res.result.candidateSignals);
        }
      } else {
        await loadReplayData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop replay');
    }
  };

  // Get supported timeframes for the selected strategy
  const selectedStrategyConfigs = strategies.filter(s => selectedStrategies.includes(s.id));
  const supportedTimeframes = selectedStrategyConfigs.flatMap(s => s.supportedTimeframes);
  const timeframes = [...new Set(supportedTimeframes.length > 0 ? supportedTimeframes : ['1m', '5m', '15m', '30m', '1h', '4h', '1d'])];
  
  // A timeframe is supported if at least one selected strategy supports it
  const isTimeframeSupported = timeframes.includes(timeframe);
  
  // Check if all selected strategies support the current timeframe
  const allStrategiesSupportTimeframe = selectedStrategyConfigs.every(s => s.supportedTimeframes.includes(timeframe));

  // Higher-timeframe (HTF) confirmation mapping
  const htfTimeframeMap: Record<string, string> = {
    '1m': '5m',
    '5m': '15m',
    '15m': '1h',
    '30m': '1h',
    '1h': '4h',
    '4h': '1d',
    '1d': '1d',
  };
  const htfTimeframe = htfTimeframeMap[timeframe] || timeframe;

  const speeds = [
    { value: 0, label: 'Instant' },
    { value: 1, label: '1x' },
    { value: 5, label: '5x' },
    { value: 10, label: '10x' },
    { value: 20, label: '20x' },
  ];

  const statusColor = {
    IDLE: 'text-slate-400',
    RUNNING: 'text-green-400',
    PAUSED: 'text-yellow-400',
    COMPLETED: 'text-blue-400',
    STOPPED: 'text-red-400',
    ERROR: 'text-red-400',
  } as const;

  const getStatusBadge = () => {
    if (!status) return <span className="text-slate-500">Not started</span>;
    const color = statusColor[status.status] || 'text-slate-400';
    return <span className={`${color} font-semibold`}>{status.status}</span>;
  };

  const selectedPrediction = useMemo(
    () => predictions.find(p => p.id === selectedId) ?? null,
    [predictions, selectedId]
  );

  const warmupCount = diagnostics?.warmupCandles ?? status?.warmupCandles ?? 0;

  // Signal counts
  const longCount = predictions.filter(p => p.direction === 'LONG').length;
  const shortCount = predictions.filter(p => p.direction === 'SHORT').length;
  const noTradeCount = predictions.filter(p => p.direction === 'NO_TRADE').length;
  const directionalCount = longCount + shortCount;
  const evaluatedDirectional = predictions.filter(p => p.evaluation && p.direction !== 'NO_TRADE').length;
  const inconclusiveCount = predictions.filter(p => p.evaluationStatus === 'INCONCLUSIVE').length;
  const postWarmupExamined = (diagnostics?.candlesExamined ?? status?.candlesExamined ?? 0);
  const totalCandlesLoaded = status?.totalCandles ?? candles.length;

  const hasDirectionalSignals = directionalCount > 0;
  const tooFewPostWarmup = postWarmupExamined > 0 && postWarmupExamined < 30;
  const noPostWarmupCandles = postWarmupExamined === 0 && totalCandlesLoaded > 0;

  // Explorer filtering
  const filteredPredictions = useMemo(() => {
    return predictions.filter(p => {
      if (p.direction === 'NO_TRADE') return showNoTrade;
      if (dirFilter !== 'ALL' && p.direction !== dirFilter) return false;
      if (outcomeFilter !== 'ALL') {
        const outcome = p.evaluation ? p.evaluation.directional.outcome : (p.evaluationStatus === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'PENDING');
        if (outcomeFilter === 'INCONCLUSIVE') {
          if (outcome !== 'INCONCLUSIVE' && outcome !== 'PENDING') return false;
        } else if (outcome !== outcomeFilter) {
          return false;
        }
      }
      return true;
    });
  }, [predictions, dirFilter, outcomeFilter, showNoTrade]);

  const filteredDecisionTraces = useMemo(() => {
    return decisionTraces.filter(t => {
      if (traceOutcomeFilter !== 'ALL' && t.outcome !== traceOutcomeFilter) return false;
      return true;
    });
  }, [decisionTraces, traceOutcomeFilter]);

  const filteredCandidateSignals = useMemo(() => {
    return candidateSignals.filter(cs => {
      if (candidateStatusFilter !== 'ALL' && cs.status !== candidateStatusFilter) return false;
      return true;
    });
  }, [candidateSignals, candidateStatusFilter]);

  const hasReplayData = status !== null || candles.length > 0 || predictions.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
          <History className="text-accent" size={32} />
          Historical Replay & Prediction Evaluation
        </h1>
        <p className="text-slate-400 mt-1">
          Replay candles chronologically, generate strategy predictions, and evaluate their outcomes against subsequent price action
        </p>
      </div>

      {/* Section 1: Replay Setup */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Replay Setup</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Status:</span>
            {getStatusBadge()}
          </div>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Data Source */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Data Source</label>
              <select
                value={dataSource}
                onChange={e => setDataSource(e.target.value as 'csv' | 'api')}
                disabled={isRunning}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="csv">CSV File</option>
                <option value="api">Upstox API</option>
              </select>
            </div>

            {/* Data File (CSV only) */}
            {dataSource === 'csv' && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">Data File</label>
                <select
                  value={selectedFile}
                  onChange={e => handleFileSelect(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  {dataFiles.map(file => (
                    <option key={file.path} value={file.path}>
                      {file.name} ({new Date(file.modified).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Symbol */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Instrument</label>
              <select
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                disabled={isRunning}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
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
                disabled={isRunning}
                className={`w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 ${!isTimeframeSupported ? 'border-amber-500' : ''}`}
              >
                {timeframes.map(tf => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
              {!allStrategiesSupportTimeframe && (
                <p className="mt-1 text-xs text-amber-400">
                  ⚠️ "{timeframe}" not supported by all selected strategies. Supported by: {selectedStrategyConfigs.filter(s => s.supportedTimeframes.includes(timeframe)).map(s => s.name).join(', ')}. All supported timeframes: {timeframes.join(', ')}
                </p>
              )}
              {isTimeframeSupported && (
                <p className="mt-1 text-xs text-slate-500">
                  Higher-timeframe confirmation: {htfTimeframe} (per strategy spec hierarchy)
                </p>
              )}
            </div>

            {/* Strategy */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Strategies (multi-select)</label>
              <div className="bg-bg-secondary border border-slate-700 rounded p-3 max-h-48 overflow-y-auto">
                {strategies.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStrategies.includes(s.id)}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedStrategies(prev => [...prev, s.id]);
                        } else {
                          setSelectedStrategies(prev => prev.filter(id => id !== s.id));
                        }
                      }}
                      disabled={isRunning}
                      className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2"
                    />
                    <span className="text-white">{s.name}</span>
                    <span className="text-slate-500 text-xs">({s.id})</span>
                    <span className="text-slate-500 text-xs">[{s.supportedTimeframes.join(', ')}]</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {selectedStrategies.length} of {strategies.length} selected
              </p>
            </div>
          </div>

          {/* Strategy Configuration Panel */}
            {selectedStrategies.includes('confluence-zone-em2') && (
              <div className="card mt-4">
                <div className="card-header">
                  <h4 className="text-md font-semibold text-white flex items-center gap-2">
                    <Stethoscope className="text-accent" size={18} />
                    Confluence Zone EM2 Configuration
                  </h4>
                </div>
                <div className="card-body space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={strategyConfig['confluence-zone-em2']?.useSupportResistance ?? true}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'confluence-zone-em2': { ...prev['confluence-zone-em2'], useSupportResistance: e.target.checked }
                        }))}
                        disabled={isRunning}
                        className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                      />
                      <span className="text-white text-sm">Support/Resistance</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={strategyConfig['confluence-zone-em2']?.useFibonacci ?? true}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'confluence-zone-em2': { ...prev['confluence-zone-em2'], useFibonacci: e.target.checked }
                        }))}
                        disabled={isRunning}
                        className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                      />
                      <span className="text-white text-sm">Fibonacci</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={strategyConfig['confluence-zone-em2']?.useTrendline ?? true}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'confluence-zone-em2': { ...prev['confluence-zone-em2'], useTrendline: e.target.checked }
                        }))}
                        disabled={isRunning}
                        className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                      />
                      <span className="text-white text-sm">Trendline</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={strategyConfig['confluence-zone-em2']?.useRejectionCandle ?? true}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'confluence-zone-em2': { ...prev['confluence-zone-em2'], useRejectionCandle: e.target.checked }
                        }))}
                        disabled={isRunning}
                        className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                      />
                      <span className="text-white text-sm">Rejection Candle (EM2)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={strategyConfig['confluence-zone-em2']?.useMinimumConfluence ?? true}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'confluence-zone-em2': { ...prev['confluence-zone-em2'], useMinimumConfluence: e.target.checked }
                        }))}
                        disabled={isRunning}
                        className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                      />
                      <span className="text-white text-sm">Minimum Confluence</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={strategyConfig['confluence-zone-em2']?.useMinimumRiskReward ?? true}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'confluence-zone-em2': { ...prev['confluence-zone-em2'], useMinimumRiskReward: e.target.checked }
                        }))}
                        disabled={isRunning}
                        className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                      />
                      <span className="text-white text-sm">Minimum Risk/Reward</span>
                    </label>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-700 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Min Confluence Factors</label>
                        <select
                          value={strategyConfig['confluence-zone-em2']?.minConfluenceFactors ?? 2}
                          onChange={e => setStrategyConfig(prev => ({
                            ...prev,
                            'confluence-zone-em2': { ...prev['confluence-zone-em2'], minConfluenceFactors: parseInt(e.target.value) }
                          }))}
                          disabled={isRunning || !(strategyConfig['confluence-zone-em2']?.useMinimumConfluence ?? true)}
                          className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        >
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Min Rejection Wick Ratio</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="10"
                          value={strategyConfig['confluence-zone-em2']?.minRejectionWickRatio ?? 2.0}
                          onChange={e => setStrategyConfig(prev => ({
                            ...prev,
                            'confluence-zone-em2': { ...prev['confluence-zone-em2'], minRejectionWickRatio: parseFloat(e.target.value) }
                          }))}
                          disabled={isRunning || !(strategyConfig['confluence-zone-em2']?.useRejectionCandle ?? true)}
                          className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Target R:R</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="20"
                          value={strategyConfig['confluence-zone-em2']?.targetRR ?? 2}
                          onChange={e => setStrategyConfig(prev => ({
                            ...prev,
                            'confluence-zone-em2': { ...prev['confluence-zone-em2'], targetRR: parseFloat(e.target.value) }
                          }))}
                          disabled={isRunning}
                          className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">
                      Defaults reproduce current behavior. Disabled components are marked SKIPPED in diagnostics.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Trendline Break Configuration */}
            {selectedStrategies.includes('trendline-break') && (
              <div className="card mt-4">
                <div className="card-header">
                  <h4 className="text-md font-semibold text-white flex items-center gap-2">
                    <Stethoscope className="text-accent" size={18} />
                    Trendline Break Configuration
                  </h4>
                </div>
                <div className="card-body space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Min Trendline Touches</label>
                      <select
                        value={strategyConfig['trendline-break']?.minTrendlineTouches ?? 3}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'trendline-break': { ...prev['trendline-break'], minTrendlineTouches: parseInt(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      >
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Break Confirmation Bars</label>
                      <select
                        value={strategyConfig['trendline-break']?.breakConfirmationBars ?? 2}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'trendline-break': { ...prev['trendline-break'], breakConfirmationBars: parseInt(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Retest Tolerance (ATR)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="5"
                        value={strategyConfig['trendline-break']?.retestToleranceATR ?? 0.3}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'trendline-break': { ...prev['trendline-break'], retestToleranceATR: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-slate-700">
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={strategyConfig['trendline-break']?.requireRetest ?? false}
                          onChange={e => setStrategyConfig(prev => ({
                            ...prev,
                            'trendline-break': { ...prev['trendline-break'], requireRetest: e.target.checked }
                          }))}
                          disabled={isRunning}
                          className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                        />
                        <span className="text-white text-sm">Require Retest</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Target R:R</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="20"
                        value={strategyConfig['trendline-break']?.targetRR ?? 2}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'trendline-break': { ...prev['trendline-break'], targetRR: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Defaults reproduce current behavior.
                  </p>
                </div>
              </div>
            )}

            {/* Fibonacci Pullback Configuration */}
            {selectedStrategies.includes('fib-pullback') && (
              <div className="card mt-4">
                <div className="card-header">
                  <h4 className="text-md font-semibold text-white flex items-center gap-2">
                    <Stethoscope className="text-accent" size={18} />
                    Fibonacci Pullback Configuration
                  </h4>
                </div>
                <div className="card-body space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Fib Levels</label>
                      <div className="flex flex-wrap gap-1">
                        {[0.382, 0.5, 0.618, 0.786, 0.886].map(level => (
                          <label key={level} className="flex items-center gap-1 cursor-pointer mr-2">
                            <input
                              type="checkbox"
                              checked={strategyConfig['fib-pullback']?.fibLevels?.includes(level) ?? [0.5, 0.618, 0.786].includes(level)}
                              onChange={e => setStrategyConfig(prev => {
                                const current = prev['fib-pullback']?.fibLevels || [0.5, 0.618, 0.786];
                                const updated = e.target.checked 
                                  ? [...current, level] 
                                  : current.filter((l: number) => l !== level);
                                return {
                                  ...prev,
                                  'fib-pullback': { ...prev['fib-pullback'], fibLevels: updated }
                                };
                              })}
                              disabled={isRunning}
                              className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                            />
                            <span className="text-white text-xs">{level}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Tolerance (ATR)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={strategyConfig['fib-pullback']?.toleranceATR ?? 0.3}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'fib-pullback': { ...prev['fib-pullback'], toleranceATR: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={strategyConfig['fib-pullback']?.requireTrendAlignment ?? true}
                          onChange={e => setStrategyConfig(prev => ({
                            ...prev,
                            'fib-pullback': { ...prev['fib-pullback'], requireTrendAlignment: e.target.checked }
                          }))}
                          disabled={isRunning}
                          className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                        />
                        <span className="text-white text-sm">Require Trend Alignment</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-slate-700">
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Min Swing Size (ATR)</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="10"
                        value={strategyConfig['fib-pullback']?.minSwingSize ?? 2}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'fib-pullback': { ...prev['fib-pullback'], minSwingSize: parseInt(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Target R:R</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="20"
                        value={strategyConfig['fib-pullback']?.targetRR ?? 2}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'fib-pullback': { ...prev['fib-pullback'], targetRR: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Defaults reproduce current behavior.
                  </p>
                </div>
              </div>
            )}

            {/* S/R Retest Configuration */}
            {selectedStrategies.includes('sr-retest') && (
              <div className="card mt-4">
                <div className="card-header">
                  <h4 className="text-md font-semibold text-white flex items-center gap-2">
                    <Stethoscope className="text-accent" size={18} />
                    S/R Retest Configuration
                  </h4>
                </div>
                <div className="card-body space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Min Zone Touches</label>
                      <select
                        value={strategyConfig['sr-retest']?.minZoneTouches ?? 2}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'sr-retest': { ...prev['sr-retest'], minZoneTouches: parseInt(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Lookback Bars</label>
                      <input
                        type="number"
                        step="10"
                        min="20"
                        max="500"
                        value={strategyConfig['sr-retest']?.lookbackBars ?? 100}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'sr-retest': { ...prev['sr-retest'], lookbackBars: parseInt(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Tolerance (ATR)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={strategyConfig['sr-retest']?.toleranceATR ?? 0.5}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'sr-retest': { ...prev['sr-retest'], toleranceATR: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-slate-700">
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={strategyConfig['sr-retest']?.requireFlip ?? true}
                          onChange={e => setStrategyConfig(prev => ({
                            ...prev,
                            'sr-retest': { ...prev['sr-retest'], requireFlip: e.target.checked }
                          }))}
                          disabled={isRunning}
                          className="w-4 h-4 text-accent border-slate-600 rounded focus:ring-accent focus:ring-2 disabled:opacity-50"
                        />
                        <span className="text-white text-sm">Require S/R Flip</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Min Rejection Wick Ratio</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="5"
                        value={strategyConfig['sr-retest']?.minRejectionWickRatio ?? 1.5}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'sr-retest': { ...prev['sr-retest'], minRejectionWickRatio: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Target R:R</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="20"
                        value={strategyConfig['sr-retest']?.targetRR ?? 2}
                        onChange={e => setStrategyConfig(prev => ({
                          ...prev,
                          'sr-retest': { ...prev['sr-retest'], targetRR: parseFloat(e.target.value) }
                        }))}
                        disabled={isRunning}
                        className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Defaults reproduce current behavior.
                  </p>
                </div>
              </div>
            )}

            {/* NIFTY Data Download (API mode only) */}
            {dataSource === 'api' && (
            <div className="card mt-4">
              <div className="card-header">
                <button
                  type="button"
                  onClick={() => setShowDownload(v => !v)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <h4 className="text-md font-semibold text-white flex items-center gap-2">
                    <Target className="text-accent" size={18} />
                    NIFTY 50 Historical Data Download
                  </h4>
                  <span className="text-slate-400 text-sm">{showDownload ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              {showDownload && (
              <div className="card-body space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Timeframe</label>
                    <select
                      value={timeframe}
                      onChange={e => setTimeframe(e.target.value)}
                      disabled={isRunning}
                      className={`w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 ${!isTimeframeSupported ? 'border-amber-500' : ''}`}
                    >
                      {timeframes.map(tf => (
                        <option key={tf} value={tf}>{tf}</option>
                      ))}
                    </select>
                    {!allStrategiesSupportTimeframe && (
                      <p className="mt-1 text-xs text-amber-400">
                        ⚠️ "{timeframe}" not supported by all selected strategies. Supported by: {selectedStrategyConfigs.filter(s => s.supportedTimeframes.includes(timeframe)).map(s => s.name).join(', ')}. All supported timeframes: {timeframes.join(', ')}
                      </p>
                    )}
                    {isTimeframeSupported && (
                      <p className="mt-1 text-xs text-slate-500">
                        HTF confirmation: {htfTimeframe}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">From Date</label>
                    <input
                      type="date"
                      value={endDate ? new Date(new Date(endDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                      onChange={() => {}}
                      disabled={isRunning}
                      className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">To Date</label>
                    <input
                      type="date"
                      value={endDate ? new Date(endDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                      onChange={() => {}}
                      disabled={isRunning}
                      className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Cache Age (days)</label>
                    <input
                      type="number"
                      value={7}
                      min={1}
                      max={30}
                      className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleNiftyDownload}
                      disabled={isRunning || niftyDownload.loading}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                    >
                      {niftyDownload.loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Downloading...
                        </span>
                      ) : 'Download NIFTY 50 Data'}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  Instrument: NIFTY 50 (NSE_INDEX|Nifty 50) · Supported: 1m, 5m, 15m, 30m, 1h, 4h, 1d · Data cached locally for 7 days by default
                </div>
                
                {/* Download Result Display */}
                {niftyDownload.result && (
                  <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
                      <Info size={16} />
                      <span>Download Complete</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500">Status:</span>
                        <span className="text-green-400 ml-1">{niftyDownload.result.success ? 'Success' : 'Failed'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Candles:</span>
                        <span className="text-white ml-1">{niftyDownload.result.data?.metadata?.candles?.length || niftyDownload.result.data?.candles?.length || 0}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">From Cache:</span>
                        <span className="text-white ml-1">{niftyDownload.result.data?.fromCache ? 'Yes' : 'No'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Time:</span>
                        <span className="text-white ml-1">{niftyDownload.result.data?.metadata?.downloadTimeMs || 0}ms</span>
                      </div>
                    </div>
                    {niftyDownload.result.data?.validation && (
                      <div className="border-t border-green-500/30 pt-2">
                        <div className="text-xs text-slate-400">Validation:</div>
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className={niftyDownload.result.data.validation.isValid ? 'text-green-400' : 'text-red-400'}>
                            {niftyDownload.result.data.validation.isValid ? '✓ Valid' : '✗ Invalid'}
                          </span>
                          {niftyDownload.result.data.validation.warnings.length > 0 && (
                            <span className="text-yellow-400">
                              {niftyDownload.result.data.validation.warnings.length} warnings
                            </span>
                          )}
                          <span className="text-slate-400">
                            {niftyDownload.result.data.validation.stats?.totalCandles || 0} candles
                          </span>
                        </div>
                        {niftyDownload.result.data.validation.warnings.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {niftyDownload.result.data.validation.warnings.map((w: string, i: number) => (
                              <div key={i} className="text-yellow-400 text-[10px]">⚠ {w}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-slate-500">
                      Downloaded data can now be used for replay by selecting "Upstox API" as data source and "NIFTY50" as symbol.
                    </div>
                  </div>
                )}
                {niftyDownload.error && (
                  <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertTriangle size={16} />
                      <span>{niftyDownload.error}</span>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          {/* Date Range & Replay Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Evaluation Candles</label>
              <input
                type="number"
                value={candleCount}
                onChange={e => setCandleCount(e.target.value)}
                min={10}
                max={5000}
                disabled={isRunning}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              <p className="text-xs text-slate-500 mt-1">Warm-up candles (strategy-dependent, ~100) are added automatically</p>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">End Date (optional)</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                disabled={isRunning}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              <p className="text-xs text-slate-500 mt-1">Defaults to now</p>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Replay Speed</label>
              <select
                value={speed}
                onChange={e => setSpeed(parseInt(e.target.value))}
                disabled={isRunning}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                {speeds.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Eval Horizon (candles)</label>
              <input
                type="number"
                value={horizon}
                onChange={e => setHorizon(Math.max(1, Math.min(100, parseInt(e.target.value) || 5)))}
                disabled={isRunning}
                className="w-full bg-bg-secondary border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 border-t border-slate-800 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters}
                onChange={e => setFilters(e.target.checked)}
                disabled={isRunning}
                className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-700 rounded focus:ring-blue-500 disabled:opacity-50"
              />
              <span className="text-sm text-slate-300">Enable Trade Filters</span>
            </label>

            <div className="flex-1" />

            {!isRunning && !status?.status.includes('RUNNING') ? (
              <button
                onClick={handleStart}
                disabled={dataSource === 'csv' ? (!selectedFile || !symbol) : !symbol}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                <Play size={16} />
                <span>Start Replay</span>
              </button>
            ) : (
              <>
                {status?.status === 'RUNNING' && (
                  <button
                    onClick={handlePause}
                    className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-medium rounded-lg transition-colors"
                  >
                    <Pause size={16} />
                    <span>Pause</span>
                  </button>
                )}
                {status?.status === 'PAUSED' && (
                  <button
                    onClick={handleResume}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                  >
                    <RotateCw size={16} />
                    <span>Resume</span>
                  </button>
                )}
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                >
                  <Square size={16} />
                  <span>Stop</span>
                </button>
              </>
            )}
          </div>

          {/* Progress bar */}
          {status && status.totalCandles > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>
                  Candle {Math.min(status.currentIndex + 1, status.totalCandles)} / {status.totalCandles}
                  {warmupCount > 0 && ` · ${warmupCount} warm-up · ${status.candlesExamined ?? 0} examined`}
                </span>
                <span>
                  {status.predictionsGenerated} predictions | {status.predictionsEvaluated} evaluated
                </span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-blue-600 rounded-full transition-all"
                  style={{ width: `${(status.currentIndex / status.totalCandles) * 100}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Empty state before any replay */}
      {!hasReplayData && (
        <div className="card">
          <div className="card-body text-center py-12">
            <Gauge className="mx-auto text-slate-600 mb-3" size={40} />
            <h3 className="text-lg font-semibold text-white mb-1">No replay yet</h3>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Choose a data source, instrument and timeframe above, then start a replay. The engine processes candles
              chronologically, records every prediction immutably with its evidence, and evaluates it against later candles.
            </p>
          </div>
        </div>
      )}

      {/* Section 2: Performance Overview */}
      {(metrics || diagnostics || predictions.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Gauge className="text-accent" size={20} />
            Performance Overview
          </h2>

          {/* Data Overview Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <MetricCard
              label="Total candles loaded"
              value={String(totalCandlesLoaded)}
              icon={<History size={16} />}
            />
            <MetricCard
              label="Warm-up candles"
              value={String(warmupCount)}
              sub="not evaluated"
              icon={<Info size={16} />}
            />
            <MetricCard
              label="Candles examined"
              value={String(postWarmupExamined)}
              sub="post warm-up"
              icon={<Stethoscope size={16} />}
            />
            <MetricCard
              label="Directional signals"
              value={String(directionalCount)}
              sub={`${longCount} LONG · ${shortCount} SHORT`}
              valueClass={directionalCount > 0 ? 'text-green-400' : 'text-slate-400'}
              icon={<Target size={16} />}
            />
            <MetricCard
              label="NO_TRADE decisions"
              value={String(noTradeCount)}
              sub="abstained"
              icon={<Filter size={16} />}
            />
            <MetricCard
              label="Evaluated directional"
              value={String(evaluatedDirectional)}
              sub={inconclusiveCount > 0 ? `${inconclusiveCount} inconclusive` : undefined}
              valueClass={evaluatedDirectional > 0 ? 'text-blue-400' : 'text-slate-400'}
              icon={<Gauge size={16} />}
            />
            <MetricCard
              label="Inconclusive"
              value={String(inconclusiveCount)}
              icon={<AlertTriangle size={16} />}
            />
          </div>

          {/* Warnings */}
          <div className="space-y-2">
            {/* Zero directional signals - show diagnostics prominently */}
            {!hasDirectionalSignals && totalCandlesLoaded > 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <AlertTriangle size={16} />
                  <span>No directional signals generated</span>
                </div>
                {diagnostics && diagnostics.funnel.length > 0 && (
                  <div className="text-sm text-slate-300 space-y-1">
                    {diagnostics.funnel.map((f, fi) => {
                      const funnel = f as any;
                      const parts: string[] = [];
                      if (funnel.candlesExamined > 0) {
                        parts.push(`${funnel.candlesExamined} candles examined`);
                      }
                      const stageOrder = ['srZone', 'fibonacci', 'trendline', 'minConfluence', 'rejection', 'riskReward'];
                      for (const stageKey of stageOrder) {
                        const stage = funnel[stageKey];
                        if (stage && stage.failed > 0) {
                          parts.push(`${stage.failed} failed ${stageKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`);
                          break;
                        } else if (stage && stage.skipped > 0 && stage.passed === 0 && stage.failed === 0) {
                          parts.push(`${stage.skipped} skipped ${stageKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase()} (not reached)`);
                          break;
                        }
                      }
                      if (funnel.signalsFiltered > 0) {
                        parts.push(`${funnel.signalsFiltered} candidates rejected by trade filters`);
                      }
                      return <div key={fi}><strong>{funnel.strategyId}:</strong> {parts.join('; ')}</div>;
                    })}
                  </div>
                )}
                {candidateSignals.length > 0 && (
                  <div className="text-sm text-slate-300 space-y-1">
                    <strong>Candidate signals generated:</strong> {candidateSignals.length}
                    <div className="text-xs text-slate-400 ml-2">
                      Accepted: {candidateSignals.filter(c => c.status === 'ACCEPTED').length} | 
                      Filtered: {candidateSignals.filter(c => c.status === 'FILTERED').length} | 
                      Errors: {candidateSignals.filter(c => c.status === 'ERROR').length}
                    </div>
                    {candidateSignals.filter(c => c.status === 'FILTERED').length > 0 && (
                      <div className="text-xs text-yellow-400 ml-2">
                        Top filter rejections: {(() => {
                          const counts: Record<string, number> = {};
                          for (const c of candidateSignals.filter(c => c.status === 'FILTERED')) {
                            if (c.rejectionReason) counts[c.rejectionReason] = (counts[c.rejectionReason] || 0) + 1;
                          }
                          return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([r,c]) => `${r} (${c})`).join(', ');
                        })()}
                      </div>
                    )}
                  </div>
                )}
                {noPostWarmupCandles && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    <strong>Critical:</strong> No candles available for evaluation after warm-up. 
                    The strategy requires {diagnostics?.minRequiredCandles ?? 100} candles of history before it can evaluate. 
                    Increase candle count to at least {((diagnostics?.minRequiredCandles ?? 100) + 1)} to have evaluable candles.
                  </div>
                )}
                {tooFewPostWarmup && (
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
                    <strong>Warning:</strong> Only {postWarmupExamined} candles available for evaluation after warm-up. 
                    This is too few for statistically meaningful results (recommend ≥30).
                  </div>
                )}
              </div>
            )}

            {tooFewPostWarmup && hasDirectionalSignals && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
                <AlertTriangle size={16} className="inline mt-0.5" />
                <strong>Small sample:</strong> Only {postWarmupExamined} candles evaluated after warm-up. 
                Results may not be statistically reliable (recommend ≥30).
              </div>
            )}

            {metrics?.sampleSize?.warnings && metrics.sampleSize.warnings.length > 0 && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-1">
                {metrics.sampleSize.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-yellow-400 text-sm">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Data range + evaluation rule */}
          {diagnostics && (
            <div className="card">
              <div className="card-body text-xs text-slate-400 space-y-1">
                <div>
                  <span className="text-slate-300">Data range:</span>{' '}
                  {diagnostics.dataStart
                    ? `${new Date(diagnostics.dataStart).toLocaleString()} → ${new Date(diagnostics.dataEnd!).toLocaleString()}`
                    : '—'}
                  {' · '}{timeframe} timeframe
                </div>
                <div>
                  <span className="text-slate-300">Evaluation rule:</span> {diagnostics.evaluationRule}
                </div>
              </div>
            </div>
          )}

          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Tile
              label="Directional accuracy"
              value={metrics ? `${(metrics.directional.accuracy * 100).toFixed(1)}%` : '—'}
              sub={metrics ? `${metrics.sampleSize?.evaluatedDirectional ?? metrics.evaluatedCount} evaluated predictions` : undefined}
              valueClass={metrics && metrics.directional.accuracy >= 0.5 ? 'text-green-400' : 'text-white'}
            />
            <Tile
              label="Avg R-multiple"
              value={metrics?.avgRMultiple != null ? `${metrics.avgRMultiple.toFixed(2)}R` : '—'}
              sub={metrics ? `${metrics.stopTarget.targetFirst} target · ${metrics.stopTarget.stopFirst} stop` : undefined}
            />
            <Tile
              label="NO_TRADE decisions"
              value={String(noTradeCount)}
              sub={diagnostics ? `${diagnostics.minRequiredCandles}-candle warm-up required` : undefined}
            />
            <Tile
              label="Avg R (directional)"
              value={metrics?.avgRMultiple != null ? `${metrics.avgRMultiple.toFixed(2)}R` : '—'}
            />
            <Tile
              label="Evaluated directional"
              value={metrics ? String(metrics.evaluatedDirectionalCount) : '—'}
              sub={metrics ? `${metrics.inconclusiveCount} inconclusive · ${metrics.directional.ties} ties` : undefined}
            />
            <Tile
              label="Inconclusive"
              value={String(inconclusiveCount)}
            />
          {/* Baselines */}
            {metrics?.baselines && metrics.baselines.evaluated > 0 && (
              <div className="card">
                <div className="card-header">
                  <h3 className="text-md font-semibold text-white flex items-center gap-2">
                    <FlaskConical className="text-accent" size={18} />
                    Baseline comparison
                  </h3>
                </div>
                <div className="card-body space-y-3">
                  <p className="text-xs text-slate-500">
                    Naive rules evaluated on the same {metrics.baselines.evaluated} signal timestamps with the same horizon.
                    A strategy must beat these to demonstrate value.
                  </p>
                  <Bar
                    label="Confluence Zone + EM2 (strategy)"
                    value={metrics.baselines.strategy.accuracy}
                    correct={metrics.baselines.strategy.correct}
                    highlight
                  />
                  <Bar label="Prevailing 5-candle trend" value={metrics.baselines.prevTrend.accuracy} correct={metrics.baselines.prevTrend.correct} />
                  <Bar label="Always LONG" value={metrics.baselines.alwaysLong.accuracy} correct={metrics.baselines.alwaysLong.correct} />
                  <Bar label="Always SHORT" value={metrics.baselines.alwaysShort.accuracy} correct={metrics.baselines.alwaysShort.correct} />
                </div>
              </div>
            )}

            {/* Simulated trading performance */}
            {metrics?.simulatedTrading && (
              <div className="card">
                <div className="card-header">
                  <h3 className="text-md font-semibold text-white">Simulated trading performance</h3>
                </div>
                <div className="card-body">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Tile label="Trades" value={String(metrics.simulatedTrading.trades)} />
                    <Tile label="Win rate" value={metrics.simulatedTrading.winRate != null ? `${(metrics.simulatedTrading.winRate * 100).toFixed(1)}%` : '—'} />
                    <Tile label="Gross P&L" value={`${metrics.simulatedTrading.grossR >= 0 ? '+' : ''}${metrics.simulatedTrading.grossR.toFixed(2)}R`} valueClass={metrics.simulatedTrading.grossR >= 0 ? 'text-green-400' : 'text-red-400'} />
                    <Tile label="Max drawdown" value={`${metrics.simulatedTrading.maxDrawdownR.toFixed(2)}R`} />
                    <Tile label="Avg win" value={metrics.simulatedTrading.avgWinR != null ? `${metrics.simulatedTrading.avgWinR.toFixed(2)}R` : '—'} valueClass="text-green-400" />
                    <Tile label="Avg loss" value={metrics.simulatedTrading.avgLossR != null ? `${metrics.simulatedTrading.avgLossR.toFixed(2)}R` : '—'} valueClass="text-red-400" />
                    <Tile label="Profit factor" value={metrics.simulatedTrading.profitFactor != null ? metrics.simulatedTrading.profitFactor.toFixed(2) : '—'} />
                    <Tile label="Gross points" value={metrics.simulatedTrading.grossPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })} />
                  </div>
                  <p className="text-xs text-slate-500 mt-3">{metrics.simulatedTrading.costsNote}</p>
                </div>
              </div>
            )}
          </div>

          {/* Strategy diagnostics */}
          {diagnostics && (
            <div className="card">
              <div className="card-header">
                <h3 className="text-md font-semibold text-white flex items-center gap-2">
                  <Stethoscope className="text-accent" size={18} />
                  Strategy diagnostics — why signals were (or were not) generated
                </h3>
              </div>
              <div className="card-body space-y-4">
                {diagnostics.funnel.map((f: StrategyFunnel) => (
                  <div key={f.strategyId} className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2 text-xs">
                    <div className="col-span-2">
                      <div className="text-slate-400">Strategy</div>
                      <div className="text-white font-medium">{f.strategyId}</div>
                    </div>
                    <FunnelCell label="Candles examined" value={f.candlesExamined} />
                    <FunnelCell label="S/R zone passed" value={f.srZone.passed} />
                    <FunnelCell label="S/R zone failed" value={f.srZone.failed} />
                    <FunnelCell label="S/R zone skipped" value={f.srZone.skipped} />
                    <FunnelCell label="Fibonacci passed" value={f.fibonacci.passed} />
                    <FunnelCell label="Fibonacci failed" value={f.fibonacci.failed} />
                    <FunnelCell label="Fibonacci skipped" value={f.fibonacci.skipped} />
                    <FunnelCell label="Trendline passed" value={f.trendline.passed} />
                    <FunnelCell label="Trendline failed" value={f.trendline.failed} />
                    <FunnelCell label="Trendline skipped" value={f.trendline.skipped} />
                    <FunnelCell label="Min confluence passed" value={f.minConfluence.passed} />
                    <FunnelCell label="Min confluence failed" value={f.minConfluence.failed} />
                    <FunnelCell label="Min confluence skipped" value={f.minConfluence.skipped} />
                    <FunnelCell label="Rejection passed" value={f.rejection.passed} />
                    <FunnelCell label="Rejection failed" value={f.rejection.failed} />
                    <FunnelCell label="Rejection skipped" value={f.rejection.skipped} />
                    <FunnelCell label="Risk/reward passed" value={f.riskReward.passed} />
                    <FunnelCell label="Risk/reward failed" value={f.riskReward.failed} />
                    <FunnelCell label="Risk/reward skipped" value={f.riskReward.skipped} />
                    <FunnelCell label="Filtered (by trade filters)" value={f.signalsFiltered ?? 0} />
                    <FunnelCell label="Final signals" value={f.signalsGenerated} highlight />
                  </div>
                ))}
                  <div className="text-[11px] text-slate-500">
                    Counts come from per-candle decision traces. Each stage shows evaluated/passed/failed/skipped/unavailable.
                    A candle can pass several factor checks (confluence needs any 2 of 3), so factor counts do not form a strict funnel.
                    "Filtered" counts signals rejected by trade filters.
                  </div>
                <div className="border-t border-slate-800 pt-3 space-y-1">
                  {diagnostics.notes.map((n, i) => (
                    <div key={i} className="text-sm text-slate-300 flex items-start gap-2">
                      <span className="text-slate-600 mt-0.5">•</span>
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 3: Interactive Chart + Prediction Inspector */}
      {(candles.length > 0 || isRunning) && (
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 w-full">
            <ReplayChart
              candles={candles}
              predictions={predictions}
              timeframe={timeframe}
              warmupCandleCount={warmupCount}
              selectedPrediction={selectedPrediction}
              onSelectPrediction={p => setSelectedId(p.id)}
              isLive={status?.status === 'RUNNING' || status?.status === 'PAUSED'}
            />
          </div>
          {selectedPrediction && (
            <div className="w-full xl:w-[420px] shrink-0">
              <PredictionInspector
                prediction={selectedPrediction}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </div>
      )}

      {/* Empty-state explanation when a replay finished with no signals */}
      {status && (status.status === 'COMPLETED' || status.status === 'STOPPED') && candles.length > 0 && longCount + shortCount === 0 && (
        <div className="card">
          <div className="card-body p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-yellow-400 font-semibold text-sm">
              <AlertTriangle size={16} />
              This replay finished with zero directional predictions
            </div>
            {diagnostics && diagnostics.funnel.length > 0 && (
              <div className="text-sm text-slate-300 space-y-1">
                {diagnostics.funnel.map((f, fi) => {
                  const funnel = f as any;
                  const parts: string[] = [];
                  if (funnel.candlesExamined > 0) {
                    parts.push(`${funnel.candlesExamined} candles examined`);
                  }
                  // Find first failed stage with count
                  const stageOrder = ['srZone', 'fibonacci', 'trendline', 'minConfluence', 'rejection', 'riskReward'];
                  for (const stageKey of stageOrder) {
                    const stage = funnel[stageKey];
                    if (stage && stage.failed > 0) {
                      parts.push(`${stage.failed} failed ${stageKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`);
                      break;
                    } else if (stage && stage.skipped > 0 && stage.passed === 0 && stage.failed === 0) {
                      parts.push(`${stage.skipped} skipped ${stageKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase()} (not reached)`);
                      break;
                    }
                  }
                  if (funnel.signalsFiltered > 0) {
                    parts.push(`${funnel.signalsFiltered} candidates rejected by trade filters`);
                  }
                  return <div key={fi}><strong>{funnel.strategyId}:</strong> {parts.join('; ')}</div>;
                })}
              </div>
            )}
            {candidateSignals.length > 0 && (
              <div className="text-sm text-slate-300 space-y-1">
                <strong>Candidate signals generated:</strong> {candidateSignals.length}
                <div className="text-xs text-slate-400 ml-2">
                  Accepted: {candidateSignals.filter(c => c.status === 'ACCEPTED').length} | 
                  Filtered: {candidateSignals.filter(c => c.status === 'FILTERED').length} | 
                  Errors: {candidateSignals.filter(c => c.status === 'ERROR').length}
                </div>
                {candidateSignals.filter(c => c.status === 'FILTERED').length > 0 && (
                  <div className="text-xs text-yellow-400 ml-2">
                    Top filter rejections: {(() => {
                      const counts: Record<string, number> = {};
                      for (const c of candidateSignals.filter(c => c.status === 'FILTERED')) {
                        if (c.rejectionReason) counts[c.rejectionReason] = (counts[c.rejectionReason] || 0) + 1;
                      }
                      return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([r,c]) => `${r} (${c})`).join(', ');
                    })()}
                  </div>
                )}
              </div>
            )}
            {!diagnostics && candidateSignals.length === 0 && (
              <div className="text-sm text-slate-400">
                Check the strategy diagnostics below the summary: the most common cause is warm-up consuming the entire
                dataset (increase candle count) or strategy conditions that are rare in this data.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section: Filtered Signals Table */}
      {filteredSignals.length > 0 && (
        <div className="card">
          <div className="card-header flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Filter className="text-yellow-400" size={20} />
              Filtered Signals ({filteredSignals.length})
            </h3>
            <span className="text-sm text-slate-400">
              Signals generated by the pattern but rejected by trade filters
            </span>
          </div>
          <div className="card-body overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 text-left text-sm text-slate-400 sticky top-0 bg-bg-secondary z-10">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Direction</th>
                  <th className="pb-2 pr-4">Entry</th>
                  <th className="pb-2 pr-4">SL / Target</th>
                  <th className="pb-2 pr-4">R:R</th>
                  <th className="pb-2 pr-4">Confidence</th>
                  <th className="pb-2 pr-4">Rejected by filters</th>
                </tr>
              </thead>
              <tbody>
                {filteredSignals.map((fs, i) => (
                  <tr key={`${fs.strategyId}-${i}-${fs.timestamp}`} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {new Date(fs.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={fs.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                        {fs.direction === 'LONG' ? '▲ Bullish' : '▼ Bearish'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-white">{fs.entryPrice.toFixed(2)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      <span className="text-red-400">{fs.stopLoss != null ? fs.stopLoss.toFixed(2) : '—'}</span>
                      {' / '}
                      <span className="text-green-400">{fs.target != null ? fs.target.toFixed(2) : '—'}</span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {fs.stopLoss != null && fs.target != null && fs.entryPrice
                        ? (() => {
                            const risk = Math.abs(fs.entryPrice - fs.stopLoss);
                            const reward = Math.abs(fs.target - fs.entryPrice);
                            return risk > 0 ? `${(reward / risk).toFixed(2)}R` : '—';
                          })()
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {fs.confidence != null ? `${(fs.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-yellow-400">
                      {fs.failedFilters.join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section: Candidate Signals Table */}
      {candidateSignals.length > 0 && (
        <div className="card">
          <div className="card-header flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Target className="text-blue-400" size={20} />
              Candidate Signals ({candidateSignals.length})
            </h3>
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <select
                value={candidateStatusFilter}
                onChange={e => setCandidateStatusFilter(e.target.value as CandidateStatusFilter)}
                className="bg-bg-secondary border border-slate-700 rounded px-2 py-1 text-white text-xs"
              >
                <option value="ALL">All statuses</option>
                <option value="ACCEPTED">Accepted (Final Predictions)</option>
                <option value="FILTERED">Filtered by Trade Filters</option>
                <option value="PENDING_FILTERS">Pending Filters</option>
                <option value="ERROR">Error</option>
              </select>
              <span className="text-xs text-slate-500">
                {filteredCandidateSignals.length} of {candidateSignals.length} shown
              </span>
            </div>
          </div>
          <div className="card-body overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 text-left text-sm text-slate-400 sticky top-0 bg-bg-secondary z-10">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Strategy</th>
                  <th className="pb-2 pr-4">Direction</th>
                  <th className="pb-2 pr-4">Entry</th>
                  <th className="pb-2 pr-4">SL / Target</th>
                  <th className="pb-2 pr-4">R:R</th>
                  <th className="pb-2 pr-4">Confidence</th>
                  <th className="pb-2 pr-4">Confluence</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Rejection Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredCandidateSignals.map((cs, i) => (
                  <tr key={`${cs.strategyId}-${i}-${cs.timestamp}`} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {new Date(cs.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-300">{cs.strategyId}</td>
                    <td className="py-2 pr-4">
                      <span className={cs.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                        {cs.direction === 'LONG' ? '▲ Bullish' : '▼ Bearish'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-white">{cs.entryPrice.toFixed(2)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      <span className="text-red-400">{cs.stopLoss != null ? cs.stopLoss.toFixed(2) : '—'}</span>
                      {' / '}
                      <span className="text-green-400">{cs.target != null ? cs.target.toFixed(2) : '—'}</span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {cs.stopLoss != null && cs.target != null && cs.entryPrice
                        ? (() => {
                            const risk = Math.abs(cs.entryPrice - cs.stopLoss);
                            const reward = Math.abs(cs.target - cs.entryPrice);
                            return risk > 0 ? `${(reward / risk).toFixed(2)}R` : '—';
                          })()
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {cs.confidence != null ? `${(cs.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-300 max-w-[200px] truncate" title={cs.confluenceFactors.join(', ')}>
                      {cs.confluenceFactors.join(', ') || '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={
                        cs.status === 'ACCEPTED' ? 'px-2 py-1 text-xs font-medium rounded bg-green-500/20 text-green-400' :
                        cs.status === 'FILTERED' ? 'px-2 py-1 text-xs font-medium rounded bg-yellow-500/20 text-yellow-400' :
                        cs.status === 'PENDING_FILTERS' ? 'px-2 py-1 text-xs font-medium rounded bg-blue-500/20 text-blue-400' :
                        'px-2 py-1 text-xs font-medium rounded bg-red-500/20 text-red-400'
                      }>
                        {cs.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-400 max-w-[300px] truncate" title={cs.rejectionReason || ''}>
                      {cs.rejectionReason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section: Decision Trace Explorer */}
      {decisionTraces.length > 0 && (
        <div className="card">
          <div className="card-header flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Stethoscope className="text-accent" size={20} />
              Decision Trace Explorer ({decisionTraces.length} traces)
            </h3>
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <select
                value={traceOutcomeFilter}
                onChange={e => setTraceOutcomeFilter(e.target.value as TraceOutcomeFilter)}
                className="bg-bg-secondary border border-slate-700 rounded px-2 py-1 text-white text-xs"
              >
                <option value="ALL">All outcomes</option>
                <option value="SIGNAL">Signal</option>
                <option value="NO_SIGNAL">No Signal</option>
                <option value="FILTERED">Filtered</option>
                <option value="ERROR">Error</option>
              </select>
              <span className="text-xs text-slate-500">
                {filteredDecisionTraces.length} of {decisionTraces.length} shown
              </span>
            </div>
          </div>
          <div className="card-body overflow-x-auto max-h-[600px] overflow-y-auto">
            <div className="space-y-3">
              {filteredDecisionTraces.map((trace, i) => (
                <TraceDetailCard key={`${trace.strategyId}-${trace.candleIndex}-${i}`} trace={trace} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Section 4: Prediction Explorer */}
      {predictions.length > 0 && (
        <div className="card">
          <div className="card-header flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Target className="text-accent" size={20} />
              Prediction Explorer
            </h3>
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <select
                value={dirFilter}
                onChange={e => setDirFilter(e.target.value as DirFilter)}
                className="bg-bg-secondary border border-slate-700 rounded px-2 py-1 text-white text-xs"
              >
                <option value="ALL">All directions</option>
                <option value="LONG">Bullish only</option>
                <option value="SHORT">Bearish only</option>
                <option value="NO_TRADE">NO_TRADE only</option>
              </select>
              <select
                value={outcomeFilter}
                onChange={e => setOutcomeFilter(e.target.value as OutcomeFilter)}
                className="bg-bg-secondary border border-slate-700 rounded px-2 py-1 text-white text-xs"
              >
                <option value="ALL">All outcomes</option>
                <option value="CORRECT">Correct</option>
                <option value="INCORRECT">Incorrect</option>
                <option value="TIE">Tie</option>
                <option value="INCONCLUSIVE">Inconclusive</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNoTrade}
                  onChange={e => setShowNoTrade(e.target.checked)}
                  className="w-3.5 h-3.5 bg-slate-800 border-slate-700 rounded"
                />
                Show NO_TRADE
              </label>
              <span className="text-xs text-slate-500">
                {filteredPredictions.length} of {predictions.length} shown
              </span>
            </div>
          </div>
          <div className="card-body overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 text-left text-sm text-slate-400 sticky top-0 bg-bg-secondary z-10">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Direction</th>
                  <th className="pb-2 pr-4">Signal price</th>
                  <th className="pb-2 pr-4">SL / Target</th>
                  <th className="pb-2 pr-4">Outcome</th>
                  <th className="pb-2 pr-4">Price change</th>
                  <th className="pb-2 pr-4">R</th>
                  <th className="pb-2 pr-4">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredPredictions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <Target className="text-slate-500" size={32} />
                        <p className="text-sm">
                          {filteredPredictions.length === 0 && predictions.length > 0
                            ? 'No predictions match the current filters.'
                            : 'No predictions available.'}
                        </p>
                        {predictions.length > 0 && (
                          <p className="text-xs text-slate-500">
                            Try adjusting filters: Direction={dirFilter}, Outcome={outcomeFilter}, Show NO_TRADE={showNoTrade ? 'on' : 'off'}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  (filteredPredictions.map(pred => {
                  const dirOutcome = pred.evaluation?.directional.outcome;
                  const stOutcome = pred.evaluation?.stopTarget.outcome;
                  const change = pred.evaluation?.directional.priceChange;
                  const r = pred.evaluation?.stopTarget.rMultiple;
                  return (
                    <tr
                      key={pred.id}
                      onClick={() => setSelectedId(pred.id)}
                      className={`border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/40 transition-colors ${selectedId === pred.id ? 'bg-slate-800/60' : ''}`}
                    >
                      <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                        {new Date(pred.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={pred.direction === 'LONG' ? 'text-green-400' : pred.direction === 'SHORT' ? 'text-red-400' : 'text-slate-500'}>
                          {pred.direction === 'LONG' ? '▲ Bullish' : pred.direction === 'SHORT' ? '▼ Bearish' : '— no trade'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-white">{pred.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        <span className="text-red-400">{pred.stopLoss != null ? pred.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span>
                        {' / '}
                        <span className="text-green-400">{pred.target != null ? pred.target.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span>
                      </td>
                      <td className="py-2 pr-4">
                        {pred.evaluation ? (
                          <span className={
                            dirOutcome === 'CORRECT' ? 'text-green-400' :
                            dirOutcome === 'INCORRECT' ? 'text-red-400' :
                            'text-slate-400'
                          }>
                            {dirOutcome === 'CORRECT' ? '✓ Correct' : dirOutcome === 'INCORRECT' ? '✗ Incorrect' : 'Tie'}
                            {stOutcome && stOutcome !== 'NEITHER' && (
                              <span className="text-slate-500 text-xs"> · {stOutcome.replace(/_/g, ' ').toLowerCase()}</span>
                            )}
                          </span>
                        ) : (
                          <span className={pred.evaluationStatus === 'INCONCLUSIVE' ? 'text-yellow-400' : 'text-slate-500'}>
                            {pred.evaluationStatus === 'INCONCLUSIVE' ? 'Inconclusive' : 'Pending'}
                          </span>
                        )}
                      </td>
                      <td className={`py-2 pr-4 font-mono text-xs ${change === undefined ? 'text-slate-500' : change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {change !== undefined ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                        {r !== undefined ? `${r.toFixed(2)}R` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-400 max-w-[260px] truncate" title={reasonFor(pred)}>
                        {reasonFor(pred)}
                      </td>
                    </tr>
                  );
                })
              )
              )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detailed breakdown */}
      {metrics && (
        <div className="card">
          <div className="card-header flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Detailed breakdown</h3>
            <span className="text-sm text-slate-400">
              {metrics.evaluatedDirectionalCount} evaluated / {metrics.totalPredictions} total
            </span>
          </div>
          <div className="card-body space-y-4">
            {/* By Strategy */}
            {metrics.byStrategy && Object.keys(metrics.byStrategy).length > 0 && (
              <div>
                <div className="text-slate-400 text-sm mb-2">By Strategy</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-left text-slate-400">
                      <th className="pb-2 pr-4">Strategy</th>
                      <th className="pb-2 pr-4">Total</th>
                      <th className="pb-2 pr-4">Evaluated</th>
                      <th className="pb-2 pr-4">Accuracy</th>
                      <th className="pb-2 pr-4">Outcomes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(metrics.byStrategy).map(([id, s]) => (
                      <tr key={id} className="border-b border-slate-800/50">
                        <td className="py-2 pr-4 text-white">{id}</td>
                        <td className="py-2 pr-4 text-slate-300">{s.total}</td>
                        <td className="py-2 pr-4 text-slate-300">{s.evaluated}</td>
                        <td className="py-2 pr-4 text-white">{(s.directionalAccuracy * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-4 text-xs text-slate-400">
                          {Object.entries(s.stopTargetOutcomes).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* By Direction */}
            {metrics.byDirection && (
              <div className="border-t border-slate-800 pt-3">
                <div className="text-slate-400 text-sm mb-2">By Direction</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-left text-slate-400">
                      <th className="pb-2 pr-4">Direction</th>
                      <th className="pb-2 pr-4">Total</th>
                      <th className="pb-2 pr-4">Evaluated</th>
                      <th className="pb-2 pr-4">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(metrics.byDirection).map(([dir, d]) => (
                      <tr key={dir} className="border-b border-slate-800/50">
                        <td className="py-2 pr-4">
                          <span className={dir === 'LONG' ? 'text-green-400' : dir === 'SHORT' ? 'text-red-400' : 'text-slate-400'}>
                            {dir === 'LONG' ? '▲ LONG' : dir === 'SHORT' ? '▼ SHORT' : 'NO TRADE'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-slate-300">{d.total}</td>
                        <td className="py-2 pr-4 text-slate-300">{d.evaluated}</td>
                        <td className="py-2 pr-4 text-white">{(d.directionalAccuracy * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
</tbody>
                </table>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="p-3 bg-bg-secondary rounded-lg">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-bold ${valueClass || 'text-white'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function MetricCard({ label, value, sub, valueClass, icon }: { label: string; value: string; sub?: string; valueClass?: string; icon?: React.ReactNode }) {
  return (
    <div className="p-4 bg-bg-secondary rounded-lg border border-slate-700/50">
      <div className="flex items-start gap-2">
        {icon && <span className="text-slate-500 shrink-0 mt-0.5">{icon}</span>}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          <div className={`text-2xl font-bold ${valueClass || 'text-white'}`}>{value}</div>
          {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function FunnelCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-2 rounded ${highlight ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-slate-800/50'}`}>
      <div className="text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-blue-300' : 'text-slate-200'}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function Bar({ label, value, correct, highlight }: { label: string; value: number; correct: number; highlight?: boolean }) {
  const pct = (value * 100).toFixed(1);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className={highlight ? 'text-slate-200 font-semibold' : 'text-slate-400'}>{label}</span>
        <span className="text-slate-300 font-mono">{pct}% <span className="text-slate-500">({correct} correct)</span></span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-2 rounded-full ${highlight ? 'bg-blue-500' : 'bg-slate-600'}`}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Human-readable reason derived from the recorded evidence (never invented) */
function reasonFor(pred: Prediction): string {
  if (pred.direction === 'NO_TRADE') {
    const fail = pred.trace?.stages.find(
      s => s.result === 'FAIL' && ['market_context', 'data_sufficient', 'min_confluence', 'rejection_candle', 'risk_reward'].includes(s.id)
    );
    if (fail) return `No trade — ${fail.label} failed`;
    return 'No trade — conditions not met';
  }
  return pred.confluenceFactors.length > 0 ? pred.confluenceFactors.join(', ') : '—';
}

interface TraceDetailCardProps {
  trace: DecisionTrace;
}

function TraceDetailCard({ trace }: TraceDetailCardProps) {
  const outcomeColors: Record<string, string> = {
    SIGNAL: 'text-blue-400',
    NO_SIGNAL: 'text-slate-400',
    FILTERED: 'text-yellow-400',
    ERROR: 'text-red-400',
  };
  const outcomeLabels: Record<string, string> = {
    SIGNAL: 'Signal Generated',
    NO_SIGNAL: 'No Signal',
    FILTERED: 'Filtered by Trade Filters',
    ERROR: 'Error',
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="px-2 py-1 text-xs font-mono bg-slate-700 rounded">
            {new Date(trace.timestamp).toLocaleString()}
          </span>
          <span className={`px-2 py-1 text-xs font-medium rounded ${outcomeColors[trace.outcome] || 'text-slate-400'}`}>
            {outcomeLabels[trace.outcome] || trace.outcome}
          </span>
          {trace.direction && (
            <span className={`px-2 py-1 text-xs font-medium rounded ${trace.direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {trace.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Candle Index: {trace.candleIndex}</span>
          <span>Strategy: {trace.strategyId} v{trace.strategyVersion}</span>
        </div>
      </div>

      {trace.outcome === 'SIGNAL' || trace.outcome === 'FILTERED' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="p-2 bg-slate-700/50 rounded">
            <div className="text-slate-400">Entry</div>
            <div className="font-mono text-white">{trace.entryPrice?.toFixed(2) ?? '—'}</div>
          </div>
          <div className="p-2 bg-slate-700/50 rounded">
            <div className="text-slate-400">Stop Loss</div>
            <div className="font-mono text-red-400">{trace.stopLoss?.toFixed(2) ?? '—'}</div>
          </div>
          <div className="p-2 bg-slate-700/50 rounded">
            <div className="text-slate-400">Target</div>
            <div className="font-mono text-green-400">{trace.target?.toFixed(2) ?? '—'}</div>
          </div>
          <div className="p-2 bg-slate-700/50 rounded">
            <div className="text-slate-400">R:R</div>
            <div className="font-mono text-slate-300">
              {trace.entryPrice != null && trace.stopLoss != null && trace.target != null
                ? (() => {
                    const risk = Math.abs(trace.entryPrice - trace.stopLoss);
                    const reward = Math.abs(trace.target - trace.entryPrice);
                    return risk > 0 ? `${(reward / risk).toFixed(2)}R` : '—';
                  })()
                : '—'}
            </div>
          </div>
        </div>
      ) : null}

      {trace.failedFilters && trace.failedFilters.length > 0 && (
        <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs">
          <div className="text-yellow-400 font-medium">Rejected by filters:</div>
          <div className="text-slate-300">{trace.failedFilters.join(', ')}</div>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs text-slate-400 font-medium">Stage Results:</div>
        {trace.stages.map((stage, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
              stage.result === 'PASS' ? 'bg-green-500/20 text-green-400' :
              stage.result === 'FAIL' ? 'bg-red-500/20 text-red-400' :
              stage.result === 'SKIPPED' ? 'bg-slate-500/20 text-slate-400' :
              'bg-amber-500/20 text-amber-400'
            }`}>
              {stage.result}
            </span>
            <span className="text-slate-300 flex-1 truncate">{stage.label}</span>
            {stage.detail && <span className="text-slate-500 truncate max-w-[300px]">{stage.detail}</span>}
          </div>
        ))}
      </div>

      {trace.conditions.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-slate-700/50">
          <div className="text-xs text-slate-400 font-medium">Condition Evaluations:</div>
          {trace.conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                cond.passed === true ? 'bg-green-500/20 text-green-400' :
                cond.passed === false ? 'bg-red-500/20 text-red-400' :
                'bg-slate-500/20 text-slate-400'
              }`}>
                {cond.passed === true ? 'PASS' : cond.passed === false ? 'FAIL' : 'N/A'}
              </span>
              <span className="text-slate-300 flex-1 truncate">{cond.label}</span>
              {cond.detail && <span className="text-slate-500 truncate max-w-[300px]">{cond.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
