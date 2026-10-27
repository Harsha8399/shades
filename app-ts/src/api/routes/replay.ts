/**
 * Historical Replay API Routes
 * 
 * Run historical candle replay with prediction generation and evaluation.
 * Lists available data files, starts/stops/pauses replay, returns predictions and evaluations.
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ReplayEngine } from '../../core/ReplayEngine';
import { registerAllPatterns } from '../../patterns';
import { PatternRegistry } from '../../core/PatternRegistry';
import { Timeframe, Direction } from '../../types';
import { ReplayConfig, ReplayStatus, ReplayResult, EvaluationMetrics } from '../../types/prediction';
import { DecisionTrace } from '../../types/decision';
import { UpstoxFeed, HISTORICAL_LIMITS } from '../../data/UpstoxFeed';
import { NiftyHistoricalDownloader, NIFTY_INSTRUMENT_KEYS, DEFAULT_CACHE_CONFIG, type DownloadResult } from '../../data/NiftyHistoricalDownloader';

// Track running replays
interface StrategyResult {
  strategyId: string;
  engine: ReplayEngine;
  result: ReplayResult;
}

interface ReplaySession {
  engine: ReplayEngine;
  status: ReplayStatus;
  result?: ReplayResult;
  strategyResults?: StrategyResult[];
}

const replays: Map<string, ReplaySession> = new Map();
let patternsRegistered = false;

function ensurePatternsRegistered() {
  if (!patternsRegistered) {
    registerAllPatterns();
    patternsRegistered = true;
  }
}

/**
 * Calculate start timestamp based on end time, timeframe, and desired candle count
 * Accounts for trading hours (9:15-15:30 IST, Mon-Fri) for intraday timeframes
 */
function calculateStartMs(endMs: number, timeframe: string, candleCount: number): number {
  const timeframeMinutes: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };
  
  const minutesPerCandle = timeframeMinutes[timeframe] || 60;
  const totalMinutes = minutesPerCandle * candleCount;
  
  // For daily/weekly/monthly, just subtract calendar days
  if (timeframe === '1d') {
    const endDate = new Date(endMs);
    endDate.setDate(endDate.getDate() - candleCount);
    return endDate.getTime();
  }
  
  // For intraday, estimate calendar days accounting for trading hours (6.25 hrs/day) and weekends
  const tradingMinutesPerDay = 6.25 * 60; // 9:15-15:30 = 375 minutes
  const calendarDays = Math.ceil(totalMinutes / tradingMinutesPerDay) * 1.5; // 1.5x for weekends
  
  const startDate = new Date(endMs);
  startDate.setDate(startDate.getDate() - Math.ceil(calendarDays));
  
  return startDate.getTime();
}

/**
 * Validate that the requested date range is within Upstox V3 historical limits
 * Returns null if valid, or an error message string if invalid
 */
function validateDateRangeAgainstV3Limits(
  timeframe: string,
  fromDate: Date,
  toDate: Date
): string | null {
  const limit = HISTORICAL_LIMITS[timeframe];
  if (!limit) {
    return null; // Unknown timeframe, let the API handle it
  }
  
  const requestedDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  if (requestedDays > limit.maxDays) {
    return `Date range of ${requestedDays} days exceeds Upstox V3 historical limit of ${limit.maxDays} days for ${timeframe} timeframe. Maximum allowed: ${limit.maxDays} days. Consider reducing candle count or using a longer timeframe.`;
  }
  
  return null;
}

