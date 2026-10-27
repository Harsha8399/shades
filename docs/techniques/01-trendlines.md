# Trendlines - Technical Reference for Real-Time Pattern Recognition

## Overview
Trendlines are the foundation of trend definition - identifying trend continuation or trend change. They must be drawn with intent and precision.

## Drawing Rules (Strict)

### Rule 1: Wick Priority
- **Primary**: Draw trendlines using candle wicks for maximum structure & precision
- **Fallback**: Use candle body only if wick is missing
- **Rationale**: Wicks represent price rejection zones, more reliable than bodies

### Rule 2: Touchpoint Validation
- **Minimum**: 2 touchpoints required to draw a valid trendline
- **Quality**: More touchpoints = more accurate trendline
- **Warning**: If hitting too often, trendline is weakening - be cautious

### Rule 3: Origin Point
- Must originate from where the trend **begins**
- Random mid-trend points = inaccurate results & subpar reliability
- Bullish chart: originates from support → ends at resistance
- Bearish chart: originates from resistance → ends at support

### Rule 4: Purpose-Driven Drawing
- Draw with intent: continuation OR change detection
- Not every trendline will be correct
- Different trendlines for different purposes:
  - Long-term trends: broader, shallower
  - Short-term/stop trailing: steeper, more responsive
  - Subjectivity is a feature, not a bug

## Trend Classification

### Bullish Chart
- Price falling in recent past = bearish trend
- Originates from support, ends at resistance
- Higher highs + higher lows = uptrend continuation

### Bearish Chart
- Price rising in recent past = bullish trend
- Originates from resistance, ends at support
- Lower highs + lower lows = downtrend continuation

## Multi-Timeframe Application

| Timeframe | Purpose |
|-----------|---------|
| **Weekly** (log scale) | Crucial trendlines, broader outlook |
| **Daily** | Recently important S/R & trendlines |
| **4H** | International instruments (gold, silver, crude, forex) |
| **1H** | Daily level updates, missed levels, trade management |
| **15min** | Intraday short-term trendlines, trade management |

## Real-Time Recognition Checklist

```
[ ] Trendline drawn from trend origin (not mid-point)
[ ] Minimum 2 touchpoints (wicks preferred)
[ ] Touchpoints validated on current timeframe
[ ] Purpose identified: continuation vs reversal vs trailing
[ ] Steepness assessed: too steep = higher break probability
[ ] Higher timeframe alignment checked
```

## Code Integration Points

```typescript
// Trendline validation for real-time detection
interface TrendlineValidation {
  origin: 'trend_start' | 'mid_trend' | 'unknown';
  touchpoints: number;
  wickBased: boolean;
  purpose: 'continuation' | 'reversal' | 'trailing_stop';
  steepness: 'shallow' | 'moderate' | 'steep';
  timeframeAlignment: boolean;
}
```

## Common Pitfalls
1. Drawing from random mid-trend points
2. Using body-only when wicks available
3. Ignoring touchpoint count (< 2)
4. Not defining purpose before drawing
5. Over-relying on steep trendlines for trailing stops
6. Drawing too many trendlines creating noise