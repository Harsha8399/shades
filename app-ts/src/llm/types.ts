/**
 * LLM Integration Types
 * 
 * Types for AI-powered trading analysis.
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = 'ollama' | 'deepseek' | 'openai' | 'openrouter';

/**
 * LLM provider configuration
 */
export interface LLMProviderConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * Default provider configs
 */
export const DEFAULT_OLLAMA_CONFIG: LLMProviderConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'mistral',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 120_000,
};

export const DEFAULT_DEEPSEEK_CONFIG: LLMProviderConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 60_000,
};

export const DEFAULT_OPENAI_CONFIG: LLMProviderConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 60_000,
};

export const DEFAULT_OPENROUTER_CONFIG: LLMProviderConfig = {
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 60_000,
};

/**
 * Analysis request types
 */
export type AnalysisType = 
  | 'performance_review'     // Overall performance analysis
  | 'pattern_analysis'       // Analyze specific pattern effectiveness
  | 'risk_assessment'        // Risk and drawdown analysis
  | 'strategy_suggestion'    // Suggest strategy improvements
  | 'trade_review'           // Review specific trades
  | 'market_context';        // Market regime & structure analysis

/**
 * Analysis request
 */
export interface AnalysisRequest {
  type: AnalysisType;
  context: AnalysisContext;
  customPrompt?: string;
}

/**
 * Trading context fed to the LLM
 */
export interface AnalysisContext {
  // Performance metrics
  stats?: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    avgRMultiple: number;
    maxDrawdown: number;
    totalPnl: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    longestWinStreak?: number;
    longestLossStreak?: number;
  };
  
  // Per-pattern breakdown
  patternStats?: Record<string, {
    trades: number;
    winRate: number;
    profitFactor: number;
    avgRMultiple: number;
    totalPnl: number;
  }>;
  
  // Recent trades for detailed review
  recentTrades?: Array<{
    patternName: string;
    symbol: string;
    direction: string;
    state: string;
    entryPrice?: number | null;
    exitPrice?: number | null;
    pnl?: number | null;
    rMultiple?: number | null;
    confluenceFactors: string[];
    notes: string[];
  }>;
  
  // Daily P&L for trend analysis
  dailyPnl?: Record<string, { pnl: number; trades: number }>;
  
  // Equity curve data
  equityCurve?: Array<{ equity: number; drawdown: number }>;
  
  // Active configuration
  config?: {
    riskPerTrade: number;
    maxOpenTrades: number;
    minRiskReward: number;
    enabledPatterns: string[];
    activeFilters: string[];
  };
}

/**
 * Analysis response from the LLM
 */
export interface AnalysisResponse {
  id: string;
  type: AnalysisType;
  provider: LLMProvider;
  model: string;
  
  // Structured sections
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  riskWarnings: string[];
  
  // Full raw response
  rawResponse: string;
  
  // Metadata
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  timestamp: Date;
}

/**
 * LLM health status
 */
export interface LLMHealthStatus {
  provider: LLMProvider;
  available: boolean;
  model: string;
  latencyMs?: number;
  error?: string;
}
