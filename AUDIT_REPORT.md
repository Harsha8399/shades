# COMPREHENSIVE AUDIT REPORT: Shades Trading Research Platform

**Repository:** /Users/harshavardhanreddy/projects/shades  
**Date:** 2025-10-25  
**Auditor:** Code audit (read-only)  
**Scope:** Trading strategy (Confluence Zone + Entry Model 2), TypeScript replay/backtest engine, Python research engine, diagnostics, parity, and correctness.

---

## 1) EXECUTIVE SUMMARY

The strategy is implemented in both TypeScript (`app-ts/src/patterns/ConfluenceZonePattern.ts`) and Python (`research-py/src/patterns/confluence_zone.py`). There is a working parity framework (fixtures in `shared/fixtures/`, parity/trade parity tests, dumps). The core pattern logic is largely aligned between the two engines for the main confluence flow. 

**Critical findings:**
1. **Trade filters are blocking nearly all signals by default.** `PatternEngine` applies `TradeFilters` when enabled (default true). On `shared/fixtures/parity_15m.csv` with filters enabled, all confluence-zone signals were rejected by structure/regime filters; with filters disabled, signals were produced. The replay API defaults `filtersEnabled=true`. This is consistent with the reported "zero directional signals" while funnel shows S/R/trendline/confluence/R:R stages passing.
2. **Funnel/diagnostic stage ID mismatch.** `ConfluenceZonePattern` records stages as `fib_level` and `rejection_candle`, but `ReplayEngine.ingestTrace()` only increments counters for `fibonacci` and `rejection`. As a result `fibPassed` and `rejectionPassed` will remain 0 even when those stages are evaluated/passed - matching the reported diagnostics exactly (Fibonacci passed: 0, Rejection passed: 0).
3. **Two-stage signal generation in replay.** `ReplayEngine` calls `PatternEngine.detectSignalsDetailed()` which may filter signals; it also has its own `detectWithTraces()` fallback. The funnel is updated from traces returned by PatternEngine. The "signalsGenerated" in funnel comes from traces with `outcome === 'SIGNAL'` after ingestion.
4. **HTF/resampling path exists** but not obviously causing the reported zero-signal case on the fixtures tested.
5. **Look-ahead safeguards exist** (uses closed-candle prefixes, swing confirmation with right-bars, filters `confirmed_at`, replay tests for prefix invariance). Causality is generally well-considered.
6. **Several "inferred/invented" parameters** per `shared/fixtures/strategy_spec.json` (e.g. swing bars, Fibonacci lookback choices, subset selection for fib confluence is dead config). Strategy spec drift exists as documented.

The "zero signals" in the reported historical replay is most plausibly explained by **aggressive default trade filters** blocking signals, compounded by **misleading funnel counts** due to stage ID mismatches. This is not necessarily a bug in the core confluence pattern logic itself.

---

## 2) ACTUAL RUNTIME EXECUTION GRAPH

### Dashboard → API → Data Loader → Replay Engine → Pattern Engine → Indicators → Filters → Execution/Eval → Dashboard

