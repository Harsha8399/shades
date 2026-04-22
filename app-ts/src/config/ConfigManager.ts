/**
 * Runtime Configuration Manager
 * 
 * Singleton that holds runtime configuration for filters and risk rules.
 * Persists to JSON file and merges with defaults on load.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FilterConfig, DEFAULT_FILTER_CONFIG } from '../core/TradeFilters';
import { DEFAULT_CONFIG, RiskRules } from './default';
import { BrokerId, getBrokerProfile } from './brokers';
import { PresetMode, getPreset, applyPreset } from './presets';

/**
 * Account configuration
 */
export interface AccountConfig {
  initialCapital: number;
  broker: BrokerId;
}

/**
 * Trade execution configuration
 */
export interface TradeConfig {
  slippagePercent: number;
  expiryHours: number;
}

/**
 * Indicator defaults
 */
export interface IndicatorConfig {
  rsiPeriod: number;
  atrPeriod: number;
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
}

/**
 * Runtime configuration structure
 */
export interface RuntimeConfig {
  // UI Mode
  preset: PresetMode;
  
  // Core settings
  account: AccountConfig;
  filters: FilterConfig;
  risk: RiskRules;
  trade: TradeConfig;
  indicators: IndicatorConfig;
  
  // Metadata
  updatedAt: string;
}

/**
 * Default account config
 */
const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  initialCapital: DEFAULT_CONFIG.initialCapital,
  broker: 'ZERODHA',
};

/**
 * Default trade config
 */
const DEFAULT_TRADE_CONFIG: TradeConfig = {
  slippagePercent: DEFAULT_CONFIG.trade.slippagePercent,
  expiryHours: DEFAULT_CONFIG.trade.defaultExpiryHours,
};

/**
 * Default indicator config
 */
const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  rsiPeriod: 14,
  atrPeriod: 14,
  emaFast: 9,
  emaSlow: 21,
  emaTrend: 200,
};

/**
 * Default runtime config
 */
const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  preset: 'MODERATE',
  account: DEFAULT_ACCOUNT_CONFIG,
  filters: DEFAULT_FILTER_CONFIG,
  risk: DEFAULT_CONFIG.riskRules,
  trade: DEFAULT_TRADE_CONFIG,
  indicators: DEFAULT_INDICATOR_CONFIG,
  updatedAt: new Date().toISOString(),
};

