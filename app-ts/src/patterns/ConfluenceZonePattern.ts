import { Candle, MarketContext, Signal, Direction, ValidationResult, PatternConfig } from '../types';
import { BasePattern } from './BasePattern';
import {
  findSRZones,
  findFibRetracement,
  findTrendlines,
  isPriceAtZone,
  isPriceAtFibLevel,
  isPriceAtTrendline,
  findRecentSwingHigh,
  findRecentSwingLow,
  findNearestSupport,
  findNearestResistance,
  calculateATR,
  SRZone,
  FibLevel,
  FibRetracement,
  Trendline,
} from '../indicators';
import { isBullish, isBearish, getUpperWick, getLowerWick, getCandleBody } from '../types/candle';
import { ConditionEvaluation, DecisionStage, DecisionTrace, PredictionSnapshot } from '../types/decision';

/**
 * Confluence Zone pattern configuration
 */
export interface ConfluenceZoneConfig extends PatternConfig {
  parameters: {
    // Component toggles
    useSupportResistance: boolean;    // Enable S/R zone as confluence factor
    useFibonacci: boolean;            // Enable Fibonacci as confluence factor
    useTrendline: boolean;            // Enable Trendline as confluence factor
    useRejectionCandle: boolean;      // Enable Entry Model 2 rejection candle gate
    useMinimumConfluence: boolean;    // Enable minimum confluence factor count gate
    useMinimumRiskReward: boolean;    // Enable minimum R:R threshold gate
    
    // Thresholds
    minConfluenceFactors: number;     // Minimum factors required (default: 2)
    srZoneLookback: number;           // Bars to look for S/R (default: 100)
    fibLevels: number[];              // Fib levels to check (default: [0.5, 0.618, 0.786])
    zoneToleranceATR: number;         // Zone width in ATR (default: 0.5)
    minRejectionWickRatio: number;    // Wick:body ratio for rejection (default: 2.0)
    targetRR: number;                 // Target risk:reward ratio
  };
}

/**
 * Confluence result from analysis
 */
interface ConfluenceResult {
  hasConfluence: boolean;
  factors: string[];
  direction: Direction | null;
  directionSource: string | null;
  zoneLevel: number;
  zoneBreakPrice: number;
  srZone: SRZone | null;
  fibLevel: FibLevel | null;
  fibRetracement: FibRetracement | null;
  trendline: Trendline | null;
  srZonesFound: number;
  trendlinesFound: number;
  nearestZoneDistanceATR: number | null;
  nearestFibDistanceATR: number | null;
  nearestTrendlineDistanceATR: number | null;
}

/**
 * Spec-configurable tolerance constants.
 *
 * These MUST match the like-named values in shared/fixtures/strategy_spec.json
 * (TRENDLINE_TOLERANCE_ATR, SR_ZONE_TOLERANCE_ATR, SR_MIN_TOUCHES,
 * MIN_TARGET_RR). The spec-drift guard test (mtf-spec-drift.test.ts) pins
 * them, so a change to either side without the other is caught.
 */
export const TRENDLINE_TOLERANCE_ATR = 0.3;
export const SR_ZONE_TOLERANCE_ATR = 0.5;
export const SR_MIN_TOUCHES = 2;
export const MIN_TARGET_RR = 1.5;

/**
 * Confluence Zone + Entry Model 2 Pattern
 * 
 * Detects high-probability entry points where multiple technical factors align:
 * 1. Support/Resistance Zone - Historical price level with multiple touches
 * 2. Fibonacci Level - 50%, 61.8%, or 78.6% retracement
 * 3. Trendline - Dynamic support/resistance
 * 4. Entry Model 2 - Rejection candle at confluence (wick into zone, close outside)
 */
export class ConfluenceZonePattern extends BasePattern {
  readonly id = 'confluence-zone-em2';
  readonly name = 'Confluence Zone + Entry Model 2';
  readonly description = 'Detects rejection candles at zones where S/R, Fib, and trendline align';
  readonly version = '1.0.0';
  
  declare config: ConfluenceZoneConfig;
  
  constructor(config?: Partial<ConfluenceZoneConfig>) {
    super();
    
    // Merge parameters explicitly to avoid spread-order bugs
    const defaultParameters: ConfluenceZoneConfig['parameters'] = {
      useSupportResistance: true,
      useFibonacci: true,
      useTrendline: true,
      useRejectionCandle: true,
      useMinimumConfluence: true,
      useMinimumRiskReward: true,
      minConfluenceFactors: 2,
      srZoneLookback: 100,
      fibLevels: [0.5, 0.618, 0.786],
      zoneToleranceATR: SR_ZONE_TOLERANCE_ATR,
      minRejectionWickRatio: 2.0,
      targetRR: 2,
    };
    
    const mergedParameters = {
      ...defaultParameters,
      ...config?.parameters,
    };
    
    this.config = {
      enabled: config?.enabled ?? true,
      timeframes: config?.timeframes ?? ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      symbols: config?.symbols ?? [],
      parameters: mergedParameters,
    };
  }
  
