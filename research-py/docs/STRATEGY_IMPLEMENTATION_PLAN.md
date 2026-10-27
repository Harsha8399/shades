# Staged Implementation Plan

Derived from `docs/STRATEGY_RULE_AUDIT.md`. **No stage below optimises
parameters, claims profitability, or touches live trading.**

Each stage states the problem it solves, the files involved, the expected
outcome, the tests required, and its dependencies. Stages are ordered so that
**structure is settled before any parameter is tuned**.

---

## Stage 0 — Lock the baseline *(complete)*

**Problem.** The two engines produce different signals from the same data, so
no strategy comparison is currently meaningful.

**Files.** `app-ts/src/data/CSVLoader.ts`, `app-ts/src/core/LiveMonitor.ts`,
`app-ts/src/core/LivePatternScanner.ts`, `app-ts/src/core/PaperTradingEngine.ts`,
`app-ts/tests/*`.

**Outcome.** Execution defects TS-01…TS-07 fixed; 23 TypeScript tests and 88
Python tests green; a shared execution contract.

**Tests.** `app-ts/tests/regression.test.ts` (10), `app-ts/tests/parity.test.ts`
(13), `research-py/tests/` (88).

**Deps.** None.

---

## Stage 1 — Make the two engines produce identical signals *(complete)*

**Problem.** Fibonacci anchoring, trendline tolerance units, stop-loss basis
and target basis all differ between the engines. The same file produces
different zones, different confluences and different trades in each.

**Decisions.** See `docs/STAGE1_PARITY_DECISIONS.md` (D1-D10, each with the
measured before/after evidence).

**Outcome.** The two engines now produce **identical** ATR, swing points,
S/R zones, Fibonacci levels, trendlines, and per-bar confluence signals from
identical inputs. Verified with a shared fixture
(`shared/fixtures/parity_15m.csv`) and shared expectation files that BOTH
test suites assert against, so neither engine can drift silently.

| Metric | Before | After |
|---|---|---|
| Indicator parity (ATR, swings, zones, Fib, trendlines) | 5 of 7 differed | **7 of 7 identical** |
| Per-bar confluence signals | not comparable | **129 / 129 identical** |
| ATR | 2.1003428571 (Py) vs 1.8569735450 (TS) | **1.2177437466 both** |
| Fib anchoring | Py window extremes, TS swings | **both confirmed swings** |
| Trendline tolerance | Py 2% of price, TS 0.3 ATR | **both 0.3 ATR** |
| Stop-loss | Py 10-bar extreme, TS swing | **both confirmed swing** |
| Target | Py fixed R:R, TS next S/R | **both next structural S/R** |
| Risk sizing equity | Py at fill, TS stale capital | **both at fill** |
| HTF confirmation | TS could emit an in-progress bar | **TS emits only completed bars** |

**Files.**
- `research-py/src/indicators/support_resistance.py` (ATR to Wilder, S/R ATR parameter)
- `research-py/src/indicators/fibonacci.py` (swing-point anchoring)
- `research-py/src/indicators/trendlines.py` (ATR tolerance, recent-swing helpers)
- `research-py/src/patterns/confluence_zone.py` (stop, target, ATR plumbing)
- `app-ts/src/indicators/atr.ts` (library-exact seeding)
- `app-ts/src/indicators/fibonacci.ts` (matching swing selection)
- `app-ts/src/core/RiskManager.ts` (equity-at-fill sizing)
- `app-ts/src/core/PaperTradingEngine.ts` (fill-time re-sizing)
- `app-ts/src/core/CandleResampler.ts` (no in-progress HTF bar)
- `shared/fixtures/*`, `scripts/gen_parity_*.py`, `scripts/parity_dump.py`

**Tests.** `research-py/tests/test_stage1_*.py` (3 files),
`app-ts/tests/stage1-*.test.ts` (3 files). 118 Python + 47 TypeScript.

**Deps.** Stage 0.

## Stage 2 — Explicit strategy specification and trade-level parity *(complete)*

