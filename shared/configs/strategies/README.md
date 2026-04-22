# Strategy Builder Guide

This guide explains how to create strategy JSON files for the Shades Trading Platform.

## Quick Start

Give this prompt to any LLM (like ChatGPT, Claude) along with your strategy description:

```
Using the Shades Trading Platform strategy format, create a JSON strategy file for the following strategy:

[YOUR STRATEGY DESCRIPTION HERE]

Use this format:
- entry.long: Array of conditions for buy signals
- entry.short: Array of conditions for sell signals  
- exit.stopLoss: How to set stop-loss
- exit.target: How to set take-profit
- filters: Optional trend/volume filters
- config: Timeframes and instruments

Available indicators: sma, ema, rsi, macd, macd_signal, macd_histogram, 
bb_upper, bb_middle, bb_lower, stoch_k, stoch_d, adx, atr, volume, volume_avg

Available operators: above, below, crosses_above, crosses_below, equals

Stop-loss types: atr (multiplier), percent, swing, structure
Target types: rr (risk:reward), atr, percent, structure

Output only valid JSON, no explanations.
```

---

## Full Field Reference

### Basic Info

```json
{
  "name": "Strategy Name",
  "description": "What does this strategy do",
  "version": "1.0.0",
  "author": "Your Name"
}
```

### Entry Conditions

Each condition is an object with:

| Field | Required | Description |
|-------|----------|-------------|
| `indicator` | Yes | The indicator to check |
| `params` | No | Parameters for the indicator |
| `operator` | Yes | How to compare |
| `value` | Yes | What to compare against (number or indicator) |
| `valueParams` | No | Parameters if value is an indicator |

**Example - EMA Crossover:**
```json
{
  "indicator": "ema",
  "params": { "period": 20 },
  "operator": "crosses_above",
  "value": "ema",
  "valueParams": { "period": 50 }
}
```

**Example - RSI Oversold:**
```json
{
  "indicator": "rsi",
  "params": { "period": 14 },
  "operator": "crosses_above",
  "value": 30
}
```

### Available Indicators

| Indicator | Params | Description |
|-----------|--------|-------------|
| `close`, `price` | - | Current close price |
| `open`, `high`, `low` | - | OHLC prices |
| `sma` | `period` | Simple Moving Average |
| `ema` | `period` | Exponential Moving Average |
| `rsi` | `period` (default 14) | Relative Strength Index (0-100) |
| `macd` | `fast`, `slow`, `signal` | MACD line |
| `macd_signal` | `fast`, `slow`, `signal` | MACD signal line |
| `macd_histogram` | `fast`, `slow`, `signal` | MACD histogram |
| `bb_upper` | `period`, `stdDev` | Bollinger Band Upper |
| `bb_middle` | `period`, `stdDev` | Bollinger Band Middle |
| `bb_lower` | `period`, `stdDev` | Bollinger Band Lower |
| `stoch_k` | `period`, `d`, `smooth` | Stochastic %K |
| `stoch_d` | `period`, `d`, `smooth` | Stochastic %D |
| `adx` | `period` | Average Directional Index |
| `atr` | `period` | Average True Range |
| `volume` | - | Current volume |
| `volume_avg` | `period` | Average volume |

### Available Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `above` | Greater than | Price above EMA |
| `below` | Less than | RSI below 30 |
| `crosses_above` | Crosses from below to above | EMA20 crosses above EMA50 |
| `crosses_below` | Crosses from above to below | Price crosses below support |
| `equals` | Approximately equal | - |

### Exit Configuration

**Stop-Loss Types:**

| Type | Value Meaning | Example |
|------|---------------|---------|
| `atr` | ATR multiplier | `2.0` = 2x ATR below entry |
| `percent` | Percentage | `2.0` = 2% below entry |
| `swing` | Use recent swing | `1` = below recent swing low |
| `structure` | Use S/R level | `1` = below nearest support |

**Target Types:**

| Type | Value Meaning | Example |
|------|---------------|---------|
| `rr` | Risk:Reward ratio | `2.0` = 2:1 R:R (target = 2x risk) |
| `atr` | ATR multiplier | `3.0` = 3x ATR from entry |
| `percent` | Percentage | `5.0` = 5% above entry |
| `structure` | Use S/R level | `1` = nearest resistance |

**Trailing Stop:**
```json
{
  "type": "step",
  "activationR": 1.0,
  "value": 0.5
}
```
- `activationR`: Activate after X R profit (1.0 = 1R)
- `value`: Trail in steps of X R (0.5 = 0.5R)

### Filters (Optional)

**Trend Filter:**
```json
{
  "indicator": "ema",
  "period": 200,
  "condition": "above",
  "threshold": null
}
```
- Only take LONG if price above EMA200
- Only take SHORT if price below EMA200

