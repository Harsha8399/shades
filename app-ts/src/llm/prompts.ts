/**
 * LLM Analysis Prompts
 * 
 * Reusable, structured prompts for different types of trading analysis.
 * Each prompt is designed to extract actionable insights from trading data.
 */
import { AnalysisType, AnalysisContext } from './types';

/**
 * System prompt that sets the LLM's role and constraints
 */
const SYSTEM_PROMPT = `You are an expert quantitative trading analyst reviewing a paper trading system's performance.

RULES:
- Be specific and data-driven. Reference actual numbers from the metrics provided.
- Focus on actionable insights, not generic advice.
- Identify overfitting risks when metrics look "too good."
- Always consider transaction costs and slippage in your analysis.
- You are an ANALYST, not a decision-maker. Present findings and let the trader decide.
- Format your response using the exact section headers specified.
- Do NOT recommend auto-trading or removing human oversight.
- All monetary values are in INR (Indian Rupees).
- This is a paper trading system focused on Indian markets (NSE/BSE).`;


/**
 * Build the analysis prompt based on type and context
 */
export function buildAnalysisPrompt(type: AnalysisType, context: AnalysisContext, customPrompt?: string): { system: string; user: string } {
  const promptBuilder = PROMPT_BUILDERS[type];
  if (!promptBuilder) {
    throw new Error(`Unknown analysis type: ${type}`);
  }

  const user = customPrompt
    ? `${promptBuilder(context)}\n\nADDITIONAL FOCUS:\n${customPrompt}`
    : promptBuilder(context);

  return { system: SYSTEM_PROMPT, user };
}


/**
 * Format stats block for embedding in prompts
 */
function formatStats(stats: AnalysisContext['stats']): string {
  if (!stats) return 'No performance data available.';
  
  return `PERFORMANCE METRICS:
- Total Trades: ${stats.totalTrades}
- Win Rate: ${(stats.winRate * 100).toFixed(1)}%
- Profit Factor: ${stats.profitFactor === Infinity ? '∞ (no losses)' : stats.profitFactor.toFixed(2)}
- Avg R-Multiple: ${stats.avgRMultiple.toFixed(2)}R
- Max Drawdown: ${(stats.maxDrawdown * 100).toFixed(1)}%
- Total P&L: ₹${stats.totalPnl.toFixed(0)}
- Average Win: ₹${stats.avgWin.toFixed(0)}
- Average Loss: ₹${stats.avgLoss.toFixed(0)}
- Best Trade: ₹${stats.bestTrade.toFixed(0)}
- Worst Trade: ₹${stats.worstTrade.toFixed(0)}${
  stats.longestWinStreak !== undefined ? `\n- Longest Win Streak: ${stats.longestWinStreak}` : ''}${
  stats.longestLossStreak !== undefined ? `\n- Longest Loss Streak: ${stats.longestLossStreak}` : ''}`;
}


/**
 * Format pattern stats for embedding in prompts
 */
function formatPatternStats(patternStats: AnalysisContext['patternStats']): string {
  if (!patternStats || Object.keys(patternStats).length === 0) {
    return 'No per-pattern data available.';
  }

  const lines = ['PATTERN BREAKDOWN:'];
  for (const [name, stats] of Object.entries(patternStats)) {
    lines.push(`  ${name}:`);
    lines.push(`    Trades: ${stats.trades} | Win Rate: ${(stats.winRate * 100).toFixed(1)}% | PF: ${stats.profitFactor.toFixed(2)} | Avg R: ${stats.avgRMultiple.toFixed(2)} | P&L: ₹${stats.totalPnl.toFixed(0)}`);
  }
  return lines.join('\n');
}


/**
 * Format recent trades for embedding in prompts
 */
function formatRecentTrades(trades: AnalysisContext['recentTrades']): string {
  if (!trades || trades.length === 0) return 'No recent trades available.';

  const lines = ['RECENT TRADES:'];
  for (const t of trades.slice(0, 20)) {
    const pnlStr = t.pnl != null ? `₹${t.pnl.toFixed(0)}` : 'N/A';
    const rStr = t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : 'N/A';
    lines.push(`  ${t.symbol} ${t.direction} (${t.patternName}) → ${t.state} | P&L: ${pnlStr} | R: ${rStr} | Confluence: [${t.confluenceFactors.join(', ')}]`);
  }
  return lines.join('\n');
}


/**
 * Format daily P&L for embedding in prompts
 */
function formatDailyPnl(dailyPnl: AnalysisContext['dailyPnl']): string {
  if (!dailyPnl || Object.keys(dailyPnl).length === 0) return '';

  const entries = Object.entries(dailyPnl).sort(([a], [b]) => a.localeCompare(b));
  const lines = ['DAILY P&L (last 30 days):'];
  for (const [date, data] of entries.slice(-30)) {
    lines.push(`  ${date}: ₹${data.pnl.toFixed(0)} (${data.trades} trades)`);
  }
  return lines.join('\n');
}


/**
 * Prompt builders for each analysis type
 */
