import { Direction, Timeframe } from './candle';
import { DecisionTrace, PredictionSnapshot } from './decision';
import { Signal } from './signal';

/**
 * Re-export PredictionSnapshot from decision types for convenience
 */
export type { PredictionSnapshot } from './decision';

/**
 * Evaluation horizon configuration
 */
export interface EvaluationHorizon {
  /** Number of subsequent candles to evaluate direction */
  candles: number;
  /** Optional time-based horizon (e.g., '1h', '4h') */
  timeframe?: Timeframe;
}

/**
 * Trade resolution horizon configuration
 * Separate from directional evaluation - determines how long to scan for stop/target hits
 */
export interface TradeResolutionHorizon {
  /** Number of subsequent candles to scan for stop/target hits (default: same as directional) */
  candles: number;
  /** Optional time-based horizon (e.g., '1h', '4h') */
  timeframe?: Timeframe;
  /** Policy for unresolved trades at horizon boundary */
  unresolvedPolicy?: 'MTM' | 'UNRESOLVED'; // Mark-to-market at horizon close, or mark unresolved
}

/**
 * Recorded prediction - immutable once created
 */
export interface Prediction {
  /** Unique prediction ID */
  id: string;
  
  /** When the prediction was generated (candle close time) */
  timestamp: number;
  
  /** Instrument symbol */
  symbol: string;
  
  /** Candle timeframe */
  timeframe: Timeframe;
  
  /** Strategy that generated this prediction */
  strategyId: string;
  strategyName: string;
  
  /** Predicted direction */
  direction: Direction | 'NO_TRADE';
  
  /** Reference entry price (signal close price) */
  entryPrice: number;
  
  /** Stop-loss level if supplied by strategy */
  stopLoss?: number;
  
  /** Target level if supplied by strategy */
  target?: number;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Confluence factors and rationale */
  confluenceFactors: string[];
  
  /** Invalidation price where pattern is void */
  invalidationPrice?: number;
  
  /** Risk-reward ratio */
  riskRewardRatio?: number;
  
  /** Candle index in the replay dataset */
  candleIndex: number;
  
  /** Evaluation horizon for directional accuracy */
  evaluationHorizon: EvaluationHorizon;
  
  /** Current evaluation status */
  evaluationStatus: 'PENDING' | 'EVALUATING' | 'COMPLETED' | 'INCONCLUSIVE';
  
  /** Evaluation results (populated after evaluation) */
  evaluation?: PredictionEvaluation;
  
  /** Whether this prediction was generated during replay stop (early) */
  isEarlyStop?: boolean;
  
  /** Immutable snapshot of the evidence available at prediction time */
  snapshot?: PredictionSnapshot;
  
  /** Decision trace explaining how the engine arrived at this prediction */
  trace?: DecisionTrace;
}

/**
 * Directional evaluation result
 */
export interface DirectionalEvaluation {
  /** Reference price at prediction time */
  referencePrice: number;
  
  /** Price at evaluation horizon */
  horizonPrice: number;
  
  /** Price change in points */
  priceChange: number;
  
  /** Price change in percent */
  priceChangePercent: number;
  
  /** Directional outcome */
  outcome: 'CORRECT' | 'INCORRECT' | 'TIE';
  
  /** Whether prediction direction matches price movement */
  isDirectionallyCorrect: boolean;
  
  /** Candles used for evaluation */
  candlesEvaluated: number;
  
  /** Maximum favourable excursion in points within the horizon window */
  maxFavourablePoints?: number;
  
  /** Maximum adverse excursion in points within the horizon window */
  maxAdversePoints?: number;
}

/**
 * Stop/Target evaluation result
 */
export interface StopTargetEvaluation {
  /** Whether stop-loss was hit first */
  stopHitFirst: boolean;
  
  /** Whether target was hit first */
  targetHitFirst: boolean;
  
  /** Both hit within same candle (order indeterminate) */
  ambiguous: boolean;
  
  /** Neither hit within evaluation window */
  neitherHit: boolean;
  
  /** Candle index where first hit occurred */
  hitCandleIndex?: number;
  
  /** Price at hit */
  hitPrice?: number;
  
  /** R-multiple at exit (if target/stop hit) */
  rMultiple?: number;
  
  /** Detailed outcome label */
  outcome: 'TARGET_FIRST' | 'STOP_FIRST' | 'AMBIGUOUS' | 'NEITHER' | 'INCONCLUSIVE';
}

/**
 * Complete prediction evaluation
 */
export interface PredictionEvaluation {
  /** Directional evaluation */
  directional: DirectionalEvaluation;
  
