/**
 * Indian Market Configuration
 * 
 * Fee structure for NSE (Equity) and MCX (Commodities) trading
 */

/**
 * Market segment type
 */
export type MarketSegment = 'NSE_EQUITY' | 'NSE_FNO' | 'MCX';

/**
 * Fee structure for a market segment
 */
export interface FeeStructure {
  // Brokerage (per trade)
  brokeragePercent: number;     // As decimal (0.0003 = 0.03%)
  brokerageMax: number;         // Maximum brokerage per order in INR
  
  // Regulatory charges
  sttPercent: number;           // Securities Transaction Tax
  sttAppliesTo: 'buy' | 'sell' | 'both';
  
  exchangeTxnPercent: number;   // Exchange transaction charges
  sebiPercent: number;          // SEBI turnover charges
  stampDutyPercent: number;     // Stamp duty (state-wise, using avg)
  
  // GST on brokerage
  gstPercent: number;           // GST on brokerage
  
  // Slippage assumption
  slippagePercent: number;      // Expected slippage
}

/**
 * Indian market fee structures by segment
 */
export const INDIAN_MARKET_FEES: Record<MarketSegment, FeeStructure> = {
  // NSE Equity Delivery
  NSE_EQUITY: {
    brokeragePercent: 0.0003,   // 0.03% (Zerodha/Upstox)
    brokerageMax: 20,           // Rs 20 per order max
    sttPercent: 0.001,          // 0.1% on sell side
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000345, // 0.00345%
    sebiPercent: 0.000001,      // 0.0001%
    stampDutyPercent: 0.00015,  // 0.015% (varies by state)
    gstPercent: 0.18,           // 18% on brokerage
    slippagePercent: 0.001,     // 0.1%
  },
  
  // NSE Futures & Options
  NSE_FNO: {
    brokeragePercent: 0,        // Flat fee model
    brokerageMax: 20,           // Rs 20 per order
    sttPercent: 0.0001,         // 0.01% on sell (futures)
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000190, // 0.0019%
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,  // 0.002%
    gstPercent: 0.18,
    slippagePercent: 0.0005,    // 0.05% (more liquid)
  },
  
  // MCX Commodities
  MCX: {
    brokeragePercent: 0,        // Flat fee model
    brokerageMax: 20,           // Rs 20 per order
    sttPercent: 0.0001,         // 0.01% CTT on sell
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.000026, // 0.0026%
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,
    gstPercent: 0.18,
    slippagePercent: 0.0008,    // 0.08%
  },
};

/**
 * Default fee structure (NSE Equity)
 */
export const DEFAULT_FEES = INDIAN_MARKET_FEES.NSE_EQUITY;

/**
 * Trading hours for Indian markets
 */
export const INDIAN_MARKET_HOURS = {
  NSE: {
    preOpen: { start: '09:00', end: '09:15' },
    trading: { start: '09:15', end: '15:30' },
    postClose: { start: '15:40', end: '16:00' },
  },
  MCX: {
    morning: { start: '09:00', end: '17:00' },
    evening: { start: '17:00', end: '23:30' },
    // Note: MCX hours vary by commodity
  },
};

/**
 * Calculate total fees for a trade
 */
export function calculateTradeFees(
  tradeValue: number,
  segment: MarketSegment,
  isBuy: boolean
): {
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebiCharges: number;
  stampDuty: number;
  gst: number;
  totalFees: number;
} {
  const fees = INDIAN_MARKET_FEES[segment];
  
  // Brokerage (min of percent or max)
  const brokerageCalc = tradeValue * fees.brokeragePercent;
  const brokerage = Math.min(brokerageCalc, fees.brokerageMax);
  
  // STT (only on applicable side)
  let stt = 0;
  if (fees.sttAppliesTo === 'both' || 
      (fees.sttAppliesTo === 'sell' && !isBuy) ||
      (fees.sttAppliesTo === 'buy' && isBuy)) {
    stt = tradeValue * fees.sttPercent;
  }
  
  // Other charges
  const exchangeCharges = tradeValue * fees.exchangeTxnPercent;
  const sebiCharges = tradeValue * fees.sebiPercent;
  const stampDuty = isBuy ? tradeValue * fees.stampDutyPercent : 0; // Stamp duty on buy
  
  // GST on brokerage
  const gst = brokerage * fees.gstPercent;
  
  const totalFees = brokerage + stt + exchangeCharges + sebiCharges + stampDuty + gst;
  
  return {
    brokerage,
    stt,
    exchangeCharges,
    sebiCharges,
    stampDuty,
    gst,
    totalFees,
  };
}

/**
 * Apply slippage to a price
 * For buys: price increases (worse fill)
 * For sells: price decreases (worse fill)
 */
export function applySlippage(
  price: number,
  isBuy: boolean,
  segment: MarketSegment = 'NSE_EQUITY'
): number {
  const slippagePercent = INDIAN_MARKET_FEES[segment].slippagePercent;
  
  if (isBuy) {
    return price * (1 + slippagePercent);
  } else {
    return price * (1 - slippagePercent);
  }
}

/**
 * Get slippage percentage for a segment
 */
export function getSlippagePercent(segment: MarketSegment = 'NSE_EQUITY'): number {
  return INDIAN_MARKET_FEES[segment].slippagePercent;
}

/**
 * NSE F&O lot sizes for popular stocks
 */
export const NSE_LOT_SIZES: Record<string, number> = {
  'NIFTY': 50,
  'BANKNIFTY': 15,
  'RELIANCE': 250,
  'TCS': 150,
  'INFY': 300,
  'HDFCBANK': 550,
  'ICICIBANK': 700,
  'SBIN': 1500,
  'BHARTIARTL': 950,
  'ITC': 1600,
  'KOTAKBANK': 400,
  'LT': 150,
  'HINDUNILVR': 300,
  'AXISBANK': 600,
  'MARUTI': 100,
};

