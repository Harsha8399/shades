/**
 * Trades API Routes
 */
import { Router, Request, Response } from 'express';
import { TradeRepository } from '../../db/TradeRepository';
import { TradeState } from '../../types';

export function createTradesRouter(repository: TradeRepository): Router {
  const router = Router();

  /**
   * GET /api/trades
   * List all trades with optional filters
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const {
        state,
        patternId,
        symbol,
        limit = '100',
        offset = '0',
      } = req.query;

      let trades = repository.getAll();

      // Apply filters
      if (state) {
        trades = trades.filter(t => t.state === state);
      }
      if (patternId) {
        trades = trades.filter(t => t.patternId === patternId);
      }
      if (symbol) {
        trades = trades.filter(t => t.symbol === symbol);
      }

      // Sort by signal time descending
      trades.sort((a, b) => b.signalTime.getTime() - a.signalTime.getTime());

      // Pagination
      const limitNum = parseInt(limit as string, 10);
      const offsetNum = parseInt(offset as string, 10);
      const paginated = trades.slice(offsetNum, offsetNum + limitNum);

      res.json({
        trades: paginated,
        total: trades.length,
        limit: limitNum,
        offset: offsetNum,
      });
    } catch (error) {
      console.error('Error fetching trades:', error);
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  /**
   * GET /api/trades/:id
   * Get a single trade by ID
   */
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const trade = repository.getById(req.params.id);
      
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }

      res.json(trade);
    } catch (error) {
      console.error('Error fetching trade:', error);
      res.status(500).json({ error: 'Failed to fetch trade' });
    }
  });

  /**
   * GET /api/trades/state/:state
   * Get trades by state
   */
  router.get('/state/:state', (req: Request, res: Response) => {
    try {
      const state = req.params.state.toUpperCase() as TradeState;
      const validStates: TradeState[] = ['PENDING', 'OPEN', 'CLOSED', 'STOPPED', 'CANCELLED', 'EXPIRED'];
      
      if (!validStates.includes(state)) {
        return res.status(400).json({ error: 'Invalid state' });
      }

      const trades = repository.getByState(state);
      res.json({ trades, count: trades.length });
    } catch (error) {
      console.error('Error fetching trades by state:', error);
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  /**
   * GET /api/trades/pattern/:patternId
   * Get trades by pattern
   */
  router.get('/pattern/:patternId', (req: Request, res: Response) => {
    try {
      const allTrades = repository.getAll();
      const trades = allTrades.filter(t => t.patternId === req.params.patternId);
      res.json({ trades, count: trades.length });
    } catch (error) {
      console.error('Error fetching trades by pattern:', error);
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  return router;
}

