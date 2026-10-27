# Stage 1 — Engine Parity: Decision Record

Status: **authoritative** for what the two engines must agree on.

Stage 1's purpose is narrow: make the Python and TypeScript engines produce
**identical signals from identical inputs**. It does **not** change any
strategy rule, threshold, or parameter, and it does not add entry models.

Every decision below was **measured**, not assumed. The measurements come from
`shared/fixtures/parity_15m.csv` (400 deterministic 15-minute bars) dumped by
both engines via `scripts/parity_dump.py` and
`app-ts/src/cli/parityDump.ts`.

---

## 1. Measured differences (before any change)

| # | Aspect | Python | TypeScript | Measured? |
|---|--------|--------|------------|-----------|
| D1 | **ATR** | simple rolling mean of True Range over 14 | Wilder's smoothing over 14 | ✅ `2.1003428571` vs `1.8569735450` (ratio 1.131) |
| D2 | **Swing points** | fractal 3/3 | fractal 3/3 | ✅ **IDENTICAL** — 9 highs, 8 lows, exact same indices and prices |
| D3 | **S/R zones** | 4 zones | 3 zones | ✅ 1 zone missing in TS (the 132.42965 SUPPORT, strength 2) |
| D4 | **Fibonacci anchoring** | 50-bar window extremes | last confirmed swing points | ✅ PY: swing_high 156.3893 / swing_low 125.0362; **TS: `null`** (found no swing pair) |
| D5 | **Trendline tolerance** | percentage (`0.02`) | ATR multiple (`0.3`) | ✅ 64 trendlines each, but touch counts differ (3 vs 2) |
| D6 | **Stop-loss** | 10-bar min-low ± 10% buffer | `findRecentSwingLow(3)` ± 10% buffer | ✅ different swing windows |
| D7 | **Target** | fixed R:R (base class, `target_rr=2.0`) | next structural S/R level, else fixed R:R | ✅ different |
| D8 | **Risk sizing** | equity **at fill time** (includes unrealised) | **stale** rolling capital | ✅ different |
| D9 | **HTF candle confirmation** | no MTF at all | resampler can include an in-progress HTF bucket | ✅ TS-only concern |
| D10 | **Trendline `touches` counting** | counts the two anchor points as touches | counts the two anchor points as touches | ✅ same, but tolerance differs → D5 |

**Root cause of D1** (isolated exactly):

```
True Range[0] has no previous close, so it equals high-low.
Python : SMA of the last 14 TR                     -> 2.1003428571
Wilder : seeded with mean(TR[0..13]), then smoothed  -> 1.8569735450
```

## 2. Decisions

### D1 — ATR: use Wilder's smoothing in BOTH engines

**Decision: TypeScript's Wilder ATR is correct; Python changes to match.**

Rationale:
- Wilder's smoothing is *the* standard ATR definition (Wilder, *New Concepts*,
  1978) and is what `technicalindicators` and `pandas-ta` implement. The repo's
  own `ARCHITECTURE.md` states the project standard is to use a library for
  ATR rather than a custom implementation.
- The TypeScript engine already uses `technicalindicators` for its standard
  indicators; matching it keeps the TS side on the library standard.
- The difference scales **every** ATR-derived tolerance, so it silently
  changes zone widths, trendline touch counts and confluence membership.

**Change:** `research-py/src/indicators/support_resistance.py::calculate_atr`
becomes Wilder's smoothing, seeded with the simple mean of the first `period`
True Ranges and then smoothed with `((atr * (period - 1)) + tr) / period`.

**Edge case to preserve:** the TypeScript implementation returns the simple
average of `high - low` when there is not enough data for a true range. Python
must match that fallback exactly.

### D2 — Swing points: no change

Already identical. This is the anchor for the rest of the parity work: it
proves the two engines agree on the raw structural primitive, so every
remaining difference is attributable to a specific calculation.

**Tests to add:** a parity assertion on the exact swing list for the shared
fixture.

### D3 — S/R zones: unify the ATR tolerance and the touch rule

**Decision: both engines use the ATR multiple, and the zone-grouping algorithm
is made identical.**

- Python's `find_sr_zones(df, tolerance_atr, min_touches)` already takes an ATR
  multiple; TypeScript's `findSRZones(candles, atr, tolerance, minTouches)`
  takes the ATR and the multiple separately. **Same units, different shape.**
  Normalise the TypeScript signature to match Python's so the two cannot
  silently disagree: `findSRZones(candles, atr, tolerance, minTouches)` stays
  as-is (it must receive the ATR it is given), but the *pattern* must pass the
  same ATR both engines compute.
- The missing 4th zone in TS is a **consequence of D1**: with a smaller ATR the
  tolerance is tighter, so the swing low at 132.9054 and the one at 130.2511
  fall outside the tolerance band and do not cluster. Fixing D1 fixes D3.
