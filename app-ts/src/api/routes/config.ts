/**
 * Configuration API Routes
 * 
 * Exposes filter and risk configuration for frontend control.
 */
import { Router, Request, Response } from 'express';
import { ConfigManager } from '../../config/ConfigManager';
import { FilterConfig, DEFAULT_FILTER_CONFIG } from '../../core/TradeFilters';
import { RiskRules, DEFAULT_CONFIG } from '../../config/default';
import { BrokerId, BROKER_PROFILES } from '../../config/brokers';
import { PresetMode, PRESETS } from '../../config/presets';

const router = Router();
const configManager = ConfigManager.getInstance();

/**
 * GET /api/config/filters
 * Get current filter configuration
 */
router.get('/filters', (req: Request, res: Response) => {
  try {
    const filters = configManager.getFilters();
    res.json({
      success: true,
      data: filters,
      defaults: DEFAULT_FILTER_CONFIG,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/config/filters
 * Update filter configuration
 */
router.put('/filters', (req: Request, res: Response) => {
  try {
    const updates: Partial<FilterConfig> = req.body;
    
    // Validate boolean fields
    const booleanFields = [
      'useStructure', 'useRegime', 'useMTF', 'useVolume',
      'requireBullishStructureForLong', 'requireBearishStructureForShort',
      'skipRangingRegime', 'requireHTFAlignment', 'skipLowVolume'
    ];
    
    for (const field of booleanFields) {
      if (field in updates && typeof (updates as any)[field] !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: `${field} must be a boolean`,
        });
      }
    }
    
    // Validate number fields
    const numberFields = ['minVolumeRatio', 'minHTFStrength'];
    for (const field of numberFields) {
      if (field in updates) {
        const value = (updates as any)[field];
        if (typeof value !== 'number' || value < 0 || value > 1) {
          return res.status(400).json({
            success: false,
            error: `${field} must be a number between 0 and 1`,
          });
        }
      }
    }
    
    const newFilters = configManager.updateFilters(updates);
    res.json({
      success: true,
      data: newFilters,
      message: 'Filters updated successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/filters/reset
 * Reset filters to defaults
 */
router.post('/filters/reset', (req: Request, res: Response) => {
  try {
    const filters = configManager.resetFilters();
    res.json({
      success: true,
      data: filters,
      message: 'Filters reset to defaults',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/config/risk
 * Get current risk rules
 */
router.get('/risk', (req: Request, res: Response) => {
  try {
    const risk = configManager.getRisk();
    res.json({
      success: true,
      data: risk,
      defaults: DEFAULT_CONFIG.riskRules,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/config/risk
 * Update risk rules
 */
router.put('/risk', (req: Request, res: Response) => {
  try {
    const updates: Partial<RiskRules> = req.body;
    
    // Validate fields
    if ('maxRiskPerTrade' in updates) {
      const value = updates.maxRiskPerTrade!;
      if (typeof value !== 'number' || value <= 0 || value > 0.1) {
        return res.status(400).json({
          success: false,
          error: 'maxRiskPerTrade must be between 0 and 0.1 (10%)',
        });
      }
    }
    
    if ('maxOpenTrades' in updates) {
      const value = updates.maxOpenTrades!;
      if (!Number.isInteger(value) || value < 1 || value > 50) {
        return res.status(400).json({
          success: false,
          error: 'maxOpenTrades must be an integer between 1 and 50',
        });
      }
    }
    
    if ('maxDailyTrades' in updates) {
      const value = updates.maxDailyTrades!;
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        return res.status(400).json({
          success: false,
          error: 'maxDailyTrades must be an integer between 1 and 100',
        });
      }
    }
    
    if ('minRiskReward' in updates) {
      const value = updates.minRiskReward!;
      if (typeof value !== 'number' || value < 0.5 || value > 10) {
        return res.status(400).json({
          success: false,
          error: 'minRiskReward must be between 0.5 and 10',
        });
      }
    }
    
    const newRisk = configManager.updateRisk(updates);
    res.json({
      success: true,
      data: newRisk,
      message: 'Risk rules updated successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/risk/reset
 * Reset risk rules to defaults
 */
router.post('/risk/reset', (req: Request, res: Response) => {
  try {
    const risk = configManager.resetRisk();
    res.json({
      success: true,
      data: risk,
      message: 'Risk rules reset to defaults',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/config
 * Get full configuration
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const config = configManager.getFullConfig();
    const defaults = configManager.getDefaults();
    res.json({
      success: true,
      data: config,
      defaults,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/reset
 * Reset all configuration to defaults
 */
router.post('/reset', (req: Request, res: Response) => {
  try {
    const config = configManager.resetAll();
    res.json({
      success: true,
      data: config,
      message: 'All configuration reset to defaults',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/config/account
 * Get account configuration
 */
router.get('/account', (req: Request, res: Response) => {
  try {
    const account = configManager.getAccount();
    const defaults = configManager.getDefaults();
    res.json({
      success: true,
      data: account,
      defaults: defaults.account,
      brokers: BROKER_PROFILES,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/config/account
 * Update account configuration
 */
router.put('/account', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    
    // Validate initialCapital
    if ('initialCapital' in updates) {
      const value = updates.initialCapital;
      if (typeof value !== 'number' || value < 1000 || value > 100000000) {
        return res.status(400).json({
          success: false,
          error: 'initialCapital must be between 1,000 and 100,000,000',
        });
      }
    }
    
    // Validate broker
    if ('broker' in updates) {
      const broker = updates.broker;
      if (!Object.keys(BROKER_PROFILES).includes(broker)) {
        return res.status(400).json({
          success: false,
          error: `Invalid broker. Must be one of: ${Object.keys(BROKER_PROFILES).join(', ')}`,
        });
      }
    }
    
    const newAccount = configManager.updateAccount(updates);
    res.json({
      success: true,
      data: newAccount,
      message: 'Account configuration updated successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/account/reset
 * Reset account to defaults
 */
router.post('/account/reset', (req: Request, res: Response) => {
  try {
    const account = configManager.resetAccount();
    res.json({
      success: true,
      data: account,
      message: 'Account configuration reset to defaults',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/config/trade
 * Get trade execution configuration
 */
router.get('/trade', (req: Request, res: Response) => {
  try {
    const trade = configManager.getTrade();
    const defaults = configManager.getDefaults();
    res.json({
      success: true,
      data: trade,
      defaults: defaults.trade,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/config/trade
 * Update trade execution configuration
 */
router.put('/trade', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    
    // Validate slippagePercent
    if ('slippagePercent' in updates) {
      const value = updates.slippagePercent;
      if (typeof value !== 'number' || value < 0 || value > 0.01) {
        return res.status(400).json({
          success: false,
          error: 'slippagePercent must be between 0 and 0.01 (1%)',
        });
      }
    }
    
    // Validate expiryHours
    if ('expiryHours' in updates) {
      const value = updates.expiryHours;
      if (!Number.isInteger(value) || value < 1 || value > 168) {
        return res.status(400).json({
          success: false,
          error: 'expiryHours must be an integer between 1 and 168 (1 week)',
        });
      }
    }
    
    const newTrade = configManager.updateTrade(updates);
    res.json({
      success: true,
      data: newTrade,
      message: 'Trade configuration updated successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/trade/reset
 * Reset trade to defaults
 */
router.post('/trade/reset', (req: Request, res: Response) => {
  try {
    const trade = configManager.resetTrade();
    res.json({
      success: true,
      data: trade,
      message: 'Trade configuration reset to defaults',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/config/indicators
 * Get indicator defaults
 */
router.get('/indicators', (req: Request, res: Response) => {
  try {
    const indicators = configManager.getIndicators();
    const defaults = configManager.getDefaults();
    res.json({
      success: true,
      data: indicators,
      defaults: defaults.indicators,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/config/indicators
 * Update indicator defaults
 */
router.put('/indicators', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    
    // Validate all period fields
    const periodFields = ['rsiPeriod', 'atrPeriod', 'emaFast', 'emaSlow', 'emaTrend'];
    for (const field of periodFields) {
      if (field in updates) {
        const value = updates[field];
        if (!Number.isInteger(value) || value < 1 || value > 500) {
          return res.status(400).json({
            success: false,
            error: `${field} must be an integer between 1 and 500`,
          });
        }
      }
    }
    
    const newIndicators = configManager.updateIndicators(updates);
    res.json({
      success: true,
      data: newIndicators,
      message: 'Indicator configuration updated successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/indicators/reset
 * Reset indicators to defaults
 */
router.post('/indicators/reset', (req: Request, res: Response) => {
  try {
    const indicators = configManager.resetIndicators();
    res.json({
      success: true,
      data: indicators,
      message: 'Indicator configuration reset to defaults',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/config/presets
 * Get available presets and current preset
 */
router.get('/presets', (req: Request, res: Response) => {
  try {
    const currentPreset = configManager.getPreset();
    res.json({
      success: true,
      data: {
        current: currentPreset,
        available: PRESETS,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/config/presets/apply
 * Apply a preset (updates risk, filters, trade, indicators)
 */
router.post('/presets/apply', (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !Object.keys(PRESETS).includes(mode)) {
      return res.status(400).json({
        success: false,
        error: `Invalid preset mode. Must be one of: ${Object.keys(PRESETS).join(', ')}`,
      });
    }
    
    const config = configManager.applyPreset(mode as PresetMode);
    res.json({
      success: true,
      data: config,
      message: `Preset "${mode}" applied successfully`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

