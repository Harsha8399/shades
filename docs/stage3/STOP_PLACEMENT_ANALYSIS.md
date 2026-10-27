# Stage 3 — Step 2: The book's stop-placement rules, analysed against the source

> **Status: DESIGN ONLY. No production stop-placement logic has been changed.**
> This document, together with `MTF_TRENDLINE_DESIGN.md` and `DIVERGENCE_AUDIT.md`,
> is submitted for review. Implementation begins only after approval.

Repository: `/Users/harshavardhanreddy/projects/shades`
Primary authority: `data/The Trader's Playbook_TSOT.pdf` (20 pages)

---

## 0. Method, and why the charts were measured

The three stop-placement rules are stated in prose on pages 16–17, but the
prose is under-specified: "the next retracement", "the next fib level",
"slightly above" and "a suitable distance" are all unquantified. The author
also **draws** each stop on a chart. Those drawings are the only quantitative
evidence in the source, so they were measured.

**Method.** Pages 16, 17 and 18 were rendered at 300 DPI with PyMuPDF and
analysed pixel-wise:

1. The horizontal Fibonacci level lines were located by colour signature
   (cyan = 78.6%, green = 61.8%/50%, orange = 38.2%, red = 23.6%).
2. The chart's printed price labels (e.g. `61.80% (30.985)`) were used as
   calibration points to convert pixel rows into prices by least squares.
3. The stop was identified as the top edge of the pink/red shaded stop region.
4. The trendlines were isolated by colour and fitted as lines.
5. The ATR was estimated from the chart's own candles, so buffers could be
   expressed in scale-free ATR units rather than price units.

**Calibration quality** (this is what makes the measurements trustworthy):

| Chart | Calibration points | Max absolute error |
|---|---|---|
| p.16 (EM1) | 78.6% / 61.8% / 38.2% / 23.6% | 0.0083 on a 2.0 price range |
| p.17 (EM2-A) | all five fib levels | 0.0111 on a 2.0 price range |
| p.18 (EM2-B) | 78.6% / 38.2% / 23.6% | 0.0043 on a 0.9 price range |

Errors are ~0.5% of the calibrated range, i.e. well inside the gaps whose
meaning is being decided.

> **Caveat, stated up front:** this is **n = 1 instrument** (the same chart
> appears on p.16 and p.17), and a single worked example is a *worked
> example*, not a validated rule. Everything below is therefore recorded as
> `inferred` or `invented`, never as `book`.

---

## 1. Entry Model 1 — stop beyond the next retracement

### 1.1 The exact book requirement

**p.16, "Entry Model 1- Plan a direct entry":**

> "As soon as the price reaches high liquidity zone, one can directly enter
> into the trade as depicted by the chart below. Stoploss in this situation
> can be put slightly above the next retracement whilst keeping a suitable
> distance away from the trendline as well."

Supporting context:

- **p.16** (bullet above EM1): "Mere retest of the broken level is not enough
  a confirmation to plan entry. Instead, high liquidity zone needs to be
  spotted which as we discussed before requires spotting at-least 3
  confirmations."
- **p.16** chart annotation: the high liquidity zone is
  *"Recent tested resistance / Fibonacci retracement 50% level / Valid trendline"*.
- **p.18:** "Entry model 1 is a bit more rogue & riskier than entry model 2…
  1. Stoploss associated with Entry model 1 could be too high to make it a good
  risk to reward ratio."

### 1.2 What the code currently does

Both engines use the **same** rule, and it is **none of the book's three**:

| | Value |
|---|---|
| Spec | `STOP_LOSS_RULE = recent_confirmed_swing_plus_10pct_buffer` (provenance `invented`) |
| Python | `research-py/src/patterns/confluence_zone.py::calculate_stop_loss` — most recent confirmed swing low/high ± 10% of the entry-to-swing distance |
| TypeScript | `app-ts/src/patterns/ConfluenceZonePattern.ts::calculateStopLoss` — identical |
| Fallback | if no confirmed swing exists: the 10-bar extreme ± the same 10% buffer |

Neither engine uses a Fibonacci level, and neither has a broader-timeframe
trendline available at stop-calculation time.

### 1.3 What information is required to compute the book rule

| Requirement | Available today? |
|---|---|
| The Fibonacci retracement anchored on confirmed swings | **Yes** — `find_fib_retracement` exists in both engines and is already used for the confluence factor |
| The entry price | **Yes** — the entry is the current close at the confluence zone |
| The set of book Fibonacci ratios | **Yes** — `FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786]`, provenance `book` (p.10) |
| "a suitable distance away from the trendline" | **No** — needs the broader-timeframe trendline (Step 3) |
| A buffer beyond the level | **No** — the book gives no number |