  /** Stop/Target evaluation */
  stopTarget: StopTargetEvaluation;
  
  /** Overall evaluation status */
  status: 'COMPLETED' | 'INCONCLUSIVE' | 'AMBIGUOUS';
  
  /** When evaluation was performed */
  evaluatedAt: number;
  
  /** Candles available for evaluation */
  candlesAvailable: number;
  
  /** Candles needed for full evaluation */
  candlesNeeded: number;
}

/**
 * Per-stage decision funnel for one strategy, derived from actual decision
 * traces. Counts are cumulative over all examined candles; a candle that
 * passes several stages increments each corresponding counter.
 */
export interface StrategyFunnel {
  strategyId: string;
  /** Candles where the strategy actually ran (after warm-up) */
  candlesExamined: number;
  /** Candles where the strategy threw an error */
  errors: number;
  /** S/R zone stage: candles evaluated, passed, failed, skipped, unavailable */
  srZone: StageCounters;
  /** Fibonacci level stage: candles evaluated, passed, failed, skipped, unavailable */
  fibonacci: StageCounters;
  /** Trendline stage: candles evaluated, passed, failed, skipped, unavailable */
  trendline: StageCounters;
  /** Minimum confluence stage: candles evaluated, passed, failed, skipped, unavailable */
  minConfluence: StageCounters;
  /** Rejection candle stage: candles evaluated, passed, failed, skipped, unavailable */
  rejection: StageCounters;
  /** Risk/reward stage: candles evaluated, passed, failed, skipped, unavailable */
  riskReward: StageCounters;
  /** Final signals generated */
  signalsGenerated: number;
  /** Signals that the pattern produced but were rejected by trade filters */
  signalsFiltered: number;
  /** Count of first failed stage per candle (why no signal was produced) */
  firstFailure: Record<string, number>;
}

export interface StageCounters {
  evaluated: number;
  passed: number;
  failed: number;
  skipped: number;
  unavailable: number;
}

/**
 * Replay-level diagnostics: why signals were (or were not) generated.
 */
export interface ReplayDiagnostics {
  /** Minimum closed candles the strategy needs before it can evaluate */
  minRequiredCandles: number;
  /** Candles consumed by warm-up (data warm-up + insufficient history) */
  warmupCandles: number;
  /** Candles actually examined by the strategy */
  candlesExamined: number;
  /** Requested replay window size (null when using start/end dates) */
  requestedCandleCount: number | null;
  /** Dataset date range (ms) */
  dataStart: number | null;
  dataEnd: number | null;
  /** Per-strategy decision funnels */
  funnel: StrategyFunnel[];
  /** Human-readable notes explaining the outcome (e.g. why zero signals) */
  notes: string[];
  /** The exact rule used to evaluate predictions */
  evaluationRule: string;
}

/**
 * Accuracy comparison against naive baselines evaluated on the same
 * signal timestamps and with the same evaluation rule.
 */
export interface BaselineComparison {
  evaluated: number;
  strategy: { correct: number; accuracy: number; ci: [number, number] };
  /** Predict the direction of the trend over the previous 5 closes */
  prevTrend: { correct: number; accuracy: number; ci: [number, number] };
  /** Always predict LONG (evaluated on strategy's signal timestamps) */
  alwaysLong: { correct: number; accuracy: number; ci: [number, number] };
  /** Always predict SHORT (evaluated on strategy's signal timestamps) */
  alwaysShort: { correct: number; accuracy: number; ci: [number, number] };
  /** Always predict LONG (evaluated on ALL examined candles) */
  alwaysLongAll?: { correct: number; accuracy: number; ci: [number, number] };
  /** Always predict SHORT (evaluated on ALL examined candles) */
  alwaysShortAll?: { correct: number; accuracy: number; ci: [number, number] };
}

/**
 * Simulated trading performance from stop/target outcomes on index prices.
 * This is NOT options P&L; transaction costs are not included unless noted.
 */
export interface SimulatedTradingSummary {
  /** Completed stop/target simulations with both levels defined */
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Sum of trade P&L in index points (marked to horizon close when neither level hit) */
  grossPoints: number;
  /** Sum of trade P&L in R multiples */
  grossR: number;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Gross profit / gross loss (R multiples); null when no losing trades */
  profitFactor: number | null;
  /** Maximum peak-to-trough drawdown of the cumulative R curve */
  maxDrawdownR: number;
  /** Cost assumption note */
  costsNote: string;
}

/**
 * Aggregated evaluation metrics
 */
export interface EvaluationMetrics {
  /** Total predictions generated */
  totalPredictions: number;
  