function aggregateMetrics(metricsList: EvaluationMetrics[]): EvaluationMetrics {
  if (metricsList.length === 0) {
    return {
      totalPredictions: 0,
      evaluatedCount: 0,
      evaluatedDirectionalCount: 0,
      noTradeCount: 0,
      abstentionRate: 0,
      pendingCount: 0,
      inconclusiveCount: 0,
      ambiguousCount: 0,
      directional: { correct: 0, incorrect: 0, ties: 0, accuracy: 0, accuracyDenominator: 'ALL', ci: [0, 0] },
      stopTarget: { targetFirst: 0, stopFirst: 0, ambiguous: 0, neither: 0, inconclusive: 0 },
      avgRMultiple: 0,
      byStrategy: {},
      byTimeframe: {},
      byDirection: {} as Record<Direction | 'NO_TRADE', { total: number; evaluated: number; directionalAccuracy: number }>,
      sampleSize: { evaluatedDirectional: 0, warnings: [] },
    };
  }

  // Sum up scalar metrics
  const totalPredictions = metricsList.reduce((sum, m) => sum + m.totalPredictions, 0);
  const evaluatedCount = metricsList.reduce((sum, m) => sum + m.evaluatedCount, 0);
  const evaluatedDirectionalCount = metricsList.reduce((sum, m) => sum + m.evaluatedDirectionalCount, 0);
  const noTradeCount = metricsList.reduce((sum, m) => sum + m.noTradeCount, 0);
  const pendingCount = metricsList.reduce((sum, m) => sum + m.pendingCount, 0);
  const inconclusiveCount = metricsList.reduce((sum, m) => sum + m.inconclusiveCount, 0);
  const ambiguousCount = metricsList.reduce((sum, m) => sum + m.ambiguousCount, 0);

  // Sum directional metrics
  const directional = {
    correct: metricsList.reduce((sum, m) => sum + m.directional.correct, 0),
    incorrect: metricsList.reduce((sum, m) => sum + m.directional.incorrect, 0),
    ties: metricsList.reduce((sum, m) => sum + m.directional.ties, 0),
    accuracy: 0,
    accuracyDenominator: 'ALL' as const,
    ci: [0, 0] as [number, number],
  };
  const dirDenom = directional.correct + directional.incorrect + directional.ties;
  directional.accuracy = dirDenom > 0 ? directional.correct / dirDenom : 0;

  // Sum stopTarget metrics
  const stopTarget = {
    targetFirst: metricsList.reduce((sum, m) => sum + m.stopTarget.targetFirst, 0),
    stopFirst: metricsList.reduce((sum, m) => sum + m.stopTarget.stopFirst, 0),
    ambiguous: metricsList.reduce((sum, m) => sum + m.stopTarget.ambiguous, 0),
    neither: metricsList.reduce((sum, m) => sum + m.stopTarget.neither, 0),
    inconclusive: metricsList.reduce((sum, m) => sum + m.stopTarget.inconclusive, 0),
  };

  // For simplicity, use first strategy's byStrategy/byTimeframe/byDirection structure
  // and update totals from all strategies
  const first = metricsList[0];
  const byStrategy: Record<string, { total: number; evaluated: number; directionalAccuracy: number; stopTargetOutcomes: Record<string, number>; noTradeCount: number }> = { ...first.byStrategy };
  const byTimeframe = { ...first.byTimeframe };
  const byDirection = { ...first.byDirection } as Record<Direction | 'NO_TRADE', { total: number; evaluated: number; directionalAccuracy: number }>;

  // Update totals in byStrategy
  for (const m of metricsList) {
    for (const [key, val] of Object.entries(m.byStrategy)) {
      if (byStrategy[key]) {
        byStrategy[key].total += val.total;
        byStrategy[key].evaluated += val.evaluated;
        byStrategy[key].noTradeCount += val.noTradeCount || 0;
        // Merge stopTargetOutcomes
        for (const [outcomeKey, outcomeVal] of Object.entries(val.stopTargetOutcomes)) {
          byStrategy[key].stopTargetOutcomes[outcomeKey] = (byStrategy[key].stopTargetOutcomes[outcomeKey] || 0) + outcomeVal;
        }
      } else {
        byStrategy[key] = { ...val };
      }
    }

    for (const [key, val] of Object.entries(m.byTimeframe)) {
      if (byTimeframe[key]) {
        byTimeframe[key].total += val.total;
        byTimeframe[key].evaluated += val.evaluated;
        byTimeframe[key].noTradeCount += val.noTradeCount || 0;
      } else {
        byTimeframe[key] = { ...val };
      }
    }

    for (const [key, val] of Object.entries(m.byDirection)) {
      const k = key as Direction | 'NO_TRADE';
      if (byDirection[k]) {
        byDirection[k].total += val.total;
        byDirection[k].evaluated += val.evaluated;
      } else {
        byDirection[k] = { ...val };
      }
    }
  }

  // Recalculate directionalAccuracy for merged byStrategy/byTimeframe/byDirection
  // This is approximate since we don't have correct/incorrect breakdown
  for (const key of Object.keys(byStrategy)) {
    const s = byStrategy[key];
    // Can't accurately recalculate without correct/incorrect counts
    // Keep the weighted average of accuracies
  }
  for (const key of Object.keys(byTimeframe)) {
    const s = byTimeframe[key];
  }
  for (const key of Object.keys(byDirection) as (Direction | 'NO_TRADE')[]) {
    const s = byDirection[key];
  }

  const sampleSize = {
    evaluatedDirectional: metricsList.reduce((sum, m) => sum + m.sampleSize.evaluatedDirectional, 0),
    warnings: metricsList.flatMap(m => m.sampleSize.warnings),
  };

  const avgRMultiple = metricsList.reduce((sum, m) => sum + (m.avgRMultiple || 0), 0) / metricsList.length;

  return {
    totalPredictions,
    evaluatedCount,
    evaluatedDirectionalCount,
    noTradeCount,
    abstentionRate: totalPredictions > 0 ? noTradeCount / totalPredictions : 0,
    pendingCount: metricsList.reduce((sum, m) => sum + m.pendingCount, 0),
    inconclusiveCount,
    ambiguousCount,
    directional,
    stopTarget,
    avgRMultiple,
    byStrategy,
    byTimeframe,
    byDirection,
    sampleSize,
    baselines: first.baselines,
    simulatedTrading: first.simulatedTrading,
  };
}