### 1.4 Unambiguous vs. requiring interpretation

**Unambiguous from the book:**
- The stop is on the *risk* side of the entry (for a short: above the entry).
- The stop is *beyond* ("above") a retracement reference.
- A distance from the trendline is also required.
- The reference is a **retracement**, in the context of a book whose Fibonacci
  retracement is described on p.9 as "one of the key confirmations", with
  p.10 naming the ratio set.

**Requires an authored interpretation:**
- *Which* retracement is "the next" (AMB-03).
- *How much* beyond it ("slightly", "a suitable distance").
- Which trendline is "the trendline" and how the two constraints combine.

### 1.5 Behaviour for long and short

- **Short:** stop **above** the entry. Reference = the nearest Fibonacci
  retracement level strictly above the entry price. Buffer added upward.
- **Long:** the exact mirror — stop **below** the entry, reference = the
  nearest Fibonacci retracement level strictly below the entry price, buffer
  added downward.
- The selection is by **price proximity to the entry**, not by sequence
  position, so the rule is symmetric and has no long/short special case.

### 1.6 Missing or invalid structural references

- **No Fibonacci retracement available** (no confirmed swing high *and* swing
  low in the window — a real, observed failure mode; see `FIB_LOOKBACK`):
  the rule cannot be computed. **Proposed:** fall back to the most recent
  confirmed swing extreme, and if that is also absent, emit **no signal**
  rather than invent a level. Emitting a signal with a silently-wrong stop is
  worse than emitting none.
- **The nearest level is on the wrong side of the entry** (e.g. the entry is
  below the lowest available Fibonacci level): **no valid reference exists on
  the risk side** → no signal.
- **The level is far away**, making R:R poor: this is **not** a reason to
  change the stop. Per p.18 the book handles this by switching to Entry
  Model 2, not by moving the stop.

### 1.7 What the author's own chart shows

Measured from the p.16 chart:

| Quantity | Value |
|---|---|
| Entry anchor | 50% level = **30.567** (the chart labels the liquidity zone "Fibonacci retracement 50% level") |
| Liquidity-zone price band | 30.152 – 30.760 |
| Drawn stop (top of the pink zone) | **31.043** |
| Next Fibonacci level above the entry | 61.80% = **30.985** |
| Buffer above the 61.80% level | **+0.058** ≈ **0.098 ATR** |
| Is the stop above the 78.60% level (31.580)? | **No** — it is 0.54 below it |

**Reading:** the author did *not* place the stop above the next swing high
(nearest swing highs in that region are in the 31.5–32.3 range, well above the
drawn stop), and did *not* use the 78.6% level. The stop sits just beyond the
**61.80% retracement level**.

---

## 2. Entry Model 2-A — stop beyond the next Fibonacci level and the broader trendline

### 2.1 The exact book requirement

**p.17, "Entry Model 2- Plan entry after an extra confirmation":**

> "The idea here is to wait for the immediate trend to get broken and then
> plan entry after price tests the high liquidity zone.
>
> In the above chart, entry must be planned as soon as the trendline gets
> broken & there is no need to wait for any kind of candle closing
> confirmation, at-least this is how I use it. **Stoploss has been plotted
> above the next fib level & above the broader ongoing trendline.**"

### 2.2 What the code currently does

Identical to EM1: recent confirmed swing ± a 10% invented buffer. The rule
name `em2a_next_fib_plus_broader_trendline` already exists in the
`STOP_LOSS_RULE` parameter's `range` enum, but no code implements it, and
**no broader-timeframe trendline is available to the pattern layer at all**
(see §5).

### 2.3 What information is required

Everything EM1 needs, plus:
- the **broader ongoing trendline** — a trendline on a *higher* time frame
  than the entry time frame, which is what "broader" must mean in a book
  whose entire p.9 is devoted to multi-time-frame analysis;
- its price **at the entry bar**, so it can be compared with the Fibonacci
  level.

### 2.4 Unambiguous vs. requiring interpretation

**Unambiguous:**
- The stop must be above **both** the next Fibonacci level **and** the broader
  trendline (for a short).
- "Next" is relative to the entry — a level that is not beyond the entry
  cannot bound a stop.
- The broader trendline is a **higher-timeframe** construct (p.9).