  /**
   * Detect confluence zone signal.
   * Every evaluation records an immutable decision trace (this.lastTrace) and,
   * when a signal is produced, an evidence snapshot (this.lastSnapshot).
   */
  detectSignal(candles: Candle[], context: MarketContext, absoluteCandleIndex?: number): Signal | null {
    const { parameters } = this.config;
    const currentCandle = candles[candles.length - 1];
    const tolerance = context.atr * parameters.zoneToleranceATR;
    
    const stages: DecisionStage[] = [];
    const conditions: ConditionEvaluation[] = [];
    
    const pushStage = (stage: DecisionStage) => stages.push(stage);
    const pushCondition = (condition: ConditionEvaluation) => conditions.push(condition);
    
    // Stage 0: market context (always evaluated)
    const contextValues: Record<string, number | string | boolean | null> = {
      atr: Number.isFinite(context.atr) ? context.atr : null,
      trend: context.trend ?? null,
      volatility: context.volatility ?? null,
      toleranceATR: parameters.zoneToleranceATR,
      candlesAvailable: candles.length,
    };
    pushStage({
      id: 'market_context',
      label: 'Market data validated & indicators calculated',
      result: Number.isFinite(context.atr) && context.atr > 0 ? 'PASS' : 'FAIL',
      detail: Number.isFinite(context.atr) && context.atr > 0
        ? `ATR=${context.atr.toFixed(4)}, tolerance=${tolerance.toFixed(4)}`
        : 'ATR unavailable or zero',
      values: contextValues,
    });
    pushCondition({
      id: 'market_context',
      label: 'Market data valid (ATR available)',
      evaluated: true,
      passed: Number.isFinite(context.atr) && context.atr > 0,
      values: contextValues,
    });
    
    const atrUnavailable = !Number.isFinite(context.atr) || context.atr <= 0;
    
    if (atrUnavailable) {
      // All subsequent stages are skipped
      pushStage({ id: 'sr_zone', label: 'S/R zone proximity', result: 'SKIPPED', detail: 'ATR unavailable' });
      pushStage({ id: 'fib_level', label: 'Fibonacci level proximity', result: 'SKIPPED', detail: 'ATR unavailable' });
      pushStage({ id: 'trendline', label: 'Trendline proximity', result: 'SKIPPED', detail: 'ATR unavailable' });
      pushStage({ id: 'min_confluence', label: 'Minimum confluence requirement', result: 'SKIPPED', detail: 'ATR unavailable' });
      pushStage({ id: 'rejection_candle', label: 'Rejection candle (Entry Model 2)', result: 'SKIPPED', detail: 'ATR unavailable' });
      pushStage({ id: 'risk_reward', label: 'Risk/reward requirement', result: 'SKIPPED', detail: 'ATR unavailable' });
      
      this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
      return null;
    }
    
    // Stage 1: find all confluence factors
    const confluenceResult = this.findConfluence(candles, context, tolerance);
    
    // S/R stage
    if (parameters.useSupportResistance) {
      const srValues: Record<string, number | string | boolean | null> = {
        zonesFound: confluenceResult.srZonesFound,
        atZone: confluenceResult.srZone !== null,
        zoneType: confluenceResult.srZone?.type ?? null,
        zoneLevel: confluenceResult.srZone?.priceLevel ?? null,
        zoneTouches: confluenceResult.srZone?.strength ?? null,
        nearestDistanceATR: confluenceResult.nearestZoneDistanceATR,
        tolerance,
      };
      pushStage({
        id: 'sr_zone',
        label: 'S/R zone proximity',
        result: confluenceResult.srZone ? 'PASS' : 'FAIL',
        detail: confluenceResult.srZone
          ? `${confluenceResult.srZone.type} @ ${confluenceResult.srZone.priceLevel.toFixed(2)} (${confluenceResult.srZone.strength} touches)`
          : confluenceResult.nearestZoneDistanceATR !== null
            ? `Nearest zone ${confluenceResult.nearestZoneDistanceATR.toFixed(2)} ATR away (tolerance ${parameters.zoneToleranceATR})`
            : 'No qualifying S/R zones found',
        values: srValues,
      });
      pushCondition({
        id: 'sr_zone',
        label: 'Price at S/R zone',
        evaluated: true,
        passed: confluenceResult.srZone ? true : false,
        values: srValues,
      });
    } else {
      // S/R disabled - mark as SKIPPED
      pushStage({
        id: 'sr_zone',
        label: 'S/R zone proximity',
        result: 'SKIPPED',
        detail: 'Disabled by replay configuration',
        values: { zonesFound: 0, atZone: false, zoneType: null, zoneLevel: null, zoneTouches: null, nearestDistanceATR: null, tolerance },
      });
      pushCondition({
        id: 'sr_zone',
        label: 'Price at S/R zone',
        evaluated: false,
        passed: null,
        detail: 'Disabled by replay configuration',
      });
    }
    
    // Fib stage
    if (parameters.useFibonacci) {
      const fibValues: Record<string, number | string | boolean | null> = {
        retracementFound: confluenceResult.fibRetracement !== null,
        atFib: confluenceResult.fibLevel !== null,
        ratio: confluenceResult.fibLevel?.ratio ?? null,
        levelPrice: confluenceResult.fibLevel?.price ?? null,
        retracementDirection: confluenceResult.fibRetracement?.direction ?? null,
        nearestDistanceATR: confluenceResult.nearestFibDistanceATR,
        tolerance,
      };
      pushStage({
        id: 'fib_level',
        label: 'Fibonacci level proximity',
        result: confluenceResult.fibLevel ? 'PASS' : (confluenceResult.fibRetracement ? 'FAIL' : 'UNAVAILABLE'),
        detail: confluenceResult.fibLevel
          ? `${confluenceResult.fibLevel.label} @ ${confluenceResult.fibLevel.price.toFixed(2)} (${confluenceResult.fibRetracement?.direction} retracement)`
          : confluenceResult.fibRetracement
            ? `Nearest fib level ${confluenceResult.nearestFibDistanceATR?.toFixed(2)} ATR away`
            : 'No qualifying retracement found in last 50 candles',
        values: fibValues,
      });
      pushCondition({
        id: 'fib_level',
        label: 'Price at Fibonacci level',
        evaluated: confluenceResult.fibRetracement !== null,
        passed: confluenceResult.fibLevel ? true : (confluenceResult.fibRetracement ? false : null),
        values: fibValues,
      });
    } else {
      // Fibonacci disabled - mark as SKIPPED
      pushStage({
        id: 'fib_level',
        label: 'Fibonacci level proximity',
        result: 'SKIPPED',
        detail: 'Disabled by replay configuration',
        values: { retracementFound: false, atFib: false, ratio: null, levelPrice: null, retracementDirection: null, nearestDistanceATR: null, tolerance },
      });
      pushCondition({
        id: 'fib_level',
        label: 'Price at Fibonacci level',
        evaluated: false,
        passed: null,
        detail: 'Disabled by replay configuration',
      });
    }
    
    // Trendline stage
    if (parameters.useTrendline) {
      const tlValues: Record<string, number | string | boolean | null> = {
        trendlinesFound: confluenceResult.trendlinesFound,
        atTrendline: confluenceResult.trendline !== null,
        trendlineType: confluenceResult.trendline?.type ?? null,
        trendlinePrice: confluenceResult.trendline
          ? confluenceResult.trendline.intercept + confluenceResult.trendline.slope * (candles.length - 1)
          : null,
        nearestDistanceATR: confluenceResult.nearestTrendlineDistanceATR,
        tolerance,
      };
      pushStage({
        id: 'trendline',
        label: 'Trendline proximity',
        result: confluenceResult.trendline ? 'PASS' : (confluenceResult.trendlinesFound > 0 ? 'FAIL' : 'UNAVAILABLE'),
        detail: confluenceResult.trendline
          ? `${confluenceResult.trendline.type} trendline @ ${tlValues.trendlinePrice}`
          : confluenceResult.trendlinesFound > 0
            ? `Nearest trendline ${confluenceResult.nearestTrendlineDistanceATR?.toFixed(2)} ATR away`
            : 'No trendlines detected',
        values: tlValues,
      });
      pushCondition({
        id: 'trendline',
        label: 'Price at trendline',
        evaluated: confluenceResult.trendlinesFound > 0,
        passed: confluenceResult.trendline ? true : (confluenceResult.trendlinesFound > 0 ? false : null),
        values: tlValues,
      });
    } else {
      // Trendline disabled - mark as SKIPPED
      pushStage({
        id: 'trendline',
        label: 'Trendline proximity',
        result: 'SKIPPED',
        detail: 'Disabled by replay configuration',
        values: { trendlinesFound: 0, atTrendline: false, trendlineType: null, trendlinePrice: null, nearestDistanceATR: null, tolerance },
      });
      pushCondition({
        id: 'trendline',
        label: 'Price at trendline',
        evaluated: false,
        passed: null,
        detail: 'Disabled by replay configuration',
      });
    }
    
    // Stage 2: minimum confluence requirement (optional)
    const minConfluenceRequired = parameters.useMinimumConfluence ? parameters.minConfluenceFactors : 0;
    const hasMinConfluence = confluenceResult.factors.length >= minConfluenceRequired;
    const confluenceValues: Record<string, number | string | boolean | null> = {
      factorCount: confluenceResult.factors.length,
      required: minConfluenceRequired,
      factors: confluenceResult.factors.join(', '),
      direction: confluenceResult.direction ?? null,
      directionSource: confluenceResult.directionSource,
    };
    
    if (parameters.useMinimumConfluence) {
      pushStage({
        id: 'min_confluence',
        label: 'Minimum confluence requirement',
        result: hasMinConfluence && confluenceResult.direction ? 'PASS' : 'FAIL',
        detail: `${confluenceResult.factors.length} of ${parameters.minConfluenceFactors} required factors` +
          (confluenceResult.factors.length > 0 ? ` (${confluenceResult.factors.join(', ')})` : ''),
        values: confluenceValues,
      });
      pushCondition({
        id: 'min_confluence',
        label: `Minimum confluence factors (≥ ${parameters.minConfluenceFactors})`,
        evaluated: true,
        passed: hasMinConfluence && confluenceResult.direction ? true : false,
        values: confluenceValues,
      });
    } else {
      // Minimum confluence disabled - mark as SKIPPED
      pushStage({
        id: 'min_confluence',
        label: 'Minimum confluence requirement',
        result: 'SKIPPED',
        detail: `Disabled by replay configuration (${confluenceResult.factors.length} factors present)`,
        values: confluenceValues,
      });
      pushCondition({
        id: 'min_confluence',
        label: `Minimum confluence factors (≥ ${parameters.minConfluenceFactors})`,
        evaluated: false,
        passed: null,
        detail: 'Disabled by replay configuration',
        values: confluenceValues,
      });
    }
    
    // Check direction - always required regardless of minimum confluence setting
    if (!confluenceResult.direction) {
      pushStage({ id: 'rejection_candle', label: 'Rejection candle (Entry Model 2)', result: 'SKIPPED', detail: 'Direction not determined' });
      pushStage({ id: 'risk_reward', label: 'Risk/reward requirement', result: 'SKIPPED', detail: 'Direction not determined' });
      this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
      return null;
    }
    
    // If minimum confluence is enabled, also check the factor count
    if (parameters.useMinimumConfluence && !hasMinConfluence) {
      pushStage({ id: 'rejection_candle', label: 'Rejection candle (Entry Model 2)', result: 'SKIPPED', detail: 'Confluence requirement not met' });
      pushStage({ id: 'risk_reward', label: 'Risk/reward requirement', result: 'SKIPPED', detail: 'Confluence requirement not met' });
      this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
      return null;
    }
    
    // Stage 3: Entry Model 2 (rejection candle) - optional
    let rejection = null;
    let rejectionPassed = true;
    
    if (parameters.useRejectionCandle) {
      rejection = this.detectRejectionCandle(
        currentCandle,
        confluenceResult.direction,
        confluenceResult.zoneLevel,
        tolerance,
        context.atr
      );
      
      const rejectionValues: Record<string, number | string | boolean | null> = {
        body: rejection.measurements.body,
        upperWick: rejection.measurements.upperWick,
        lowerWick: rejection.measurements.lowerWick,
        wickRatio: rejection.measurements.wickRatio,
        minWickRatio: rejection.measurements.minWickRatio,
        wickTouchesZone: rejection.measurements.wickTouchesZone,
        closeBeyondZone: rejection.measurements.closeBeyondZone,
        candleTypeOk: rejection.measurements.candleTypeOk,
        zoneLevel: confluenceResult.zoneLevel,
        candleHigh: currentCandle.high,
        candleLow: currentCandle.low,
        candleClose: currentCandle.close,
      };
      pushStage({
        id: 'rejection_candle',
        label: 'Rejection candle (Entry Model 2)',
        result: rejection.isValid ? 'PASS' : 'FAIL',
        detail: rejection.isValid
          ? `Rejection confirmed (wick ratio ${rejection.measurements.wickRatio.toFixed(2)} ≥ ${rejection.measurements.minWickRatio})`
          : `Failed: ${rejection.failureReason}`,
        values: rejectionValues,
      });
      pushCondition({
        id: 'rejection_candle',
        label: 'Rejection candle at zone (wick into zone, close outside)',
        evaluated: true,
        passed: rejection.isValid,
        values: rejectionValues,
      });
      
      rejectionPassed = rejection.isValid;
      
      if (!rejection.isValid) {
        pushStage({ id: 'risk_reward', label: 'Risk/reward requirement', result: 'SKIPPED', detail: 'Rejection candle not confirmed' });
        this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
        return null;
      }
    } else {
      // Rejection candle disabled - mark as SKIPPED
      pushStage({
        id: 'rejection_candle',
        label: 'Rejection candle (Entry Model 2)',
        result: 'SKIPPED',
        detail: 'Disabled by replay configuration',
      });
      pushCondition({
        id: 'rejection_candle',
        label: 'Rejection candle at zone (wick into zone, close outside)',
        evaluated: false,
        passed: null,
        detail: 'Disabled by replay configuration',
      });
      rejection = this.detectRejectionCandle(
        currentCandle,
        confluenceResult.direction,
        confluenceResult.zoneLevel,
        tolerance,
        context.atr
      );
      rejectionPassed = true;
    }
    
    // Stage 4: build stop/target and validate R:R
    const direction = confluenceResult.direction;
    const entryPrice = currentCandle.close;
    const stopResult = this.calculateStopLossWithSource(entryPrice, direction, candles);
    const targetResult = this.calculateTargetWithSource(entryPrice, stopResult.price, direction, candles);
    const stopLoss = stopResult.price;
    const target = targetResult.price;
    
    const risk = Math.abs(entryPrice - stopLoss);
    
    // Guard against zero risk (stop == entry) which would cause Infinity rMultiple
    // This is a MANDATORY validity check - always enforced regardless of useMinimumRiskReward
    if (risk === 0) {
      pushStage({
        id: 'risk_reward',
        label: 'Risk/reward requirement',
        result: 'FAIL',
        detail: 'Zero risk distance (stop equals entry price)',
        values: { risk: 0, entryPrice, stopLoss },
      });
      pushCondition({
        id: 'risk_reward',
        label: 'Valid risk distance (stop ≠ entry)',
        evaluated: true,
        passed: false,
        detail: 'Zero risk distance (stop equals entry price)',
        values: { risk: 0, entryPrice, stopLoss },
      });
      this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
      return null;
    }
    
    // Validate stop/target placement (mandatory checks)
    const stopOnWrongSide = direction === 'LONG' ? stopLoss >= entryPrice : stopLoss <= entryPrice;
    const targetOnWrongSide = direction === 'LONG' ? target <= entryPrice : target >= entryPrice;
    
    if (stopOnWrongSide) {
      pushStage({
        id: 'risk_reward',
        label: 'Risk/reward requirement',
        result: 'FAIL',
        detail: `Stop-loss on wrong side of entry (${direction === 'LONG' ? '≥' : '≤'} entry)`,
        values: { entryPrice, stopLoss, direction },
      });
      pushCondition({
        id: 'risk_reward',
        label: 'Stop-loss on correct side of entry',
        evaluated: true,
        passed: false,
        detail: `Stop-loss on wrong side of entry`,
        values: { entryPrice, stopLoss, direction },
      });
      this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
      return null;
    }
    
    if (targetOnWrongSide) {
      pushStage({
        id: 'risk_reward',
        label: 'Risk/reward requirement',
        result: 'FAIL',
        detail: `Target on wrong side of entry (${direction === 'LONG' ? '≤' : '≥'} entry)`,
        values: { entryPrice, target, direction },
      });
      pushCondition({
        id: 'risk_reward',
        label: 'Target on correct side of entry',
        evaluated: true,
        passed: false,
        detail: `Target on wrong side of entry`,
        values: { entryPrice, target, direction },
      });
      this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
      return null;
    }
    
    const riskReward = Math.abs(target - entryPrice) / risk;
    
    // Risk/reward threshold check (optional via useMinimumRiskReward)
    let rrPassed = true;
    if (parameters.useMinimumRiskReward) {
      const rrPassedThreshold = riskReward >= MIN_TARGET_RR;
      rrPassed = rrPassedThreshold;
      
      const rrValues: Record<string, number | string | boolean | null> = {
        riskReward,
        minRiskReward: MIN_TARGET_RR,
        stopLoss,
        target,
        risk: Math.abs(entryPrice - stopLoss),
        reward: Math.abs(target - entryPrice),
        stopSource: stopResult.source,
        targetSource: targetResult.source,
      };
      pushStage({
        id: 'risk_reward',
        label: 'Risk/reward requirement',
        result: rrPassedThreshold ? 'PASS' : 'FAIL',
        detail: `R:R ${riskReward.toFixed(2)} vs minimum ${MIN_TARGET_RR} (SL ${stopLoss.toFixed(2)} from ${stopResult.source}, target ${target.toFixed(2)} from ${targetResult.source})`,
        values: rrValues,
      });
      pushCondition({
        id: 'risk_reward',
        label: `Risk/reward ≥ ${MIN_TARGET_RR}`,
        evaluated: true,
        passed: rrPassedThreshold,
        values: rrValues,
      });
      
      if (!rrPassedThreshold) {
        this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'NO_SIGNAL', undefined, absoluteCandleIndex);
        return null;
      }
    } else {
      // Minimum R:R disabled - mark as SKIPPED but still record the calculated R:R
      const rrValues: Record<string, number | string | boolean | null> = {
        riskReward,
        minRiskReward: MIN_TARGET_RR,
        stopLoss,
        target,
        risk: Math.abs(entryPrice - stopLoss),
        reward: Math.abs(target - entryPrice),
        stopSource: stopResult.source,
        targetSource: targetResult.source,
      };
      pushStage({
        id: 'risk_reward',
        label: 'Risk/reward requirement',
        result: 'SKIPPED',
        detail: `Disabled by replay configuration (calculated R:R: ${riskReward.toFixed(2)})`,
        values: rrValues,
      });
      pushCondition({
        id: 'risk_reward',
        label: `Risk/reward ≥ ${MIN_TARGET_RR}`,
        evaluated: false,
        passed: null,
        detail: 'Disabled by replay configuration',
        values: rrValues,
      });
    }
    
