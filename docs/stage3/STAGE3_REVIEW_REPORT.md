# Stage 3 — Review report

**Repository:** `/Users/harshavardhanreddy/projects/shades`
**Primary authority:** `data/The Trader's Playbook_TSOT.pdf` (20 pages)
**Scope:** Steps 1–5 of Stage 3, plus the **Phase 3 implementation review**
(§12). Steps 1–2 are complete; Steps 3–4 are analysis and design;
**no production stop-placement logic has been changed.**

> **Awaiting approval.** Per the Stage 3 instruction — *"Wait for approval of
> the proposed decisions before proceeding to implementation"* — this report
> ends with a list of decisions that need a ruling. 18 open questions are
> listed across three documents.

---

## 1. Specification inconsistencies corrected in Step 1

| # | Issue | Resolution | Where |
|---|---|---|---|
| 1.1 | DIV-13 described a resolved divergence in unresolved terms | Rewritten to reflect its resolved state; `status: resolved` | `strategy_spec.json` |
| 1.2 | No consistent status vocabulary across the 13 divergences | Added `status_conventions` block defining `resolved` / `open` / `deferred`; every divergence now carries a `status` and every divergence a `status_meaning` | `strategy_spec.json` |
| 1.3 | AMB-05 had `resolution_stage: 2` yet remained among the ambiguities | Marked `resolved` with a `resolution_note` recording that it was settled in Stage 2 and retained only for auditability | `strategy_spec.json` |
| 1.4 | Timestamp comparisons used string prefixes | Replaced with true instant comparison. A helper parses ISO strings, treats naive values as UTC, and compares timezone-aware instants | `research-py/tests/test_trade_parity.py` |
| 1.5 | `*.egg-info/` not ignored | Added `*.egg-info/` and `.eggs/` | `.gitignore` |
| 1.6 | Divergences and ambiguities were unvalidated in both loaders | Added `_validate_divergences()` / `_validate_ambiguities()` (Python) and `validateDivergences()` / `validateAmbiguities()` (TypeScript): valid status, no duplicate IDs, referential integrity to real parameters | `research-py/src/strategies/strategy_spec.py`, `app-ts/src/strategies/strategySpec.ts` |

**On 1.4 — why the change matters.** The previous `text[:19] == text[:19]`
comparison passed even when one engine attached a timezone offset to the same
wall-clock digits. I verified this directly: for `'2024-01-03T07:00:00'`
versus `'2024-01-03T07:00:00.000+05:30'`, the string comparison reports
**equal** while the instant comparison correctly reports a **5½-hour
difference**. The test also now actually compares the two engines' SHORT
signal instants, which the previous version did not do — it only asserted
that the TypeScript set was non-empty.

**On 1.6 — the SQLite runtime files.** `app-ts/data/trades.db-shm` and
`app-ts/data/trades.db-wal` are tracked and show as modified. I verified
that **the test suite does not write them** (mtimes were identical before and
after a full `jest` run) and that the `-wal` mtime (22 Apr) **predates this
session entirely**. They were left untouched, as instructed.

**Verification of 1.5's effect:** `git check-ignore` now matches
`research-py/src/shades_research.egg-info/`, and `git status` no longer lists
it.

---

## 2. Source-backed analysis of the three stop-placement rules

Full analysis, with the measurement method and the calibration errors:
**[`docs/stage3/STOP_PLACEMENT_ANALYSIS.md`](STOP_PLACEMENT_ANALYSIS.md)**.

### 2.1 Summary

| | EM1 (p.16) | EM2-A (p.17) | EM2-B (p.17) |
|---|---|---|---|
| **Book text** | "slightly above the next retracement whilst keeping a suitable distance away from the trendline" | "above the next fib level & above the broader ongoing trendline" | "slightly above the latest swing high & above the broader trendline" |
| **Entry** | price reaches the liquidity zone | trendline break, no close confirmation | (as EM2-A) |
| **Direction in the chart** | short | short | **long** |
| **Entry anchor** | 50% fib level = 30.567 | 50% fib level = 30.567 | 50% fib level = 74.02 |
| **Level reference** | 61.80% = 30.985 | 61.80% = 30.985 | last swing high ≈ 74.29 |
| **Drawn stop** | **31.043** | **31.041** | **74.498** |
| **Buffer** | +0.058 (0.098 ATR) | +0.056 (0.047 ATR) | +0.26 (0.335 ATR) |
| **78.6% level used?** | **No** (31.580) | **No** (31.580) | **No** (74.55) |

### 2.2 Method

The prose is unquantified, but the author **draws** each stop. Those drawings
are the only quantitative evidence in the source, so pages 16–18 were rendered
at 300 DPI and measured: Fibonacci level lines located by colour signature,
the chart's own printed price labels used as calibration points, the stop
identified as the top edge of the pink region, trendlines fitted by colour,
and ATR estimated from the chart's candles.

