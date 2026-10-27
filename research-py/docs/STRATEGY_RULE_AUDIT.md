# Strategy Rule Audit — "The Trader's Playbook" vs. Current Implementation

Status: **audit record**. No strategy behaviour has been changed.

## 0. Sources of truth

| Source | Location | Status |
|---|---|---|
| **Primary (authoritative)** | `data/The Trader's Playbook_TSOT.pdf` — Apoorva Sharma, *The Shades of Trades* | 20 pages, text-extractable. All rules below cite a page. |
| Secondary (derived, **not** authoritative) | `docs/techniques/01-07*.md` | Repo-authored summaries that contain **several invented specifics** not present in the PDF. See §5. |
| Implementation under audit | `research-py/src/patterns/confluence_zone.py`, `app-ts/src/patterns/ConfluenceZonePattern.ts` | |

> **Important:** the PDF is the source of truth. Where `docs/techniques/*.md`
> disagrees with the PDF, the PDF wins. Several numbers that appear in the
> repo docs (0.3% zone width, "3 confirmations" scoring weights, R:R 1.5,
> fixed-fractional 1–2% sizing) are **not in the book**.

## 1. Rules extracted from the PDF

| # | Rule | PDF page | Verbatim anchor |
|---|---|---|---|
| R1 | Trendlines drawn on **candle wicks**; body only if wick missing | p.6 | "Trendlines must preferably be drawn keeping in view, the wick of the candle… In case the wick is missing, the body of the candle can be used." |
| R2 | **At least two touchpoints** to draw a trendline; more = more accurate | p.6 | "The more the touchpoints, the more accurate the trendline will be." / "At least two touchpoints are required to draw a trendline." |
| R3 | Trendline must **originate where the trend begins**, not mid-trend | p.7 | "A trendline is a valid trendline when it originates from where the trend begins." |
| R4 | Bullish chart = support → resistance; bearish = resistance → support | p.6 | "A bullish chart originates from a support & ends at a resistance." |
| R5 | S/R level needs **one or more touchpoints**; more = more respected | p.8 | "Levels can be drawn using one or more touchpoints." |
| R6 | S/R **roles switch** as price moves (support ↔ resistance) | p.8 | "Price keeps respecting support as resistance & resistance as support." |
| R7 | Levels drawn from **end of wicks OR end of bodies** — pick one method and be consistent | p.8 | "Levels can be drawn by connecting, end of the wicks or end of the body of the candles." |
| R8 | Don't draw levels **too many / too close** (noise) | p.9 | "Try not to draw to many levels, too close to each other making them insignificant to trade." |
| R9 | MTF hierarchy: weekly → daily → 4h → 1h → 15m, each with a stated purpose | p.9 | "Weekly… crucial… Daily… 4 Hour… 1 Hour… 15-mins" |
| R10 | Fibonacci levels **23.6 / 38.2 / 50 / 61.8 / 78.6%** are the crucial zones | p.10 | "Fibonacci levels of 23.6%, 38.2%, 50%, 61.8%, 78.6% are considered the most crucial retracement zones." |
| R11 | Fib works best **in conjunction with** S/R or trendline | p.10 | "Fibonacci Retracement levels work best when used in conjunction with levels like support or resistance or trendline." |
| R12 | Fib must be used in the direction of the **broader trend** | p.10 | "Always try & use Fibonacci retracement in the direction of broader trend & not short term trend." |
| R13 | Confluence = liquidity = multiple confirmations. Named examples: **(a) Level + Trendline + Fibonacci**, **(b) Level + trendlines** | p.11 | "Examples of confluence: 1. Level + Trendline + Fibonacci retracement 2. Level + trendlines" |
| R14 | Entry requires a **high-liquidity zone = at least 3 confirmations** | p.16 | "high liquidity zone needs to be spotted which as we discussed before requires spotting at-least 3 confirmations." / p.11 "requires spotting at-least 3 confirmations" |
| R15 | Mere retest of a broken level is **not** enough confirmation | p.16 | "Mere retest of the broken level is not enough a confirmation to plan entry." |
| R16 | **Entry Model 1 (direct)**: enter as soon as price reaches the high-liquidity zone. SL **slightly beyond the next retracement**, keeping distance from the trendline. Target = next crucial S/R | p.16–17 | "As soon as the price reaches high liquidity zone, one can directly enter… Stoploss… can be put slightly above the next retracement whilst keeping a suitable distance away from the trendline as well." / "Target can be plotted considering the next crucial support" |
| R17 | **Entry Model 2 (confirmation)**: wait for the **immediate trendline to break**, then plan entry as price tests the zone. Entry happens **on the trendline break, no candle-close wait**. SL = **above next Fib level AND above the broader ongoing trendline**, OR **slightly above the latest swing high AND above the broader trendline** | p.17 | "wait for the immediate trend to get broken and then plan entry after price tests the high liquidity zone." / "entry must be planned as soon as the trendline gets broken & there is no need to wait for any kind of candle closing confirmation" / "Stoploss has been plotted above the next fib level & above the broader ongoing trendline." / "slightly above the latest swing high & above the broader trendline" |
| R18 | Both models equally valid; **backtest at least 100 times**; EM1 is "a bit more rogue & riskier" | p.18 | "Both entry models discussed above are equally valid… The best practice is to back test the setup on the script that you are planning to trade at least a hundred times…" / "Entry model 1 is a bit more rogue & riskier than entry model 2" |
| R19 | **Forced to Model 2** when (1) EM1's stop is too high for a good R:R, or (2) only 2 confirmations exist (level + fib, no trendline) — then the **trendline break is the 3rd confirmation** | p.18 | "1. Stoploss associated with Entry model 1 could be too high to make it a good risk to reward ratio 2. 3 confirmation rule is not getting followed… you will be forced to wait for the third confirmation in the form of short-term trendline break aka Entry Model 2." |
| R20 | **Trailing stop = trendline, on candle-closing basis**; intraday 15m, swing 1h; steeper = more break risk; prefer a broader TF unless deep in profit | p.19 | "This trendline can now be used as a trailing stoploss on candle closing basis." / "Intraday Trading - 15mins / Swing Trading- 1 Hour" / "you should be relying on a broader time frame trendline that provides price the required room to breathe" |
| R21 | Trend reversal is a **two-step** process: break the ongoing trendline, **then** a breakdown below the most recent swing low | p.13 | "price breaks the ongoing trendline to signify the break of ongoing immediate trend… Then price consolidates… if sellers tend to take control & force a breakdown below the most recent swing low, the trend is said to have changed" |
| R22 | Pullback definition: **no swing low until price breaks the recently made high** | p.14 | "After forming a high, if price is moving downside we cannot consider any point as a swing low until price breaks the recently made high" |
| R23 | Complex pullbacks (abcd) — wait for clarity, do not force | p.15 | "The structure formed by price between 'abcd' is referred to as complex pullback." |
| R24 | Do not compromise rules; risk exposure and a sensible entry matter more than capturing every move | p.20 | "In trading, making peace with missed opportunities is worth much more than compromising on the rules that make you who you are as a trader." |

