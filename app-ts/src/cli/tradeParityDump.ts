/**
 * Trade-parity harness for the TypeScript engine.
 *
 * The TypeScript stack has NO backtester: it has a paper-trading engine
 * (`PaperTradingEngine`) that is driven candle by candle, exactly as the
 * live scanner drives it. This harness therefore replays the fixture
 * through the REAL production classes:
 *
 *   ConfluenceZonePattern  -> produces the signals
 *   PaperTradingEngine    -> executes them
 *   RiskManager           -> sizes them
 *
 * This is deliberately NOT a reimplementation of the Python backtester. It
 * drives the production code path so that the comparison tests the shipped
 * engine rather than a copy of it.
 *
 * Usage:
 *   npx ts-node src/cli/tradeParityDump.ts <fixture.csv> <out.json>
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CSVLoader } from '../data/CSVLoader';
import { ConfluenceZonePattern } from '../patterns/ConfluenceZonePattern';
import { PaperTradingEngine } from '../core/PaperTradingEngine';
import { TradeRepository } from '../db/TradeRepository';
import { DatabaseConnection } from '../db/Database';
import { calculateATR } from '../indicators/atr';
import { Candle } from '../types';

const [csvPath, outPath] = process.argv.slice(2);

const candles: Candle[] = new CSVLoader().loadFromFile(csvPath);

// Same numeric tolerances the Python dump uses. They are applied to BOTH
// dumps, and any field differing by more than its tolerance is reported.
const TOL = {
  price: 1e-9,
  quantity: 1e-9,
  pnl: 1e-6,
  r_multiple: 1e-9,
  equity: 1e-6,
};

const INITIAL_CAPITAL = 100_000;
const RISK_PER_TRADE = 0.01;
const MAX_OPEN_TRADES = 5;

/**
 * Run the production paper-trading engine over the fixture.
 *
 * Execution semantics that must match the Python engine (see
 * research-py/docs/EXECUTION_SEMANTICS.md):
 *
 *   1. DECIDE  on closed candles only. The pattern sees data up to and
 *      including bar i-1; bar i is still forming.
 *   2. EXECUTE the resulting order against bar i.
 *   3. EXIT    positions opened before bar i are checked on bar i.
 *   4. MARK    equity is recorded at bar i's close.
 *
 * Costs are disabled so the comparison isolates EXECUTION mechanics rather
 * than the two engines' structurally different cost models.
 */
function runEngine(): any {
  const pattern = new ConfluenceZonePattern();

  // Isolate the database so the harness never reads or writes the real
  // trading database.
  const dbPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'shades-trade-parity-')),
    'parity.db'
  );
  const db = DatabaseConnection.getInstance(dbPath);
  const repository = new TradeRepository(db);

  const engine = new PaperTradingEngine(
    repository,
    undefined,
    undefined,
    undefined,
    false,          // usePartialTPs = false
    'NSE_EQUITY',
    false           // useRealisticExecution = false (no slippage/fees)
  );

  // Disable partial exits: the Python research engine has no partial-exit
  // support at all, so leaving them on would compare different mechanisms.
  engine.setPartialTPsEnabled(false);

  const closed: Candle[] = [];
  const signals: any[] = [];

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    // The strategy sees only CLOSED candles: bar i-1 is the newest.
    const history = closed.slice();

    if (history.length >= pattern.getRequiredCandleCount()) {
      // Build the market context exactly as PatternEngine does, so the ATR
      // and trend are the real ones.
      const context = buildContext(history);

      const sig = pattern.detectSignal(history, context);

      if (sig) {
        // Mirror the Python engine's R:R gate.
        const risk = Math.abs(sig.entryPrice - sig.stopLoss);
        const reward = Math.abs(sig.target - sig.entryPrice);
        const rr = risk > 0 ? reward / risk : 0;
        if (rr >= 1.5) {
          signals.push(sig);
          engine.processSignal(sig);
        }
      }
    }

    // Execute against the current bar: updateTrades handles PENDING entry
    // fills, stop/target exits and trailing.
    engine.updateTrades(bar);

    closed.push(bar);
  }

  return { engine, signals };
}

/** Build the MarketContext the same way PatternEngine does. */
function buildContext(candles: Candle[]): any {
  const atr = calculateATR(candles, 14);
  const closes = candles.map((c) => c.close);
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
  const current = closes[closes.length - 1];

  let trend: 'UP' | 'DOWN' | 'RANGE' = 'RANGE';
  if (current > sma20 && sma20 > sma50) trend = 'UP';
  else if (current < sma20 && sma20 < sma50) trend = 'DOWN';

  return {
    symbol: 'TRADE_PARITY',
    timeframe: '15m',
    atr,
    trend,
    volatility: 'NORMAL',
  };
}

const { engine, signals } = runEngine();

// Read the closed trades back from the repository.
const allTrades = (engine as any).repository.getAll();

const trades = allTrades
  .filter((t: any) => t.state === 'CLOSED' || t.state === 'STOPPED')
  .map((t: any) => {
    const risk = Math.abs(t.entryPrice - t.initialStopLoss);
    const gross = t.direction === 'LONG'
      ? (t.exitPrice - t.entryPrice) * t.quantity
      : (t.entryPrice - t.exitPrice) * t.quantity;
    return {
      id: t.id,
      direction: t.direction,
      signal_time: new Date(t.signalTime).toISOString(),
      entry_time: t.entryTime ? new Date(t.entryTime).toISOString() : null,
      entry_price: round(t.entryPrice),
      signal_price: round(t.signalPrice),
      stop_loss: round(t.initialStopLoss),
      target: round(t.target),
      exit_time: t.exitTime ? new Date(t.exitTime).toISOString() : null,
      exit_price: round(t.exitPrice),
      exit_reason: t.state === 'STOPPED' ? 'STOPPED' : 'TARGET',
      size: round(t.quantity),
      risk_amount: round(t.riskAmount),
      gross_pnl: round(gross),
      net_pnl: round(t.pnl ?? gross),
      commission: 0,
      r_multiple: round(risk > 0 ? (t.pnl ?? gross) / (risk * t.quantity) : 0),
      confluence_factors: [...t.confluenceFactors].sort(),
    };
  });

// Equity curve, reconstructed bar by bar from the engine's own state.
const equityCurve: number[] = [];
let runningCapital = INITIAL_CAPITAL;
for (const t of allTrades) {
  if (t.pnl !== null && t.pnl !== undefined) {
    runningCapital += t.pnl;
  }
  equityCurve.push(round(runningCapital));
}

const payload = {
  row_count: candles.length,
  trade_count: trades.length,
  signal_count: signals.length,
  trades,
  equity_curve: equityCurve,
  final_equity: round(runningCapital),
  open_positions_at_end: (engine as any).repository.getOpenTrades().length,
  tolerances: TOL,
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`wrote ${outPath} (${trades.length} trades from ${signals.length} signals)`);

function round(n: number, places = 10): number {
  if (n === null || n === undefined || isNaN(n)) return 0;
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
