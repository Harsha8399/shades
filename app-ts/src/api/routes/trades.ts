/**
 * Trades API Routes
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TradeRepository } from '../../db/TradeRepository';
import { Trade, TradeState } from '../../types';

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
   * POST /api/trades
   * Create a manual paper trade
   * 
   * Body: { symbol, direction, entryPrice, stopLoss, target, quantity, timeframe?, patternName?, notes? }
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const {
        symbol,
        direction,
        entryPrice,
        stopLoss,
        target,
        quantity,
        timeframe = '15m',
        patternName = 'Manual Trade',
        notes = '',
      } = req.body;

      // Validate required fields
      if (!symbol || !direction || !entryPrice || !stopLoss || !target || !quantity) {
        return res.status(400).json({
          error: 'Required fields: symbol, direction, entryPrice, stopLoss, target, quantity',
        });
      }

      if (!['LONG', 'SHORT'].includes(direction)) {
        return res.status(400).json({ error: 'direction must be LONG or SHORT' });
      }

      if (entryPrice <= 0 || stopLoss <= 0 || target <= 0 || quantity <= 0) {
        return res.status(400).json({ error: 'Price values and quantity must be positive' });
      }

      // Calculate risk
      const riskPerShare = Math.abs(entryPrice - stopLoss);
      const riskAmount = riskPerShare * quantity;
      const riskPercent = (riskPerShare / entryPrice) * 100;

      const now = new Date();
      const trade: Trade = {
        id: uuidv4(),
        patternId: `manual_${Date.now()}`,
        patternName,
        symbol: symbol.toUpperCase(),
        timeframe: timeframe as Trade['timeframe'],
        direction: direction as Trade['direction'],
        executionType: 'SPOT',
        state: 'OPEN',
        stateHistory: [
          { from: null, to: 'PENDING', timestamp: now, reason: 'Manual trade created', price: entryPrice },
          { from: 'PENDING', to: 'OPEN', timestamp: now, reason: 'Manual entry', price: entryPrice },
        ],
        signalPrice: entryPrice,
        entryPrice,
        initialStopLoss: stopLoss,
        currentStopLoss: stopLoss,
        target,
        exitPrice: null,
        quantity,
        remainingQuantity: quantity,
        riskAmount,
        riskPercent,
        partialExits: [],
        realizedPnl: 0,
        unrealizedPnl: 0,
        signalTime: now,
        entryTime: now,
        exitTime: null,
        expiryTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
        pnl: null,
        pnlPercent: null,
        rMultiple: null,
        averageExitPrice: null,
        confluenceFactors: ['Manual Entry'],
        notes: notes ? [notes] : [],
        tags: ['manual'],
      };

      repository.save(trade);
      console.log(`[Trades] Manual trade created: ${direction} ${symbol} @ ${entryPrice}`);

      res.status(201).json(trade);
    } catch (error) {
      console.error('Error creating trade:', error);
      res.status(500).json({ error: 'Failed to create trade' });
    }
  });

  /**
   * PUT /api/trades/:id/close
   * Close or stop-out a trade manually
   * 
   * Body: { exitPrice, reason? }
   */
  router.put('/:id/close', (req: Request, res: Response) => {
    try {
      const trade = repository.getById(req.params.id);
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }

      if (trade.state !== 'OPEN' && trade.state !== 'PENDING') {
        return res.status(400).json({ error: `Cannot close trade in state: ${trade.state}` });
      }

      const { exitPrice, reason = 'Manual close' } = req.body;
      if (!exitPrice || exitPrice <= 0) {
        return res.status(400).json({ error: 'exitPrice is required and must be positive' });
      }

      const now = new Date();

      // Determine if profit or loss
      let pnl: number;
      if (trade.direction === 'LONG') {
        pnl = (exitPrice - (trade.entryPrice || trade.signalPrice)) * trade.quantity;
      } else {
        pnl = ((trade.entryPrice || trade.signalPrice) - exitPrice) * trade.quantity;
      }

      const entryP = trade.entryPrice || trade.signalPrice;
      const pnlPercent = (pnl / (entryP * trade.quantity)) * 100;
      const riskPerShare = Math.abs(entryP - trade.initialStopLoss);
      const rMultiple = riskPerShare > 0 ? pnl / (riskPerShare * trade.quantity) : 0;

      // Determine new state based on P&L
      const newState: TradeState = pnl >= 0 ? 'CLOSED' : 'STOPPED';

      trade.state = newState;
      trade.exitPrice = exitPrice;
      trade.exitTime = now;
      trade.pnl = pnl;
      trade.pnlPercent = pnlPercent;
      trade.rMultiple = rMultiple;
      trade.averageExitPrice = exitPrice;
      trade.stateHistory.push({
        from: 'OPEN',
        to: newState,
        timestamp: now,
        reason,
        price: exitPrice,
      });

      repository.save(trade);
      console.log(`[Trades] Trade ${trade.id.slice(0, 8)} closed @ ${exitPrice} — P&L: ₹${pnl.toFixed(2)}`);

      res.json(trade);
    } catch (error) {
      console.error('Error closing trade:', error);
      res.status(500).json({ error: 'Failed to close trade' });
    }
  });

  /**
   * DELETE /api/trades/:id
   * Delete a trade
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const trade = repository.getById(req.params.id);
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }

      repository.delete(req.params.id);
      console.log(`[Trades] Trade ${req.params.id.slice(0, 8)} deleted`);

      res.json({ message: 'Trade deleted' });
    } catch (error) {
      console.error('Error deleting trade:', error);
      res.status(500).json({ error: 'Failed to delete trade' });
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