export function createReplayRouter(): Router {
  const router = Router();

  /**
   * GET /api/replay/data-files
   * List available CSV data files (reuses simulation endpoint logic)
   */
  router.get('/data-files', (req: Request, res: Response) => {
    try {
      const dataDirs = [
        path.resolve('./data'),
        path.resolve('./data/nse'),
        path.resolve('../research-py/data'),
        path.resolve('../research-py/data/nse'),
      ];

      const files: Array<{ name: string; path: string; size: number; modified: string }> = [];

      for (const dir of dataDirs) {
        if (!fs.existsSync(dir)) continue;

        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (!entry.endsWith('.csv')) continue;
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          files.push({
            name: entry,
            path: fullPath,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        }
      }

      res.json({ files, count: files.length });
    } catch (error) {
      console.error('[Replay API] Error listing files:', error);
      res.status(500).json({ error: 'Failed to list data files' });
    }
  });

  /**
   * POST /api/replay/start
   * Start a historical replay
   * 
   * Body (CSV mode): { filePath, symbol, timeframe, strategyId, startDate?, endDate?, candleCount?, speed?, evaluationHorizon?, filtersEnabled?, looseFilters? }
   * Body (API mode): { dataSource: 'api', symbol, timeframe, strategyId, endDate?, candleCount?, speed?, evaluationHorizon?, filtersEnabled?, looseFilters? }
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const {
        dataSource = 'csv', // 'csv' or 'api'
        filePath,
        symbol,
        timeframe = '1h',
        strategyIds = ['confluence-zone-em2'],
        startDate,
        endDate,
        candleCount = 100, // Default 100 candles, minimum 100
        speed = 0, // 0 = instant
        evaluationHorizon = { candles: 5 },
        filtersEnabled = false,
        looseFilters = false,
        strategyConfig = {}, // Per-strategy configuration
      } = req.body as {
        dataSource?: string;
        filePath?: string;
        symbol: string;
        timeframe?: string;
        strategyIds?: string[];
        startDate?: string | number;
        endDate?: string | number;
        candleCount?: number;
        speed?: number;
        evaluationHorizon?: { candles: number };
        filtersEnabled?: boolean;
        looseFilters?: boolean;
        strategyConfig?: Record<string, Record<string, any>>;
      };

      console.log(`[Replay API] Request:`, JSON.stringify(req.body, null, 2));

      // Validate required fields
      if (!symbol) {
        return res.status(400).json({ error: 'symbol is required' });
      }

      // Validate timeframe
      // Upstox V3 historical API supports: 1m, 5m, 15m, 30m, 1h, 2h, 3h, 4h, 5h, 1d, 1w, 1mo
      const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '2h', '3h', '4h', '5h', '1d', '1w', '1mo'];
      
      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({ error: `Invalid timeframe. Use: ${validTimeframes.join(', ')}` });
      }

      // Validate strategies
      const strategyIdsArray = Array.isArray(strategyIds) ? strategyIds : [strategyIds];
      if (strategyIdsArray.length === 0) {
        return res.status(400).json({ error: 'At least one strategy must be selected' });
      }
      
      // Get enabled strategies from registry
      ensurePatternsRegistered();
      const registry = PatternRegistry.getInstance();
      const enabledStrategyIds = registry.getEnabled().map(p => p.id);
      
      const invalidStrategies = strategyIdsArray.filter(id => !enabledStrategyIds.includes(id));
      if (invalidStrategies.length > 0) {
        return res.status(400).json({ error: `Invalid strategy IDs: ${invalidStrategies.join(', ')}. Executable: ${enabledStrategyIds.join(', ')}` });
      }

// Parse date range
      let startMs: number | undefined;
      let endMs: number | undefined;
      let endDateExplicitlyProvided = false;
      if (endDate) {
        const parsed = new Date(endDate).getTime();
        if (isNaN(parsed)) {
          return res.status(400).json({ error: 'Invalid endDate format. Use ISO 8601 (e.g., 2024-12-31T23:59:59Z)' });
        }
        endMs = parsed;
        endDateExplicitlyProvided = true;
      } else {
        // Default to current time in Asia/Kolkata timezone (IST)
        // This ensures we get the correct trading day for NSE
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        endMs = nowIST.getTime();
      }

      // If startDate not provided but candleCount is, calculate start date.
      // Add the strategy warm-up requirement so the replay window itself is
      // fully evaluable (warm-up candles build history, they are not scored).
      if (!startDate && candleCount) {
        const warmupCandles = 100; // strategies require up to 100 closed candles
        const minCandles = Math.max(candleCount, 100) + warmupCandles;
        startMs = calculateStartMs(endMs, timeframe, minCandles);
      } else if (startDate) {
        const parsed = new Date(startDate).getTime();
        if (isNaN(parsed)) {
          return res.status(400).json({ error: 'Invalid startDate format. Use ISO 8601 (e.g., 2024-01-01T00:00:00Z)' });
        }
        startMs = parsed;
      }

      if (startMs !== undefined && endMs !== undefined && startMs >= endMs) {
        return res.status(400).json({ error: 'startDate must be before endDate' });
      }

      // Validate speed
      if (typeof speed !== 'number' || speed < 0 || speed > 100) {
        return res.status(400).json({ error: 'speed must be a number between 0 and 100 (candles/second)' });
      }

      // Validate evaluation horizon
      if (!evaluationHorizon || typeof evaluationHorizon.candles !== 'number' || evaluationHorizon.candles < 1 || evaluationHorizon.candles > 100) {
        return res.status(400).json({ error: 'evaluationHorizon.candles must be a number between 1 and 100' });
      }

      // Validate strategyConfig if provided
      if (strategyConfig && typeof strategyConfig === 'object') {
        for (const [strategyId, config] of Object.entries(strategyConfig)) {
          if (!strategyIdsArray.includes(strategyId)) {
            return res.status(400).json({ error: `StrategyConfig provided for unknown strategy: ${strategyId}` });
          }
          if (typeof config !== 'object' || config === null) {
            return res.status(400).json({ error: `StrategyConfig for ${strategyId} must be an object` });
          }
          // Validate confluence-zone-em2 component toggles
          if (strategyId === 'confluence-zone-em2') {
            const validKeys = ['useSupportResistance', 'useFibonacci', 'useTrendline', 'useRejectionCandle', 'useMinimumConfluence', 'useMinimumRiskReward', 'minConfluenceFactors', 'srZoneLookback', 'fibLevels', 'zoneToleranceATR', 'minRejectionWickRatio', 'targetRR'];
            const invalidKeys = Object.keys(config).filter(k => !validKeys.includes(k));
            if (invalidKeys.length > 0) {
              return res.status(400).json({ error: `Invalid strategyConfig keys for ${strategyId}: ${invalidKeys.join(', ')}. Valid: ${validKeys.join(', ')}` });
            }
            // Validate boolean toggles
            const booleanKeys = ['useSupportResistance', 'useFibonacci', 'useTrendline', 'useRejectionCandle', 'useMinimumConfluence', 'useMinimumRiskReward'];
            for (const key of booleanKeys) {
              if (config[key] !== undefined && typeof config[key] !== 'boolean') {
                return res.status(400).json({ error: `StrategyConfig ${strategyId}.${key} must be a boolean` });
              }
            }
            // Validate numeric thresholds
            if (config.minConfluenceFactors !== undefined && (typeof config.minConfluenceFactors !== 'number' || config.minConfluenceFactors < 1 || config.minConfluenceFactors > 3)) {
              return res.status(400).json({ error: `StrategyConfig ${strategyId}.minConfluenceFactors must be a number between 1 and 3` });
            }
            if (config.minRejectionWickRatio !== undefined && (typeof config.minRejectionWickRatio !== 'number' || config.minRejectionWickRatio < 0)) {
              return res.status(400).json({ error: `StrategyConfig ${strategyId}.minRejectionWickRatio must be a non-negative number` });
            }
            if (config.targetRR !== undefined && (typeof config.targetRR !== 'number' || config.targetRR <= 0)) {
              return res.status(400).json({ error: `StrategyConfig ${strategyId}.targetRR must be a positive number` });
            }
          }
        }
      }

      // For API mode, we now support candleCount without explicit dates
      if (dataSource === 'api') {
        if (!startMs || !endMs) {
          return res.status(400).json({ error: 'Failed to calculate date range' });
        }
      }

      ensurePatternsRegistered();

      const replayId = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      const config = {
        filePath: dataSource === 'csv' ? filePath : undefined,
        symbol,
        timeframe: timeframe as any,
        strategyIds: strategyIdsArray,
        startDate: startMs,
        endDate: endMs,
        candleCount,
        speed,
        evaluationHorizon,
        filtersEnabled: filtersEnabled && !looseFilters,
        looseFilters,
        strategyConfig,
      };

      // Run replay for each strategy
      const strategyResults = await Promise.all(
        config.strategyIds!.map(async (strategyId) => {
          const perStrategyConfig = config.strategyConfig?.[strategyId] || {};
          // Use a distinct variable name to avoid shadowing the outer `strategyConfig`.
          // Pass perStrategyConfig as the flat params object for this strategy so
          // ReplayEngine can detect and use it regardless of how strategyConfig is shaped.
          const engineConfig = {
            ...config,
            strategyId,
            // Pass the flat per-strategy params directly under the strategy's own key
            // so that the ReplayEngine config.strategyConfig[strategyId] lookup works.
            strategyConfig: { [strategyId]: perStrategyConfig },
          };
          
          // Create replay engine for this strategy
          const engine = new ReplayEngine(engineConfig);
          
          // Load data (same for all strategies)
          try {
            if (dataSource === 'api') {
              // Fetch candles from Upstox API
              const upstoxFeed = new UpstoxFeed({
                apiKey: process.env.UPSTOX_API_KEY || '',
                apiSecret: process.env.UPSTOX_API_SECRET || '',
                redirectUri: process.env.UPSTOX_REDIRECT_URI || 'http://localhost:3000/callback',
                accessToken: process.env.UPSTOX_ACCESS_TOKEN || '',
              });

              if (!upstoxFeed.isAuthenticated()) {
                throw new Error('Upstox credentials not configured. Set UPSTOX_ACCESS_TOKEN in environment.');
              }

              // Get instrument key from symbol
              const instrumentKey = upstoxFeed.getPopularNSEStocks()[symbol.toUpperCase()];
              if (!instrumentKey) {
                throw new Error(`Unknown symbol: ${symbol}. Supported: ${Object.keys(upstoxFeed.getPopularNSEStocks()).join(', ')}`);
              }

              // Validate date range against Upstox V3 historical limits
              const rangeError = validateDateRangeAgainstV3Limits(timeframe, new Date(startMs!), new Date(endMs!));
              if (rangeError) {
                throw new Error(rangeError);
              }

              // When end date was not explicitly provided (defaulted to now), include intraday data
              // to get current-day candles. For explicit end dates, use historical only.
              const includeIntraday = dataSource === 'api' && !endDateExplicitlyProvided;
              const candles = await upstoxFeed.getHistoricalData(
                instrumentKey, 
                timeframe as any, 
                new Date(startMs!), 
                new Date(endMs!), 
                includeIntraday
              );
              
              if (candles.length === 0) {
                throw new Error('No data returned from Upstox API for the given range');
              }

              engine.setCandles(candles);
            } else {
              // CSV mode - validate file
              if (!filePath) {
                throw new Error('filePath is required for CSV mode');
              }
              if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
              }
              engine.loadData();
            }
          } catch (loadError: any) {
            throw new Error(loadError.message);
          }

          // Run the replay
          return new Promise<{ strategyId: string; engine: ReplayEngine; result: ReplayResult }>((resolve, reject) => {
            engine.onComplete = (result) => {
              resolve({ strategyId, engine, result });
            };
            engine.onError = (error) => {
              reject(error);
            };
            engine.start();
          });
        })
      );

      // Aggregate results from all strategies
      const allPredictions = strategyResults.flatMap(r => r.result.predictions);
      const allCandles = strategyResults[0]?.result.candles || [];
      const allMetrics = aggregateMetrics(strategyResults.map(r => r.result.metrics));
      const allDiagnostics = strategyResults.map(r => ({
        strategyId: r.strategyId,
        diagnostics: r.result.diagnostics,
        filteredSignals: r.engine.getFilteredSignals(),
        decisionTraces: r.engine.getDecisionTraces(),
      }));

      // Store session with first engine for status polling
      const firstEngine = strategyResults[0]?.engine;
      const status = firstEngine?.getStatus() || { status: 'COMPLETED' };
      replays.set(replayId, { engine: firstEngine!, status, strategyResults });

      // Return initial status immediately
      const statusObj = firstEngine?.getStatus() || { status: 'COMPLETED' };
      res.json({
        id: replayId,
        message: 'Replay started',
        status: statusObj,
        strategyIds: config.strategyIds,
      });
    } catch (error: any) {
      console.error('[Replay API] Error starting replay:', error);
      res.status(500).json({ error: error.message || 'Failed to start replay' });
    }
  });

  /**
   * POST /api/replay/:id/pause
   * Pause a running replay
   */
  router.post('/:id/pause', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    if (session.status.status !== 'RUNNING') {
      return res.status(400).json({ error: 'Replay is not running' });
    }

    session.engine.pause();
    const status = session.engine.getStatus();
    session.status = status;

    res.json({ id: req.params.id, status: status });
  });

  /**
   * POST /api/replay/:id/resume
   * Resume a paused replay
   */
  router.post('/:id/resume', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    if (session.status.status !== 'PAUSED') {
      return res.status(400).json({ error: 'Replay is not paused' });
    }

    session.engine.resume();
    const status = session.engine.getStatus();
    session.status = status;

    res.json({ id: req.params.id, status: status });
  });

  /**
   * POST /api/replay/:id/stop
   * Stop a replay and get final results
   */
  router.post('/:id/stop', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    if (session.status.status === 'IDLE' || session.status.status === 'COMPLETED' || session.status.status === 'STOPPED') {
      return res.status(400).json({ error: 'Replay is not running or paused' });
    }

    const result = session.engine.stop();
    const status = session.engine.getStatus();
    session.status = status;
    session.result = result;

    res.json({
      id: req.params.id,
      result: {
        ...result,
        filteredSignals: session.engine.getFilteredSignals(),
      },
      status: status,
    });
  });

  /**
   * GET /api/replay/:id/status
   * Get current replay status
   */
  router.get('/:id/status', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const status = session.engine.getStatus();
    session.status = status;

    res.json({
      id: req.params.id,
      status: status,
    });
  });

  /**
   * GET /api/replay/:id/predictions
   * Get all predictions for a replay (aggregated across all strategies, or filtered by strategyId)
   */
  router.get('/:id/predictions', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId, evaluationStatus } = req.query;
    
    let allPredictions: any[] = [];
    if (session.strategyResults && session.strategyResults.length > 0) {
      // Aggregate from all strategy results
      for (const sr of session.strategyResults) {
        if (!strategyId || sr.strategyId === strategyId) {
          allPredictions.push(...sr.result.predictions);
        }
      }
    } else {
      // Fallback to first engine
      allPredictions = session.engine.getPredictions();
    }
    
    let filtered = allPredictions;
    if (evaluationStatus) {
      filtered = filtered.filter(p => p.evaluationStatus === evaluationStatus);
    }

    res.json({
      id: req.params.id,
      predictions: filtered,
      count: filtered.length,
      total: allPredictions.length,
      strategies: [...new Set(allPredictions.map(p => p.strategyId))],
    });
  });

  /**
   * GET /api/replay/:id/evaluations
   * Get evaluation results for a replay (aggregated across all strategies)
   */
  router.get('/:id/evaluations', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId } = req.query;
    
    let allPredictions: any[] = [];
    if (session.strategyResults && session.strategyResults.length > 0) {
      for (const sr of session.strategyResults) {
        if (!strategyId || sr.strategyId === strategyId) {
          allPredictions.push(...sr.result.predictions);
        }
      }
    } else {
      allPredictions = session.engine.getPredictions();
    }
    
    const evaluated = allPredictions.filter(p => p.evaluationStatus === 'COMPLETED');
    
    res.json({
      id: req.params.id,
      evaluations: evaluated.map(p => ({
        predictionId: p.id,
        timestamp: p.timestamp,
        symbol: p.symbol,
        strategyId: p.strategyId,
        direction: p.direction,
        entryPrice: p.entryPrice,
        evaluation: p.evaluation,
      })),
      count: evaluated.length,
      total: allPredictions.length,
      strategies: [...new Set(allPredictions.map(p => p.strategyId))],
    });
  });

  /**
   * GET /api/replay/:id/metrics
   * Get aggregated evaluation metrics (computed by the engine — single source of truth)
   */
  router.get('/:id/metrics', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId } = req.query;
    
    try {
      let metrics: any;
      if (session.strategyResults && session.strategyResults.length > 0) {
        if (strategyId) {
          // Return metrics for specific strategy
          const sr = session.strategyResults.find(s => s.strategyId === strategyId);
          if (sr) {
            metrics = sr.result.metrics;
          } else {
            return res.status(404).json({ error: `Strategy ${strategyId} not found` });
          }
        } else {
          // Aggregate metrics across all strategies
          const metricsList = session.strategyResults.map(sr => sr.result.metrics);
          metrics = aggregateMetrics(metricsList);
        }
      } else {
        metrics = session.engine.getMetrics();
      }
      res.json({ id: req.params.id, metrics });
    } catch (error: any) {
      console.error('[Replay API] Error computing metrics:', error);
      res.status(500).json({ error: error.message || 'Failed to compute metrics' });
    }
  });

  /**
   * GET /api/replay/:id/diagnostics
   * Get strategy diagnostics: decision funnel, warm-up accounting and notes
   * explaining why signals were (or were not) generated.
   */
  router.get('/:id/diagnostics', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId } = req.query;
    
    try {
      let diagnosticsList: any[] = [];
      let filteredSignalsList: any[] = [];
      let decisionTracesList: any[] = [];
      
      if (session.strategyResults && session.strategyResults.length > 0) {
        for (const sr of session.strategyResults) {
          if (!strategyId || sr.strategyId === strategyId) {
            diagnosticsList.push({
              strategyId: sr.strategyId,
              diagnostics: sr.result.diagnostics,
            });
            filteredSignalsList.push(...sr.engine.getFilteredSignals().map(fs => ({ ...fs, strategyId: sr.strategyId })));
            decisionTracesList.push(...sr.engine.getDecisionTraces());
          }
        }
      } else {
        const diagnostics = session.engine.getDiagnostics();
        const filteredSignals = session.engine.getFilteredSignals();
        diagnosticsList = [{ strategyId: session.engine.getConfig().strategyId ?? 'unknown', diagnostics }];
        filteredSignalsList = filteredSignals;
        decisionTracesList = session.engine.getDecisionTraces();
      }
      
      const allFilteredSignals = filteredSignalsList;
      const filterCounts: Record<string, number> = {};
      for (const fs of allFilteredSignals) {
        for (const f of fs.failedFilters) {
          filterCounts[f] = (filterCounts[f] || 0) + 1;
        }
      }
      
      res.json({
        id: req.params.id,
        diagnostics: diagnosticsList,
        filteredSignalsSummary: {
          total: allFilteredSignals.length,
          byFilter: filterCounts,
        },
        strategies: [...new Set(decisionTracesList.map(t => t.strategyId))],
      });
    } catch (error: any) {
      console.error('[Replay API] Error computing diagnostics:', error);
      res.status(500).json({ error: error.message || 'Failed to compute diagnostics' });
    }
  });

  /**
   * GET /api/replay/:id/candles
   * Get candles for charting (same for all strategies)
   */
  router.get('/:id/candles', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    // Candles are the same for all strategies, use first engine
    const engine = session.strategyResults?.[0]?.engine || session.engine;
    const candles = engine.getCandles();
    
    // Optional range filtering
    const { start, end } = req.query;
    let filtered = candles;
    if (start) {
      const startMs = parseInt(start as string, 10);
      if (!isNaN(startMs)) filtered = filtered.filter(c => c.timestamp >= startMs);
    }
    if (end) {
      const endMs = parseInt(end as string, 10);
      if (!isNaN(endMs)) filtered = filtered.filter(c => c.timestamp <= endMs);
    }

    res.json({
      id: req.params.id,
      candles: filtered.map(c => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      count: filtered.length,
      total: candles.length,
    });
  });

  /**
   * GET /api/replay/:id/filtered-signals
   * Get signals that were generated by the pattern but rejected by trade filters.
   */
  router.get('/:id/filtered-signals', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId } = req.query;
    
    try {
      let allFilteredSignals: any[] = [];
      if (session.strategyResults && session.strategyResults.length > 0) {
        for (const sr of session.strategyResults) {
          if (!strategyId || sr.strategyId === strategyId) {
            allFilteredSignals.push(...sr.engine.getFilteredSignals().map(fs => ({ ...fs, strategyId: sr.strategyId })));
          }
        }
      } else {
        allFilteredSignals = session.engine.getFilteredSignals();
      }
      res.json({ id: req.params.id, filteredSignals: allFilteredSignals });
    } catch (error: any) {
      console.error('[Replay API] Error getting filtered signals:', error);
      res.status(500).json({ error: error.message || 'Failed to get filtered signals' });
    }
  });

  /**
   * GET /api/replay/:id/candidate-signals
   * Get all candidate signals (before trade filters) for a replay.
   */
  router.get('/:id/candidate-signals', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId, status } = req.query;
    
    try {
      let allCandidates: any[] = [];
      if (session.strategyResults && session.strategyResults.length > 0) {
        for (const sr of session.strategyResults) {
          if (!strategyId || sr.strategyId === strategyId) {
            const candidates = sr.engine.getCandidateSignals();
            allCandidates.push(...candidates.map(c => ({ ...c, strategyId: sr.strategyId })));
          }
        }
      } else {
        allCandidates = session.engine.getCandidateSignals();
      }
      
      let filtered = allCandidates;
      if (status) {
        filtered = filtered.filter(c => c.status === status);
      }
      
      res.json({ 
        id: req.params.id, 
        candidateSignals: filtered,
        count: filtered.length,
        total: allCandidates.length,
        strategies: [...new Set(allCandidates.map(c => c.strategyId))],
      });
    } catch (error: any) {
      console.error('[Replay API] Error getting candidate signals:', error);
      res.status(500).json({ error: error.message || 'Failed to get candidate signals' });
    }
  });

  /**
   * GET /api/replay/:id/decision-traces
   * Get all decision traces for trace explorer (aggregated across all strategies)
   */
  router.get('/:id/decision-traces', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const { strategyId, outcome } = req.query;
    
    try {
      let allTraces: DecisionTrace[] = [];
      if (session.strategyResults && session.strategyResults.length > 0) {
        for (const sr of session.strategyResults) {
          if (!strategyId || sr.strategyId === strategyId) {
            allTraces.push(...sr.engine.getDecisionTraces());
          }
        }
      } else {
        allTraces = session.engine.getDecisionTraces();
      }
      
      let filtered = allTraces;
      if (outcome) {
        filtered = filtered.filter(t => t.outcome === outcome);
      }
      
      res.json({ 
        id: req.params.id, 
        decisionTraces: filtered,
        count: filtered.length,
        total: allTraces.length,
        strategies: [...new Set(allTraces.map(t => t.strategyId))],
      });
    } catch (error: any) {
      console.error('[Replay API] Error getting decision traces:', error);
      res.status(500).json({ error: error.message || 'Failed to get decision traces' });
    }
  });

  /**
   * GET /api/replay/:id/result
   * Get complete replay result (candles, predictions, metrics) aggregated across strategies
   */
  router.get('/:id/result', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    if (session.result) {
      // Return aggregated result with all strategy data
      const aggregatedResult = { ...session.result };
      
      // Add candidate signals from all strategies
      if (session.strategyResults && session.strategyResults.length > 0) {
        let allCandidates: any[] = [];
        for (const sr of session.strategyResults) {
          allCandidates.push(...sr.engine.getCandidateSignals().map(c => ({ ...c, strategyId: sr.strategyId })));
        }
        aggregatedResult.candidateSignals = allCandidates;
      }
      
      res.json(aggregatedResult);
    } else if (session.status.status === 'COMPLETED') {
      // Build result if not already built
      const engine = session.strategyResults?.[0]?.engine || session.engine;
      const result = engine.stop(); // This will re-evaluate
      session.result = result;
      
      // Add candidate signals from all strategies
      if (session.strategyResults && session.strategyResults.length > 0) {
        let allCandidates: any[] = [];
        for (const sr of session.strategyResults) {
          allCandidates.push(...sr.engine.getCandidateSignals().map(c => ({ ...c, strategyId: sr.strategyId })));
        }
        result.candidateSignals = allCandidates;
      }
      
      res.json({ ...result, filteredSignals: engine.getFilteredSignals() });
    } else {
      res.status(400).json({ error: 'Replay not completed yet' });
    }
  });

  /**
   * DELETE /api/replay/:id
   * Delete a replay session
   */
  router.delete('/:id', (req: Request, res: Response) => {
    const session = replays.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    // Stop if running
    if (session.status.status === 'RUNNING' || session.status.status === 'PAUSED') {
      session.engine.stop();
    }

    replays.delete(req.params.id);
    res.json({ id: req.params.id, status: 'deleted' });
  });

  /**
   * GET /api/replay/list
   * List all replay sessions
   */
  router.get('/list', (req: Request, res: Response) => {
    const all = Array.from(replays.values())
      .map(s => s.status)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, 50);
    
    res.json({ replays: all, count: all.length });
  });

  /**
   * GET /api/replay/strategies
   * Get available strategies with their configurations
   */
  router.get('/strategies', (req: Request, res: Response) => {
    ensurePatternsRegistered();
    const registry = PatternRegistry.getInstance();
    const patterns = registry.getEnabled();
    
    const strategies = patterns.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      supportedTimeframes: p.config.timeframes,
      parameters: p.config.parameters,
      symbols: p.config.symbols,
      enabled: p.config.enabled,
    }));
    
    res.json({ success: true, strategies });
  });

  return router;
}