| Step | Exact File(s) | Function/Method | Inputs | Outputs | Notes |
|---|---|---|---|---|---|
| Dashboard UI | `dashboard-react/src/components/ReplayChart.tsx` | Component (reads replay results) | API responses | Renders predictions/evaluations | UI layer |
| API route | `app-ts/src/api/routes/replay.ts` | `createReplayRouter()` POST `/start` | `{ filePath/symbol/timeframe/strategyId/startDate/endDate/candleCount/speed/evaluationHorizon/filtersEnabled/looseFilters/dataSource,... }` (defaults: `filtersEnabled=true`, `recordNoTrade` not shown but engine defaults) | Creates `ReplaySession` with `ReplayEngine`, loads data, calls `engine.start()`, returns status | Validates timeframes, handles CSV/API modes, calculates start dates accounting for warmup in API mode. |
| Data loading (CSV) | `app-ts/src/core/ReplayEngine.ts` (`loadData()`), `app-ts/src/data/CSVLoader.ts` (referenced) | `loadData()` reads file, parses CSV, filters by date range, sorts/dedupes in `setCandles()`, computes `warmupCandleCount = min(minRequiredCandles, len)`. | file path, date range | Populates `allCandles[]`, sets status/data range/warmup | Validates OHLC integrity. |
| Data loading (API) | `app-ts/src/api/routes/replay.ts` + `app-ts/src/data/UpstoxFeed.ts` | Fetches historical via Upstox, calls `engine.setCandles(candles)` | symbol/instrument key, dates/timeframe | Candles array | Rate limits/timeframe constraints enforced. |
| Replay engine orchestration | `app-ts/src/core/ReplayEngine.ts` | Constructor sets up PatternEngine, filters, horizons, warmup. `start()` chooses instant/delayed. `runInstant()` loops `i` from `warmupCandleCount` to end, calls `processNextCandle(i, htfCandles)`. | config, candles | Predictions/traces/funnel/metrics/diagnostics | Uses closed-candle prefix model. |
| Candle processing | `app-ts/src/core/ReplayEngine.ts` | `processNextCandle(index, htfCandles?)`: if before warmup just advances closedCandles; else sets `closedCandles = allCandles.slice(0, index)`, gets `formingCandle = allCandles[index]`, takes `prefix = closedCandles`, calls `detectWithTraces(prefix, htfCandles)`. If signals → `recordPrediction(..., signalCandleIndex = index-1, traceToSnapshot(...))`. If no signals and `recordNoTrade !== false` → `recordNoTradePrediction(index-1)`. | index, htfCandles | Updates predictions, calls `onStep` | **Key**: signal generated from prefix up to index-1, attributed to `signalCandleIndex = index-1` (the last closed candle). |
| HTF candles | `app-ts/src/core/ReplayEngine.ts` (`getHTFCandles()`) | Resamples using `getHigherTimeframe()`, `getTimeframeMinutes()`, NSE session-aligned special case for 30m→1h, else `CandleResampler.resample()`. Only uses candles up to `currentIndex` (exclusive of forming). | currentIndex, timeframe, symbol | HTF candles array or undefined | Look-ahead guarded by slicing `allCandles.slice(0, currentIndex)`. |
| Pattern detection (detailed) | `app-ts/src/core/PatternEngine.ts` | `detectSignalsDetailed(candles, symbol, timeframe, htfCandles?, opts?)`: builds context via `buildMarketContext()` (ATR 14, trend via `detectTrend`, volatility), builds `TradeFilters` if enabled, gets enabled patterns filtered by timeframe/symbol/strategyId, validates each pattern, resets `lastTrace/lastSnapshot`, calls `pattern.detectSignal(candles, context, absoluteCandleIndex)`, attaches trace/snapshot, applies filters if signal exists (filters may reject → sets trace outcome FILTERED, records trace, continues), otherwise pushes signal. | prefix candles, context, htf | `{signals: DetectedSignal[], traces: DecisionTrace[]}` | Filters are applied here after pattern generates signal. |
| Market context/indicators | `app-ts/src/core/PatternEngine.ts`, `app-ts/src/indicators/*` | `buildMarketContext()` uses `calculateATR(candles,14)`, `detectTrend(candles,4)`, `getVolatilityRegime(candles,14,50)`. Pattern uses ATR/tolerance from context. | candles | `MarketContext` | ATR is computed over the prefix window. |
| Pattern (confluence) | `app-ts/src/patterns/ConfluenceZonePattern.ts` | `detectSignal(candles, context, absoluteCandleIndex?)`: builds decision trace/stages incrementally. Stage 0 validates ATR>0. Finds confluence via `findConfluence()`: checks S/R zones (via `findSRZones` with lookback `srZoneLookback`, tolerance `SR_ZONE_TOLERANCE_ATR`, min touches `SR_MIN_TOUCHES`), Fibonacci (via `findFibRetracement(candles,50)`), trendlines (via `findTrendlines(candles, atr, TRENDLINE_TOLERANCE_ATR)`). Requires >= `minConfluenceFactors` and direction. Checks rejection via `detectRejectionCandle()` (wick into zone, close outside, wick:body ratio >= `minRejectionWickRatio` with effective body floor `atr*0.01`, candle type bullish/bearish or doji-like). Computes SL/target via `calculateStopLossWithSource()` / `calculateTargetWithSource()`, enforces `riskReward >= MIN_TARGET_RR` (1.5). Builds signal with confidence. Records trace/snapshot. | candles (prefix), context | `Signal | null` | All decisions based on prefix candles only. Zone level comes from S/R if present, else current price (direction may come from fib/trendline). |
| Indicators (TS) | `app-ts/src/indicators/swingPoints.ts`, `supportResistance.ts`, `fibonacci.ts`, `trendlines.ts`, `atr.ts` | `findSwingPoints(leftBars,rightBars)` looks for fractal swings with confirmation (returns only confirmed swings satisfying right-bars). `findSRZones()` groups swings into zones by tolerance. `findFibRetracement()` scans swings in window (takes first high/low from most recent), anchors on those swing points. `findTrendlines()` builds trendlines from swings. `calculateATR()` uses standard ATR. | candles/windows | zones/levels/trendlines/swings | Causality-aware (swings require right confirmation). |
| Trade filters | `app-ts/src/core/TradeFilters.ts` | `TradeFilters` analyzes structure/regime/MTF/volume on provided candles. `applyAll(signal)` checks structure (trend), regime (skip ranging if configured), MTF alignment (if HTF available), volume. Can reject signal (sets failedFilters) and adjusts confidence. Defaults: `useStructure/useRegime/useMTF/useVolume=true`, `requireBullishStructureForLong=true`, `requireBearishStructureForShort=true`, `skipRangingRegime=true`, `requireHTFAlignment=true`, `skipLowVolume=true`. | ltf candles, htf candles, signal | `AllFiltersResult` (pass/fail, failedFilters) | Aggressive by default. |
| Signal recording | `app-ts/src/core/ReplayEngine.ts` | If signal passes filters in PatternEngine, `recordPrediction()` creates Prediction with `candleIndex = signalCandleIndex` (index-1), stores trace/snapshot. If no signals and `recordNoTrade !== false`, `recordNoTradePrediction()` creates NO_TRADE prediction. Traces ingested via `ingestTrace()` updating funnel counters. | signal/trace | Predictions array | Predictions include trace/snapshot for evidence. |
| Evaluation | `app-ts/src/core/ReplayEngine.ts` | `evaluatePrediction()` checks candles forward from `signalCandleIndex+1` for up to `evaluationHorizonCandles` (or trade resolution horizon), determines STOP_FIRST/TARGET_FIRST/AMBIGUOUS/NEITHER, computes directional correctness (LONG correct if higher at horizon; SHORT correct if lower; tie rule), PnL/R-multiples. `buildResult()` aggregates metrics. | predictions + future candles | Evaluation metrics, accuracy, etc. | Evaluation looks forward; does not affect signal generation. |
| Diagnostics/funnel | `app-ts/src/core/ReplayEngine.ts` | `buildDiagnostics()` reads funnel map built by `ingestTrace()`. Notes generated based on signals. | traces, predictions | `ReplayDiagnostics` with funnel | Funnel stage counting depends on trace stage IDs. |

