/**
 * Patterns API Routes
 */
import { Router, Request, Response } from 'express';
import { PatternRegistry } from '../../core/PatternRegistry';
import { TradeRepository } from '../../db/TradeRepository';
import { Pattern, Trade } from '../../types';

interface PatternInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  timeframes: string[];
  enabled: boolean;
  requiredCandles: number;
  stats?: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    avgRMultiple: number;
  };
}

export function createPatternsRouter(
  registry: PatternRegistry,
  repository: TradeRepository
): Router {
  const router = Router();

  /**
   * GET /api/patterns
   * List all registered patterns with their performance stats
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const patterns = registry.getAll();
      const trades = repository.getAll();
      
      const patternInfos: PatternInfo[] = patterns.map((pattern: Pattern) => {
        // Get trades for this pattern
        const patternTrades = trades.filter((t: Trade) => t.patternId === pattern.id);
        const closedTrades = patternTrades.filter((t: Trade) => 
          t.state === 'CLOSED' || t.state === 'STOPPED'
        );
        
        // Calculate stats
        const winners = closedTrades.filter((t: Trade) => (t.pnl ?? 0) > 0);
        const pnls = closedTrades.map((t: Trade) => t.pnl ?? 0);
        const rMultiples = closedTrades.map((t: Trade) => t.rMultiple ?? 0);
        
        const winPnls = winners.map((t: Trade) => t.pnl ?? 0);
        const lossPnls = closedTrades.filter((t: Trade) => (t.pnl ?? 0) < 0).map((t: Trade) => Math.abs(t.pnl ?? 0));
        
        const totalWins = winPnls.reduce((a: number, b: number) => a + b, 0);
        const totalLosses = lossPnls.reduce((a: number, b: number) => a + b, 0);
        
        return {
          id: pattern.id,
          name: pattern.name,
          description: pattern.description,
          version: pattern.version,
          timeframes: pattern.config.timeframes,
          enabled: pattern.config.enabled,
          requiredCandles: pattern.getRequiredCandleCount(),
          stats: closedTrades.length > 0 ? {
            totalTrades: closedTrades.length,
            winRate: winners.length / closedTrades.length,
            profitFactor: totalLosses > 0 ? totalWins / totalLosses : 0,
            avgRMultiple: rMultiples.length > 0 
              ? rMultiples.reduce((a: number, b: number) => a + b, 0) / rMultiples.length 
              : 0,
          } : undefined,
        };
      });
      
      res.json({ patterns: patternInfos });
    } catch (error) {
      console.error('Error fetching patterns:', error);
      res.status(500).json({ error: 'Failed to fetch patterns' });
    }
  });

  /**
   * GET /api/patterns/:id
   * Get a single pattern by ID
   */
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const pattern = registry.get(req.params.id);
      
      if (!pattern) {
        return res.status(404).json({ error: 'Pattern not found' });
      }
      
      res.json({
        id: pattern.id,
        name: pattern.name,
        description: pattern.description,
        version: pattern.version,
        config: pattern.config,
        requiredCandles: pattern.getRequiredCandleCount(),
      });
    } catch (error) {
      console.error('Error fetching pattern:', error);
      res.status(500).json({ error: 'Failed to fetch pattern' });
    }
  });

  /**
   * GET /api/patterns/:id/trades
   * Get all trades for a pattern
   */
  router.get('/:id/trades', (req: Request, res: Response) => {
    try {
      const allTrades = repository.getAll();
      const trades = allTrades.filter((t: Trade) => t.patternId === req.params.id);
      res.json({ trades, count: trades.length });
    } catch (error) {
      console.error('Error fetching pattern trades:', error);
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  return router;
}