**Calibration error:** 0.0083 (p.16), 0.0111 (p.17), 0.0043 (p.18) on price
ranges of 2.0, 2.0 and 0.9 — i.e. ~0.5% of range, well inside the gaps whose
meaning is being decided.

### 2.3 Three findings that change how the rules must be read

1. **"Next" means "nearest beyond the entry on the risk side."** The author
   used the 61.8% level in both EM1 and EM2-A, and did **not** use 78.6% in
   any of the three charts. A "next ratio in the sequence regardless of side"
   reading is unsafe because it can select a level on the *profit* side of the
   entry, which cannot bound a stop.

2. **The p.16 and p.17 charts are one observation, not two.** They show the
   same instrument, the same Fibonacci level prices, and the same drawn stop
   (31.043 vs 31.041, agreeing to 0.002). AMB-03 and AMB-04 therefore resolve
   to the same level and are **not independently confirmed**.

3. **The author uses no single buffer.** The observed band is 0.05–0.34 ATR.
   Any single value is an invention and must be treated as an overfitting
   candidate, never tuned for profit.

### 2.4 What the code does today

Both engines use `recent_confirmed_swing_plus_10pct_buffer` — an **invented**
rule matching **none** of the book's three methods. Neither engine can
evaluate the broader-trendline constraint: the Python engine has no MTF
capability at all, and the TypeScript engine builds HTF candles only for the
EMA-bias `MTFAnalyzer`, which extracts no trendlines and whose output never
reaches `calculateStopLoss`.

### 2.5 A finding beyond the three rules

Verifying the book's exit-management guidance against the PDF (needed to
audit DIV-05) surfaced a **misattribution in the specification itself**.

`PARTIAL_TAKE_PROFIT` was tagged `provenance: "book"` with a p.18 citation:
*"Partial Profits (Optional) - Consider partial at 1:1 or 1.5:1 R:R - Trail
remainder with trendline - Reduces risk, locks in gains"*.

**That passage does not exist in the PDF.** Two independent extractors
(`pypdf` and `PyMuPDF`) find no occurrence of *"Partial"*, *"Optional"*,
*"1:1"*, *"1.5:1"*, *"locks in gains"* or *"Trail remainder"* anywhere in the
20 pages. The text layers of pages 16–19 were inspected directly. The words
are **verbatim from this repository's own**
`docs/techniques/05-entry-models-trade-management.md` (lines 106–109) — a
repo-authored summary, not the source methodology.

Consequences:

- The 50/30/20 ladder at 1R/2R/3R is **entirely invented** and has no
  support in the source. The parameter has been reclassified `book` →
  `invented`, with the reasoning recorded in full.
- The book's **only** stated exit rule is p.19: *"This trendline can now be
  used as a trailing stoploss on candle closing basis."* — a **trailing
  stop**, not a partial ladder.
- A **regression test** now verifies every `book`-tagged passage against the
  PDF (`TestBookCitationVerification`, Python). I confirmed it fails when the
  misattribution is reintroduced and passes when it is removed.

The same scrutiny found that `MTF_TIMEFRAME_HIERARCHY`, tagged `book`, has a
**mapping that p.9 does not state** — p.9 gives time-frame *roles*, not a
time-frame-to-time-frame mapping. The spec's own status field already
admitted this (*"the pairing is inferred; the roles are book-derived"*) while
the `provenance` field claimed `book`. **This is flagged for correction in
Stage 4** (see §5, Q7) and is the second instance of the same failure mode.

---

## 3. Proposed resolutions for AMB-03 and AMB-04

Both are now recorded in the spec as `resolved`, with the supporting
parameters added. **Neither can be classified `book`** — the book states the
rules in prose and demonstrates them on one chart, but never defines "the next
retracement", never defines "next", and never says the selection is relative
to the entry.

### AMB-03 — "the next retracement" (EM1, p.16)

**Options considered**

| | Option | Verdict |
|---|---|---|
| **A** | The next Fibonacci retracement level above the entry | **Adopted** |
| **B** | The nearest confirmed swing extreme beyond the entry | **Rejected** — contradicted by the p.16 chart, where the nearest swing highs are in the 31.5–32.3 region, materially above the 31.043 stop the author drew |
| **C** | A percentage pullback of the entry leg | **Rejected** — no supporting quantity in the chart |

**Adopted:** *the nearest Fibonacci retracement level from the book's ratio
set that lies beyond the entry price on the risk side.*
Recorded as `NEXT_RETRACEMENT_SELECTION`, `provenance: inferred`.

### AMB-04 — "the next fib level" (EM2-A, p.17)

**Options considered**

| | Option | Verdict |
|---|---|---|
| **A** | The nearest retracement level beyond the entry on the risk side | **Adopted** |
| **B** | A fixed 78.6% level | **Rejected** — the author did not use 78.6% in any of the three charts |
| **C** | The next ratio in the sequence, regardless of side | **Rejected** — can select a level on the profit side of the entry, which cannot bound a stop |

