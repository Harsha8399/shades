# Entry Models & Trade Management - Technical Reference for Real-Time Pattern Recognition

## Overview
Two entry models at high liquidity zones (confluence areas). Both equally valid - choice depends on script behavior and backtesting results.

## Entry Model 1: Direct Entry (Aggressive)

### Trigger
- Price **reaches** high liquidity zone (≥3 confirmations)
- **Immediate entry** - no waiting

### Stoploss Placement
- Slightly above next retracement level
- Keep suitable distance from trendline
- Must calculate risk:reward before entry

### Target Setting
- Next crucial support/resistance
- Watch for minor levels between entry and target that may create chaos

### Risk Profile
- **Higher risk**, more aggressive
- Better for scripts demanding immediate action
- Requires acceptable R:R (≥ 1.5)

### When to Use
- Script backtesting shows Model 1 superior
- Stoploss distance acceptable for R:R
- High confidence in confluence zone

## Entry Model 2: Trendline Break Confirmation (Conservative)

### Trigger
- Price at high liquidity zone
- **Wait for immediate trendline break**
- Enter **on trendline break** (no candle close confirmation needed)

### Stoploss Placement (Two Methods)

#### Method A: Fib + Trendline
- Above next Fibonacci level
- Above broader ongoing trendline

#### Method B: Swing High + Trendline
- Slightly above latest swing high
- Above broader trendline
- Little to no chance of retest if trade works

### Risk Profile
- **Lower risk**, more conservative
- Better risk:reward typically
- Requires patience for confirmation

### When to Use (Forced Scenarios)
1. **Model 1 stoploss too wide** → poor R:R (< 1.5)
2. **Only 2 confirmations** (level + fib, no trendline) → need trendline break as 3rd confirmation
3. Script backtesting shows Model 2 superior

## Trade Management: Trailing Stops with Trendlines

### Concept
Use trendlines to **run profits** - trail stoploss on candle closing basis

### Timeframe Selection
| Trading Style | Trail Timeframe |
|---------------|-----------------|
| Intraday | 15 minutes |
| Swing | 1 Hour |

### Trendline Selection Rules
- **Too steep** = higher break probability
- **Steeper OK when**: deep in profits OR target nearby
- **Default**: Broader timeframe trendline (gives room to breathe)
- **Touchpoint paradox**: More touches = stronger BUT hitting too often = weakening

### Trailing Logic
```
On each candle close:
  1. Calculate trendline value at current time
  2. If price closed beyond trendline (against position):
     - Exit trade (trail hit)
  3. Else:
     - Update stoploss to trendline value
```

## Stoploss Strategies Summary

| Scenario | Stoploss Placement |
|----------|-------------------|
| Model 1 Long | Below next retracement + trendline buffer |
| Model 1 Short | Above next retracement + trendline buffer |
| Model 2 Long (Method A) | Below next Fib level + broader trendline |
| Model 2 Long (Method B) | Below latest swing low + broader trendline |
| Model 2 Short (Method A) | Above next Fib level + broader trendline |
| Model 2 Short (Method B) | Above latest swing high + broader trendline |
| Trailing (Long) | Trendline value on candle close |
| Trailing (Short) | Trendline value on candle close |

## Target Management

### Primary Target
- Next crucial support (short) / resistance (long)
- Must check for **minor levels between entry and target**
- Minor levels can create chaos/exit early

### Partial Profits (Optional)
- Consider partial at 1:1 or 1.5:1 R:R
- Trail remainder with trendline
- Reduces risk, locks in gains

## Real-Time Decision Tree

```
Price at Confluence Zone (≥3 confirmations)
    │
    ├─► Calculate Model 1 Stoploss & R:R
    │       │
    │       ├─ R:R ≥ 1.5 AND script favors Model 1
    │       │       └─► ENTRY MODE 1: Enter now
    │       │
    │       └─ R:R < 1.5 OR script favors Model 2
    │               └─► WAIT for trendline break
    │                       │
    │                       ├─ Trendline breaks
    │                       │       └─► ENTRY MODE 2: Enter on break
    │                       │
    │                       └─ Price reverses before break
    │                               └─► NO TRADE (missed opportunity)
    │
    └─► If only 2 confirmations
            └─► MUST use Model 2 (need 3rd confirmation)
```

## Post-Entry Management Checklist

```
[ ] Stoploss placed per model rules
[ ] Target identified (next major level)
[ ] Minor levels between entry/target noted
[ ] Trailing timeframe selected (15m/1H)
[ ] Trailing trendline identified (broad vs steep)
[ ] Position size calculated per risk rules
[ ] Max daily loss limit checked
```

## Code Integration Points

