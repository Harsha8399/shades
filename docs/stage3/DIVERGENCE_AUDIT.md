# Stage 3 — Step 4: Audit of the related execution divergences

> **Status: ANALYSIS ONLY. No engine behaviour has been changed.**
> Submitted for review together with `STOP_PLACEMENT_ANALYSIS.md` and
> `MTF_TRENDLINE_DESIGN.md`.

Repository: `/Users/harshavardhanreddy/projects/shades`

Divergences audited: **DIV-01, DIV-03, DIV-04, DIV-05, DIV-06, DIV-07,
DIV-10, DIV-11.**

---

## 0. The governing distinction

The user instruction for this step is explicit: *"Do not automatically align
every setting merely to make the engines match. Preserve market-specific
execution costs where appropriate, and distinguish strategy-rule parity from
execution-model parity."*

That distinction is the organising principle of this document. The two
questions are different and must not be conflated:

| | **Strategy-rule parity** | **Execution-model parity** |
|---|---|---|
| Question | Do both engines place the stop at the same price, for the same signal? | Do both engines charge the same cost, fill the same way, and resolve the same ambiguous bar? |
| Governed by | The book (p.8–20) | The market being traded (NSE equity, MCX, crypto) and the broker's fee schedule |
| Failure mode | A **strategy** difference — the systems are trading different things | A **measurement** difference — the systems measure the same trade differently |
| Can it be deferred? | Only with a recorded, explicit decision | **Yes**, if each engine's model is internally sound and clearly labelled |
| Should it be "fixed" by copying a value? | Never — the rule must be derived from the book | Never — the cost model is a fact about the market, not a parameter to be equalised |

**The central conclusion of this audit:** the eight divergences divide into
**three groups**, and the three groups need *three different* responses:

- **Group A — must be resolved in Stage 3** (3 divergences): they change
  *which* trades exist or *where* the stop is, so they block faithful
  stop-placement implementation and stop-placement validation.
- **Group B — must be resolved before trade-level parity can mean anything**
  (2 divergences): they change the *exit* economics of the same trade. They do
  not block stop placement, but they do block "the engines agree" claims.
- **Group C — safely deferrable, and must NOT be aligned** (3 divergences):
  they are market-specific execution facts, and equalising them would make
  the research engine *less* accurate, not more.

---

## 1. Group A — must be resolved in Stage 3

These block faithful stop-placement implementation.

### DIV-10 — order invalidation · `high` · stage 3 · **MUST RESOLVE**

| | |
|---|---|
| Python | A pending order fills on the next bar regardless of whether the stop was already broken. There is **no invalidation check** — `grep -n "invalidat" research-py/src/backtesting/engine.py` returns nothing. |
| TypeScript | `PaperTradingEngine.isInvalidated` (`PaperTradingEngine.ts:712-719`): a long is invalidated if `candle.low < trade.initialStopLoss`; a short if `candle.high > trade.initialStopLoss`. Checked **before** the entry fill (`:449-455`). |
| Current status | `open` |

**Why it must be resolved in Stage 3 — and this is the crux.**

A stop-placement change **moves the stop**, and the stop is the *input* to
the invalidation rule. In the trade-parity fixture the divergence is already
live: the LONG rejection candle's wick deliberately dips through the stop, so
TypeScript cancels the order and Python fills it. After the stop rule changes,
the stop sits somewhere else, and the same bar may or may not dip through it.

This produces a **circular dependency**: you cannot validate the new stop
rule by comparing the engines, because the engines disagree about whether the
trade exists at all, and that disagreement depends on the very stop price
being validated. Worse, a change in the stop's *distance* changes the
*signal count* — a wider stop invalidates more entries, a narrower stop
invalidates fewer — so a stop-placement change would silently change the
strategy's selectivity, which is exactly the kind of outcome that must be
reported rather than absorbed.

**Recommendation:** resolve in Stage 3, **before** the stop rule is
implemented.

The resolution must be a **spec-level decision** (`ORDER_INVALIDATION`), not
a code change, and the two candidates are materially different:

- **(a) "Stop already broken ⇒ order is dead."** Physically sensible: if price
  has already gone through the invalidation level, the premise of the trade
  is gone. This is what TypeScript does.
