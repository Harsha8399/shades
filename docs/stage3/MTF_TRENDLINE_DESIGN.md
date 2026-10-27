# Stage 3 — Step 3: Multi-timeframe trendline extractor — design and test plan

> **Status: DESIGN ONLY. Nothing in this document has been implemented.**
> Submitted for review together with `STOP_PLACEMENT_ANALYSIS.md` and
> `DIVERGENCE_AUDIT.md`. Implementation begins only after approval.

Repository: `/Users/harshavardhanreddy/projects/shades`

---

## 0. The problem this solves

The book's EM2-A and EM2-B stop rules both require the stop to sit **beyond
the broader ongoing trendline** (p.17). Neither engine can evaluate that
today:

- The Python engine has no multi-timeframe capability at all.
- The TypeScript engine *does* build higher-timeframe candles
  (`LiveMonitor.ts:102-121`, `MultiSymbolMonitor.ts:157-174`) but only for the
  existing `MTFAnalyzer`, which is an **EMA-bias + key-levels** construct. It
  extracts **no trendlines at all**, and its output never reaches
  `calculateStopLoss`.
- `BasePattern.detectSignal(candles, context)` receives only the entry
  time frame's candles. `MarketContext` carries `symbol`, `timeframe`, `atr`,
  `trend`, `volatility` — no higher-timeframe series.

So the extractor must do three things: **select** a higher time frame,
**extract** a trendline from completed higher-timeframe candles in a
causality-safe way, and **supply** the resulting price at the entry bar to the
stop logic.

> **Constraint honoured:** no arbitrary timeframe weights, no invented scoring
> systems, no weighted combination of candidate trendlines. The extractor
> returns *a* trendline or *none*; it does not score candidates.

---

## 1. How the higher time frame is selected

### 1.1 The options, and why this one

| Option | Description | Assessment |
|---|---|---|
| **A. One step up the hierarchy** | 15m → 4h, 1h → 4h, 4h → 1d | Simple and mechanical. But p.9 does not describe a fixed step; it describes *roles* that differ by trading style. |
| **B. Fixed "trendline time frame" per trading style** | Intraday → 1h; Swing → 1d | Closest to p.9's wording. But it requires the caller to declare a trading style, which the strategy does not currently have. |
| **C. Nearest time frame in the hierarchy that has enough history** | Walk up until a minimum number of completed HTF candles is available | Robust to short datasets, but it silently *changes* the meaning of "broader" depending on data length. |

**Recommendation: Option A as the default, with the mapping held in the spec
as data (`MTF_TIMEFRAME_HIERARCHY`), not hard-coded in either engine.**

This is a **change of provenance**, and it is deliberate and must be called
out. The current `MTF_TIMEFRAME_HIERARCHY` is tagged `book` (p.9) with the
value `{1m: 5m, 5m: 1h, 15m: 4h, 1h: 4h, 4h: 1d, 1d: 1w}`. **The pairing is
not book-derived** — p.9 says *which* time frames matter for *which* purpose,
but it never states a time-frame-to-time-frame mapping. The spec's own
`status` field already says so: *"OPEN - the pairing is inferred; the roles
are book-derived."* The `book` tag on the whole parameter is therefore
**overstated** and should be changed to `inferred`, with the p.9 role
description retained as the citation.

> This matters for the review: it is a second place where a `book` label
> does not survive contact with the source. The first was
> `PARTIAL_TAKE_PROFIT`. The pattern is that repo-authored summaries were
> mistaken for source text. Both are corrected in this stage.

**The choice of A vs B vs C is AMB-08 and is deliberately left open.** What
the extractor must guarantee, regardless of which mapping is chosen, is
specified in §2–§7 below. Choosing the mapping is a Stage 4 decision, taken
after the extractor exists and can be tested.

### 1.2 The mapping must be data, not code

Both engines read it from `shared/fixtures/strategy_spec.json`
(`MTF_TIMEFRAME_HIERARCHY`), so a mapping change moves both engines at once
and the spec drift tests catch a mismatch. The TypeScript engine already has
a second, divergent copy of a hierarchy in two places:

- `app-ts/src/types/mtf.ts:102-110` — `TIMEFRAME_HIERARCHY` (`1m → 15m`,
  `15m → 4h`, `1h → 4h`, `4h → 1d`)
