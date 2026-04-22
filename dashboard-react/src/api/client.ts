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
};