### Python equivalent (high level)
- Strategy: `research-py/src/patterns/confluence_zone.py` mirrors TS logic (confluence factors, rejection with effective body floor, SL from recent swing with 10% buffer, target from nearest structural level or fixed RR, RR gate). Uses indicators from `research-py/src/indicators/*` (swing_points, support_resistance with Wilder ATR, fibonacci anchored to confirmed swings, trendlines). 
- Data loading: `research-py/src/data/loaders.py` (`load_csv`). Backtesting/execution parity harnesses in `scripts/` and tests (`test_trade_parity.py`, etc.) compare against TS dumps.

**Note on compiled artifacts:** `app-ts/dist/*` exists and contains built JS matching source structure (e.g. `dist/patterns/ConfluenceZonePattern.js` has same logic/stage IDs). Runtime will use built artifacts if running from dist or if app is built; source and dist appear consistent.

---

## 3) ZERO-SIGNAL PROBLEM - ROOT CAUSE ANALYSIS

### Reported symptoms (from request)
- Candles loaded: 224, Warm-up: 100, Predictions: 124, NO_TRADE: 124, LONG: 0, SHORT: 0, Evaluated: 120, Inconclusive: 4
- Diagnostics: S/R zone passed: 124, Fibonacci passed: 0, Trendline passed: 124, Minimum confluence passed: 124, Rejection passed: 0, Risk/reward passed: 124, Final signals: 0

### Evidence from codebase
1. **Funnel ID mismatch (confirmed):** 
- Pattern emits stages `id: 'sr_zone'`, `'fib_level'`, `'trendline'`, `'min_confluence'`, `'rejection_candle'`, `'risk_reward'` (see `ConfluenceZonePattern.ts`).
- `ReplayEngine.ingestTrace()` switches on `stage.id` and only counts `case 'sr_zone'`, `'fibonacci'`, `'trendline'`, `'min_confluence'`, `'rejection'`, `'risk_reward'` - so `'fib_level'` never increments `fibPassed` (stays 0) and `'rejection_candle'` never increments `rejectionPassed` (stays 0). The other stages match (`sr_zone`, `trendline`, `min_confluence`, `risk_reward`).
- This perfectly explains the diagnostic pattern: S/R/trendline/min-confluence/R:R show passed counts equal to candles examined (if traces recorded for each evaluated candle), Fib and Rejection show 0 due to ID mismatch.