- `app-ts/src/core/CandleResampler.ts:57-66` — `getHigherTimeframe` (`1m → 5m`,
  `5m → 1h`, …)

These two **already disagree** with each other (`1m → 15m` vs `1m → 5m`).
The extractor must read the spec, and these two duplicates must be collapsed
onto it — otherwise the extractor would have a third answer.

---

## 2. Extracting the trendline from completed candles

### 2.1 The pipeline

```
entry-timeframe candles
        │
        ├─(1) resample to the higher time frame
        │        └─ DROP the forming (incomplete) HTF candle
        │
        ├─(2) find confirmed swing highs / lows on the HTF series
        │
        ├─(3) build candidate trendlines from pairs of same-type swings
        │        └─ keep those with >= TRENDLINE_MIN_TOUCHES touches
        │
        ├─(4) select THE trendline (see §5)
        │
        └─(5) evaluate it at the entry bar -> a price
```

### 2.2 Step (1) — resampling, causality

**The rule:** the HTF series used for a decision at time *t* must contain only
HTF candles that have **closed** at or before *t*.

**TypeScript:** `CandleResampler.resample` already implements this correctly.
It drops a short final chunk, and it drops a full final chunk that is not
terminated by the last input candle (see the `DEFECT FIX` comment at
`CandleResampler.ts:118-140`). **Reuse it as-is.**

**Python:** `research-py/src/data/loaders.py::resample_ohlcv` uses
`df.resample(rule).agg(...).dropna()`. `dropna()` removes buckets with no
data, but it **keeps the final, still-forming bucket** if it contains at least
one source bar. This is a **lookahead hazard** and must be fixed before the
extractor is used.

The fix is to drop the last resampled bucket unless it is complete:

```python
def resample_ohlcv(df, timeframe):
    # ... existing resample ...
    # Drop the forming bucket: it contains only the source bars that have
    # arrived so far for a period that has not closed yet.
    ...
```

The exact "is this bucket complete" test must be **defined once** and applied
identically in both engines — see §7.

> **A note on NSE session boundaries.** `CandleResampler` has an
> `NseCandleResampler` subclass and `NSE_MARKET_HOURS` (09:15–15:30, 375
> minutes). A 4-hour resample of NSE data does not tile the session evenly
> (375 minutes is not a multiple of 240). The extractor must state which
> bucketing it uses, and the two engines must use the **same** one. This is a
> real risk of silent Python/TypeScript divergence and is called out in the
> test plan (§8).

### 2.3 Step (2) — swing identification on the HTF series

The engine already has a causality-aware swing finder in Python:
`find_confirmed_swings(df, left_bars, right_bars)` returning `ConfirmedSwing`
objects that carry `confirmed_at` — **the index of the last bar needed to
prove the swing**. `filter_confirmed_swings(swings, as_of_index)` then keeps
only those confirmed on or before the decision bar. This is exactly the
primitive the extractor needs, and it is the correct one: a swing confirmed
by a bar that has not yet occurred is not knowable.

**Design:** the extractor reuses `find_confirmed_swings` with the **HTF**
series' own bar indices, and applies `filter_confirmed_swings` against the
index of the last **completed** HTF candle.

**Parameter reuse:** `SWING_LEFT_BARS` (3, `invented`) and `SWING_RIGHT_BARS`
(3, `inferred`) are currently the entry-timeframe swing parameters. The
extractor needs HTF swing parameters. Two options:

- **(a) Reuse the same values.** One set of swing parameters; simpler; and
  the confirmation latency is naturally larger in HTF terms (3 HTF bars).
- **(b) Add `HTF_SWING_LEFT_BARS` / `HTF_SWING_RIGHT_BARS`.** More faithful to
  p.9's idea that HTF structure is "broader" (fewer, more significant swings),
  but adds two more invented parameters.

**Recommendation: (a)** for the first implementation — reuse the existing
swing parameters — and record it explicitly as a parameter
(`HTF_SWING_PARAMS = "reuse_entry_timeframe"`). Rationale: it avoids adding
two more free parameters to an already-invented-heavy spec, and it is
trivially changed later if the sensitivity analysis justifies it.

**TypeScript:** `app-ts/src/indicators/swingPoints.ts::findSwingPoints` must be
given the same confirmed-swing semantics. If it does not already provide
`confirmed_at`, that is **required work**, not optional — the extractor cannot
be causality-safe without it.