- The grouping algorithm was compared line by line and is already equivalent
  (same greedy clustering, same "used" set, same average-price anchor). No
  change needed there.

**Expected outcome after D1:** 4 zones in both, identical levels and strengths.

### D4 — Fibonacci anchoring: use **confirmed swing points** in BOTH engines

**Decision: TypeScript's swing-point anchoring is correct; Python changes to
match.** The book is explicit (p.9): *"Analyse the swing points & draw
Fibonacci retracement"*, and p.14 adds that a swing low is only valid once
price has broken the recent high. Window extremes (Python today) are *not*
swing points at all — they are just the highest high and lowest low of a
window, which change as the window slides and do not correspond to any
structure the author describes.

**Change:** `research-py/src/indicators/fibonacci.py::find_fib_retracement`
uses confirmed swing points, mirroring
`app-ts/src/indicators/fibonacci.ts::findFibRetracement`:
- swings detected with `left_bars=5, right_bars=3`
- take the last 4 swings, split into highs and lows
- anchor on the **last** high and the **last** low
- direction = `UP` if the last low precedes the last high, else `DOWN`
- return `None` if there are no swings or the split is empty

**Critical detail — the TS side currently returns `None` for this fixture.**
`findFibRetracement` requires **both** a high and a low among the last 4
swings. On this fixture the last 4 swings are all highs, so TS finds no pair.
That is a *silent failure*: the pattern simply loses its Fibonacci
confirmation factor, which changes confluence membership without any error.

**Decision: make the selection deterministic and identical in both engines by
expanding the search window until a usable high/low pair is found, rather than
looking only at the last 4 swings.** This is a *behaviour* change to the TS
engine, but it is a **bug fix, not a strategy change**: a pattern that
silently drops a confirmation factor depending on the shape of the last four
swings is not a well-defined rule. The Python engine already has this
silently-failing shape, so both are being made explicit.

**Exact rule to be implemented identically in both engines:**

```
lookback window = last `lookback` candles (default 50)
swings = confirmed swing points in that window (left=5, right=3)
scan the swings from most recent to oldest; take the first HIGH and the
first LOW found
if either is missing -> return None
anchor = (lastHigh.price, lastLow.price)
direction = UP if lastLow.index < lastHigh.index else DOWN
```

This is a superset of the current TS behaviour on fixtures where the last 4
swings contain both a high and a low (the common case), and only differs when
it would otherwise silently return `None`.

### D5 — Trendline tolerance: use the ATR multiple in BOTH engines

**Decision: TypeScript's ATR-multiple tolerance is correct; Python changes to
match.**

Rationale:
- A **percentage** tolerance is scale-dependent: 2% of a 1000-point index is a
  20-point band, 2% of a 50-point stock is a 1-point band. The same code
  behaves completely differently on NSE instruments (~100–3000) and MCX
  commodities, and differently again on crypto (~50,000–100,000). This is
  precisely the "market-specific behaviour" the plan wants to avoid
  encoding.
- An ATR multiple is volatility-adaptive and already the convention for the
  S/R zone tolerance in **both** engines, so the two tolerance concepts are
  expressed in the same units.
- The book gives no numeric tolerance. It is an implementation parameter, and
  consistency across markets is the safer choice.

**Change:** `research-py/src/indicators/trendlines.py::find_trendlines` takes an
ATR-derived tolerance. To keep the public signature usable from the pattern
(which does not currently compute ATR for trendlines), the Python function
gains an `atr` parameter, mirroring TypeScript's
`findTrendlines(candles, atr, tolerance)`.

**Semantics to preserve exactly:** the touch test is
`abs(price - expected) <= tolerancePrice` where
`tolerancePrice = atr * tolerance`. Python's current percentage test is
`abs(price - expected) / expected < tolerance` — note it also divides by
`expected`, so it is not even a plain percentage of the price. Both are
replaced by the same absolute ATR-scaled test.

### D6 — Stop-loss: make Python match TypeScript for now, defer the real rule

**Decision: for Stage 1, align the two engines on the **TypeScript** basis
(`findRecentSwingLow/High` with a 3/1 fractal, ± 10% buffer) and record
clearly that this is NOT the book's rule.**

Rationale:
- The book's rules (EM1 "next retracement"; EM2-A "next fib level"; EM2-B
  "latest swing high") are **Stage 3** work and require an MTF trendline
  extractor and definitions of "next retracement" that do not exist yet.
- Stage 1's mandate is parity, not correctness of the strategy rule.
- TypeScript's basis (a *swing* low) is closer to EM2-B than Python's
  (a 10-bar extreme), so aligning on it reduces the distance to Stage 3.
- The **10% buffer must be preserved verbatim** in both engines. It is an
  invented parameter, but changing it here would be a strategy change, which
  Stage 1 forbids. It is logged in `STRATEGY_RULE_AUDIT.md` §7 as an
  overfitting candidate.

