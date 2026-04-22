/**
 * Instrument Selector for F&O Trading
 * 
 * Handles mapping of spot symbols to Futures and Options instruments.
 * Provides expiry calculation, strike selection, and premium estimation.
 */
import { Direction } from '../types';
import { NSE_LOT_SIZES } from '../config/indianMarket';

/**
 * Execution type for trading
 */
export type ExecutionType = 
  | 'SPOT' 
  | 'FUTURES' 
  | 'OPTIONS_BUY_CE' 
  | 'OPTIONS_BUY_PE' 
  | 'OPTIONS_SELL_CE' 
  | 'OPTIONS_SELL_PE';

/**
 * Simplified execution type for strategy config
 */
export type StrategyExecutionType = 
  | 'SPOT' 
  | 'FUTURES' 
  | 'OPTIONS_BUY_ATM' 
  | 'OPTIONS_SELL_ATM';

/**
 * Option type
 */
export type OptionType = 'CE' | 'PE';

/**
 * F&O Instrument details
 */
export interface FnOInstrument {
  symbol: string;           // NIFTY24JAN22450CE or NIFTY24JANFUT
  underlying: string;       // NIFTY
  instrumentType: 'FUTURE' | 'CE' | 'PE';
  expiry: Date;
  expiryString: string;     // "24JAN" format
  strike?: number;          // For options
  lotSize: number;
  premium: number;          // Futures premium or option price
  delta?: number;           // For options (0.5 for ATM)
}

/**
 * Execution configuration from strategy
 */
export interface ExecutionConfig {
  type: StrategyExecutionType;
  optionType?: 'CE' | 'PE' | 'AUTO';  // AUTO = CE for LONG, PE for SHORT
  futuresPremiumPercent?: number;      // Default 0.5%
  optionDelta?: number;                // Default 0.5 for ATM
}

/**
 * Default execution config
 */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  type: 'SPOT',
  optionType: 'AUTO',
  futuresPremiumPercent: 0.5,
  optionDelta: 0.5,
};

/**
 * F&O configuration for different underlyings
 */
export interface FnOConfig {
  strikeInterval: number;
  weeklyExpiry: boolean;
  lotSize: number;
}

/**
 * F&O configuration by underlying
 */
export const FNO_CONFIG: Record<string, FnOConfig> = {
  'NIFTY': { strikeInterval: 50, weeklyExpiry: true, lotSize: 50 },
  'BANKNIFTY': { strikeInterval: 100, weeklyExpiry: true, lotSize: 15 },
  'FINNIFTY': { strikeInterval: 50, weeklyExpiry: true, lotSize: 40 },
  'RELIANCE': { strikeInterval: 20, weeklyExpiry: false, lotSize: 250 },
  'TCS': { strikeInterval: 50, weeklyExpiry: false, lotSize: 150 },
  'INFY': { strikeInterval: 20, weeklyExpiry: false, lotSize: 300 },
  'HDFCBANK': { strikeInterval: 20, weeklyExpiry: false, lotSize: 550 },
  'ICICIBANK': { strikeInterval: 20, weeklyExpiry: false, lotSize: 700 },
  'SBIN': { strikeInterval: 10, weeklyExpiry: false, lotSize: 1500 },
  'BHARTIARTL': { strikeInterval: 20, weeklyExpiry: false, lotSize: 950 },
  'ITC': { strikeInterval: 5, weeklyExpiry: false, lotSize: 1600 },
  'KOTAKBANK': { strikeInterval: 20, weeklyExpiry: false, lotSize: 400 },
  'LT': { strikeInterval: 50, weeklyExpiry: false, lotSize: 150 },
  'HINDUNILVR': { strikeInterval: 50, weeklyExpiry: false, lotSize: 300 },
  'AXISBANK': { strikeInterval: 20, weeklyExpiry: false, lotSize: 600 },
  'MARUTI': { strikeInterval: 100, weeklyExpiry: false, lotSize: 100 },
  'TATAMOTORS': { strikeInterval: 20, weeklyExpiry: false, lotSize: 1425 },
  'BAJFINANCE': { strikeInterval: 100, weeklyExpiry: false, lotSize: 125 },
  'TITAN': { strikeInterval: 50, weeklyExpiry: false, lotSize: 175 },
};