```typescript
interface EntrySignal {
  model: 1 | 2;
  direction: 'long' | 'short';
  entryPrice: number;
  stoploss: number;
  target: number;
  riskReward: number;
  confluenceZone: ConfluenceZone;
  trailingConfig: {
    timeframe: '15m' | '1h';
    trendline: TrendlineValidation;
    useSteep: boolean;
  };
}

function generateEntrySignal(
  zone: ConfluenceZone,
  currentPrice: number,
  scriptConfig: ScriptBacktestConfig
): EntrySignal | null {
  
  // Calculate Model 1 stoploss
  const model1SL = calculateModel1Stoploss(zone, zone.direction);
  const model1RR = Math.abs(zone.target - currentPrice) / Math.abs(currentPrice - model1SL);
  
  // Determine model
  let model: 1 | 2;
  if (zone.totalConfirmations >= 3 && model1RR >= 1.5 && scriptConfig.prefersModel1) {
    model = 1;
  } else {
    model = 2;
  }
  
  // Calculate stoploss per model
  let stoploss: number;
  if (model === 1) {
    stoploss = model1SL;
  } else {
    // Model 2: prefer Method B (swing high/low + trendline)
    stoploss = calculateModel2Stoploss(zone, zone.direction);
  }
  
  // Target = next major level
  const target = findNextMajorLevel(zone.price, zone.direction);
  
  // Trailing config
  const trailingTF = scriptConfig.intraday ? '15m' : '1h';
  const trailingTL = selectTrailingTrendline(zone, trailingTF);
  
  return {
    model,
    direction: zone.direction,
    entryPrice: currentPrice,
    stoploss,
    target,
    riskReward: Math.abs(target - currentPrice) / Math.abs(currentPrice - stoploss),
    confluenceZone: zone,
    trailingConfig: {
      timeframe: trailingTF,
      trendline: trailingTL,
      useSteep: false // default to broader
    }
  };
}

function calculateModel1Stoploss(zone: ConfluenceZone, direction: 'long' | 'short'): number {
  // Next retracement level + trendline buffer
  const nextRetracement = findNextRetracement(zone.price, direction);
  const trendlineBuffer = getTrendlineBuffer(zone, direction);
  
  return direction === 'long' 
    ? nextRetracement - trendlineBuffer
    : nextRetracement + trendlineBuffer;
}

function calculateModel2Stoploss(zone: ConfluenceZone, direction: 'long' | 'short'): number {
  // Method B: Swing point + broader trendline
  const swingPoint = findLatestSwingPoint(zone.price, direction);
  const broaderTL = getBroaderTrendline(zone, direction);
  
  return direction === 'long'
    ? Math.min(swingPoint.price, broaderTL.priceAtCurrentTime) - (zone.price * 0.001)
    : Math.max(swingPoint.price, broaderTL.priceAtCurrentTime) + (zone.price * 0.001);
}

function selectTrailingTrendline(zone: ConfluenceZone, timeframe: '15m' | '1h'): TrendlineValidation {
  // Prefer broader trendline unless deep in profits
  const candidates = zone.confluenceZone.confirmations.trendline 
    ? [zone.confluenceZone.confirmations.trendline]
    : [];
  
  // Add broader timeframe trendlines
  // ... logic to fetch from higher TF
  
  // Sort by: touchpoints desc, steepness asc (shallower first)
  candidates.sort((a, b) => {
    if (b.touchpoints !== a.touchpoints) return b.touchpoints - a.touchpoints;
    return a.steepness - b.steepness; // shallow first
  });
  
  return candidates[0];
}

// Trailing stop update (called on each candle close)
function updateTrailingStop(
  position: Position,
  candle: Candle,
  trendline: TrendlineValidation
): { newStoploss: number; exited: boolean } {
  const tlValue = trendline.getValueAt(candle.timestamp);
  
  if (position.direction === 'long') {
    if (candle.close < tlValue) {
      return { newStoploss: tlValue, exited: true }; // Trail hit
    }
    return { newStoploss: Math.max(position.stoploss, tlValue), exited: false };
  } else {
    if (candle.close > tlValue) {
      return { newStoploss: tlValue, exited: true };
    }
    return { newStoploss: Math.min(position.stoploss, tlValue), exited: false };
  }
}
```

## Backtesting Requirements (Mandatory)

> "You cannot skip the back testing button on your trading journey. You will just have to do it."

### Minimum Requirements
- **100+ trades** per script per model
- Test both Model 1 and Model 2
- Record: win rate, avg R, max DD, profit factor
- Choose model with better risk-adjusted returns

### Script-Specific Behavior
- Some scripts need "rogue" Model 1 action
- Others give room for Model 2 patience
- **No universal best** - must test per instrument

## Common Pitfalls
1. Not backtesting both models per script
2. Using Model 1 when R:R < 1.5
3. Forcing Model 2 when Model 1 is validated
4. Ignoring minor levels between entry/target
5. Trailing with too-steep trendline too early
6. Not updating trailing trendline on structure change
7. Moving stoploss to breakeven too early (chops winners)