  /** Predictions with completed evaluations (including NO_TRADE) */
  evaluatedCount: number;
  
  /** Directional predictions with completed evaluations (excluding NO_TRADE) */
  evaluatedDirectionalCount: number;
  
  /** Number of NO_TRADE predictions */
  noTradeCount: number;
  
  /** Fraction of predictions that were NO_TRADE */
  abstentionRate: number;
  
  /** Predictions still pending evaluation */
  pendingCount: number;
  
  /** Predictions with insufficient future candles */
  inconclusiveCount: number;
  
  /** Predictions marked ambiguous */
  ambiguousCount: number;
  
  /** Directional accuracy metrics */
  directional: {
    correct: number;
    incorrect: number;
    ties: number;
    accuracy: number; // correct / (correct + incorrect + ties)
    accuracyDenominator: 'ALL' | 'NON_TIE'; // How accuracy is calculated
    /** Wilson 95% confidence interval [lower, upper] */
    ci?: [number, number];
  };
  
  /** Stop/Target outcome distribution */
  stopTarget: {
    targetFirst: number;
    stopFirst: number;
    ambiguous: number;
    neither: number;
    inconclusive: number;
  };
  
  /** Average R-multiple for completed trades */
  avgRMultiple?: number;
  
  /** Results grouped by strategy */
  byStrategy: Record<string, {
    total: number;
    evaluated: number;
    directionalAccuracy: number;
    stopTargetOutcomes: Record<string, number>;
    noTradeCount: number;
  }>;
  
  /** Results grouped by timeframe */
  byTimeframe: Record<string, {
    total: number;
    evaluated: number;
    directionalAccuracy: number;
    noTradeCount: number;
  }>;
  
  /** Results grouped by direction */
  byDirection: Record<Direction | 'NO_TRADE', {
    total: number;
    evaluated: number;
    directionalAccuracy: number;
  }>;
  
  /** Sample size and warnings (e.g. too few evaluated predictions) */
  sampleSize: {
    evaluatedDirectional: number;
    warnings: string[];
  };
  
  /** Baseline comparison evaluated on the same signal timestamps */
  baselines?: BaselineComparison;
  
  /** Simulated trading performance (index points, separate from directional accuracy) */
  simulatedTrading?: SimulatedTradingSummary;
}

/**
 * Replay configuration
 */
export interface ReplayConfig {
  /** Data file path (required for CSV mode, optional for API mode) */
  filePath?: string;
  
  /** Instrument symbol */
  symbol: string;
  
  /** Candle timeframe */
  timeframe: Timeframe;
  
  /** Strategy ID to use (deprecated, use strategyIds) */
  strategyId?: string;
  
  /** Strategy IDs to run (supports multiple strategies) */
  strategyIds?: string[];
  
  /** Per-strategy configuration overrides */
  strategyConfig?: Record<string, Record<string, any>>;
  
  /** Start date (inclusive) */
  startDate?: number;
  
  /** End date (inclusive) */
  endDate?: number;
  
  /** Number of candles to load from end (for CSV mode, overrides startDate) */
  candleCount?: number;

  /** Replay speed (candles per second, 0 = instant) */
  speed: number;
  
  /** Evaluation horizon */
  evaluationHorizon: EvaluationHorizon;
  
  /** Trade resolution horizon - separate from directional evaluation.
   *  Determines how many candles to scan for stop/target hits.
   *  Defaults to evaluationHorizon if not specified. */
  tradeResolutionHorizon?: TradeResolutionHorizon;
  
  /** Whether to enable trade filters */
  filtersEnabled: boolean;
  
  /** Loose filters mode */
  looseFilters: boolean;
  
  /** Record a NO_TRADE prediction when the strategy is evaluated but no signal fires (default true) */
  recordNoTrade?: boolean;

  /** Execution configuration (slippage, gaps, position sizing, etc.) */
  execution?: Partial<ExecutionConfig>;
}

/**
 * Replay status
 */
export interface ReplayStatus {
  /** Unique replay session ID */
  id: string;
  
  /** Current status */
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
  
  /** Configuration used */
  config: ReplayConfig;
  
  /** Current candle index being processed */
  currentIndex: number;
  
  /** Total candles in dataset */
  totalCandles: number;
  
  /** Predictions generated so far */
  predictionsGenerated: number;
  
  /** Predictions evaluated so far */
  predictionsEvaluated: number;
  
  /** Candles consumed by warm-up (no strategy evaluation possible) */
  warmupCandles?: number;
  
  /** Candles examined by the strategy (after warm-up) */
  candlesExamined?: number;
  
  /** Start time of replay */
  startedAt?: number;
  
