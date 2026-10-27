/**
 * Synthetic EXECUTION-parity harness for the TypeScript production engine.
 *
 * WHY THIS EXISTS
 * ===============
 *
 * The trade-parity fixture (`trade_parity_15m.csv`) drives the SHIPPED
 * STRATEGY and therefore only exercises the scenarios the strategy happens
 * to produce. The execution contract in
 * `research-py/docs/EXECUTION_SEMANTICS.md` governs far more: stop-loss
 * exits, gap-aware fills, ambiguous bars spanning both the stop and the
 * target, commission and slippage, and equity-based sizing.
 *
 * This harness drives the REAL `PaperTradingEngine` with CONTROLLED signals
 * so that those mechanics can be compared against the research engine
 * regardless of whether the strategy would have produced a signal.
 *
 * THIS IS A TEST ARTEFACT AND IS NOT EVIDENCE OF ANYTHING ABOUT THE
 * STRATEGY. The signals below are hand-written inputs, not outputs of
 * `ConfluenceZonePattern`.
 *
 * The Python counterpart is `scripts/execution_parity_dump.py`.
 *
 * Usage: npx ts-node src/cli/executionParityDump.ts <out.json>
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PaperTradingEngine } from '../core/PaperTradingEngine';
import { TradeRepository } from '../db/TradeRepository';
import { DatabaseConnection } from '../db/Database';
import { Signal, Candle, Direction } from '../types';

const [outPath] = process.argv.slice(2);

// --- explicit numeric tolerances ------------------------------------
const TOL = {
  price: 1e-9,
  quantity: 1e-6,
  pnl: 1e-6,
  r_multiple: 1e-9,
  equity: 1e-6,
};

// --- execution scenario definitions ---------------------------------
// These MUST stay in lockstep with scripts/execution_parity_dump.py.
interface Scenario {
  id: string;
  description: string;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  barsAfter: Array<[number, number, number, number]>;
  expectExitReason: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'LONG_STOP_LOSS',
    description: 'A long whose stop-loss is reached; the exit must be at the stop.',
    direction: 'LONG',
    entryPrice: 100.0,
    stopLoss: 98.0,
    target: 110.0,
    barsAfter: [
      [100.0, 100.5, 99.5, 100.0],
      [100.0, 100.2, 97.5, 98.0],
    ],
    expectExitReason: 'STOPPED',
  },
  {
    id: 'LONG_TARGET',
    description: 'A long whose target is reached.',
    direction: 'LONG',
    entryPrice: 100.0,
    stopLoss: 98.0,
    target: 102.0,
    barsAfter: [
      [100.0, 100.5, 99.5, 100.0],
      [100.0, 102.5, 99.8, 102.0],
    ],
    expectExitReason: 'TARGET',
  },
  {
    id: 'SHORT_STOP_LOSS',
    description: 'A short whose stop-loss is reached.',
    direction: 'SHORT',
    entryPrice: 100.0,
    stopLoss: 102.0,
    target: 90.0,
    barsAfter: [
      [100.0, 100.5, 99.5, 100.0],
      [100.0, 102.5, 99.8, 102.0],
    ],
    expectExitReason: 'STOPPED',
  },
  {
    id: 'SHORT_TARGET',
    description: 'A short whose target is reached.',
    direction: 'SHORT',
    entryPrice: 100.0,
    stopLoss: 102.0,
    target: 98.0,
    barsAfter: [
      [100.0, 100.5, 99.5, 100.0],
      [100.0, 100.2, 97.5, 98.0],
    ],
    expectExitReason: 'TARGET',
  },
  {
    id: 'LONG_GAP_FILL',
    description:
      'A long order whose next bar gaps BELOW the entry price. The order must ' +
      'fill at the bar OPEN, not at the limit price.',
    direction: 'LONG',
    entryPrice: 100.0,
    stopLoss: 90.0,
    target: 120.0,
    barsAfter: [
      [95.0, 95.5, 94.0, 95.0],
      [95.0, 95.2, 94.5, 95.0],
    ],
    expectExitReason: 'END_OF_DATA',
  },
  {
    id: 'AMBIGUOUS_BAR_STOP_FIRST',
    description:
      'A long whose exit bar spans BOTH the stop and the target. The ' +
      'documented default policy is stop_first, so the stop must win.',
    direction: 'LONG',
    entryPrice: 100.0,
    stopLoss: 98.0,
    target: 102.0,
    barsAfter: [
      [100.0, 100.5, 99.5, 100.0],
      [100.0, 103.0, 97.0, 100.0],
    ],
    expectExitReason: 'STOPPED',
  },
  {
    id: 'SAME_BAR_NO_EXIT',
    description:
      'A long whose entry bar also spans the stop. The position must NOT be ' +
      'exited on the bar it was opened.',
    direction: 'LONG',
    entryPrice: 100.0,
    stopLoss: 99.0,
    target: 120.0,
    barsAfter: [
      [100.0, 100.5, 98.0, 100.0],
      [100.0, 100.2, 99.8, 100.0],
    ],
    expectExitReason: 'END_OF_DATA',
  },
];

const BASE_MS = Date.UTC(2024, 0, 1, 9, 15);
const BAR_MS = 15 * 60 * 1000;

/** Build the bar series for a scenario. */
function buildBars(scenario: Scenario): Candle[] {
  const rows: Array<[number, number, number, number]> = [[100.0, 100.2, 99.8, 100.0]];
  for (const r of scenario.barsAfter) rows.push(r);

  return rows.map(([open, high, low, close], i) => ({
    timestamp: BASE_MS + i * BAR_MS,
    open, high, low, close,
    volume: 1000,
  }));
}