### Rules the PDF does **NOT** contain

These are present in the current code (or the repo docs) but have **no basis in the book**:

| Item | Where it appears | Status |
|---|---|---|
| Minimum R:R of **1.5** | `engine.py` `_should_skip_trade`, `metrics`, `app-ts/src/config/default.ts` (`minRiskReward: 1.5`), `docs/techniques/07-psychology-risk.md` | **Invented.** The book only says EM1's stop "could be too high to make it a good risk to reward ratio" — a *relative* judgement, not a numeric threshold. |
| Fixed-fractional position sizing (1–2% risk) | `RiskManager.ts`, `docs/techniques/07` | **Invented.** No sizing formula in the PDF. |
| Max daily loss / weekly loss / max drawdown limits | `docs/techniques/07` | **Invented.** Not in the PDF. |
| Max concurrent trades, correlation limits | `docs/techniques/07` | **Invented.** Not in the PDF. |
| ATR-based zone tolerance (0.5 × ATR) | both engines | **Reasonable engineering choice, not from the book.** The book says "keep a suitable distance", not how to quantify it. |
| Wick:body ratio ≥ 2.0 for a rejection candle | both engines | **Invented.** The book never defines a rejection candle numerically. |
| SR lookback = 100 bars | both engines | **Invented.** |
| Confluence "tier" scoring (1/2/3) and 0.3% zone width | `docs/techniques/04` | **Invented.** |
| Timeframe weights (weekly 10 … 15m 2) | `docs/techniques/06` | **Invented.** |