/**
 * Month codes for F&O symbols
 */
const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Instrument Selector class
 */
export class InstrumentSelector {
  
  /**
   * Get F&O config for an underlying
   */
  static getConfig(underlying: string): FnOConfig {
    const config = FNO_CONFIG[underlying.toUpperCase()];
    if (config) return config;
    
    // Default config for unknown stocks
    const lotSize = NSE_LOT_SIZES[underlying.toUpperCase()] || 100;
    return {
      strikeInterval: 10,
      weeklyExpiry: false,
      lotSize,
    };
  }
  
  /**
   * Get current month expiry date (last Thursday of the month)
   */
  static getCurrentMonthExpiry(referenceDate?: Date): Date {
    const date = referenceDate || new Date();
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // Find last Thursday of the month
    const lastDay = new Date(year, month + 1, 0); // Last day of month
    const lastDayOfWeek = lastDay.getDay();
    
    // Thursday is 4
    let daysToSubtract = (lastDayOfWeek + 7 - 4) % 7;
    if (daysToSubtract === 0 && lastDayOfWeek !== 4) {
      daysToSubtract = 7;
    }
    
    const expiryDate = new Date(year, month + 1, 0 - daysToSubtract);
    
    // If current date is past expiry, get next month's expiry
    if (date > expiryDate) {
      return this.getCurrentMonthExpiry(new Date(year, month + 1, 15));
    }
    
    return expiryDate;
  }
  
  /**
   * Get expiry string in format "24JAN"
   */
  static getExpiryString(expiryDate: Date): string {
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = MONTH_CODES[expiryDate.getMonth()];
    return `${year}${month}`;
  }
  
  /**
   * Get ATM strike price rounded to nearest valid strike
   */
  static getATMStrike(spotPrice: number, strikeInterval: number): number {
    return Math.round(spotPrice / strikeInterval) * strikeInterval;
  }
  
  /**
   * Calculate futures premium (spot + premium %)
   */
  static calculateFuturesPremium(spotPrice: number, premiumPercent: number = 0.5): number {
    return spotPrice * (1 + premiumPercent / 100);
  }
  
  /**
   * Estimate option price using simple approximation
   * For ATM options: uses time value + intrinsic value
   */
  static estimateOptionPrice(
    spotPrice: number,
    strike: number,
    optionType: OptionType,
    daysToExpiry: number,
    volatility: number = 0.2 // 20% annualized
  ): { price: number; delta: number } {
    // Intrinsic value
    let intrinsic = 0;
    if (optionType === 'CE') {
      intrinsic = Math.max(0, spotPrice - strike);
    } else {
      intrinsic = Math.max(0, strike - spotPrice);
    }
    
    // Time value approximation (simplified)
    // Using ATR-based approximation: time_value = spot * volatility * sqrt(time)
    const timeYears = daysToExpiry / 365;
    const timeValue = spotPrice * volatility * Math.sqrt(timeYears) * 0.4; // Simplified
    
    const price = intrinsic + timeValue;
    
    // Delta approximation for ATM options
    // ATM options have delta ~0.5, ITM approaches 1, OTM approaches 0
    const moneyness = (spotPrice - strike) / strike;
    let delta: number;
    
    if (optionType === 'CE') {
      if (Math.abs(moneyness) < 0.02) {
        delta = 0.5; // ATM
      } else if (moneyness > 0) {
        delta = 0.5 + (moneyness * 5); // ITM, approaches 1
        delta = Math.min(delta, 0.95);
      } else {
        delta = 0.5 + (moneyness * 5); // OTM, approaches 0
        delta = Math.max(delta, 0.05);
      }
    } else {
      // Put delta is negative
      if (Math.abs(moneyness) < 0.02) {
        delta = -0.5; // ATM
      } else if (moneyness < 0) {
        delta = -0.5 - (Math.abs(moneyness) * 5); // ITM put
        delta = Math.max(delta, -0.95);
      } else {
        delta = -0.5 + (moneyness * 5); // OTM put
        delta = Math.min(delta, -0.05);
      }
    }
    
    return { price: Math.max(price, 0.05), delta };
  }
  
