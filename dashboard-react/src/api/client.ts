const API_BASE = 'http://localhost:3001/api';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function postApi<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  return fetchApi<T>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putApi<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  return fetchApi<T>(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  // Generic GET
  get: <T,>(url: string) => fetchApi<T>(url),

  // Trades
  getTrades: (params?: { state?: string; limit?: number }) => 
    fetchApi<{ trades: any[]; total: number }>(`/trades?${new URLSearchParams(params as any)}`),
  
  getTrade: (id: string) => 
    fetchApi<any>(`/trades/${id}`),
  
  getTradesByState: (state: string) => 
    fetchApi<{ trades: any[]; count: number }>(`/trades/state/${state}`),
  
  // Stats
  getStats: () => 
    fetchApi<any>('/stats'),
  
  getEquity: () => 
    fetchApi<{ equity: any[] }>('/stats/equity'),
  
  getDailyStats: () => 
    fetchApi<{ daily: Record<string, { pnl: number; trades: number }> }>('/stats/daily'),
  
  getStatsByPattern: () => 
    fetchApi<{ patterns: Record<string, any> }>('/stats/by-pattern'),
  
  // Patterns
  getPatterns: () => 
    fetchApi<{ patterns: any[] }>('/patterns'),
  
  getPattern: (id: string) => 
    fetchApi<any>(`/patterns/${id}`),

  // LLM Analysis
  llm: {
    checkHealth: () =>
      fetchApi<{ provider: string; available: boolean; model: string; latencyMs?: number; error?: string }>('/llm/health'),

    getConfig: () =>
      fetchApi<{ activeProvider: string; config: any; availableTypes: string[] }>('/llm/config'),

    updateConfig: (body: Record<string, any>) =>
      putApi<{ activeProvider: string; config: any }>('/llm/config', body),

    analyze: (type: string, customPrompt?: string) =>
      postApi<any>('/llm/analyze', { type, ...(customPrompt && { customPrompt }) }),

    getHistory: (limit = 10) =>
      fetchApi<{ analyses: any[]; total: number }>(`/llm/history?limit=${limit}`),

    clearHistory: () =>
      fetchApi<{ message: string }>('/llm/history', { method: 'DELETE' }),
  },

  // Paper Trading - Manual Trade CRUD
  createTrade: (body: {
    symbol: string;
    direction: string;
    entryPrice: number;
    stopLoss: number;
    target: number;
    quantity: number;
    timeframe: string;
    patternName?: string;
    notes?: string;
  }) => postApi<{ trade: any }>('/trades', body),

  closeTrade: (id: string, exitPrice: number) =>
    putApi<{ trade: any }>(`/trades/${id}/close`, { exitPrice }),

  deleteTrade: (id: string) =>
    fetchApi<{ message: string }>(`/trades/${id}`, { method: 'DELETE' }),

  // Simulation
  simulation: {
    getDataFiles: () =>
      fetchApi<{ files: { name: string; path: string; size: number; modified: string }[] }>('/simulation/data-files'),

    run: (body: {
      filePath: string;
      symbol: string;
      timeframe: string;
      startDate?: string;  // ISO 8601
      endDate?: string;    // ISO 8601
      filters?: boolean;
      looseFilters?: boolean;
    }) => postApi<any>('/simulation/run', body),

    getStatus: () =>
      fetchApi<{ runs: any[] }>('/simulation/status'),

    getStatusById: (id: string) =>
      fetchApi<any>(`/simulation/status/${id}`),
  },

  // Live Scanner
  liveScanner: {
    getStatus: () =>
      fetchApi<{ 
        isActive: boolean; 
        config: {
          symbols: string[];
          timeframes: string[];
          scanIntervalMs: number;
          enablePaperTrading: boolean;
        };
        activeSignals: number;
        lastResults: number;
      }>('/live-scanner/status'),

    start: (body: {
      symbols?: string[];
      timeframes?: string[];
      scanIntervalMs?: number;
      enablePaperTrading?: boolean;
    }) => postApi<{ success: boolean; message: string; status: any }>('/live-scanner/start', body),

    stop: () =>
      postApi<{ success: boolean; message: string }>('/live-scanner/stop', {}),

    configure: (body: {
      symbols?: string[];
      timeframes?: string[];
      scanIntervalMs?: number;
      enablePaperTrading?: boolean;
    }) => postApi<{ success: boolean; config: any }>('/live-scanner/configure', body),

    getSignals: () =>
      fetchApi<{ signals: any[]; count: number }>('/live-scanner/signals'),

    getResults: () =>
      fetchApi<{ results: any[]; count: number }>('/live-scanner/results'),

    getResult: (symbol: string, timeframe: string) =>
      fetchApi<any>(`/live-scanner/result/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`),

    getPaperTrades: () =>
      fetchApi<{ trades: any[]; message?: string }>('/live-scanner/paper-trades'),

    getMarketDataStatus: () =>
      fetchApi<{
        isActive: boolean;
        subscribedSymbols: string[];
        subscribedTimeframes: string[];
      }>('/live-scanner/market-data/status'),

    getQuote: (symbol: string) =>
      fetchApi<any>(`/live-scanner/market-data/quote/${encodeURIComponent(symbol)}`),

    getHistorical: (symbol: string, _timeframe: string, days?: number) => {
      const params = new URLSearchParams();
      if (days) params.set('days', String(days));
      return fetchApi<{ symbol: string; timeframe: string; candles: any[]; count: number }>(
        `/live-scanner/market-data/historical/${encodeURIComponent(symbol)}?${params}`
      );
    },
  },

  // Historical Replay
  replay: {
    getDataFiles: () =>
      fetchApi<{ files: { name: string; path: string; size: number; modified: string }[]; count: number }>('/replay/data-files'),

    start: (body: {
      dataSource?: 'csv' | 'api';
      filePath?: string;
      symbol: string;
      timeframe: string;
      strategyIds: string[];
      startDate?: string;
      endDate?: string;
      candleCount?: number;
      speed?: number;
      evaluationHorizon?: { candles: number };
      filtersEnabled?: boolean;
      looseFilters?: boolean;
      strategyConfig?: Record<string, Record<string, any>>;
    }) => postApi<{ id: string; message: string; status: any }>('/replay/start', body),

    // NIFTY historical data download
    downloadNifty: (body: {
      timeframe: string;
      fromDate: string;
      toDate: string;
      cacheConfig?: { enabled: boolean; cacheDir: string; maxAgeDays: number };
    }) => postApi<{ success: boolean; data: any }>('/replay/nifty/download', body),

    getNiftyCacheStats: () =>
      fetchApi<{ success: boolean; stats: any }>('/replay/nifty/cache/stats'),

    clearNiftyCache: (params?: { instrumentKey?: string; timeframe?: string }) =>
      postApi<{ success: boolean; cleared: number }>('/replay/nifty/cache', params ?? {}),

    getNiftyInstrumentKeys: () =>
      fetchApi<{ success: boolean; instruments: any }>('/replay/nifty/instrument-keys'),

    pause: (id: string) =>
      postApi<{ id: string; status: any }>(`/replay/${id}/pause`, {}),

    resume: (id: string) =>
      postApi<{ id: string; status: any }>(`/replay/${id}/resume`, {}),

    stop: (id: string) =>
      postApi<{ id: string; result: any; status: any }>(`/replay/${id}/stop`, {}),

    getStatus: (id: string) =>
      fetchApi<{ id: string; status: any }>(`/replay/${id}/status`),

    getPredictions: (id: string, strategyId?: string) =>
      fetchApi<{ id: string; predictions: any[]; count: number; total: number; strategies: string[] }>(`/replay/${id}/predictions${strategyId ? `?strategyId=${strategyId}` : ''}`),

    getEvaluations: (id: string, strategyId?: string) =>
      fetchApi<{ id: string; evaluations: any[]; count: number; total: number; strategies: string[] }>(`/replay/${id}/evaluations${strategyId ? `?strategyId=${strategyId}` : ''}`),

    getMetrics: (id: string, strategyId?: string) =>
      fetchApi<{ id: string; metrics: any }>(`/replay/${id}/metrics${strategyId ? `?strategyId=${strategyId}` : ''}`),

    getDiagnostics: (id: string, strategyId?: string) =>
      fetchApi<{ id: string; diagnostics: any[]; filteredSignalsSummary?: any; strategies: string[] }>(`/replay/${id}/diagnostics${strategyId ? `?strategyId=${strategyId}` : ''}`),

    getFilteredSignals: (id: string, strategyId?: string) =>
      fetchApi<{ id: string; filteredSignals: any[] }>(`/replay/${id}/filtered-signals${strategyId ? `?strategyId=${strategyId}` : ''}`),

    getCandidateSignals: (id: string, strategyId?: string, status?: string) =>
      fetchApi<{ id: string; candidateSignals: any[]; count: number; total: number; strategies: string[] }>(`/replay/${id}/candidate-signals${strategyId || status ? `?${[strategyId && `strategyId=${strategyId}`, status && `status=${status}`].filter(Boolean).join('&')}` : ''}`),

    getDecisionTraces: (id: string, strategyId?: string, outcome?: string) =>
      fetchApi<{ id: string; decisionTraces: any[]; count: number; total: number; strategies: string[] }>(`/replay/${id}/decision-traces${strategyId || outcome ? `?${[strategyId && `strategyId=${strategyId}`, outcome && `outcome=${outcome}`].filter(Boolean).join('&')}` : ''}`),

    getCandles: (id: string) =>
      fetchApi<{ id: string; candles: any[]; count: number; total: number }>(`/replay/${id}/candles`),

    getResult: (id: string) =>
      fetchApi<any>(`/replay/${id}/result`),

    del: (id: string) =>
      fetchApi<{ id: string; status: string }>(`/replay/${id}`, { method: 'DELETE' }),

    list: () =>
      fetchApi<{ replays: any[]; count: number }>('/replay/list'),
  },

  // Instruments / Symbol lookup
  instruments: {
    search: (query: string) =>
      fetchApi<{ symbols: any[]; total: number }>(`/instruments/search?q=${encodeURIComponent(query)}`),

    getDetails: (symbol: string, spotPrice?: number) =>
      fetchApi<any>(`/instruments/${encodeURIComponent(symbol)}/details${spotPrice ? `?spotPrice=${spotPrice}` : ''}`),

    getOptions: (symbol: string, spotPrice?: number, strikes?: number, volatility?: number) => {
      const params = new URLSearchParams();
      if (spotPrice) params.set('spotPrice', String(spotPrice));
      if (strikes) params.set('strikes', String(strikes));
      if (volatility) params.set('volatility', String(volatility));
      return fetchApi<any>(`/instruments/${encodeURIComponent(symbol)}/options?${params}`);
    },

    getQuote: (symbol: string) =>
      fetchApi<any>(`/instruments/${encodeURIComponent(symbol)}/quote`),

    getAll: () =>
      fetchApi<{ symbols: any[]; total: number }>('/instruments'),
  },
};

