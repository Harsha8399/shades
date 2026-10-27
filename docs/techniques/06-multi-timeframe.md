# Multi-Timeframe Analysis - Technical Reference for Real-Time Pattern Recognition

## Overview
Multi-timeframe analysis (MTF) is essential for aligning trades with broader market structure. Each timeframe serves a specific purpose in the analysis hierarchy.

## Timeframe Hierarchy

### Swing Trading

| Timeframe | Purpose | Key Actions |
|-----------|---------|-------------|
| **Weekly** (Log Scale) | Broader outlook, major trendlines | Mark crucial trendlines, log scale for long-term perspective |
| **Daily** | Primary analysis, key S/R & trendlines | Begin marking recent important support, resistance, trendlines |
| **4 Hour** | International instruments (gold, silver, crude, forex) | Similar to 1H but for 24h markets |
| **1 Hour** | Daily updates, missed levels, trade management | Update levels daily, mark missed trendlines, manage trades |

### Intraday Trading

| Timeframe | Purpose | Key Actions |
|-----------|---------|-------------|
| **Hourly** | Primary analysis, key S/R & trendlines | Begin marking recent important support, resistance, trendlines |
| **15-min** | Updates, short-term trendlines, trade management | Update levels, mark short-term trendlines, manage trades |

## Trend Analysis by Timeframe

### Identifying Trend Direction
- **Uptrend**: Price moves from bottom-left to top-right
- **Downtrend**: Price moves from top-left to bottom-right
- **Timeframe Selection**:
  - Intraday: 1 Hour suitable
  - Swing: Daily or 4 Hour (international)

### Trend Continuation Signals
- Price pulls back to previous highs after forming higher highs
- Look for opportunities in trend direction
- Healthy pullbacks = repeated clear waves

### Trend Reversal Confirmation (Two-Step)
1. **Trendline Break**: Price breaks ongoing trendline (immediate trend)
2. **Structure Break**: Consolidation → sellers force breakdown below recent swing low = trend changed

### Sideways/Range Detection
- Price moving between ranges = confusing for directional traders
- **Wait for major level breaks** for directional entries
- No reversal or immediate momentum indicated

### Choppy Price Behavior
- Despite trend, price creates chaos at retests
- **Best to sit out** - don't fight price
- Wait for solid multiple-confirmation retest

## Pullback Identification (Critical for MTF)

### Valid Pullback Rules
1. After high, price moves down → **no swing low until price breaks recent high**
2. Price breaks previous high → swing low confirmed
3. Area between previous high & swing low = **pullback**
4. Repeated pullbacks = healthy price waves

### Complex Pullback
- Structure breaks down (confusing highs/lows)
- Point 'd' looks like lower low but is technically higher low
- Structure 'abcd' = complex pullback
- **Wait for clarity** - don't force trades

### Counter-Trend Moves
- Moves against broader trend
- Create chaos especially at retests
- **Sit back, wait for solid retest with multiple confirmations**

## MTF Alignment Rules

### Higher Timeframe Dominance
- Weekly trend > Daily trend > 4H trend > 1H trend > 15m trend
- **Never trade against weekly/daily trend** on lower timeframes
- Lower timeframe entries must align with higher timeframe direction

### Confluence Across Timeframes
- Level on Daily + Trendline on 4H + Fib on 1H = Maximum confluence
- Each timeframe adds confirmation weight
- Minimum: 2 timeframes aligned for entry

### Timeframe Weights for Scoring
```typescript
const TIMEFRAME_WEIGHTS = {
  'weekly': 10,
  'daily': 8,
  '4h': 6,
  '1h': 4,
  '15m': 2
};
```

## Real-Time MTF Checklist