    // Final signal generated
    pushStage({
      id: 'outcome',
      label: 'Decision',
      result: 'PASS',
      detail: `${direction} signal generated`,
      values: { direction, entryPrice, stopLoss, target, riskReward },
    });
    
    const confidence = this.calculateConfidence(confluenceResult.factors.length);
    
    const signal = this.buildSignal(
      direction,
      entryPrice,
      stopLoss,
      target,
      context,
      candles,
      confluenceResult.factors,
      confidence
    );
    
    this.lastTrace = this.buildTrace(candles, context, stages, conditions, 'SIGNAL', direction, absoluteCandleIndex);
    
    // Immutable evidence snapshot (only for actual signals)
    this.lastSnapshot = {
      strategyVersion: this.version,
      candleIndex: candles.length - 1,
      warmupComplete: candles.length >= this.getRequiredCandleCount(),
      candlesAvailable: candles.length,
      marketContext: {
        atr: context.atr,
        trend: context.trend ?? null,
        volatility: context.volatility ?? null,
      },
      // Include effective component configuration for reproducibility
      componentConfig: {
        useSupportResistance: parameters.useSupportResistance,
        useFibonacci: parameters.useFibonacci,
        useTrendline: parameters.useTrendline,
        useRejectionCandle: parameters.useRejectionCandle,
        useMinimumConfluence: parameters.useMinimumConfluence,
        useMinimumRiskReward: parameters.useMinimumRiskReward,
        minConfluenceFactors: parameters.minConfluenceFactors,
        minRejectionWickRatio: parameters.minRejectionWickRatio,
        targetRR: parameters.targetRR,
      },
      zone: confluenceResult.srZone
        ? {
            type: confluenceResult.srZone.type,
            priceLevel: confluenceResult.srZone.priceLevel,
            touches: confluenceResult.srZone.strength,
            tolerance,
          }
        : null,
      fib: confluenceResult.fibLevel
        ? {
            ratio: confluenceResult.fibLevel.ratio,
            priceLevel: confluenceResult.fibLevel.price,
            direction: confluenceResult.fibRetracement?.direction ?? 'UNKNOWN',
          }
        : null,
      trendline: confluenceResult.trendline
        ? {
            type: confluenceResult.trendline.type,
            priceLevel: confluenceResult.trendline.intercept + confluenceResult.trendline.slope * (candles.length - 1),
          }
        : null,
      rejection: rejection ? {
        body: rejection.measurements.body,
        upperWick: rejection.measurements.upperWick,
        lowerWick: rejection.measurements.lowerWick,
        wickRatio: rejection.measurements.wickRatio,
        minWickRatio: rejection.measurements.minWickRatio,
        wickTouchesZone: rejection.measurements.wickTouchesZone,
        closeBeyondZone: rejection.measurements.closeBeyondZone,
        candleTypeOk: rejection.measurements.candleTypeOk,
      } : null,
      levels: {
        entryPrice,
        stopLoss,
        target,
        riskReward,
        minRiskReward: MIN_TARGET_RR,
      },
      conditions,
      passedConditions: conditions.filter(c => c.passed === true).map(c => c.id),
      failedConditions: conditions.filter(c => c.passed === false).map(c => c.id),
    };
    