/**
 * MCX lot sizes
 */
export const MCX_LOT_SIZES: Record<string, { lotSize: number; unit: string }> = {
  'GOLD': { lotSize: 1, unit: 'kg' },
  'GOLDM': { lotSize: 0.1, unit: 'kg' },      // Gold Mini
  'GOLDPETAL': { lotSize: 0.001, unit: 'kg' }, // Gold Petal
  'SILVER': { lotSize: 30, unit: 'kg' },
  'SILVERM': { lotSize: 5, unit: 'kg' },      // Silver Mini
  'CRUDEOIL': { lotSize: 100, unit: 'barrels' },
  'NATURALGAS': { lotSize: 1250, unit: 'mmBtu' },
  'COPPER': { lotSize: 2500, unit: 'kg' },
  'ZINC': { lotSize: 5000, unit: 'kg' },
  'ALUMINUM': { lotSize: 5000, unit: 'kg' },
};

/**
 * F&O configuration for NSE indices and stocks
 */
export interface FnOConfigEntry {
  strikeInterval: number;   // Gap between strikes (50 for NIFTY, 100 for BANKNIFTY)
  weeklyExpiry: boolean;    // Has weekly expiry or monthly only
  lotSize: number;          // Contract lot size
}

/**
 * F&O configuration by underlying
 */
export const FNO_CONFIG: Record<string, FnOConfigEntry> = {
  // Indices (weekly expiry available)
  'NIFTY': { strikeInterval: 50, weeklyExpiry: true, lotSize: 50 },
  'BANKNIFTY': { strikeInterval: 100, weeklyExpiry: true, lotSize: 15 },
  'FINNIFTY': { strikeInterval: 50, weeklyExpiry: true, lotSize: 40 },
  'MIDCPNIFTY': { strikeInterval: 25, weeklyExpiry: true, lotSize: 75 },
  
  // Popular stocks (monthly expiry only)
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
  'WIPRO': { strikeInterval: 5, weeklyExpiry: false, lotSize: 1500 },
  'TECHM': { strikeInterval: 20, weeklyExpiry: false, lotSize: 600 },
  'SUNPHARMA': { strikeInterval: 20, weeklyExpiry: false, lotSize: 700 },
  'ONGC': { strikeInterval: 5, weeklyExpiry: false, lotSize: 3850 },
  'POWERGRID': { strikeInterval: 5, weeklyExpiry: false, lotSize: 2700 },
  'NTPC': { strikeInterval: 5, weeklyExpiry: false, lotSize: 2250 },
  'COALINDIA': { strikeInterval: 10, weeklyExpiry: false, lotSize: 1500 },
  'TATASTEEL': { strikeInterval: 5, weeklyExpiry: false, lotSize: 2750 },
  'JSWSTEEL': { strikeInterval: 20, weeklyExpiry: false, lotSize: 625 },
  'HINDALCO': { strikeInterval: 10, weeklyExpiry: false, lotSize: 1075 },
  'ADANIPORTS': { strikeInterval: 20, weeklyExpiry: false, lotSize: 500 },
  'DRREDDY': { strikeInterval: 50, weeklyExpiry: false, lotSize: 125 },
  'CIPLA': { strikeInterval: 20, weeklyExpiry: false, lotSize: 650 },
  'DIVISLAB': { strikeInterval: 50, weeklyExpiry: false, lotSize: 200 },
  'APOLLOHOSP': { strikeInterval: 100, weeklyExpiry: false, lotSize: 125 },
  'EICHERMOT': { strikeInterval: 100, weeklyExpiry: false, lotSize: 175 },
  'HEROMOTOCO': { strikeInterval: 50, weeklyExpiry: false, lotSize: 150 },
  'BAJAJ-AUTO': { strikeInterval: 100, weeklyExpiry: false, lotSize: 75 },
  'M&M': { strikeInterval: 50, weeklyExpiry: false, lotSize: 350 },
  'TATACONSUM': { strikeInterval: 20, weeklyExpiry: false, lotSize: 450 },
  'NESTLEIND': { strikeInterval: 100, weeklyExpiry: false, lotSize: 25 },
  'BRITANNIA': { strikeInterval: 50, weeklyExpiry: false, lotSize: 100 },
};

/**
 * Get F&O config for a symbol with fallback defaults
 */
export function getFnOConfig(symbol: string): FnOConfigEntry {
  const config = FNO_CONFIG[symbol.toUpperCase()];
  if (config) return config;
  
  // Fallback for unknown symbols
  const lotSize = NSE_LOT_SIZES[symbol.toUpperCase()] || 100;
  return {
    strikeInterval: 10,
    weeklyExpiry: false,
    lotSize,
  };
}

/**
 * Get strike interval for a symbol
 */
export function getStrikeInterval(symbol: string): number {
  return getFnOConfig(symbol).strikeInterval;
}

/**
 * Calculate ATM strike for a given spot price
 */
export function getATMStrike(spotPrice: number, symbol: string): number {
  const interval = getStrikeInterval(symbol);
  return Math.round(spotPrice / interval) * interval;
}

export default {
  INDIAN_MARKET_FEES,
  DEFAULT_FEES,
  INDIAN_MARKET_HOURS,
  calculateTradeFees,
  applySlippage,
  getSlippagePercent,
  NSE_LOT_SIZES,
  MCX_LOT_SIZES,
  FNO_CONFIG,
  getFnOConfig,
  getStrikeInterval,
  getATMStrike,
};