**Adopted:** *the nearest retracement level from `{23.6%, 38.2%, 50%, 61.8%,
78.6%}` that lies beyond the entry price on the risk side.* Recorded as
`NEXT_FIB_LEVEL_SELECTION`, `provenance: inferred`.

### Supporting decisions also recorded

| Parameter | Provenance | Content |
|---|---|---|
| `STOP_LEVEL_COMBINATION` | `inferred` | `max_of_level_and_broader_trendline_then_add_buffer` — "beyond both" means the more conservative of the two. From the prose, **not** the charts: the trendline constraint is slack in both worked examples. |
| `EM2B_SWING_SELECTION` | `inferred` | The most recent **confirmed** swing extreme on the risk side, including the entry leg's own swing (p.18's "little to no chance of that level getting tested again"). |
| `STOP_BUFFER_ATR` | `invented` | 0.1 ATR — inside the 0.05–0.34 ATR band the author's own charts show, scale-free, and explicitly flagged as an overfitting candidate. **Supersedes** the old `STOP_LOSS_BUFFER` (10% of distance), which was also invented and scale-dependent. |

### Honest limitation

The evidence base is **n = 1 instrument** — and effectively one observation,
since p.16 and p.17 show the same chart. A single worked example is a worked
example, not a validated rule. Every parameter above says so in its `status`
field. These are defensible readings of the source, not established facts,
and they should be treated as hypotheses to be tested, not parameters to be
tuned.

---

## 4. Multi-timeframe trendline extractor design

Full design, invariants and test plan:
**[`docs/stage3/MTF_TRENDLINE_DESIGN.md`](MTF_TRENDLINE_DESIGN.md)**.

**Pipeline:** resample to the higher time frame → drop the forming HTF
candle → find confirmed swings → build candidate lines from same-type swing
pairs → filter by touch count → evaluate at the entry bar.

**Key decisions**

- **Causality is enforced structurally, not by convention.** The Python
  engine already has `find_confirmed_swings` returning `confirmed_at` and
  `filter_confirmed_swings`; the extractor uses these. The TypeScript
  `findSwingPoints` must be given the same semantics — that is required work.
- **The TypeScript resampler already does the right thing.**
  `CandleResampler.resample` drops both a short final chunk and a full final
  chunk not terminated by the last input candle, with an explicit comment
  citing the completed-HTF-candle rule. **Reuse as-is.** The Python
  `resample_ohlcv` uses `.dropna()`, which **keeps the forming bucket** — a
  genuine lookahead hazard that must be fixed.
- **The most important test is a prefix test.** Running the extractor on a
  prefix and on the full series must give an **identical** result at the
  prefix's last bar. That single test catches every lookahead path (L1–L6)
  at once and should be written first.
- **No scoring, no weights, no invented selection criteria.** The book
  (p.19) both claims "more touchpoints, stronger trendline" and warns that
  "if it is hitting more often, it means it's getting weaker" — the two
  halves conflict, so a touch-count ranking is not derivable. The extractor
  returns the **set** of valid lines and the stop rule takes the binding
  one, which is exactly the semantics "beyond the broader trendline" needs.
- **Two divergent time-frame hierarchies already exist in TypeScript** and
  disagree with each other (`types/mtf.ts` says `1m → 15m`;
  `core/CandleResampler.ts` says `1m → 5m`). Both must collapse onto the
  spec, or the extractor would be a third answer.
- **The NSE session is 375 minutes**, which is not a multiple of 240. A 4h
  resample of NSE data does not tile the session evenly. The bucketing
  convention must be defined **once** and shared, or the engines will diverge
  silently. This is a known risk, called out in the test plan.

---

## 5. Dependency map — what must be resolved in Stage 3

Full audit: **[`docs/stage3/DIVERGENCE_AUDIT.md`](DIVERGENCE_AUDIT.md)**.

The governing distinction, applied throughout: **strategy-rule parity** (do
both engines place the stop the same way?) is governed by the book;
**execution-model parity** (do both engines charge the same and fill the
same?) is governed by the market. They are not the same question, and
"aligning" the second to make the engines agree is not a fix.