- **(b) "No invalidation; the order fills if the entry is touched."** This is
  a pure resting limit order. It is what Python does.

The honest framing: (a) and (b) model **different order types**. (a) is
closer to a stop-limit that is cancelled by an adverse move; (b) is a plain
resting limit. Neither is *wrong*. But they must not be silently different,
and — because the answer determines whether a signal becomes a trade — the
decision must be recorded in the spec, made identical in both engines, and
applied **before** any stop-placement validation is attempted.

**Recommendation on which:** (a), because the stop is the trade's risk
boundary and an entry whose stop has already been violated is not a trade the
author's method would take. This should be confirmed in review.

> Note the tension with the shipped `ENTRY_MODEL`: the shipped model requires
> a **rejection candle** whose wick by construction reaches *into* the
> confluence zone. Whether the wick also reaches the stop depends on the new
> stop's distance. A narrower stop makes the rejection candle and the
> invalidation rule interact more often. This interaction must be examined
> explicitly once the stop rule is implemented, and it is a reason to fix
> DIV-10 *first*.

### DIV-11 — entry fill condition · **RESOLVED** (`touch_only`)

| | |
|---|---|
| Python | `_resolve_entry_fill` (`engine.py:267-297`): a long fills if `bar['low'] <= entry`; a short if `bar['high'] >= entry`. **Touch only.** |
| TypeScript | `isEntryHit` (`PaperTradingEngine.ts:698-707`): a long fills if `candle.low <= signalPrice`; a short if `candle.high >= signalPrice`. **Touch only** (close-confirmation removed). |
| Current status | **`resolved`** |

**Book rule (explicit — not an interpretation).**

- **p.16, EM1:** *"As soon as the price reaches high liquidity zone, one can
  directly enter into the trade."*
- **p.17, EM2:** *"entry must be planned as soon as the trendline gets broken
  & there is no need to wait for any kind of candle closing confirmation, at-least
  this is how I use it."*

**Decision:** entry when price **touches or reaches** the trigger level,
**without** waiting for candle close. The alternative — entry only after a
candle **closes beyond** the trigger level — is rejected by the same
passages. Spec: `ORDER_FILL_CONDITION = "touch_only"`.

> **CORRECTION.** Any draft that framed the DIV-11 / entry-trigger resolution
> as "close beyond the trigger level" contradicted the book evidence it cited
> and is void. The same p.17 sentence also governs Stage 4's
> `TRENDLINE_BREAK_DETECTION`: when EM2 break detection is implemented it
> must be touch/cross, not close-beyond. A prior Stage 4 plan draft that
> required "price closes through the trendline" has been corrected.

> **Related, still open:** the shipped `ENTRY_MODEL` (rejection candle) is a
> *close* confirmation trigger and remains invented / Stage 4. That is a
> separate parameter from DIV-11's order-fill condition.

### DIV-05 — partial take-profit · `high` · stage 2 · **MUST RESOLVE before trade-level parity claims**

| | |
|---|---|
| Python | Not implemented at all. A position is held to the target or the stop. |
| TypeScript | Implemented and **enabled by default**: 50% at 1R, 30% at 2R, 20% at 3R, with the stop moved to break-even after TP1 (`PartialProfitManager.ts`, `PaperTradingEngine.ts`). |
| Current status | `deferred` (and, as established in Step 2, the ladder is **`invented`, not `book`**) |

**Why it must be resolved before trade-level parity can mean anything.**

With a partial ladder, a single trade produces **three** exit prices and a
blended average exit, and the R-multiple is not the simple
`reward / risk` the engine computes from the signal. Without it, there is one
exit. The two engines are therefore not measuring the same thing, and no
number of trade-level comparisons fixes that. This was already recorded as
*"THE PRIMARY BLOCKER FOR TRADE-LEVEL PARITY"*.

**Why it does NOT block stop placement, and what that means.**

The stop *placement* rule is upstream of the exit ladder: the stop is
computed once, and the ladder only determines how the position is *exited*
once the stop is hit. Stop placement can be implemented and unit-tested
without resolving DIV-05. The blocker is on **comparing outcomes**, not on
**computing the stop**.