function round(n: number, places = 10): number {
  if (n === null || n === undefined || isNaN(n)) return 0;
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

/** Run one scenario through the production paper-trading engine. */
function runScenario(
  scenario: Scenario,
  costs: { commission: number; slippage: number }
): any {
  const bars = buildBars(scenario);

  // Isolate the database so the harness never touches the real one.
  // `DatabaseConnection` is a caching singleton, so any previously created
  // instance must be closed (which resets the singleton) BEFORE a new path
  // is requested. Without this, every scenario shares one database and
  // trades leak between scenarios.
  const existing = DatabaseConnection.getInstance();
  existing.close();

  const dbPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'shades-exec-parity-')),
    'parity.db'
  );
  const db = DatabaseConnection.getInstance(dbPath);
  const repository = new TradeRepository(db);

  // `useRealisticExecution` enables the production slippage and fee model.
  // The research engine's cost model is structurally different (a flat
  // commission plus a flat slippage, versus the production engine's Indian
  // market fee stack), which is recorded as divergences DIV-03 and DIV-04.
  // The cross-engine comparison is therefore made on the ZERO-COST set; the
  // WITH-COSTS set verifies each engine's own cost behaviour.
  const useRealisticExecution = costs.commission > 0 || costs.slippage > 0;

  const engine = new PaperTradingEngine(
    repository,
    undefined,
    undefined,
    undefined,
    false,          // usePartialTPs
    'NSE_EQUITY',
    useRealisticExecution
  );
  engine.setPartialTPsEnabled(false);

  // The controlled signal is created from the WARM-UP bar, so it becomes
  // actionable on the next bar.
  const signal: Signal = {
    patternId: 'controlled-execution-parity',
    patternName: 'Controlled Execution Parity Signal',
    symbol: 'EXEC_PARITY',
    timeframe: '15m',
    direction: scenario.direction,
    entryPrice: scenario.entryPrice,
    stopLoss: scenario.stopLoss,
    target: scenario.target,
    confidence: 1.0,
    confluenceFactors: ['controlled'],
    riskRewardRatio: 2.0,
    timestamp: bars[0].timestamp,
    suggestedRiskPercent: 1,
    invalidationPrice: scenario.stopLoss,
  };

  // The signal is emitted on the warm-up bar, so it must be processed
  // BEFORE the first `barsAfter` bar is replayed.
  engine.processSignal(signal);

  for (let i = 1; i < bars.length; i++) {
    engine.updateTrades(bars[i]);
  }

  const all = (engine as any).repository.getAll();
  const closed = all.filter(
    (t: any) => t.state === 'CLOSED' || t.state === 'STOPPED'
  );

  if (closed.length === 0) {
    // The trade may not have closed. That is a meaningful outcome, not an
    // error: distinguish a cancelled order (DIV-10 invalidation), an order
    // that never filled (DIV-11 touch not reached), and a filled order that
    // is still OPEN at the end of the bar series (the harness applies no
    // end-of-data close, unlike the Python engine's
    // close_open_positions_at_end).
    const cancelled = all.filter((t: any) => t.state === 'CANCELLED');
    const pending = all.filter((t: any) => t.state === 'PENDING');
    const open = all.filter((t: any) => t.state === 'OPEN' || t.state === 'PARTIAL');

    let outcome = 'no trade produced';
    if (cancelled.length > 0) {
      outcome = 'CANCELLED_BY_INVALIDATION';
    } else if (pending.length > 0) {
      outcome = 'NEVER_FILLED';
    } else if (open.length > 0) {
      outcome = 'STILL_OPEN';
    }

    // When the trade DID fill but is simply still open, report its entry so
    // the parity harness can assert that the fill happened (and at which
    // price) instead of losing the information in nulls.
    const t = open[0] || cancelled[0] || pending[0] || null;

    db.close();

    return {
      id: scenario.id,
      direction: scenario.direction,
      signal_time: new Date(signal.timestamp).toISOString(),
      entry_time: t && t.entryTime ? new Date(t.entryTime).toISOString() : null,
      entry_price: t && t.entryPrice != null ? round(t.entryPrice) : null,
      stop_loss: t && t.initialStopLoss != null
        ? round(t.initialStopLoss)
        : round(scenario.stopLoss),
      target: t && t.target != null ? round(t.target) : round(scenario.target),
      exit_time: null,
      exit_price: null,
      exit_reason: outcome,
      size: t && t.quantity != null ? round(t.quantity, 6) : 0,
      risk_amount: t && t.riskAmount != null ? round(t.riskAmount, 6) : 0,
      gross_pnl: 0,
      net_pnl: 0,
      commission: 0,
      r_multiple: 0,
      expect_exit_reason: scenario.expectExitReason,
      description: scenario.description,
    };
  }

  const t = closed[0];
  const risk = Math.abs(t.entryPrice - t.initialStopLoss);
  const gross = t.direction === 'LONG'
    ? (t.exitPrice - t.entryPrice) * t.quantity
    : (t.entryPrice - t.exitPrice) * t.quantity;

  const result = {
    id: scenario.id,
    direction: t.direction,
    signal_time: new Date(t.signalTime).toISOString(),
    entry_time: t.entryTime ? new Date(t.entryTime).toISOString() : null,
    entry_price: round(t.entryPrice),
    stop_loss: round(t.initialStopLoss),
    target: round(t.target),
    exit_time: t.exitTime ? new Date(t.exitTime).toISOString() : null,
    exit_price: round(t.exitPrice),
    exit_reason: t.state === 'STOPPED' ? 'STOPPED' : 'TARGET',
    size: round(t.quantity, 6),
    risk_amount: round(t.riskAmount, 6),
    gross_pnl: round(gross),
    net_pnl: round(t.pnl ?? gross),
    commission: 0,
    r_multiple: round(risk > 0 ? (t.pnl ?? gross) / (risk * t.quantity) : 0),
    expect_exit_reason: scenario.expectExitReason,
    description: scenario.description,
  };

  // Close the isolated database and reset the singleton so the next
  // scenario starts clean.
  db.close();

  return result;
}

const results: Record<string, any[]> = {};

for (const costSet of [
  { name: 'zero_costs', commission: 0.0, slippage: 0.0 },
  { name: 'with_costs', commission: 0.001, slippage: 0.0005 },
]) {
  results[costSet.name] = SCENARIOS.map((s) => runScenario(s, costSet));
}

const payload = {
  note:
    'Synthetic EXECUTION-parity scenarios. The signals are CONTROLLED test ' +
    'inputs, not outputs of the trading strategy. They validate execution ' +
    'mechanics only and say nothing about the strategy.',
  scenarios: SCENARIOS.map((s) => s.id),
  results,
  tolerances: TOL,
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`wrote ${outPath}`);
for (const name of Object.keys(results)) {
  console.log(`  ${name}: ${results[name].length} scenarios`);
}
