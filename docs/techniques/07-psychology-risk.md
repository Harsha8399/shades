# Trading Psychology & Risk Management - Technical Reference for Real-Time Pattern Recognition

## Overview
Psychological discipline and risk management are the foundation that makes technical analysis profitable. Without them, even the best setups fail.

## Core Psychological Principles

### 1. Missed Opportunities > Compromised Rules
> "In trading, making peace with missed opportunities is worth much more than compromising on the rules that make you who you are as a trader."

- **FOMO is the enemy**: If stoploss too big → detach from FOMO, let trade slide
- **Not end of world**: Missing a trade ≠ losing money
- **Data integrity**: Compromising rules = no valid performance data
- **Long-term**: Missing few trades << finding yourself lost

### 2. Rule Adherence
- One compromise leads to another
- Shallow trading process = no conclusions about what works
- **Document every rule** before trading
- **Never compromise** on: entry criteria, stoploss, position sizing, max daily loss

### 3. Risk Exposure First
- What matters most: Risk exposure & entry point that makes complete sense
- If opportunity has too-big stoploss → let it go
- **Risk defines the trade**, not potential reward

## Risk Management Rules

### Position Sizing
- **Fixed fractional**: Risk fixed % of equity per trade (e.g., 1-2%)
- **Never risk more** than predefined % on any single trade
- Adjust position size to keep stoploss distance = risk amount

### Stoploss Discipline
- **Hard stoploss always** - no mental stops
- Stoploss placed at technical invalidation point
- Never widen stoploss after entry
- Trail only in profit direction (never against)

### Daily/Weekly Limits
- **Max daily loss**: e.g., 3-5% of equity → stop trading for day
- **Max weekly loss**: e.g., 10% → reduce size or stop
- **Max drawdown**: e.g., 20% → full stop, review strategy

### Risk:Reward Minimum
- **Minimum 1.5:1** (prefer 2:1+)
- Calculate before entry: `R:R = |Target - Entry| / |Entry - Stoploss|`
- If R:R < 1.5 → no trade (or use Model 2)

## Real-Time Risk Checklist

```
[ ] Position size calculated: Risk $ = Equity × Risk%
[ ] Stoploss distance = Risk $ / Position Size
[ ] R:R ≥ 1.5 confirmed before entry
[ ] Daily loss limit not exceeded
[ ] Weekly loss limit not exceeded
[ ] Max drawdown not breached
[ ] No open trades exceeding max concurrent (e.g., 5)
[ ] Correlation check: not all same sector/direction
```

## Psychological State Monitoring

### Pre-Trade Checklist
```
[ ] Calm, not emotional (no revenge trading after loss)
[ ] Setup matches documented rules exactly
[ ] No FOMO (trade not "running away")
[ ] Accepting loss if stoploss hit
[ ] Position size feels comfortable (not sweating)
```

### During Trade
```
[ ] Not watching every tick (set alerts)
[ ] Not moving stoploss against position
[ ] Trailing per rules only
[ ] Not adding to losers (averaging down)
[ ] Not taking partial profits too early (unless planned)
```

### Post-Trade Review
```
[ ] Logged: entry, exit, stoploss, target, R:R, result
[ ] Noted: emotional state, rule adherence
[ ] Tagged: pattern type, timeframe, market condition
[ ] Weekly: review journal for patterns
```

## Code Integration Points