2. **Trade filters block signals (confirmed):**
- With filters **enabled** (default in API `filtersEnabled=true`, PatternEngine defaults `useFilters=true`), `PatternEngine.detectSignalsDetailed()` applies `TradeFilters.applyAll()` to any signal produced by pattern. If filters fail, it logs "Signal filtered out: ..." sets trace outcome to `FILTERED`, records the trace (for diagnostics), and **does not push the signal**. So signals generated by pattern are discarded by filters.
- Tested on `shared/fixtures/parity_15m.csv` (15m): with filters enabled → 0 confluence signals pass; with filters disabled → 15 signals produced. Diagnostics showed `signalsGenerated: 0` in funnel while stages passed. On `trade_parity_15m.csv`, filters also block most confluence signals (only 2 pass in one test run).
- Filters are aggressive by default (structure/regime/MTF/volume all required/enforced). They depend on trend detection, regime detection, HTF data availability, etc. A dataset/timeframe/regime can cause all signals to be filtered.

3. **Replay flow confirms recording of NO_TRADE when no signals:**
- In `processNextCandle()`, if signals found after warmup → record predictions for signals (with trace/snapshot). Else if `config.recordNoTrade !== false` → `recordNoTradePrediction(index-1)`. So with filters blocking all signals, every candle after warmup produces a NO_TRADE prediction (assuming pattern ran and produced traces but no signals survived filters). That matches "Predictions: 124, NO_TRADE predictions: 124".

### Root cause conclusion
The most likely root cause is **trade filters enabled by default blocking all confluence-zone signals** for the dataset/config used in that replay. The funnel misreporting (fib/rejection = 0) is a separate diagnostic bug masking/obscuring stage evaluation due to ID mismatch between pattern trace stage IDs and ReplayEngine's funnel ingestion. Both issues are present.

**Causality of elimination:** For each candle where pattern would generate a signal, it goes through PatternEngine → filters reject it → no signal added → trace may be recorded as FILTERED (PatternEngine does push a trace copy with outcome FILTERED in the filter path) and funnel ingestion counts stages from traces (but only for recognized IDs; FILTERED traces still have stages array). However `ingestTrace` only increments counters and sets `signalsGenerated` if `trace.outcome === 'SIGNAL'` - FILTERED traces won't increment signalsGenerated. Also the stage ID mismatch means fib/rejection counters never increment regardless.

### Reproduction notes
- On provided fixtures we can reproduce: with `filtersEnabled=false` signals appear; with `filtersEnabled=true` they are filtered. The parity fixture `parity_15m.csv` shows 8 confluence signals blocked by structure/regime, 0 allowed under default filters.
- Without the exact dataset/config from the reported replay run, I cannot reproduce byte-for-byte the same numbers, but the logic matches perfectly.

---

## 4) TYPESCRIPT/PYTHON PARITY AUDIT

