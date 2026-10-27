# Phase 2: Data Causality — Design & Conventions

Status: **Implemented** (Python `src/data/loaders.py::resample_ohlcv`,
TypeScript `src/core/CandleResampler.ts`). Tests:
`research-py/tests/test_resampler_causality.py`,
`app-ts/tests/resampler-causality.test.ts`.

## Problem

A higher-timeframe (HTF) candle whose period has not fully closed is a
_forming_ bar. Its high/low/close keep changing until the period ends.
If a decision made at the last lower-timeframe (LTF) bar consults such a
bar, the decision sees information from the future — a look-ahead bug in
disguise. This is the root cause of DIV-10/DIV-11-adjacent divergences
where backtest results differed from live behavior.

## Rules

1. **P5 (restated)**: HTF filters use only _completed_ HTF candles.
2. A bucket is complete only when its final source bar reaches the end of
   the bucket period. Adding the bar duration (rather than testing the
   bar's start timestamp) is what makes a bucket whose final source bar is
   the last bar of the period count as complete.
3. The trailing bucket of any resample is dropped by default
   (`drop_forming_bar=True` in Python; the TS resampler always drops an
   incomplete final chunk). Set `drop_forming_bar=False` only when the
   caller knows the series is complete (e.g. fixed historical fixtures).

## Bucketing convention (shared, deliberate)

Buckets are anchored to the **wall clock**:

- Python: pandas `resample` default (00:00, 04:00, ... in the index's
  timezone).
- TypeScript: chunks of `target/source` candles starting at the first
  candle whose timestamp is an epoch multiple of the target duration
  (falling back to the first candle when none aligns).

> **Correction (Stage 3 Phase 3 review).** These two implementations only
> coincide when the source series contains a candle exactly on an HTF
> boundary — true for the 15m/5m/1h/1m sources the extractor is currently
> tested against (the shared parity fixture exercised this and agrees), but
> NOT in general. Measured counter-cases:
>
> - 30m candles aligned to 09:15 (no candle ever sits on a 4h boundary):
>   Python emits wall-clock buckets (12:00, 16:00, ...; 11 buckets for 100
>   bars), TypeScript emits sequential chunks (09:15, 13:15, ...; 12
>   buckets).
> - NSE 15m sessions (09:15–15:30, 3 days): Python emits wall-clock-
>   anchored candles (12:00 d1, 08:00 d2, 12:00 d2 — the last bucket
>   dropped), while TypeScript emits sequential 16-candle chunks that cross
>   the overnight gap (12:00 d1, 09:45 d2, 13:45 d2, 11:30 d3).
>
> So "both engines share the wall-clock convention" is accurate only for
> aligned inputs; the session and non-aligned-offset cases are open design
> decisions (Q11/Q12) for Stage 4. Until then the extractor parity claim is
> scoped to the aligned fixtures, and the two engines must NOT be assumed
> to agree on NSE session data.

This is NOT session-anchored. On NSE (09:15–15:30, 375 minutes) a 4h
wall-clock bucket is not aligned to the trading session, so the first
bucket of a session is partial. Session-anchored bucketing was considered
and rejected for Stage 3 because it would diverge from the TS epoch
alignment and change all existing parity fixtures.

## Swing confirmation timing

Swings are confirmed only after `rightBars` subsequent bars have closed.

- Python: `src/indicators/swings.py` — a swing at index `i` is usable
  from bar `i + rightBars` onward.
- TypeScript: `src/indicators/swingPoints.ts` — each swing carries an
  explicit `confirmedAt = i + rightBars` field, making the guarantee
  testable. (This field was previously declared but never populated; it
  is now set at construction.)

Both engines therefore agree on when a swing becomes visible to
downstream logic (trendlines, stop placement).

## Prefix tests (look-ahead detection)

The core property: for any prefix of the input series, the resampler
output restricted to periods fully covered by the prefix must be
identical to the corresponding slice of the full-series output.

Tests cover:

- prefix stability (cuts at 50/100/200/300 bars),
- **append-future invariance** — resampling the series truncated at bar
  _k_ and resampling the full series must give identical buckets for
  every period closed at or before _k_; future data adds buckets, it
  never rewrites existing ones. This is the decisive test: it fails if
  any forming-bar leakage exists, not merely if aggregation is wrong.
- no forming bar emitted when input ends mid-period,
- `drop_forming_bar=False` legacy behavior preserved,
- empty/short inputs,
- wall-clock anchoring convention (both engines).

## Swing confirmation parity

Verified equivalent between engines:

- `confirmedAt = index + rightBars` in TypeScript matches
  `confirmed_at = i + right_bars` in Python.
- Both guarantee every returned swing satisfies
  `confirmedAt <= last bar index` (the swing is provable from the data
  supplied).
- Boundary conditions tested (`app-ts/tests/swing-confirmation.test.ts`):
  too-short input returns nothing; a swing confirmed exactly at the last
  bar is returned; a swing is invisible to a filter at
  `as_of < confirmedAt` and visible at `as_of >= confirmedAt`.
- The added `confirmedAt` field is additive; all existing callers
  (`fibonacci.ts`, `supportResistance.ts`, `trendlines.ts`,
  `cli/tradeParityDump.ts`) consume only `type/price/index/timestamp` and are
  unaffected.

## Remaining limitations

1. **Wall-clock bucketing on NSE.** A 4h bucket does not tile the 375-minute
   NSE session; the first bucket of each session is partial by construction.
   Both engines share this convention, so it is a parity-safe simplification,
   not a fidelity claim. Session-aware bucketing (Q11) remains open.
2. **`drop_forming_bar=False` is a footgun.** It exists only for fixed
   historical fixtures; callers using it on live data reintroduce the
   look-ahead. No runtime guard is implemented (the flag is documented
   instead).
3. **The prefix tests cover the resampler only.** The trendline extractor
   (Phase 3) needs its own prefix test at the extractor level — the design
   (`MTF_TRENDLINE_DESIGN.md` §4, L1–L6) specifies it, and it is not yet
   written because the extractor does not exist yet.
4. **Timezone-naive timestamps.** The Python tests use naive timestamps; the
   TS engine uses epoch ms. The bucketing convention is stated in each
   engine's own clock; cross-engine equality is asserted by the shared
   fixture tests, not by these unit tests.

## Verification record (2026-10-23)

- Python: `pytest` — **196 passed**, exit 0.
- TypeScript: `jest` — **100 passed** (10 suites), exit 0.
- `tsc --noEmit` — clean, exit 0.
- Git audit: the only source changes are `swingPoints.ts` (additive
  `confirmedAt`), `CandleResampler.ts` (forming-bar drop), and
  `loaders.py` (causal resample). The tracked SQLite files
  (`trades.db-shm/-wal`) show as modified in `git status` but their
  content is unchanged by the test runs (binary size identical; `-wal`
  mtime predates this session). No parity fixture or expected value was
  regenerated.