```
[ ] Weekly trend identified (log scale)
[ ] Daily trend aligned with weekly
[ ] 4H/1H structure supports daily
[ ] Key levels marked on each timeframe
[ ] Trendlines drawn on each timeframe
[ ] Fibonacci drawn on relevant swing (daily/4H)
[ ] Current price position relative to all TF levels known
[ ] Entry timeframe selected (15m for intraday, 1H for swing)
[ ] Higher TF trend = entry direction?
```

## Code Integration Points

```typescript
interface TimeframeAnalysis {
  timeframe: 'weekly' | 'daily' | '4h' | '1h' | '15m';
  trend: 'bullish' | 'bearish' | 'sideways' | 'choppy';
  structure: {
    higherHighs: boolean;
    higherLows: boolean;
    lowerHighs: boolean;
    lowerLows: boolean;
  };
  keyLevels: LevelValidation[];
  trendlines: TrendlineValidation[];
  fibonacci: FibRetracement | null;
  lastSwingHigh: SwingPoint | null;
  lastSwingLow: SwingPoint | null;
  weight: number;
}

interface MTFAnalysis {
  timeframes: Map<string, TimeframeAnalysis>;
  dominantTrend: 'bullish' | 'bearish' | 'sideways';
  alignmentScore: number; // 0-100
  entryTimeframe: '15m' | '1h';
  conflicts: string[]; // e.g., "Daily bullish but 1H bearish"
}

function analyzeMTF(candlesByTF: Map<string, Candle[]>): MTFAnalysis {
  const timeframes = new Map<string, TimeframeAnalysis>();
  const order = ['weekly', 'daily', '4h', '1h', '15m'];
  
  for (const tf of order) {
    const candles = candlesByTF.get(tf);
    if (!candles || candles.length < 50) continue;
    
    const analysis = analyzeSingleTimeframe(tf, candles);
    timeframes.set(tf, analysis);
  }
  
  // Calculate alignment
  let bullishWeight = 0;
  let bearishWeight = 0;
  let totalWeight = 0;
  
  for (const [tf, analysis] of timeframes) {
    const weight = TIMEFRAME_WEIGHTS[tf as keyof typeof TIMEFRAME_WEIGHTS] || 1;
    totalWeight += weight;
    
    if (analysis.trend === 'bullish') bullishWeight += weight;
    else if (analysis.trend === 'bearish') bearishWeight += weight;
  }
  
  let dominantTrend: 'bullish' | 'bearish' | 'sideways';
  if (bullishWeight > bearishWeight * 1.5) dominantTrend = 'bullish';
  else if (bearishWeight > bullishWeight * 1.5) dominantTrend = 'bearish';
  else dominantTrend = 'sideways';
  
  // Check conflicts
  const conflicts: string[] = [];
  const daily = timeframes.get('daily');
  const hourly = timeframes.get('1h');
  if (daily && hourly && daily.trend !== hourly.trend && daily.trend !== 'sideways' && hourly.trend !== 'sideways') {
    conflicts.push(`Daily ${daily.trend} but 1H ${hourly.trend}`);
  }
  
  return {
    timeframes,
    dominantTrend,
    alignmentScore: Math.max(bullishWeight, bearishWeight) / totalWeight * 100,
    entryTimeframe: dominantTrend === 'sideways' ? '15m' : '1h',
    conflicts
  };
}

function analyzeSingleTimeframe(tf: string, candles: Candle[]): TimeframeAnalysis {
  // Identify trend
  const recent = candles.slice(-50);
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  const mid = recent[Math.floor(recent.length / 2)].close;
  
  let trend: 'bullish' | 'bearish' | 'sideways' | 'choppy';
  const pctChange = (last - first) / first;
  
  if (pctChange > 0.02) trend = 'bullish';
  else if (pctChange < -0.02) trend = 'bearish';
  else trend = 'sideways';
  
  // Check for choppiness
  const volatility = calculateVolatility(recent);
  if (volatility > 0.03 && Math.abs(pctChange) < 0.01) trend = 'choppy';
  
  // Structure analysis
  const swings = identifySwingPoints(recent);
  const higherHighs = swings.highs.length >= 2 && swings.highs[swings.highs.length - 1].price > swings.highs[swings.highs.length - 2].price;
  const higherLows = swings.lows.length >= 2 && swings.lows[swings.lows.length - 1].price > swings.lows[swings.lows.length - 2].price;
  const lowerHighs = swings.highs.length >= 2 && swings.highs[swings.highs.length - 1].price < swings.highs[swings.highs.length - 2].price;
  const lowerLows = swings.lows.length >= 2 && swings.lows[swings.lows.length - 1].price < swings.lows[swings.lows.length - 2].price;
  
  // Extract levels, trendlines, fibs (would use existing detection)
  const keyLevels = detectLevels(recent);
  const trendlines = detectTrendlines(recent);
  const fibonacci = detectFibonacci(recent, swings);
  
  return {
    timeframe: tf as any,
    trend,
    structure: { higherHighs, higherLows, lowerHighs, lowerLows },
    keyLevels,
    trendlines,
    fibonacci,
    lastSwingHigh: swings.highs[swings.highs.length - 1] || null,
    lastSwingLow: swings.lows[swings.lows.length - 1] || null,
    weight: TIMEFRAME_WEIGHTS[tf as keyof typeof TIMEFRAME_WEIGHTS] || 1
  };
}

function isSignalAlignedWithMTF(signal: EntrySignal, mtf: MTFAnalysis): boolean {
  // Signal direction must match dominant trend
  if (mtf.dominantTrend === 'bullish' && signal.direction !== 'long') return false;
  if (mtf.dominantTrend === 'bearish' && signal.direction !== 'short') return false;
  if (mtf.dominantTrend === 'sideways') return false; // No directional trades in sideways
  
  // Check for major conflicts
  if (mtf.conflicts.length > 0) return false;
  
  // Alignment score threshold
  if (mtf.alignmentScore < 60) return false;
  
  return true;
}
```