**Problem.** Strategy rules and free parameters were tangled in
`ConfluenceZonePattern`. The audit lists nine invented parameters
(`docs/STRATEGY_RULE_AUDIT.md` §7). They had to be *named* and *separated*
before any of them could be changed, so that a later change is a deliberate
act rather than an accidental edit. In addition, the Stage 1 fixture produced
zero trades, so end-to-end execution parity could not be established.

**Outcome.**

1. A canonical, version-controlled specification at
   `shared/fixtures/strategy_spec.json` with **50 parameters**, each carrying
   a stable ID, a value or precise behavioural definition, a type and range
   where applicable, a provenance tag, a PDF page and passage for every
   book-derived rule, a rationale, an explicit status, a configurable flag,
   the consuming components, and the covering tests.
2. Read-only loaders in both engines
   (`research-py/src/strategies/strategy_spec.py`,
   `app-ts/src/strategies/strategySpec.ts`) plus consistency tests that fail
   if either engine drifts from the spec. Drift was verified to fail BOTH
   suites.
3. **13 recorded engine divergences** (DIV-01..DIV-13), each with the
   Python behaviour, the TypeScript behaviour, a severity and the stage at
   which it will be resolved.
4. **7 recorded ambiguities in the book** (AMB-01..AMB-07), each with the
   book position, the proposed interpretation and the affected parameters.
5. **Trade-level parity** established on two independent fixtures:
   - a STRATEGY fixture (`trade_parity_15m.csv`) that drives the shipped
     strategy, and
   - a CONTROLLED-SIGNAL fixture (7 execution scenarios) that validates the
     execution mechanics independently of whether the strategy fires.

**Trade-level parity result.**

| Comparison | Scenarios | Matching | Divergent |
|---|---|---|---|
| Strategy fixture, zero costs | 2 trades (1 LONG, 1 SHORT) | SHORT matches on every field | LONG exists only in Python (DIV-10) |
| Strategy fixture, sizes/P&L | — | — | differ by exactly the DIV-10 downstream effect (2000 of unrealised P&L) |
| Controlled execution scenarios, zero costs | 7 | 5 | 2 (DIV-10, DIV-11) |
| Controlled execution scenarios, with costs | 7 | exit reasons match | prices differ (DIV-03/DIV-04: different cost models) |

**Divergences resolved in Stage 2:** DIV-13 (`TRENDLINE_SELECTION`) — the
research engine was aligned to the production engine's rule of consulting
every detected trendline, not only the strongest three. This was found by
the trade-parity fixture and is the only production behaviour change made
in this stage; it makes the two engines agree and is the more defensible
rule.

**Files.**
- New: `shared/fixtures/strategy_spec.json` (the specification)
- New: `research-py/src/strategies/strategy_spec.py`, `app-ts/src/strategies/strategySpec.ts`
- New: `research-py/tests/test_strategy_spec.py`, `app-ts/tests/strategy-spec.test.ts`
- New: `research-py/tests/test_trade_parity.py`, `research-py/tests/test_execution_parity.py`, `app-ts/tests/execution-parity.test.ts`
- New: `scripts/execution_parity_dump.py`, `app-ts/src/cli/executionParityDump.ts`
- New: `scripts/trade_parity_dump.py`, `app-ts/src/cli/tradeParityDump.ts`
- New: `scripts/gen_trade_parity_fixture.py`, `shared/fixtures/trade_parity_15m.csv`
- New: `shared/fixtures/execution_parity.json`
- Modified: `research-py/src/patterns/confluence_zone.py` (TRENDLINE_SELECTION alignment)
- Modified: `app-ts/src/patterns/ConfluenceZonePattern.ts` (unchanged — it already
  consulted all trendlines)

**Tests.** 170 Python + 81 TypeScript, all passing. TypeScript compiles clean.

**Deps.** Stage 1.

---

## Stage 3 — Implement the book's stop-loss and target placement

**Problem.** The current stop is a 10-bar extreme ± 10% buffer — not any of
the book's three methods (§4.2). The Python target is a fixed 2R, not the
"next crucial support/resistance" the book specifies.

**Sub-steps (each independently testable).**