    return signal;
  }
  
  /**
   * Build the immutable trace object
   */
  private buildTrace(
    candles: Candle[],
    context: MarketContext,
    stages: DecisionStage[],
    conditions: ConditionEvaluation[],
    outcome: DecisionTrace['outcome'],
    direction?: Direction,
    absoluteCandleIndex?: number
  ): DecisionTrace {
    const lastClosed = candles[candles.length - 1];
    return {
      strategyId: this.id,
      strategyVersion: this.version,
      candleIndex: absoluteCandleIndex ?? candles.length - 1,
      timestamp: lastClosed ? lastClosed.timestamp : Date.now(),
      symbol: context.symbol,
      timeframe: context.timeframe,
      outcome,
      direction,
      stages,
      conditions,
    };
  }
  
  /**
   * Find confluence at current price
   */
  private findConfluence(
    candles: Candle[],
    context: MarketContext,
    tolerance: number
  ): ConfluenceResult {
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;
    const { parameters } = this.config;
    
    const factors: string[] = [];
    let srZone: SRZone | null = null;
    let fibLevel: FibLevel | null = null;
    let fibRetracement: FibRetracement | null = null;
    let trendline: Trendline | null = null;
    let direction: Direction | null = null;
    let directionSource: string | null = null;
    let zoneLevel = currentPrice;
    let srZonesFound = 0;
    let trendlinesFound = 0;
    let nearestZoneDistanceATR: number | null = null;
    let nearestFibDistanceATR: number | null = null;
    let nearestTrendlineDistanceATR: number | null = null;
    
    // 1. Check S/R zones (if enabled)
    if (parameters.useSupportResistance) {
      const srZones = findSRZones(
        candles.slice(-parameters.srZoneLookback),
        context.atr,
        SR_ZONE_TOLERANCE_ATR,
        SR_MIN_TOUCHES
      );
      srZonesFound = srZones.length;
      
      const srResult = isPriceAtZone(currentPrice, srZones, tolerance);
      if (srZones.length > 0) {
        // Nearest zone distance in ATR units (for diagnostics, not used in decision)
        nearestZoneDistanceATR = Math.min(...srZones.map(z => Math.abs(currentPrice - z.priceLevel))) / context.atr;
      }
      if (srResult.atZone && srResult.zone) {
        srZone = srResult.zone;
        zoneLevel = srZone.priceLevel;
        factors.push(`sr_${srResult.zoneType?.toLowerCase()}`);
        
        // Determine direction from S/R type
        direction = srResult.zoneType === 'SUPPORT' ? 'LONG' : 'SHORT';
        directionSource = 'sr_zone';
      }
    } else {
      srZonesFound = 0;
      nearestZoneDistanceATR = null;
    }
    
    // 2. Check Fibonacci levels (if enabled)
    if (parameters.useFibonacci) {
      // Always compute all 5 standard Fibonacci ratios so that every level
      // (including 0.236 and 0.382) can contribute a confluence factor.
      // The fibLevels config field was dead configuration in the Python engine
      // (which never passed it to find_fib_retracement) and must be dead here
      // too so that both engines agree on which levels are eligible.
      // Passing fibLevels as a custom ratios argument narrowed the computed
      // set to 3 levels and caused TS↔Python parity divergence.
      fibRetracement = findFibRetracement(candles, 50);
      if (fibRetracement) {
        const fibResult = isPriceAtFibLevel(currentPrice, fibRetracement, tolerance);
        if (fibRetracement.levels.length > 0) {
          nearestFibDistanceATR = Math.min(...fibRetracement.levels.map(l => Math.abs(currentPrice - l.price))) / context.atr;
        }
        if (fibResult.atFib && fibResult.level) {
          fibLevel = fibResult.level;
          factors.push(`fib_${Math.round(fibResult.level.ratio * 1000)}`);
          
          // Determine direction from fib retracement direction
          if (!direction) {
            direction = fibRetracement.direction === 'UP' ? 'LONG' : 'SHORT';
            directionSource = 'fib_level';
          }
        }
      }
    } else {
      nearestFibDistanceATR = null;
    }
    
    // 3. Check trendlines (if enabled)
    if (parameters.useTrendline) {
      const trendlines = findTrendlines(candles, context.atr, TRENDLINE_TOLERANCE_ATR);
      trendlinesFound = trendlines.length;
      if (trendlines.length > 0) {
        const currentIndex = candles.length - 1;
        const tlResult = isPriceAtTrendline(currentPrice, currentIndex, trendlines, tolerance);
        nearestTrendlineDistanceATR = Math.min(
          ...trendlines.map(t => Math.abs(currentPrice - (t.intercept + t.slope * currentIndex)))
        ) / context.atr;
        if (tlResult.atTrendline && tlResult.trendline) {
          trendline = tlResult.trendline;
          factors.push(`trendline_${tlResult.trendline.type.toLowerCase()}`);
          
          // Confirm or set direction
          if (!direction) {
            direction = tlResult.trendline.type === 'SUPPORT' ? 'LONG' : 'SHORT';
            directionSource = 'trendline';
          }
        }
      }
    } else {
      trendlinesFound = 0;
      nearestTrendlineDistanceATR = null;
    }
    
    // Calculate zone break price (invalidation)
    const zoneBreakPrice = direction === 'LONG'
      ? zoneLevel - tolerance * 2
      : zoneLevel + tolerance * 2;
    
    // Calculate minimum confluence factors based on enabled components
    const minConfluenceFactors = parameters.useMinimumConfluence ? parameters.minConfluenceFactors : 0;
    const hasConfluence = factors.length >= minConfluenceFactors && direction !== null;
    
    return {
      hasConfluence,
      factors,
      direction,
      directionSource,
      zoneLevel,
      zoneBreakPrice,
      srZone,
      fibLevel,
      fibRetracement,
      trendline,
      srZonesFound,
      trendlinesFound,
      nearestZoneDistanceATR,
      nearestFibDistanceATR,
      nearestTrendlineDistanceATR,
    };
  }
  