/**
 * Create a NIFTY historical downloader instance
 */
function createNiftyDownloader(): NiftyHistoricalDownloader {
  const upstoxFeed = new UpstoxFeed({
    apiKey: process.env.UPSTOX_API_KEY || '',
    apiSecret: process.env.UPSTOX_API_SECRET || '',
    redirectUri: process.env.UPSTOX_REDIRECT_URI || 'http://localhost:3000/callback',
    accessToken: process.env.UPSTOX_ACCESS_TOKEN || '',
  });
  
  return new NiftyHistoricalDownloader(upstoxFeed);
}

/**
 * Create NIFTY download router
 */
export function createNiftyDownloadRouter(): Router {
  const router = Router();
  
  /**
   * POST /api/replay/nifty/download
   * Download NIFTY 50 historical data
   * Body: { timeframe, fromDate, toDate, cacheConfig? }
   */
  router.post('/nifty/download', async (req: Request, res: Response) => {
    try {
      const {
        timeframe = '1h',
        fromDate,
        toDate,
        cacheConfig,
      } = req.body;
      
      // Validate timeframe
      const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({ 
          error: `Invalid timeframe. Supported: ${validTimeframes.join(', ')}` 
        });
      }
      
      // Parse dates
      let fromMs: number, toMs: number;
      try {
        fromMs = fromDate ? new Date(fromDate).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
        toMs = toDate ? new Date(toDate).getTime() : Date.now();
      } catch {
        return res.status(400).json({ error: 'Invalid date format. Use ISO 8601.' });
      }
      
      if (fromMs >= toMs) {
        return res.status(400).json({ error: 'fromDate must be before toDate' });
      }
      
      const cacheConfigToUse = cacheConfig || {
        enabled: true,
        cacheDir: path.resolve('./data/nifty-cache'),
        maxAgeDays: 7,
      };
      
      // Create downloader and download
      const downloader = createNiftyDownloader();
      const result: DownloadResult = await downloader.downloadNifty50(
        timeframe as any,
        new Date(fromMs),
        new Date(toMs),
        cacheConfigToUse
      );
      
      res.json({
        success: result.success,
        data: result,
      });
    } catch (error: any) {
      console.error('[NIFTY Download] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to download NIFTY data' });
    }
  });
  
  /**
   * GET /api/replay/nifty/cache/stats
   * Get cache statistics
   */
  router.get('/nifty/cache/stats', (req: Request, res: Response) => {
    try {
      const downloader = createNiftyDownloader();
      const stats = downloader.getCacheStats();
      res.json({ success: true, stats });
    } catch (error: any) {
      console.error('[NIFTY Cache Stats] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to get cache stats' });
    }
  });
  
  /**
   * DELETE /api/replay/nifty/cache
   * Clear NIFTY cache
   */
  router.delete('/nifty/cache', (req: Request, res: Response) => {
    try {
      const { instrumentKey, timeframe } = req.query;
      const downloader = createNiftyDownloader();
      const cleared = downloader.clearCache(
        instrumentKey as string | undefined,
        timeframe as any
      );
      res.json({ success: true, cleared });
    } catch (error: any) {
      console.error('[NIFTY Cache Clear] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to clear cache' });
    }
  });
  
  /**
   * GET /api/replay/nifty/instrument-keys
   * Get available NIFTY instrument keys
   */
  router.get('/nifty/instrument-keys', (req: Request, res: Response) => {
    res.json({
      success: true,
      instruments: {
        NIFTY50: 'NSE_INDEX|Nifty 50',
        BANKNIFTY: 'NSE_INDEX|Nifty Bank',
        NIFTYIT: 'NSE_INDEX|Nifty IT',
        NIFTYMIDCAP: 'NSE_INDEX|NIFTY MIDCAP 100',
        FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
      },
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
      note: 'NIFTY 50 uses instrument key: NSE_INDEX|Nifty 50',
    });
  });

  /**
   * GET /api/replay/strategies
   * Get available strategies with their configurations
   */
  router.get('/strategies', (req: Request, res: Response) => {
    ensurePatternsRegistered();
    const registry = PatternRegistry.getInstance();
    const patterns = registry.getEnabled();
    
    const strategies = patterns.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      supportedTimeframes: p.config.timeframes,
      parameters: p.config.parameters,
      symbols: p.config.symbols,
      enabled: p.config.enabled,
    }));
    
    res.json({ success: true, strategies });
  });

  return router;
}