| # | Sub-step | Book rule | Prerequisite |
|---|---|---|---|
| 3a | **EM2 Method B** — SL beyond the latest swing high/low **and** beyond the broader trendline | p.17 | A trendline from a higher timeframe |
| 3b | **EM2 Method A** — SL beyond the next Fib level **and** beyond the broader trendline | p.17 | 3a + a defined "next fib level" |
| 3c | **EM1** — SL beyond the next retracement, keeping distance from the trendline | p.16 | A defined "next retracement" |
| 3d | **Target** = next crucial S/R, flagging minor levels in between | p.17 | Structural S/R (already exists) |

**Required new concepts.** "Broader trendline" needs a multi-timeframe
trendline extractor (the Python engine has none). "Next retracement" and
"next fib level" need explicit definitions relative to the entry — these are
**not in the book** and must be authored and documented as inferences.

**Outcome.** Stop and target placement traceable to a cited rule.

**Tests.** For each method, a synthetic scenario with a known swing, a known
trendline and a known Fib level, asserting the exact stop/target price. Plus
a test that the stop is on the correct side of each referenced level.

**Deps.** Stage 1, Stage 2, and an MTF trendline extractor.

---

## Stage 4 — Implement Entry Model 1 and a true Entry Model 2

**Problem.** Only one entry model exists, and it is **neither** EM1 nor EM2 —
it is a rejection-candle trigger that the book never describes (§4.3). EM1 is
absent.

**Files.** `research-py/src/patterns/confluence_zone.py` (and the TS mirror).
A new `EntryModel` enum and separate pattern classes, or one pattern with an
explicit `entry_model` parameter.

**Outcome.**
- **EM1**: enter as soon as price reaches the qualifying zone (≥3
  confirmations), no candle-pattern requirement.
- **EM2**: wait for the **immediate trendline to break**, enter on the break,
  no candle-close wait.
- The existing rejection-candle model retained but **renamed and labelled** as
  an implementation-specific variant, not "the methodology".

**Prerequisite.** A trendline-break detector that fires when price
**touches or crosses** the *immediate* trendline (high/low reaches the
line), **without** waiting for a candle close. p.17 is explicit:
*"there is no need to wait for any kind of candle closing confirmation"*.
A draft that required "price closes through the trendline" contradicted
the book and is rejected. This is the same book rule that settled DIV-11
(`ORDER_FILL_CONDITION = touch_only`). Also the missing half of R21.

**Tests.** EM1 fires on zone arrival without a rejection candle. EM2 fires on
a trendline break (touch/cross) without a rejection candle and without
waiting for a close — including the case where the bar wicks through the
line and closes back on the original side. EM2 does not fire without a
trendline break. The rejection variant still behaves as before.

**Deps.** Stage 1, Stage 2, Stage 3 (the stop rules differ per model).

---

## Stage 5 — Implement the 3-confirmation rule properly

**Problem.** The threshold is 2, but the rule is not a bare count (§4.1).

**Decisions required.** (a) What counts as a confirmation — the book names
exactly three price elements: level, trendline, Fibonacci. (b) Whether a
level and a trendline derived from the *same swing* count as two. (c) Whether
the combination must be the named "Level + Trendline + Fibonacci".

**Recommendation.** Implement (a) as the book's three elements; implement
(b) by requiring **distinct source structure** for each confirmation (a
trendline anchored at a swing low and an S/R level centred on that same swing
low must not both count); implement (c) as "any 3 of the 3 elements", which
reduces to the named triple, and treat "Level + trendlines" as a valid
*2-element* case that therefore **forces EM2** (R19).

**Files.** `research-py/src/patterns/confluence_zone.py`, the confluence
scoring helper, and the TS mirror.

**Outcome.** `min_confluence_factors` default becomes 3, with the
distinct-source rule, and the R19 forcing logic (2 confirmations ⇒ EM2).

**Tests.** A level + fib pair alone produces no EM1 signal. A triple produces
one. A level and a trendline sharing one swing point count as one, not two.
A 2-confirmation case routes to EM2.

**Deps.** Stage 4 (needs EM1/EM2 to express R19).