**Change:** `research-py/src/patterns/confluence_zone.py::calculate_stop_loss`
uses the same confirmed-swing lookup as TypeScript.

**Note on the buffer:** TypeScript computes
`(entryPrice - swingLow.price) * 0.1` and subtracts it from the swing low.
Python must do the same, and the *side* (beyond the swing, not beyond the
entry) must match.

### D7 — Target: make Python match TypeScript (next structural S/R)

**Decision: TypeScript's structural target is correct; Python changes to
match.** The book (p.17): *"Target can be plotted considering the next crucial
support, whilst paying attention any minor levels that may pop up in
between."* A fixed R:R is not that.

**Change:** `research-py/src/patterns/confluence_zone.py` overrides
`calculate_target` to:
1. find the nearest resistance above the entry (long) / support below (short)
   from the S/R zones;
2. if that level is at least `min_rr` away, target it, exiting 0.2% before it
   (long) / after it (short);
3. otherwise fall back to `entry ± risk * target_rr`.

**Note:** the 0.2% buffer and the `min_rr = 1.5` guard are TypeScript
implementations, not book rules. They are preserved verbatim so that Stage 1
changes only the *basis* of the target, not its parameters.

**Consequence to document:** this changes Python's historical backtest
results, because the target is now structural rather than fixed. That is
expected and is the point of the stage; the previous numbers were computed
under a rule the book does not describe.

### D8 — Risk sizing: make TypeScript match Python

**Decision: Python's sizing rule is correct; TypeScript changes to match.**
Python sizes on the equity **at fill time**, which includes unrealised P&L on
open positions. Sizing on a stale capital figure is a form of look-ahead
(backwards, actually — it ignores information that is available).

**Change:** `app-ts/src/core/RiskManager.ts` gains the ability to compute
current equity (realised capital + unrealised P&L of open trades) and
`PaperTradingEngine` passes it at the moment the order is filled.

**Scope limit:** the TypeScript engine's fills happen in
`PaperTradingEngine.updateTrade` when a PENDING trade's entry is hit, so the
equity must be computed at that point, not at signal time. The Python engine
sizes at `_execute_pending_orders`, i.e. at fill time — the same moment.

### D9 — HTF candle confirmation: TypeScript-only fix

**Decision: the TypeScript resampler must not emit an in-progress
higher-timeframe bar.**

`CandleResampler.resample` currently skips only a trailing chunk shorter than
`ratio`. If the current period already has a full chunk of lower-timeframe
candles, that chunk — which includes the still-forming bar — is aggregated and
emitted as a "completed" HTF candle.

**Change:** the resampler drops the final chunk unless it is the *last* bar of
the input, so a partial period is never emitted as complete. Combined with
the Stage 0 fix (the buffer holds closed candles only), this guarantees the HTF
filter only ever sees completed higher-timeframe candles, satisfying
principle **P5** of `EXECUTION_SEMANTICS.md`.

Python has no MTF, so there is nothing to change there. **No MTF is being added
to Python in Stage 1** — that is Stage 3 work (the MTF trendline extractor).

### D10 — Trendline touch counting: no change

Already equivalent. The observed difference in `touches` (3 vs 2) is a
*consequence* of D5, not a separate defect. After D5 both engines must report
identical touch counts.

---

## 3. What Stage 1 does NOT change

| Item | Reason |
|---|---|
| `min_confluence_factors = 2` | Stage 5. Changing it now would be a threshold change, which the brief forbids. |
| `min_rejection_wick_ratio = 2.0` | Stage 2 (provenance tagging). |
| `zone_tolerance_atr = 0.5` | Stage 2. |
| `sr_zone_lookback = 100` | Stage 2. |
| `target_rr = 2.0` | Stage 2. |
| The 10% stop buffer | Stage 2. Logged as an overfitting candidate. |
| `risk_per_trade = 0.01` | Stage 2. |
| The `RR < 1.5` filter | Stage 2. Not in the book. |
| Entry models | Stage 4. Explicitly out of scope. |
| Python MTF support | Stage 3. |
| Market-specific logic (NSE options, MCX) | Deferred until the shared engine is reliable. The ATR-based tolerances decided above are deliberately **scale-free**, which is a prerequisite for those markets. |

## 4. Verification strategy

1. **Deterministic unit tests** in both engines for each changed calculation,
   with explicit expected values.
2. **Parity tests** asserting the two engines agree exactly on the shared
   fixture for: ATR, swing list, S/R zones, Fibonacci levels, trendlines, and
   the full trade list of a backtest.
3. A **cross-engine harness** (`scripts/parity_dump.py` +
   `app-ts/src/cli/parityDump.ts`) that diffs the two dumps, run as part of
   verification.
4. Full suites green: Python and TypeScript.
5. `tsc --noEmit` clean.
6. End-to-end simulation on the shared fixture and on the existing sample data.