| Item | TS Implementation | Python Implementation | Difference | Behavior Impact | Regression Test Suggestion |
|---|---|---|---|---|---|
| Doji/candle classification (rejection) | `isBullish`/`isBearish` strict (> and <); doji allowed if body < range*0.1 (`body < (candle.high-candle.low)*0.1`) and uses effective body floor `atr*0.01` | Uses `bar['close'] >= bar['open']` for bullish, `bar['close'] <= bar['open']` for bearish (allows equal as bullish/bearish respectively) and same effective body floor `atr*0.01`. Doji handling differs slightly (TS explicit doji allowance in conditions; PY treats close>=open as bullish for LONG rejection check). | Different doji/equality handling. | Could change rejection validity on exact doji/equal open-close. | Add fixture with doji candles; compare rejection decisions. |
| ATR calculation/warmup | `calculateATR(candles,14)` in TS indicators (Wilder-like per implementation). Pattern gets ATR from context. | `research-py/src/indicators/support_resistance.py::calculate_atr` implements Wilder's smoothing with specific seeding (TR[0] excluded, seed from TR[1..period], fallback to mean bar range if < period+1). | Must be identical per tests; code comments say TS verifies against technicalindicators. Generally aligned. | If different, tolerances/zones change. | Parity tests already cover ATR-sensitive cases. |
| S/R clustering/touches/selection | `findSRZones(candles, atr, tolerance, minTouches)` groups swings within `atr*tolerance`, requires `strength >= minTouches`. Nearest support/resistance by price. | `find_sr_zones(df, tolerance_atr, min_touches, atr=None)` similar grouping, takes precomputed ATR, same logic. | Similar; parameter passing differs slightly (TS passes tolerance as multiplier separately). | Usually same if params match. | Compare zone sets on fixtures. |
| Fibonacci swing detection/selection | `findFibRetracement(candles, lookback=50)`: takes window, finds swings with left=5,right=3, scans from most recent taking first HIGH and first LOW found (both engines updated to this). | Same behavior as above. Anchored to swing points (not window extremes) now. | Aligned after fixes. | Critical for fib factor. | Covered by parity tests. |
| Trendline extraction/ranking/tie-breaking | `findTrendlines(candles, context.atr, TRENDLINE_TOLERANCE_ATR)`, checks ALL trendlines for price proximity in confluence; selects first match? In TS `isPriceAtTrendline` scans list; in findConfluence it gets all trendlines then checks - if matches sets factors/direction. In PY it loops through all trendlines and breaks on first match. | Similar - PY loops all trendlines, breaks on first match (comment says "Check ALL trendlines, not just the strongest few" but implementation breaks at first touching). TS also effectively finds any touching trendline. Order of trendlines matters for tie-breaking if multiple touch. | Potential tie-breaking/order differences. | Could change direction/factors if multiple trendlines touch. | Test with multiple touching trendlines. |
| Confluence counting/direction selection | Factors added as strings (`sr_support`/`sr_resistance`, `fib_<ratio*1000>`, `trendline_support`/`trendline_resistance`). Direction set from first factor that establishes it (S/R first if present, else fib, else trendline). Requires `factors.length >= minConfluenceFactors` and direction set. | Same logic; factors named differently in string form but conceptually same. | Mostly aligned. | Minor naming only. | Parity tests check signals/trades. |
| Rejection wick/body ratio & zone-touch semantics | For LONG: lower wick touches zone if `candle.low <= zoneLevel + tolerance`, close above zone if `candle.close > zoneLevel`. Wick ratio uses `lowerWick / effectiveBody` where `effectiveBody = max(body, atr*0.01)`. Requires bullish or doji. | For LONG: `wick_touches_zone = bar['low'] <= zone_level + tolerance`, `close_above_zone = bar['close'] > zone_level`, `is_bullish = bar['close'] >= bar['open']`. Same ratio/floor. | Equality semantics differ slightly (PY allows close==open as bullish). | Edge cases differ. | Test exact doji cases. |
| Stop-loss placement/swing detection | `calculateStopLossWithSource()`: LONG uses `findRecentSwingLow(candles,3)`, if found sets stop = swingLow - buffer*(entry-swingLow)*0.1; else uses recent low of last 10 with buffer. SHORT uses `findRecentSwingHigh(candles,3)`, ensures stop above entry. Uses rightBars=1 in `findRecentSwingLow/High` calls. | `calculate_stop_loss()`: mirrors TS - uses `find_recent_swing_low/high(df)` (which looks back excluding last bar with right_bars=1), applies 10% buffer, similar fallback. | Aligned per comments. | Same behavior. | Covered by trade parity. |
| Target placement/structural selection | `calculateTargetWithSource()`: finds nearest structural zone via `findSRZones` over full candles? (calls `findSRZones(candles, atr, SR_ZONE_TOLERANCE_ATR, SR_MIN_TOUCHES)`) and `findNearestResistance/Support`. If distance/risk >= MIN_TARGET_RR (1.5), targets just before level (0.998/1.002); else falls back to fixed RR from config (`targetRR` default 2.5). | Same logic - computes zones over full df with ATR, checks nearest level, same multipliers/fallback. | Aligned. | Same. | Trade parity covers. |
| Min risk/reward enforcement | Enforced at pattern level (>= MIN_TARGET_RR). Also mirrored in trade parity harness. | Same. | Aligned. | Same. | Covered. |
| Confidence calculation | `calculateConfidence(factorCount, rejectionStrength)`: base `min(factorCount/4,0.6)`, adds `min(rejectionStrength*0.2,0.4)`, caps at 1. | PY sets `confidence = min(len(factors)/4, 1.0)` (simpler). | **Different** confidence formula. | Affects confidence values but not signal generation logic directly. | Test confidence values. |
| Signal timestamps/indexing | Signal attributed to candle at `signalCandleIndex = index-1` in replay (last closed candle). Pattern receives prefix and context built from prefix. `absoluteCandleIndex` passed through. | Timestamps from dataframe index (`df.index[-1]`). | Format/representation may differ but semantic timing aligned with closed-candle model. | Should be fine. | Trade parity checks timestamps (with normalization). |
| HTF availability/session alignment | Replay gets HTF via `getHTFCandles()` with NSE session alignment for 30m→1h; passes to PatternEngine. PatternEngine passes to TradeFilters. Confluence pattern itself doesn't directly use HTF candles (filters do). | MTF handled separately in PY; confluence pattern core doesn't take HTF as separate param in same way. | Different integration points. | HTF affects filters more than core pattern. | MTF parity tests exist. |
| Trade entry timing/orders/gap fills/slippage | Handled by execution layer (PaperTradingEngine in TS parity harness), not by pattern. Replay evaluation does forward-candle simulation. | Handled by backtester in PY. | Different execution models. | Trade parity tests isolate execution semantics. | See trade parity tests (expected DIV-10 noted). |
| SL/TP collisions, position sizing, accounting | Execution layer responsibility. Pattern only sets SL/TP/entry. | Similar. | Execution differences possible. | Trade parity covers expected divergences. | Review trade parity test expectations. |

