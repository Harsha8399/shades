# The Shades of Trades - Complete Technical Reference for Real-Time Pattern Recognition

## Master Index

This document provides a unified reference for all techniques from "The Trader's Playbook" by Apoorva Sharma, structured for real-time algorithmic pattern recognition.

---

## Technique Modules

| # | Technique | File | Core Purpose |
|---|-----------|------|--------------|
| 1 | **Trendlines** | `01-trendlines.md` | Trend definition, continuation vs reversal detection |
| 2 | **Support & Resistance** | `02-support-resistance.md` | Key levels, role reversal, zone identification |
| 3 | **Fibonacci Retracement** | `03-fibonacci-retracement.md` | Pullback zones, confluence with levels/trendlines |
| 4 | **Confluence & Liquidity** | `04-confluence-liquidity.md` | Multi-confirmation zones, entry trigger areas |
| 5 | **Entry Models & Trade Management** | `05-entry-models-trade-management.md` | Two entry models, trailing stops, stoploss strategies |
| 6 | **Multi-Timeframe Analysis** | `06-multi-timeframe.md` | Hierarchical trend alignment, TF-specific roles |
| 7 | **Psychology & Risk Management** | `07-psychology-risk.md` | Discipline, position sizing, daily limits, journaling |

---

## Unified Real-Time Recognition Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    MARKET DATA INPUT                            │
│              (Candles: 15m, 1H, 4H, Daily, Weekly)             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  MULTI-TIMEFRAME ANALYSIS (Module 6)            │
│  • Weekly (log): Major trendlines, broad structure             │
│  • Daily: Primary S/R, trendlines, swing points                │
│  • 4H/1H: Refinement, trade management                         │
│  • 15m: Intraday precision, entry execution                    │
│  • Output: Dominant trend, alignment score, conflicts          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  STRUCTURE DETECTION                            │
│  • Swing Points (Module 6)                                     │
│  • Trendlines (Module 1) - wick-based, ≥2 touches, origin      │
│  • Support/Resistance (Module 2) - rectangle zones, role flip  │
│  • Fibonacci (Module 3) - on confirmed swings, broader trend   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CONFLUENCE ENGINE (Module 4)                   │
│  For each price level in range:                                │
│    Count: S/R + Trendline + Fib + Swing Point                  │
│    Tier 1 (≥3): High Liquidity Zone → Entry Trigger            │
│    Tier 2 (2): Potential Zone → Needs 3rd confirmation         │
│    Tier 3 (1): Reference only                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ENTRY MODEL SELECTION (Module 5)               │
│  At Tier 1 Zone:                                               │
│    Calculate Model 1 R:R                                       │
│    If R:R ≥ 1.5 & script favors M1 → Model 1 (Direct)          │
│    Else → Model 2 (Trendline Break)                            │
│  At Tier 2 Zone:                                               │
│    Must use Model 2 (need 3rd confirmation)                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  RISK VALIDATION (Module 7)                     │
│  • Position size = Risk% × Equity / StopDistance               │
│  • R:R ≥ 1.5 mandatory                                         │
│  • Daily/Weekly/Drawdown limits                                │
│  • Max concurrent/correlated trades                            │
│  • Psychological state check                                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  EXECUTION & MANAGEMENT                         │
│  • Entry per model                                             │
│  • Stoploss per model rules                                    │
│  • Target = next major level                                   │
│  • Trail: 15m (intraday) / 1H (swing) trendline on close       │
│  • Journal every trade with full context                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Real-Time Decision Matrix

| Condition | Action |
|-----------|--------|
| No MTF alignment (conflicts) | **NO TRADE** |
| Dominant trend sideways/choppy | **NO TRADE** |
| Price not at confluence zone | **WAIT** |
| At Tier 3 zone (1 confirmation) | **WAIT** |
| At Tier 2 zone (2 confirmations) | **WAIT for Model 2 trigger** |
| At Tier 1 zone, Model 1 R:R < 1.5 | **WAIT for Model 2 trigger** |
| At Tier 1 zone, Model 1 R:R ≥ 1.5 | **ENTRY MODE 1** |
| Trendline breaks at Tier 1/2 zone | **ENTRY MODE 2** |
| Risk validation fails | **BLOCK TRADE** |
| Psychological state compromised | **BLOCK TRADE** |

---

## Minimum Viable Setup Checklist

Before any trade, ALL must be ✅:

```
MTF ALIGNMENT
[ ] Weekly trend identified (log scale)
[ ] Daily trend aligned with weekly
[ ] 4H/1H structure supports daily
[ ] No major TF conflicts

STRUCTURE
[ ] Valid swing high/low confirmed
[ ] Trendlines: ≥2 wick touches, from trend origin
[ ] S/R levels: rectangle zones, role tracked
[ ] Fibonacci: on confirmed swing, broader trend direction

CONFLUENCE
[ ] Current price at/near Tier 1 zone (≥3 confirmations)
[ ] Zone width defined (not single price)
[ ] Confirmations: S/R + Trendline + Fib minimum

ENTRY
[ ] Model selected (1 or 2) with rationale
[ ] Stoploss calculated per model rules
[ ] Target = next major level (minor levels noted)
[ ] R:R ≥ 1.5 confirmed

RISK
[ ] Position size = Risk% × Equity / StopDistance
[ ] Daily loss < limit (e.g., 3%)
[ ] Weekly loss < limit (e.g., 10%)
[ ] Drawdown < limit (e.g., 20%)
[ ] Max concurrent trades not exceeded
[ ] Psychological state: calm, no FOMO/revenge

MANAGEMENT
[ ] Trailing timeframe selected (15m/1H)
[ ] Trailing trendline identified (broader preferred)
[ ] Trade journaled with full context
```