**The Stage 3 finding changes this divergence's shape.** Step 2 established
that the `PARTIAL_TAKE_PROFIT` ladder's `book` citation was **not
verifiable in the PDF** — the passage is verbatim from this repository's own
`docs/techniques/05-entry-models-trade-management.md`, and the ladder has no
source-methodology support at all. The parameter has been reclassified
`book` → `invented`.

That reframes the decision. It is no longer *"the book describes this and one
engine does it"*. It is now *"we invented this, one engine does it by
default, and the book does not describe it"*. Two consequences:

1. **Enabling an invented ladder by default is the least faithful option.**
   The book's actual exit-management guidance is p.19: *"Trendlines can be
   used to run your profits… This trendline can now be used as a trailing
   stoploss on candle closing basis."* That is a **trailing stop**, not a
   partial ladder, and it is the one exit rule the book does state.
2. The **most faithful** resolution of DIV-05 may be to **implement the
   p.19 trendline trailing stop in both engines and drop the invented
   ladder** — which would satisfy the book, remove the divergence, and
   remove a block of invented parameters at the same time.

**Recommendation:** resolve DIV-05 in Stage 3 as a **decision**, with the
implementation deferred until the MTF extractor (which the trailing stop
needs) exists. Preferred direction: replace the invented ladder with the
book's trendline trailing stop, in both engines. If the ladder is kept, it
must be **disabled by default** and identical in both engines, so that
trade-level parity is measured on a rule both engines actually share.

**Note the dependency:** the p.19 trailing stop is evaluated *"on candle
closing basis"* on a *broader* trendline (p.19: *"Suitable time frames:
Intraday Trading - 15mins, Swing Trading - 1 Hour"*). It therefore depends
on the **same MTF extractor** as the stop placement. DIV-05's implementation
is gated on Step 3, not on a decision.

---

## 2. Group B — resolve before claiming trade-level parity, not before stop placement

### DIV-01 — risk per trade · `high` · stage 2 · **RESOLVE before parity claims**

| | |
|---|---|
| Python | `BacktestConfig.risk_per_trade = 0.01` (1%) |
| TypeScript | `DEFAULT_CONFIG.riskRules.maxRiskPerTrade = 0.02` (2%) — `config/default.ts:11` |
| Current status | `deferred` |

**Effect.** Position size is `equity × risk% / |entry − stop|`. A different
risk% gives a different size, a different notional, and therefore a different
P&L **in currency terms** for the *identical* signal. The two engines' trade
lists are not comparable line-by-line.

**Effect on stop placement.** **None.** The stop *price* is independent of
risk%. However, the stop *distance* feeds the size, and the size feeds the
equity, and the equity feeds the size of later trades — so a risk% difference
propagates through the whole run. It does not change *which* signals fire.

**Assessment: this is an execution-model difference that has been
mis-filed as a defect.** A 1% and a 2% risk budget are both legitimate, and
both are *inputs* to the experiment rather than properties of the strategy.
It is a **research parameter**, and it should be treated as one — varied
deliberately across the sensitivity analysis, not "fixed" so the engines
match.

**Recommendation:** do **not** align the two engines' defaults. Instead:

- record it explicitly as a **research parameter** whose value is part of the
  experiment, not a constant of the strategy;
- for **parity testing**, set it to a **common value in the harness** (the
  parity dump scripts already construct explicit configs) so that trade
  *prices* are comparable;
- keep the production defaults distinct, and label each as a risk policy
  choice.

This is the concrete case of the user's instruction to *"preserve
market-specific execution costs where appropriate"* extended to risk policy:
copying a number to make two engines agree is not the same as fixing a bug.

### DIV-03 — slippage · `high` · stage 2 · **RESOLVE before parity claims**

| | |
|---|---|
| Python | `slippage = 0.0005` (0.05% per side) — `engine.py:35` |
| TypeScript | `slippagePercent: 0.001` (0.1% per side) — `config/default.ts:19` |
| Current status | `deferred` |

**Effect.** Different fill prices → different P&L for every trade. Note the
TypeScript figure is labelled *"0.1% slippage assumption"* — an explicitly
**assumed** value, and the Python one is half of it. Neither is a broker
quote.

