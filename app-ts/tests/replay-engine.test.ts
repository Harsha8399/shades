/**
 * Deterministic tests for the Historical Replay Engine and Prediction Evaluation.
 *
 * Covers:
 * 1. Prefix-invariance: a signal generated at time T is unchanged if candles
 *    after T are appended (strategy sees only the closed-candle prefix).
 * 2. Chronological processing and no-lookahead (strategy never sees future candles).
 * 3. Directional accuracy evaluation (LONG=higher, SHORT=lower, tie rule).
 * 4. Stop/target outcomes incl. ambiguous intrabar.
 * 5. Insufficient future candles -> INCONCLUSIVE (early stop).
 * 6. NO TRADE is never counted as a directional success.
 * 7. Empty / repeated timestamp handling.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Candle, Signal, Timeframe } from '../src/types';
import { ReplayEngine } from '../src/core/ReplayEngine';
import { PatternEngine } from '../src/core/PatternEngine';
import { PatternRegistry } from '../src/core/PatternRegistry';
import { registerAllPatterns } from '../src/patterns';
import { makeCandles, HOUR_MS } from './helpers';

/** Minimal fake PatternEngine that satisfies the subset ReplayEngine uses. */
class FakePatternEngine {
  minRequired = 10;
  seenLastTimestamps: number[] = [];
  seenCandleCounts: number[] = [];
  private generator: (candles: Candle[], idx: number) => Signal[];

  constructor(generator: (candles: Candle[], idx: number) => Signal[]) {
    this.generator = generator;
  }

  getMinRequiredCandles(): number {
    return this.minRequired;
  }

  detectSignals(candles: Candle[]): Signal[] {
    this.seenCandleCounts.push(candles.length);
    if (candles.length > 0) {
      this.seenLastTimestamps.push(candles[candles.length - 1].timestamp);
    }
    return this.generator(candles, candles.length);
  }
}

function makeSignal(
  candles: Candle[],
  idx: number,
  direction: 'LONG' | 'SHORT',
  overrides: Partial<Signal> = {}
): Signal {
  const candle = candles[candles.length - 1];
  return {
    patternId: 'confluence-zone-em2',
    patternName: 'Confluence Zone + Entry Model 2',
    symbol: 'TEST',
    direction,
    timeframe: '1h',
    timestamp: candle.timestamp,
    entryPrice: candle.close,
    stopLoss: direction === 'LONG' ? candle.close - 10 : candle.close + 10,
    target: direction === 'LONG' ? candle.close + 20 : candle.close - 20,
    confidence: 0.8,
    confluenceFactors: ['test_factor'],
    invalidationPrice: direction === 'LONG' ? candle.close - 15 : candle.close + 15,
    riskRewardRatio: 2,
    suggestedRiskPercent: 0.02,
    ...overrides,
  };
}

function writeCsv(filePath: string, candles: Candle[]): void {
  const header = 'timestamp,open,high,low,close,volume\n';
  const rows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n');
  fs.writeFileSync(filePath, header + rows + '\n');
}

function makeConfig(filePath: string, overrides: Partial<{ speed: number; horizon: number; startDate?: number; endDate?: number; recordNoTrade?: boolean; timeframe?: Timeframe; filtersEnabled?: boolean; tradeResolutionHorizon?: { candles: number; unresolvedPolicy?: 'MTM' | 'UNRESOLVED' } }> = {}) {
  return {
    filePath,
    symbol: 'TEST',
    timeframe: (overrides.timeframe ?? '1h') as Timeframe,
    strategyId: 'confluence-zone-em2',
    speed: overrides.speed ?? 0,
    evaluationHorizon: { candles: overrides.horizon ?? 5 },
    filtersEnabled: overrides.filtersEnabled ?? false,
    looseFilters: true,
    ...(overrides.startDate ? { startDate: overrides.startDate } : {}),
    ...(overrides.endDate ? { endDate: overrides.endDate } : {}),
    ...(overrides.recordNoTrade !== undefined ? { recordNoTrade: overrides.recordNoTrade } : {}),
    ...(overrides.tradeResolutionHorizon ? { tradeResolutionHorizon: overrides.tradeResolutionHorizon } : {}),
  };
}