### 2.4 Step (3) — candidate trendlines

`find_trendlines(df, tolerance, min_touches, atr)` already exists in both
engines and already:

- builds lines from **pairs of same-type swings** (lows → support, highs →
  resistance);
- counts touches using an **ATR-multiple** tolerance (scale-free);
- filters by `min_touches`.

**Design:** reuse it unchanged on the HTF series, with the ATR computed **on
the HTF series** (not the entry time frame). This is the same class of bug as
DIV-11, where the ATR window disagreed between engines — the ATR must be
computed over the same series the swings came from, and must be passed in
explicitly rather than recomputed internally.

`TRENDLINE_TOLERANCE_ATR` (0.3, `invented`) and `TRENDLINE_MIN_TOUCHES`
(2, `book` p.6) are reused as-is. **No new tolerance is introduced.**

### 2.5 Step (4)+(5) — selection and evaluation

Selection is specified in §5. Evaluation at the entry bar is
`get_trendline_price(tl, index)`, which both engines already have. The
extractor must evaluate the line at **the entry bar's timestamp projected
onto the HTF index axis** — see §6 for the index-mapping problem, which is
the subtlest part of the whole design.

---

## 3. Validating a trendline, and touchpoints

The book says (p.19): *"Usually, it is said the more the touchpoint; the
stronger the trendline. But if it is hitting more often, it means it's
getting weaker & you should be cautious."*

This is a **narrative caution, not a rule**, and it must not be turned into a
scoring system. The design deliberately implements only the mechanical half:

- A candidate line is **valid** if it has at least `TRENDLINE_MIN_TOUCHES`
  (2, `book`) touches, where a touch is a swing extreme within
  `TRENDLINE_TOLERANCE_ATR` (0.3, `invented`) of the line.
- Touches are counted only from swings **confirmed on or before** the
  decision bar. A touch from a swing that is not yet confirmed is not a touch.
- The extractor returns the line and its touch count. It does **not** convert
  the count into a weight or a score.

**No scoring, no ranking by "strength", no weighted combination of
candidates.** The selection in §5 is a deterministic filter, not a score.

---

## 4. Lookahead prevention — the explicit rules

These are the invariants the implementation must satisfy. Each is directly
testable.

| # | Rule | Test |
|---|---|---|
| **L1** | The HTF series used at decision time *t* contains only HTF candles that **closed** at or before *t*. | Truncating the source series at *t* must not change the extractor output. |
| **L2** | Every swing used is **confirmed** at or before *t* (`confirmed_at <= t`). | A swing whose `confirmed_at` is after *t* must be absent. |
| **L3** | A trendline is built only from **confirmed** swings. | A line built from an unconfirmed swing must not appear. |
| **L4** | The line is evaluated at the entry bar, but the line's **construction** must not depend on data after the entry bar. | Appending future bars must not change the line's parameters. |
| **L5** | No partial HTF candle is ever emitted. | The last HTF candle must be complete (its close time ≤ *t*). |
| **L6** | The ATR used for touch tolerance is computed over the **HTF** series only. | Changing entry-timeframe bars must not change the HTF ATR. |

**L4 is the one most likely to be got wrong.** A line fitted over the whole
HTF history (including bars after the entry) is a *retrospective* line, and
using its value at the entry bar is lookahead. The implementation must fit
the line using only swings confirmed at or before the entry bar, and then
evaluate it at the entry bar.

**The strongest possible test** for all of L1–L6: run the extractor on a
prefix of the data and on the full data, and assert the extractor output at
the prefix's last bar is **identical**. This single test catches every
lookahead path at once. It should be the first test written.

---

## 5. Selecting *the* trendline

The extractor must return one trendline (or none). Options:

| Option | Description | Assessment |
|---|---|---|
| **A. Nearest to the entry price** | The valid line whose price at the entry bar is closest to the entry | Deterministic, scale-free, and it matches the book's purpose: the stop must be beyond the trendline, so the *nearest* line is the binding constraint. |
| **B. Most touches** | The valid line with the most touchpoints | Matches p.19's "more touchpoints, stronger trendline" — but p.19 also warns that a line that is hit often is *weaker*. The two halves of that sentence conflict, so a pure touch-count rule is not derivable from it. |
| **C. Steepest / shallowest** | Preference by slope | p.19 discusses steep lines being more breakable, but gives no rule. |
| **D. No selection — return all, let the stop rule take the binding one** | The stop takes the most restrictive of all valid lines | Removes the selection problem entirely. |