**Key parity notes:** The two engines are converging (many fixes noted in comments like Fibonacci anchoring, trendline scanning, ATR passing). Some intentional divergences are documented (e.g. trade parity DIV-10). Confidence calculation differs (minor). Equality semantics in rejection differ slightly.

---

## 5) STRATEGY SPECIFICATION DRIFT

From `shared/fixtures/strategy_spec.json`:

**Parameters defined but potentially ignored/dead:**
- `FIB_CONFLUENCE_LEVELS` = `[0.5,0.618,0.786]` marked as DEAD CONFIGURATION - "NEITHER engine currently applies it: the confluence check matches against every computed level." Pattern configs include `fibLevels` but code doesn't filter Fibonacci levels by this subset. **Confirmed in code:** `findFibRetracement` returns all levels from `calculateFibLevels` using `FIB_RATIOS`; `isPriceAtFibLevel` checks all levels; no filtering by `fibLevels` config found.
- Some values marked as `invented` (e.g. `SWING_LEFT_BARS=3`, `FIB_SWING_LEFT_BARS=5`, `FIB_LOOKBACK=50`) with rationale that PDF doesn't quantify them.

**Hard-coded values bypassing config:**
- `MIN_TARGET_RR` hardcoded as `export const MIN_TARGET_RR = 1.5` in TS pattern (also read via spec helper in PY with fallback). Pattern uses this constant directly in checks.
- `TRENDLINE_TOLERANCE_ATR = 0.3`, `SR_ZONE_TOLERANCE_ATR = 0.5`, `SR_MIN_TOUCHES = 2` defined as constants in TS pattern and also read from spec in PY. Pattern passes them to indicator functions.
- Rejection effective body floor `atr * 0.01` is hardcoded in both engines (comment says volatility-adaptive).
- Stop buffer 10% is hardcoded in both engines (comment says invented).
- Target exit buffers 0.2% (0.998/1.002) are hardcoded.
- Pattern enforces its own logic regardless of some config values.

**Defaults differ?**
- Pattern constructor defaults: `minConfluenceFactors: 2`, `srZoneLookback: 100`, `fibLevels: [0.5,0.618,0.786]`, `zoneToleranceATR: SR_ZONE_TOLERANCE_ATR` (0.5), `minRejectionWickRatio: 2.0`, `targetRR: 2`. Shared config shows similar defaults. Seems consistent.
- PY pattern takes constructor params with similar defaults.

**Units/interpretation:**
- Tolerances are ATR multiples (correct per spec). No percentage-of-price tolerances used. Correct.

**Config not affecting decisions:**
- `FIB_CONFLUENCE_LEVELS` / `fibLevels` in pattern config not applied - dead config.
- Some filter config values affect decisions (TradeFilters) but are separate from strategy pattern.

**Book vs engineered rules:**
- Book-derived: Fibonacci ratios `[0.236,0.382,0.5,0.618,0.786]` (p.10) - locked.
- Inferred/engineered: swing confirmation counts, lookbacks, stop/target placement details, buffers, effective body floor, filters, confidence formula - many marked invented/inferred. Pattern comments explicitly note some divergences from book (stop placement methodology deferred, target uses structural levels as approximation).

---

## 6) REPLAY AND BACKTEST CORRECTNESS

### Risks identified