/**
   * Detect Entry Model 2 - rejection candle
   * A rejection candle has a wick into the zone but closes outside
   */
  private detectRejectionCandle(
    candle: Candle,
    direction: Direction,
    zoneLevel: number,
    tolerance: number,
    atr: number
  ): {
    isValid: boolean;
    strength: number;
    failureReason: string;
    measurements: {
      body: number;
      upperWick: number;
      lowerWick: number;
      wickRatio: number;
      minWickRatio: number;
      wickTouchesZone: boolean;
      closeBeyondZone: boolean;
      candleTypeOk: boolean;
    };
  } {
    const body = getCandleBody(candle);
    const upperWick = getUpperWick(candle);
    const lowerWick = getLowerWick(candle);
    
    const { minRejectionWickRatio } = this.config.parameters;
    
    // Minimum meaningful body size: 1% of ATR (prevents near-zero bodies from creating huge ratios)
    // This is a volatility-adaptive threshold consistent with the ATR-based tolerances used elsewhere
    const minBodySize = atr * 0.01;
    const effectiveBody = Math.max(body, minBodySize);
    
    if (direction === 'LONG') {
      // For long: bullish candle with lower wick into support zone
      // Wick should be longer than body
      const wickRatio = lowerWick / effectiveBody;
      
      // Check wick touches zone
      const wickTouchesZone = candle.low <= zoneLevel + tolerance;
      
      // Check close is above zone
      const closeAboveZone = candle.close > zoneLevel;
      
      // Check it's a bullish or doji candle
      const isBullishOrDoji = isBullish(candle) || body < (candle.high - candle.low) * 0.1;
      
      const isValid = wickTouchesZone && closeAboveZone && wickRatio >= minRejectionWickRatio && isBullishOrDoji;
      
      const failureReason = !wickTouchesZone
        ? `lower wick (${lowerWick.toFixed(4)}) did not reach zone (${zoneLevel.toFixed(2)} ± ${tolerance.toFixed(4)})`
        : !closeAboveZone
          ? `close (${candle.close.toFixed(2)}) not above zone (${zoneLevel.toFixed(2)})`
          : wickRatio < minRejectionWickRatio
            ? `wick:body ratio ${wickRatio.toFixed(2)} < ${minRejectionWickRatio}`
            : !isBullishOrDoji
              ? 'candle is neither bullish nor a doji'
              : 'unknown';
      
      return {
        isValid,
        strength: isValid ? Math.min(wickRatio / minRejectionWickRatio, 2) : 0,
        failureReason,
        measurements: {
          body,
          upperWick,
          lowerWick,
          wickRatio,
          minWickRatio: minRejectionWickRatio,
          wickTouchesZone,
          closeBeyondZone: closeAboveZone,
          candleTypeOk: isBullishOrDoji,
        },
      };
    } else {
      // For short: bearish candle with upper wick into resistance zone
      const wickRatio = upperWick / effectiveBody;
      
      // Check wick touches zone
      const wickTouchesZone = candle.high >= zoneLevel - tolerance;
      
      // Check close is below zone
      const closeBelowZone = candle.close < zoneLevel;
      
      // Check it's a bearish or doji candle
      const isBearishOrDoji = isBearish(candle) || body < (candle.high - candle.low) * 0.1;
      
      const isValid = wickTouchesZone && closeBelowZone && wickRatio >= minRejectionWickRatio && isBearishOrDoji;
      
      const failureReason = !wickTouchesZone
        ? `upper wick (${upperWick.toFixed(4)}) did not reach zone (${zoneLevel.toFixed(2)} ± ${tolerance.toFixed(4)})`
        : !closeBelowZone
          ? `close (${candle.close.toFixed(2)}) not below zone (${zoneLevel.toFixed(2)})`
          : wickRatio < minRejectionWickRatio
            ? `wick:body ratio ${wickRatio.toFixed(2)} < ${minRejectionWickRatio}`
            : !isBearishOrDoji
              ? 'candle is neither bearish nor a doji'
              : 'unknown';
      
      return {
        isValid,
        strength: isValid ? Math.min(wickRatio / minRejectionWickRatio, 2) : 0,
        failureReason,
        measurements: {
          body,
          upperWick,
          lowerWick,
          wickRatio,
          minWickRatio: minRejectionWickRatio,
          wickTouchesZone,
          closeBeyondZone: closeBelowZone,
          candleTypeOk: isBearishOrDoji,
        },
      };
    }
  }
  
  /**
   * Calculate stop-loss with source info (for the decision trace).
   *
   * Buffer rule: STOP_BUFFER_ATR × ATR (0.1 ATR).
   * This replaces the previous STOP_LOSS_BUFFER (10% of entry-to-swing
   * distance), which was scale-dependent and superseded by STOP_BUFFER_ATR
   * in Stage 3 Phase 1.  The spec justification: the drawn stop in the p.16
   * and p.17 worked examples sits ~0.10 ATR above the 61.80% level, so 0.1
   * ATR is the smallest value consistent with the author's own charts.  The
   * percentage-of-distance formulation scaled every stop, every position
   * size, and every R-multiple differently across instruments.
   *
   * The SHORT branch requires that the located swing high is strictly ABOVE
   * the entry; a swing high below the entry cannot act as a stop for a short.
   * The Python engine previously omitted this guard — it has been added there
   * to match.
   */
  private calculateStopLossWithSource(
    entryPrice: number,
    direction: Direction,
    candles: Candle[]
  ): { price: number; source: string } {
    // STOP_BUFFER_ATR = 0.1 (spec: Stage 3 Phase 1, replaces 10%-of-distance)
    const atr = calculateATR(candles, 14);
    const buffer = atr * 0.1;

    if (direction === 'LONG') {
      const swingLow = findRecentSwingLow(candles, 3);
      if (swingLow) {
        return { price: swingLow.price - buffer, source: 'recent swing low − 0.1 ATR' };
      }
      // Fallback: use recent 10-candle low with ATR buffer
      const recentLows = candles.slice(-10).map(c => c.low);
      const minLow = Math.min(...recentLows);
      return { price: minLow - buffer, source: '10-candle low − 0.1 ATR (fallback)' };
    } else {
      // SHORT: stop loss must be ABOVE entry price
      const swingHigh = findRecentSwingHigh(candles, 3);
      if (swingHigh && swingHigh.price > entryPrice) {
        return { price: swingHigh.price + buffer, source: 'recent swing high + 0.1 ATR' };
      }
      // Fallback: use recent 10-candle high with ATR buffer, ensuring it is above entry
      const recentHighs = candles.slice(-10).map(c => c.high);
      const maxHigh = Math.max(...recentHighs);
      const fallbackPrice = maxHigh + buffer;
      // Ensure stop loss is above entry price (mandatory validity)
      return { price: Math.max(fallbackPrice, entryPrice + buffer), source: '10-candle high + 0.1 ATR (fallback)' };
    }
  }
  
  /**
   * Calculate target with source info (for the decision trace)
   */
  private calculateTargetWithSource(
    entryPrice: number,
    stopLoss: number,
    direction: Direction,
    candles: Candle[]
  ): { price: number; source: string } {
    const risk = Math.abs(entryPrice - stopLoss);
    const minRR = MIN_TARGET_RR;  // Minimum acceptable R:R
    // Use ?? (nullish coalescing) so that an explicit 0 is NOT overridden.
    // The previous || 2.5 would silently replace a configured value of 0 with
    // 2.5, and deviated from the spec's canonical value of 2.0.
    const defaultRR = this.config.parameters.targetRR ?? 2;
    
    // Find structural zones
    const atr = calculateATR(candles, 14);
    const zones = findSRZones(candles, atr, SR_ZONE_TOLERANCE_ATR, SR_MIN_TOUCHES);
    
    if (direction === 'LONG') {
      // Find the nearest resistance above entry
      const resistance = findNearestResistance(entryPrice, zones);
      
      if (resistance) {
        const distanceToResistance = resistance.priceLevel - entryPrice;
        const rMultiple = distanceToResistance / risk;
        
        // If resistance offers > minRR, target slightly before it
        if (rMultiple >= minRR) {
          // Exit 0.2% before the level (avoid the exact level where orders cluster)
          const targetPrice = resistance.priceLevel * 0.998;
          return { price: targetPrice, source: 'nearest resistance structure' };
        }
      }
      
      // Fallback: use fixed R:R if no good structure target
      return { price: entryPrice + (risk * defaultRR), source: `fixed ${defaultRR}R (no structure target)` };
      
    } else {
      // Find the nearest support below entry
      const support = findNearestSupport(entryPrice, zones);
      
      if (support) {
        const distanceToSupport = entryPrice - support.priceLevel;
        const rMultiple = distanceToSupport / risk;
        
        // If support offers > minRR, target slightly above it
        if (rMultiple >= minRR) {
          // Exit 0.2% above the level
          const targetPrice = support.priceLevel * 1.002;
          return { price: targetPrice, source: 'nearest support structure' };
        }
      }
      
      // Fallback: use fixed R:R if no good structure target
      return { price: entryPrice - (risk * defaultRR), source: `fixed ${defaultRR}R (no structure target)` };
    }
  }
  
  /**
   * Calculate stop-loss based on recent swing
   */
  calculateStopLoss(entryPrice: number, direction: Direction, candles: Candle[]): number {
    return this.calculateStopLossWithSource(entryPrice, direction, candles).price;
  }
  
  /**
   * Calculate target based on structure levels (DYNAMIC TARGETS)
   * Instead of fixed R:R, target the next structural level
   */
  calculateTarget(
    entryPrice: number,
    stopLoss: number,
    direction: Direction,
    candles: Candle[]
  ): number {
    return this.calculateTargetWithSource(entryPrice, stopLoss, direction, candles).price;
  }
  
  /**
   * Calculate confidence score based on confluence factors
   * Matches Python implementation: min(factor_count / 4, 1.0)
   */
  private calculateConfidence(factorCount: number): number {
    return Math.min(factorCount / 4, 1.0);
  }
  
  /**
   * Validate pattern has enough data
   */
  validate(candles: Candle[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (candles.length < this.getRequiredCandleCount()) {
      errors.push(`Insufficient candles: need ${this.getRequiredCandleCount()}, got ${candles.length}`);
    }
    
    if (this.config.parameters.minConfluenceFactors < 2) {
      warnings.push('minConfluenceFactors < 2 may produce low-quality signals');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Get required candle count
   */
  getRequiredCandleCount(): number {
    return Math.max(this.config.parameters.srZoneLookback, 100);
  }
}

export default ConfluenceZonePattern;