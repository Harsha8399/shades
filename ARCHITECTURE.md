# Architecture Decisions

## Library vs Custom Code Strategy

This document outlines what we use libraries for vs custom implementations.

---

## 🔴 Use Libraries (Don't Reinvent)

| Component | TypeScript | Python | Rationale |
|-----------|-----------|--------|-----------|
| **ATR, RSI, MACD** | `technicalindicators` | `pandas-ta` | Standard calculations, well-tested |
| **Bollinger Bands** | `technicalindicators` | `pandas-ta` | Complex math |
| **Stochastic/ADX** | `technicalindicators` | `pandas-ta` | Standard indicators |
| **SMA/EMA** | `technicalindicators` | `pandas-ta` | Standard |
| **Performance Metrics** | - | `quantstats` / `empyrical` | Sharpe, Sortino, Max DD |
| **Peak Detection** | - | `scipy.signal.find_peaks` | Optimized algorithm |

### Usage

**TypeScript:**
```typescript
import { calculateATR_TI, calculateRSI } from './indicators/technical';
const atr = calculateATR_TI(candles, 14);
```

**Python:**
```python
from src.indicators.technical import calculate_atr, calculate_rsi
atr = calculate_atr(df, period=14)
```

---

## 🟢 Custom Implementation (Domain-Specific)

| Component | Location | Rationale |
|-----------|----------|-----------|
| **Swing Point Detection** | `indicators/swingPoints.ts`, `indicators/swing_points.py` | Trading-specific criteria |
| **Support/Resistance Zones** | `indicators/supportResistance.ts` | Zone clustering is strategy-specific |
| **Trendline Detection** | `indicators/trendlines.ts` | Multi-touch validation logic |
| **Fibonacci Levels** | `indicators/fibonacci.ts` | Simple math, swing-point dependent |
| **Pattern Detection** | `patterns/*.ts` | Core IP, no library exists |
| **Trade State Machine** | `core/TradeStateMachine.ts` | Domain-specific state transitions |
| **Paper Trading Engine** | `core/PaperTradingEngine.ts` | Tightly coupled to patterns |
| **Risk Manager** | `core/RiskManager.ts` | Custom rules |

---

## 🟡 Hybrid Approach (Evaluate)

| Component | Current | Option | Decision |
|-----------|---------|--------|----------|
| **Backtesting Engine** | Custom | `vectorbt`, `backtesting.py` | Keep custom for development, consider library for optimization |

### Why Custom Backtesting (For Now)

1. **Debugging**: Bar-by-bar execution makes signal debugging easier
2. **Parity**: Matches TypeScript paper trading logic exactly
3. **Control**: Full visibility into trade execution
4. **Learning**: Educational value for strategy development

### When to Use vectorbt

- When optimizing across 1000s of parameter combinations
- When backtesting on 10+ years of tick data
- When performance becomes a bottleneck

---

## Dependency Summary

### TypeScript (`app-ts/package.json`)
```json
{
  "technicalindicators": "^3.1.0",  // ATR, RSI, MACD, etc.
  "better-sqlite3": "^9.4.3",       // Database
  "commander": "^12.0.0",           // CLI
  "csv-parse": "^5.5.3"             // Data loading
}
```

### Python (`research-py/requirements.txt`)
```
pandas-ta>=0.3.14b       # Technical indicators
scipy>=1.11.0            # Peak detection
quantstats>=0.0.62       # Performance metrics
empyrical-reloaded>=0.5.9 # Risk metrics (alternative)
matplotlib>=3.8.0        # Visualization
mplfinance>=0.12.10b0    # Candlestick charts
```

---

## File Structure After Refactoring

```
app-ts/src/indicators/
├── atr.ts                # ⚠️  Keep as fallback, use technical.ts
├── fibonacci.ts          # ✅ Custom (swing-dependent)
├── supportResistance.ts  # ✅ Custom (zone clustering)
├── swingPoints.ts        # ✅ Custom (trading-specific)
├── technical.ts          # 🔴 Library wrapper (USE THIS)
├── trendlines.ts         # ✅ Custom (multi-touch)
└── index.ts              # Exports all

research-py/src/indicators/
├── technical.py          # 🔴 Library wrapper (USE THIS)
├── swing_points.py       # 🟡 scipy + custom
├── fibonacci.py          # ✅ Custom
├── support_resistance.py # ✅ Custom
└── trendlines.py         # ✅ Custom
```

---

## Migration Checklist

- [x] Add `technicalindicators` to TypeScript
- [x] Add `pandas-ta` to Python
- [x] Add `quantstats` for metrics
- [x] Add `scipy` for peak detection
- [x] Create library wrapper modules
- [x] Update exports
- [ ] Migrate patterns to use library ATR (optional)
- [ ] Add vectorbt for optimization (v2.0)

---

## Trade-offs

| Aspect | Library | Custom |
|--------|---------|--------|
| **Reliability** | ✅ Battle-tested | ⚠️ May have edge cases |
| **Performance** | ✅ Optimized | ⚠️ May be slower |
| **Control** | ❌ Black box | ✅ Full visibility |
| **Debugging** | ❌ Harder | ✅ Step-through |
| **Learning** | ❌ Abstract | ✅ Understand mechanics |

**Our Strategy:** Use libraries for standard math, custom for strategy logic.

