/**
 * Live Scanner API Routes
 * 
 * Controls the live pattern scanner for real-time market analysis.
 */
import { Router, Request, Response } from 'express';
import { LivePatternScanner } from '../../core/LivePatternScanner';
import { TradeRepository } from '../../db/TradeRepository';
import { Timeframe } from '../../types';

export function createLiveScannerRouter(repository: TradeRepository): Router {
  const router = Router();
  const scanner = LivePatternScanner.getInstance();

  const VALID_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
  const MIN_SCAN_INTERVAL_MS = 1000;
  const MAX_SCAN_INTERVAL_MS = 3600000; // 1h

  /**
   * Server-side validation of the scanner fields that can arrive from the
   * (unauthenticated) control endpoints. Only well-formed values pass; the
   * scanner is then configured with the sanitized result.
   */
  function sanitizeScannerConfig(body: any): Partial<import('../../core/LivePatternScanner').ScannerConfig> | Error {
    const out: Partial<import('../../core/LivePatternScanner').ScannerConfig> = {};

    if (body.symbols !== undefined) {
      const symbols = Array.isArray(body.symbols) ? body.symbols : [body.symbols];
      const cleaned = (symbols as any[])
        .filter((s) => typeof s === 'string')
        .map((s: string) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9\-_&]{1,20}$/.test(s));
      if (cleaned.length === 0) {
        return new Error('symbols must be a non-empty array of valid instrument names');
      }
      out.symbols = cleaned.slice(0, 50);
    }

    if (body.timeframes !== undefined) {
      if (!Array.isArray(body.timeframes) || body.timeframes.length === 0) {
        return new Error('timeframes must be a non-empty array');
      }
      const tfs = body.timeframes.filter((t: any) => VALID_TIMEFRAMES.includes(t));
      if (tfs.length === 0) {
        return new Error(`timeframes must be a subset of ${VALID_TIMEFRAMES.join(', ')}`);
      }
      out.timeframes = tfs;
    }

    if (body.scanIntervalMs !== undefined) {
      const ms = Number(body.scanIntervalMs);
      if (!Number.isFinite(ms) || ms < MIN_SCAN_INTERVAL_MS || ms > MAX_SCAN_INTERVAL_MS) {
        return new Error(
          `scanIntervalMs must be between ${MIN_SCAN_INTERVAL_MS} and ${MAX_SCAN_INTERVAL_MS} ms`
        );
      }
      out.scanIntervalMs = Math.round(ms);
    }

    if (body.enablePaperTrading !== undefined) {
      if (typeof body.enablePaperTrading !== 'boolean') {
        return new Error('enablePaperTrading must be a boolean');
      }
      out.enablePaperTrading = body.enablePaperTrading;
    }

    return out;
  }

  /**
   * GET /api/live-scanner/status
   * Get scanner status
   */
  router.get('/status', (req: Request, res: Response) => {
    try {
      res.json({
        isActive: scanner.isActive(),
        config: {
          symbols: scanner['config'].symbols,
          timeframes: scanner['config'].timeframes,
          scanIntervalMs: scanner['config'].scanIntervalMs,
          enablePaperTrading: scanner['config'].enablePaperTrading,
        },
        activeSignals: scanner.getActiveSignals().length,
        lastResults: scanner.getAllResults().length,
      });
    } catch (error) {
      console.error('[LiveScanner API] Status error:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  /**
   * POST /api/live-scanner/start
   * Start the live scanner
   * 
   * Body: { symbols?: string[], timeframes?: string[], minConfluenceFactors?: number, scanIntervalMs?: number, enablePaperTrading?: boolean }
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const updates = sanitizeScannerConfig(req.body ?? {});
      if (updates instanceof Error) {
        return res.status(400).json({ error: updates.message });
      }
      if (Object.keys(updates).length > 0) {
        scanner.configure(updates);
      }

      await scanner.start();

      res.json({ 
        success: true, 
        message: 'Live scanner started',
        status: {
          isActive: scanner.isActive(),
          symbols: scanner['config'].symbols,
          timeframes: scanner['config'].timeframes,
        }
      });
    } catch (error: any) {
      console.error('[LiveScanner API] Start error:', error);
      res.status(500).json({ error: error.message || 'Failed to start scanner' });
    }
  });

  /**
   * POST /api/live-scanner/stop
   * Stop the live scanner
   */
  router.post('/stop', (req: Request, res: Response) => {
    try {
      scanner.stop();
      res.json({ success: true, message: 'Live scanner stopped' });
    } catch (error: any) {
      console.error('[LiveScanner API] Stop error:', error);
      res.status(500).json({ error: 'Failed to stop scanner' });
    }
  });

  /**
   * GET /api/live-scanner/signals
   * Get active signals
   */
  router.get('/signals', (req: Request, res: Response) => {
    try {
      const signals = scanner.getActiveSignals();
      res.json({ signals, count: signals.length });
    } catch (error) {
      console.error('[LiveScanner API] Signals error:', error);
      res.status(500).json({ error: 'Failed to get signals' });
    }
  });

  /**
   * GET /api/live-scanner/results
   * Get all last scan results
   */
  router.get('/results', (req: Request, res: Response) => {
    try {
      const results = scanner.getAllResults();
      res.json({ results, count: results.length });
    } catch (error) {
      console.error('[LiveScanner API] Results error:', error);
      res.status(500).json({ error: 'Failed to get results' });
    }
  });

  /**
   * GET /api/live-scanner/result/:symbol/:timeframe
   * Get last result for specific symbol/timeframe
   */
  router.get('/result/:symbol/:timeframe', (req: Request, res: Response) => {
    try {
      const { symbol, timeframe } = req.params;
      const result = scanner.getLastResult(symbol.toUpperCase(), timeframe as Timeframe);
      
      if (!result) {
        return res.status(404).json({ error: 'No result found' });
      }
      
      res.json(result);
    } catch (error) {
      console.error('[LiveScanner API] Result error:', error);
      res.status(500).json({ error: 'Failed to get result' });
    }
  });

  /**
   * POST /api/live-scanner/configure
   * Update scanner configuration
   */
  router.post('/configure', (req: Request, res: Response) => {
    try {
      const updates = sanitizeScannerConfig(req.body ?? {});
      if (updates instanceof Error) {
        return res.status(400).json({ error: updates.message });
      }
      if (Object.keys(updates).length > 0) {
        scanner.configure(updates);
      }

      res.json({ 
        success: true, 
        config: {
          symbols: scanner['config'].symbols,
          timeframes: scanner['config'].timeframes,
          scanIntervalMs: scanner['config'].scanIntervalMs,
          enablePaperTrading: scanner['config'].enablePaperTrading,
        }
      });
    } catch (error) {
      console.error('[LiveScanner API] Configure error:', error);
      res.status(500).json({ error: 'Failed to configure scanner' });
    }
  });

  /**
   * GET /api/live-scanner/paper-trades
   * Get paper trades from the scanner's paper trading engine
   */
  router.get('/paper-trades', (req: Request, res: Response) => {
    try {
      const paperEngine = scanner.getPaperTradingEngine();
      if (!paperEngine) {
        return res.json({ trades: [], message: 'Paper trading not enabled' });
      }

      // Get trades from the repository
      const trades = paperEngine['repository'].getAll();
      res.json({ trades, count: trades.length });
    } catch (error) {
      console.error('[LiveScanner API] Paper trades error:', error);
      res.status(500).json({ error: 'Failed to get paper trades' });
    }
  });

  /**
   * GET /api/live-scanner/market-data/status
   * Get market data service status
   */
  router.get('/market-data/status', (req: Request, res: Response) => {
    try {
      const marketData = scanner.getMarketDataService();
      res.json({
        isActive: marketData.isActive(),
        subscribedSymbols: Array.from(marketData['subscribedSymbols'] || []),
        subscribedTimeframes: Array.from(marketData['subscribedTimeframes'] || []),
      });
    } catch (error) {
      console.error('[LiveScanner API] Market data status error:', error);
      res.status(500).json({ error: 'Failed to get market data status' });
    }
  });

  /**
   * GET /api/live-scanner/market-data/quote/:symbol
   * Get current quote for a symbol
   */
  router.get('/market-data/quote/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const marketData = scanner.getMarketDataService();
      const quote = await marketData.getQuote(symbol.toUpperCase());
      
      if (!quote) {
        return res.status(404).json({ error: 'Quote not available' });
      }
      
      res.json(quote);
    } catch (error) {
      console.error('[LiveScanner API] Quote error:', error);
      res.status(500).json({ error: 'Failed to get quote' });
    }
  });

  /**
   * GET /api/live-scanner/market-data/historical/:symbol
   * Get historical data for a symbol
   */
  router.get('/market-data/historical/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const timeframe = (req.query.timeframe as Timeframe) || '1h';
      const days = parseInt(req.query.days as string) || 30;
      
      const marketData = scanner.getMarketDataService();
      const candles = await marketData.getHistoricalData(symbol.toUpperCase(), timeframe, days);
      
      res.json({ symbol: symbol.toUpperCase(), timeframe, candles, count: candles.length });
    } catch (error: any) {
      console.error('[LiveScanner API] Historical data error:', error);
      res.status(500).json({ error: error.message || 'Failed to get historical data' });
    }
  });

  return router;
}