---

## Instrument-Specific Notes

| Instrument | Key Characteristics |
|------------|---------------------|
| **NSE Equities** | Daily/1H primary, 15m entry, respect 9:15-3:30 session |
| **NSE F&O** | Higher leverage, stricter risk, watch expiry weeks |
| **Crude Oil** | 78.6% Fib common in bullish momentum, 4H important |
| **Gold/Silver/Forex** | 24h market, 4H timeframe critical, weekly log scale |
| **Indices (Nifty/BankNifty)** | High liquidity, 15m/1H for intraday, daily for swing |

---

## Backtesting Requirements (Per Instrument)

> "You cannot skip the back testing button on your trading journey. You will just have to do it."

### Minimum Per Script
- **100+ trades** per entry model
- Test both Model 1 and Model 2
- Record: Win rate, Avg R, Max DD, Profit Factor, Expectancy
- Choose model with better risk-adjusted returns
- Re-test quarterly or on regime change

### What to Track
```typescript
interface BacktestRecord {
  script: string;
  model: 1 | 2;
  trades: number;
  winRate: number;
  avgR: number;
  maxDD: number;
  profitFactor: number;
  expectancy: number;
  bestStreak: number;
  worstStreak: number;
  avgHoldTime: number;
  timeOfDay: 'morning' | 'mid' | 'close';
  marketRegime: 'trending' | 'ranging' | 'volatile';
}
```

---

## Integration with Shades Platform

### Existing Components Mapping

| Technique | Shades Module | Integration Point |
|-----------|---------------|-------------------|
| Trendlines | `core/StructureAnalyzer.ts` | `detectTrendlines()` |
| S/R Levels | `core/StructureAnalyzer.ts` | `detectLevels()` |
| Fibonacci | `indicators/fibonacci.ts` | `calculateRetracements()` |
| Confluence | `core/PatternEngine.ts` | `ConfluenceZonePattern` |
| Entry Models | `core/PaperTradingEngine.ts` | `EntryModel1`, `EntryModel2` |
| MTF | `core/MTFAnalyzer.ts` | `analyzeMTF()` |
| Risk/Psychology | `core/RiskManager.ts` | `validateTrade()` |

### New Components Needed

1. **`ConfluenceEngine`** - Real-time multi-confirmation detection
2. **`LiquidityMap`** - Live zone tracking with approach/entry alerts
3. **`MTFMonitor`** - Continuous alignment scoring
4. **`RiskMonitor`** - Pre-trade/during-trade validation alerts
5. **`PsychologyTracker`** - Emotional state logging
6. **`TradeJournal`** - Structured logging for pattern analysis

---

## Quick Reference Cards

### Confluence Tier Quick Reference

```
TIER 1 (3+ confirmations) → ENTRY ZONE
├── S/R + Trendline + Fib
├── S/R + Trendline + Swing
├── Trendline + Fib + Swing
└── S/R + Fib + Swing

TIER 2 (2 confirmations) → WAIT FOR 3rd
├── S/R + Trendline
├── S/R + Fib
├── Trendline + Fib
└── Any + Swing

TIER 3 (1 confirmation) → REFERENCE ONLY
```

### Entry Model Quick Reference

```
MODEL 1 (Direct)
├── Trigger: Price at Tier 1 zone
├── SL: Next retracement + trendline buffer
├── R:R must be ≥ 1.5
└── Use when: Script backtested for M1, SL acceptable

MODEL 2 (Trendline Break)
├── Trigger: Immediate TL break at zone
├── SL: Next Fib + broader TL OR Swing + broader TL
├── No candle close wait
└── Use when: M1 R:R < 1.5, only 2 confirmations, script prefers M2
```

### Trailing Stop Quick Reference

```
INTRADAY → 15m trendline on candle close
SWING → 1H trendline on candle close

SELECTION:
1. Broader trendline (shallower) = default
2. Steeper only if: deep in profits OR target near
3. If hitting too often → weakening, switch to broader
```

---

## File Structure

```
docs/techniques/
├── README.md                    # This file
├── 01-trendlines.md
├── 02-support-resistance.md
├── 03-fibonacci-retracement.md
├── 04-confluence-liquidity.md
├── 05-entry-models-trade-management.md
├── 06-multi-timeframe.md
└── 07-psychology-risk.md
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-21 | Initial extraction from "The Trader's Playbook" PDF |

---

## Source Attribution

All techniques extracted from: **"The Trader's Playbook" (The Shades of Trades)** by **Apoorva Sharma**, Founder, The Shades of Trades.

This reference is structured for algorithmic implementation in the Shades Trading Platform.