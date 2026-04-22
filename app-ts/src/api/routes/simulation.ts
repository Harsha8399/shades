/**
 * Simulation API Routes
 * 
 * Run paper trading simulations from the dashboard UI.
 * Lists available data files, runs simulations, and returns results.
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { TradeRepository } from '../../db/TradeRepository';
import { PatternEngine } from '../../core/PatternEngine';
import { PaperTradingEngine } from '../../core/PaperTradingEngine';
import { LiveMonitor } from '../../core/LiveMonitor';
import { registerAllPatterns } from '../../patterns';
import { Timeframe } from '../../types';

// Track running simulations
interface SimulationStatus {
  id: string;
  status: 'running' | 'completed' | 'error';
  symbol: string;
  timeframe: string;
  startedAt: Date;
  completedAt?: Date;
  tradesGenerated?: number;
  candlesProcessed?: number;
  error?: string;
}

const simulations: Map<string, SimulationStatus> = new Map();
let patternsRegistered = false;

function ensurePatternsRegistered() {
  if (!patternsRegistered) {
    registerAllPatterns();
    patternsRegistered = true;
  }
}

export function createSimulationRouter(repository: TradeRepository): Router {
  const router = Router();

  /**
   * GET /api/simulation/data-files
   * List available CSV data files
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
      console.error('[Simulation API] Error listing files:', error);
      res.status(500).json({ error: 'Failed to list data files' });
    }
  });

  /**
   * POST /api/simulation/run
   * Run a paper trading simulation on CSV data
   * 
   * Body: { filePath: string, symbol: string, timeframe: string, filters?: boolean, looseFilters?: boolean }
   */
  router.post('/run', async (req: Request, res: Response) => {
    try {
      const { filePath, symbol, timeframe = '1h', filters = true, looseFilters = false } = req.body;

      if (!filePath || !symbol) {
        return res.status(400).json({ error: 'filePath and symbol are required' });
      }

      // Validate file exists
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: `File not found: ${filePath}` });
      }

      // Validate timeframe
      const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({ error: `Invalid timeframe. Use: ${validTimeframes.join(', ')}` });
      }

      ensurePatternsRegistered();

      const simId = `sim_${Date.now()}`;
      const status: SimulationStatus = {
        id: simId,
        status: 'running',
        symbol,
        timeframe,
        startedAt: new Date(),
      };
      simulations.set(simId, status);

      // Run simulation (synchronous but fast for CSV)
      try {
        // Configure filters
        let filterConfig = {};
        let useFilters = filters;

        if (looseFilters) {
          filterConfig = {
            useStructure: false,
            useRegime: false,
            useMTF: false,
            useVolume: false,
          };
        }

        const patternEngine = new PatternEngine(undefined, filterConfig, useFilters);
        const paperTrading = new PaperTradingEngine();

        const monitor = new LiveMonitor(
          { symbol, timeframe: timeframe as Timeframe },
          patternEngine,
          paperTrading
        );

        monitor.loadFromCSV(filePath);
        monitor.runSimulation(0);

        // Get generated trades
        const trades = repository.getAll();
        const recentTrades = trades.filter(t => {
          const signalTime = t.signalTime.getTime();
          return signalTime >= status.startedAt.getTime() - 1000; // within 1 second
        });

        status.status = 'completed';
        status.completedAt = new Date();
        status.tradesGenerated = recentTrades.length;

        res.json({
          id: simId,
          status: 'completed',
          tradesGenerated: recentTrades.length,
          symbol,
          timeframe,
          filePath,
          duration: status.completedAt.getTime() - status.startedAt.getTime(),
        });
      } catch (err: any) {
        status.status = 'error';
        status.error = err.message;
        res.status(500).json({
          id: simId,
          status: 'error',
          error: err.message,
        });
      }
    } catch (error: any) {
      console.error('[Simulation API] Error:', error);
      res.status(500).json({ error: 'Simulation failed' });
    }
  });

  /**
   * GET /api/simulation/status
   * Get status of all simulations
   */
  router.get('/status', (req: Request, res: Response) => {
    const all = Array.from(simulations.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, 20);
    res.json({ simulations: all });
  });

  /**
   * GET /api/simulation/status/:id
   * Get status of a specific simulation
   */
  router.get('/status/:id', (req: Request, res: Response) => {
    const sim = simulations.get(req.params.id);
    if (!sim) {
      return res.status(404).json({ error: 'Simulation not found' });
    }
    res.json(sim);
  });

  return router;
}