```typescript
interface RiskParameters {
  maxRiskPerTrade: number;        // 0.01 = 1%
  maxDailyLoss: number;           // 0.03 = 3%
  maxWeeklyLoss: number;          // 0.10 = 10%
  maxDrawdown: number;            // 0.20 = 20%
  minRiskReward: number;          // 1.5
  maxConcurrentTrades: number;    // 5
  maxCorrelatedTrades: number;    // 3
}

interface TradeRiskCheck {
  allowed: boolean;
  reason?: string;
  positionSize: number;
  riskAmount: number;
  riskReward: number;
  dailyLossPct: number;
  weeklyLossPct: number;
  currentDrawdown: number;
}

function validateTradeRisk(
  signal: EntrySignal,
  account: AccountState,
  riskParams: RiskParameters,
  openTrades: Position[]
): TradeRiskCheck {
  
  const riskAmount = account.equity * riskParams.maxRiskPerTrade;
  const stopDistance = Math.abs(signal.entryPrice - signal.stoploss);
  const positionSize = riskAmount / stopDistance;
  
  const riskReward = signal.riskReward;
  
  // Daily loss check
  const dailyPnL = openTrades.filter(t => isToday(t.entryTime))
    .reduce((sum, t) => sum + (t.unrealizedPnl || 0), 0);
  const dailyLossPct = Math.abs(dailyPnL) / account.equity;
  
  // Weekly loss check
  const weeklyPnL = openTrades.filter(t => isThisWeek(t.entryTime))
    .reduce((sum, t) => sum + (t.unrealizedPnl || 0), 0);
  const weeklyLossPct = Math.abs(weeklyPnL) / account.equity;
  
  // Drawdown check
  const peakEquity = account.peakEquity;
  const currentDrawdown = (peakEquity - account.equity) / peakEquity;
  
  // Concurrent trades
  const concurrentCount = openTrades.filter(t => t.state === 'OPEN').length;
  
  // Correlation check (simplified)
  const sameDirectionCount = openTrades.filter(t => 
    t.direction === signal.direction && t.state === 'OPEN'
  ).length;
  
  // Validation
  if (riskReward < riskParams.minRiskReward) {
    return { allowed: false, reason: `R:R ${riskReward.toFixed(2)} < ${riskParams.minRiskReward}`, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
  }
  
  if (dailyLossPct >= riskParams.maxDailyLoss) {
    return { allowed: false, reason: `Daily loss limit ${(riskParams.maxDailyLoss*100).toFixed(1)}% reached`, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
  }
  
  if (weeklyLossPct >= riskParams.maxWeeklyLoss) {
    return { allowed: false, reason: `Weekly loss limit ${(riskParams.maxWeeklyLoss*100).toFixed(1)}% reached`, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
  }
  
  if (currentDrawdown >= riskParams.maxDrawdown) {
    return { allowed: false, reason: `Max drawdown ${(riskParams.maxDrawdown*100).toFixed(1)}% breached`, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
  }
  
  if (concurrentCount >= riskParams.maxConcurrentTrades) {
    return { allowed: false, reason: `Max concurrent trades (${riskParams.maxConcurrentTrades}) reached`, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
  }
  
  if (sameDirectionCount >= riskParams.maxCorrelatedTrades) {
    return { allowed: false, reason: `Max correlated trades (${riskParams.maxCorrelatedTrades}) reached`, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
  }
  
  return { allowed: true, positionSize, riskAmount, riskReward, dailyLossPct, weeklyLossPct, currentDrawdown };
}

interface AccountState {
  equity: number;
  peakEquity: number;
  dailyPnL: number;
  weeklyPnL: number;
}

interface PsychologicalState {
  emotionalState: 'calm' | 'anxious' | 'euphoric' | 'frustrated' | 'revenge';
  lastTradeResult: 'win' | 'loss' | 'breakeven' | null;
  consecutiveLosses: number;
  consecutiveWins: number;
  fomoLevel: number; // 0-10
  confidenceLevel: number; // 0-10
}

function assessPsychologicalState(state: PsychologicalState): { tradeAllowed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let tradeAllowed = true;
  
  if (state.emotionalState === 'revenge') {
    tradeAllowed = false;
    warnings.push('REVENGE TRADING DETECTED - STOP TRADING');
  }
  
  if (state.emotionalState === 'frustrated' && state.consecutiveLosses >= 3) {
    tradeAllowed = false;
    warnings.push('3+ consecutive losses + frustration - take break');
  }
  
  if (state.fomoLevel > 7) {
    warnings.push('High FOMO - verify setup not forced');
  }
  
  if (state.confidenceLevel < 4) {
    warnings.push('Low confidence - reduce position size or skip');
  }
  
  if (state.consecutiveWins >= 5 && state.emotionalState === 'euphoric') {
    warnings.push('Euphoria after win streak - avoid overconfidence');
  }
  
  return { tradeAllowed, warnings };
}
```

