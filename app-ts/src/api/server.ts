/**
 * Express API Server for the Trading Dashboard
 */
import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { TradeRepository } from '../db/TradeRepository';
import { DatabaseConnection } from '../db/Database';
import { PatternRegistry } from '../core/PatternRegistry';

// Import routes
import { createTradesRouter } from './routes/trades';
import { createStatsRouter } from './routes/stats';
import { createPatternsRouter } from './routes/patterns';
import reportsRouter from './routes/reports';
import notificationsRouter from './routes/notifications';
import configRouter from './routes/config';
import { createLLMRouter } from './routes/llm';
import { createSimulationRouter } from './routes/simulation';
import { createInstrumentsRouter } from './routes/instruments';
import { createLiveScannerRouter } from './routes/liveScanner';
import { createReplayRouter } from './routes/replay';
import { createNiftyDownloadRouter } from './routes/replay';
import { DEFAULT_CONFIG } from '../config/default';

export interface ApiServerConfig {
  port: number;
  dbPath: string;
}

export class ApiServer {
  private app: Express;
  private db: DatabaseConnection;
  private repository: TradeRepository;
  private registry: PatternRegistry;
  private config: ApiServerConfig;

  constructor(config: Partial<ApiServerConfig> = {}) {
    this.config = {
      port: config.port || 3001,
      dbPath: config.dbPath || './data/trades.db',
    };

    this.app = express();
    this.db = DatabaseConnection.getInstance(this.config.dbPath);
    this.repository = new TradeRepository(this.db);
    this.registry = PatternRegistry.getInstance();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // CORS for frontend
    this.app.use(cors({
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    }));

    // JSON parsing
    this.app.use(express.json());

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Store shared resources in app.locals for route access
    this.app.locals.tradeRepository = this.repository;
    this.app.locals.initialCapital = DEFAULT_CONFIG.initialCapital;
    
    // Health check
    this.app.get('/api/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Mount routers
    this.app.use('/api/trades', createTradesRouter(this.repository));
    this.app.use('/api/stats', createStatsRouter(this.repository));
    this.app.use('/api/patterns', createPatternsRouter(this.registry, this.repository));
    this.app.use('/api/reports', reportsRouter);
    this.app.use('/api/notifications', notificationsRouter);
    this.app.use('/api/config', configRouter);
    this.app.use('/api/llm', createLLMRouter(this.repository));
    this.app.use('/api/simulation', createSimulationRouter(this.repository));
    this.app.use('/api/instruments', createInstrumentsRouter(this.repository));
    this.app.use('/api/live-scanner', createLiveScannerRouter(this.repository));
    this.app.use('/api/replay', createReplayRouter());
    this.app.use('/api/replay/nifty', createNiftyDownloadRouter());
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      console.error('[API Error]', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  public start(): void {
    this.app.listen(this.config.port, () => {
      console.log(`[API] Server running on http://localhost:${this.config.port}`);
      console.log(`[API] Database: ${this.config.dbPath}`);
    });
  }

  public getApp(): Express {
    return this.app;
  }
}

// CLI entry point
if (require.main === module) {
  const server = new ApiServer({
    port: parseInt(process.env.PORT || '3001', 10),
    dbPath: process.env.DB_PATH || './data/trades.db',
  });
  server.start();
}