> These are *implementation decisions*, not errors — but they must not be
> attributed to the author. Every one of them is a **parameter**, and therefore
> a candidate for overfitting. See §7.

## 2. Rule-by-rule comparison — `ConfluenceZonePattern` (Python)

Python is the primary research engine. The TypeScript class is compared in §3.

| Rule | Current implementation | File / lines | Verdict |
|---|---|---|---|
| **R1** trendline on wicks | `find_swing_points` uses `df['high']` / `df['low']` — wick values | `indicators/trendlines.py:70-100` | ✅ **Matches** |
| **R2** ≥2 touchpoints | `find_trendlines(..., min_touches=2)`; a line needs 2 anchors and counts further touches | `indicators/trendlines.py:100-160` | ✅ **Matches** (2 touchpoints) |
| **R3** origin at trend start | Any pair of swing lows may define a line; **no requirement that it starts at the trend origin** | `indicators/trendlines.py:105-125` | ⚠️ **Partial** — a mid-trend line is accepted |
| **R4** bullish origin support / bearish origin resistance | Support lines connect lows, resistance connect highs (implicitly consistent) | `indicators/trendlines.py:105-160` | ⚠️ **Implicit only** — no explicit origin validation |
| **R5** S/R needs ≥1 touch | `min_touches=2` by default in `find_sr_zones` | `indicators/support_resistance.py:40-70` | ⚠️ **Stricter than the book** (book allows 1; 2+ is a reasonable strengthening) |
| **R6** S/R role reversal | Zones are typed SUPPORT/RESISTANCE statically by swing type; **roles never flip** | `indicators/support_resistance.py:78-110` | ❌ **Not implemented** (TS `SRRetestPattern` partially covers it) |
| **R7** consistent wick-vs-body anchor | Always uses wicks (high/low) | `indicators/support_resistance.py:60` | ✅ **Consistent** (a valid instance of R7) |
| **R8** don't cluster levels too closely | Zones are grouped by proximity — clustering *creates* zones; there is no "too close ⇒ noise" filter | `indicators/support_resistance.py:78-110` | ⚠️ **Partial** — no noise filter |
| **R9** MTF hierarchy | **Not present in Python.** `MTFAnalyzer` exists only in TypeScript | — | ❌ **Missing in Python** |
| **R10** Fib levels 23.6–78.6 | `FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786]` — all five present | `indicators/fibonacci.py:10` | ✅ **Matches** (arithmetic parity tested) |
| **R10b** which Fib levels are *used* for confluence | `fib_levels: [0.5, 0.618, 0.786]` in config | `patterns/confluence_zone.py:50` | ⚠️ **Config is dead** — `find_fib_retracement` ignores `fib_levels` and returns all five; the pattern matches on **any** of the five. The configured subset is never applied. |
| **R11** Fib + S/R + trendline together | All three are checked; `min_confluence_factors` gates the count | `patterns/confluence_zone.py:78-115` | ⚠️ **Partial** — factors are counted, but *which* combination is not enforced (see §4.1) |
| **R12** Fib in the direction of the broader trend | Fib direction is derived from the **local 50-bar window**, not the broader trend; no HTF filter in Python | `indicators/fibonacci.py:76-110` | ❌ **Not implemented** |
| **R13** named confluence combinations | Generic counter; any N of {S/R, Fib, trendline} qualifies | `patterns/confluence_zone.py:113` | ⚠️ **Partial** — R14 governs the count, R13's named pairs are not distinguished |
| **R14** **≥3 confirmations** | **`min_confluence_factors = 2`** | `patterns/confluence_zone.py:47` | ❌ **DISCREPANCY** — see §4.1 |
| **R15** retest alone insufficient | A rejection candle **is** required | `patterns/confluence_zone.py:118`, `_is_rejection_candle` | ✅ **Matches** |
| **R16** **Entry Model 1** | **Absent.** The pattern implements Model 2 only | — | ❌ **MISSING** — see §4.3 |
| **R17** **Entry Model 2** — wait for immediate trendline break, then enter on the break, no candle-close wait | Implemented as **"rejection candle at the zone"** (wick into zone, close back outside, wick ≥ 2× body) | `patterns/confluence_zone.py:155-190` | ❌ **DISCREPANCY** — see §4.3 |
| **R18** both models equally valid; backtest ≥100× | Only one model exists | — | ❌ **Cannot be satisfied** until EM1 exists |
| **R19** forced to Model 2 | Implicit: EM2 is the only model | — | ❌ **Not implemented** |
| **R20** trailing stop = trendline, candle-close basis | **Not in Python.** Python has no trailing stop at all. (TS has R-multiple breakeven/step/ATR trailing — *not* trendline-based) | — | ❌ **Missing in Python** |
| **R21** two-step trend reversal | **Not implemented** in either engine | — | ❌ **Missing** |
| **R22** pullback: no swing low until the recent high breaks | **Not implemented.** Swings are pure fractals | `indicators/trendlines.py:44-100` | ❌ **Missing** |
| **R23** complex pullback detection | **Not implemented** | — | ❌ **Missing** |
| **R24** don't compromise rules | n/a | — | — |