**Recommendation: D, with A as the tie-breaker if the caller needs a single
line.**

Rationale: the stop rule is *"beyond the broader trendline"*, i.e. it needs
the **most restrictive** (nearest) line. Returning all valid lines and
taking the binding one is exactly the semantics the stop rule requires, and
it avoids inventing a selection criterion the book does not state. This also
removes any temptation to score candidates.

A and D agree in the common case. D is preferred because it is total (it
never has to break a tie arbitrarily) and because it makes the extraction
step and the stop-application step cleanly separable — the extractor supplies
*the set of valid broader trendlines*, and the stop rule decides which one
binds.

**If the caller does need exactly one line** (e.g. for display), use A
(nearest to the entry price), tie-broken by more touches, then by more
recent. Documented as a display convenience, not as the selection rule.

---

## 6. Evaluating the line at the entry bar — the index-mapping problem

This is the subtlest part and the most likely source of Python/TypeScript
divergence.

A trendline fitted on the **HTF** series is expressed in HTF bar indices:
`price = intercept + slope * htf_index`.

The stop rule needs the line's price **at the entry bar**, which lives on the
**entry time frame** axis. The two axes are different.

**Design:** the extractor returns the line in *price space* plus the
information needed to evaluate it:

```
BroaderTrendline {
    type:        'SUPPORT' | 'RESISTANCE'
    slope_per_htf_bar: number
    intercept:   number        // price at htf_index = 0
    htfc_start:  number        // first htf bar index used
    price_at(entry_time_iso): number
}
```

and the extractor computes `price_at` itself, so the caller never does
index arithmetic.

**The mapping rule must be stated exactly, because any ambiguity here becomes
a parity bug:**

> The line is evaluated at the **last completed HTF bar** at the time of the
> entry, and then **extrapolated along the line's own slope** to the entry's
> timestamp, converted into HTF-bar units.

That is: the line's price at the entry bar is
`intercept + slope * (last_completed_htf_index + (entry_time − last_htf_bar_close_time) / htf_bar_duration)`.

The fractional term is the "how far into the current HTF period are we"
offset. This is the same construction the existing `get_trendline_price` uses
on the entry time frame, extended across time frames.

**Open implementation detail (must be settled before coding):** the
TypeScript engine stores candle timestamps as **epoch milliseconds**
(`app-ts/src/types/candle.ts:5`), and the Python engine stores them as
**pandas `DatetimeIndex`**. The conversion to "HTF bars since the line's
origin" must therefore be done in **time**, not in raw index arithmetic, and
the two engines must agree on:

- the **HTF bar boundary convention** (see §2.2's NSE note);
- the **session-aware** vs wall-clock duration when a time frame spans a
  session break (a 4h bar on NSE is not 4 wall-clock hours);
- the reference epoch from which `htf_index` is counted.

A **shared, fixture-driven** test (§8) is the only reliable way to keep these
honest.

---

## 7. Behaviour when no valid broader trendline exists

The extractor returns **no line** (not a fallback line, not a default slope).
The caller decides what that means, and the answer differs by rule:

| Rule | If no broader trendline exists | Rationale |
|---|---|---|
| **EM1** ("keeping a suitable distance away from the trendline") | If the entry-timeframe trendline is unavailable, the constraint is **vacuous** — but see Q5 in `STOP_PLACEMENT_ANALYSIS.md`. A defensible default: treat the clause as satisfied, because EM1's binding reference is the *retracement level*, and the trendline clause is a secondary distance check. | Avoids EM1 depending on multi-timeframe data availability, which would change the entry count as a function of dataset length. |
| **EM2-A** ("above the next fib level **&** above the broader ongoing trendline") | The rule **cannot be satisfied**. Two candidate behaviours, recorded as **Q1** for review: (a) fall back to the Fibonacci level alone and record the fallback; (b) **reject the signal**. | p.18 treats a missing third confirmation as a reason to *wait* for a better setup, which supports (b). But (b) reduces the signal count and (a) produces a stop that does not satisfy the book. |
| **EM2-B** ("slightly above the latest swing high **&** above the broader trendline") | Same two candidates as EM2-A. | |

**The behaviour must be a recorded decision, not an implicit fallback in
code.** Whichever is chosen, it must appear in the spec as a parameter (e.g.
`HTF_TRENDLINE_MISSING_BEHAVIOUR = "reject_signal" | "fallback_to_level"`) and
must be the same in both engines.

> **A secondary risk, worth stating:** if the fallback is "use the level
> alone", then a dataset with a short history — which has no HTF data and so
> never has a broader trendline — would behave *systematically differently*
> from a long dataset. The extractor should therefore **also expose a
> diagnostic**: how many signals were evaluated without a broader trendline.
> A silent change in the stop rule across a dataset boundary is exactly the
> kind of thing that looks like a strategy improvement and is not.

---

## 8. Test plan

### 8.1 Python/TypeScript equivalence (the primary requirement)

The extractor is the component most likely to diverge, because it combines
resampling, swing confirmation, line fitting and cross-timeframe index
mapping. The equivalence test must therefore be **end-to-end through the
extractor**, not unit-by-unit.

| Test | What it does |
|---|---|
| **T1. Causality / no-lookahead** | Run the extractor on a prefix and on the full series; assert the output at the prefix's last bar is **identical**. Covers L1–L6 at once. |
| **T2. HTF fixture equivalence** | A shared fixture of entry-timeframe candles (plus the HTF time frame) drives both extractors; assert identical line parameters, touch counts, and evaluated prices to a tight tolerance. |
| **T3. Resampler equivalence** | The same source series resampled by both engines must produce identical HTF candles (open/high/low/close/volume/boundary). |
| **T4. Swing equivalence** | Identical confirmed swings, including `confirmed_at`. |
| **T5. Boundary case** | An entry exactly on an HTF boundary, and one exactly one bar inside an HTF period. |
| **T6. Session boundary** | An entry in an NSE session with a 4h time frame (non-divisible session length). |

### 8.2 Stop-placement behaviour (the consumer of the extractor)

| Test | What it does |
|---|---|
| **T7. Long stop, EM2-A** | Stop below the entry, below **both** the next Fibonacci level and the broader trendline, by the buffer. |
| **T8. Short stop, EM2-A** | Mirror image of T7. |
| **T9. Long/short EM2-B** | Stop beyond the latest confirmed swing **and** the broader trendline. |
| **T10. Long/short EM1** | Stop beyond the next retracement level. |
| **T11. Missing Fibonacci level** | No confirmed swing high *and* low in the window → the documented fallback, or no signal. |
| **T12. Missing broader trendline** | The documented behaviour from §7. |
| **T13. Level on the wrong side** | The next Fibonacci level is on the profit side → it must not be used as the reference. |
| **T14. Trendline on the wrong side** | For a short, a broader *support* line below the entry → not a constraint. |
| **T15. No confirmed swing** | The reference falls back as documented, or no signal. |
| **T16. Binding constraint is the trendline** | Construct data where the trendline is *further* from the entry than the Fibonacci level; assert the trendline binds. (The book's own charts never exercise this case, so it must be constructed.) |
| **T17. Ambiguous bars** | A bar that touches both the stop and the target → the `INTRABAR_POLICY` governs, and the stop rule must not change the policy. |
| **T18. Gaps** | A gap through the stop → fill per `GAP_FILL_AT_OPEN`; the stop *placement* rule must not change the gap handling. |
| **T19. Buffer scaling** | The same setup on a 10× price scale must produce a 10× wider stop, and the same R-multiple. Guards against a percentage buffer sneaking back in. |

### 8.3 Regression guards

| Test | What it does |
|---|---|
| **T20. Spec drift** | The extractor's parameters (HTF mapping, swing params, tolerance, min touches) must equal the spec's live values in both engines. |
| **T21. No new invented parameters** | A test asserting the extractor's parameter set is exactly the set the spec declares — so a future change cannot add a hidden constant. |
| **T22. Parity fixture regeneration is deliberate** | Changing the stop rule changes every signal's stop, target, R-multiple and size. The parity expectations must be regenerated **by hand from the new rule** and reviewed, and a change in the *number* of signals must be surfaced as a failure, not absorbed. |

### 8.4 Equivalence tooling

The existing harnesses are the right shape and should be extended, not
replaced:

- `scripts/trade_parity_dump.py` / `app-ts/src/cli/tradeParityDump.ts`
- `scripts/execution_parity_dump.py` / `app-ts/src/cli/executionParityDump.ts`
- (the older `scripts/parity_dump.py` / `parityDump.ts` / `paritySignals.ts`
  pair were removed in the Phase 3 review as unwired duplicates; the
  trade/execution harnesses above cover their ground.)

A new **`mtf_parity`** harness is needed, because the extractor needs a
fixture with **two** time frames, or one time frame that is resampled to a
higher one with a defined boundary convention. `shared/fixtures/parity_15m.csv`
can serve as the source if the resampling convention is pinned down (T3, T6),
but a purpose-built fixture with a known HTF series is safer.

---

## 9. Files that would change (design only — nothing changed yet)

**Canonical spec**
- `shared/fixtures/strategy_spec.json` — `MTF_TIMEFRAME_HIERARCHY` provenance
  `book` → `inferred`; new parameters for the HTF swing policy, the
  trendline-selection policy, the missing-trendline behaviour, and the HTF
  completion rule; `HTF_COMPLETION` extended to cover the research engine.

**Python**
- `research-py/src/data/loaders.py` — make `resample_ohlcv` drop the forming
  bucket; add the shared bucketing convention.
- `research-py/src/indicators/trendlines.py` — add the extractor
  (`extract_broader_trendlines`).
- `research-py/src/patterns/confluence_zone.py` — the stop rule consumes the
  extractor.
- `research-py/src/strategies/strategy_spec.py` — expose the new parameters
  (read-only).

**TypeScript**
- `app-ts/src/indicators/trendlines.ts` — add the extractor.
- `app-ts/src/indicators/swingPoints.ts` — provide `confirmed_at` if absent.
- `app-ts/src/patterns/BasePattern.ts` — `detectSignal` must receive the
  higher-timeframe candles (or a pre-extracted trendline set).
- `app-ts/src/patterns/ConfluenceZonePattern.ts` — the stop rule.
- `app-ts/src/core/CandleResampler.ts` — collapse the duplicate hierarchy onto
  the spec.
- `app-ts/src/types/mtf.ts` — collapse the duplicate hierarchy onto the spec.
- `app-ts/src/core/LiveMonitor.ts`, `app-ts/src/core/MultiSymbolMonitor.ts` —
  pass the HTF series into the pattern layer.
- `app-ts/src/strategies/strategySpec.ts` — expose the new parameters.

**Parity and tests**
- `scripts/mtf_parity_dump.py`, `app-ts/src/cli/mtfParityDump.ts` — new.
- `shared/fixtures/mtf_parity_*.csv` — new.
- `research-py/tests/test_mtf_trendlines.py`,
  `app-ts/tests/mtf-trendlines.test.ts` — new.
- `research-py/tests/test_strategy_spec.py`,
  `app-ts/tests/strategy-spec.test.ts` — extend for the new parameters.

---

## 10. Open questions for review

| # | Question | Options | Analysis leans to |
|---|---|---|---|
| **Q7** | Which time frame is "broader"? | (a) one step up; (b) fixed per trading style; (c) nearest with enough history | **AMB-08 — deliberately open.** The extractor must be written so that the mapping is data-driven, so this can be settled without touching the extractor. |
| **Q8** | Which candidate trendlines are returned? | (a) all valid, stop rule takes the binding one; (b) a single selected line | **(a)** — it is the semantics the stop rule needs and it avoids inventing a selection criterion. |
| **Q9** | HTF swing parameters? | (a) reuse entry-timeframe values; (b) new dedicated parameters | **(a)** initially — fewer invented parameters; trivially changed later. |
| **Q10** | When no broader trendline exists? | (a) reject the signal; (b) fall back to the level alone | **Open — Q1 above.** Depends on the AMB-08 outcome and on how much trade count is acceptable. |
| **Q11** | How is the line extrapolated from the last completed HTF bar to the entry bar? | wall-clock duration vs session-aware duration | **Session-aware** is more correct for NSE, but the two engines must agree exactly; T6 exists to enforce that. |
| **Q12** | Should the HTF series be resampled from the entry series, or supplied natively? | (a) resampled; (b) natively supplied | **(a)** for parity (one source of truth), but the engines must share the bucketing convention exactly. For live NSE trading, (b) may be needed because the broker supplies native candles. |