**Effect on stop placement.** The stop *price* is unaffected, but the *fill
price* is, so the realised risk `|entry − stop|` differs slightly, which
changes the R-multiple and therefore the target (since the target is a
structural level, and `MIN_TARGET_RR` gates whether it is used). A change
in the stop rule interacts with this.

**Assessment: market-specific.** Slippage depends on instrument, liquidity
and time of day. A single global percentage is an assumption in both engines;
there is no single correct value.

**Recommendation: do not align.** Instead:

- make the parity harness use a **common slippage** so that the *execution
  mechanics* can be compared, while leaving the engines' own assumptions
  intact;
- record both defaults in the spec as **assumptions** with their provenance
  (`invented`), and make it explicit that they are **not** strategy
  parameters and must not be tuned for profit.

### DIV-04 — commission / fee model · `high` · stage 2 · **RESOLVE before parity claims, but do not unify the models**

| | |
|---|---|
| Python | A flat `commission = 0.001` (0.1% per side) on executed notional — `engine.py:34` |
| TypeScript | A full Indian exchange fee model: brokerage + STT + GST + stamp duty + SEBI charges + slippage (`core/ExecutionSimulator.ts`) |
| Current status | `deferred` |

**Assessment: this is the clearest case in the whole audit of a divergence
that must NOT be aligned.**

The two models are not differently-valued versions of the same thing; they
are **structurally different**. The TypeScript model is a genuine Indian
equity fee stack with segment-specific rates, buy/sell-side-specific taxes
(STT and stamp duty are side-dependent), and brokerage slabs. The Python
model is a flat approximation.

For the project's actual market (NSE equities, per `app-ts/config/` and the
Indian-market adapters), the TypeScript model is **more accurate**, and
replacing it with a flat 0.1% would make the production engine *worse*. The
research engine's flat rate is a reasonable simplification for fast
hypothesis-testing, and it should be *labelled* as such.

**Recommendation:**

1. **Do not unify.** Keep the TypeScript fee stack; keep the research
   engine's flat rate for research speed.
2. **Label the research engine's rate explicitly** in the spec as
   `invented` and as a **research approximation**, not a market fact.
3. **Quantify the gap** once, offline, so the size of the approximation is
   known rather than assumed — e.g. compare the two models on a representative
   NSE order (a ₹50,000 turnover, delivery and intraday) and record the
   round-trip difference in basis points. If the gap is material (>50 bps
   round trip), the research engine's *reported* net P&L is systematically
   optimistic or pessimistic and the spec must say which.
4. For **parity testing**, run the parity harness with a **common** cost
   model, and keep the divergence recorded as a deliberate, labelled
   difference.

> **The user's constraint is explicit here:** *"Preserve market-specific
> execution costs where appropriate."* The TypeScript model's STT, stamp
> duty, GST and SEBI components are exactly that.

---

## 3. Group C — safely deferrable; aligning them would be a mistake

### DIV-06 — gap fill at open · `medium` · stage 2 · **DEFER, and do not align blindly**

| | |
|---|---|
| Python | `fill_gaps_at_open = True`: if the bar opened beyond the entry, the order fills **at the open** rather than at the limit price (`engine.py:288-295`). |
| TypeScript | Only **partial-profit exits** honour the gap; the **initial entry** fills at the limit price. |
| Current status | `open` |

**Effect.** A gapped entry produces a different fill price in each engine.

**Why it is *not* simply a bug.** These are **different order types**, and
each is right for its own order:

- A **resting limit** order (buy at 30.567) that the market gaps *below* to
  30.10 **fills at 30.10** — it gets a better price, because the market
  offered it. This is the Python behaviour and it is the correct treatment
  of a limit order.
- A **stop-limit / stop-market** order (buy when price *rises* through
  30.567) that the market gaps *above* to 30.90 fills at **30.90**, not at
  the limit — the limit price was never offered. The TypeScript behaviour
  (fill at the limit price) is **wrong for a gapped-through stop order**.

So the divergence is partly real and partly a modelling choice that is
currently inconsistent *within* the TypeScript engine (gaps honoured on
exits, ignored on entries).

**Recommendation: defer, with a directed fix that is not a number-copy.**

- The Python behaviour (fill at the open when gapped through) is the correct
  model for a resting limit order, and should be the **shared** rule.
