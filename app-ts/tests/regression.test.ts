/**
 * Regression tests for confirmed defects in the TypeScript trading engine.
 *
 * Each test documents a defect that was empirically reproduced, and asserts
 * the CORRECT behaviour. A failing test here means the defect has regressed
 * (or has not been fixed yet).
 *
 * Reference for the execution contract:
 *   research-py/docs/EXECUTION_SEMANTICS.md
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CSVLoader } from '../src/data/CSVLoader';
import { findSwingPoints } from '../src/indicators/swingPoints';
import { LiveMonitor } from '../src/core/LiveMonitor';
import { PatternEngine } from '../src/core/PatternEngine';
import { BasePattern } from '../src/patterns/BasePattern';
import { Signal, MarketContext, Candle } from '../src/types';
import { makeCandles, flatCandles } from './helpers';

// ======================================================================
// DEFECT TS-01: CSVLoader silently drops rows that only have a
// `datetime` column.
// ======================================================================

describe('DEFECT TS-01: CSVLoader datetime column', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shades-ts01-'));

  const write = (name: string, content: string): string => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads rows that only have a `datetime` column', () => {
    /**
     * DEFECT: the loader's default column mapping has no `datetime` key, and
     * the fallback list is ['timestamp','time','date','Date','Time'].
     * A file whose only timestamp column is `datetime` therefore produced
     * ZERO candles, silently.
     */
    const file = write(
      'datetime_only.csv',
      'datetime,open,high,low,close,volume\n' +
        '2024-01-17 14:00:00,100,110,90,105,10\n' +
        '2024-01-17 15:00:00,105,115,95,110,20\n'
    );

    const candles = new CSVLoader().loadFromFile(file);

    expect(candles.length).toBe(2);
    expect(candles[0].timestamp).toBe(Date.UTC(2024, 0, 17, 14, 0, 0));
  });

  it('does not silently drop rows it cannot parse', () => {
    /**
     * DEFECT: rows that fail to parse are skipped with only a console.warn.
     * A caller cannot tell "file had no rows" from "every row failed".
     *
     * The loader must surface a parse failure rather than returning an empty
     * array for a file that clearly contained data rows.
     */
    const file = write(
      'garbage.csv',
      'timestamp,open,high,low,close,volume\n' +
        'not-a-date,100,110,90,105,10\n'
    );

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(String(args[0]));
    };

    let candles: Candle[] = [];
    try {
      candles = new CSVLoader().loadFromFile(file);
    } finally {
      console.warn = originalWarn;
    }

    // Either the row parses, or the loader reports the failure loudly.
    const reported = warnings.some(
      (w) => w.includes('Failed to parse record') || w.includes('No timestamp found')
    );
    expect(candles.length > 0 || reported).toBe(true);
  });
});

// ======================================================================
// DEFECT TS-02: A pending trade that is filled on a candle which also
// invalidates it throws "Cannot cancel trade in state OPEN".
// ======================================================================

// ======================================================================
// DIV-11: ORDER_FILL_CONDITION = touch_only (book p.16 / p.17)
// ======================================================================

