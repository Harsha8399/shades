# Support & Resistance Levels - Technical Reference for Real-Time Pattern Recognition

## Overview
Levels (Support & Resistance) are based on the belief that a level respected in the past will again be respected by price in the future. They switch roles as price moves.

## Drawing Rules (Strict)

### Rule 1: Touchpoint Validation
- **Minimum**: 1 touchpoint (but more = more accurate)
- **Quality**: Greater touchpoints = higher probability of respect
- **Warning**: Too many levels too close = insignificant for trading

### Rule 2: Role Reversal
- Support becomes Resistance when broken (and vice versa)
- As price moves, S/R flip roles based on price positioning
- This is a core principle - track role changes in real-time

### Rule 3: Drawing Method
- **Tool**: Rectangle tool with "extend right" option
- **Anchor Points**: End of wicks OR end of candle bodies
- **Consistency**: Pick one method (wicks or bodies) and stick to it

### Rule 4: Spacing Discipline
- Don't draw levels too close together
- Clustered levels = noise, not signal
- Filter for significance: only levels that create meaningful zones

## Level Types

### Horizontal Levels
- Single price line with multiple touchpoints
- Most reliable when tested 3+ times
- Role reversal is clean and predictable

### Zone-Based Levels (Rectangle)
- Price range rather than single line
- Better for volatile instruments
- Captures "area of interest" vs exact price

## Multi-Timeframe Application

| Timeframe | Purpose |
|-----------|---------|
| **Weekly** | Major structural levels, log scale |
| **Daily** | Key S/R for swing trading |
| **4H** | International instruments |
| **1H** | Daily updates, intraday reference |
| **15min** | Short-term levels, trade management |

## Real-Time Recognition Checklist

```
[ ] Level drawn with rectangle tool (extend right)
[ ] Minimum 1 touchpoint (3+ preferred for high confidence)
[ ] Wick-based OR body-based (consistent method)
[ ] Role identified: current support or resistance
[ ] Role reversal tracked: was support, now resistance (or vice versa)
[ ] Not clustered with other levels (< 0.5% separation)
[ ] Higher timeframe level alignment confirmed
```

## Confluence Integration (Critical)

Levels gain exponential power when combined with:
1. **Level + Trendline + Fibonacci** = Highest confluence (3 confirmations)
2. **Level + Trendlines** = Strong confluence (2 confirmations)
3. **Level + Fibonacci** = Moderate confluence

**Rule**: Minimum 3 confirmations for high-probability entries

## Code Integration Points

```typescript
interface LevelValidation {
  price: number;
  type: 'support' | 'resistance';
  touchpoints: number;
  method: 'wick' | 'body';
  roleHistory: Array<{ timestamp: Date; role: 'support' | 'resistance' }>;
  confluence: {
    trendline: boolean;
    fibonacci: boolean;
    fibLevel?: number; // 23.6, 38.2, 50, 61.8, 78.6
  };
  timeframe: 'weekly' | 'daily' | '4h' | '1h' | '15m';
  zone: { top: number; bottom: number }; // for rectangle zones
  significance: 'major' | 'minor' | 'noise';
}

interface LevelCluster {
  levels: LevelValidation[];
  centerPrice: number;
  strength: number; // combined touchpoints * timeframe weight
}
```

## Real-Time Detection Logic

```typescript
function detectLevelConfluence(currentPrice: number, levels: LevelValidation[]): LevelValidation[] {
  return levels.filter(level => {
    const distance = Math.abs(currentPrice - level.price) / currentPrice;
    return distance < 0.005; // within 0.5%
  }).sort((a, b) => b.strength - a.strength);
}

function checkRoleReversal(level: LevelValidation, currentPrice: number): boolean {
  if (level.type === 'support' && currentPrice < level.price) return true; // broken support
  if (level.type === 'resistance' && currentPrice > level.price) return true; // broken resistance
  return false;
}
```

## Common Pitfalls
1. Drawing too many levels (noise)
2. Inconsistent anchor method (wicks vs bodies)
3. Ignoring role reversal tracking
4. Not filtering clustered levels
5. Using single timeframe only
6. Treating all levels equally (major vs minor)