- The TypeScript engine should be made to **honour the gap on the initial
  entry** as it already does on partial exits. This is a genuine
  **consistency fix within one engine**, not a cross-engine number copy.
- Both engines should then document whether their entry is a resting limit
  (gap-through fills at the open, favourably) or a stop order (gap-through
  fills at the open, unfavourably). **The direction matters** and the current
  spec does not say which.

**Effect on stop placement:** none directly. But a gapped fill changes the
realised risk, so the R-multiple and hence the target can change. The gap
rule and the stop rule interact through the target's R:R gate, so this is
worth fixing *before* the stop rule lands, but it does not block it.

### DIV-07 — intrabar policy · `medium` · stage 2 · **DEFER, but make the TypeScript engine express it**

| | |
|---|---|
| Python | `intrabar_policy` is **configurable**: `stop_first` (default), `target_first`, `worst_case`, `intrabar` (uses finer-grained series). See `engine.py:405-425`. |
| TypeScript | **Implicit** stop-first, not configurable: `PaperTradingEngine.ts:509-510` checks the stop before the target. |
| Current status | `open` |

**Assessment.** The two engines **agree by default** — Python's default is
`stop_first` and TypeScript is stop-first. The divergence is that the
production engine **cannot express the alternatives**.

**Effect on stop placement:** **none** — the policy governs *which* exit
fires on an ambiguous bar, not *where* the stop is. But it becomes
important the moment the stop rule changes, because **a new stop changes
which bars are ambiguous**: a wider stop is more likely to be inside a bar's
range alongside the target, so the frequency of ambiguous bars changes with
the stop rule. If the policy is not configurable in the production engine, an
ambiguity change cannot even be *measured* there.

**Recommendation: defer the divergence, but close the capability gap.** Make
the TypeScript engine's intrabar policy configurable with the **same
vocabulary and the same default** (`stop_first`). This is a **capability
parity** fix, not a behaviour change — the default behaviour does not move,
and no number is copied. The `worst_case` and `intrabar` policies stay
Python-only until there is a reason to implement them.

### DIV-11 revisited — see Group A.

*(DIV-11 is in Group A; it is not repeated here.)*

---

## 4. Group summary

| ID | Concern | Group | Must resolve in Stage 3? | Why |
|---|---|---|---|---|
| **DIV-10** | Order invalidation | **A** | **Yes — first** | The stop *is* the invalidation input. A stop change alters which trades exist. Fixing it after the stop rule makes the stop rule unverifiable. |
| **DIV-11** | Entry fill condition | **A** | **Yes** | The book says *"no need to wait for any kind of candle closing confirmation"* (p.17) and *"as soon as the price reaches"* (p.16). The TypeScript rule contradicts the book. This is a strategy rule, not a market fact. |
| **DIV-05** | Partial take-profit | **B** | Decision yes; implementation after the MTF extractor | Changes exit economics, not the stop. The ladder is **`invented`**; the book's rule is the p.19 trendline trailing stop, which needs Step 3. |
| **DIV-01** | Risk per trade | **B** | No | A research parameter, not a strategy constant. Vary it deliberately; do not copy it. |
| **DIV-03** | Slippage | **B** | No | Market-specific assumption. Common value in the harness; distinct production values. |
| **DIV-04** | Commission / fees | **C** | No | The TypeScript model is the accurate one for the target market. Unifying would degrade it. |
| **DIV-06** | Gap fill at open | **C** | No | But fix the *intra-engine* inconsistency (gaps honoured on exits, not entries) — a real correctness fix, not a cross-engine copy. |
| **DIV-07** | Intrabar policy | **C** | No | Behaviours already agree. Close the *capability* gap so ambiguity can be measured in production. |

### Recommended Stage 3 order of operations

```
1.  DIV-10  (spec decision)  — the stop is the input to invalidation
2.  DIV-11  (spec decision)  — the book's entry trigger, and it interacts
                                 with the shipped ENTRY_MODEL
3.  Step 3 extractor (design → implement)
4.  Stop rule implementation, using 1 and 2 as the fixed baseline
5.  Re-run parity; the signal count may change — REPORT it, do not absorb it
6.  DIV-05 decision (trailing stop vs ladder); implementation after the
    extractor exists
7.  DIV-06 intra-engine gap fix; DIV-07 capability fix
8.  DIV-01/03/04: common values in the harness only; production values stay
    distinct and labelled
```