| ID | Concern | Group | Stage 3? | Reason |
|---|---|---|---|---|
| **DIV-10** | Order invalidation | **A** | **Yes — first** | The stop **is** the invalidation input. Changing the stop changes which trades exist, so fixing this *after* the stop rule would make the stop rule unverifiable and any change in signal count unattributable. |
| **DIV-11** | Entry fill condition | **A** | **Yes** | The book says *"as soon as the price reaches"* (p.16) and *"no need to wait for any kind of candle closing confirmation"* (p.17). TypeScript's `AND candle.close >= signalPrice` **is** a close-confirmation requirement. This is a strategy rule, not a market fact. |
| **DIV-05** | Partial take-profit | **B** | Decision now, implementation after the extractor | Changes exit economics, not the stop. The ladder is **`invented`**; the book's rule is p.19's trendline trailing stop, which needs the extractor. |
| **DIV-01** | Risk per trade | **B** | No | A research parameter (1% vs 2%), not a strategy constant. Vary it deliberately; do not copy it. |
| **DIV-03** | Slippage | **B** | No | Market-specific assumption. Common value **in the harness**; distinct production values. |
| **DIV-04** | Commission / fees | **C** | No | TypeScript's model is a genuine Indian fee stack (brokerage + STT + GST + stamp duty + SEBI) and is **more accurate** for the target market. Unifying it with Python's flat 0.1% would make the production engine **worse**. |
| **DIV-06** | Gap fill at open | **C** | No | Different order types, each correct for its own order. But TypeScript honours gaps on exits and **not** on entries — a real *intra-engine* inconsistency worth fixing. |
| **DIV-07** | Intrabar policy | **C** | No | The behaviours **already agree** (Python's default is `stop_first`). The gap is *capability*: TypeScript cannot express the alternatives, so ambiguity cannot be measured there. |

### Recommended order of operations

```
1.  DIV-10  (spec decision)  — the stop is the input to invalidation
2.  DIV-11  (spec decision)  — the book's entry trigger
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
exists and whether the entry triggered — making any parity result
uninterpretable.

### Divergence status changes made in the spec

| ID | Before | After | Reason |
|---|---|---|---|
| DIV-05 | `deferred` | **`open`** | Its `deferred` status masked an undecided design question that Step 2's finding has now made explicit. |
| DIV-06 | `open` | `deferred` | Once the intra-engine gap fix lands, the remainder is a documented order-type choice. |
| DIV-07 | `open` | `deferred` | The behaviours already agree; the gap is a capability gap. |

Totals: **2 resolved, 7 deferred, 4 open** (was 2 resolved, 5 deferred, 6
open).

---

## 6. Test plan

Full plan: `MTF_TRENDLINE_DESIGN.md` §8. Summary of coverage.

| Area | Cases |
|---|---|
| **Lookahead prevention** | L1–L6 invariants; the **prefix test** (extractor output at a prefix's last bar must be identical to the full run) as the primary guard |
| **Python/TypeScript equivalence** | T1 causality, T2 HTF fixture, T3 resampler, T4 swings, T5 boundary, T6 NSE session |
| **Long/short stops** | T7–T10: EM1, EM2-A and EM2-B, each in both directions |
| **Missing structural levels** | T11 no Fibonacci, T12 no broader trendline, T15 no confirmed swing |
| **Wrong-side references** | T13 Fibonacci level on the profit side; T14 trendline on the wrong side |
| **Binding constraint** | T16 — the trendline binds where the Fibonacci level does not. **The book's charts never exercise this case, so it must be constructed.** |
| **Ambiguous bars** | T17 — a bar touching both stop and target; `INTRABAR_POLICY` governs |
| **Gaps** | T18 — a gap through the stop; `GAP_FILL_AT_OPEN` governs |
| **Scale invariance** | T19 — the same setup at 10× price must give 10× stop width and the same R-multiple. Guards against a percentage buffer sneaking back in |
| **Spec drift** | T20–T21 — the extractor's parameters must equal the spec's live values; no hidden constants |
| **Citation integrity** | New: every `book` passage must exist in the PDF |

---

## 7. Files that would need to change (implementation — not yet done)

**Canonical spec** — `shared/fixtures/strategy_spec.json`
: set `STOP_LOSS_RULE`; retire `STOP_LOSS_BUFFER` → `STOP_BUFFER_ATR`; add
HTF mapping / swing policy / selection policy / missing-trendline behaviour /
HTF completion parameters; decide DIV-10 and DIV-11; correct
`MTF_TIMEFRAME_HIERARCHY` provenance.

**Python** — `research-py/src/data/loaders.py` (causality-aware
`resample_ohlcv`), `research-py/src/indicators/trendlines.py` (extractor),
`research-py/src/patterns/confluence_zone.py` (stop rule),
`research-py/src/strategies/strategy_spec.py` (expose new parameters).

**TypeScript** — `app-ts/src/indicators/trendlines.ts` (extractor),
`app-ts/src/indicators/swingPoints.ts` (`confirmed_at`),
`app-ts/src/patterns/BasePattern.ts` (carry HTF candles to the pattern),
`app-ts/src/patterns/ConfluenceZonePattern.ts` (stop rule),
`app-ts/src/core/CandleResampler.ts` and `app-ts/src/types/mtf.ts` (collapse
the duplicate hierarchies), `app-ts/src/core/LiveMonitor.ts` and
`app-ts/src/core/MultiSymbolMonitor.ts` (pass HTF through),
`app-ts/src/strategies/strategySpec.ts` (expose new parameters).

**Parity** — new `scripts/mtf_parity_dump.py` and
`app-ts/src/cli/mtfParityDump.ts`; new `shared/fixtures/mtf_parity_*.csv`;
new `research-py/tests/test_mtf_trendlines.py` and
`app-ts/tests/mtf-trendlines.test.ts`; extend both spec test files.

### Files changed in Stages 1–2 of this report

| File | Change |
|---|---|
| `shared/fixtures/strategy_spec.json` | status conventions; AMB-03/04 resolved; AMB-08 added; 5 new parameters; `PARTIAL_TAKE_PROFIT` reclassified; DIV-05/06/07 statuses |
| `research-py/src/strategies/strategy_spec.py` | divergence + ambiguity validation |
| `app-ts/src/strategies/strategySpec.ts` | divergence + ambiguity validation |
| `research-py/tests/test_strategy_spec.py` | +13 tests (status convention, citation verification) |
| `app-ts/tests/strategy-spec.test.ts` | +9 tests (status convention) |
| `research-py/tests/test_trade_parity.py` | instant timestamp comparison; real cross-engine signal comparison |
| `.gitignore` | `*.egg-info/`, `.eggs/` |
| `docs/stage3/*.md` | this report and the three analysis documents (new) |

---

## 8. Tests currently passing, and failures

| Suite | Result |
|---|---|
| **Python** (`research-py`, pytest) | **183 passed**, 0 failed |
| **TypeScript** (`app-ts`, jest) | **90 passed**, 0 failed, 7 suites |
| **Type-check** (`npx tsc --noEmit`) | **clean**, exit 0 |

**No failures. No tests were skipped or disabled.** The two new citation
tests skip only if the PDF is absent from the checkout or `pypdf` is not
installed — both are present here, so they ran.

**No parity fixture was regenerated, and no expected value was changed.**
The existing parity expectations were produced by the old stop rule and
remain valid for the old rule.

### A note on the pre-existing tracked SQLite files

`app-ts/data/trades.db-shm` and `app-ts/data/trades.db-wal` show as modified
in `git status`. I verified that the test suite does **not** write them
(mtimes identical before and after a full `jest` run) and that the `-wal`
mtime predates this session. They were left untouched, per the instruction
not to remove or overwrite tracked SQLite runtime files without explicit
justification.

---

## 9. Decisions required before implementation

### Blocking — needed before the stop rule can be implemented

| # | Question | Options | Analysis leans to |
|---|---|---|---|
| **Q13** | DIV-10: which order semantics? | (a) stop-already-broken ⇒ order dead; (b) plain resting limit | **(a)** |
| **Q14** | DIV-11: touch-only or touch-and-close? | (a) touch only; (b) touch and close | **RESOLVED (a)** — see §10. Close-beyond rejected by the book. |
| **Q1** | No broader trendline available under EM2-A: | (a) fall back to the Fibonacci level; (b) reject the signal | **(b)** — p.18 treats a missing confirmation as a reason to wait; but (a) preserves trade count |
| **Q2** | Combining level and trendline: | (a) hard `max`/`min`; (b) a minimum-separation distance | **(a)** — the prose states two positional constraints |
| **Q3** | One shared buffer, or per-model? | (a) shared; (b) per-model | **(b)** — the measurements differ by ~7×; but (b) adds parameters |
| **Q4** | Buffer applied to the binding reference, or to each? | (a) binding; (b) each, then take the max | **(a)** — (b) double-counts |
| **Q5** | EM1's "distance away from the trendline": | (a) beyond the trendline; (b) not too close | **(a)** for symmetry with EM2-A |
| **Q6** | Which Fibonacci levels are eligible? | (a) the book's five ratios only; (b) any computed level | **(a)** — `FIB_RATIOS` is `book`-derived (p.10) |

### Non-blocking — needed before trade-level parity can be claimed

| # | Question | Options | Analysis leans to |
|---|---|---|---|
| **Q15** | DIV-05: trailing stop or partial ladder? | (a) p.19 trendline trailing stop, drop the invented ladder; (b) keep the ladder, disabled by default, identical in both engines | **(a)** — it is the book's rule, and it removes both the divergence and a block of invented parameters |
| **Q16** | DIV-01/03: common values in the harness? | (a) harness only; (b) align production defaults too | **(a)** |
| **Q17** | DIV-06: is the entry a resting limit or a stop order? | (a) resting limit; (b) stop order | **(a)** — the entry is at a level price the market has traded through repeatedly |
| **Q18** | Resolve `ENTRY_MODEL` (rejection candle) together with DIV-11, or defer to Stage 4? | (a) together in Stage 3; (b) defer | **(a)** is cleaner — both concern the entry trigger — but (b) is defensible on process grounds since `ENTRY_MODEL` was scheduled for Stage 4 |

### Design decisions — needed before the extractor is implemented

| # | Question | Options | Analysis leans to |
|---|---|---|---|
| **Q7** | AMB-08: which time frame is "broader"? | (a) one step up; (b) fixed per trading style; (c) nearest with enough history | **Deliberately open.** The extractor will read the mapping from the spec, so this can be settled without touching the extractor |
| **Q8** | Which candidate trendlines are returned? | (a) all valid, stop rule takes the binding one; (b) a single selected line | **(a)** — it is the semantics the stop rule needs, and it avoids inventing a selection criterion |
| **Q9** | HTF swing parameters? | (a) reuse entry-timeframe values; (b) new dedicated parameters | **(a)** initially — fewer invented parameters |
| **Q10** | No broader trendline: reject, or fall back? | (a) reject; (b) fall back to the level | Tied to Q1 |
| **Q11** | Line extrapolation across the HTF boundary: | wall-clock vs session-aware duration | **Session-aware** is more correct for NSE, but both engines must agree exactly |
| **Q12** | HTF series: resampled or natively supplied? | (a) resampled; (b) native | **(a)** for parity; live NSE may need (b) |

---

## 10. DIV-11 correction (Phase 3 review)

**Question posed:** is the entry rule (a) touch/reach without candle close,
or (b) candle closes beyond the trigger level?

**PDF pp.16–17 (verbatim):**

- EM1 (p.16): *"As soon as the price reaches high liquidity zone, one can
  directly enter into the trade."*
- EM2 (p.17): *"entry must be planned as soon as the trendline gets broken
  & there is no need to wait for any kind of candle closing confirmation,
  at-least this is how I use it."*

**Verdict:** **(a) touch/reach, no candle-close wait.** The book is
explicit; this is not an interpretation. Option (b) — close beyond the
trigger — is the rule the author rejects.

**Engine inspection (current code):**

| Engine | Location | Behaviour |
|---|---|---|
| Python | `_resolve_entry_fill` | long: `bar.low <= entry`; short: `bar.high >= entry` |
| TypeScript | `isEntryHit` | long: `candle.low <= signalPrice`; short: `candle.high >= signalPrice` |

Both already implement touch-only. Spec `ORDER_FILL_CONDITION = touch_only`,
DIV-11 `status: resolved`.

**Contradiction that was corrected:** `STRATEGY_IMPLEMENTATION_PLAN.md`
Stage 4 previously required a detector that "fires when price **closes**
through the immediate trendline" while also citing the no-close-wait rule.
That draft wording has been rewritten to **touch/cross**. Spec parameter
`TRENDLINE_BREAK_DETECTION` now records that the eventual Stage 4
implementation must be `touch_beyond_line`, not `close_beyond_line`.

**Not claimed as book-derived:** how far beyond the line a "touch" must
extend (tolerance), and whether a wick-only pierce that never trades at
the line in the tape counts — the book does not specify. Those remain
interpretations for Stage 4 if they become necessary.

---

## 11. Statement of what has and has not been done

> **Snapshot note.** This section describes the repository at the end of
> Stages 1–2 of this report, **before** the Phase 3 implementation
> (extractor, causal resamplers, DIV-11 in code). §12 records what Phase 3
> changed and supersedes the statements marked "no longer true" below.

**Has been done**

- Step 1 complete: all six listed inconsistencies corrected, with the status
  convention, loaders, and tests updated and passing.
- Step 2 complete: all three rules analysed against the PDF, with the
  author's own charts measured; AMB-03 and AMB-04 resolved and recorded as
  `inferred`; a misattributed `book` citation found and corrected.
- Step 3 complete as a **design**: the extractor, its causality invariants,
  and its test plan are specified. **Nothing implemented.**
- Step 4 complete as an **audit**: all eight divergences classified, with
  three needing resolution in Stage 3, two before parity claims, and three
  safely deferrable.
- Step 5: this report.

**Has NOT been done**

- **No production stop-placement logic has been changed.** Both engines still
  use `recent_confirmed_swing_plus_10pct_buffer`. [§12: still true]
- No extractor has been implemented. [NO LONGER TRUE as of Phase 3 — the
  MTF extractor exists in both engines; see §12]
- No divergence has been resolved in code. [NO LONGER TRUE as of Phase 3 —
  DIV-11 is resolved in code; see §12]
- No parameter has been tuned, and no threshold changed for profitability.
  [§12: still true]
- No parity fixture has been regenerated. [§12: one fixture was extended
  (`mtf_parity_ts.json` gained the evaluated prices); see §12]

**No claim is made that this strategy is profitable.** The backtest evidence
in this repository is a small, in-sample trade count and is not evidence of
profitability. The findings in this report are about **rule fidelity and
correctness**, not about performance.

**One correctness note for the record:** the `MTF_TIMEFRAME_HIERARCHY`
provenance remains `book` in the spec, though its own status field admits
the pairing is inferred. Correcting it is scheduled with the AMB-08
resolution in Stage 4, so that the provenance change and the time-frame
choice are made together and reviewed as one decision. It is called out here
rather than left to be discovered.

---

## 12. Phase 3 implementation review — verification pass

This section records the focused review of the Phase 3 implementation, the
DIV-11 verification, and what was fixed for consistency. **No stop-placement
logic was implemented or changed; Phase 4 has not begun.**

### 12.1 DIV-11 — verified resolved, and stated consistently

**Source (verbatim, re-read for this pass):**

- EM1 (p.16): *"As soon as the price reaches high liquidity zone, one can
  directly enter into the trade"*.
- EM2 (p.17): *"entry must be planned as soon as the trendline gets broken &
  there is no need to wait for any kind of candle closing confirmation,
  at-least this is how I use it."*

**Rule therefore: touch/reach the trigger level, no candle-close wait.** A
long fills when the bar's LOW reaches the entry; a short when the bar's HIGH
reaches the entry — regardless of where the candle closes. Entry only after a
candle closes beyond the trigger level is the rule the author explicitly
rejects. This is book-settled, not an interpretation. This is exactly how the
spec, both engines, and the tests already read it:

| Engine | Location | Behaviour |
|---|---|---|
| Python | `backtesting/engine.py::_resolve_entry_fill` | long: `bar.low > entry` ⇒ no fill; short: `bar.high < entry` ⇒ no fill |
| TypeScript | `PaperTradingEngine.ts::isEntryHit` | long: `candle.low <= signalPrice`; short: `candle.high >= signalPrice` |

Spec `ORDER_FILL_CONDITION = touch_only`, provenance `book` (p.17), status
`RESOLVED`; `DIV-11` record status `resolved` with the correction note
(`close_beyond / touch_plus_close_confirmation` rejected). The Stage 4
`TRENDLINE_BREAK_DETECTION` parameter records the same no-close-wait rule
(`touch_beyond_line`) for EM2, and `ENTRY_MODEL`'s rejection candle remains
`invented`/open.

**Tests that keep it honest** (wick touches, candle closes on the wrong side
of the entry — discriminating vs the old close-confirmation rule):
`research-py/tests/test_backtest_engine.py::TestOrderFillCondition` and
`app-ts/tests/regression.test.ts` (DIV-11 describe block). Both fill as
required.

**What this pass fixed** (consistency, not the rule):

1. **The resolved-divergence guard tests were stale.** Both engines' spec
   tests asserted exactly `{DIV-12, DIV-13}` resolved; DIV-11 was resolved in
   code during Phase 3. The guards now assert `{DIV-11, DIV-12, DIV-13}` with
   the justification, and a DIV-11-specific resolved-record test was added on
   both sides.
2. **The TypeScript DIV-11 regression tests were not isolated.** They used
   the shared default SQLite repository (an open trade from one test leaked
   into the next — the short test found 2 open trades) and ran with realistic
   execution enabled by default (slippage moved the fill to 100.1 / 99.9).
   `makeEngine()` now builds an isolated temp-DB repository with
   `useRealisticExecution=false` and trailing stops disabled, so the DIV-11
   assertion tests exactly the fill condition.

### 12.2 The gap-fill parity scenario exposed a real, recorded divergence (DIV-06)

`LONG_GAP_FILL` (bar opens at 95.0, entry at 100.0) had been asserted — on
both engines — to fill **at the open (95.0)**. That assertion was wrong for
the TypeScript engine:

- **Python** fills at the gapped open: `fill_gaps_at_open=True`
  (`engine.py:288-295`), then closes the position at end of data
  (`END_OF_DATA`).
- **TypeScript** fills on touch at the **limit price (100.0)**: entry-gap
  handling is not implemented (this is the recorded, still-open DIV-06 —
  "gaps honoured on exits, not on entries"), and the harness applies no
  end-of-data close.

Additional harness defect: when a trade filled but never closed, the TS dump
returned **null entry fields**, so the parity test could not see that a fill
had happened at all.

**Fixes (no engine semantics changed):**

- The TS harness now reports a filled-but-open trade's entry details
  (`exit_reason = STILL_OPEN`).
- The parity test asserts the DIV-11 semantic in both engines (entry goes
  through — `entry_price is not None`) and **asserts the fill-price
  difference explicitly as DIV-06** (Python 95.0 vs TS 100.0), flagging that
  the expectation flips to 95.0 the day DIV-06 is implemented (T22 —
  deliberate, visible change, not an absorbed one). The scenario description
  and the `ALLOWED_DIFFERENCES` attribution were updated to DIV-06.

### 12.3 MTF extractor review (the four Phase 3 files)

Reviewed in full:
`research-py/src/indicators/mtf_trendlines.py`,
`app-ts/src/indicators/mtfTrendlines.ts`,
`research-py/src/data/loaders.py`, `app-ts/src/core/CandleResampler.ts`.

| Checklist | Verdict | Evidence |
|---|---|---|
| Only **completed** HTF candles used | **Pass** | Python `resample_ohlcv(drop_forming_bar=True)` drops a trailing bucket whose data does not reach the bucket end; TS drops a short final chunk and a full-final-chunk that is not terminated by the last input candle. Both verified by prefix/append-future tests. |
| Swing confirmation & visibility causal | **Pass** | Python `find_confirmed_swings` carries `confirmed_at = i + right_bars`; `filter_confirmed_swings` applied at the last completed HTF index. TS `findSwingPoints` now carries `confirmedAt` (additive); both extractors filter `confirmedAt <= asOf`. |
| Extrapolation uses the same convention | **Pass on aligned inputs** | Both: `price = intercept + slope * (anchor_index + (entry_ts − anchor_close) / htf_delta)`, anchored at the last completed HTF candle (open timestamp). The parity fixture now also compares the **evaluated price at the shared decision bar** (`prices_at` / `entry_ts`), which is the price a stop rule would consume. Caveat for non-aligned sources — see §12.4. |
| Long/short classification consistent | **Pass** | `SUPPORT` from swing lows, `RESISTANCE` from swing highs, identical enumeration order (support then resistance). |
| Missing data / invalid candidates | **Pass** | Empty set, never a fallback line; exposes diagnostics (`n_htf_candles`, swing counts, `last_htf_close`). The `HTF_TRENDLINE_MISSING_BEHAVIOUR = reject_signal` consumer decision is Phase 4. |
| ATR and tolerance consistent | **Pass** | Wilder ATR computed on the HTF series only (L6); `tol_price = atr * toleranceAtr`; identical algorithm and short-series fallback in both engines. |
| Parity compares meaningful outputs | **Pass** | Candle count, swing counts, last HTF close, the full line set (type, slope, intercept, start/end index, touches) — and now the evaluated price. Not just counts or empties. |

**Gaps for Phase 4** (recorded, not defects of this phase): the extractors
take their parameters as defaults (3, 3, 0.3, 2) rather than reading the
spec — the T20 spec-drift binding still needs a caller that reads
`MTF_TIMEFRAME_HIERARCHY` / `HTF_SWING_PARAMS` / `TRENDLINE_TOLERANCE_ATR`
(when AMB-08 picks the mapping).

### 12.4 Resampling changes — verified, with one overclaim corrected

**Leading-partial drop.** Python now drops the first wall-clock bucket when
the first source bar arrives after the bucket start (`loaders.py:440-441`).
This is independent of `drop_forming_bar`. Production consumers are limited
to the MTF extractor (nothing else calls `resample_ohlcv` outside tests), and
the resampler suites (Python + TS) cover prefix stability, append-future
invariance, the forming-bar drop, and the flag semantics. No unrelated
resampling behaviour changed; both full suites pass.

**Wall-clock claim was overstated.** The docs claimed both resamplers share
"the wall clock" / "epoch multiples". Measured counter-cases:

| Input | Python (pandas wall-clock) | TypeScript (sequential chunks) |
|---|---|---|
| 100 × 30m candles from 09:15 | 11 buckets @ 12:00, 16:00, … | 12 buckets @ 09:15, 13:15, … |
| 3 NSE days × 15m (09:15–15:30) | 12:00 d1, 08:00 d2, 12:00 d2 | 12:00 d1, 09:45 d2, 13:45 d2, 11:30 d3 |

The engines agree **only when the source contains a candle exactly on an HTF
boundary** (true for 15m/5m/1h/1m — and true for the shared parity fixture,
which both resolve to the same 24 candles and the same line). They diverge on
non-aligned offsets and on NSE session series (TS chunks cross the overnight
gap). This is the risk the design doc flagged under T6/Q11: the convention is
only "shared" on aligned inputs. `PHASE2_CAUSALITY.md` and the
`resample_ohlcv` docstring have been corrected to say so precisely, and the
extractor parity claim is now scoped to the aligned fixtures. **Remaining
decision: Q11/Q12** — wall-clock for all offsets (requires aligning the TS
chunker) vs session-aware bucketing for NSE (both engines, identically).

### 12.5 Spec staleness fixed

`HTF_COMPLETION` said *"NOT APPLICABLE to the research engine (no MTF)"* —
false since Phase 3. Updated to record that both engines implement it, with
the consumers (`resample_ohlcv` and both extractors) and the Phase 2/3 test
files listed.

### 12.6 Full validation (this pass)

| Suite | Result |
|---|---|
| **Python** (`research-py`, pytest) | **214 passed**, 0 failed |
| **TypeScript** (`app-ts`, jest) | **112 passed**, 0 failed, 11 suites |
| **Type-check** (`npx tsc --noEmit`) | **clean**, exit 0 |

No expected value was hand-edited to make tests pass. The only regenerated
fixture is `shared/fixtures/mtf_parity_ts.json`, which gained `entry_ts` and
`prices_at` (the evaluated line prices) — the line parameters are unchanged,
so the parity content is strictly extended, not rewritten.

### 12.7 Remaining design decisions (unchanged, awaiting approval)

- **AMB-08 / Q7** — which time frame is "broader"; the mapping stays data in
  the spec.
- **Q11** — line extrapolation duration across the HTF boundary: wall-clock
  vs session-aware (now sharpened by the measurements in §12.4).
- **Q12** — resampled vs natively supplied HTF series.
- **Q8 / Q9 / Q10** — trendline-set semantics, HTF swing params, missing
  trendline behaviour (decision recorded: `reject_signal`).
- **Q1–Q6, Q13–Q18** — the Phase 1 recorded decisions; **DIV-10**
  implementation and **DIV-06** entry-gap fix are Phase 4 items.
