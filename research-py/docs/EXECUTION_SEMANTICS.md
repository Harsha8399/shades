# Backtesting Execution Semantics

Status: **authoritative specification** for the Python research engine (`research-py/`).

This document defines the chronological order of events inside a backtest. It exists
because the previous engine interleaved *signal generation* and *order execution* on
the same bar, which allowed information from a candle to influence a trade that was
recorded as happening on that same candle.

The rules below are the contract. Code that violates them is a bug, not a strategy
choice.

---

## 1. Core principles

| # | Principle |
|---|-----------|
| P1 | A signal may only use information available at its **decision time**. |
| P2 | A signal that requires a candle close may not use that candle before it closes. |
| P3 | An order generated from a completed candle executes at a **subsequent** executable price, never retrospectively. |
| P4 | A swing point that requires right-side candles is not confirmed until those candles have occurred. |
| P5 | Higher-timeframe filters use only **completed** higher-timeframe candles. |
| P6 | The backtester never reads a bar index greater than the current decision index. |

---

## 2. The decision/execution timeline

For a bar series `b[0] .. b[N-1]`, one iteration of the engine processes bar `i` in
this order:

```
iteration i:
    1. EXECUTE pending orders against b[i]      # orders created at iteration i-1 or earlier
    2. MARK-TO-MARKET open positions using b[i]
    3. DECIDE: generate a signal using data up to and including b[i-1]
       (bar i is NOT visible to the strategy)
    4. The signal becomes a pending order, executable no earlier than bar i+1
```

Key consequences:

* **P3 / same-bar execution is impossible.** A signal computed from `b[i-1]` is
  queued at the end of iteration `i-1` and can only be filled starting at bar `i`.
* **P2 holds by construction.** The strategy never sees the forming bar `b[i]`.
* The engine iterates `i` from `required_bars` to `N-1`; the first `required_bars`
  bars are warm-up.

### Why the strategy sees `b[i-1]` and not `b[i]`

The pattern API is `detect_signal(df, symbol)` and it inspects `df.iloc[-1]`. To make
the contract "the last row of `df` is a *closed* candle", the engine passes
`data.iloc[:i]` (rows `0..i-1`) to the pattern and then uses bar `i` for execution.
The alternative -- passing `data.iloc[:i+1]` and asking the pattern to ignore the last
row -- would silently break every pattern that reads `iloc[-1]`, including the
TypeScript parity target.

---

## 3. Order lifecycle

```
Signal (bar i-1 close)
   -> pending order            [created end of iteration i-1]
   -> entry fill               [first executable bar >= i]
   -> open position
   -> exit fill                [stop-loss, target, or end-of-data]
   -> closed trade
```

### 3.1 Entry fill rules

A pending order is filled on the **first bar at or after** the bar following the
signal bar, if the bar's price range reaches the entry price.

* Long: filled if `bar.low <= entry_price`.
* Short: filled if `bar.high >= entry_price`.
* Fill price: the **entry price itself** (a resting limit-style order), then
  slippage is applied against the trader.

The signal bar itself is **never** an entry candidate, even if the signal bar's own
range would have touched the entry price. This prevents the classic
"signal and fill on the same candle" artefact.

**Gap handling:** if the bar opens beyond the entry price, the order fills at the
**open** of that bar (worse or better than the limit), not at the limit price. This is
the realistic treatment of a gap.

### 3.2 Exit fill rules

An open position is checked against the stop-loss and target on every bar **after**
the entry bar.

* **Stop-loss** (long): triggered if `bar.low <= stop_loss`.
* **Target** (long): triggered if `bar.high >= target`.
* Short positions are mirrored.

When only one of the two is reached, the exit price is that level.

### 3.3 Ambiguous bars (both stop and target reached)

If a single bar's range spans **both** the stop-loss and the target, the true
sequence of intrabar prices is unknown from OHLC data alone. The engine resolves this
with a configurable policy:

| Policy | Behaviour | Rationale |
|--------|----------|-----------|
| `stop_first` (default) | The stop-loss is assumed to have been hit first. | Conservative: never flatters results. |
| `target_first` | The target is assumed to have been hit first. | Optimistic; provided for sensitivity analysis. |
| `worst_case` | Exit at the worse of the two outcomes. | Same as `stop_first` for a long, but also handles ambiguous direction. |
| `intrabar` | Uses a finer-grained series when supplied via `BacktestConfig.intrabar_data`. | Highest fidelity; requires sub-bar data. |

`stop_first` is the default because a backtest that reports better-than-realistic
results is worse than no backtest at all.

**Conservative note:** the default policy is a *lower bound* on the true ambiguity
cost, not a perfect simulation. Intrabar sequencing remains an irreducible
uncertainty for OHLC-only data, and this is tracked as a residual risk.

### 3.4 Fills that cannot happen

If a bar's range does not reach either the stop or the target, the position stays
open. The engine never closes a position at a price the market never offered.

---

## 4. Swing-point confirmation

The live swing implementation is `src/indicators/trendlines.py::find_swing_points`,
which uses a `left_bars` / `right_bars` fractal with **3 bars on each side by
default**.

A swing high at index `k` is only *knowable* at index `k + right_bars`, because the
confirmation requires observing the `right_bars` candles that follow it.

### 4.1 The causal rule

`find_swing_points` therefore **must not** return a swing whose
`k + right_bars` is beyond the last bar of the data it was given. The function
already iterates `range(left_bars, len(df) - right_bars)`, which guarantees this
**as long as the data passed in ends at the decision point**.