**Steps 1 and 2 must precede step 4.** Implementing the stop rule first would
mean validating it against engines that disagree about whether the trade
exists and whether the entry triggered — which would make any parity result
uninterpretable, and any change in signal count unattributable.

---

## 5. Status changes proposed for the spec

| ID | Current | Proposed | Reason |
|---|---|---|---|
| DIV-01 | `deferred` | `deferred` (unchanged) | Deliberate: a research parameter. The rationale should be rewritten to say so, rather than reading as an unresolved defect. |
| DIV-03 | `deferred` | `deferred` (unchanged) | Deliberate: market-specific. |
| DIV-04 | `deferred` | `deferred` (unchanged) | Deliberate: the TypeScript model is more accurate for the target market. |
| DIV-05 | `deferred` | **`open`** | Its status depends on a decision that has not been made (trailing stop vs ladder), and it blocks trade-level parity claims. It is not "deferred" in the sense of "not a defect" — the `deferred` status in the spec's own convention means *"deliberate… or out of scope"*, which fits the *divergence* but the underlying *decision* is still open. |
| DIV-06 | `open` | **`deferred`** once the intra-engine gap fix lands | After the fix the behaviours agree and the remaining difference is a documented order-type choice. |
| DIV-07 | `open` | **`deferred`** once the TypeScript policy becomes configurable | The behaviours already agree; the gap is a capability gap. |
| DIV-10 | `open` | `open` → **`resolved`** once decided and implemented in Stage 3 | Must be resolved before the stop rule lands. |
| DIV-11 | `open` | **`resolved`** (`touch_only`; both engines) | Book-explicit; close-beyond rejected. |

> **A note on the `deferred` semantics.** The spec's own convention defines
> `deferred` as *"The difference is deliberate (for example market-specific
> execution economics) or out of scope for the current stage. It is not a
> defect."* That definition fits DIV-01, DIV-03, DIV-04, and (after the
> proposed fixes) DIV-06 and DIV-07. It does **not** fit DIV-05, whose
> current `deferred` status is really masking an undecided design question
> that Stage 2's finding (the ladder is invented) has now made explicit.

---

## 6. Open questions for review

| # | Question | Options | Analysis leans to |
|---|---|---|---|
| **Q13** | DIV-10: which order semantics? | (a) stop-already-broken ⇒ order dead; (b) plain resting limit, no invalidation | **(a)** — an entry whose stop has already been violated is not a trade the method would take. Must be settled **before** the stop rule. |
| **Q14** | DIV-11: touch-only or touch-and-close? | (a) touch only; (b) touch and close on the entry side | **RESOLVED (a)** — touch only. p.16/p.17 are explicit; close-beyond is rejected by the book. Both engines implement it. |
| **Q15** | DIV-05: trailing stop, or partial ladder? | (a) implement p.19's trendline trailing stop, drop the invented ladder; (b) keep the ladder, disabled by default, identical in both engines | **(a)** — it is the book's rule, it removes a block of invented parameters, and it removes the divergence. (b) is the fallback if the trailing stop proves too dependent on the extractor. |
| **Q16** | DIV-01/03: common values in the harness? | (a) yes, harness-only; (b) align the production defaults too | **(a)** — the harness needs a controlled comparison; the production values are assumptions about the market and should not be equalised. |
| **Q17** | DIV-06: is the entry a resting limit or a stop order? | (a) resting limit (gap-through fills at the open, favourably); (b) stop order (gap-through fills at the open, unfavourably) | **(a)** — the entry is placed at a *level price* the market has traded through many times (the liquidity zone), which is a limit. It must be stated, because the two behave differently on a gap. |
| **Q18** | Should the `ENTRY_MODEL` (rejection candle) be resolved together with DIV-11? | (a) yes, together in Stage 3; (b) defer `ENTRY_MODEL` to Stage 4 as planned | **(a)** is cleaner — both concern the entry trigger, and resolving them separately creates a half-state. But `ENTRY_MODEL` was explicitly scheduled for Stage 4, so **(b)** is defensible on process grounds. Needs a ruling. |