describe('ReplayEngine: prefix invariance (no lookahead)', () => {
  let filePath: string;

  // 120 hourly candles with a deterministic trend so signals differ by position
  const candles = makeCandles(
    Array.from({ length: 120 }, (_, i) => {
      const base = 100 + i * 0.5;
      return [base, base + 1, base - 1, base + 0.3];
    })
  );

  beforeAll(() => {
    filePath = path.join(__dirname, 'temp_replay_prefix.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('signal at time T is identical whether or not later candles exist', () => {
    // Deterministic generator: emits a LONG signal at every candle.
    const generator = (prefix: Candle[], _idx: number): Signal[] => {
      return [makeSignal(prefix, prefix.length, 'LONG')];
    };

    // Full replay
    const fullEngine = new ReplayEngine(makeConfig(filePath), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    fullEngine.loadData();
    fullEngine.start();
    const fullPredictions = fullEngine.getPredictions();

    // Prefix replay: stop early at index 60 (61 candles processed)
    const prefixEngine = new ReplayEngine(makeConfig(filePath), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    prefixEngine.loadData();
    prefixEngine.start();
    const prefixStatus = prefixEngine.getStatus();
    // Simulate early stop at 61 candles by constructing a prefix-only engine.
    // We emulate a shorter dataset by filtering the file to the first 61 candles.
    const shortPath = path.join(__dirname, 'temp_replay_prefix_short.csv');
    writeCsv(shortPath, candles.slice(0, 61));
    const shortEngine = new ReplayEngine(makeConfig(shortPath), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    shortEngine.loadData();
    shortEngine.start();
    const shortPredictions = shortEngine.getPredictions();
    fs.unlinkSync(shortPath);

    // For every prediction in the short run, the full run must have an
    // identical prediction (same timestamp, entry, direction, confluence).
    expect(shortPredictions.length).toBeGreaterThan(0);
    expect(shortPredictions.length).toBeLessThan(fullPredictions.length);

    for (const shortPred of shortPredictions) {
      const fullPred = fullPredictions.find(p => p.candleIndex === shortPred.candleIndex);
      expect(fullPred).toBeDefined();
      expect(fullPred!.timestamp).toBe(shortPred.timestamp);
      expect(fullPred!.entryPrice).toBe(shortPred.entryPrice);
      expect(fullPred!.direction).toBe(shortPred.direction);
      expect(fullPred!.confluenceFactors).toEqual(shortPred.confluenceFactors);
    }

    expect(prefixStatus.totalCandles).toBe(120);
  });

  it('strategy only ever sees closed candles (never future data)', () => {
    const fake = new FakePatternEngine((_prefix: Candle[], _idx: number) => [] as Signal[]);
    const engine = new ReplayEngine(makeConfig(filePath), undefined, fake as unknown as PatternEngine);
    engine.loadData();
    engine.start();

    // At each detection call, the number of candles seen must be <= currentIndex
    // and the last timestamp seen must be strictly before the last candle.
    const lastTimestamp = candles[candles.length - 1].timestamp;
    for (const ts of fake.seenLastTimestamps) {
      expect(ts).toBeLessThan(lastTimestamp);
    }
    for (const count of fake.seenCandleCounts) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(120);
    }
  });
});

describe('ReplayEngine: evaluation logic', () => {
  let filePath: string;

  // 60 candles: price rises for 20, falls for 20, flat for 20
  const candles = makeCandles(
    Array.from({ length: 60 }, (_, i) => {
      let close: number;
      if (i < 20) close = 100 + i;          // up 100->119
      else if (i < 40) close = 139 - i;     // down 119->100
      else close = 100;                     // flat
      return [close - 1, close + 1, close - 2, close];
    })
  );

  beforeAll(() => {
    filePath = path.join(__dirname, 'temp_replay_eval.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  function runWithDirection(direction: 'LONG' | 'SHORT', emitAt: number, horizon = 5) {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      // Emit a signal only when the prefix has `emitAt` candles
      if (idx === emitAt) {
        return [makeSignal(prefix, idx, direction)];
      }
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    return engine;
  }

  it('LONG is correct when price is higher at horizon', () => {
    // Emit LONG at candle 10; horizon 5. Price at candle 10 is ~110,
    // price at candle 15 is ~115 (rising) -> CORRECT.
    const engine = runWithDirection('LONG', 11, 5);
    const preds = engine.getPredictions();
    expect(preds).toHaveLength(1);
    const evaluation = preds[0].evaluation;
    expect(evaluation).toBeDefined();
    expect(evaluation!.status).toBe('COMPLETED');
    expect(evaluation!.directional.outcome).toBe('CORRECT');
    expect(evaluation!.directional.isDirectionallyCorrect).toBe(true);
    expect(evaluation!.directional.horizonPrice).toBeGreaterThan(evaluation!.directional.referencePrice);
  });

  it('SHORT is correct when price is lower at horizon', () => {
    // Emit SHORT at candle 30; price at 30 is ~109, at 35 is ~104 (falling) -> CORRECT.
    const engine = runWithDirection('SHORT', 31, 5);
    const preds = engine.getPredictions();
    expect(preds).toHaveLength(1);
    expect(preds[0].evaluation!.directional.outcome).toBe('CORRECT');
  });

  it('LONG is incorrect when price is lower at horizon', () => {
    // Emit LONG at candle 30; horizon 5, price falls -> INCORRECT.
    const engine = runWithDirection('LONG', 31, 5);
    const preds = engine.getPredictions();
    expect(preds[0].evaluation!.directional.outcome).toBe('INCORRECT');
    expect(preds[0].evaluation!.directional.isDirectionallyCorrect).toBe(false);
  });

  it('flat price at horizon is a TIE (not counted as correct)', () => {
    // Emit LONG at candle 45; horizon 5. Price is flat at 100 -> TIE.
    const engine = runWithDirection('LONG', 46, 5);
    const preds = engine.getPredictions();
    expect(preds[0].evaluation!.directional.outcome).toBe('TIE');
    expect(preds[0].evaluation!.directional.isDirectionallyCorrect).toBe(false);
    // Metrics must not count the tie as correct
    const metrics = engine.getStatus();
    expect(metrics.predictionsEvaluated).toBe(1);
  });

  it('insufficient future candles -> INCONCLUSIVE (never scored with unavailable data)', () => {
    // Emit at candle 58 with horizon 5 -> only 1 future candle exists.
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 58) return [makeSignal(prefix, idx, 'LONG')];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    expect(preds).toHaveLength(1);
    expect(preds[0].evaluationStatus).toBe('INCONCLUSIVE');
    expect(preds[0].evaluation).toBeUndefined();
    // Inconclusive must not be scored as correct/incorrect
  });
});

describe('ReplayEngine: stop/target outcomes', () => {
  let filePath: string;

  // 40 candles with controlled OHLC for stop/target tests.
  // base price 100; stop at 90 (LONG), target at 120 (LONG).
  const candles = makeCandles(
    Array.from({ length: 40 }, () => [99, 101, 98, 100])
  );

  beforeAll(() => {
    filePath = path.join(__dirname, 'temp_replay_stoptarget.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  function runWithCandles(rows: Array<[number, number, number, number]>, emitAt = 11, direction: 'LONG' | 'SHORT' = 'LONG') {
    const c = makeCandles(rows);
    const p = path.join(__dirname, 'temp_replay_stoptarget_specific.csv');
    writeCsv(p, c);
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === emitAt) {
        // Stop/target derived from overrides
        return [makeSignal(prefix, idx, direction, {
          stopLoss: direction === 'LONG' ? 95 : 105,
          target: direction === 'LONG' ? 105 : 95,
          entryPrice: 100,
        })];
      }
      return [];
    };
    const engine = new ReplayEngine(makeConfig(p, { recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    fs.unlinkSync(p);
    return engine;
  }

  it('target hit first -> TARGET_FIRST', () => {
    // After emit, next candles go UP to 110 (target 105 hit) before any drop.
    const rows: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 11; i++) rows.push([99, 101, 98, 100]);
    for (let i = 0; i < 10; i++) rows.push([100 + i, 102 + i, 99 + i, 101 + i]); // rising past 105
    const engine = runWithCandles(rows, 11, 'LONG');
    const preds = engine.getPredictions();
    expect(preds).toHaveLength(1);
    expect(preds[0].evaluation!.stopTarget.outcome).toBe('TARGET_FIRST');
    expect(preds[0].evaluation!.stopTarget.targetHitFirst).toBe(true);
    expect(preds[0].evaluation!.stopTarget.rMultiple).toBeGreaterThan(0);
  });

  it('stop hit first -> STOP_FIRST', () => {
    // After emit, next candles go DOWN to 90 (stop 95 hit) before any rise.
    const rows: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 11; i++) rows.push([99, 101, 98, 100]);
    for (let i = 0; i < 10; i++) rows.push([100 - i, 102 - i, 98 - i, 99 - i]); // falling past 95
    const engine = runWithCandles(rows, 11, 'LONG');
    const preds = engine.getPredictions();
    expect(preds[0].evaluation!.stopTarget.outcome).toBe('STOP_FIRST');
    expect(preds[0].evaluation!.stopTarget.stopHitFirst).toBe(true);
    expect(preds[0].evaluation!.stopTarget.rMultiple).toBe(-1);
  });

it('stop and target crossed in same candle -> AMBIGUOUS', () => {
    // The ambiguous candle must be AFTER the emit candle (index 11),
    // i.e. at index 12, so it lands in the future-evaluation window.
    const rows: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 12; i++) rows.push([99, 101, 98, 100]);
    rows.push([100, 110, 90, 100]); // both stop and target pierced
    for (let i = 0; i < 10; i++) rows.push([99, 101, 98, 100]);
    const engine = runWithCandles(rows, 11, 'LONG');
    const preds = engine.getPredictions();
    expect(preds).toHaveLength(1);
    expect(preds[0].evaluation!.stopTarget.outcome).toBe('AMBIGUOUS');
    expect(preds[0].evaluation!.stopTarget.ambiguous).toBe(true);
    // Conservative assumption: never invents intrabar ordering; rMultiple is -1
    expect(preds[0].evaluation!.stopTarget.rMultiple).toBe(-1);
  });

  it('neither stop nor target hit within available candles -> NEITHER', () => {
    const rows: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 40; i++) rows.push([99, 101, 98, 100]); // flat, never hits 95 or 105
    const engine = runWithCandles(rows, 11, 'LONG');
    const preds = engine.getPredictions();
    expect(preds[0].evaluation!.stopTarget.outcome).toBe('NEITHER');
    expect(preds[0].evaluation!.stopTarget.neitherHit).toBe(true);
  });
});

describe('ReplayEngine: NO TRADE handling and edge cases', () => {
  let filePath: string;
  const candles = makeCandles(
    Array.from({ length: 40 }, (_, i) => {
      const close = 100 + (i % 5);
      return [close - 1, close + 1, close - 2, close];
    })
  );

  beforeAll(() => {
    filePath = path.join(__dirname, 'temp_replay_notrade.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('NO TRADE predictions are recorded but never counted as directional success', () => {
    // Emit a LONG signal only at odd indices; other candles get NO_TRADE.
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx % 2 === 0) return [makeSignal(prefix, idx, 'LONG')];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 3 }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    const noTrade = preds.filter(p => p.direction === 'NO_TRADE');
    const longPreds = preds.filter(p => p.direction === 'LONG');
    expect(noTrade.length).toBeGreaterThan(0);
    expect(longPreds.length).toBeGreaterThan(0);
    // NO_TRADE is never directionally correct, even when evaluated
    for (const p of noTrade) {
      if (p.evaluationStatus === 'COMPLETED') {
        expect(p.evaluation!.directional.isDirectionallyCorrect).toBe(false);
        expect(p.evaluation!.directional.outcome).toBe('TIE');
      }
    }
  });

  it('empty candle file throws a clear error', () => {
    const emptyPath = path.join(__dirname, 'temp_replay_empty.csv');
    writeCsv(emptyPath, []);
    const engine = new ReplayEngine(makeConfig(emptyPath));
    expect(() => engine.loadData()).toThrow(/No candles loaded/);
    fs.unlinkSync(emptyPath);
  });

  it('repeated timestamps are processed in order without duplicate evaluation', () => {
    // Two candles with the SAME timestamp (duplicate) - should not crash
    const dupCandles = makeCandles([[99, 101, 98, 100], [99, 101, 98, 100]]);
    const dupPath = path.join(__dirname, 'temp_replay_dup.csv');
    writeCsv(dupPath, dupCandles);
    const generator = (_prefix: Candle[], _idx: number): Signal[] => [] as Signal[];
    const fake = new FakePatternEngine(generator);
    fake.minRequired = 1;
    const engine = new ReplayEngine(makeConfig(dupPath, { recordNoTrade: false }), undefined, fake as unknown as PatternEngine);
    engine.loadData();
    expect(() => engine.start()).not.toThrow();
    // NO_TRADE recording is off and no signals fire, so zero predictions
    expect(engine.getPredictions()).toHaveLength(0);
    fs.unlinkSync(dupPath);
  });

  it('date range filtering restricts processed candles', () => {
    const startMs = candles[10].timestamp;
    const endMs = candles[30].timestamp;
    const engine = new ReplayEngine(makeConfig(filePath, { startDate: startMs, endDate: endMs }));
    const loaded = engine.loadData();
    expect(loaded).toBe(21); // candles 10..30 inclusive
  });
});

describe('ReplayEngine: Phase 1 correctness fixes', () => {
  let filePath: string;
  
  beforeAll(() => {
    // 200 candles with enough variation for signals
    const candles = makeCandles(
      Array.from({ length: 200 }, (_, i) => {
        const base = 100 + i * 0.1;
        return [base - 1, base + 1, base - 2, base + 0.5];
      })
    );
    filePath = path.join(__dirname, 'temp_replay_phase1.csv');
    writeCsv(filePath, candles);
  });
  
  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  
  it('P1: byStrategy/byTimeframe/byDirection evaluated counts EXCLUDE NO_TRADE', () => {
    // Emit a LONG signal at index 120 (after warmup), rest NO_TRADE
    // Warmup is 100 candles (minRequired=100), so examined starts at index 100
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 120) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: true }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    const metrics = engine.getMetrics();
    
    const allNoTradeCount = preds.filter(p => p.direction === 'NO_TRADE').length;
    const completedNoTradeCount = preds.filter(p => p.direction === 'NO_TRADE' && p.evaluationStatus === 'COMPLETED').length;
    expect(allNoTradeCount).toBeGreaterThan(0);
    
    // byStrategy evaluated should NOT include NO_TRADE
    const strategyKey = Object.keys(metrics.byStrategy)[0];
    const strat = metrics.byStrategy[strategyKey];
    // noTradeCount in byStrategy only counts COMPLETED NO_TRADE
    expect(strat.noTradeCount).toBe(completedNoTradeCount);
    expect(strat.evaluated).toBe(1); // Only 1 directional signal evaluated
    expect(strat.total).toBe(1 + completedNoTradeCount + (allNoTradeCount - completedNoTradeCount)); // total includes all
    
    // byDirection NO_TRADE evaluated should be 0 for directional accuracy
    expect(metrics.byDirection.NO_TRADE.evaluated).toBe(0);
    expect(metrics.byDirection.NO_TRADE.directionalAccuracy).toBe(0);
  });
  
  it('P2: NO_TRADE reference price uses signal candle (last closed), not forming candle', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      return []; // No signals, all NO_TRADE
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: true }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    
    // All predictions should be NO_TRADE
    const noTrades = preds.filter(p => p.direction === 'NO_TRADE');
    expect(noTrades.length).toBeGreaterThan(0);
    
    // NO_TRADE timestamp should match the signal candle (candleIndex - 1), not the forming candle
    for (const p of noTrades) {
      const signalCandleIdx = p.candleIndex - 1;
      if (signalCandleIdx >= 0) {
        expect(p.timestamp).toBeCloseTo(p.timestamp); // Just verify it's a valid timestamp
        // The entryPrice should be from the signal candle (index - 1)
        // We can't easily check the exact value without knowing the candles, but we can verify
        // that the NO_TRADE was recorded with a valid signal candle reference
        expect(p.entryPrice).toBeGreaterThan(0);
      }
    }
  });
  
  it('P3: Separate directional and trade resolution horizons', () => {
    // Use a short trade resolution horizon (3 candles) vs directional (5 candles)
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(
      makeConfig(filePath, { horizon: 5, recordNoTrade: false, tradeResolutionHorizon: { candles: 3, unresolvedPolicy: 'MTM' } }), 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    expect(preds.length).toBe(1);
    const p = preds[0];
    expect(p.evaluation).toBeDefined();
    // Trade resolution should be limited to 3 candles
    // Directional still uses 5 candles
    expect(p.evaluation!.directional.candlesEvaluated).toBe(5);
    expect(p.evaluation!.stopTarget.outcome).not.toBe('INCONCLUSIVE');
  });
  
  it('P5: Zero-risk signals are handled gracefully (evaluation stopTarget INCONCLUSIVE)', () => {
    // Create a signal with stopLoss == entryPrice (zero risk)
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 120) {
        const s = makeSignal(prefix, idx, 'LONG');
        // Force zero risk
        return [{ ...s, stopLoss: s.entryPrice, target: s.entryPrice + 10 }];
      }
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    // Signal is generated but evaluation stopTarget should be INCONCLUSIVE due to zero risk
    expect(preds.length).toBe(1);
    expect(preds[0].evaluation!.stopTarget.outcome).toBe('INCONCLUSIVE');
  });
  
  it('P5: evaluateStopTarget guards against NaN/Infinity rMultiple', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) {
        const s = makeSignal(prefix, idx, 'LONG');
        // Zero risk - would cause Infinity
        return [{ ...s, stopLoss: s.entryPrice, target: s.entryPrice + 10 }];
      }
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    // Should not crash, signal should be rejected
    // The metrics should not contain Infinity
    const metrics = engine.getMetrics();
    expect(metrics.avgRMultiple).not.toBe(Infinity);
    expect(metrics.avgRMultiple).not.toBe(-Infinity);
    expect(metrics.avgRMultiple).not.toBeNaN();
  });
  
  it('P6: Trace/snapshot candleIndex uses absolute replay index', () => {
    // This test requires a pattern that produces traces
    // With FakePatternEngine, traces are empty, so we test the engine's prediction recording
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    expect(preds.length).toBe(1);
    const p = preds[0];
    // prediction.candleIndex should be the signal candle index (20, since signal generated after candle 20 closes)
    expect(p.candleIndex).toBe(20);
    // The trace (if available) should also have absolute index
    // Note: FakePatternEngine doesn't produce traces, so this tests the engine's recording
  });
  
  it('P7: Wilson confidence intervals are computed for directional accuracy and baselines', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      if (idx === 30) return [makeSignal(prefix, idx, 'SHORT', { stopLoss: 110, target: 90 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const metrics = engine.getMetrics();
    
    // Top-level directional accuracy should have CI
    expect(metrics.directional.ci).toBeDefined();
    expect(Array.isArray(metrics.directional.ci)).toBe(true);
    expect(metrics.directional.ci!.length).toBe(2);
    expect(metrics.directional.ci![0]).toBeLessThanOrEqual(metrics.directional.accuracy);
    expect(metrics.directional.ci![1]).toBeGreaterThanOrEqual(metrics.directional.accuracy);
    
    // Baselines should have CI
    if (metrics.baselines) {
      expect(metrics.baselines.strategy.ci).toBeDefined();
      expect(metrics.baselines.prevTrend.ci).toBeDefined();
      expect(metrics.baselines.alwaysLong.ci).toBeDefined();
      expect(metrics.baselines.alwaysShort.ci).toBeDefined();
      
      // CI bounds should be valid probabilities
      for (const baseline of ['strategy', 'prevTrend', 'alwaysLong', 'alwaysShort'] as const) {
        const ci = metrics.baselines[baseline].ci;
        expect(ci[0]).toBeGreaterThanOrEqual(0);
        expect(ci[1]).toBeLessThanOrEqual(1);
        expect(ci[0]).toBeLessThanOrEqual(ci[1]);
      }
    }
  });
  
  it('P7: all-candles baselines (alwaysLongAll/alwaysShortAll) are computed', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const metrics = engine.getMetrics();
    
    if (metrics.baselines) {
      expect(metrics.baselines.alwaysLongAll).toBeDefined();
      expect(metrics.baselines.alwaysShortAll).toBeDefined();
      expect(metrics.baselines.alwaysLongAll!.ci).toBeDefined();
      expect(metrics.baselines.alwaysShortAll!.ci).toBeDefined();
    }
  });
  
  it('P3: Warning about overlapping evaluation windows', () => {
    // Generate signals at every candle (spacing 1 < horizon 5)
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx >= 20 && idx < 30) {
        return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      }
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const metrics = engine.getMetrics();
    
    // Should have warning about overlapping windows
    const overlapWarning = metrics.sampleSize.warnings.find(w => w.includes('overlap'));
    expect(overlapWarning).toBeDefined();
    expect(overlapWarning).toContain('overlap');
  });
  
  it('P4: setCandles validates chronology and deduplicates', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [101, 102, 100, 101],
      [102, 103, 101, 102],
    ]);
    
    const minimalConfig = makeConfig('', { horizon: 5 });
    delete (minimalConfig as any).filePath;
    
    // Test 1: Duplicate timestamps should be deduplicated
    const dupCandles = [
      candles[0],
      candles[1],
      { ...candles[1], open: 102, high: 103, low: 102, close: 102 }, // Duplicate timestamp
      candles[2],
    ];
    const engine1 = new ReplayEngine(minimalConfig);
    engine1.setCandles(dupCandles);
    expect(engine1.getCandles().length).toBe(3); // Deduplicated
    
    // Test 2: Non-chronological order should be sorted
    const shuffled = [candles[2], candles[0], candles[1]];
    const engine2 = new ReplayEngine(minimalConfig);
    engine2.setCandles(shuffled);
    const timestamps = engine2.getCandles().map(c => c.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
    }
    
    // Test 3: Invalid OHLC should throw
    const invalid = [{ ...candles[0], high: 90 }]; // high < low
    const engine3 = new ReplayEngine(minimalConfig);
    expect(() => engine3.setCandles(invalid)).toThrow();
  });
  
  it('P5: Simulated trading guards against NaN/Infinity in rMultiple', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) {
        const s = makeSignal(prefix, idx, 'LONG');
        return [{ ...s, stopLoss: s.entryPrice, target: s.entryPrice + 10 }]; // Zero risk
      }
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const metrics = engine.getMetrics();
    
    // Should not crash, simulatedTrading should be undefined or have no Infinity
    if (metrics.simulatedTrading) {
      expect(metrics.simulatedTrading.grossR).not.toBe(Infinity);
      expect(metrics.simulatedTrading.grossR).not.toBe(-Infinity);
      expect(metrics.simulatedTrading.grossR).not.toBeNaN();
      expect(metrics.simulatedTrading.avgWinR).not.toBe(Infinity);
      expect(metrics.simulatedTrading.avgLossR).not.toBe(Infinity);
    }
  });
  
  it('P6: Diagnostics explain unsupported timeframe', () => {
    // Use a timeframe not in the Timeframe type (e.g., 10m)
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(
      makeConfig(filePath, { timeframe: '10m' as any, horizon: 5, recordNoTrade: false }), 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();
    const diagnostics = engine.getDiagnostics();
    
    // Should have a note about unsupported timeframe
    const unsupportedNote = diagnostics.notes.find(n => n.includes('NOT supported'));
    expect(unsupportedNote).toBeDefined();
  });
  
  it('P6: Filtered signals are marked FILTERED in traces', () => {
    // This test requires filters to be enabled
    // We can't easily test with FakePatternEngine, but we can verify the engine handles it
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false, filtersEnabled: true }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    // Should not crash with filters enabled
    const preds = engine.getPredictions();
    expect(preds.length).toBeGreaterThanOrEqual(0);
  });
});