**Requires an authored interpretation:**
- *Which* Fibonacci level is "the next" (AMB-04).
- *Which* time frame is "broader" (AMB-08, deferred to Stage 4 — see §5).
- How the two constraints combine, and by how much the stop is offset beyond
  the binding one.

### 2.5 Behaviour for long and short

Identical in structure to EM1 with the trendline added:

- **Short:** `stop = max(next_fib_level_above_entry, broader_trendline_at_entry) + buffer`.
- **Long:** `stop = min(next_fib_level_below_entry, broader_trendline_at_entry) − buffer`.
- `max`/`min` is the correct combination for "beyond **both**": a stop that is
  beyond both references is the more conservative one, i.e. the further from
  entry.

### 2.6 Missing or invalid structural references

- **No broader-timeframe trendline exists** (no valid trendline on the higher
  time frame): the book's rule cannot be satisfied in full. **Proposed:** fall
  back to the Fibonacci level alone and **record the fallback**, rather than
  silently dropping the trendline constraint. Alternatively, per p.18's
  statement that a missing third confirmation *forces* Entry Model 2, the
  absence of a broader trendline is itself a signal that this is not a valid
  setup. This is a **design decision to be confirmed in review** — see §6.
- **No Fibonacci level** (see §1.6): fall back to the swing reference, else
  no signal.
- **The trendline is on the wrong side of the entry** (for a short, a
  resistance trendline *below* the entry): it does not bound the stop, so it
  is not a constraint; use the Fibonacci level alone.

### 2.7 What the author's own chart shows

Measured from the p.17 chart:

| Quantity | Value |
|---|---|
| Entry anchor | 50% level = **30.567** |
| Liquidity-zone price band | 30.145 – 30.645 |
| Drawn stop (top of the pink zone) | **31.041** |
| Next Fibonacci level above the entry | 61.80% = **30.985** |
| Buffer above the 61.80% level | **+0.056** ≈ **0.047 ATR** |
| Broader (descending) trendline at the entry bar | **30.786** — *below* the 61.80% level |

**Reading:** in this example the trendline constraint is **slack**; the
binding constraint is the 61.80% Fibonacci level. This is consistent with
the p.17 prose but does **not** independently confirm the combination rule,
because a level-only rule would produce the same stop here.

> **Important:** the p.16 and p.17 charts show the **same instrument**, the
> **same** Fibonacci level prices (32.338 / 31.580 / 30.985 / 30.567 / 30.149
> / 29.632 / 28.796), and the **same** drawn stop price (31.043 vs 31.041,
> agreeing to 0.002). EM1's "next retracement" and EM2-A's "next fib level"
> are therefore **one observation rendered twice**, not two independent
> confirmations.

---

## 3. Entry Model 2-B — stop beyond the latest swing high and the broader trendline

### 3.1 The exact book requirement

**p.17, immediately after EM2-A:**

> "One more way to plan stoploss is slightly above the latest swing high &
> above the broader trendline, as there would be little to no chance of that
> level getting tested again if your trade is supposed to work out. This has
> been shown in the below mentioned example."

(The example is the chart on p.18 — a **long**.)

### 3.2 What the code currently does