### Stop-loss and take-profit placement (Python)

| Rule | Current implementation | Verdict |
|---|---|---|
| **R16** EM1 SL = beyond the next retracement + distance from trendline | `calculate_stop_loss` = **minimum low of the last 10 bars − 10% buffer** (long) | ❌ **DISCREPANCY** — see §4.2 |
| **R17** EM2 SL = above next Fib level **and** above the broader trendline; **or** above the latest swing high **and** above the broader trendline | Same swing-low-based stop; **no Fib level, no trendline, no broader TF** | ❌ **DISCREPANCY** — see §4.2 |
| **R16** EM1/EM2 target = next crucial S/R, noting minor levels in between | `calculate_target` (base class) = `entry ± risk × target_rr` (fixed 2.0 R) | ❌ **Not implemented.** The **TypeScript** version *does* target the next structural S/R level, so the two engines disagree. |
| — | Python's `ConfluenceZonePattern` **never overrides** `calculate_target`; it inherits the fixed-R:R base | `patterns/base.py:88-99` | ⚠️ |

## 3. TypeScript vs Python — execution parity

`app-ts/src/patterns/ConfluenceZonePattern.ts` is a near-parallel implementation, but the two engines had **diverged**:

| Aspect | Python | TypeScript (before this audit) | Now |
|---|---|---|---|
| Min confluence | 2 | 2 | 2 (both — see §4.1) |
| Fib levels used | config `fib_levels` (ignored) | config `fibLevels` (ignored) | both ignored — **documented, not yet fixed** |
| Fib anchoring | **window extremes** (`idxmax`/`idxmin` over 50 bars) | **swing points** (`findSwingPoints`) | ❌ **STILL DIVERGENT** — see below |
| Stop-loss | 10-bar min-low ± 10% | `findRecentSwingLow` (3,1 fractal) ± 10% | ❌ **STILL DIVERGENT** |
| Target | fixed R:R (base class) | next structural S/R level | ❌ **STILL DIVERGENT** |
| Swing confirmation | `find_confirmed_swings` with `confirmed_at` | `findSwingPoints` (no metadata) | ⚠️ Behaviourally equivalent, not API-equivalent |
| ATR tolerance | `tolerance_atr` (ATR multiple) | `atr` + `tolerance` (ATR multiple) | ✅ equivalent |
| Trendline tolerance | **percentage** (`0.02`) | **ATR multiple** (`0.3`) | ❌ **DIVERGENT** — same concept, different units |
| S/R min touches | 2 | 2 | ✅ equivalent |

