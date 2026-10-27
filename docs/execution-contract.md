# Execution Contract: Shades Trading Platform

## Overview

This document defines the intended execution behavior for both the TypeScript production engine (app-ts) and the Python research engine (research-py). Both engines MUST adhere to this contract to ensure trade-parity.

---

## 1. Signal Availability

**Rule**: A signal becomes available **after** the signal candle closes. The signal is generated at the close of candle `N` and can only be acted upon starting from candle `N+1`.

- **Signal candle**: The last closed candle at decision time (index `currentIndex - 1` in ReplayEngine)
- **First evaluation candle**: The next candle after the signal candle (index `currentIndex`)
- **No look-ahead**: The signal generation uses only candles up to and including the signal candle

**Implementation**:
- TypeScript: `detectSignal(prefix, context, absoluteCandleIndex)` where `prefix` ends at signal candle
- Python: `detect_signal(prefix, atr)` where `prefix` ends at signal candle

---

## 2. Entry Fill Timing and Price

### TypeScript (ReplayEngine) - CURRENT
- **Fill timing**: Signal candle close (the signal candle itself)
- **Fill price**: `signal.entryPrice` = signal candle close
- **Gap handling**: None
- **Slippage**: None (simulated on index prices)
- **Position sizing**: Not implemented (simulated on index prices only)

### Python (BacktestEngine) - CURRENT
- **Fill timing**: Next bar open (next candle after signal)
- **Fill price**: Resolved via `_resolve_entry_fill()`:
  - If next bar reaches entry price → fill at entry (with slippage)
  - If next bar gaps beyond entry → fill at gap open (with slippage)
  - If next bar doesn't reach entry → order remains pending
- **Gap handling**: Fills at gap open (worse price for trader)
- **Slippage**: Configurable (default 0.05%)
- **Position sizing**: Equity-based (1% risk per trade)

### INTENDED CONTRACT (TO BE IMPLEMENTED)
Both engines should use **next-bar-open execution with gap handling** to model realistic order fills.

| Aspect | Intended Contract |
|--------|-------------------|
| Signal availability | After signal candle closes (index N) |
| First possible fill | Next candle (index N+1) |
| Fill price resolution | Next bar's OHLC determines fill |
| Gap handling | Fill at gap open (worse for trader) |
| Slippage | 0.05% against trader |
| Position sizing | 1% equity risk per trade (configurable) |
| Fill timing | At next bar's open (for limit orders) or when price touches entry |

---

## 3. Stop-Loss and Target Execution

### Intended Contract
- **Stop-loss**: Triggered when price crosses level (any time during bar)
- **Target**: Triggered when price crosses level (any time during bar)
- **Ambiguous same-bar touches** (both stop and target touched in same bar):
  - Policy: `intrabar_policy` (configurable: `STOP_FIRST`, `TARGET_FIRST`, `AMBIGUOUS`)
  - Default: `STOP_FIRST` (conservative)
- **Evaluation**: Uses actual bar high/low (not just close)

### Current Implementation
| Engine | Stop/Target | Ambiguous Policy |
|--------|-------------|------------------|
| TypeScript | Evaluates using high/low of future candles | `STOP_FIRST` (hardcoded in `evaluateStopTarget`) |
| Python | Evaluates using high/low of future bars | Configurable `intrabar_policy` (default `STOP_FIRST`) |

---

## 4. Position Sizing

### Intended Contract
- **Risk model**: Fixed fractional (1% of equity per trade)
- **Size calculation**: `size = equity * risk_pct / abs(entry_price - stop_loss)`
- **Equity**: Current account equity (including unrealized P&L of open positions)
- **Max positions**: Configurable limit (default: no limit for research)

### Current Implementation
| Engine | Position Sizing |
|--------|-----------------|
| TypeScript | Not implemented (simulated on index prices, no sizing) |
| Python | 1% equity risk, equity includes unrealized P&L |

---

## 5. Transaction Costs and Slippage

### Intended Contract
| Cost | Value | Application |
|------|-------|-------------|
| Slippage | 0.05% (5 bps) | Against trader on entry |
| Commission | 0 (simulated on index prices) | N/A |
| Spread | 0 (simulated on index prices) | N/A |

### Current Implementation
| Engine | Slippage | Commission |
|--------|----------|------------|
| TypeScript | None | None |
| Python | 0.05% (configurable) | None |

---

## 5. Exit and Evaluation Horizons

### Intended Contract
| Horizon | Definition | Default |
|---------|------------|---------|
| Directional evaluation | Candles after signal to assess direction | 50 candles |
| Trade resolution | Candles after entry to resolve stop/target | Same as directional (configurable) |
| Inconclusive | Insufficient future candles for evaluation | Marked `INCONCLUSIVE` |

### Current Implementation
| Engine | Directional Horizon | Trade Resolution | Inconclusive |
|--------|---------------------|------------------|--------------|
| TypeScript | Configurable (default 50) | Separate config (default same) | `INCONCLUSIVE` if insufficient candles |
| Python | Not applicable (trade-based) | Until stop/target hit | Trades left open at end |

