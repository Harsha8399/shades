/**
 * Shared types for the Replay page (mirror of app-ts/src/types/prediction.ts
 * and app-ts/src/types/decision.ts payloads returned by the API).
 */

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ConditionEvaluation {
  id: string;
  label: string;
  evaluated: boolean;
  passed: boolean | null;
  detail?: string;
  values?: Record<string, number | string | boolean | null>;
}

export interface DecisionStage {
  id: string;
  label: string;
  result: 'PASS' | 'FAIL' | 'SKIPPED' | 'UNAVAILABLE';
  detail?: string;
  values?: Record<string, number | string | boolean | null>;
}

export interface DecisionTrace {
  strategyId: string;
  strategyVersion: string;
  candleIndex: number;
  timestamp: number;
  symbol: string;
  timeframe: string;
  outcome: 'SIGNAL' | 'NO_SIGNAL' | 'ERROR' | 'FILTERED';
  direction?: 'LONG' | 'SHORT';
  stages: DecisionStage[];
  conditions: ConditionEvaluation[];
  error?: string;
  /** Signal price levels (present when the pattern produced a signal) */
  entryPrice?: number;
  stopLoss?: number;
  target?: number;
  /** Names of trade filters that rejected the signal (FILTERED traces only) */
  failedFilters?: string[];
}

export interface FilteredSignal {
  strategyId: string;
  timestamp: number;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss?: number;
  target?: number;
  confidence?: number;
  failedFilters: string[];
}

export interface CandidateSignal {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: string;
  strategyId: string;
  strategyName: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss?: number;
  target?: number;
  confidence: number;
  confluenceFactors: string[];
  invalidationPrice?: number;
  riskRewardRatio?: number;
  candleIndex: number;
  trace?: DecisionTrace;
  snapshot?: PredictionSnapshot;
  filterResult?: {
    passed: boolean;
    failedFilters: string[];
    results: Array<{ filter: string; pass: boolean; reason: string; confidence: number }>;
    totalConfidenceAdjustment: number;
  };
  status: 'PENDING_FILTERS' | 'FILTERED' | 'ACCEPTED' | 'ERROR';
  rejectionReason?: string;
}

export interface PredictionSnapshot {
  strategyVersion: string;
  candleIndex: number;
  warmupComplete: boolean;
  candlesAvailable: number;
  marketContext: {
    atr: number | null;
    trend: string | null;
    volatility: string | null;
  };
  zone: { type: string; priceLevel: number; touches: number; tolerance: number } | null;
  fib: { ratio: number; priceLevel: number; direction: string } | null;
  trendline: { type: string; priceLevel: number } | null;
  rejection: {
    body: number;
    upperWick: number;
    lowerWick: number;
    wickRatio: number;
    minWickRatio: number;
    wickTouchesZone: boolean;
    closeBeyondZone: boolean;
    candleTypeOk: boolean;
  } | null;
  levels: {
    entryPrice: number;
    stopLoss: number | null;
    target: number | null;
    riskReward: number | null;
    minRiskReward: number;
  };
  conditions: ConditionEvaluation[];
  passedConditions: string[];
  failedConditions: string[];
}

export interface Prediction {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: string;
  strategyId: string;
  strategyName: string;
  direction: 'LONG' | 'SHORT' | 'NO_TRADE';
  entryPrice: number;
  stopLoss?: number;
  target?: number;
  confidence: number;
  confluenceFactors: string[];
  candleIndex: number;
  evaluationHorizon: { candles: number };
  evaluationStatus: 'PENDING' | 'EVALUATING' | 'COMPLETED' | 'INCONCLUSIVE';
  isEarlyStop?: boolean;
  snapshot?: PredictionSnapshot;
  trace?: DecisionTrace;
  evaluation?: {
    directional: {
      referencePrice: number;
      horizonPrice: number;
      priceChange: number;
      priceChangePercent: number;
      outcome: 'CORRECT' | 'INCORRECT' | 'TIE';
      isDirectionallyCorrect: boolean;
      candlesEvaluated: number;
      maxFavourablePoints?: number;
      maxAdversePoints?: number;
    };
    stopTarget: {
      stopHitFirst: boolean;
      targetHitFirst: boolean;
      ambiguous: boolean;
      neitherHit: boolean;
      hitCandleIndex?: number;
      hitPrice?: number;
      rMultiple?: number;
      outcome: 'TARGET_FIRST' | 'STOP_FIRST' | 'AMBIGUOUS' | 'NEITHER' | 'INCONCLUSIVE';
    };
    status: 'COMPLETED' | 'INCONCLUSIVE' | 'AMBIGUOUS';
  };
}