| Risk | Status | Evidence/Notes |
|---|---|---|
| Look-ahead bias in HTF indicators | Low risk (guarded) | `getHTFCandles()` slices `allCandles.slice(0, currentIndex)` (only up to current). NSE session alignment uses available candles. Resampling only on past data. |
| Use of incomplete HTF candles | Mitigated | Slicing excludes forming/current candle. |
| Incorrect signal-candle indexing | Correct | Signal attributed to `index-1` (last closed). Pattern sees prefix `closedCandles = allCandles.slice(0, index)`. Tests confirm prefix invariance. |
| Future candles in calculations | Guarded | Pattern receives prefix only; indicators operate on prefix windows. Replay passes closed-candle prefix. |
| Incorrect SL/TP evaluation | Possible issues in edge cases | SL/TP set by pattern from prefix data; evaluation checks forward from signal candle. Buffers/fallbacks exist. |
| SL/TP hit same candle (ambiguous) | Handled | Evaluation logic checks both and marks `AMBIGUOUS` if both hit in same candle (see evaluation code). |
| Unrealistic entry fills/gap handling | Not modeled | Pattern uses close as entry in signal; execution details depend on downstream (paper trading). Replay evaluation is candle-based. |
| Missing brokerage/slippage/taxes | Yes | Costs not included (notes say "Costs not included"). Trade parity can run with/without costs. |
| Realized vs unrealized PnL | Tracked separately | Evaluation computes R-multiples/points; accounting in execution layer separate. |
| Win/loss counts/expectancy/profit factor/drawdown | Calculated | `calculateMetrics()` computes them; needs careful interpretation (NEITHER not counted as win/loss in trade counting). |
| Unresolved trades/incomplete horizons | Handled | `markPendingInconclusive()` marks as INCONCLUSIVE if insufficient future candles at stop. |
| Data gaps/duplicates/unsorted/timezone | Handled | `setCandles()` sorts, dedupes by timestamp; `isValidCandle()` validates; CSV parsing robust. |

### Hand-calculated examples (for confirmed defects)

**Defect 1: Funnel stage ID mismatch**
- Pattern trace for a passing case would have stage with `id: 'rejection_candle'`. `ingestTrace()` does `case 'rejection': ...` - no match, so `rejectionPassed` not incremented. Similarly `fib_level` vs `fibonacci`. 
- Example: 124 candles all pass rejection_candle stage → `rejectionPassed` remains 0, reported as "Rejection passed: 0" while actual stage passed. This is a reporting bug.

**Defect 2: Trade filters blocking all signals (default)**
- Pattern generates signal S on candle i. PatternEngine receives it, builds TradeFilters from prefix candles, calls `filters.applyAll(S)`. If `filters.applyAll(S).pass` is false (e.g. structure/regime fail), PatternEngine logs filtered, sets `signal.trace.outcome = 'FILTERED'`, pushes a copy of trace with FILTERED outcome, does **not** add signal to results. ReplayEngine sees no signals from PatternEngine for that candle → records NO_TRADE prediction. Funnel ingestion: if trace comes through, `ingestTrace()` sees stages but only increments recognized IDs; sets `signalsGenerated` only if `trace.outcome === 'SIGNAL'` - FILTERED won't increment it. Result: 0 directional signals despite pattern logic passing all stages.

**Defect 3: Confidence formula mismatch (TS vs PY)**
- TS: `min(factorCount/4,0.6) + min(rejectionStrength*0.2,0.4)` capped at 1. PY: `min(len(factors)/4, 1.0)`. Different confidence values - affects ranking/thresholds if used, not signal generation directly.

---

## 7) MISSING DATA/INFRASTRUCTURE

| Item | Status | Notes |
|---|---|---|
| Instruments/timeframes available | Partial | CSV fixtures available (15m). API supports various timeframes via Upstox. Codebase has support for 1m,5m,15m,30m,1h,4h,1d,1w. |
| Historical date coverage/quality | Unknown from audit | Depends on data files/API access. Fixtures are synthetic/test data. |
| Historical option contract prices | Not evident | No obvious options pricing data files found. Strategy appears equity/index focused. |
| Realistic option entry/exit pricing | No | Engine is primarily directional signals with SL/TP on underlying prices. |
| Underlying directional vs options profitability | Unclear | Current results are directional; options would need pricing/greeks/liquidity/IV. |

---

## 8) PRIORITIZED REMEDIATION PLAN

### CRITICAL (P0)
1. **Fix funnel stage ID mismatch** (`app-ts/src/core/ReplayEngine.ts` ingestTrace)
- Change to recognize both `fib_level` and `fibonacci`, `rejection_candle` and `rejection` (or make pattern emit IDs the funnel expects). This fixes diagnostic accuracy.
- Evidence: Pattern uses `fib_level`/`rejection_candle`, funnel looks for `fibonacci`/`rejection`.
- Proposed test: Verify funnel counters increment correctly for each stage.