## Real-Time Monitoring

```typescript
class MTFMonitor {
  private mtf: MTFAnalysis | null = null;
  private lastUpdate: Map<string, number> = new Map();
  
  update(candlesByTF: Map<string, Candle[]>): void {
    const now = Date.now();
    
    // Update each timeframe on its natural cycle
    for (const [tf, candles] of candlesByTF) {
      const interval = this.getUpdateInterval(tf);
      if (now - (this.lastUpdate.get(tf) || 0) >= interval) {
        this.mtf = analyzeMTF(candlesByTF);
        this.lastUpdate.set(tf, now);
      }
    }
  }
  
  private getUpdateInterval(tf: string): number {
    const intervals = {
      'weekly': 24 * 60 * 60 * 1000,    // Daily
      'daily': 4 * 60 * 60 * 1000,      // 4 hours
      '4h': 60 * 60 * 1000,             // 1 hour
      '1h': 15 * 60 * 1000,             // 15 minutes
      '15m': 5 * 60 * 1000              // 5 minutes
    };
    return intervals[tf as keyof typeof intervals] || 60 * 60 * 1000;
  }
  
  getAlignment(): { aligned: boolean; score: number; conflicts: string[] } {
    if (!this.mtf) return { aligned: false, score: 0, conflicts: ['No MTF data'] };
    
    return {
      aligned: this.mtf.dominantTrend !== 'sideways' && this.mtf.conflicts.length === 0 && this.mtf.alignmentScore >= 60,
      score: this.mtf.alignmentScore,
      conflicts: this.mtf.conflicts
    };
  }
}
```

## Common Pitfalls
1. Trading against higher timeframe trend
2. Using single timeframe for decisions
3. Not updating higher TF levels daily
4. Ignoring conflicts between timeframes
5. Forcing trades in sideways/choppy higher TF
6. Using wrong timeframe for trading style (15m for swing, daily for intraday)
7. Not checking alignment before entry