The *structure* of this rule is the closest to what the code already does
(the current rule uses a recent confirmed swing), but:
- the swing selection differs (the code takes the most recent confirmed
  swing regardless of whether it is the entry leg's swing);
- the buffer is an invented 10% of distance rather than a small ATR-scaled
  offset;
- there is **no broader-trendline constraint** at all.

### 3.3 What information is required

- the most recent **confirmed** swing high (long) / swing low (short) at or
  before the entry bar;
- the broader-timeframe trendline and its price at the entry bar;
- a small offset beyond the swing.

### 3.4 Unambiguous vs. requiring interpretation

**Unambiguous:**
- The reference is the **latest swing** extreme, and the stop is **just
  beyond** it ("slightly above").
- The rationale is structural: a level that has just been tested "would be
  little to no chance … getting tested again if your trade is supposed to
  work out".
- The broader trendline is also a constraint.

**Requires an authored interpretation:**
- How a "swing" is confirmed (the book says "swing" but never defines it);
  causality requires a *confirmed* extreme, so the existing `SWING_RIGHT_BARS`
  applies.
- Whether the swing formed during the entry leg counts (it must, per the
  book's reasoning) — see the `EM2B_SWING_SELECTION` parameter.
- The size of "slightly".

### 3.5 Behaviour for long and short

- **Long:** stop **below** the entry, at
  `min(latest_confirmed_swing_low, broader_trendline_at_entry) − buffer`.
- **Short:** the exact mirror, at
  `max(latest_confirmed_swing_high, broader_trendline_at_entry) + buffer`.
- Note the direction flip versus EM2-A: the swing is a *support* for a long
  and a *resistance* for a short, i.e. the swing on the **risk** side.

### 3.6 Missing or invalid structural references

- **No confirmed swing** on the risk side: fall back to the trendline alone
  if one exists, else no signal.
- **No broader trendline**: fall back to the swing alone and record the
  fallback.
- **The latest swing is on the wrong side** (for a long, a swing high above
  the entry): not a risk-side reference → not usable.

### 3.7 What the author's own chart shows

Measured from the p.18 chart (a **long**):

| Quantity | Value |
|---|---|
| Entry anchor | 50% level = **74.02** |
| Liquidity-zone price band | 73.801 – 74.288 |
| Drawn stop (top of the pink zone) | **74.498** |
| Last swing high before the entry (wick top of the final rally) | **≈ 74.29** |
| Buffer above that swing high | **+0.26** ≈ **0.335 ATR** |
| 78.60% level | 74.55 — the stop sits 0.05 **below** it |
| Broader trendline | the short-term rising line; it lies **below** the entry, so it is not a constraint on a long's stop in this example |

**Reading:** the author placed the stop above the last swing high of the
rally that produced the entry, and — consistent with the book's "little to no
chance of that level getting tested again" reasoning — **not** at the 78.6%
level. The buffer here (0.34 ATR) is looser than in EM1/EM2-A (0.05–0.10
ATR), so the author clearly does not use one fixed buffer.

---

## 4. Summary of the measured evidence

| | EM1 (p.16) | EM2-A (p.17) | EM2-B (p.18) |
|---|---|---|---|
| Direction | short | short | long |
| Entry anchor | 50% level (30.567) | 50% level (30.567) | 50% level (74.02) |
| Level reference | 61.80% (30.985) | 61.80% (30.985) | last swing high (≈74.29) |
| Drawn stop | 31.043 | 31.041 | 74.498 |
| Buffer | +0.058 (0.098 ATR) | +0.056 (0.047 ATR) | +0.26 (0.335 ATR) |
| Trendline binding? | no (30.57 at entry < 61.8%) | no (30.79 at entry < 61.8%) | n/a (line is below entry) |

**Three findings that change how the rules must be read:**

1. **"Next" means "nearest beyond the entry on the risk side"**, in both EM1
   and EM2-A. It does **not** mean a fixed ratio (78.6% is used in neither
   chart) and does **not** mean "the next ratio in the sequence" (that could
   select a level on the profit side of the entry, which cannot bound a stop).

2. **The two charts are one observation.** EM1's "next retracement" and
   EM2-A's "next fib level" resolve to the same level on the same instrument.
   AMB-03 and AMB-04 are therefore **not** independently confirmed.

3. **The author uses no single buffer.** The observed band is 0.05–0.34 ATR.
   Any single value is an invention; it should be ATR-scaled and treated as an
   overfitting candidate, never tuned for profit.

---

## 5. What is *not* decided here

**AMB-08 — the time frame of the "broader" trendline — is deliberately left
open.** p.9 separates intraday trading (hourly for levels and trendlines,
15-minute for short-term trendlines and trade management) from swing trading
(daily and 4-hour to begin marking recently important levels, 1-hour to update
them daily, weekly for the broader outlook). That describes **roles**, not a
mechanical "one step up the hierarchy" rule, and the choice materially changes
which trendline constrains the stop.

Choosing it now, before the extractor exists, would fix a time-frame mapping
on the strength of a prose reading alone. It is therefore recorded as
`AMB-08`, `status: open`, `resolution_stage: 4`, with the constraints that
any Stage 4 choice must satisfy captured in `MTF_TRENDLINE_DESIGN.md`.

---

## 6. Open questions for review

These are decisions the analysis surfaces but cannot settle on the book's
authority. Each needs a ruling before implementation.

| # | Question | Options | Analysis leans to |
|---|---|---|---|
| Q1 | When the broader trendline is unavailable, does EM2-A still fire? | (a) fall back to the Fibonacci level, (b) reject the signal | **(b)** — p.18 treats a missing third confirmation as a reason to *wait*, and the book's EM2-A is defined as requiring both constraints. But (a) preserves trade count. Needs a ruling. |
| Q2 | Is the trendline constraint a hard `max`/`min`, or a "distance" check? | (a) hard `max`/`min`; (b) require a minimum separation | **(a)** — the prose "above the next fib level **&** above the broader ongoing trendline" states two positional constraints, not a distance. (b) would need a number the book does not give. |
| Q3 | Should the buffer be one parameter, or per-model? | (a) one shared buffer; (b) per-model | **(b)** — the measurements differ by ~7× (0.047 vs 0.335 ATR). A single value cannot reproduce all three charts. But (b) adds parameters. Needs a ruling. |
| Q4 | Is the stop buffer applied to the *binding* reference or to each? | (a) to the binding one; (b) to both then take the max | **(a)** — (b) double-counts the buffer. |
| Q5 | Does EM1's "distance away from the trendline" mean the stop must be *beyond* the trendline, or merely *not too close* to it? | (a) beyond; (b) not too close | Unresolved from the book. In the p.16 example the trendline at the entry (30.57) is *below* the 61.8% level, so the constraint is slack either way. Suggest: treat EM1's trendline clause as the same `max` rule as EM2-A, i.e. (a), for symmetry. |
| Q6 | Should the Fibonacci "next level" be restricted to the book's five ratios, or may it be any computed level? | (a) the five book ratios only; (b) any level | **(a)** — `FIB_RATIOS` is `book`-derived (p.10) and using it avoids inventing levels. |

---

## 7. Provenance summary for the proposed interpretations

| Decision | Parameter | Provenance | Why not `book` |
|---|---|---|---|
| EM1 "next retracement" | `NEXT_RETRACEMENT_SELECTION` | `inferred` | The book never defines "the next retracement". The definition is reconstructed from one chart by the author. |
| EM2-A "next fib level" | `NEXT_FIB_LEVEL_SELECTION` | `inferred` | The book never defines "next" nor says the selection is relative to the entry. The side-of-entry constraint is added for safety. |
| Combining level + trendline | `STOP_LEVEL_COMBINATION` | `inferred` | Taken from the prose. The two worked examples do not discriminate it (the trendline constraint is slack in both). |
| EM2-B swing selection | `EM2B_SWING_SELECTION` | `inferred` | The book says "the latest swing high" but never defines swing confirmation or whether the entry leg's swing counts. |
| Buffer size | `STOP_BUFFER_ATR` | `invented` | The book gives no number, and its own charts show a 0.05–0.34 ATR band, i.e. no single value. |
| "Broader" time frame | `AMB-08` (open) | — | Not settled. Deferred to Stage 4. |

---

## 8. What changes when this is implemented (for sizing the work)

Nothing below has been done. This is the list the implementation would touch.

**Spec:** `shared/fixtures/strategy_spec.json` — set `STOP_LOSS_RULE` to the
chosen rule; retire `STOP_LOSS_BUFFER` in favour of `STOP_BUFFER_ATR`; record
the answers to Q1–Q6.

**Python:**
- `research-py/src/patterns/confluence_zone.py` — rewrite `calculate_stop_loss`.
- `research-py/src/indicators/trendlines.py` — add the multi-timeframe
  extractor (see `MTF_TRENDLINE_DESIGN.md`).
- `research-py/src/data/loaders.py` — `resample_ohlcv` exists but is not
  causality-aware; it must drop the forming candle.

**TypeScript:**
- `app-ts/src/patterns/ConfluenceZonePattern.ts` — rewrite `calculateStopLoss`.
- `app-ts/src/indicators/trendlines.ts` — add the extractor.
- `app-ts/src/patterns/BasePattern.ts` — the `detectSignal` signature will
  need to carry higher-timeframe candles to the pattern.
- `app-ts/src/core/CandleResampler.ts` — the resampler already drops
  incomplete candles; it can be reused.

**Parity:** the existing `parity_15m.csv` and `trade_parity_15m.csv` fixtures
are single-timeframe. Stop placement will need a fixture with higher-timeframe
data, or the extractor fed from a resampled view of the same fixture.

**Expected effect on the current suites:** the stop change will alter every
existing signal's `stop_loss`, therefore every target, every R-multiple and
every position size. The `stage1-calculations`, `stage1-signals`,
`stage1-parity` and `trade_parity` expectations will all need to be
**regenerated deliberately, by hand, from the new rule** — not bulk-regenerated
and hoped for. Any change in the *number* of signals is a strategy change and
must be reported, not silently accepted.