const PROMPT_BUILDERS: Record<AnalysisType, (ctx: AnalysisContext) => string> = {
  
  /**
   * Overall performance review
   */
  performance_review: (ctx) => `Analyze the overall performance of this paper trading system.

${formatStats(ctx.stats)}

${formatPatternStats(ctx.patternStats)}

${formatDailyPnl(ctx.dailyPnl)}

Respond with EXACTLY these sections:

## Summary
A 2-3 sentence overview of the system's performance health.

## Strengths
Bullet points of what the system is doing well (reference specific metrics).

## Weaknesses  
Bullet points of concerning metrics or patterns (reference specific numbers).

## Recommendations
Concrete, actionable steps to improve performance. Be specific — suggest parameter ranges, pattern toggles, or risk adjustments.

## Risk Warnings
Any overfitting signals, survivorship bias concerns, or risk management gaps.`,


  /**
   * Pattern-specific analysis
   */
  pattern_analysis: (ctx) => `Analyze the effectiveness of each trading pattern in this system.

${formatStats(ctx.stats)}

${formatPatternStats(ctx.patternStats)}

${formatRecentTrades(ctx.recentTrades)}

For EACH pattern, evaluate:
1. Is the win rate statistically significant given the sample size?
2. Is the profit factor sustainable or likely inflated by outliers?
3. Are there signs of curve-fitting?

Respond with EXACTLY these sections:

## Summary
Which patterns are genuinely profitable vs. which are noise.

## Strengths
Patterns showing robust edge with sufficient sample size.

## Weaknesses
Patterns that are underperforming, have too few trades for significance, or show red flags.

## Recommendations
- Which patterns to keep, disable, or modify
- Specific parameter adjustments per pattern
- Minimum trade count before trusting a pattern's metrics

## Risk Warnings
Statistical significance concerns, sample size issues, or regime-dependency risks.`,


  /**
   * Risk and drawdown analysis
   */
  risk_assessment: (ctx) => `Perform a risk assessment of this paper trading system.

${formatStats(ctx.stats)}

${formatDailyPnl(ctx.dailyPnl)}

${ctx.config ? `CONFIGURATION:
- Risk per trade: ${(ctx.config.riskPerTrade * 100).toFixed(1)}%
- Max open trades: ${ctx.config.maxOpenTrades}
- Min risk/reward: ${ctx.config.minRiskReward}
- Enabled patterns: ${ctx.config.enabledPatterns.join(', ')}
- Active filters: ${ctx.config.activeFilters.join(', ')}` : ''}

Focus on:
1. Is the max drawdown acceptable for the capital size?
2. Are there correlated losses (multiple losses on same day)?
3. Is position sizing appropriate?
4. How many consecutive losses can the system survive?

Respond with EXACTLY these sections:

## Summary
Overall risk health of the system in 2-3 sentences.

## Strengths
Risk management aspects that are working well.

## Weaknesses
Risk exposures, worst-case scenarios, and vulnerability analysis.

## Recommendations
Specific risk parameter adjustments. Include exact numbers where possible (e.g., "Reduce risk per trade from 2% to 1.5%").

## Risk Warnings
Critical risks that could lead to significant capital loss. Include a survival analysis estimate.`,


  /**
   * Strategy improvement suggestions
   */
  strategy_suggestion: (ctx) => `Based on the performance data, suggest concrete strategy improvements.

${formatStats(ctx.stats)}

${formatPatternStats(ctx.patternStats)}

${formatRecentTrades(ctx.recentTrades)}

${ctx.config ? `CURRENT CONFIG:
- Risk per trade: ${(ctx.config.riskPerTrade * 100).toFixed(1)}%
- Max open trades: ${ctx.config.maxOpenTrades}
- Min R:R: ${ctx.config.minRiskReward}
- Active filters: ${ctx.config.activeFilters.join(', ')}` : ''}

Constraints:
- The system uses pattern-based entries (confluence zones, Fibonacci pullbacks, S/R retests, trendline breaks)
- Multi-timeframe alignment and market structure filters are available
- Partial profit taking at 1R/2R/3R is implemented
- Indian market (NSE) with equity + F&O

Respond with EXACTLY these sections:

## Summary
Key areas where the strategy can be improved.

## Strengths
What's working and should NOT be changed.

## Weaknesses
Specific strategy gaps or suboptimal configurations.

## Recommendations
Concrete strategy modifications. For each suggestion:
- What to change
- Why (based on the data)
- Expected impact
- How to validate (e.g., "backtest on 6 months of data")

## Risk Warnings
Potential downsides of the suggested changes. Include cautions about over-optimization.`,


  /**
   * Individual trade review
   */
  trade_review: (ctx) => `Review these individual trades and identify patterns in winning vs. losing trades.

${formatRecentTrades(ctx.recentTrades)}

${formatStats(ctx.stats)}

Analyze:
1. What do winning trades have in common?
2. What do losing trades have in common?
3. Are there common confluence factors in winners vs. losers?
4. Are stop-outs mostly from bad entries or normal market noise?

Respond with EXACTLY these sections:

## Summary
Key findings from the trade-by-trade review.

## Strengths
Common characteristics of winning trades.

## Weaknesses
Common characteristics of losing trades and what could be filtered out.

## Recommendations
Specific entry/exit improvements based on the trade patterns observed.

## Risk Warnings
Any concerning patterns (e.g., all wins from one symbol, losses clustering on specific days).`,


  /**
   * Market context analysis
   */
  market_context: (ctx) => `Analyze the system's performance across different market conditions.

${formatStats(ctx.stats)}

${formatDailyPnl(ctx.dailyPnl)}

${formatPatternStats(ctx.patternStats)}

${formatRecentTrades(ctx.recentTrades)}

Evaluate:
1. Does performance vary significantly across different periods?
2. Are there signs the strategy only works in specific regimes (trending/ranging)?
3. How does the strategy handle volatile vs. calm markets?
4. Are there specific days of the week with notably different performance?

Respond with EXACTLY these sections:

## Summary
How market conditions affect this system's performance.

## Strengths
Market conditions where the system excels.

## Weaknesses
Market conditions where the system struggles.

## Recommendations
How to adapt the system to different market regimes. Include specific filter suggestions.

## Risk Warnings
Regime-dependency risks and how to build robustness.`,
};


export { SYSTEM_PROMPT };