---

## Stage 6 — Trend reversal, pullbacks and structure (R21–R23)

**Problem.** The book defines a pullback precisely (R22: "no swing low until
price breaks the recently made high") and a two-step reversal (R21). Neither
is implemented; swings are pure fractals, which is a materially different
definition.

**Files.** `research-py/src/indicators/swing_points.py` (currently dead code —
the scipy variant; the live one is `trendlines.py`), a new structure module,
and the TS `StructureAnalyzer`.

**Outcome.** A swing-point definition that respects R22, a two-step reversal
detector, and complex-pullback detection that suppresses signals rather than
forcing them.

**Tests.** A price series that makes a lower low *without* breaking the prior
high is **not** a swing low under R22. A two-step reversal fires only after
both the trendline break and the swing-low break.

**Deps.** Stage 2. Can partly run in parallel with Stages 3–5.

---

## Stage 7 — Trendline-based trailing stop (R20)

**Problem.** The TypeScript trailing stop is R-multiple based, not
trendline-based on candle close. The Python engine has no trailing stop.

**Files.** `app-ts/src/core/PaperTradingEngine.ts` (replace the R-multiple
trailing with a trendline trail), `research-py/src/backtesting/engine.py`
(add trailing), the MTF trendline extractor from Stage 3.

**Outcome.** The stop follows a chosen trendline and is only re-evaluated on
candle close, with the timeframe chosen by trading style (15m intraday, 1h
swing) per R20.

**Tests.** The stop only tightens, never widens. The stop is not re-evaluated
mid-candle. A steeper trendline is used only per the book's deep-in-profit
condition.

**Deps.** Stage 3 (MTF trendline), Stage 6.

---

## Stage 8 — Out-of-sample validation and reporting

**Problem.** All results so far are in-sample. `walk_forward_test.py` exists
but is not integrated into the default validation flow, and the confluence
pattern fires rarely (10–11 trades over two years), which makes any
conclusion statistically weak.

**Files.** `research-py/scripts/validate_patterns.py`,
`research-py/scripts/walk_forward_test.py`,
`research-py/src/backtesting/metrics.py`.

**Outcome.** A validation run that reports in-sample **and** out-of-sample
results side by side, with a minimum-trade-count guard, and that states the
sample size so no conclusion is drawn from 4 trades.

**Tests.** A validation run on a known dataset produces the same summary
twice (reproducibility); a report with fewer than N trades is explicitly
flagged as statistically insufficient.

**Deps.** Stages 1–7.

---

## Stage 9 — Parameter sensitivity (LAST, and only if 1–8 are sound)

**Problem.** Nine invented parameters remain untested for stability.

**Outcome.** A sensitivity table showing how each parameter affects the
result across its range, so that a result depending on an exact value is
visible as fragile. **Not** an optimisation sweep — the purpose is to detect
fragility, not to find the best value.

**Tests.** A parameter whose result changes sharply across a small range is
flagged.

**Deps.** Stage 8. **Must not be used to select parameters** — only to expose
brittle ones.

---

## Explicitly out of scope

- Any parameter optimisation aimed at maximising historical return.
- Any claim of profitability.
- Live trading, broker order routing, or real-money execution.
- The React dashboard's strategy-configuration UI, until the strategy
  parameters have a stable spec (Stage 2).
- The TypeScript `LivePatternScanner` and `LiveMarketDataService` going to
  live trading, until the HTF-completion defect (TS-13) is fixed.

## Sequencing summary

```
Stage 0  [DONE] execution defects + shared contract
   |
Stage 1  engine parity (same signals from same data)
   |
Stage 2  explicit strategy spec with provenance
   |
   +-- Stage 6  structure / swings / reversal   (parallel)
   |
Stage 3  book stop-loss & target placement
   |
Stage 4  Entry Model 1 + true Entry Model 2
   |
Stage 5  the 3-confirmation rule
   |
Stage 7  trendline trailing stop
   |
Stage 8  out-of-sample validation
   |
Stage 9  parameter sensitivity (fragility, not optimisation)
```
