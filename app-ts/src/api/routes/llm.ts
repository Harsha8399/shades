/**
 * LLM Analysis API Routes
 * 
 * Exposes endpoints for AI-powered trading analysis.
 * The LLM acts as an analyst — reviews performance data and provides insights.
 */
import { Router, Request, Response } from 'express';
import { TradeRepository } from '../../db/TradeRepository';
import { LLMService } from '../../llm/LLMService';
import { buildContextFromRepository, buildContextFromStats } from '../../llm/ContextBuilder';
import { AnalysisType, LLMProvider } from '../../llm/types';

const VALID_ANALYSIS_TYPES: AnalysisType[] = [
  'performance_review',
  'pattern_analysis',
  'risk_assessment',
  'strategy_suggestion',
  'trade_review',
  'market_context',
];

const VALID_PROVIDERS: LLMProvider[] = ['ollama', 'deepseek', 'openai', 'openrouter'];

export function createLLMRouter(repository: TradeRepository): Router {
  const router = Router();
  const llmService = LLMService.getInstance();

  /**
   * GET /api/llm/health
   * Check LLM provider availability
   */
  router.get('/health', async (req: Request, res: Response) => {
    try {
      const health = await llmService.checkHealth();
      res.json(health);
    } catch (error) {
      console.error('[LLM API] Health check error:', error);
      res.status(500).json({ error: 'Health check failed' });
    }
  });

  /**
   * GET /api/llm/config
   * Get current LLM configuration (no API keys)
   */
  router.get('/config', (req: Request, res: Response) => {
    try {
      const config = llmService.getActiveConfig();
      res.json({
        activeProvider: llmService.getActiveProvider(),
        config,
        availableTypes: VALID_ANALYSIS_TYPES,
      });
    } catch (error) {
      console.error('[LLM API] Config error:', error);
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  /**
   * PUT /api/llm/config
   * Update LLM provider configuration
   * 
   * Body: { provider?: 'ollama' | 'deepseek' | 'openai' | 'openrouter', model?: string, apiKey?: string, baseUrl?: string }
   */
  router.put('/config', (req: Request, res: Response) => {
    try {
      const { provider, model, apiKey, baseUrl, temperature, maxTokens } = req.body;

      if (provider) {
        if (!VALID_PROVIDERS.includes(provider)) {
          return res.status(400).json({ error: `Invalid provider. Use: ${VALID_PROVIDERS.join(', ')}` });
        }

        // Update config for the provider
        llmService.configure(provider, {
          ...(model && { model }),
          ...(apiKey && { apiKey }),
          ...(baseUrl && { baseUrl }),
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { maxTokens }),
        });

        // Switch to this provider
        llmService.setProvider(provider);
      } else if (model || apiKey || baseUrl || temperature !== undefined || maxTokens !== undefined) {
        // Update current provider's config
        const current = llmService.getActiveProvider();
        llmService.configure(current, {
          ...(model && { model }),
          ...(apiKey && { apiKey }),
          ...(baseUrl && { baseUrl }),
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { maxTokens }),
        });
      }

      res.json({
        activeProvider: llmService.getActiveProvider(),
        config: llmService.getActiveConfig(),
      });
    } catch (error) {
      console.error('[LLM API] Config update error:', error);
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  /**
   * POST /api/llm/analyze
   * Run an AI analysis on trading data
   * 
   * Body: { type: AnalysisType, customPrompt?: string }
   */
  router.post('/analyze', async (req: Request, res: Response) => {
    try {
      const { type, customPrompt } = req.body;

      // Validate type
      if (!type || !VALID_ANALYSIS_TYPES.includes(type)) {
        return res.status(400).json({
          error: `Invalid analysis type. Use: ${VALID_ANALYSIS_TYPES.join(', ')}`,
        });
      }

      // Build context from repository
      const context = buildContextFromRepository(repository, {
        includeRecentTrades: true,
        recentTradeLimit: type === 'trade_review' ? 30 : 15,
        includeDailyPnl: ['performance_review', 'risk_assessment', 'market_context'].includes(type),
        includeEquityCurve: ['performance_review', 'risk_assessment'].includes(type),
      });

      // Quick check: do we have enough data?
      if (!context.stats || context.stats.totalTrades === 0) {
        return res.json({
          id: 'no-data',
          type,
          provider: llmService.getActiveProvider(),
          model: llmService.getActiveConfig().model,
          summary: 'No trading data available. Run some paper trades first, then come back for analysis.',
          strengths: [],
          weaknesses: [],
          recommendations: [
            'Start a paper trading simulation using the CLI.',
            'Run: npx ts-node src/cli/commands.ts simulate -f <data-file> -s <symbol> -t 15m',
          ],
          riskWarnings: [],
          rawResponse: '',
          latencyMs: 0,
          timestamp: new Date(),
        });
      }

      // Run analysis
      const result = await llmService.analyze({
        type: type as AnalysisType,
        context,
        customPrompt,
      });

      res.json(result);
    } catch (error) {
      console.error('[LLM API] Analysis error:', error);
      res.status(500).json({ error: 'Analysis failed. Is the LLM provider running?' });
    }
  });

  /**
   * POST /api/llm/analyze/custom
   * Run a custom analysis with user-provided stats
   * 
   * Body: { type: AnalysisType, stats: {...}, customPrompt?: string }
   */
  router.post('/analyze/custom', async (req: Request, res: Response) => {
    try {
      const { type, stats, customPrompt } = req.body;

      if (!type || !VALID_ANALYSIS_TYPES.includes(type)) {
        return res.status(400).json({
          error: `Invalid analysis type. Use: ${VALID_ANALYSIS_TYPES.join(', ')}`,
        });
      }

      const context = stats ? buildContextFromStats(stats) : buildContextFromRepository(repository);

      const result = await llmService.analyze({
        type: type as AnalysisType,
        context,
        customPrompt,
      });

      res.json(result);
    } catch (error) {
      console.error('[LLM API] Custom analysis error:', error);
      res.status(500).json({ error: 'Analysis failed' });
    }
  });

  /**
   * GET /api/llm/history
   * Get past analysis results
   */
  router.get('/history', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const history = llmService.getHistory(limit);
      res.json({ analyses: history, total: history.length });
    } catch (error) {
      console.error('[LLM API] History error:', error);
      res.status(500).json({ error: 'Failed to get history' });
    }
  });

  /**
   * DELETE /api/llm/history
   * Clear analysis history
   */
  router.delete('/history', (req: Request, res: Response) => {
    try {
      llmService.clearHistory();
      res.json({ message: 'History cleared' });
    } catch (error) {
      console.error('[LLM API] Clear history error:', error);
      res.status(500).json({ error: 'Failed to clear history' });
    }
  });

  return router;
}