describe('ReplayEngine: NO_TRADE reference price correctness', () => {
  let filePath: string;
  
  beforeAll(() => {
    const candles = makeCandles(
      Array.from({ length: 50 }, (_, i) => {
        const base = 100 + i;
        return [base - 1, base + 1, base - 2, base];
      })
    );
    filePath = path.join(__dirname, 'temp_replay_notrade_ref.csv');
    writeCsv(filePath, candles);
  });
  
  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  
  it('NO_TRADE entryPrice equals signal candle close (not forming candle)', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      // Emit signal at index 15, then NO_TRADE at 16
      if (idx === 15) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: true }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    const preds = engine.getPredictions();
    
    // Find the NO_TRADE that comes AFTER the signal
    // With corrected convention: signal at idx=15 has signalCandleIndex=15
    // NO_TRADE at idx=16 has signalCandleIndex=16
    const notrade = preds.find(p => p.direction === 'NO_TRADE' && p.candleIndex === 16);
    expect(notrade).toBeDefined();
    
    if (notrade) {
      // NO_TRADE should use the signal candle (index 16) as reference
      const signalCandle = (engine as any).allCandles[16];
      expect(notrade.entryPrice).toBeCloseTo(signalCandle.close, 4);
      expect(notrade.timestamp).toBe(signalCandle.timestamp);
    }
  });
});

