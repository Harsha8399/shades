# Fibonacci Retracement - Technical Reference for Real-Time Pattern Recognition

## Overview
Fibonacci retracement levels identify potential reversal zones during pullbacks. They work best when combined with levels (S/R) or trendlines - never in isolation.

## Key Levels (Priority Order)

| Level | Significance | Typical Use Case |
|-------|--------------|------------------|
| **23.6%** | Shallow retracement | Strong trends, quick pullbacks |
| **38.2%** | Moderate retracement | Healthy pullbacks in strong trends |
| **50%** | Psychological midpoint | Most watched, often respects |
| **61.8%** | Golden ratio | Deep pullbacks, trend exhaustion zone |
| **78.6%** | Deep retracement | Very weak trends, crude oil bullish momentum |

## Instrument-Specific Behavior

### Crude Oil (Bullish Momentum)
- Maximum retracements often to **78.6%**
- Requires backtesting per instrument

### General Rules
- **Strong downtrends** → weak relief rallies → smaller retracements (23.6-38.2%)
- **Bullish moves** → slower price moves → deeper retracements (50-78.6%)
- **Always use in direction of broader trend**, not short-term trend

## Drawing Rules

### Anchor Points
- **Swing High to Swing Low** (for downtrend retracements)
- **Swing Low to Swing High** (for uptrend retracements)
- Must use confirmed swing points (see Pullback Identification)

### Validation
- Fib level must align with:
  - Support/Resistance level
  - Trendline
  - Previous swing high/low
- Standalone Fib = low probability

## Confluence Rules (Critical)

### Minimum 3 Confirmations Required
1. **Level + Trendline + Fibonacci** = Highest probability
2. **Level + Trendlines** = Strong
3. **Level + Fibonacci** = Moderate

### Entry Zone Definition
High liquidity zone = area where ≥3 confirmations overlap
- This is where volume concentrates
- Entry models trigger here

## Pullback Identification (Prerequisite for Fib Drawing)

### Swing Point Rules
1. After forming a high, price moving down → **no swing low until price breaks recent high**
2. Price breaks previous high → swing low confirmed
3. Area between previous high and swing low = **pullback**
4. Healthy trend = repeated pullbacks forming clear waves

### Complex Pullbacks
- Price structure breaks down (confusing highs/lows)
- Point 'd' may look like lower low but is technically higher low
- Structure 'abcd' = complex pullback
- **Wait for clarity** - don't force Fib on messy structure

## Multi-Timeframe Application

| Timeframe | Fib Purpose |
|-----------|-------------|
| **Weekly/Daily** | Major swing points, broad retracement zones |
| **4H/1H** | Trade entry refinement, pullback zones |
| **15min** | Intraday entry precision |

## Real-Time Recognition Checklist

```
[ ] Broader trend identified (weekly/daily)
[ ] Valid swing high/low confirmed (price broke prior extreme)
[ ] Fib drawn from swing extreme to swing extreme
[ ] Key levels (23.6, 38.2, 50, 61.8, 78.6) marked
[ ] Confluence check: Level + Trendline + Fib at same zone?
[ ] Minimum 3 confirmations at target zone?
[ ] Entry model selected (Model 1 vs Model 2)
```

## Entry Models (At Fib Confluence Zone)

### Entry Model 1: Direct Entry
- Enter **as soon as price reaches** high liquidity zone
- Stoploss: slightly above next retracement + trendline distance
- **Riskier**, more aggressive
- Use when: script demands immediate action, stoploss acceptable

### Entry Model 2: Confirmation Entry
- Wait for **immediate trendline break** at liquidity zone
- Enter on trendline break (no candle close wait needed)
- Stoploss: above next Fib level + broader trendline
- **Safer**, more conservative
- Use when: Model 1 stoploss too wide, or only 2 confirmations (need 3rd = trendline break)

### When Forced to Model 2
1. Model 1 stoploss → poor risk:reward
2. Only 2 confirmations (level + fib, no trendline) → need trendline break as 3rd

## Code Integration Points

```typescript
interface FibonacciLevel {
  level: 0.236 | 0.382 | 0.5 | 0.618 | 0.786;
  price: number;
  confluence: {
    supportResistance: boolean;
    trendline: boolean;
    swingPoint: boolean;
  };
  strength: number; // 0-3 based on confirmations
}

interface FibRetracement {
  swingHigh: { price: number; timestamp: Date; index: number };
  swingLow: { price: number; timestamp: Date; index: number };
  direction: 'bullish' | 'bearish';
  levels: FibonacciLevel[];
  confluenceZone: {
    price: number;
    confirmations: number;
    entryModel: 1 | 2;
  } | null;
}

function calculateFibLevels(swingHigh: number, swingLow: number, direction: 'bullish' | 'bearish'): FibonacciLevel[] {
  const diff = swingHigh - swingLow;
  const levels = [0.236, 0.382, 0.5, 0.618, 0.786];
  
  return levels.map(level => {
    const price = direction === 'bullish' 
      ? swingHigh - (diff * level)  // retracement down from high
      : swingLow + (diff * level);  // retracement up from low
    
    return { level, price, confluence: { supportResistance: false, trendline: false, swingPoint: false }, strength: 0 };
  });
}

function detectFibConfluence(currentPrice: number, fibs: FibRetracement[], levels: LevelValidation[], trendlines: TrendlineValidation[]): FibonacciLevel[] {
  const confluent = [];
  
  for (const fib of fibs) {
    for (const level of fib.levels) {
      let confirmations = 0;
      
      // Check S/R confluence
      const srMatch = levels.find(l => Math.abs(l.price - level.price) / l.price < 0.003);
      if (srMatch) { confirmations++; level.confluence.supportResistance = true; }
      
      // Check trendline confluence
      const tlMatch = trendlines.find(tl => Math.abs(tl.priceAtCurrentTime - level.price) / level.price < 0.003);
      if (tlMatch) { confirmations++; level.confluence.trendline = true; }
      
      // Check swing point confluence
      if (Math.abs(fib.swingHigh.price - level.price) / level.price < 0.003 ||
          Math.abs(fib.swingLow.price - level.price) / level.price < 0.003) {
        confirmations++; level.confluence.swingPoint = true;
      }
      
      level.strength = confirmations;
      if (confirmations >= 2) confluent.push(level);
    }
  }
  
  return confluent.sort((a, b) => b.strength - a.strength);
}
```

## Real-Time Detection Logic

```typescript
function identifyEntryZone(fibs: FibRetracement[], currentPrice: number): { zone: FibonacciLevel; model: 1 | 2 } | null {
  const confluent = detectFibConfluence(currentPrice, fibs, levels, trendlines);
  
  if (confluent.length === 0) return null;
  
  const bestZone = confluent[0];
  
  // Determine entry model
  const model1Stoploss = calculateModel1Stoploss(bestZone);
  const riskReward = calculateRiskReward(currentPrice, bestZone.price, model1Stoploss);
  
  const model = (riskReward < 1.5 || bestZone.strength < 3) ? 2 : 1;
  
  return { zone: bestZone, model };
}
```

## Common Pitfalls
1. Drawing Fib on unconfirmed swing points
2. Using short-term trend instead of broader trend
3. Trading standalone Fib without confluence
4. Ignoring instrument-specific behavior (crude = 78.6%)
5. Forcing Model 1 when Model 2 is appropriate
6. Not backtesting per instrument (minimum 100 trades)