**Volume Filter:**
```json
{
  "minRatio": 1.2,
  "period": 20
}
```
- Require volume to be 1.2x the 20-period average

**Time Filter:**
```json
{
  "allowedHours": { "start": 9, "end": 15 },
  "allowedDays": [1, 2, 3, 4, 5]
}
```
- Only trade 9 AM to 3 PM
- Only trade Monday to Friday (1-5)

### Config

```json
{
  "timeframes": ["15m", "1h", "4h"],
  "instruments": ["RELIANCE", "TCS", "INFY"],
  "minConfidence": 0.7
}
```

**Valid Timeframes:** `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w`

**Popular NSE Stocks:**
RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK, HINDUNILVR, SBIN, BHARTIARTL, 
KOTAKBANK, ITC, LT, AXISBANK, MARUTI, TITAN, BAJFINANCE, TATAMOTORS, 
WIPRO, SUNPHARMA, NESTLEIND, TECHM

---

## Complete Examples

### Example 1: EMA Crossover

```json
{
  "name": "EMA Crossover",
  "description": "Buy when 20 EMA crosses above 50 EMA",
  "version": "1.0.0",
  "entry": {
    "long": [
      {
        "indicator": "ema",
        "params": { "period": 20 },
        "operator": "crosses_above",
        "value": "ema",
        "valueParams": { "period": 50 }
      },
      {
        "indicator": "close",
        "operator": "above",
        "value": "ema",
        "valueParams": { "period": 200 }
      }
    ],
    "short": [
      {
        "indicator": "ema",
        "params": { "period": 20 },
        "operator": "crosses_below",
        "value": "ema",
        "valueParams": { "period": 50 }
      }
    ]
  },
  "exit": {
    "stopLoss": { "type": "atr", "value": 2 },
    "target": { "type": "rr", "value": 2 }
  },
  "config": {
    "timeframes": ["1h", "4h"],
    "instruments": ["RELIANCE", "TCS"],
    "minConfidence": 0.7
  }
}
```

### Example 2: RSI Oversold Bounce

```json
{
  "name": "RSI Oversold Bounce",
  "description": "Buy when RSI crosses above 30",
  "version": "1.0.0",
  "entry": {
    "long": [
      {
        "indicator": "rsi",
        "params": { "period": 14 },
        "operator": "crosses_above",
        "value": 30
      }
    ]
  },
  "exit": {
    "stopLoss": { "type": "swing", "value": 1 },
    "target": { "type": "structure", "value": 1 }
  },
  "filters": {
    "trendFilter": {
      "indicator": "ema",
      "period": 200,
      "condition": "above"
    }
  },
  "config": {
    "timeframes": ["1h"],
    "instruments": ["SBIN", "AXISBANK"],
    "minConfidence": 0.65
  }
}
```

### Example 3: MACD Crossover with Volume

```json
{
  "name": "MACD Volume Breakout",
  "description": "MACD bullish crossover with volume confirmation",
  "version": "1.0.0",
  "entry": {
    "long": [
      {
        "indicator": "macd",
        "params": { "fast": 12, "slow": 26, "signal": 9 },
        "operator": "crosses_above",
        "value": "macd_signal"
      },
      {
        "indicator": "volume",
        "operator": "above",
        "value": "volume_avg",
        "valueParams": { "period": 20 }
      }
    ]
  },
  "exit": {
    "stopLoss": { "type": "atr", "value": 1.5 },
    "target": { "type": "rr", "value": 2.5 }
  },
  "config": {
    "timeframes": ["15m", "1h"],
    "instruments": ["TATAMOTORS", "MARUTI"],
    "minConfidence": 0.7
  }
}
```

---

## How to Use

1. **Create JSON file:** Save your strategy in `shared/configs/strategies/my-strategy.json`

2. **Load in TypeScript:**
```typescript
import { buildStrategy, loadStrategyFromFile } from './patterns/StrategyBuilder';

const definition = loadStrategyFromFile('shared/configs/strategies/my-strategy.json');
const pattern = buildStrategy(definition);

// Register for use
PatternRegistry.getInstance().register(pattern);
```

3. **Run backtest:**
```bash
npx ts-node src/cli/commands.ts simulate -f data/nse/reliance_15m.csv -s RELIANCE -t 15m
```

---

## Tips

1. **Start simple:** Begin with 1-2 conditions, add more after testing
2. **Use filters:** Trend filter (EMA200) significantly improves win rate
3. **Conservative stops:** ATR-based stops adapt to volatility
4. **Test on multiple stocks:** A good strategy works across instruments
5. **Match timeframe to style:** Day trading = 5m/15m, Swing = 1h/4h/1d