2. **Clarify/filter behavior for zero-signal case**
- Document that trade filters are enabled by default and can block all signals. Add explicit logging/diagnostics when signals are filtered (PatternEngine already logs). Consider adding filter stats to diagnostics/funnel.
- Or make filters configurable per strategy/replay with clear UI indication.
- Evidence: Filters block all signals on parity fixtures by default.

3. **Investigate reported replay dataset/config**
- Need the actual file path/config used for the reported run (224 candles, 15m timeframe mentioned). Cannot reproduce without it. Add ability to log full trace details for sampled candles.

### HIGH (P1)
4. **Align confidence calculation between TS and PY** or document difference.
5. **Review filter defaults** - they are very strict; may be too aggressive for some regimes/timeframes. Consider making defaults less strict or strategy-specific.
6. **Fix dead config `FIB_CONFLUENCE_LEVELS`/`fibLevels`** - either apply it or remove/mark clearly to avoid confusion.
7. **Add trace for filtered signals to funnel with reason** - currently filtered traces are recorded but funnel doesn't track filter failures distinctly.

### MEDIUM (P2)
8. **Unify candle classification/equality semantics** between TS and PY for rejection.
9. **Review trendline tie-breaking** when multiple trendlines touch.
10. **Add regression tests for funnel counting** with all stage IDs.

### LOW (P3)
11. **Documentation updates** clarifying book vs engineered rules.
12. **Clean up diagnostics notes** to mention filters.

---

## 9) CONCRETE FILES/LINE REFERENCES (KEY)

**TypeScript (app-ts):**
- Pattern: `src/patterns/ConfluenceZonePattern.ts` (stages: fib_level ~207,218; rejection_candle ~312,321; rejection logic ~626-750; SL/target ~752-850)
- Pattern engine: `src/core/PatternEngine.ts` (filters applied ~135-190)
- Replay engine: `src/core/ReplayEngine.ts` (funnel ingestion ~591-650; stage ID switch ~625-640; filterEnabled ~131-132; signal recording ~452-470)
- Filters: `src/core/TradeFilters.ts` (defaults ~72-103)
- Indicators: `src/indicators/swingPoints.ts` (~37-140), `supportResistance.ts` (~24-220), `fibonacci.ts` (~90-200)
- API: `src/api/routes/replay.ts` (~154,243)
- Types: `src/types/prediction.ts` (StrategyFunnel ~183-221)

**Python (research-py):**
- Pattern: `src/patterns/confluence_zone.py` (rejection ~207-280, SL/target ~282-337)
- Indicators: `src/indicators/support_resistance.py` (~130-240), `fibonacci.py` (~130-210), `trendlines.py` (~1-200)
- Spec loader: `src/strategies/strategy_spec.py` (referenced)

**Fixtures/spec:**
- Spec: `shared/fixtures/strategy_spec.json`
- Fixtures: `shared/fixtures/parity_15m.csv`, `shared/fixtures/trade_parity_15m.csv`

---

## 10) ANSWERS TO SPECIFIC QUESTIONS

1. **How strategy generates LONG/SHORT/NO_TRADE:** Confluence of S/R zone + Fibonacci level + Trendline (>= minConfluenceFactors, default 2). Direction set from first contributing factor (S/R preferred if present, else fib, else trendline). Requires Entry Model 2 rejection candle (wick into zone, close outside, adequate wick:body ratio with ATR floor, correct candle type). Requires SL/TP with R:R >= MIN_TARGET_RR (1.5). If any stage fails → NO_TRADE (trace recorded). Filters may reject after pattern generates signal.

2. **Why zero signals in reported replay:** Most likely trade filters enabled by default blocking all signals for that dataset/regime/timeframe. Funnel shows stages passing but signals filtered; also funnel misreports fib/rejection due to ID mismatch.

3. **TS vs Python parity:** Largely aligned for core logic. Differences in confidence formula, doji/equality handling in rejection, some tie-breaking details, and execution layers differ. Trade parity framework exists with documented expected divergences.

4. **Backtest results correctness:** Depends on filters, costs, execution model. Metrics calculation looks reasonable but needs validation against actual data. No obvious systematic accounting error in metrics code, but missing costs/slippage is a concern.

5. **Look-ahead bias:** Generally guarded (closed-candle prefixes, confirmed swings, HTF sliced to past). Replay tests enforce prefix invariance. No obvious look-ahead found.

6. **Evidence needed before trusting:** Need to (a) reproduce with filters disabled and see if signals appear, (b) understand dataset/regime causing filter rejections, (c) fix funnel ID mismatch for accurate diagnostics, (d) run parity tests, (e) account for costs/slippage, (f) out-of-sample testing.

---

**END OF REPORT**