## Journaling Structure (For Pattern Recognition)

```typescript
interface TradeJournalEntry {
  // Trade details
  id: string;
  timestamp: Date;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stoploss: number;
  target: number;
  positionSize: number;
  riskAmount: number;
  riskReward: number;
  
  // Pattern context
  pattern: {
    type: 'confluence' | 'trendline_break' | 'fib_retracement' | 'level_retest';
    timeframe: '15m' | '1h' | '4h' | 'daily';
    confirmations: number;
    entryModel: 1 | 2;
  };
  
  // Market context
  marketContext: {
    trend: 'bullish' | 'bearish' | 'sideways';
    volatility: 'low' | 'normal' | 'high';
    session: 'pre-market' | 'open' | 'mid' | 'close' | 'after-hours';
  };
  
  // Outcome
  exitPrice: number;
  exitReason: 'target' | 'stoploss' | 'trail' | 'manual' | 'time';
  pnl: number;
  rMultiple: number;
  
  // Psychology
  psychology: {
    preTradeState: PsychologicalState;
    duringTradeNotes: string;
    postTradeReflection: string;
    ruleAdherence: boolean;
    mistakes: string[];
  };
  
  // Tags for analysis
  tags: string[];
}
```

## Real-Time Alerts

```typescript
class RiskMonitor {
  private riskParams: RiskParameters;
  private account: AccountState;
  private onAlert: (alert: RiskAlert) => void;
  
  checkPreTrade(signal: EntrySignal, openTrades: Position[]): RiskAlert[] {
    const alerts: RiskAlert[] = [];
    const check = validateTradeRisk(signal, this.account, this.riskParams, openTrades);
    
    if (!check.allowed) {
      alerts.push({ level: 'BLOCK', message: check.reason! });
    }
    
    if (check.riskReward < 2.0) {
      alerts.push({ level: 'WARN', message: `R:R ${check.riskReward.toFixed(2)} below 2.0` });
    }
    
    if (check.dailyLossPct > this.riskParams.maxDailyLoss * 0.7) {
      alerts.push({ level: 'WARN', message: `Daily loss at ${(check.dailyLossPct*100).toFixed(1)}% of limit` });
    }
    
    return alerts;
  }
  
  checkDuringTrade(position: Position, currentPrice: number): RiskAlert[] {
    const alerts: RiskAlert[] = [];
    
    // Stoploss distance check
    const slDistance = Math.abs(currentPrice - position.stoploss) / position.entryPrice;
    if (slDistance > 0.05) { // > 5% from entry
      alerts.push({ level: 'WARN', message: `Stoploss ${(slDistance*100).toFixed(1)}% from entry - consider reducing size` });
    }
    
    // Unrealized loss approaching daily limit
    const unrealizedPnl = position.unrealizedPnl || 0;
    if (unrealizedPnl < 0 && Math.abs(unrealizedPnl) > this.account.equity * this.riskParams.maxDailyLoss * 0.5) {
      alerts.push({ level: 'WARN', message: `Single trade loss approaching daily limit` });
    }
    
    return alerts;
  }
}

interface RiskAlert {
  level: 'INFO' | 'WARN' | 'BLOCK';
  message: string;
  timestamp: Date;
}
```

## Common Pitfalls
1. **No written rules** = no discipline possible
2. **Mental stops** = guaranteed blowup
3. **Revenge trading** after loss = account killer
3. **Averaging down** losers = compounding mistakes
4. **Moving stoploss** against position = hope > strategy
5. **Position size too large** = emotional decisions
6. **No daily/weekly limits** = death by thousand cuts
7. **Not journaling** = no learning, repeating mistakes
8. **Ignoring correlation** = concentrated risk