> **The two engines do not currently produce the same signals from the same
> data.** The Fibonacci anchoring difference alone (window extremes vs swing
> points) changes every retracement price, and therefore every confluence
> zone. This must be resolved before either engine's results are used for
> strategy comparison.

### TypeScript execution defects found and fixed in this pass

| ID | Defect | Severity | Evidence | Status |
|---|---|---|---|---|
| **TS-01** | `CSVLoader` dropped every row of a file whose only timestamp column was `datetime` — the default mapping had no `datetime` key and the fallback list was `['timestamp','time','date','Date','Time']` | **High** | Probe: `DATETIME-ONLY candles loaded: 0` | ✅ **Fixed** — `datetime` added to the candidate list and given priority over epoch `timestamp`, matching Python |
| **TS-02** | `PaperTradingEngine.updateTrade` opened a pending trade and then called `cancelTrade` on the **already-OPEN** trade, throwing `Cannot cancel trade in state OPEN`; the exception was swallowed by `updateTrades()` | **High** | Probe: `Error updating trade …: Error: Cannot cancel trade in state OPEN` | ✅ **Fixed** — invalidation is now evaluated *before* the entry fill |
| **TS-03** | `LivePatternScanner.handleCandleUpdate` pushed **every tick update** into the buffer, so the same forming candle appeared many times; the 200-candle buffer covered only minutes of history and the pattern read a still-forming candle | **High** | Probe: 6 buffer entries, 2 unique timestamps | ✅ **Fixed** — one entry per timestamp; the latest update replaces the previous |
| **TS-04** | `LiveMonitor.processCandle` appended the candle to the buffer **before** `detectSignals`, so the pattern read the bar currently being processed (the forming candle) | **Critical** | Probe: pattern observed the dataset's final timestamp | ✅ **Fixed** — detection now runs on closed candles only, matching the Python contract |
| **TS-05** | Naive datetime strings were parsed as **local** time by JS while Python treats them as naive wall clock — the two engines disagreed on bar boundaries (14:00 IST became 08:30 UTC) | **Medium** | `new Date("2024-01-17 14:00:00")` → `2024-01-17T08:30:00.000Z` | ✅ **Fixed** — naive strings are read as UTC wall clock |
| **TS-06** | `CSVLoader` accepted bars with `high < low` or `close` outside `[low, high]` | **Medium** | Code review | ✅ **Fixed** — such rows are rejected with a warning |
| **TS-07** | `parseTimestamp` used a magic threshold `1e10` and ignored the `dateFormat: 'unix_ms'` setting in the auto-detect path | **Low** | Code review | ✅ **Fixed** — unified `1e11` threshold and explicit `dateFormat` handling, matching Python |

### TypeScript items confirmed CORRECT (no change needed)