This is the crux: the guarantee is provided by the *caller* slicing the data
correctly, not by the detector. The engine therefore passes `data.iloc[:i]`, so the
last bar available to the detector is `b[i-1]`, and the newest swing it can return
has `k = i-1-right_bars`. It is therefore confirmed by `b[i-1]`. **No unconfirmed
swing is ever visible.**

### 4.2 Explicit confirmation metadata

To make the guarantee testable rather than implicit, `find_swing_points` also
returns, for each swing, the index at which it becomes confirmed
(`confirmed_at = k + right_bars`). `find_trendlines` and `find_sr_zones` propagate
this, and a new helper `filter_confirmed_swings` allows callers to assert the
invariant directly.

The confirmation lag is *not* removed. The strategy's meaning is preserved: a swing
still requires 3 bars of right-side confirmation, it is simply not visible until
those bars exist. Setting `right_bars=0` would change what a "swing" means and is
explicitly out of scope.

### 4.3 Retrospective stability

Because the detector's output for a fixed data prefix depends only on that prefix,
a signal computed at bar `i-1` can never be changed by any bar at index `>= i`. This
is asserted directly by a regression test.

---

## 5. Costs, fees and slippage

| Event | Slippage | Commission |
|-------|----------|------------|
| Entry | applied **against** the trader (long: +, short: -) | charged on entry notional |
| Exit (stop / target) | applied **against** the trader (long: -, short: +) | charged on exit notional |
| Exit at end of data | applied against the trader | charged on exit notional |

* `commission` is a fraction of notional, charged on **both** sides.
* `slippage` is a fraction of price, applied once per side.
* Commission is computed on the *executed* prices (post-slippage), so fees reflect
  the prices actually traded.

The previous engine charged commission on entry+exit but computed it from the
*pre-slippage* entry price; this is now consistent.

### 5.1 Position sizing

```
risk_amount   = equity * risk_per_trade
risk_per_unit = |entry_price - stop_loss|
size          = risk_amount / risk_per_unit
```

`equity` is the account equity *at the time the signal is acted on* (i.e. after
marking open positions to market on the execution bar), not the initial capital and
not the equity from an earlier bar. Sizing on stale equity is a look-ahead of a
different kind.

---

## 6. Data integrity requirements

The engine refuses to run on data that violates these rules. Validation happens in
`src/data/loaders.py` and is enforced by `validate_ohlcv`.

| Rule | Action on violation |
|------|---------------------|
| Timestamps are unique | Raise `DataValidationError` (or de-duplicate if `on_duplicate='last'`) |
| Timestamps are monotonically increasing | Sort, then re-check uniqueness |
| `high >= max(open, close)` | Raise `DataValidationError` |
| `low <= min(open, close)` | Raise `DataValidationError` |
| `high >= low` | Raise `DataValidationError` |
| `open/high/low/close > 0` | Raise `DataValidationError` |
| `volume >= 0` | Raise `DataValidationError` |
| No NaN in OHLCV | Raise `DataValidationError` |

`DataValidationError` is a `ValueError` subclass so existing `except ValueError`
handlers keep working.

### 6.1 Timestamps

Unix timestamps are milliseconds when the magnitude is consistent with
milliseconds, seconds otherwise. The check must not rely on `isinstance(x, int)`,
because pandas/numpy integer columns produce `numpy.int64`, which is **not** a
subclass of `int`. The previous loader used that check and consequently mis-parsed
every epoch-millisecond CSV into 1970, which also made `infer_timeframe` report `1m`
for hourly data.

---

## 7. Metrics annualisation

Annualised statistics (Sharpe, Sortino, volatility, CAGR) are scaled by the number
of bars per year implied by the data's own timestamp spacing, not a hard-coded 252.

```
bars_per_year = (365.25 * 24 * 60) / bar_minutes
```

For hourly data this is ~8766, not 252. The previous engine hard-coded 252 via
`quantstats`/`empyrical` defaults, which understates volatility and overstates the
annualisation factor for intraday data.

`BacktestConfig.periods_per_year` allows an explicit override; when it is `None` the
value is derived from the data.

---

## 8. Configuration surface

`BacktestConfig` gains the following fields, all with defaults that preserve the
previous behaviour except where an issue was confirmed:

| Field | Default | Purpose |
|-------|---------|---------|
| `intrabar_policy` | `'stop_first'` | Ambiguous-bar resolution |
| `intrabar_data` | `None` | Optional finer-grained series for `'intrabar'` policy |
| `fill_gaps_at_open` | `True` | Fill gap-through orders at the bar open |
| `periods_per_year` | `None` | Override annualisation; derived from data if `None` |
| `close_open_positions_at_end` | `True` | Close remaining positions on the final bar |
| `validate_data` | `True` | Enforce the section 6 integrity rules |

`BacktestResult` keeps its existing fields (`metrics`, `trades`, `equity_curve`,
`config`) and gains `open_positions_at_end` so the caller can see what was left
unclosed.

---

## 9. What this specification does NOT cover

* It does not change any strategy rule. The confluence thresholds, stop-loss
  placement, target calculation and R:R filters are untouched.
* It does not add Entry Model 1 or any new pattern.
* It does not model order book depth, partial fills beyond the bar range, or
  margin/liquidation.
* It does not resolve the intrabar sequence ambiguity beyond the documented
  conservative policy.