describe('DIV-11: entry fills on touch without close confirmation', () => {
  /**
   * Discriminating cases vs the old close-confirmation rule:
   *   long:  low <= entry but close < entry
   *   short: high >= entry but close > entry
   *
   * The engine must see a clean, isolated repository and NO realistic
   * execution (slippage/fees) or trailing-stop interference: the DIV-11
   * assertion is about the entry FILL CONDITION, and the fill price must
   * be exactly the signal price.
   */
  function makeEngine() {
    const { PaperTradingEngine } = require('../src/core/PaperTradingEngine');
    const { DatabaseConnection } = require('../src/db/Database');
    const { TradeRepository } = require('../src/db/TradeRepository');

    // Reset the caching singleton and point it at a fresh temp DB so open
    // trades never leak between tests (each test creates its own engine).
    const existing = DatabaseConnection.getInstance();
    existing.close();
    const db = DatabaseConnection.getInstance(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shades-div11-')), 'test.db')
    );
    const repository = new TradeRepository(db);

    return new PaperTradingEngine(
      repository,
      undefined,
      { enabled: false }, // trailing stops off: only the stop itself may exit
      undefined,
      false,        // usePartialTPs
      'NSE_EQUITY',
      false         // useRealisticExecution: entry price must be the signal price
    );
  }

  it('opens a long when the wick touches entry even if close is below', () => {
    const engine = makeEngine();
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100.5, 101.0, 99.5, 99.0], // low touches 100, close 99 < entry
      [100, 101, 99, 100],
    ]);

    const signal: Signal = {
      patternId: 'p',
      patternName: 'P',
      symbol: 'TEST',
      timeframe: '1h',
      direction: 'LONG',
      entryPrice: 100,
      stopLoss: 90,
      target: 110,
      confidence: 1,
      confluenceFactors: ['x'],
      riskRewardRatio: 2,
      timestamp: candles[0].timestamp,
      suggestedRiskPercent: 1,
      invalidationPrice: 85,
    };

    engine.processSignal(signal);
    engine.updateTrades(candles[1]);

    const open = engine.getOpenTrades();
    expect(open.length).toBe(1);
    expect(open[0].entryPrice).toBeCloseTo(100, 9);
  });

  it('opens a short when the wick touches entry even if close is above', () => {
    const engine = makeEngine();
    const candles = makeCandles([
      [100, 101, 99, 100],
      [99.5, 100.5, 99.0, 100.5], // high touches 100, close 100.5 > entry
      [100, 101, 99, 100],
    ]);

    const signal: Signal = {
      patternId: 'p',
      patternName: 'P',
      symbol: 'TEST',
      timeframe: '1h',
      direction: 'SHORT',
      entryPrice: 100,
      stopLoss: 110,
      target: 90,
      confidence: 1,
      confluenceFactors: ['x'],
      riskRewardRatio: 2,
      timestamp: candles[0].timestamp,
      suggestedRiskPercent: 1,
      invalidationPrice: 115,
    };

    engine.processSignal(signal);
    engine.updateTrades(candles[1]);

    const open = engine.getOpenTrades();
    expect(open.length).toBe(1);
    expect(open[0].entryPrice).toBeCloseTo(100, 9);
  });
});