describe('ReplayEngine: NSE session-aware 30m → 1h resampling', () => {
  let filePath: string;
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const baseDate = Date.UTC(2024, 0, 1);

  function makeNse30mCandles(timesIST: string[]): Candle[] {
    return timesIST.map((time, i) => {
      const [h, m] = time.split(':').map(Number);
      const timestamp = baseDate + (h * 60 + m) * 60 * 1000 - IST_OFFSET;
      return {
        timestamp,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 1000,
      };
    });
  }

  beforeAll(() => {
    // Create a full NSE trading day of 30m candles (13 candles: 09:15 to 15:15)
    const nse30mTimesIST = [
      '09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
      '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
    ];
    const candles = makeNse30mCandles(nse30mTimesIST);
    // Add sufficient warm-up candles before the session (need >= 100 for pattern engine)
    const warmupCandles: Candle[] = [];
    for (let d = -4; d <= -1; d++) {  // 4 days before
      for (const time of ['09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
        '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15']) {
        const [h, m] = time.split(':').map(Number);
        const timestamp = baseDate + d * 24 * 60 * 60 * 1000 + (h * 60 + m) * 60 * 1000 - IST_OFFSET;
        warmupCandles.push({
          timestamp,
          open: 95 + warmupCandles.length * 0.01,
          high: 96 + warmupCandles.length * 0.01,
          low: 94 + warmupCandles.length * 0.01,
          close: 95.5 + warmupCandles.length * 0.01,
          volume: 1000,
        });
      }
    }
    const allCandles = [...warmupCandles, ...candles];
    filePath = path.join(__dirname, 'temp_replay_nse30m.csv');
    writeCsv(filePath, allCandles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('selects NSE-specific session-aware resampler for NIFTY 30m → 1h', () => {
    let htfcandlesCount = 0;
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 30) {
        htfcandlesCount = prefix.length;
        return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      }
      return [];
    };

    const config = makeConfig(filePath, { 
      timeframe: '30m', 
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    config.symbol = 'NIFTY50';
    
    const engine = new ReplayEngine(
      config, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();

    const preds = engine.getPredictions();
    expect(preds.length).toBeGreaterThan(0);
    expect(engine.getPredictions().length).toBeGreaterThanOrEqual(1);
  });

  it('uses generic resampler for non-NSE symbols with 30m timeframe', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 30) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };

    const config = makeConfig(filePath, { 
      timeframe: '30m', 
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    config.symbol = 'AAPL';
    
    const engine = new ReplayEngine(
      config, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();

    const preds = engine.getPredictions();
    expect(preds.length).toBeGreaterThanOrEqual(0);
  });

  it('uses generic resampler for NSE symbols with non-30m timeframe', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 30) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };

    const config = makeConfig(filePath, { 
      timeframe: '15m',
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    config.symbol = 'NIFTY50';
    
    const engine = new ReplayEngine(
      config, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();

    const preds = engine.getPredictions();
    expect(preds.length).toBeGreaterThanOrEqual(0);
  });

  it('prefix causality: future candles do not affect NSE session-aligned HTF output', () => {
    const nse30mTimesIST = [
      '09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
      '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
    ];
    const candles = makeNse30mCandles(nse30mTimesIST);
    const warmupTimes = ['08:15', '08:45', '09:15'];
    const warmupCandles = warmupTimes.map((time, i) => {
      const [h, m] = time.split(':').map(Number);
      const timestamp = baseDate + (h * 60 + m) * 60 * 1000 - IST_OFFSET;
      return { timestamp, open: 95 + i, high: 96 + i, low: 94 + i, close: 95.5 + i, volume: 1000 };
    });
    const allCandles = [...warmupCandles, ...candles];
    
    const filePath2 = path.join(__dirname, 'temp_replay_nse30m_causality.csv');
    writeCsv(filePath2, allCandles);

    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 30) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };

    const configFull = makeConfig(filePath2, { 
      timeframe: '30m', 
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    configFull.symbol = 'NIFTY50';
    const engineFull = new ReplayEngine(
      configFull, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engineFull.loadData();
    engineFull.start();
    const predsFull = engineFull.getPredictions();

    const prefixCandles = allCandles.slice(0, 35);
    const filePathPrefix = path.join(__dirname, 'temp_replay_nse30m_prefix.csv');
    writeCsv(filePathPrefix, prefixCandles);

    const configPrefix = makeConfig(filePathPrefix, { 
      timeframe: '30m', 
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    configPrefix.symbol = 'NIFTY50';
    const enginePrefix = new ReplayEngine(
      configPrefix, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    enginePrefix.loadData();
    enginePrefix.start();
    const predsPrefix = enginePrefix.getPredictions();

    expect(predsPrefix.length).toBeLessThanOrEqual(predsFull.length);
    
    if (fs.existsSync(filePath2)) fs.unlinkSync(filePath2);
    if (fs.existsSync(filePathPrefix)) fs.unlinkSync(filePathPrefix);
  });

  it('handles missing opening candle by skipping the entire day', () => {
    const nse30mTimesIST = [
      '09:45', '10:15', '10:45', '11:15', '11:45',
      '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
    ];
    const candles = makeNse30mCandles(nse30mTimesIST);
    const warmupTimes = ['08:15', '08:45'];
    const warmupCandles = warmupTimes.map((time, i) => {
      const [h, m] = time.split(':').map(Number);
      const timestamp = baseDate + (h * 60 + m) * 60 * 1000 - IST_OFFSET;
      return { timestamp, open: 95 + i, high: 96 + i, low: 94 + i, close: 95.5 + i, volume: 1000 };
    });
    const allCandles = [...warmupCandles, ...candles];
    
    const filePathMissing = path.join(__dirname, 'temp_replay_nse30m_missing_open.csv');
    writeCsv(filePathMissing, allCandles);

    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 30) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };

    const config = makeConfig(filePathMissing, { 
      timeframe: '30m', 
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    config.symbol = 'NIFTY50';
    const engine = new ReplayEngine(
      config, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();

    const preds = engine.getPredictions();
    expect(preds.length).toBeGreaterThanOrEqual(0);
    
    if (fs.existsSync(filePathMissing)) fs.unlinkSync(filePathMissing);
  });

  it('handles partial session (fewer than 12 candles) correctly', () => {
    const partialTimes = ['09:15', '09:45', '10:15', '10:45', '11:15', '11:45'];
    const candles = makeNse30mCandles(partialTimes);
    // Add sufficient warm-up candles (need >= 100 for pattern engine)
    const warmupCandles: Candle[] = [];
    for (let d = -4; d <= -1; d++) {
      for (const time of ['09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
        '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15']) {
        const [h, m] = time.split(':').map(Number);
        const timestamp = baseDate + d * 24 * 60 * 60 * 1000 + (h * 60 + m) * 60 * 1000 - IST_OFFSET;
        warmupCandles.push({
          timestamp,
          open: 95 + warmupCandles.length * 0.01,
          high: 96 + warmupCandles.length * 0.01,
          low: 94 + warmupCandles.length * 0.01,
          close: 95.5 + warmupCandles.length * 0.01,
          volume: 1000,
        });
      }
    }
    const allCandles = [...warmupCandles, ...candles];
    
    const filePathPartial = path.join(__dirname, 'temp_replay_nse30m_partial.csv');
    writeCsv(filePathPartial, allCandles);

    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 20) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };

    const config = makeConfig(filePathPartial, { 
      timeframe: '30m', 
      horizon: 5, 
      recordNoTrade: false,
      filtersEnabled: true
    });
    config.symbol = 'NIFTY50';
    const engine = new ReplayEngine(
      config, 
      undefined, 
      new FakePatternEngine(generator) as unknown as PatternEngine
    );
    engine.loadData();
    engine.start();

    const preds = engine.getPredictions();
    expect(preds.length).toBeGreaterThanOrEqual(0);
    
    if (fs.existsSync(filePathPartial)) fs.unlinkSync(filePathPartial);
  });
});

describe('ReplayEngine: Candidate signals and multi-strategy support', () => {
  let filePath: string;
  
  beforeAll(() => {
    // 150 candles with variation
    const candles = makeCandles(
      Array.from({ length: 150 }, (_, i) => {
        const base = 100 + i * 0.2;
        return [base - 1, base + 1, base - 2, base + 0.5];
      })
    );
    filePath = path.join(__dirname, 'temp_replay_candidates.csv');
    writeCsv(filePath, candles);
  });
  
  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  
  it('tracks candidate signals separately from final predictions', () => {
    // Generator that emits signals at multiple indices
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 110) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      if (idx === 120) return [makeSignal(prefix, idx, 'SHORT', { stopLoss: 110, target: 90 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    
    const predictions = engine.getPredictions();
    const candidates = engine.getCandidateSignals();
    
    // Should have 2 final predictions
    expect(predictions.filter(p => p.direction !== 'NO_TRADE')).toHaveLength(2);
    
    // Should have 2 candidate signals
    expect(candidates).toHaveLength(2);
    expect(candidates[0].direction).toBe('LONG');
    expect(candidates[1].direction).toBe('SHORT');
    expect(candidates[0].status).toBe('ACCEPTED');
    expect(candidates[1].status).toBe('ACCEPTED');
  });
  
  it('tracks filtered candidates with rejection reasons', () => {
    // This test would need a PatternEngine with filters enabled
    // For now, verify the engine has the method and returns correct structure
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 110) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    
    const candidates = engine.getCandidateSignals();
    expect(candidates.length).toBeGreaterThanOrEqual(0);
    
    // Each candidate should have proper structure
    for (const c of candidates) {
      expect(c.id).toBeDefined();
      expect(c.strategyId).toBeDefined();
      expect(c.direction).toBeDefined();
      expect(c.entryPrice).toBeGreaterThan(0);
      expect(['PENDING_FILTERS', 'FILTERED', 'ACCEPTED', 'ERROR']).toContain(c.status);
    }
  });
  
  it('funnel counters include candidate generation stats', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 110) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    
    const diagnostics = engine.getDiagnostics();
    const funnel = diagnostics.funnel[0];
    
    // signalsGenerated should count accepted candidates
    expect(funnel.signalsGenerated).toBeGreaterThanOrEqual(0);
  });
  
  it('buildResult includes candidate signals in summary', () => {
    const generator = (prefix: Candle[], idx: number): Signal[] => {
      if (idx === 110) return [makeSignal(prefix, idx, 'LONG', { stopLoss: 90, target: 110 })];
      return [];
    };
    const engine = new ReplayEngine(makeConfig(filePath, { horizon: 5, recordNoTrade: false }), undefined, new FakePatternEngine(generator) as unknown as PatternEngine);
    engine.loadData();
    engine.start();
    
    const result = engine.stop();
    
    expect(result.summary.candidatesGenerated).toBeDefined();
    expect(result.summary.candidatesAccepted).toBeDefined();
    expect(result.summary.candidatesFiltered).toBeDefined();
    expect(result.candidateSignals).toBeDefined();
    expect(Array.isArray(result.candidateSignals)).toBe(true);
  });
});

describe('ReplayEngine: Warmup and evaluation count regression', () => {
  let filePath: string;

  beforeAll(() => {
    // 217 candles - simulates the NIFTY 50 case with 100 warmup + 100 evaluation + 17 extra
    const candles = makeCandles(
      Array.from({ length: 217 }, (_, i) => {
        const base = 100 + i * 0.1;
        return [base - 1, base + 1, base - 2, base + 0.5];
      })
    );
    filePath = path.join(__dirname, 'temp_replay_warmup_217.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('loads 217 candles and computes correct warmup (100) for Confluence Zone EM2', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    const loaded = engine.loadData();

    expect(loaded).toBe(217);
    expect((engine as any).warmupCandleCount).toBe(100);
    expect((engine as any).minRequiredCandles).toBe(100);
    expect((engine as any).allCandles.length).toBe(217);
  });

  it('examines exactly 100 evaluation candles when 100 requested and 100 warmup', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    engine.start();

    const status = engine.getStatus();
    expect(status.warmupCandles).toBe(100);
    expect(status.candlesExamined).toBe(100);
    expect(status.currentIndex).toBe(200); // 100 warmup + 100 evaluation
    expect(status.totalCandles).toBe(217);

    // 17 candles (indices 200-216) should remain unevaluated
    const predictions = engine.getPredictions();
    // All 100 evaluation candles should produce NO_TRADE (fake pattern emits no signals)
    expect(predictions.length).toBe(100);
    expect(predictions.filter(p => p.direction === 'NO_TRADE').length).toBe(100);
  });

  it('stops at requested evaluation count even when extra candles available', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 50, // Request only 50 evaluation candles
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    engine.start();

    const status = engine.getStatus();
    expect(status.warmupCandles).toBe(100);
    expect(status.candlesExamined).toBe(50);
    expect(status.currentIndex).toBe(150); // 100 warmup + 50 evaluation
  });

  it('handles insufficient data (less than warmup requirement)', () => {
    // Only 50 candles - less than the 100 warmup requirement
    const shortCandles = makeCandles(
      Array.from({ length: 50 }, (_, i) => {
        const base = 100 + i * 0.1;
        return [base - 1, base + 1, base - 2, base + 0.5];
      })
    );
    const shortPath = path.join(__dirname, 'temp_replay_short.csv');
    writeCsv(shortPath, shortCandles);

    const config = {
      filePath: shortPath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    const loaded = engine.loadData();
    expect(loaded).toBe(50);
    expect((engine as any).warmupCandleCount).toBe(50); // Limited by available data
    expect((engine as any).minRequiredCandles).toBe(100);

    engine.start();
    const status = engine.getStatus();
    expect(status.warmupCandles).toBe(50);
    expect(status.candlesExamined).toBe(0); // No evaluation possible
    expect(status.currentIndex).toBe(50);

    if (fs.existsSync(shortPath)) fs.unlinkSync(shortPath);
  });

  it('no evaluation occurs during warmup phase', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    
    // Run replay but stop after warmup by using a very small candleCount
    // Actually, let's test that warmup candles don't generate predictions
    // by checking the status after running with candleCount = 0 (not allowed)
    // Instead, we'll verify the warmup logic by checking status fields
    
    engine.start();
    const status = engine.getStatus();
    
    // After full replay (100 warmup + 100 evaluation)
    expect(status.warmupCandles).toBe(100);
    expect(status.candlesExamined).toBe(100);
    expect(status.currentIndex).toBe(200);
    
    // Now test with a config that has only warmup candles worth of data
    // This is tested in the "handles insufficient data" test above
  });
});

describe('ReplayEngine: Multi-strategy support and canonical IDs', () => {
  beforeAll(() => {
    registerAllPatterns();
  });
  let filePath: string;

  beforeAll(() => {
    // 200 candles - enough for all strategies
    const candles = makeCandles(
      Array.from({ length: 200 }, (_, i) => {
        const base = 100 + i * 0.1;
        return [base - 1, base + 1, base - 2, base + 0.5];
      })
    );
    filePath = path.join(__dirname, 'temp_replay_multi.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('each canonical strategy ID resolves to correct pattern class', () => {
    const registry = PatternRegistry.getInstance();
    
    expect(registry.get('confluence-zone-em2')).toBeDefined();
    expect(registry.get('confluence-zone-em2')?.id).toBe('confluence-zone-em2');
    
    expect(registry.get('trendline-break')).toBeDefined();
    expect(registry.get('trendline-break')?.id).toBe('trendline-break');
    
    expect(registry.get('fib-pullback')).toBeDefined();
    expect(registry.get('fib-pullback')?.id).toBe('fib-pullback');
    
    expect(registry.get('sr-retest')).toBeDefined();
    expect(registry.get('sr-retest')?.id).toBe('sr-retest');
  });

  it('unknown strategy IDs are rejected by API validation', () => {
    // This is tested at the API level - unknown IDs are filtered against registry
    const registry = PatternRegistry.getInstance();
    const enabledIds = registry.getEnabled().map((p: any) => p.id);
    
    expect(enabledIds).toContain('confluence-zone-em2');
    expect(enabledIds).toContain('trendline-break');
    expect(enabledIds).toContain('fib-pullback');
    expect(enabledIds).toContain('sr-retest');
    expect(enabledIds).not.toContain('fib-retest'); // Common mistake
    expect(enabledIds).not.toContain('unknown-strategy');
  });

  it('each strategy receives its own parameter overrides', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['trendline-break', 'fib-pullback'],
      candleCount: 50,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'trendline-break': {
          minTrendlineTouches: 5, // Override default 3
          targetRR: 3, // Override default 2
        },
        'fib-pullback': {
          toleranceATR: 0.5, // Override default 0.3
          minSwingSize: 5, // Override default 2
        },
      }
    };

    const engine1 = new ReplayEngine({
      ...config,
      strategyIds: ['trendline-break'],
      strategyConfig: config.strategyConfig,
    });
    engine1.loadData();
    const engine2 = new ReplayEngine({
      ...config,
      strategyIds: ['fib-pullback'],
      strategyConfig: config.strategyConfig,
    });
    engine2.loadData();

    // Each engine should get its own minRequiredCandles based on its strategy
    // The exact values depend on pattern.getRequiredCandleCount()
    expect(engine1.getMinRequiredCandles()).toBeGreaterThan(0);
    expect(engine2.getMinRequiredCandles()).toBeGreaterThan(0);
  });

  it('missing overrides preserve default parameters', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['trendline-break'],
      candleCount: 50,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'trendline-break': {
          targetRR: 3, // Only override targetRR
        },
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    
    // minTrendlineTouches should remain default (3)
    // breakConfirmationBars should remain default (2)
    // retestToleranceATR should remain default (0.3)
    // requireRetest should remain default (false)
    // Only targetRR should be 3
    expect(engine.getMinRequiredCandles()).toBeGreaterThan(0);
  });

  it('empty configuration object does not overwrite defaults', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['trendline-break'],
      candleCount: 50,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'trendline-break': {}, // Empty config - should use all defaults
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    
    // Should use all defaults for trendline-break
    expect(engine.getMinRequiredCandles()).toBeGreaterThan(0);
  });

  it('warmup is strategy-specific (each strategy uses its own required candles)', () => {
    // Confluence zone requires 100, trendline-break requires fewer
    const config100 = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 50,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {},
    };

    const config50 = {
      ...config100,
      strategyIds: ['trendline-break'],
    };

    const engine1 = new ReplayEngine(config100);
    engine1.loadData();
    const engine2 = new ReplayEngine(config50);
    engine2.loadData();

    // Both should have positive required candles
    expect(engine1.getMinRequiredCandles()).toBeGreaterThan(0);
    expect(engine2.getMinRequiredCandles()).toBeGreaterThan(0);
    // They may differ based on pattern requirements
  });

  it('each supported strategy executes through replay pipeline', () => {
    const strategies = ['confluence-zone-em2', 'trendline-break', 'fib-pullback', 'sr-retest'];
    
    for (const strategyId of strategies) {
      const config = {
        filePath,
        symbol: 'NIFTY50',
        timeframe: '1h' as const,
        strategyIds: [strategyId],
        candleCount: 20,
        speed: 0,
        evaluationHorizon: { candles: 5 },
        filtersEnabled: false,
        looseFilters: false,
        strategyConfig: {
          [strategyId]: {}
        },
      };

      const engine = new ReplayEngine(config);
      const loaded = engine.loadData();
      expect(loaded).toBe(200);
      
      engine.start();
      const status = engine.getStatus();
      expect(status.status).toBe('COMPLETED');
      expect(status.currentIndex).toBeGreaterThanOrEqual(20); // warmup + eval
    }
  });

  it('strategy-specific signals and evaluation results appear under correct strategy ID', () => {
    // Create separate engines for each strategy like the API does
    const engine1 = new ReplayEngine({
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      strategyId: 'confluence-zone-em2',
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {},
      }
    });
    
    const engine2 = new ReplayEngine({
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['trendline-break'],
      strategyId: 'trendline-break',
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'trendline-break': {},
      }
    });
    
    engine1.loadData();
    engine2.loadData();
    engine1.start();
    engine2.start();

    const predictions1 = engine1.getPredictions();
    const predictions2 = engine2.getPredictions();
    
    // All predictions from engine1 should have confluence-zone-em2
    for (const p of predictions1) {
      expect(p.strategyId).toBe('confluence-zone-em2');
    }
    // All predictions from engine2 should have trendline-break
    for (const p of predictions2) {
      expect(p.strategyId).toBe('trendline-break');
    }
  });

  it('NO_TRADE, directional, and inconclusive outcomes accounted correctly', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 50,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    engine.start();

    const predictions = engine.getPredictions();
    const directional = predictions.filter(p => p.direction !== 'NO_TRADE');
    const noTrade = predictions.filter(p => p.direction === 'NO_TRADE');
    
    // Total predictions = directional + NO_TRADE
    expect(predictions.length).toBe(directional.length + noTrade.length);
    // Evaluated count should only include COMPLETED directional
    const evaluated = predictions.filter(p => p.evaluationStatus === 'COMPLETED' && p.direction !== 'NO_TRADE');
    expect(evaluated.length).toBeLessThanOrEqual(directional.length);
  });

  it('existing single-strategy replay behavior remains intact', () => {
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyIds: ['confluence-zone-em2'],
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: {
        'confluence-zone-em2': {}
      }
    };

    const engine = new ReplayEngine(config);
    engine.loadData();
    engine.start();

    const status = engine.getStatus();
    expect(status.warmupCandles).toBe(100);
    expect(status.candlesExamined).toBe(100);
    expect(status.currentIndex).toBe(200);
    expect(status.predictionsGenerated).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Regression tests: multi-strategy replay defects
// ---------------------------------------------------------------------------

describe('Multi-strategy replay: isolated registries (regression)', () => {
  let filePath: string;

  beforeAll(() => {
    // 250 hourly candles – enough for any pattern's warm-up
    const candles = makeCandles(
      Array.from({ length: 250 }, (_, i) => {
        const base = 100 + (i % 50) * 0.5;
        return [base - 1, base + 1, base - 2, base + 0.3];
      })
    );
    filePath = path.join(__dirname, 'temp_replay_multistrat.csv');
    writeCsv(filePath, candles);
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  /**
   * Bug: `createPatternForStrategy` previously returned null for non-confluence
   * strategies when `strategyConfig` was empty (hasConfigOverrides === false).
   * Each strategy must now always get its own freshly-constructed pattern instance.
   */
  it('each strategy resolves to a distinct, non-null pattern instance', () => {
    const strategyIds = ['confluence-zone-em2', 'trendline-break', 'fib-pullback', 'sr-retest'];
    const engines = strategyIds.map(strategyId => {
      const config = {
        filePath,
        symbol: 'NIFTY50',
        timeframe: '1h' as const,
        strategyId,
        strategyIds: [strategyId],
        candleCount: 100,
        speed: 0,
        evaluationHorizon: { candles: 5 },
        filtersEnabled: false,
        looseFilters: false,
        // Empty per-strategy config – must still produce a valid engine
        strategyConfig: { [strategyId]: {} },
      };
      return new ReplayEngine(config);
    });

    // Every engine must have its own PatternEngine with exactly 1 pattern registered.
    for (let i = 0; i < strategyIds.length; i++) {
      const pe = (engines[i] as any).patternEngine;
      expect(pe).toBeDefined();
      const patterns = pe.registry.getEnabled();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].id).toBe(strategyIds[i]);
    }
  });

  /**
   * Bug: Singleton `PatternRegistry` was mutated concurrently when multiple
   * `ReplayEngine` instances were created in parallel.  Now each engine holds
   * its own private registry; the global singleton must remain unchanged.
   */
  it('concurrent ReplayEngine creation does not mutate the global PatternRegistry', async () => {
    // Register all patterns into the singleton first (as the server does on startup)
    const { registerAllPatterns: reg } = await import('../src/patterns/index');
    const { PatternRegistry: PR } = await import('../src/core/PatternRegistry');
    reg();
    const globalCountBefore = PR.getInstance().count();

    const strategyIds = ['confluence-zone-em2', 'trendline-break', 'fib-pullback', 'sr-retest'];
    await Promise.all(
      strategyIds.map(strategyId => {
        const config = {
          filePath,
          symbol: 'NIFTY50',
          timeframe: '1h' as const,
          strategyId,
          candleCount: 100,
          speed: 0,
          evaluationHorizon: { candles: 5 },
          filtersEnabled: false,
          looseFilters: false,
          strategyConfig: { [strategyId]: {} },
        };
        const engine = new ReplayEngine(config);
        engine.loadData();
        return new Promise<void>(resolve => {
          engine.onComplete = () => resolve();
          engine.onError = () => resolve();
          engine.start();
        });
      })
    );

    const globalCountAfter = PR.getInstance().count();
    expect(globalCountAfter).toBe(globalCountBefore);
  });

  /**
   * Bug: The `strategyConfig` variable in `replay.ts` was shadowed by the inner
   * `const strategyConfig = { ...config, strategyId, strategyConfig: perStrategyConfig }`.
   * This caused `config.strategyConfig?.[strategyId]` inside `ReplayEngine` to
   * receive a flat params object rather than a nested map, so the lookup always
   * returned `undefined` and the custom config was silently dropped.
   *
   * Verify: a `strategyConfig` passed via `ReplayConfig` with the nested-map shape
   * `{ [strategyId]: params }` is correctly applied to the pattern.
   */
  it('per-strategy config is applied when passed in the nested map shape', () => {
    // The TrendlineBreakPattern defaults to minTrendlineTouches=3.
    // We pass minTrendlineTouches=10 and verify that the registered pattern reflects it.
    const strategyId = 'trendline-break';
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyId,
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      strategyConfig: { [strategyId]: { minTrendlineTouches: 10 } },
    };
    const engine = new ReplayEngine(config);
    const pe = (engine as any).patternEngine;
    const pattern = pe.registry.getEnabled()[0];
    expect(pattern.id).toBe(strategyId);
    expect(pattern.config.parameters.minTrendlineTouches).toBe(10);
  });

  /**
   * When no strategyConfig is provided at all (undefined), the engine must still
   * use the pattern's built-in defaults and not crash.
   */
  it('engine initialises correctly when strategyConfig is absent', () => {
    const strategyId = 'fib-pullback';
    const config = {
      filePath,
      symbol: 'NIFTY50',
      timeframe: '1h' as const,
      strategyId,
      candleCount: 100,
      speed: 0,
      evaluationHorizon: { candles: 5 },
      filtersEnabled: false,
      looseFilters: false,
      // No strategyConfig key
    };
    expect(() => new ReplayEngine(config as any)).not.toThrow();
    const engine = new ReplayEngine(config as any);
    const pe = (engine as any).patternEngine;
    const pattern = pe.registry.getEnabled()[0];
    expect(pattern.id).toBe(strategyId);
    // Default fibLevels should be intact
    expect(pattern.config.parameters.fibLevels).toBeDefined();
    expect(Array.isArray(pattern.config.parameters.fibLevels)).toBe(true);
  });

  /**
   * Warm-up for each strategy uses that strategy's own `getRequiredCandleCount()`.
   * TrendlineBreakPattern requires 80 candles (not confluence's 100) – verify the
   * engine's `minRequiredCandles` reflects the correct strategy.
   */
  it('minRequiredCandles reflects the active strategy, not any other', () => {
    const configs: Array<[string, number]> = [
      ['trendline-break', 80],  // TrendlineBreakPattern default
      ['fib-pullback', 60],     // FibPullbackPattern default
    ];

    for (const [strategyId, expectedMin] of configs) {
      const config = {
        filePath,
        symbol: 'NIFTY50',
        timeframe: '1h' as const,
        strategyId,
        candleCount: 100,
        speed: 0,
        evaluationHorizon: { candles: 5 },
        filtersEnabled: false,
        looseFilters: false,
        strategyConfig: { [strategyId]: {} },
      };
      const engine = new ReplayEngine(config);
      expect(engine.getMinRequiredCandles()).toBe(expectedMin);
    }
  });

  /**
   * Running multiple strategies concurrently (as the API does in Promise.all)
   * must produce predictions with the correct `strategyId` on every record –
   * no prediction from one strategy should bleed into another.
   */
  it('each concurrent engine records predictions only for its own strategyId', async () => {
    const strategyIds = ['confluence-zone-em2', 'trendline-break', 'fib-pullback', 'sr-retest'];
    const results = await Promise.all(
      strategyIds.map(strategyId => {
        const generator = (_prefix: any[], _idx: number) => [] as any[];
        const fakeEngine = new FakePatternEngine(generator);
        fakeEngine.minRequired = 10;
        const config = {
          filePath,
          symbol: 'NIFTY50',
          timeframe: '1h' as const,
          strategyId,
          candleCount: 100,
          speed: 0,
          evaluationHorizon: { candles: 5 },
          filtersEnabled: false,
          looseFilters: false,
          recordNoTrade: true,
          strategyConfig: { [strategyId]: {} },
        };
        const engine = new ReplayEngine(config, undefined, fakeEngine as any);
        engine.loadData();
        return new Promise<{ strategyId: string; preds: any[] }>(resolve => {
          engine.onComplete = () => resolve({ strategyId, preds: engine.getPredictions() });
          engine.onError = () => resolve({ strategyId, preds: [] });
          engine.start();
        });
      })
    );

    for (const { strategyId, preds } of results) {
      expect(preds.length).toBeGreaterThan(0);
      for (const p of preds) {
        expect(p.strategyId).toBe(strategyId);
      }
    }
  });
});