---

## 6. Gap Handling

### Intended Contract
- **Gap up (LONG)**: If next bar opens above entry → fill at open (worse fill)
- **Gap down (SHORT)**: If next bar opens below entry → fill at open (worse fill)
- **Gap against entry**: Order remains pending until price returns to entry level

### Current Implementation
| Engine | Gap Handling |
|--------|--------------|
| TypeScript | None |
| Python | Fills at gap open (configurable `fill_gaps_at_open`) |

---

## 6. Ambiguous Same-Candle Stop/Target Touches

### Intended Contract
When a single bar's high >= target AND low <= stop:
- `STOP_FIRST`: Stop-loss hit first (conservative, default)
- `TARGET_FIRST`: Target hit first (optimistic)
- `AMBIGUOUS`: Mark as ambiguous outcome

### Current Implementation
| Engine | Policy |
|--------|--------|
| TypeScript | `STOP_FIRST` (hardcoded) |
| Python | Configurable `intrabar_policy` (default `STOP_FIRST`) |

---

## 7. Transaction Costs

### Intended Contract
| Cost | Rate | Applied |
|------|------|---------|
| Slippage | 0.05% | Entry fill |
| Commission | 0 | N/A (index simulation) |
| Spread | 0 | N/A (index simulation) |

### Current Implementation
| Engine | Slippage | Commission |
|--------|----------|------------|
| TypeScript | None | None |
| Python | 0.05% (configurable) | None |

---

## 8. Evaluation Methodology

### Directional Evaluation
- **Window**: Next `evaluationHorizonCandles` after signal
- **Criterion**: 
  - LONG: Any future close > entry price
  - SHORT: Any future close < entry price
- **Inconclusive**: If insufficient future candles

### Trade Resolution
- **Window**: Next `tradeResolutionHorizonCandles` after entry fill
- **Outcomes**: `TARGET`, `STOP`, `AMBIGUOUS`, `INCONCLUSIVE`
- **R-multiple**: `(exit_price - entry_price) / abs(entry_price - stop_loss)` (signed for direction)

---

## 9. Implementation Plan to Achieve Parity

### Phase 1: Align Entry Execution (Priority 1)
1. **TypeScript**: Implement pending order system with next-bar fill resolution
2. **TypeScript**: Add slippage (0.05%) and gap handling
3. **TypeScript**: Add position sizing (1% equity risk)
4. **Both**: Ensure signal → next-bar fill timing is identical

### Phase 2: Align Trade Management (Priority 2)
1. **TypeScript**: Implement stop/target monitoring with ambiguous handling
2. **Both**: Ensure identical ambiguous bar resolution (`STOP_FIRST`)
2. **TypeScript**: Add position sizing (1% equity risk)

### Phase 3: Align Evaluation (Priority 3)
1. **Both**: Ensure identical evaluation horizons and ambiguous outcomes
2. **Both**: Ensure identical R-multiple calculations

---

## 10. Configuration Parameters (Single Source of Truth)

All execution parameters should be defined in `shared/fixtures/strategy_spec.json`:

```json
{
  "execution": {
    "slippage_bps": 5,
    "fill_gaps_at_open": true,
    "intrabar_policy": "STOP_FIRST",
    "risk_per_trade_pct": 0.01,
    "slippage_applied_to": "ENTRY",
    "fill_gaps_at_open": true,
    "intrabar_policy": "STOP_FIRST",
    "evaluation_horizon_candles": 50,
    "trade_resolution_horizon_candles": 50,
    "unresolved_policy": "MTM"
  }
}
```

---

## Summary of Key Differences to Resolve

| # | Difference | TypeScript | Python | Resolution |
|---|------------|------------|--------|------------|
| 1 | Entry fill timing | Signal candle close | Next bar open | Both: next bar open |
| 2 | Gap handling | None | Fill at gap open | Both: fill at gap open |
| 3 | Slippage | None | 0.05% | Both: 0.05% |
| 4 | Position sizing | None | 1% equity risk | Both: 1% equity risk |
| 5 | Commission | None | None | Both: 0 |
| 5 | Position management | Simple | Pending orders, equity sizing | Implement pending orders in TS |
| 6 | Equity for sizing | N/A | Includes unrealized P&L | Both: include unrealized P&L |
| 7 | Gap handling | None | Fill at gap open | Both: fill at gap open |
| 8 | Ambiguous bar policy | STOP_FIRST (hardcoded) | Configurable (STOP_FIRST) | Both: STOP_FIRST |

---

## Next Steps

1. **Immediate**: Document this contract in `docs/execution-contract.md`
2. **Phase 1**: Implement pending order system in TypeScript ReplayEngine
3. **Phase 2**: Add slippage, gap handling, position sizing to TypeScript
4. **Phase 3**: Run trade-parity tests until all pass
5. **Validation**: Run on historical data with both engines