  /**
   * Get days to expiry
   */
  static getDaysToExpiry(expiryDate: Date, currentDate?: Date): number {
    const now = currentDate || new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }
  
  /**
   * Select futures instrument for an underlying
   */
  static selectFutures(
    underlying: string,
    spotPrice: number,
    premiumPercent: number = 0.5,
    referenceDate?: Date
  ): FnOInstrument {
    const config = this.getConfig(underlying);
    const expiry = this.getCurrentMonthExpiry(referenceDate);
    const expiryString = this.getExpiryString(expiry);
    const premium = this.calculateFuturesPremium(spotPrice, premiumPercent);
    
    return {
      symbol: `${underlying.toUpperCase()}${expiryString}FUT`,
      underlying: underlying.toUpperCase(),
      instrumentType: 'FUTURE',
      expiry,
      expiryString,
      lotSize: config.lotSize,
      premium,
    };
  }
  
  /**
   * Select ATM option for an underlying
   */
  static selectATMOption(
    underlying: string,
    spotPrice: number,
    optionType: OptionType,
    referenceDate?: Date,
    volatility?: number
  ): FnOInstrument {
    const config = this.getConfig(underlying);
    const expiry = this.getCurrentMonthExpiry(referenceDate);
    const expiryString = this.getExpiryString(expiry);
    const strike = this.getATMStrike(spotPrice, config.strikeInterval);
    const daysToExpiry = this.getDaysToExpiry(expiry, referenceDate);
    const { price, delta } = this.estimateOptionPrice(spotPrice, strike, optionType, daysToExpiry, volatility);
    
    return {
      symbol: `${underlying.toUpperCase()}${expiryString}${strike}${optionType}`,
      underlying: underlying.toUpperCase(),
      instrumentType: optionType,
      expiry,
      expiryString,
      strike,
      lotSize: config.lotSize,
      premium: price,
      delta: Math.abs(delta), // Store absolute delta
    };
  }
  
  /**
   * Select instrument based on execution config and signal
   */
  static selectInstrument(
    underlying: string,
    spotPrice: number,
    direction: Direction,
    executionConfig: ExecutionConfig = DEFAULT_EXECUTION_CONFIG,
    referenceDate?: Date
  ): FnOInstrument | null {
    switch (executionConfig.type) {
      case 'SPOT':
        // Return null for spot - no F&O instrument needed
        return null;
        
      case 'FUTURES':
        return this.selectFutures(
          underlying,
          spotPrice,
          executionConfig.futuresPremiumPercent || 0.5,
          referenceDate
        );
        
      case 'OPTIONS_BUY_ATM':
      case 'OPTIONS_SELL_ATM': {
        // Determine option type
        let optionType: OptionType;
        if (executionConfig.optionType === 'AUTO' || !executionConfig.optionType) {
          // AUTO: CE for LONG signal, PE for SHORT signal
          optionType = direction === 'LONG' ? 'CE' : 'PE';
        } else {
          optionType = executionConfig.optionType;
        }
        
        return this.selectATMOption(
          underlying,
          spotPrice,
          optionType,
          referenceDate
        );
      }
        
      default:
        return null;
    }
  }
  
  /**
   * Determine if execution type is an option
   */
  static isOption(executionType: StrategyExecutionType): boolean {
    return executionType === 'OPTIONS_BUY_ATM' || executionType === 'OPTIONS_SELL_ATM';
  }
  
  /**
   * Determine if execution type is a buy (long position on the derivative)
   */
  static isBuyPosition(executionType: StrategyExecutionType): boolean {
    return executionType === 'FUTURES' || executionType === 'OPTIONS_BUY_ATM';
  }
}

export default InstrumentSelector;

