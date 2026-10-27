import * as fs from 'fs';
import * as path from 'path';
import { Candle, Timeframe, Direction } from '../types';
import {
  Prediction,
  ReplayConfig,
  ReplayStatus,
  ReplayResult,
  ReplayDiagnostics,
  EvaluationMetrics,
  EvaluationHorizon,
  TradeResolutionHorizon,
  PredictionEvaluation,
  DirectionalEvaluation,
  StopTargetEvaluation,
  BaselineComparison,
  SimulatedTradingSummary,
  StrategyFunnel,
  StageCounters,
  CandidateSignal,
  PredictionSnapshot,
} from '../types/prediction';
import { Signal } from '../types/signal';
import { ConfluenceZonePattern, ConfluenceZoneConfig } from '../patterns/ConfluenceZonePattern';
import { TrendlineBreakPattern } from '../patterns/TrendlineBreakPattern';
import { FibPullbackPattern } from '../patterns/FibPullbackPattern';
import { SRRetestPattern } from '../patterns/SRRetestPattern';
import { PatternEngine } from './PatternEngine';
import { DetailedDetectionResult } from './PatternEngine';
import { DecisionTrace, DetectedSignal } from '../types/decision';
import { NseCandleResampler, getHigherTimeframe, getTimeframeMinutes } from './CandleResampler';
import { PatternRegistry } from './PatternRegistry';

export type ReplayStepCallback = (status: ReplayStatus, prediction?: Prediction) => void;
export type ReplayCompleteCallback = (result: ReplayResult) => void;
export type ReplayErrorCallback = (error: Error) => void;

export interface FilteredSignal {
  strategyId: string;
  timestamp: number;
  direction: string;
  entryPrice: number;
  stopLoss?: number;
  target?: number;
  confidence?: number;
  failedFilters: string[];
}