  /** Completion time */
  completedAt?: number;
  
  /** Error message if failed */
  error?: string;

  /** Dataset start timestamp */
  dataStart?: number;

  /** Dataset end timestamp */
  dataEnd?: number;

  /** Current candle timestamp (for display) */
  currentCandleTime?: number;
}

/**
 * Replay result with all predictions and evaluations
 */
export interface ReplayResult {
  /** Replay session ID */
  id: string;
  
  /** Configuration used */
  config: ReplayConfig;
  
  /** All candles in the replay range */
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  
  /** All predictions generated (final predictions after trade filters) */
  predictions: Prediction[];
  
  /** All candidate signals generated by patterns (before trade filters) */
  candidateSignals: CandidateSignal[];
  
  /** Aggregated evaluation metrics */
  metrics: EvaluationMetrics;
  
  /** Strategy diagnostics: decision funnel and notes */
  diagnostics: ReplayDiagnostics;
  
  /** Summary statistics */
  summary: {
    duration: number; // ms
    candlesProcessed: number;
    signalsGenerated: number;
    signalsEvaluated: number;
    candidatesGenerated: number;
    candidatesFiltered: number;
    candidatesAccepted: number;
  };
}

/**
 * Directional tie rule
 */
export type TieRule = 'TIE' | 'INCORRECT' | 'EXCLUDE';

/**
 * Ambiguous intrabar resolution
 */
export type AmbiguousResolution = 'CONSERVATIVE' | 'AMBIGUOUS';

/**
 * Execution configuration (single source of truth for both engines)
 */
export interface ExecutionConfig {
  /** Slippage in basis points (e.g., 5 = 0.05%) */
  slippageBps: number;
  /** Whether to fill gaps at open (worse fill for trader) */
  fillGapsAtOpen: boolean;
  /** Intrabar stop/target resolution policy */
  intrabarPolicy: 'STOP_FIRST' | 'TARGET_FIRST' | 'AMBIGUOUS';
  /** Risk per trade as fraction of equity (e.g., 0.01 = 1%) */
  riskPerTradePct: number;
  /** Whether to include unrealized P&L in equity for sizing */
  includeUnrealizedInEquity: boolean;
}

/**
 * A candidate signal generated by a strategy pattern BEFORE trade filters.
 * This preserves the original signal details even if rejected by downstream filters.
 */
export interface CandidateSignal {
  /** Unique candidate ID */
  id: string;
  
  /** When the candidate was generated (signal candle close time) */
  timestamp: number;
  
  /** Instrument symbol */
  symbol: string;
  
  /** Candle timeframe */
  timeframe: Timeframe;
  
  /** Strategy that generated this candidate */
  strategyId: string;
  strategyName: string;
  
  /** Predicted direction */
  direction: Direction;
  
  /** Reference entry price (signal close price) */
  entryPrice: number;
  
  /** Stop-loss level if calculated by strategy */
  stopLoss?: number;
  
  /** Target level if calculated by strategy */
  target?: number;
  
  /** Confidence score (0-1) from pattern */
  confidence: number;
  
  /** Confluence factors and rationale from pattern */
  confluenceFactors: string[];
  
  /** Invalidation price where pattern is void */
  invalidationPrice?: number;
  
  /** Risk-reward ratio from pattern */
  riskRewardRatio?: number;
  
  /** Candle index in the replay dataset (signal candle) */
  candleIndex: number;
  
  /** Decision trace explaining how the pattern arrived at this candidate */
  trace?: DecisionTrace;
  
  /** Immutable snapshot of evidence at candidate time */
  snapshot?: PredictionSnapshot;
  
  /** Trade filter results (populated after filter application) */
  filterResult?: {
    passed: boolean;
    failedFilters: string[];
    results: Array<{ filter: string; pass: boolean; reason: string; confidence: number }>;
    totalConfidenceAdjustment: number;
  };
  
  /** Final status of this candidate */
  status: 'PENDING_FILTERS' | 'FILTERED' | 'ACCEPTED' | 'ERROR';
  
  /** If FILTERED or ERROR, the reason */
  rejectionReason?: string;
}

/**
 * Pending order waiting for fill
 */
export interface PendingOrder {
  id: string;
  signal: Signal;
  candleIndex: number;
  createdAt: number;
}

/**
 * Open position with trade management
 */
export interface Position {
  id: string;
  signal: Signal;
  entryPrice: number;
  entryTime: number;
  entryBarIndex: number;
  stopLoss: number;
  target: number;
  size: number;
  riskAmount: number;
  direction: Direction;
  confluenceFactors: string[];
}