| Item | Evidence |
|---|---|
| Swing detection is causal — a swing at index `k` with `rightBars=3` is not exposed until bar `k+3` exists | Probe: prefix len 8 → 0 swings; prefix len 9 → 1 swing. Identical to Python. |
| A signal cannot fill on the candle that produced it — the trade is created `PENDING` after detection, and `isEntryHit` is only evaluated on later candle updates | `PaperTradingEngine.processSignal` → `updateTrade` `PENDING` branch |
| A position cannot be exited on its entry candle — the state machine permits `PENDING → OPEN` only, and the `PENDING` branch `return`s without running the OPEN stop/target logic | `TradeStateMachine.VALID_TRANSITIONS` |
| Trade IDs are unique — `uuidv4()` | `TradeRepository.createFromSignal` |
| Stop-outranks-target on an ambiguous candle | `PaperTradingEngine.updateTrade` checks `isStopHit` first and returns |
| Partial-exit fills model gap-through correctly (`getExitPrice` returns `candle.open` when the bar opens beyond the level) | `PartialProfitManager.getExitPrice` |
| Fees and slippage are applied on **both** sides and computed on **executed** prices | `ExecutionSimulator.simulateEntry` / `simulateExit` → `calculateTradeFees(tradeValue = executedPrice × quantity)` |
| `RiskManager` enforces the configured max risk, max open trades, max daily trades, duplicate-signal and min-R:R rules | `RiskManager.checkRisk` |

### TypeScript items still divergent or missing

| ID | Issue | Severity | Notes |
|---|---|---|---|
| **TS-08** | Risk sizing uses a **stale rolling capital**, not live equity (no unrealised P&L) | Medium | `RiskManager.capital` updated only by `updateCapital(pnl)` after a close. Python sizes on equity-at-fill. |
| **TS-09** | No metrics annualisation at all — `stats.ts` computes a **per-trade** drawdown from the trade sequence, not a time-based equity curve; there is **no Sharpe/Sortino** in the TypeScript stack | Medium | Python has Sharpe/Sortino/CAGR with correct `periods_per_year`. The TS dashboard's "drawdown" is not comparable. |
| **TS-10** | No trend-reversal detection (R21), no pullback definition (R22), no complex-pullback handling (R23) | Medium | Confirmed absent from `StructureAnalyzer`. |
| **TS-11** | Trailing stop is R-multiple based (breakeven/step/ATR), **not trendline-based on candle close** (R20) | Medium | `PaperTradingEngine.updateTrailingStop` |
| **TS-12** | No Entry Model 1 (R16) in either engine | High | Strategy gap, not an engine bug |
| **TS-13** | MTF resampler can include an **in-progress** higher-timeframe bar in the HTF aggregate | Medium | `CandleResampler.resample` skips only a trailing chunk shorter than `ratio`; a full chunk containing the forming bar is aggregated. Partly mitigated by the TS-04 fix (the buffer now holds closed candles only) but the *current* HTF bucket is still incomplete. |

## 4. The three outstanding differences

### 4.1 Minimum confluence: 2 vs 3

**The book (R14, p.16):** "high liquidity zone needs to be spotted which as we
discussed before requires spotting **at-least 3 confirmations**." This is
repeated on p.11. The named examples (R13) are *Level + Trendline + Fibonacci*
and *Level + trendlines*.

**The code:** `min_confluence_factors = 2` (Python `patterns/confluence_zone.py:47`,
TypeScript `ConfluenceZonePattern.ts:73`).

**Assessment: the code contradicts the book.** With a threshold of 2 the
strategy will trade on a bare *Level + Fibonacci* pairing — precisely the case
the book says must be upgraded to Entry Model 2 (R19) because the third
confirmation is missing.

**But the rule is not a simple count.** Three open questions must be answered
before changing the number:

1. **What is a "confirmation"?** The book names three price-based elements
   (level, trendline, Fibonacci). It also mentions, in the checklist of
   `docs/techniques/04`, a possible *swing point* as a fourth — but that
   checklist is repo-authored, not the book. **The book names exactly three.**
2. **Are the elements independent?** A "level" and a "trendline" that both
   touch the same swing low are arguably one event, not two. The book does not
   disambiguate. The current code counts them separately, so a single swing
   low can produce a level *and* a trendline *and* count as 2 of 3.