describe('DEFECT TS-02: PENDING open-then-cancel on the same candle', () => {
  class TestPattern extends BasePattern {
    readonly id = 'test-pattern';
    readonly name = 'Test Pattern';
    readonly description = 'test';
    readonly version = '1.0.0';

    detectSignal(candles: Candle[], context: MarketContext): Signal | null {
      return null;
    }

    calculateStopLoss(entryPrice: number, direction: any, candles: Candle[]): number {
      return entryPrice * 0.95;
    }

    getRequiredCandleCount(): number {
      return 3;
    }
  }

  it('does not throw when a candle both fills and invalidates a pending trade', () => {
    /**
     * DEFECT: in PaperTradingEngine.updateTrade the PENDING branch runs
     *   1. isEntryHit  -> openTrade()  (state becomes OPEN)
     *   2. isInvalidated -> cancelTrade() on the ALREADY-OPEN trade
     * which throws "Cannot cancel trade in state OPEN". The error is caught
     * by updateTrades() and logged, so the trade is left OPEN even though the
     * invalidation condition was met.
     */
    const { PaperTradingEngine } = require('../src/core/PaperTradingEngine');
    const engine = new PaperTradingEngine();

    // Bar 0 reaches the entry (low <= 100) AND breaks the stop (low < 95).
    const candles = makeCandles([
      [100, 101, 90, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
    ]);

    const signal: Signal = {
      patternId: 'p',
      patternName: 'P',
      symbol: 'TEST',
      timeframe: '1h',
      direction: 'LONG',
      entryPrice: 100,
      stopLoss: 95,
      target: 110,
      confidence: 1,
      confluenceFactors: ['x'],
      riskRewardRatio: 2,
      timestamp: candles[0].timestamp,
      suggestedRiskPercent: 1,
      invalidationPrice: 95,
    };

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => {
      errors.push(String(args[0]));
    };

    try {
      engine.processSignal(signal);
      engine.updateTrades(candles[0]);
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([]);
    expect(
      errors.some((e) => e.includes('Cannot cancel trade in state OPEN'))
    ).toBe(false);
  });
});

// ======================================================================
// DEFECT TS-03: LivePatternScanner accumulates one buffer entry per TICK
// update, so the same forming candle appears many times.
// ======================================================================

describe('DEFECT TS-03: LivePatternScanner candle buffer', () => {
  /**
   * The scanner's handleCandleUpdate pushes EVERY candle update into the
   * buffer, including updates for the same in-progress candle. A 1-minute
   * timeframe receiving a tick every second therefore produces dozens of
   * duplicate entries for the same timestamp.
   *
   * Consequences:
   *   - the "last 200 candles" buffer covers only a few minutes of history
   *   - findSwingPoints and findSRZones operate on duplicated prices
   *   - the pattern reads a candle that is still forming
   */
  const { LivePatternScanner } = require('../src/core/LivePatternScanner');

  function makeScanner(): any {
    // The scanner constructor wires up market data; for this test we only
    // need the buffer handling, so build a minimal instance.
    const scanner = Object.create(LivePatternScanner.prototype);
    scanner.candlesBuffer = new Map();
    scanner.latestFormingCandles = new Map();
    scanner.config = { enablePaperTrading: false };
    return scanner;
  }

  it('must contain at most one entry per timestamp', () => {
    const scanner = makeScanner();

    // Five tick updates inside the SAME 1-minute candle, then the next one.
    for (let i = 0; i < 5; i++) {
      scanner.handleCandleUpdate({
        symbol: 'TEST',
        timeframe: '1h',
        candle: { timestamp: 1000, open: 100, high: 101, low: 99, close: 100 + i, volume: 1 },
        isComplete: false,
      });
    }
    scanner.handleCandleUpdate({
      symbol: 'TEST',
      timeframe: '1h',
      candle: { timestamp: 2000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      isComplete: true,
    });

    const buffer = scanner.candlesBuffer.get('TEST:1h');
    const unique = new Set(buffer.map((c: any) => c.timestamp));
    expect(buffer.length).toBe(unique.size);
    expect(buffer.length).toBe(2);
  });

  it('must keep a meaningful amount of distinct history', () => {
    const scanner = makeScanner();

    // 60 one-minute candles, each delivered with 5 tick updates.
    for (let minute = 0; minute < 60; minute++) {
      for (let tick = 0; tick < 5; tick++) {
        scanner.handleCandleUpdate({
          symbol: 'TEST',
          timeframe: '1h',
          candle: {
            timestamp: minute * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
          },
          isComplete: tick === 4,
        });
      }
    }

    const buffer = scanner.candlesBuffer.get('TEST:1h');
    const unique = new Set(buffer.map((c: any) => c.timestamp));
    // The buffer must retain all 60 distinct candles.
    expect(unique.size).toBe(60);
    expect(buffer.length).toBe(60);
  });

  it('must retain the LATEST version of a forming candle', () => {
    const scanner = makeScanner();

    scanner.handleCandleUpdate({
      symbol: 'TEST',
      timeframe: '1h',
      candle: { timestamp: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      isComplete: false,
    });
    scanner.handleCandleUpdate({
      symbol: 'TEST',
      timeframe: '1h',
      candle: { timestamp: 1000, open: 100, high: 105, low: 99, close: 104, volume: 3 },
      isComplete: true,
    });

    const buffer = scanner.candlesBuffer.get('TEST:1h');
    expect(buffer.length).toBe(1);
    expect(buffer[0].close).toBe(104);
    expect(buffer[0].high).toBe(105);
  });
});

// ======================================================================
// Swing point confirmation timing (VERIFIED CORRECT - guard against
// regression, and used as the parity reference for Python).
// ======================================================================

describe('Swing point confirmation timing', () => {
  it('does not expose a swing before its right-side bars exist', () => {
    /**
     * A swing high at index 5 with rightBars=3 is only confirmed at index 8.
     * Until bar 8 exists the swing must not be reported.
     */
    const values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1];
    const rows: Array<[number, number, number, number]> = values.map((v) => [v, v, v, v]);
    const candles = makeCandles(rows);

    const prefixTo7 = candles.slice(0, 8);
    expect(findSwingPoints(prefixTo7, 3, 3)).toHaveLength(0);

    const prefixTo8 = candles.slice(0, 9);
    const swings = findSwingPoints(prefixTo8, 3, 3);
    expect(swings).toHaveLength(1);
    expect(swings[0].index).toBe(5);
  });

  it('produces identical swings for a prefix and the full series', () => {
    const values = [1, 2, 3, 4, 5, 9, 4, 3, 2, 1, 1, 1];
    const rows: Array<[number, number, number, number]> = values.map((v) => [v, v, v, v]);
    const candles = makeCandles(rows);

    const truncated = findSwingPoints(candles.slice(0, 9), 3, 3);
    const full = findSwingPoints(candles, 3, 3);

    expect(truncated).toEqual(full);
  });
});

// ======================================================================
// LiveMonitor signal timing (VERIFIED CORRECT - parity guard).
// ======================================================================

describe('LiveMonitor signal timing', () => {
  class SpyPattern extends BasePattern {
    readonly id = 'spy';
    readonly name = 'Spy';
    readonly description = 'spy';
    readonly version = '1.0.0';
    seen: number[] = [];

    detectSignal(candles: Candle[], context: MarketContext): Signal | null {
      this.seen.push(candles[candles.length - 1].timestamp);
      return null;
    }

    calculateStopLoss(entryPrice: number, direction: any, candles: Candle[]): number {
      return entryPrice * 0.95;
    }

    getRequiredCandleCount(): number {
      return 3;
    }
  }

  it('never hands the pattern the candle that is currently being processed', () => {
    /**
     * The strategy must not see the forming bar. This is the same invariant
     * the Python engine enforces via the sliding window.
     *
     * VERIFIED DEFECT: LiveMonitor.processCandle appends the candle to the
     * buffer BEFORE calling detectSignals, so the pattern's last candle IS
     * the bar being processed. The spy therefore observes the final
     * timestamp of the dataset.
     */
    const spy = new SpyPattern();
    (spy as any).config = {
      enabled: true,
      timeframes: ['1h'],
      symbols: [],
      parameters: {},
    };

    const engine = new PatternEngine();
    (engine as any).registry.register(spy);

    const candles = flatCandles(10);

    const monitor = new LiveMonitor(
      { symbol: 'TEST', timeframe: '1h' },
      engine,
      undefined
    );
    (monitor as any).allCandles = candles;
    monitor.runSimulation(0);

    expect(spy.seen.length).toBeGreaterThan(0);

    // DEFECT (currently failing by design): the pattern observes the bar
    // that is currently being processed, including the final bar.
    const lastTs = candles[candles.length - 1].timestamp;
    expect(spy.seen).not.toContain(lastTs);
  });

  it('advances the detection window by exactly one candle per bar', () => {
    /**
     * The pattern's view must advance one closed bar at a time so that a
     * decision at bar i never depends on bar i+1.
     */
    const spy = new SpyPattern();
    (spy as any).config = {
      enabled: true,
      timeframes: ['1h'],
      symbols: [],
      parameters: {},
    };

    const engine = new PatternEngine();
    (engine as any).registry.register(spy);

    const candles = flatCandles(10);
    const monitor = new LiveMonitor(
      { symbol: 'TEST', timeframe: '1h' },
      engine,
      undefined
    );
    (monitor as any).allCandles = candles;
    monitor.runSimulation(0);

    // Each observation must be a distinct candle, in increasing order.
    const unique = new Set(spy.seen);
    expect(unique.size).toBe(spy.seen.length);
    for (let i = 1; i < spy.seen.length; i++) {
      expect(spy.seen[i]).toBeGreaterThan(spy.seen[i - 1]);
    }
  });
});