function uuid(): string {
  return `replay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function wilsonCI(correct: number, total: number, z: number = 1.96): [number, number] {
  if (total === 0) return [0, 0];
  const phat = correct / total;
  const denom = 1 + z * z / total;
  const center = (phat + z * z / (2 * total)) / denom;
  const spread = (z / denom) * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total);
  const lo = Math.max(0, center - spread);
  const hi = Math.min(1, center + spread);
  return [lo, hi];
}

const UNSUPPORTED_TIMEFRAMES_NOTE: Record<string, boolean> = {
  '2m': true, '3m': true, '4m': true, '6m': true, '7m': true, '8m': true,
  '9m': true, '10m': true, '11m': true, '12m': true, '13m': true, '14m': true,
  '19m': true, '20m': true, '25m': true, '35m': true, '45m': true, '50m': true,
};

const SUPPORTED_TIMEFRAMES: Record<Timeframe, boolean> = {
  '1m': true, '5m': true, '15m': true, '30m': true,
  '1h': true, '4h': true, '1d': true, '1w': true,
};

function isTimeframeSupported(tf: string): boolean {
  return SUPPORTED_TIMEFRAMES[tf as Timeframe] === true;
}

/**
 * Create a pattern instance with strategy-specific configuration.
 * Always creates a fresh instance for every recognized strategy so that each
 * ReplayEngine owns its own pattern object and concurrent replays never share
 * mutable state.  When `strategyConfig` is empty the pattern's built-in
 * defaults are used; they are NOT replaced.
 */
function createPatternForStrategy(strategyId: string, strategyConfig: Record<string, any>): any {
  const params = strategyConfig && Object.keys(strategyConfig).length > 0
    ? { parameters: strategyConfig as any }
    : undefined;

  switch (strategyId) {
    case 'confluence-zone-em2':
      return new ConfluenceZonePattern(params);
    case 'trendline-break':
      return new TrendlineBreakPattern(params);
    case 'fib-pullback':
      return new FibPullbackPattern(params);
    case 'sr-retest':
      return new SRRetestPattern(params);
    default:
      return null;
  }
}

export class ReplayEngine {
  private config: ReplayConfig;
  private allCandles: Candle[] = [];
  private closedCandles: Candle[] = [];
  private patternEngine: PatternEngine;
  private currentIndex: number = 0;
  private predictions: Prediction[] = [];
  private candidateSignals: CandidateSignal[] = [];
  private status: ReplayStatus;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private replayInterval: ReturnType<typeof setInterval> | null = null;

  private minRequiredCandles: number;
  private warmupCandleCount: number = 0;
  private funnel: Map<string, Partial<StrategyFunnel>> = new Map();
  private filteredSignals: FilteredSignal[] = [];
  private decisionTraces: DecisionTrace[] = [];

  onStep?: ReplayStepCallback;
  onComplete?: ReplayCompleteCallback;
  onError?: ReplayErrorCallback;

  private evaluationHorizonCandles: number;
  private tradeResolutionHorizonCandles: number;
  private tradeResolutionPolicy: 'MTM' | 'UNRESOLVED';

  private warmupCandlesLoaded: number = 0;

  private pendingOrder: {
    predictionId: string;
    signal: Signal;
    candleIndex: number;
    entryCandleIndex: number;
    entryPrice: number;
    stopLoss: number;
    target: number;
    direction: Direction;
    riskPerUnit: number;
    quantity: number;
    riskAmount: number;
    riskPercent: number;
  } | null = null;

  private openPosition: {
    predictionId: string;
    direction: Direction;
    entryPrice: number;
    stopLoss: number;
    target: number;
    quantity: number;
    riskAmount: number;
    entryCandleIndex: number;
  } | null = null;

  private capital: number = 100_000;
  private initialCapital: number = 100_000;

  constructor(
    config: ReplayConfig,
    callbacks?: {
      onStep?: ReplayStepCallback;
      onComplete?: ReplayCompleteCallback;
      onError?: ReplayErrorCallback;
    },
    patternEngine?: PatternEngine,
  ) {
    this.config = config;
    if (callbacks) {
      this.onStep = callbacks.onStep;
      this.onComplete = callbacks.onComplete;
      this.onError = callbacks.onError;
    }
    
    // Create PatternEngine with strategy-specific configuration
    if (patternEngine) {
      this.patternEngine = patternEngine;
    } else {
      const strategyId = config.strategyId || config.strategyIds?.[0] || 'confluence-zone-em2';

      // Resolve per-strategy parameters.
      //
      // Two shapes are in use:
      //   (a) Nested map (API route, new callers):
      //         config.strategyConfig = { 'trendline-break': { minTrendlineTouches: 3 } }
      //       → Look up config.strategyConfig[strategyId].
      //
      //   (b) Flat params (old callers, tests):
      //         config.strategyConfig = { minTrendlineTouches: 3 }
      //       → Use the whole object as params.
      //
      // Distinguishing rule: if the object has at least one key that matches a
      // known strategy ID it is a nested map; otherwise it is flat params.
      // This avoids the previous bug where a nested map for a DIFFERENT strategy
      // would be treated as flat params for the current strategy.
      const KNOWN_STRATEGY_IDS = new Set([
        'confluence-zone-em2', 'trendline-break', 'fib-pullback', 'sr-retest',
      ]);
      const rawConfig = config.strategyConfig ?? {};
      const isNestedMap = Object.keys(rawConfig).some(k => KNOWN_STRATEGY_IDS.has(k));
      const strategyParams: Record<string, any> = isNestedMap
        ? ((rawConfig[strategyId] as Record<string, any>) ?? {})
        : rawConfig;

      // Build a private registry containing ONLY this strategy's pattern.
      // This ensures concurrent ReplayEngine instances never share mutable
      // pattern state and the singleton registry is never mutated.
      const registry = new PatternRegistry();
      const pattern = createPatternForStrategy(strategyId, strategyParams);
      if (pattern) {
        registry.register(pattern);
      } else {
        // Fall back to the globally registered pattern for unknown IDs
        const globalPattern = PatternRegistry.getInstance().get(strategyId);
        if (globalPattern) {
          registry.register(globalPattern);
        }
      }

      this.patternEngine = new PatternEngine(registry);
    }

    if (this.config.filtersEnabled !== undefined && typeof (this.patternEngine as any).setFiltersEnabled === 'function') {
      (this.patternEngine as any).setFiltersEnabled(this.config.filtersEnabled);
    }

    this.evaluationHorizonCandles = config.evaluationHorizon.candles;
    if (config.tradeResolutionHorizon) {
      this.tradeResolutionHorizonCandles = config.tradeResolutionHorizon.candles;
      this.tradeResolutionPolicy = config.tradeResolutionHorizon?.unresolvedPolicy ?? 'MTM';
    } else {
      this.tradeResolutionHorizonCandles = this.evaluationHorizonCandles;
      this.tradeResolutionPolicy = 'MTM';
    }

    this.minRequiredCandles = this.patternEngine.getMinRequiredCandles(this.config.strategyId);

    this.status = {
      id: uuid(),
      status: 'IDLE',
      config: this.config,
      currentIndex: 0,
      totalCandles: 0,
      predictionsGenerated: 0,
      predictionsEvaluated: 0,
    };
  }

  getConfig(): ReplayConfig {
    return this.config;
  }

  getMinRequiredCandles(): number {
    return this.minRequiredCandles;
  }

  loadData(): number {
    if (!this.config.filePath) {
      return 0;
    }

    const content = fs.readFileSync(this.config.filePath, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length <= 1) {
      throw new Error('No candles loaded: the data file is empty or contains no data rows');
    }

    const candles: Candle[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 5) continue;
      const ts = parseInt(parts[0], 10);
      if (isNaN(ts)) continue;

      const c: Candle = {
        timestamp: ts,
        open: parseFloat(parts[1]),
        high: parseFloat(parts[2]),
        low: parseFloat(parts[3]),
        close: parseFloat(parts[4]),
        volume: parts[5] ? parseFloat(parts[5]) : 0,
      };

      if (isValidCandle(c)) {
        candles.push(c);
      }
    }

    if (candles.length === 0) {
      throw new Error('No candles loaded: all rows failed to parse');
    }

    if (this.config.startDate !== undefined && this.config.endDate !== undefined) {
      const filtered = candles.filter(c => c.timestamp >= this.config.startDate! && c.timestamp <= this.config.endDate!);
      this.allCandles = filtered;
    } else if (this.config.startDate !== undefined) {
      this.allCandles = candles.filter(c => c.timestamp >= this.config.startDate!);
    } else if (this.config.endDate !== undefined) {
      this.allCandles = candles.filter(c => c.timestamp <= this.config.endDate!);
    } else {
      this.allCandles = candles;
    }

    this.status.totalCandles = this.allCandles.length;
    this.status.dataStart = this.allCandles[0]?.timestamp ?? null;
    this.status.dataEnd = this.allCandles[this.allCandles.length - 1]?.timestamp ?? null;

    this.warmupCandleCount = Math.min(this.minRequiredCandles, this.allCandles.length);

    return this.allCandles.length;
  }

  setCandles(candles: Candle[]): void {
    if (candles.length === 0) {
      this.allCandles = [];
      this.closedCandles = [];
      this.status.totalCandles = 0;
      return;
    }

    for (const c of candles) {
      validateCandleIntegrity(c);
    }

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

    const deduped: Candle[] = [];
    for (const c of sorted) {
      if (deduped.length === 0 || deduped[deduped.length - 1].timestamp !== c.timestamp) {
        deduped.push(c);
      }
    }

    this.allCandles = deduped;
    this.status.totalCandles = deduped.length;
    this.status.dataStart = deduped[0]?.timestamp ?? null;
    this.status.dataEnd = deduped[deduped.length - 1]?.timestamp ?? null;
    this.warmupCandleCount = Math.min(this.minRequiredCandles, deduped.length);
  }

  private initFunnel(): void {
    const key = this.config.strategyId ?? 'unknown';
    if (!this.funnel.has(key)) {
      const emptyCounters: StageCounters = { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 };
      this.funnel.set(key, {
        strategyId: key,
        candlesExamined: 0,
        errors: 0,
        srZone: { ...emptyCounters },
        fibonacci: { ...emptyCounters },
        trendline: { ...emptyCounters },
        minConfluence: { ...emptyCounters },
        rejection: { ...emptyCounters },
        riskReward: { ...emptyCounters },
        signalsGenerated: 0,
        signalsFiltered: 0,
        firstFailure: {},
      });
    }
  }

  private getHTFCandles(currentIndex: number): Candle[] | undefined {
    const timeframe = this.config.timeframe;
    const htf = getHigherTimeframe(timeframe);
    const sourceMinutes = getTimeframeMinutes(timeframe);
    const targetMinutes = getTimeframeMinutes(htf);
    
    if (targetMinutes <= sourceMinutes) {
      return undefined;
    }
    
    // Only use candles up to currentIndex (exclusive of forming candle)
    const availableCandles = this.allCandles.slice(0, currentIndex);
    if (availableCandles.length === 0) {
      return undefined;
    }
    
    if (timeframe === '30m') {
      if (this.isNseSessionAligned(timeframe, htf)) {
        return NseCandleResampler.resample30mTo1hSessionAligned(availableCandles);
      }
    }
    
    const { CandleResampler } = require('./CandleResampler');
    return CandleResampler.resample(availableCandles, sourceMinutes, targetMinutes);
  }

  private isNseSessionAligned(ltf: string, htf: string): boolean {
    const isNse = this.config.symbol === 'NIFTY50' || this.config.symbol === 'NSE';
    return isNse && ltf === '30m' && htf === '1h';
  }

  start(): void {
    if (this.isRunning) return;
    if (this.allCandles.length === 0 && (!this.config.filePath || this.allCandles.length === 0)) {
      if (this.config.filePath) {
        this.loadData();
      }
    }

    this.isRunning = true;
    this.isPaused = false;
    this.status.status = 'RUNNING';
    this.status.startedAt = Date.now();

    // Initialize status fields for warmup and evaluation tracking
    this.status.warmupCandles = this.warmupCandleCount;
    this.status.candlesExamined = 0;

    this.initFunnel();

    if (this.config.speed === 0) {
      this.runInstant();
    } else {
      this.runWithDelay();
    }
  }

  pause(): void {
    this.isPaused = true;
    this.status.status = 'PAUSED';
    if (this.replayInterval) {
      clearInterval(this.replayInterval);
      this.replayInterval = null;
    }
  }

  resume(): void {
    if (!this.isRunning) {
      this.start();
      return;
    }
    this.isPaused = false;
    this.status.status = 'RUNNING';
    if (this.config.speed === 0) {
      this.runInstant();
    } else {
      this.runWithDelay();
    }
  }

  stop(): ReplayResult {
    this.isRunning = false;
    this.isPaused = false;
    this.status.status = 'STOPPED';
    if (this.replayInterval) {
      clearInterval(this.replayInterval);
      this.replayInterval = null;
    }

    // Use the same evaluation end index as runInstant/runWithDelay
    const requestedEvaluationCandles = this.config.candleCount ?? this.allCandles.length - this.warmupCandleCount;
    const maxEvaluationEndIndex = this.warmupCandleCount + requestedEvaluationCandles;
    const endIndex = Math.min(maxEvaluationEndIndex, this.allCandles.length);

    const startIndex = this.warmupCandleCount;

    for (let i = startIndex; i < endIndex; i++) {
      this.markPendingInconclusive(i);
    }

    this.evaluateAllPredictions();

    const result = this.buildResult();

    return result;
  }

  getStatus(): ReplayStatus {
    return { ...this.status };
  }

  getPredictions(): Prediction[] {
    return [...this.predictions];
  }

  getFilteredSignals(): FilteredSignal[] {
    return [...this.filteredSignals];
  }

  getDecisionTraces(): DecisionTrace[] {
    return [...this.decisionTraces];
  }

  getCandles(): Candle[] {
    return [...this.allCandles];
  }

  private runInstant(): void {
    try {
      if (this.allCandles.length === 0) {
        throw new Error('No candles loaded');
      }

      // Determine evaluation end index: warmupCandleCount + requested candleCount (if specified)
      const requestedEvaluationCandles = this.config.candleCount ?? this.allCandles.length - this.warmupCandleCount;
      const maxEvaluationEndIndex = this.warmupCandleCount + requestedEvaluationCandles;
      const endIndex = Math.min(maxEvaluationEndIndex, this.allCandles.length);

      for (let i = this.warmupCandleCount; i < endIndex; i++) {
        const htfCandles = this.getHTFCandles(i);
        this.processNextCandle(i, htfCandles);
      }

      this.status.status = 'COMPLETED';
      this.status.completedAt = Date.now();
      this.status.currentIndex = endIndex;

      this.markPendingInconclusive(endIndex);
      this.evaluateAllPredictions();

      this.status.predictionsEvaluated = this.predictions.filter(
        p => p.evaluationStatus === 'COMPLETED'
      ).length;
      this.status.predictionsGenerated = this.predictions.length;

      const result = this.buildResult();

      if (this.onComplete) {
        this.onComplete(result);
      }
    } catch (error) {
      this.status.status = 'ERROR';
      this.status.error = error instanceof Error ? error.message : String(error);
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private runWithDelay(): void {
    // Determine evaluation end index: warmupCandleCount + requested candleCount (if specified)
    const requestedEvaluationCandles = this.config.candleCount ?? this.allCandles.length - this.warmupCandleCount;
    const maxEvaluationEndIndex = this.warmupCandleCount + requestedEvaluationCandles;
    const endIndex = Math.min(maxEvaluationEndIndex, this.allCandles.length);

    this.replayInterval = setInterval(() => {
      if (this.isPaused || !this.isRunning) return;

      const htfCandles = this.getHTFCandles(this.currentIndex);

      if (this.currentIndex >= endIndex) {
        clearInterval(this.replayInterval!);
        this.replayInterval = null;
        this.status.status = 'COMPLETED';
        this.status.completedAt = Date.now();
        this.markPendingInconclusive(endIndex);
        this.evaluateAllPredictions();
        const result = this.buildResult();
        if (this.onComplete) {
          this.onComplete(result);
        }
        return;
      }

      this.processNextCandle(this.currentIndex, htfCandles);
    }, 1000 / Math.max(1, this.config.speed));
  }

  private processNextCandle(index: number, htfCandles?: Candle[]): void {
    if (index < this.warmupCandleCount) {
      this.closedCandles = this.allCandles.slice(0, index + 1);
      this.currentIndex = index + 1;
      return;
    }

    this.closedCandles = this.allCandles.slice(0, index);
    const formingCandle = this.allCandles[index];

    const prefix = this.closedCandles;

    if (prefix.length >= this.minRequiredCandles) {
      const { signals, candidates, traces } = this.detectWithTraces(prefix, htfCandles);

      // Store all traces for trace explorer
      for (const trace of traces) {
        this.decisionTraces.push(trace);
        this.ingestTrace(trace, prefix.length);
      }

      // Record all candidate signals (before trade filters)
      // FIX: signalCandleIndex should be `index` (the forming candle that just closed), not `index - 1`
      // The first evaluation candle is at index = warmupCandleCount, and its signal should be attributed to that index
      const signalCandleIndex = index;
      for (const candidate of candidates) {
        this.recordCandidateSignal(candidate, signalCandleIndex);
      }

      if (signals.length > 0) {
        // Signal is generated after the forming candle closes.
        // The signal candle index is `index` (the candle that just closed).
        for (const signal of signals) {
          this.recordPrediction(signal, signalCandleIndex, traceToSnapshot(traces, signal));
        }
      } else {
        if (this.config.recordNoTrade !== false) {
          this.recordNoTradePrediction(index);
        }
      }
    }

    // Increment examined candle count (only for evaluation candles, not warmup)
    this.status.candlesExamined = (this.status.candlesExamined || 0) + 1;

    this.status.currentIndex = index + 1;
    this.status.currentCandleTime = formingCandle.timestamp;

    const statusSnapshot = { ...this.status };
    this.onStep?.(statusSnapshot);

    this.currentIndex = index + 1;
  }

  private detectWithTraces(
    prefix: Candle[],
    htfCandles?: Candle[],
  ): DetailedDetectionResult {
    const absIdx = this.closedCandles.length;
    const fn = (this.patternEngine as any).detectSignalsDetailed;
    if (typeof fn === 'function') {
      try {
        return fn.call(this.patternEngine, prefix, this.config.symbol, this.config.timeframe, htfCandles, {
          strategyId: this.config.strategyId ?? 'unknown',
          absoluteCandleIndex: absIdx,
        });
      } catch (e) {
        // Record the error as a trace instead of silently swallowing
        const errorTrace: DecisionTrace = {
          strategyId: this.config.strategyId ?? 'unknown',
          strategyVersion: '1.0.0',
          candleIndex: absIdx,
          timestamp: prefix[prefix.length - 1]?.timestamp ?? 0,
          symbol: this.config.symbol,
          timeframe: this.config.timeframe,
          outcome: 'ERROR',
          stages: [{
            id: 'exception',
            label: 'Strategy execution',
            result: 'FAIL',
            detail: e instanceof Error ? e.message : String(e),
            values: {},
          }],
          conditions: [{
            id: 'exception',
            label: 'Strategy execution',
            evaluated: true,
            passed: false,
            detail: e instanceof Error ? e.message : String(e),
            values: {},
          }],
        };
        return { signals: [], candidates: [], traces: [errorTrace] };
      }
    }

    const fn2 = (this.patternEngine as any).detectSignals;
    if (typeof fn2 === 'function') {
      try {
        const signals = fn2.call(this.patternEngine, prefix) as Signal[];
        // Convert to candidates for consistency
        const candidates: CandidateSignal[] = signals.map(s => ({
          id: uuid(),
          timestamp: s.timestamp,
          symbol: this.config.symbol,
          timeframe: this.config.timeframe,
          strategyId: this.config.strategyId ?? 'unknown',
          strategyName: s.patternName,
          direction: s.direction,
          entryPrice: s.entryPrice ?? prefix[prefix.length - 1].close,
          stopLoss: s.stopLoss,
          target: s.target,
          confidence: s.confidence,
          confluenceFactors: [...s.confluenceFactors],
          invalidationPrice: s.invalidationPrice,
          riskRewardRatio: s.riskRewardRatio,
          candleIndex: absIdx - 1,
          status: 'ACCEPTED' as const,
        }));
        return { signals: signals as DetectedSignal[], candidates, traces: [] };
      } catch (e) {
        const errorTrace: DecisionTrace = {
          strategyId: this.config.strategyId ?? 'unknown',
          strategyVersion: '1.0.0',
          candleIndex: absIdx,
          timestamp: prefix[prefix.length - 1]?.timestamp ?? 0,
          symbol: this.config.symbol,
          timeframe: this.config.timeframe,
          outcome: 'ERROR',
          stages: [{
            id: 'exception',
            label: 'Strategy execution',
            result: 'FAIL',
            detail: e instanceof Error ? e.message : String(e),
            values: {},
          }],
          conditions: [{
            id: 'exception',
            label: 'Strategy execution',
            evaluated: true,
            passed: false,
            detail: e instanceof Error ? e.message : String(e),
            values: {},
          }],
        };
        return { signals: [], candidates: [], traces: [errorTrace] };
      }
    }

    if ((this.patternEngine as any).detectSignal) {
      try {
        const context = this.patternEngine.buildMarketContext(prefix, this.config.symbol, this.config.timeframe);
        const signal = (this.patternEngine as any).detectSignal(prefix, context, absIdx);
        if (signal) {
          const candidate: CandidateSignal = {
            id: uuid(),
            timestamp: signal.timestamp,
            symbol: this.config.symbol,
            timeframe: this.config.timeframe,
            strategyId: this.config.strategyId ?? 'unknown',
            strategyName: signal.patternName,
            direction: signal.direction,
            entryPrice: signal.entryPrice ?? prefix[prefix.length - 1].close,
            stopLoss: signal.stopLoss,
            target: signal.target,
            confidence: signal.confidence,
            confluenceFactors: [...signal.confluenceFactors],
            invalidationPrice: signal.invalidationPrice,
            riskRewardRatio: signal.riskRewardRatio,
            candleIndex: absIdx - 1,
            status: 'ACCEPTED' as const,
          };
          return { signals: [signal as DetectedSignal], candidates: [candidate], traces: [] };
        }
        return { signals: [], candidates: [], traces: [] };
      } catch (e) {
        const errorTrace: DecisionTrace = {
          strategyId: this.config.strategyId ?? 'unknown',
          strategyVersion: '1.0.0',
          candleIndex: absIdx,
          timestamp: prefix[prefix.length - 1]?.timestamp ?? 0,
          symbol: this.config.symbol,
          timeframe: this.config.timeframe,
          outcome: 'ERROR',
          stages: [{
            id: 'exception',
            label: 'Strategy execution',
            result: 'FAIL',
            detail: e instanceof Error ? e.message : String(e),
            values: {},
          }],
          conditions: [{
            id: 'exception',
            label: 'Strategy execution',
            evaluated: true,
            passed: false,
            detail: e instanceof Error ? e.message : String(e),
            values: {},
          }],
        };
        return { signals: [], candidates: [], traces: [errorTrace] };
      }
    }

    return { signals: [], candidates: [], traces: [] };
  }

  private ingestTrace(trace: DecisionTrace, candleCount: number): void {
    const key = trace.strategyId;
    let fun = this.funnel.get(key);
    if (!fun) {
      const emptyCounters: StageCounters = { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 };
      fun = {
        strategyId: key,
        candlesExamined: 0,
        errors: 0,
        srZone: { ...emptyCounters },
        fibonacci: { ...emptyCounters },
        trendline: { ...emptyCounters },
        minConfluence: { ...emptyCounters },
        rejection: { ...emptyCounters },
        riskReward: { ...emptyCounters },
        signalsGenerated: 0,
        signalsFiltered: 0,
        firstFailure: {},
      };
      this.funnel.set(key, fun);
    }

    fun.candlesExamined = candleCount;

    if (trace.outcome === 'ERROR') {
      fun.errors = (fun.errors || 0) + 1;
      return;
    }

    const stages = trace.stages || [];
    const stageMap: Record<string, keyof Omit<typeof fun, 'strategyId' | 'candlesExamined' | 'errors' | 'signalsGenerated' | 'signalsFiltered' | 'firstFailure'>> = {
      'sr_zone': 'srZone',
      'fibonacci': 'fibonacci',
      'fib_level': 'fibonacci',
      'trendline': 'trendline',
      'min_confluence': 'minConfluence',
      'rejection': 'rejection',
      'rejection_candle': 'rejection',
      'risk_reward': 'riskReward',
    };

    for (const stage of stages) {
      const counterKey = stageMap[stage.id];
      if (!counterKey) continue;
      const counter = fun[counterKey] as StageCounters;
      counter.evaluated += 1;
      switch (stage.result) {
        case 'PASS': counter.passed += 1; break;
        case 'FAIL': counter.failed += 1; break;
        case 'SKIPPED': counter.skipped += 1; break;
        case 'UNAVAILABLE': counter.unavailable += 1; break;
      }
    }

    if (trace.outcome === 'SIGNAL') {
      fun.signalsGenerated = (fun.signalsGenerated || 0) + 1;
    }
    if (trace.outcome === 'FILTERED') {
      fun.signalsFiltered = (fun.signalsFiltered || 0) + 1;
      this.filteredSignals.push({
        strategyId: key,
        timestamp: trace.timestamp,
        direction: trace.direction || 'UNKNOWN',
        entryPrice: trace.entryPrice ?? 0,
        stopLoss: trace.stopLoss,
        target: trace.target,
        confidence: trace.conditions?.find(c => c.id === 'confidence')?.values?.confidence as number | undefined,
        failedFilters: trace.failedFilters || [],
      });
    }
  }

  private recordPrediction(
    signal: Signal,
    signalCandleIndex: number,
    snapshot?: PredictionSnapshot,
    trace?: DecisionTrace,
  ): void {
    const signalCandle = this.allCandles[signalCandleIndex];
    if (!signalCandle) return;

    const prediction: Prediction = {
      id: uuid(),
      timestamp: signalCandle.timestamp,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      strategyId: this.config.strategyId ?? 'unknown',
      strategyName: signal.patternName,
      direction: signal.direction,
      entryPrice: signal.entryPrice ?? signalCandle.close,
      stopLoss: signal.stopLoss,
      target: signal.target,
      confidence: signal.confidence,
      confluenceFactors: signal.confluenceFactors,
      invalidationPrice: signal.invalidationPrice,
      riskRewardRatio: signal.riskRewardRatio,
      candleIndex: signalCandleIndex,
      evaluationHorizon: { candles: this.evaluationHorizonCandles },
      evaluationStatus: 'PENDING',
      snapshot,
      trace,
      isEarlyStop: false,
    };

    this.predictions.push(prediction);
    this.status.predictionsGenerated = this.predictions.length;
    this.status.predictionsEvaluated = this.predictions.filter(p => p.evaluationStatus === 'COMPLETED').length;

    this.onStep?.({ ...this.status }, prediction);
  }

  private recordNoTradePrediction(signalCandleIndex: number): void {
    const signalCandle = this.allCandles[signalCandleIndex];
    if (!signalCandle) return;

    const prediction: Prediction = {
      id: uuid(),
      timestamp: signalCandle.timestamp,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      strategyId: this.config.strategyId ?? 'unknown',
      strategyName: this.config.strategyId ?? 'unknown',
      direction: 'NO_TRADE',
      entryPrice: signalCandle.close,
      stopLoss: undefined,
      target: undefined,
      confidence: 0,
      confluenceFactors: [],
      invalidationPrice: undefined,
      riskRewardRatio: undefined,
      candleIndex: signalCandleIndex,
      evaluationHorizon: { candles: this.evaluationHorizonCandles },
      evaluationStatus: 'PENDING',
    };

    this.predictions.push(prediction);
    this.status.predictionsGenerated = this.predictions.length;
  }

  private recordCandidateSignal(candidate: CandidateSignal, signalCandleIndex: number): void {
    const signalCandle = this.allCandles[signalCandleIndex];
    if (!signalCandle) return;

    // Update candidate with signal candle data
    candidate.timestamp = signalCandle.timestamp;
    candidate.candleIndex = signalCandleIndex;
    if (!candidate.entryPrice || candidate.entryPrice === 0) {
      candidate.entryPrice = signalCandle.close;
    }

    this.candidateSignals.push(candidate);
    
    // Update funnel counters for candidate generation
    const key = candidate.strategyId;
    let fun = this.funnel.get(key);
    if (fun) {
      fun.signalsGenerated = (fun.signalsGenerated || 0) + 1;
    }

    // If candidate was filtered, also track in filteredSignals for backward compatibility
    if (candidate.status === 'FILTERED' && candidate.filterResult) {
      this.filteredSignals.push({
        strategyId: candidate.strategyId,
        timestamp: candidate.timestamp,
        direction: candidate.direction,
        entryPrice: candidate.entryPrice,
        stopLoss: candidate.stopLoss,
        target: candidate.target,
        confidence: candidate.confidence,
        failedFilters: candidate.filterResult.failedFilters,
      });
      
      // Update funnel for filtered signals
      if (fun) {
        fun.signalsFiltered = (fun.signalsFiltered || 0) + 1;
      }
    }
  }

  getCandidateSignals(): CandidateSignal[] {
    return [...this.candidateSignals];
  }

  private markPendingInconclusive(upToCandleIndex: number): void {
    for (const p of this.predictions) {
      if (p.evaluationStatus === 'PENDING' || p.evaluationStatus === 'EVALUATING') {
        const signalCandleIndex = p.candleIndex;
        const neededEndIndex = signalCandleIndex + this.evaluationHorizonCandles + 1;
        if (upToCandleIndex < neededEndIndex) {
          p.evaluationStatus = 'INCONCLUSIVE';
          p.isEarlyStop = true;
        }
      }
    }
  }

  private evaluateAllPredictions(): void {
    for (const p of this.predictions) {
      if (p.evaluationStatus === 'PENDING') {
        this.evaluatePrediction(p);
      }
    }
  }

  private evaluatePrediction(prediction: Prediction): void {
    // NO_TRADE decisions are not directional predictions - evaluate them separately
    if (prediction.direction === 'NO_TRADE') {
      const signalCandleIndex = prediction.candleIndex;
      const candlesNeeded = this.evaluationHorizonCandles + 1;
      const endIndex = signalCandleIndex + this.evaluationHorizonCandles + 1;

      if (endIndex > this.allCandles.length) {
        prediction.evaluationStatus = 'INCONCLUSIVE';
        prediction.isEarlyStop = true;
        return;
      }

      // NO_TRADE always evaluates to TIE directionally with no stop/target
      const evalResult: PredictionEvaluation = {
        directional: {
          referencePrice: prediction.entryPrice,
          horizonPrice: prediction.entryPrice,
          priceChange: 0,
          priceChangePercent: 0,
          outcome: 'TIE',
          isDirectionallyCorrect: false,
          candlesEvaluated: this.evaluationHorizonCandles,
          maxFavourablePoints: 0,
          maxAdversePoints: 0,
        },
        stopTarget: {
          stopHitFirst: false,
          targetHitFirst: false,
          ambiguous: false,
          neitherHit: true,
          outcome: 'NEITHER' as const,
        },
        status: 'COMPLETED',
        evaluatedAt: Date.now(),
        candlesAvailable: this.evaluationHorizonCandles,
        candlesNeeded: candlesNeeded,
      };

      prediction.evaluation = evalResult;
      prediction.evaluationStatus = 'COMPLETED';
      return;
    }

    const signalCandleIndex = prediction.candleIndex;

    const candlesNeeded = this.evaluationHorizonCandles + 1;
    const endIndex = signalCandleIndex + this.evaluationHorizonCandles + 1;

    // Use > instead of >= because slice() with endIndex === length works correctly
    // The slice will include candles up to but not including endIndex
    if (endIndex > this.allCandles.length) {
      prediction.evaluationStatus = 'INCONCLUSIVE';
      prediction.isEarlyStop = true;
      return;
    }

    prediction.evaluationStatus = 'EVALUATING';

    try {
       const horizonCandles = this.allCandles.slice(signalCandleIndex + 1, endIndex);

      const referencePrice = prediction.entryPrice;
      const directional = this.evaluateDirectional(
        prediction.direction as Direction,
        referencePrice,
        horizonCandles,
      );

      const stopTarget = this.evaluateStopTarget(
        prediction,
        signalCandleIndex,
      );

      const evalResult: PredictionEvaluation = {
        directional,
        stopTarget,
        status: stopTarget.outcome === 'INCONCLUSIVE' ? 'INCONCLUSIVE' :
                stopTarget.outcome === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'COMPLETED',
        evaluatedAt: Date.now(),
        candlesAvailable: horizonCandles.length,
        candlesNeeded: candlesNeeded,
      };

      prediction.evaluation = evalResult;

      prediction.evaluationStatus = 'COMPLETED';
    } catch (e) {
      prediction.evaluationStatus = 'INCONCLUSIVE';
    }
  }

  private evaluateDirectional(
    direction: Direction,
    referencePrice: number,
    horizonCandles: Candle[],
  ): DirectionalEvaluation {
    if (horizonCandles.length === 0) {
      return {
        referencePrice,
        horizonPrice: referencePrice,
        priceChange: 0,
        priceChangePercent: 0,
        outcome: 'TIE',
        isDirectionallyCorrect: false,
        candlesEvaluated: 0,
      };
    }

    const horizonPrice = horizonCandles[horizonCandles.length - 1].close;
    const priceChange = horizonPrice - referencePrice;
    const priceChangePercent = referencePrice !== 0 ? (priceChange / referencePrice) * 100 : 0;

    let outcome: 'CORRECT' | 'INCORRECT' | 'TIE';
    if (priceChange > 0) {
      outcome = direction === 'LONG' ? 'CORRECT' : 'INCORRECT';
    } else if (priceChange < 0) {
      outcome = direction === 'LONG' ? 'INCORRECT' : 'CORRECT';
    } else {
      outcome = 'TIE';
    }

    const isDirectionallyCorrect = outcome === 'CORRECT';

    let maxFavourable = 0;
    let maxAdverse = 0;
    if (direction === 'LONG') {
      maxFavourable = Math.max(...horizonCandles.map(c => c.high - referencePrice));
      maxAdverse = Math.max(...horizonCandles.map(c => referencePrice - c.low));
    } else {
      maxFavourable = Math.max(...horizonCandles.map(c => referencePrice - c.low));
      maxAdverse = Math.max(...horizonCandles.map(c => c.high - referencePrice));
    }

    return {
      referencePrice,
      horizonPrice,
      priceChange,
      priceChangePercent,
      outcome,
      isDirectionallyCorrect,
      candlesEvaluated: horizonCandles.length,
      maxFavourablePoints: maxFavourable,
      maxAdversePoints: maxAdverse,
    };
  }

  private evaluateStopTarget(
    prediction: Prediction,
    signalCandleIndex: number,
  ): StopTargetEvaluation {
    const stopLoss = prediction.stopLoss;
    const target = prediction.target;
    const referencePrice = prediction.entryPrice;

    if (!stopLoss || !target || stopLoss === target) {
      return {
        stopHitFirst: false,
        targetHitFirst: false,
        ambiguous: false,
        neitherHit: true,
        outcome: 'INCONCLUSIVE' as const,
      };
    }

    const risk = Math.abs(referencePrice - stopLoss);
    if (risk === 0) {
      return {
        stopHitFirst: false,
        targetHitFirst: false,
        ambiguous: false,
        neitherHit: true,
        outcome: 'INCONCLUSIVE' as const,
      };
    }

    const direction = prediction.direction as Direction;

    let evalEndIndex: number;
    const tradeHorizon = this.tradeResolutionHorizonCandles;
    evalEndIndex = signalCandleIndex + 1 + tradeHorizon;
    if (evalEndIndex >= this.allCandles.length) {
      evalEndIndex = this.allCandles.length - 1;
    }

    const futureCandles = this.allCandles.slice(signalCandleIndex + 1, evalEndIndex + 1);

    if (futureCandles.length === 0) {
      return {
        stopHitFirst: false,
        targetHitFirst: false,
        ambiguous: false,
        neitherHit: false,
        outcome: 'INCONCLUSIVE' as const,
      };
    }

    let stopHitCandle: number | undefined;
    let targetHitCandle: number | undefined;

    for (let i = 0; i < futureCandles.length; i++) {
      const c = futureCandles[i];
      let stopHit: boolean;
      let targetHit: boolean;

      if (direction === 'LONG') {
        stopHit = c.low <= stopLoss;
        targetHit = c.high >= target;
      } else {
        stopHit = c.high >= stopLoss;
        targetHit = c.low <= target;
      }

      if (stopHit) {
        stopHitCandle = i;
        if (targetHit) {
          return {
            stopHitFirst: true,
            targetHitFirst: true,
            ambiguous: true,
            neitherHit: false,
            hitCandleIndex: signalCandleIndex + 1 + i,
            hitPrice: stopLoss,
            rMultiple: -1,
            outcome: 'AMBIGUOUS' as const,
          };
        }
        if (stopHitCandle !== undefined) {
          const rr = Math.abs(target - referencePrice) / risk;
          return {
            stopHitFirst: true,
            targetHitFirst: false,
            ambiguous: false,
            neitherHit: false,
            hitCandleIndex: signalCandleIndex + 1 + i,
            hitPrice: stopLoss,
            rMultiple: -1,
            outcome: 'STOP_FIRST' as const,
          };
        }
      }

      if (targetHit) {
        targetHitCandle = i;
        if (stopHitCandle !== undefined) {
          return {
            stopHitFirst: true,
            targetHitFirst: true,
            ambiguous: true,
            neitherHit: false,
            hitCandleIndex: signalCandleIndex + 1 + i,
            hitPrice: target,
            rMultiple: Math.abs(target - referencePrice) / risk,
            outcome: 'AMBIGUOUS' as const,
          };
        }
        if (targetHitCandle !== undefined) {
          const rr = Math.abs(target - referencePrice) / risk;
          return {
            stopHitFirst: false,
            targetHitFirst: true,
            ambiguous: false,
            neitherHit: false,
            hitCandleIndex: signalCandleIndex + 1 + i,
            hitPrice: target,
            rMultiple: rr,
            outcome: 'TARGET_FIRST' as const,
          };
        }
      }
    }

    const candlesAvailable = futureCandles.length;
    const candlesNeeded = tradeHorizon;

    if (candlesAvailable < candlesNeeded) {
      if (this.tradeResolutionPolicy === 'MTM') {
        const lastCandle = futureCandles[futureCandles.length - 1];
        if (lastCandle) {
          const outcome: StopTargetEvaluation = {
            stopHitFirst: false,
            targetHitFirst: false,
            ambiguous: false,
            neitherHit: true,
            outcome: 'NEITHER' as const,
          };
          return outcome;
        }
      }
      return {
        stopHitFirst: false,
        targetHitFirst: false,
        ambiguous: false,
        neitherHit: false,
        outcome: 'INCONCLUSIVE' as const,
      };
    }

    return {
      stopHitFirst: false,
      targetHitFirst: false,
      ambiguous: false,
      neitherHit: true,
      outcome: 'NEITHER' as const,
    };
  }

  private buildResult(): ReplayResult {
    const metrics = this.calculateMetrics();

    const diagnostics = this.buildDiagnostics();

    const closedSignals = this.predictions.filter(p => p.direction !== 'NO_TRADE');
    const candidatesGenerated = this.candidateSignals.length;
    const candidatesFiltered = this.candidateSignals.filter(c => c.status === 'FILTERED').length;
    const candidatesAccepted = this.candidateSignals.filter(c => c.status === 'ACCEPTED').length;

    const summary = {
      duration: this.status.completedAt && this.status.startedAt
        ? this.status.completedAt - this.status.startedAt
        : 0,
      candlesProcessed: this.allCandles.length,
      signalsGenerated: this.predictions.filter(p => p.direction !== 'NO_TRADE').length,
      signalsEvaluated: this.predictions.filter(p =>
        p.direction !== 'NO_TRADE' && p.evaluationStatus === 'COMPLETED'
      ).length,
      candidatesGenerated,
      candidatesFiltered,
      candidatesAccepted,
    };

    return {
      id: this.status.id,
      config: this.config,
      candles: this.allCandles.map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      predictions: [...this.predictions],
      candidateSignals: [...this.candidateSignals],
      metrics,
      diagnostics,
      summary,
    };
  }

  private calculateMetrics(): EvaluationMetrics {
    const totalPredictions = this.predictions.length;
    const noTradeCount = this.predictions.filter(p => p.direction === 'NO_TRADE').length;
    const directional = this.predictions.filter(p => p.direction !== 'NO_TRADE');

    const evaluatedDirectional = directional.filter(p => p.evaluationStatus === 'COMPLETED');
    const evaluatedAll = this.predictions.filter(p => p.evaluationStatus === 'COMPLETED');

    let correct = 0;
    let incorrect = 0;
    let ties = 0;

    for (const p of evaluatedDirectional) {
      if (p.evaluation) {
        const outcome = p.evaluation.directional.outcome;
        if (outcome === 'CORRECT') correct++;
        else if (outcome === 'INCORRECT') incorrect++;
        else if (outcome === 'TIE') ties++;
      }
    }

    const directionalDenominator = correct + incorrect + ties;
    const directionalAccuracy = directionalDenominator > 0 ? correct / directionalDenominator : 0;

    let stopTargetStats = {
      targetFirst: 0,
      stopFirst: 0,
      ambiguous: 0,
      neither: 0,
      inconclusive: 0,
    };

    let rSum = 0;
    let rCount = 0;

    for (const p of evaluatedDirectional) {
      if (p.evaluation) {
        const st = p.evaluation.stopTarget;
        if (st.outcome === 'TARGET_FIRST') stopTargetStats.targetFirst++;
        else if (st.outcome === 'STOP_FIRST') stopTargetStats.stopFirst++;
        else if (st.outcome === 'AMBIGUOUS') stopTargetStats.ambiguous++;
        else if (st.outcome === 'NEITHER') stopTargetStats.neither++;
        else if (st.outcome === 'INCONCLUSIVE') stopTargetStats.inconclusive++;

        if (st.rMultiple !== undefined && Number.isFinite(st.rMultiple)) {
          rSum += st.rMultiple;
          rCount++;
        }
      }
    }

    const avgRMultiple = rCount > 0 ? rSum / rCount : 0;

    const pendingCount = this.predictions.filter(p =>
      p.evaluationStatus === 'PENDING' || p.evaluationStatus === 'EVALUATING'
    ).length;
    const inconclusiveCount = this.predictions.filter(p => p.evaluationStatus === 'INCONCLUSIVE' ||
      (p.evaluation && p.evaluation.status === 'INCONCLUSIVE')).length;
    const ambiguousCount = this.predictions.filter(p =>
      p.evaluation && p.evaluation.status === 'AMBIGUOUS'
    ).length;

    const evaluatedCount = evaluatedAll.length;

    const byStrategy: Record<string, any> = {};
    for (const p of this.predictions) {
      const key = p.strategyId;
      if (!byStrategy[key]) {
        byStrategy[key] = {
          total: 0,
          evaluated: 0,
          correct: 0,
          incorrect: 0,
          directionalAccuracy: 0,
          stopTargetOutcomes: {},
          noTradeCount: 0,
        };
      }
      byStrategy[key].total++;
      if (p.direction === 'NO_TRADE' && p.evaluationStatus === 'COMPLETED') {
        byStrategy[key].noTradeCount = (byStrategy[key].noTradeCount || 0) + 1;
      }
      if (p.evaluationStatus === 'COMPLETED' && p.direction !== 'NO_TRADE') {
        byStrategy[key].evaluated++;
        if (p.evaluation) {
          const outcome = p.evaluation.directional.outcome;
          if (outcome === 'CORRECT') byStrategy[key].correct++;
          else if (outcome === 'INCORRECT') byStrategy[key].incorrect++;
        }
      }
    }

    for (const key of Object.keys(byStrategy)) {
      const s = byStrategy[key];
      s.directionalAccuracy = s.evaluated > 0 ? s.correct / s.evaluated : 0;
    }

    const byTimeframe: Record<string, any> = {};
    for (const p of this.predictions) {
      const key = p.timeframe;
      if (!byTimeframe[key]) {
        byTimeframe[key] = {
          total: 0,
          evaluated: 0,
          correct: 0,
          incorrect: 0,
          directionalAccuracy: 0,
          noTradeCount: 0,
        };
      }
      byTimeframe[key].total++;
      if (p.direction === 'NO_TRADE' && p.evaluationStatus === 'COMPLETED') {
        byTimeframe[key].noTradeCount = (byTimeframe[key].noTradeCount || 0) + 1;
      }
      if (p.evaluationStatus === 'COMPLETED' && p.direction !== 'NO_TRADE') {
        byTimeframe[key].evaluated++;
        if (p.evaluation) {
          const outcome = p.evaluation.directional.outcome;
          if (outcome === 'CORRECT') byTimeframe[key].correct++;
          else if (outcome === 'INCORRECT') byTimeframe[key].incorrect++;
        }
      }
    }

    for (const key of Object.keys(byTimeframe)) {
      const s = byTimeframe[key];
      s.directionalAccuracy = s.evaluated > 0 ? s.correct / s.evaluated : 0;
    }

    const DIRECTIONS: (Direction | 'NO_TRADE')[] = ['LONG', 'SHORT', 'NO_TRADE'];
    const byDirection: Record<Direction | 'NO_TRADE', any> = {} as any;
    for (const d of DIRECTIONS) {
      byDirection[d] = {
        total: 0,
        evaluated: 0,
        correct: 0,
        incorrect: 0,
        directionalAccuracy: 0,
      };
    }

    for (const p of this.predictions) {
      const dirKey = p.direction as Direction | 'NO_TRADE';
      if (!byDirection[dirKey]) {
        byDirection[dirKey] = {
          total: 0,
          evaluated: 0,
          correct: 0,
          incorrect: 0,
          directionalAccuracy: 0,
        };
      }
      byDirection[dirKey].total++;
      if (p.evaluationStatus === 'COMPLETED' && p.direction !== 'NO_TRADE') {
        byDirection[dirKey].evaluated++;
        if (p.evaluation) {
          const outcome = p.evaluation.directional.outcome;
          if (outcome === 'CORRECT') byDirection[dirKey].correct++;
          else if (outcome === 'INCORRECT') byDirection[dirKey].incorrect++;
        }
      }
    }

    for (const key of Object.keys(byDirection)) {
      const s = byDirection[key as Direction | 'NO_TRADE'];
      s.directionalAccuracy = s.evaluated > 0 ? s.correct / s.evaluated : 0;
    }

    const warnings: string[] = [];
    if (evaluatedDirectional.length < 30) {
      warnings.push(`Only ${evaluatedDirectional.length} directional predictions evaluated; sample size below 30, results may not be statistically significant.`);
    }

    const signalSpacing = this.detectSignalSpacing(directional);
    if (signalSpacing > 0 && signalSpacing < this.evaluationHorizonCandles) {
      warnings.push(
        `Evaluation windows overlap: signals are ${signalSpacing} candles apart ` +
          `but horizon is ${this.evaluationHorizonCandles}. Some candles are counted in multiple evaluations.`
      );
    }

    const ci = wilsonCI(correct, correct + incorrect + ties);

    const baselines = this.calculateBaselines();

    const simulatedTrading = this.calculateSimulatedTrading();

    const evaluatedDirectionalCount = evaluatedDirectional.length;

    const metrics: EvaluationMetrics = {
      totalPredictions,
      evaluatedCount,
      evaluatedDirectionalCount,
      noTradeCount,
      abstentionRate: totalPredictions > 0 ? noTradeCount / totalPredictions : 0,
      pendingCount,
      inconclusiveCount,
      ambiguousCount,
      directional: {
        correct,
        incorrect,
        ties,
        accuracy: directionalAccuracy,
        accuracyDenominator: 'ALL',
        ci,
      },
      stopTarget: stopTargetStats,
      avgRMultiple,
      byStrategy,
      byTimeframe,
      byDirection,
      sampleSize: {
        evaluatedDirectional: evaluatedDirectionalCount,
        warnings,
      },
      baselines,
      simulatedTrading,
    };

    return metrics;
  }

  private detectSignalSpacing(predictions: Prediction[]): number {
    if (predictions.length < 2) return 0;
    const indices = predictions.map(p => p.candleIndex).sort((a, b) => a - b);
    const diffs = indices.slice(1).map((idx, i) => idx - indices[i]);
    const minDiff = Math.min(...diffs);
    return minDiff;
  }

  private calculateBaselines(): BaselineComparison | undefined {
    const directional = this.predictions.filter(p =>
      p.direction !== 'NO_TRADE' &&
      p.evaluationStatus === 'COMPLETED' &&
      p.evaluation
    );

    if (directional.length === 0) {
      const allCandlesEvaluated = this.predictions.filter(p =>
        p.direction !== 'NO_TRADE' && p.evaluationStatus === 'COMPLETED'
      );
      return {
        evaluated: 0,
        strategy: { correct: 0, accuracy: 0, ci: [0, 0] },
        prevTrend: { correct: 0, accuracy: 0, ci: [0, 0] },
        alwaysLong: { correct: 0, accuracy: 0, ci: [0, 0] },
        alwaysShort: { correct: 0, accuracy: 0, ci: [0, 0] },
      };
    }

    let strategyCorrect = 0;
    let prevTrendCorrect = 0;
    let alwaysLongCorrect = 0;
    let alwaysShortCorrect = 0;

    for (const p of directional) {
      const e = p.evaluation;
      if (!e) continue;

      if (e.directional.outcome === 'CORRECT') {
        strategyCorrect++;
      }

      const signalCandleIndex = p.candleIndex;
      const prev5 = this.allCandles.slice(Math.max(0, signalCandleIndex - 5), signalCandleIndex);
      if (prev5.length >= 2) {
        const first = prev5[0].close;
        const last = prev5[prev5.length - 1].close;
        const prevTrendDirection = last > first ? 'LONG' : last < first ? 'SHORT' : 'TIE';
        if (prevTrendDirection === p.direction) {
          prevTrendCorrect++;
        }
      }

      if (p.direction === 'LONG' && e.directional.outcome === 'CORRECT') {
        alwaysLongCorrect++;
      }
      if (p.direction === 'SHORT' && e.directional.outcome === 'CORRECT') {
        alwaysShortCorrect++;
      }
    }

    const evaluated = directional.length;

    const allCandlesEvaluated = this.predictions.filter(p =>
      p.direction !== 'NO_TRADE' && p.evaluationStatus === 'COMPLETED'
    );
    let allLongCorrect = 0;
    let allShortCorrect = 0;
    for (const p of allCandlesEvaluated) {
      const e = p.evaluation;
      if (!e) continue;
      if (p.direction === 'LONG' && e.directional.outcome === 'CORRECT') {
        allLongCorrect++;
      }
      if (p.direction === 'SHORT' && e.directional.outcome === 'CORRECT') {
        allShortCorrect++;
      }
    }

    return {
      evaluated,
      strategy: {
        correct: strategyCorrect,
        accuracy: evaluated > 0 ? strategyCorrect / evaluated : 0,
        ci: wilsonCI(strategyCorrect, evaluated),
      },
      prevTrend: {
        correct: prevTrendCorrect,
        accuracy: evaluated > 0 ? prevTrendCorrect / evaluated : 0,
        ci: wilsonCI(prevTrendCorrect, evaluated),
      },
      alwaysLong: {
        correct: alwaysLongCorrect,
        accuracy: evaluated > 0 ? alwaysLongCorrect / evaluated : 0,
        ci: wilsonCI(alwaysLongCorrect, evaluated),
      },
      alwaysShort: {
        correct: alwaysShortCorrect,
        accuracy: evaluated > 0 ? alwaysShortCorrect / evaluated : 0,
        ci: wilsonCI(alwaysShortCorrect, evaluated),
      },
      alwaysLongAll: {
        correct: allLongCorrect,
        accuracy: allCandlesEvaluated.length > 0 ? allLongCorrect / allCandlesEvaluated.length : 0,
        ci: wilsonCI(allLongCorrect, allCandlesEvaluated.length),
      },
      alwaysShortAll: {
        correct: allShortCorrect,
        accuracy: allCandlesEvaluated.length > 0 ? allShortCorrect / allCandlesEvaluated.length : 0,
        ci: wilsonCI(allShortCorrect, allCandlesEvaluated.length),
      },
    };
  }

  private calculateSimulatedTrading(): SimulatedTradingSummary | undefined {
    const directional = this.predictions.filter(p =>
      p.direction !== 'NO_TRADE' &&
      p.evaluationStatus === 'COMPLETED' &&
      p.evaluation &&
      p.stopLoss !== undefined &&
      p.target !== undefined
    );

    if (directional.length === 0) {
      return undefined;
    }

    let wins = 0;
    let losses = 0;
    let grossR = 0;
    const rMultiples: number[] = [];
    let totalPoints = 0;

    for (const p of directional) {
      const e = p.evaluation!;
      const st = e.stopTarget;

      if (st.outcome === 'INCONCLUSIVE') continue;

      let r: number;
      let points = 0;

      if (st.rMultiple !== undefined) {
        r = st.rMultiple;
      }

      // Calculate points for ALL outcomes based on actual hit price or horizon price
      if (st.outcome === 'TARGET_FIRST') {
        if (st.rMultiple !== undefined) {
          r = st.rMultiple;
          grossR += r;
          rMultiples.push(r);
        }
        // Target hit: use target as exit price
        points = p.direction === 'LONG' ? p.target! - p.entryPrice : p.entryPrice - p.target!;
      } else if (st.outcome === 'STOP_FIRST' || st.outcome === 'AMBIGUOUS') {
        r = -1;
        grossR += r;
        rMultiples.push(r);
        // Stop hit: use stopLoss as exit price
        points = p.direction === 'LONG' ? p.stopLoss! - p.entryPrice : p.entryPrice - p.stopLoss!;
      } else if (st.outcome === 'NEITHER') {
        const entryPrice = p.entryPrice;
        const horizonPrice = e.directional.horizonPrice;
        const risk = Math.abs(entryPrice - (p.stopLoss ?? entryPrice));
        if (risk > 0) {
          const pnl = p.direction === 'LONG'
            ? horizonPrice - entryPrice
            : entryPrice - horizonPrice;
          r = pnl / risk;
          if (Number.isFinite(r)) {
            grossR += r;
            rMultiples.push(r);
          }
        }
        points = horizonPrice - entryPrice;
      }

      totalPoints += points;

      // Count wins/losses exactly once per resolved trade
      if (st.outcome === 'TARGET_FIRST') {
        wins++;
      } else if (st.outcome === 'STOP_FIRST' || st.outcome === 'AMBIGUOUS') {
        losses++;
      }
      // NEITHER outcomes are not counted as wins or losses (mark-to-market only)
    }

    const totalTrades = wins + losses;

    const avgWinR = wins > 0 ? rMultiples.filter(r => r > 0).reduce((a, b) => a + b, 0) / wins : null;
    const avgLossR = losses > 0 ? rMultiples.filter(r => r < 0).reduce((a, b) => a + b, 0) / losses : null;

    const positiveRs = rMultiples.filter(r => r > 0);
    const negativeRs = rMultiples.filter(r => r < 0);
    const grossWins = positiveRs.reduce((a, b) => a + b, 0);
    const grossLosses = negativeRs.reduce((a, b) => a + b, 0);
    const profitFactor = grossLosses < 0 ? grossWins / Math.abs(grossLosses) : null;

    let maxDrawdownR = 0;
    let runningR = 0;
    let peak = 0;
    for (const r of rMultiples) {
      runningR += r;
      if (runningR > peak) peak = runningR;
      const dd = peak - runningR;
      if (dd > maxDrawdownR) maxDrawdownR = dd;
    }

    return {
      trades: totalTrades,
      wins,
      losses,
      winRate: totalTrades > 0 ? wins / totalTrades : null,
      grossPoints: totalPoints,
      grossR,
      avgWinR,
      avgLossR,
      profitFactor,
      maxDrawdownR: Number.isFinite(maxDrawdownR) ? maxDrawdownR : 0,
      costsNote: 'Index-point simulation. Costs not included.',
    };
  }

  private buildDiagnostics(): ReplayDiagnostics {
    const funnel: StrategyFunnel[] = [];
    for (const [key, fun] of this.funnel) {
      funnel.push({
        strategyId: key,
        candlesExamined: fun.candlesExamined || 0,
        errors: fun.errors || 0,
        srZone: fun.srZone || { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 },
        fibonacci: fun.fibonacci || { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 },
        trendline: fun.trendline || { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 },
        minConfluence: fun.minConfluence || { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 },
        rejection: fun.rejection || { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 },
        riskReward: fun.riskReward || { evaluated: 0, passed: 0, failed: 0, skipped: 0, unavailable: 0 },
        signalsGenerated: fun.signalsGenerated || 0,
        signalsFiltered: fun.signalsFiltered || 0,
        firstFailure: fun.firstFailure || {},
      });
    }

    const notes: string[] = [];

    if (!isTimeframeSupported(this.config.timeframe)) {
      notes.push(`Timeframe '${this.config.timeframe}' is NOT supported by the strategy; resampling will not be applied.`);
    }

    const candleCount = this.predictions.filter(p => p.direction !== 'NO_TRADE').length;
    if (candleCount === 0 && this.predictions.every(p => p.direction === 'NO_TRADE')) {
      const totalFiltered = Array.from(this.funnel.values()).reduce((sum, f) => sum + (f.signalsFiltered || 0), 0);
      if (totalFiltered > 0) {
        notes.push(`No tradeable signals reached the evaluation stage. The strategy generated ${totalFiltered} signal(s) but they were rejected by trade filters. Disable filters (filtersEnabled=false) to allow them.`);
      } else {
        notes.push('No signals were generated. The strategy did not find any matching setups in the evaluated period.');
      }
    }

    if (funnel.length === 0) {
      notes.push('No decision traces were produced by the pattern engine.');
    }

    return {
      minRequiredCandles: this.minRequiredCandles,
      warmupCandles: this.warmupCandleCount,
      candlesExamined: this.predictions.filter(p => p.direction === 'NO_TRADE' || p.candleIndex > this.warmupCandleCount).length,
      requestedCandleCount: this.config.candleCount ?? null,
      dataStart: this.status.dataStart ?? null,
      dataEnd: this.status.dataEnd ?? null,
      funnel,
      notes,
      evaluationRule: 'LONG is correct if price is higher at horizon; SHORT is correct if lower; TIE = unchanged price. Stop/target: check each subsequent candle high/low. AMBIGUOUS if both hit in same candle. INCONCLUSIVE if insufficient future candles.',
    };
  }

  getMetrics(): EvaluationMetrics {
    return this.calculateMetrics();
  }

  getDiagnostics(): ReplayDiagnostics {
    return this.buildDiagnostics();
  }
}

function isValidCandle(c: Candle): boolean {
  return typeof c.timestamp === 'number' &&
    !isNaN(c.timestamp) &&
    typeof c.open === 'number' &&
    typeof c.high === 'number' &&
    typeof c.low === 'number' &&
    typeof c.close === 'number' &&
    c.high >= c.low &&
    c.high >= c.open &&
    c.high >= c.close &&
    c.low <= c.open &&
    c.low <= c.close;
}

function validateCandleIntegrity(c: Candle): void {
  if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) {
    throw new Error(
      `Invalid OHLC for candle at timestamp ${c.timestamp}: O=${c.open} H=${c.high} L=${c.low} C=${c.close}`
    );
  }
}

function traceToSnapshot(traces: DecisionTrace[], signal: Signal): PredictionSnapshot | undefined {
  if (traces.length === 0) return undefined;
  // Find the trace that matches this signal's strategy
  const trace = traces.find(t => t.strategyId === signal.patternId) ?? traces[0];
  return {
    strategyVersion: trace.strategyVersion || '1.0.0',
    candleIndex: trace.candleIndex,
    warmupComplete: true,
    candlesAvailable: 0,
    marketContext: {
      atr: null,
      trend: null,
      volatility: null,
    },
    zone: null,
    fib: null,
    trendline: null,
    rejection: null,
    levels: {
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target: signal.target,
      riskReward: signal.riskRewardRatio,
      minRiskReward: 1.5,
    },
    conditions: trace.conditions || [],
    passedConditions: (trace.conditions || [])
      .filter(c => c.passed === true)
      .map(c => c.id),
    failedConditions: (trace.conditions || [])
      .filter(c => c.passed === false)
      .map(c => c.id),
  };
}

export default ReplayEngine;