/**
 * Configuration Manager - Singleton
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: RuntimeConfig;
  private configPath: string;
  private listeners: Map<string, ((config: RuntimeConfig) => void)[]> = new Map();

  private constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config', 'runtime.json');
    this.config = this.loadConfig();
  }

  /**
   * Get singleton instance
   */
  static getInstance(configPath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configPath);
    }
    return ConfigManager.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    ConfigManager.instance = undefined as any;
  }

  /**
   * Load config from file, merge with defaults
   */
  private loadConfig(): RuntimeConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf-8');
        const savedConfig = JSON.parse(fileContent);
        
        // Merge with defaults to ensure all fields exist
        return {
          preset: savedConfig.preset || DEFAULT_RUNTIME_CONFIG.preset,
          account: { ...DEFAULT_ACCOUNT_CONFIG, ...savedConfig.account },
          filters: { ...DEFAULT_FILTER_CONFIG, ...savedConfig.filters },
          risk: { ...DEFAULT_CONFIG.riskRules, ...savedConfig.risk },
          trade: { ...DEFAULT_TRADE_CONFIG, ...savedConfig.trade },
          indicators: { ...DEFAULT_INDICATOR_CONFIG, ...savedConfig.indicators },
          updatedAt: savedConfig.updatedAt || new Date().toISOString(),
        };
      }
    } catch (error) {
      console.warn('[ConfigManager] Error loading config, using defaults:', error);
    }
    
    return { ...DEFAULT_RUNTIME_CONFIG };
  }

  /**
   * Save config to file
   */
  private saveConfig(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      this.config.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('[ConfigManager] Config saved to', this.configPath);
    } catch (error) {
      console.error('[ConfigManager] Error saving config:', error);
    }
  }

  /**
   * Notify listeners of config changes
   */
  private notifyListeners(key: string): void {
    const keyListeners = this.listeners.get(key) || [];
    const allListeners = this.listeners.get('*') || [];
    
    [...keyListeners, ...allListeners].forEach(listener => {
      try {
        listener(this.config);
      } catch (error) {
        console.error('[ConfigManager] Listener error:', error);
      }
    });
  }

  /**
   * Get current filter configuration
   */
  getFilters(): FilterConfig {
    return { ...this.config.filters };
  }

  /**
   * Update filter configuration
   */
  updateFilters(updates: Partial<FilterConfig>): FilterConfig {
    this.config.filters = { ...this.config.filters, ...updates };
    this.saveConfig();
    this.notifyListeners('filters');
    return this.getFilters();
  }

  /**
   * Reset filters to defaults
   */
  resetFilters(): FilterConfig {
    this.config.filters = { ...DEFAULT_FILTER_CONFIG };
    this.saveConfig();
    this.notifyListeners('filters');
    return this.getFilters();
  }

  /**
   * Get current risk rules
   */
  getRisk(): RiskRules {
    return { ...this.config.risk };
  }

  /**
   * Update risk rules
   */
  updateRisk(updates: Partial<RiskRules>): RiskRules {
    this.config.risk = { ...this.config.risk, ...updates };
    this.saveConfig();
    this.notifyListeners('risk');
    return this.getRisk();
  }

  /**
   * Reset risk rules to defaults
   */
  resetRisk(): RiskRules {
    this.config.risk = { ...DEFAULT_CONFIG.riskRules };
    this.saveConfig();
    this.notifyListeners('risk');
    return this.getRisk();
  }

  /**
   * Get full runtime config
   */
  getFullConfig(): RuntimeConfig {
    return { ...this.config };
  }

  /**
   * Reset all config to defaults
   */
  resetAll(): RuntimeConfig {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, updatedAt: new Date().toISOString() };
    this.saveConfig();
    this.notifyListeners('*');
    return this.getFullConfig();
  }

  /**
   * Reset account to defaults
   */
  resetAccount(): AccountConfig {
    this.config.account = { ...DEFAULT_ACCOUNT_CONFIG };
    this.saveConfig();
    this.notifyListeners('account');
    return this.getAccount();
  }

  /**
   * Reset trade to defaults
   */
  resetTrade(): TradeConfig {
    this.config.trade = { ...DEFAULT_TRADE_CONFIG };
    this.saveConfig();
    this.notifyListeners('trade');
    return this.getTrade();
  }

  /**
   * Reset indicators to defaults
   */
  resetIndicators(): IndicatorConfig {
    this.config.indicators = { ...DEFAULT_INDICATOR_CONFIG };
    this.saveConfig();
    this.notifyListeners('indicators');
    return this.getIndicators();
  }

  /**
   * Subscribe to config changes
   */
  subscribe(key: 'filters' | 'risk' | 'account' | 'trade' | 'indicators' | 'preset' | '*', callback: (config: RuntimeConfig) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key)!.push(callback);
    
    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(key) || [];
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get account configuration
   */
  getAccount(): AccountConfig {
    return { ...this.config.account };
  }

  /**
   * Update account configuration
   */
  updateAccount(updates: Partial<AccountConfig>): AccountConfig {
    this.config.account = { ...this.config.account, ...updates };
    this.saveConfig();
    this.notifyListeners('account');
    return this.getAccount();
  }

  /**
   * Get trade configuration
   */
  getTrade(): TradeConfig {
    return { ...this.config.trade };
  }

  /**
   * Update trade configuration
   */
  updateTrade(updates: Partial<TradeConfig>): TradeConfig {
    this.config.trade = { ...this.config.trade, ...updates };
    this.saveConfig();
    this.notifyListeners('trade');
    return this.getTrade();
  }

  /**
   * Get indicator configuration
   */
  getIndicators(): IndicatorConfig {
    return { ...this.config.indicators };
  }

  /**
   * Update indicator configuration
   */
  updateIndicators(updates: Partial<IndicatorConfig>): IndicatorConfig {
    this.config.indicators = { ...this.config.indicators, ...updates };
    this.saveConfig();
    this.notifyListeners('indicators');
    return this.getIndicators();
  }

  /**
   * Get current preset mode
   */
  getPreset(): PresetMode {
    return this.config.preset;
  }

  /**
   * Apply a preset (updates risk, filters, trade, indicators)
   */
  applyPreset(mode: PresetMode): RuntimeConfig {
    const preset = applyPreset(mode);
    
    this.config.preset = mode;
    this.config.risk = preset.risk;
    this.config.filters = preset.filters;
    this.config.trade = preset.trade;
    this.config.indicators = preset.indicators;
    
    this.saveConfig();
    this.notifyListeners('*');
    return this.getFullConfig();
  }

  /**
   * Get defaults for reference
   */
  getDefaults(): {
    filters: FilterConfig;
    risk: RiskRules;
    account: AccountConfig;
    trade: TradeConfig;
    indicators: IndicatorConfig;
  } {
    return {
      filters: { ...DEFAULT_FILTER_CONFIG },
      risk: { ...DEFAULT_CONFIG.riskRules },
      account: { ...DEFAULT_ACCOUNT_CONFIG },
      trade: { ...DEFAULT_TRADE_CONFIG },
      indicators: { ...DEFAULT_INDICATOR_CONFIG },
    };
  }
}

export default ConfigManager;