3. **Must the three be the named triple?** R13 names "Level + Trendline +
   Fibonacci" and "Level + trendlines". Neither is a 3-of-3. Does the author
   mean *any* 3 elements, or specifically that the triple include a
   trendline?

**Interim decision: change nothing.** Setting the threshold to 3 without
answering (2) risks a different failure — a single swing low manufacturing
three "confirmations" from one event, which would make the filter *more*
permissive in substance while looking stricter.

### 4.2 Stop-loss placement: swing-based vs the methodology

**The book:**

| Model | Stop placement | Source |
|---|---|---|
| EM1 | "slightly above the **next retracement** whilst keeping a suitable distance away from the **trendline**" | p.16 |
| EM2 (Method A) | "above the **next fib level** & above the **broader ongoing trendline**" | p.17 |
| EM2 (Method B) | "slightly above the **latest swing high** & above the **broader trendline**" | p.17 |

Note the long/short mirroring: for a long, "above" becomes "below".

**The code (Python):** `min(low of last 10 bars) − 10% of distance` for a long.
This is *not* any of the three methods. It is a recent-extreme stop with an
arbitrary buffer.

**The code (TypeScript):** `findRecentSwingLow(candles, 3) − 10% buffer`. This
is **closest to EM2 Method B**, but omits the "and above the broader trendline"
component and adds an arbitrary 10% buffer.

**Assessment:**

| Method | Implementable? | Blocker |
|---|---|---|
| EM2 Method B | **Yes** | Needs the "broader trendline" component — a trendline from a higher timeframe. The Python engine has no MTF; the TypeScript one has `MTFAnalyzer` but no trendline extraction from it. |
| EM2 Method A | **Yes** | Needs "the next fib level" — a defined notion of which Fib level is *next* relative to the entry, plus the broader trendline. |
| EM1 | **Yes** | Needs "the next retracement" — the retracement level between the swing and the entry — plus the trendline distance. |

**The "10% buffer" is an invention** and is a candidate for overfitting: it is
a free parameter with no basis in the book and it directly scales every stop
distance, and therefore every position size and every R multiple.

**Interim decision: change nothing.** The three methods require an MTF
trendline and a well-defined "next retracement / next fib level", neither of
which exists yet. Implementing them is a multi-step dependency chain, not a
parameter change.

### 4.3 Entry Model 1 is missing, and Entry Model 2 is not what the code does

**The book:**

- **EM1 (p.16):** enter **directly** as soon as price reaches the
  high-liquidity zone. Trigger = price arrival. No candle pattern required.
- **EM2 (p.17):** wait for the **immediate trendline to break**, then enter.
  "entry must be planned **as soon as the trendline gets broken** & there is no
  need to wait for any kind of candle closing confirmation."

**The code (both engines)** implements a **rejection candle** at the zone:
wick into the zone, close back outside it, wick ≥ 2× body.

**This is a third model — not EM1 and not EM2.**

- It is **not EM1**: EM1 requires *no* candle confirmation.
- It is **not EM2**: EM2 requires a **trendline break**; a rejection candle is
  a *different* trigger. The book's EM2 explicitly says *not* to wait for a
  candle close — the code in fact *requires* a candle close (it reads
  `close` and checks `close > zoneLevel`).

The two are compatible in practice — a trendline break usually produces a
candle close back outside the zone — but they are not the same rule, and the
difference is material: the code's model can fire **without** any trendline
break, and EM2 can fire **without** the wick:body ratio the code demands.

**The rejection-candle model is not in the book.** It is a reasonable
discretionary construct, but the author never wrote it down. It must be
labelled as an implementation choice, not as "the methodology".

**Interim decision: change nothing.** Implementing EM1 and EM2 as the book
describes requires the trendline-break machinery (R17) and the MTF trendline
for stops (R16/R17). All three are prerequisites.

## 5. Discrepancies in the repo's own `docs/techniques/`

