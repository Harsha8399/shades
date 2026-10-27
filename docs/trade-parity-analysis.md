# Trade Parity Failure Analysis

## Summary of Failing Tests (6/9)

| Test | Status | Classification |
|------|--------|----------------|
| `test_signal_count_matches` | FAIL | Architectural difference |
| `test_short_trade_matches_on_every_field` | FAIL | Architectural difference |
| `test_long_trade_divergence_is_exactly_DIV_10` | FAIL | Known divergence (DIV-10) |
| `test_size_difference_is_downstream_of_DIV_10` | FAIL | Downstream of DIV-10 |
| `test_pnl_difference_follows_from_the_size_difference` | FAIL | Downstream of DIV-10 |
| `test_no_unexplained_differences_remain` | FAIL | Downstream of above |

---

## Detailed Comparison of Trades

### Trade 1: LONG @ 2024-01-02T15:15

| Field | Python | TypeScript | Difference |
|-------|--------|------------|------------|
| Signal Time | 2024-01-02T15:15:00 | 2024-01-02T15:15:00.000Z | Same |
| Entry Price | **100.0** | **100.2** | **EXECUTION MODEL** |
| Signal Price | 100.2 | 100.2 | Same |
| Stop Loss | 99.98 | 99.98 | Same |
| Target | 100.64 | 100.64 | Same |
| Exit Time | 2024-01-02T15:45:00 | 2024-01-02T15:45:00.000Z | Same |
| Exit Price | 99.98 | 99.98 | Same |
| Exit Reason | STOPPED | STOPPED | Same |
| R-Multiple | -1.0 | -1 | Same |
| **Size** | **50000** | **4545** | **POSITION SIZING** |

**Root Causes:**
1. **Entry Price**: Python uses next-bar-open fill (100.0), TS uses signal-candle-close (100.2)
2. **Position Sizing**: Python uses 1% equity risk with equity including unrealized P&L; TS uses simple index simulation

---

### Trade 2: LONG @ 2024-01-02T15:45 (Python only)

| Field | Python | TypeScript |
|-------|--------|------------|
| Direction | LONG | **ABSENT** |
| Signal Time | 2024-01-02T15:45:00 | - |
| Entry Price | 100.1 | - |

**Root Cause**: TypeScript cancels this order (DIV-10: ORDER_INVALIDATION). Python fills it because the LONG from Trade 1 is still open and equity includes its unrealized P&L.

---

### Trade 3: SHORT @ 2024-01-03T03:30

| Field | Python | TypeScript | Difference |
|-------|--------|------------|------------|
| Signal Time | 2024-01-03T03:30:00 | 2024-01-03T03:30:00.000Z | Same |
| Entry Price | **108.0** | **107.8** | **EXECUTION MODEL** |
| Signal Price | 107.8 | 107.8 | Same |
| Stop Loss | 108.02 | 108.02 | Same |
| Target | 100.2 | 100.2 | Same |
| Exit Time | 2024-01-03T07:00:00 | 2024-01-03T07:00:00.000Z | Same |
| Exit Price | 108.02 | 108.02 | Same |
| Exit Reason | STOPPED | STOPPED | Same |
| **Size** | **50490** | **4500** | **POSITION SIZING** |
| R-Multiple | -1.0 | -1 | Same |

**Root Causes:**
1. **Entry Price**: Python next-bar-open with gap fill (108.0), TS signal-candle-close (107.8)
2. **Position Sizing**: Different equity calculations

---

### Trade 4-6: Additional SHORT trades (Python only)

Python has 4 additional SHORT trades at T04:00, T04:15, T04:30, T05:00 that TS rejects as "Duplicate signal - already have open trade from same pattern"

**Root Cause**: Python allows multiple SHORT entries while position is open (pyramiding or re-entry); TS blocks duplicate signals from same pattern.

---

### Trade 7 (Python) vs Trade 1 (TS): SHORT @ 2024-01-03T03:30/07:00 - **THE DIV-10 DIVERGENCE**

| Field | Python (Trade 3) | TypeScript (Trade 1) |
|-------|------------------|----------------------|
| Direction | SHORT | SHORT |
| Signal Time | 2024-01-03T03:30:00 | 2024-01-03T07:00:00.000Z |
| Entry Price | 108.0 | 107.9 |
| Exit Reason | **STOPPED** | **TARGET** |
| R-Multiple | -1.0 | **70** |

**This is the DIV-10 divergence documented in the spec:**
- Python: Signal at 03:30, fills at 03:45, gets stopped out at 07:00
- TypeScript: Signal at 03:30, order cancelled (DIV-10), later signal at 07:00 fills and hits target

---

## Classification of 6 Failures

| Test | Classification | Root Cause |
|------|----------------|------------|
| `test_signal_count_matches` | **Architectural (Intentional)** | Different execution models: Python fills multiple SHORT orders; TS blocks duplicates |
| `test_short_trade_matches_on_every_field` | **Architectural (Intentional)** | Different entry prices (gap fill vs signal close) and position sizing |
| `test_long_trade_divergence_is_exactly_DIV_10` | **Known Divergence (Documented)** | DIV-10: ORDER_INVALIDATION - TS cancels LONG order that Python fills |
| `test_size_difference_is_downstream_of_DIV_10` | **Downstream of DIV-10** | Python sizes SHORT including unrealized P&L from LONG; TS cancelled LONG |
| `test_pnl_difference_follows_from_the_size_difference` | **Downstream of DIV-10** | Different position sizes → different P&L |
| `test_no_unexplained_differences_remain` | **Downstream of above** | All differences traced to above causes |

---

## Recommendation

**Do NOT "fix" these to make tests pass.** The differences are:

1. **Intentional execution model differences** (entry fill timing, gap handling, position sizing)
2. **Documented divergences** (DIV-10)
3. **Downstream consequences** of the above

**To achieve true parity, the execution contract must be aligned first** (see `docs/execution-contract.md`). This requires implementing in TypeScript:
- Pending order system with next-bar fill resolution
- Gap fill handling
- Slippage (0.05%)
- Position sizing (1% equity risk)
- Equity calculation including unrealized P&L

**Only after execution contract alignment** should trade-parity tests be expected to pass.

---

## Immediate Actions

1. **Document** the execution contract differences (done: `docs/execution-contract.md`)
2. **Do not modify tests** to expect different behavior - the tests correctly detect real differences
3. **Implement** the execution contract in TypeScript ReplayEngine
3. **Re-run** trade-parity tests after execution contract alignment