export interface ReplayStatus {
  id: string;
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
  currentIndex: number;
  totalCandles: number;
  predictionsGenerated: number;
  predictionsEvaluated: number;
  warmupCandles?: number;
  candlesExamined?: number;
  currentCandleTime?: number;
  error?: string;
}

export interface Metrics {
  totalPredictions: number;
  evaluatedCount: number;
  evaluatedDirectionalCount: number;
  noTradeCount: number;
  abstentionRate: number;
  pendingCount: number;
  inconclusiveCount: number;
  ambiguousCount: number;
  directional: {
    correct: number;
    incorrect: number;
    ties: number;
    accuracy: number;
    accuracyDenominator: string;
    /** Wilson 95% confidence interval [lower, upper] */
    ci?: [number, number];
  };
  stopTarget: {
    targetFirst: number;
    stopFirst: number;
    ambiguous: number;
    neither: number;
    inconclusive: number;
  };
  avgRMultiple?: number | null;
  byStrategy?: Record<string, { total: number; evaluated: number; directionalAccuracy: number; stopTargetOutcomes: Record<string, number>; noTradeCount: number }>;
  byTimeframe?: Record<string, { total: number; evaluated: number; directionalAccuracy: number; noTradeCount: number }>;
  byDirection?: Record<'LONG' | 'SHORT' | 'NO_TRADE', { total: number; evaluated: number; directionalAccuracy: number }>;
  sampleSize?: {
    evaluatedDirectional: number;
    warnings: string[];
  };
  baselines?: {
    evaluated: number;
    strategy: { correct: number; accuracy: number; ci: [number, number] };
    prevTrend: { correct: number; accuracy: number; ci: [number, number] };
    alwaysLong: { correct: number; accuracy: number; ci: [number, number] };
    alwaysShort: { correct: number; accuracy: number; ci: [number, number] };
    alwaysLongAll?: { correct: number; accuracy: number; ci: [number, number] };
    alwaysShortAll?: { correct: number; accuracy: number; ci: [number, number] };
  };
  simulatedTrading?: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    grossPoints: number;
    grossR: number;
    avgWinR: number | null;
    avgLossR: number | null;
    profitFactor: number | null;
    maxDrawdownR: number;
    costsNote: string;
  };
}

export interface StageCounters {
  evaluated: number;
  passed: number;
  failed: number;
  skipped: number;
  unavailable: number;
}

export interface StrategyFunnel {
  strategyId: string;
  candlesExamined: number;
  errors: number;
  srZone: StageCounters;
  fibonacci: StageCounters;
  trendline: StageCounters;
  minConfluence: StageCounters;
  rejection: StageCounters;
  riskReward: StageCounters;
  signalsGenerated: number;
  signalsFiltered: number;
  firstFailure: Record<string, number>;
}

export interface Diagnostics {
  minRequiredCandles: number;
  warmupCandles: number;
  candlesExamined: number;
  requestedCandleCount: number | null;
  dataStart: number | null;
  dataEnd: number | null;
  funnel: StrategyFunnel[];
  notes: string[];
  evaluationRule: string;
}

export interface DiagnosticsResponse {
  diagnostics: Array<{ strategyId: string; diagnostics: Diagnostics }>;
  filteredSignalsSummary: {
    total: number;
    byFilter: Record<string, number>;
  };
  strategies: string[];
}