These files are the repo's derived interpretation. They are **not** the source
of truth and contain specifics with no basis in the PDF. They should be
labelled as such, or corrected, so that future work does not cite them as
authoritative.

| File | Invented content | PDF says |
|---|---|---|
| `docs/techniques/02-support-resistance.md` | `LevelValidation` with `zone: {top, bottom}`, `0.5%` separation filter, `checkRoleReversal()` | R6 states role reversal as a principle but gives no algorithm; the 0.5% filter is invented |
| `docs/techniques/03-fibonacci-retracement.md` | `detectFibConfluence` with 0.3% tolerance; `FibonacciLevel.confluence.swingPoint`; `model = (rr < 1.5 \|\| strength < 3) ? 2 : 1` | The swing-point confirmation type and the **1.5 R:R threshold** are invented. The 3-vs-2 model choice *is* implied by R19, but not with that numeric threshold. |
| `docs/techniques/04-confluence-liquidity.md` | `tier: 1|2|3`, `width: price * 0.003`, `searchRange = currentPrice * 0.02` | Not in the PDF |
| `docs/techniques/05-entry-models-trade-management.md` | `calculateModel1Stoploss()`, `calculateModel2Stoploss()`, `selectTrailingTrendline()` | These are *plausible* algorithmic sketches of R16/R17/R20 but are **invented specifications**, not the author's |
| `docs/techniques/06-multi-timeframe.md` | `TIMEFRAME_WEIGHTS` (weekly 10 … 15m 2), `alignmentScore`, ±2% trend thresholds | Not in the PDF |
| `docs/techniques/07-psychology-risk.md` | `maxRiskPerTrade 0.01`, `maxDailyLoss 0.03`, `maxWeeklyLoss 0.10`, `maxDrawdown 0.20`, `minRiskReward 1.5`, `maxConcurrentTrades 5`, `maxCorrelatedTrades 3`, `assessPsychologicalState()` | **None** of these appear in the PDF. R24 covers the *philosophy* (don't compromise) but not these numbers. |

## 6. What the current strategy actually is

For the avoidance of doubt, the shipped Python `ConfluenceZonePattern` is:

> *"Enter LONG/SHORT at a rejection candle (wick ≥ 2× body into a zone, close
> back outside it) where price touches any of: an S/R zone built from ≥2
> fractal swing points within 0.5 ATR, a Fibonacci level of any of the five
> ratios computed from the 50-bar window extremes, or a trendline through
> fractal swing lows/highs with ≥2 touches and 2% price tolerance — with at
> least 2 of the 3 present. Stop at the 10-bar extreme ± 10% buffer. Target
> at 2R. Skip if R:R < 1.5. Skip after 2 consecutive losses. Size at 1% of
> equity. Charge 0.1% commission and 0.05% slippage per side."*

That is a coherent, testable strategy. It is **not** "The Trader's Playbook".
It borrows the vocabulary (S/R, trendlines, Fibonacci, confluence, entry
models) and implements a subset of the ideas with a different entry trigger,
different stops, different targets, and a lower confirmation threshold.

**No claim is made that it is profitable.** In the last validated run it
produced 10–11 trades over two years of hourly BTC/ETH data with a profit
factor of ~0.49 and a negative return on every dataset tested.

## 7. Cross-cutting risk: invented parameters

Six of the decisions above are free parameters with no basis in the book:

`min_confluence_factors=2` · `min_rejection_wick_ratio=2.0` ·
`zone_tolerance_atr=0.5` · `sr_zone_lookback=100` · `target_rr=2.0` ·
`risk_per_trade=0.01` · the 10% stop buffer · `trendline tolerance 0.02` ·
the `RR < 1.5` filter.

Each is a candidate for overfitting. Until the strategy's *structure* matches
the book, tuning these is premature: it would optimise the wrong thing. The
ordered plan in §8 puts structure first for exactly this reason.

## 8. Staged implementation plan

See `docs/STRATEGY_IMPLEMENTATION_PLAN.md`.
