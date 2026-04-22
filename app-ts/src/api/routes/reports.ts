/**
 * API routes for performance reports
 */
import { Router, Request, Response } from 'express';
import { TradeRepository } from '../../db/TradeRepository';
import { ReportGenerator, ReportPeriod } from '../../reports/ReportGenerator';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * GET /reports/generate
 * Generate a performance report
 * Query params:
 *   - period: 'daily' | 'weekly' | 'monthly' | 'custom'
 *   - startDate: ISO date string (optional, required for custom)
 *   - endDate: ISO date string (optional)
 *   - format: 'json' | 'html' (default: json)
 */
router.get('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const repository = req.app.locals.tradeRepository as TradeRepository;
    const initialCapital = req.app.locals.initialCapital as number || 100000;
    
    const period = (req.query.period as ReportPeriod) || 'weekly';
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string) 
      : undefined;
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string) 
      : undefined;
    const format = (req.query.format as string) || 'json';
    
    const generator = new ReportGenerator(repository, initialCapital);
    const report = generator.generateReport(period, startDate, endDate);
    
    if (format === 'html') {
      const html = generator.generateHTML(report);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } else {
      // Convert dates to ISO strings for JSON
      const jsonReport = {
        ...report,
        startDate: report.startDate.toISOString(),
        endDate: report.endDate.toISOString(),
        generatedAt: report.generatedAt.toISOString(),
        equityCurve: report.equityCurve.map(e => ({
          date: e.date.toISOString(),
          equity: e.equity,
        })),
        trades: report.trades.map(t => ({
          ...t,
          signalTime: t.signalTime.toISOString(),
          entryTime: t.entryTime?.toISOString(),
          exitTime: t.exitTime?.toISOString(),
          expiryTime: t.expiryTime.toISOString(),
        })),
      };
      res.json(jsonReport);
    }
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * GET /reports/save
 * Generate and save a report to file
 * Query params:
 *   - period: 'daily' | 'weekly' | 'monthly'
 *   - filename: optional filename (default: auto-generated)
 */
router.get('/save', async (req: Request, res: Response): Promise<void> => {
  try {
    const repository = req.app.locals.tradeRepository as TradeRepository;
    const initialCapital = req.app.locals.initialCapital as number || 100000;
    
    const period = (req.query.period as ReportPeriod) || 'weekly';
    
    const generator = new ReportGenerator(repository, initialCapital);
    const report = generator.generateReport(period);
    
    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = (req.query.filename as string) || `report_${period}_${dateStr}.html`;
    
    // Save to reports directory
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const filePath = path.join(reportsDir, filename);
    generator.saveReport(report, filePath);
    
    res.json({
      success: true,
      message: `Report saved to ${filePath}`,
      path: filePath,
    });
  } catch (error) {
    console.error('Error saving report:', error);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

/**
 * GET /reports/summary
 * Get quick summary metrics without full report
 */
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const repository = req.app.locals.tradeRepository as TradeRepository;
    const initialCapital = req.app.locals.initialCapital as number || 100000;
    
    const period = (req.query.period as ReportPeriod) || 'weekly';
    
    const generator = new ReportGenerator(repository, initialCapital);
    const report = generator.generateReport(period);
    
    // Return only key metrics
    res.json({
      period,
      startDate: report.startDate.toISOString(),
      endDate: report.endDate.toISOString(),
      metrics: {
        totalTrades: report.metrics.totalTrades,
        winRate: report.metrics.winRate,
        totalPnl: report.metrics.totalPnl,
        returnPercent: report.metrics.returnPercent,
        profitFactor: report.metrics.profitFactor,
        maxDrawdownPercent: report.metrics.maxDrawdownPercent,
        expectancy: report.metrics.expectancy,
        currentStreak: report.metrics.currentStreak,
      },
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

export default router;

