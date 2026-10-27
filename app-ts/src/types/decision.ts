import { Direction, Timeframe } from './candle';
import { Signal } from './signal';

/**
 * Result of a single decision stage in a strategy's decision trace.
 * PASS / FAIL are actual evaluations; SKIPPED means the stage was not reached;
 * UNAVAILABLE means the evidence required for the stage does not exist in the
 * engine (and must never be invented downstream).
 */
export type DecisionStageResult = 'PASS' | 'FAIL' | 'SKIPPED' | 'UNAVAILABLE';

/** A single condition evaluation with the actual values used by the strategy. */
export interface ConditionEvaluation {
  id: string;
  label: string;
  /** Whether the condition was actually evaluated on this candle */
  evaluated: boolean;
  /** true = passed, false = failed, null = could not be evaluated (unavailable) */
  passed: boolean | null;
  detail?: string;
  /** Real numbers used by the strategy for this condition */
  values?: Record<string, number | string | boolean | null>;
}

/** One stage of the decision trace (see ReplayEngine decision pipeline). */
export interface DecisionStage {
  id: string;
  label: string;
  result: DecisionStageResult;
  detail?: string;
  values?: Record<string, number | string | boolean | null>;
}

/**
 * Complete, immutable decision trace for one candle evaluation.
 * Produced by the strategy itself from its actual calculations.
 */
export interface DecisionTrace {
  strategyId: string;
  strategyVersion: string;
  /** Index of the candle being processed (the first candle after the signal candle) */
  candleIndex: number;
  /** Timestamp of the last closed candle the strategy used for the decision */
  timestamp: number;
  symbol: string;
  timeframe: Timeframe;
  outcome: 'SIGNAL' | 'NO_SIGNAL' | 'ERROR' | 'FILTERED';
  direction?: Direction;
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

/** Immutable snapshot of the evidence available at prediction time.
 * Later candles must never change this snapshot.
 */
export interface PredictionSnapshot {
  strategyVersion: string;
  candleIndex: number;
  /** Whether the strategy had its full warm-up history when deciding */
  warmupComplete: boolean;
  /** Number of closed candles the strategy actually saw */
  candlesAvailable: number;
  marketContext: {
    atr: number | null;
    trend: string | null;
    volatility: string | null;
  };
  /** S/R zone evidence (null when price was not at a zone) */
  zone: { type: string; priceLevel: number; touches: number; tolerance: number } | null;
  /** Fibonacci evidence (null when price was not at a fib level) */
  fib: { ratio: number; priceLevel: number; direction: string } | null;
  /** Trendline evidence (null when price was not at a trendline) */
  trendline: { type: string; priceLevel: number } | null;
  /** Rejection candle evidence (null when rejection was not evaluated) */
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
  /** Every condition the strategy evaluates, with actual values */
  conditions: ConditionEvaluation[];
  passedConditions: string[];
  failedConditions: string[];
  /** Effective component configuration used for this decision */
  componentConfig?: {
    useSupportResistance: boolean;
    useFibonacci: boolean;
    useTrendline: boolean;
    useRejectionCandle: boolean;
    useMinimumConfluence: boolean;
    useMinimumRiskReward: boolean;
    minConfluenceFactors: number;
    minRejectionWickRatio: number;
    targetRR: number;
  };
}

/** A signal enriched with the trace/snapshot evidence that produced it. */
export interface DetectedSignal extends Signal {
  trace?: DecisionTrace;
  snapshot?: PredictionSnapshot;
}