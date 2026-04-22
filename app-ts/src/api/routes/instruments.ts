/**
 * Instruments API Route
 * 
 * Symbol search, F&O details, options chain with premium estimation,
 * and fee calculations for Indian market stocks.
 */
import { Router, Request, Response } from 'express';
import { NSE_STOCK_TOKENS, INDEX_TOKENS } from '../../data/AngelOneAdapter';
import {
  FNO_CONFIG,
  NSE_LOT_SIZES,
  calculateTradeFees,
  INDIAN_MARKET_FEES,
  INDIAN_MARKET_HOURS,
  getFnOConfig,
  getATMStrike,
} from '../../config/indianMarket';
import { InstrumentSelector } from '../../core/InstrumentSelector';
import type { TradeRepository } from '../../db/TradeRepository';

// ─── Reference price data (approximate, for estimation when no live feed) ───
// These are approximate reference prices to seed option chain calculations.
// In production, these come from a live feed (Upstox, AngelOne, etc.)
const REFERENCE_PRICES: Record<string, number> = {
  'NIFTY': 24250,
  'BANKNIFTY': 52500,
  'FINNIFTY': 23200,
  'RELIANCE': 2950,
  'TCS': 3850,
  'HDFCBANK': 1650,
  'INFY': 1550,
  'ICICIBANK': 1280,
  'HINDUNILVR': 2350,
  'SBIN': 830,
  'BHARTIARTL': 1700,
  'KOTAKBANK': 1850,
  'ITC': 440,
  'LT': 3450,
  'HCLTECH': 1650,
  'AXISBANK': 1150,
  'MARUTI': 12500,
  'ASIANPAINT': 2350,
  'TITAN': 3200,
  'BAJFINANCE': 8500,
  'SUNPHARMA': 1750,
  'TATAMOTORS': 650,
  'WIPRO': 420,
  'NESTLEIND': 2250,
  'TECHM': 1550,
  'NTPC': 355,
  'POWERGRID': 310,
  'ONGC': 260,
  'COALINDIA': 420,
  'JSWSTEEL': 980,
  'TATASTEEL': 155,
  'INDUSINDBK': 1050,
  'BRITANNIA': 5400,
  'M&M': 2800,
  'DRREDDY': 1200,
  'CIPLA': 1500,
  'BPCL': 310,
  'ADANIENT': 2400,
  'ADANIPORTS': 1350,
  'HINDALCO': 640,
  'DIVISLAB': 3800,
  'APOLLOHOSP': 6800,
  'EICHERMOT': 5200,
  'HEROMOTOCO': 4600,
  'BAJAJ-AUTO': 9200,
  'TATACONSUM': 1050,
  'MIDCPNIFTY': 12000,
};

// Build a merged symbol list from all sources
function getAllSymbols(): string[] {
  const symbols = new Set<string>();
  Object.keys(NSE_STOCK_TOKENS).forEach(s => symbols.add(s));
  Object.keys(INDEX_TOKENS).forEach(s => symbols.add(s));
  Object.keys(FNO_CONFIG).forEach(s => symbols.add(s));
  Object.keys(NSE_LOT_SIZES).forEach(s => symbols.add(s));
  Object.keys(REFERENCE_PRICES).forEach(s => symbols.add(s));
  return Array.from(symbols).sort();
}

const ALL_SYMBOLS = getAllSymbols();

/**
 * Symbol metadata
 */
function getSymbolMeta(symbol: string) {
  const upper = symbol.toUpperCase();
  const isIndex = upper in INDEX_TOKENS;
  const hasFnO = upper in FNO_CONFIG;
  const fnoConfig = getFnOConfig(upper);
  const refPrice = REFERENCE_PRICES[upper] || null;

  return {
    symbol: upper,
    type: isIndex ? 'INDEX' : 'EQUITY',
    exchange: 'NSE',
    hasFnO,
    lotSize: fnoConfig.lotSize,
    strikeInterval: fnoConfig.strikeInterval,
    weeklyExpiry: fnoConfig.weeklyExpiry,
    referencePrice: refPrice,
    token: NSE_STOCK_TOKENS[upper] || INDEX_TOKENS[upper] || null,
  };
}

export function createInstrumentsRouter(repository: TradeRepository): Router {
  const router = Router();

  // ─── Symbol search / autocomplete ───────────────────────
  router.get('/search', (req: Request, res: Response) => {
    const query = (req.query.q as string || '').toUpperCase().trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 15, 50);

    if (!query) {
      // Return popular symbols
      const popular = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'TATAMOTORS', 'BAJFINANCE', 'ITC', 'AXISBANK'];
      res.json({
        symbols: popular.map(s => getSymbolMeta(s)),
        total: popular.length,
      });
      return;
    }

    // Filter by prefix match first, then contains
    const prefixMatches = ALL_SYMBOLS.filter(s => s.startsWith(query));
    const containsMatches = ALL_SYMBOLS.filter(s => s.includes(query) && !s.startsWith(query));
    const results = [...prefixMatches, ...containsMatches].slice(0, limit);

    res.json({
      symbols: results.map(s => getSymbolMeta(s)),
      total: results.length,
    });
  });

  // ─── Symbol details ─────────────────────────────────────
  router.get('/:symbol/details', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const spotPrice = parseFloat(req.query.spotPrice as string) || REFERENCE_PRICES[symbol] || 0;

    const meta = getSymbolMeta(symbol);
    const fnoConfig = getFnOConfig(symbol);

    // Calculate fees for a sample trade
    const sampleTradeValue = spotPrice * fnoConfig.lotSize;
    const feesOnBuy = sampleTradeValue > 0 ? calculateTradeFees(sampleTradeValue, 'NSE_FNO', true) : null;
    const feesOnSell = sampleTradeValue > 0 ? calculateTradeFees(sampleTradeValue, 'NSE_FNO', false) : null;

    // Get expiry info
    const expiry = InstrumentSelector.getCurrentMonthExpiry();
    const daysToExpiry = InstrumentSelector.getDaysToExpiry(expiry);
    const expiryString = InstrumentSelector.getExpiryString(expiry);

    // ATM strike
    const atmStrike = spotPrice > 0 ? getATMStrike(spotPrice, symbol) : null;

    // Futures
    const futuresPrice = spotPrice > 0 ? InstrumentSelector.calculateFuturesPremium(spotPrice, 0.5) : null;

    // Get last trade from DB for this symbol (if any)
    let lastTradePrice: number | null = null;
    try {
      const trades = repository.getByState('CLOSED');
      const symbolTrades = trades.filter((t: any) => t.symbol.toUpperCase() === symbol);
      if (symbolTrades.length > 0) {
        const last = symbolTrades[symbolTrades.length - 1];
        lastTradePrice = last.exitPrice || last.entryPrice || null;
      }
    } catch { /* ignores */ }

    res.json({
      ...meta,
      spotPrice: spotPrice || lastTradePrice,
      lastTradePrice,
      atmStrike,
      futuresPrice: futuresPrice ? Math.round(futuresPrice * 100) / 100 : null,
      expiry: {
        date: expiry.toISOString(),
        daysToExpiry,
        expiryString,
        futuresSymbol: `${symbol}${expiryString}FUT`,
      },
      fees: {
        segment: 'NSE_FNO',
        sampleLotValue: Math.round(sampleTradeValue),
        buy: feesOnBuy,
        sell: feesOnSell,
        totalRoundTrip: feesOnBuy && feesOnSell
          ? Math.round((feesOnBuy.totalFees + feesOnSell.totalFees) * 100) / 100
          : null,
      },
      marketHours: INDIAN_MARKET_HOURS.NSE,
    });
  });

  // ─── Options chain ──────────────────────────────────────
  router.get('/:symbol/options', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const spotPrice = parseFloat(req.query.spotPrice as string) || REFERENCE_PRICES[symbol] || 0;
    const numStrikes = Math.min(parseInt(req.query.strikes as string) || 10, 25);
    const volatility = parseFloat(req.query.volatility as string) || 0.20;

    if (spotPrice <= 0) {
      res.status(400).json({
        error: 'spotPrice is required. Provide it as a query parameter or use a symbol with a known reference price.',
      });
      return;
    }

    const fnoConfig = getFnOConfig(symbol);
    const expiry = InstrumentSelector.getCurrentMonthExpiry();
    const daysToExpiry = InstrumentSelector.getDaysToExpiry(expiry);
    const expiryString = InstrumentSelector.getExpiryString(expiry);
    const atmStrike = getATMStrike(spotPrice, symbol);

    // Generate strikes around ATM
    const strikes: number[] = [];
    for (let i = -numStrikes; i <= numStrikes; i++) {
      strikes.push(atmStrike + i * fnoConfig.strikeInterval);
    }

    const chain = strikes.map(strike => {
      const ce = InstrumentSelector.estimateOptionPrice(spotPrice, strike, 'CE', daysToExpiry, volatility);
      const pe = InstrumentSelector.estimateOptionPrice(spotPrice, strike, 'PE', daysToExpiry, volatility);

      const ceIntrinsic = Math.max(0, spotPrice - strike);
      const peIntrinsic = Math.max(0, strike - spotPrice);

      return {
        strike,
        isATM: strike === atmStrike,
        ce: {
          symbol: `${symbol}${expiryString}${strike}CE`,
          price: Math.round(ce.price * 100) / 100,
          delta: Math.round(ce.delta * 1000) / 1000,
          intrinsic: Math.round(ceIntrinsic * 100) / 100,
          timeValue: Math.round((ce.price - ceIntrinsic) * 100) / 100,
          moneyness: strike < spotPrice ? 'ITM' : strike === atmStrike ? 'ATM' : 'OTM',
          lotValue: Math.round(ce.price * fnoConfig.lotSize * 100) / 100,
        },
        pe: {
          symbol: `${symbol}${expiryString}${strike}PE`,
          price: Math.round(pe.price * 100) / 100,
          delta: Math.round(Math.abs(pe.delta) * 1000) / 1000,
          intrinsic: Math.round(peIntrinsic * 100) / 100,
          timeValue: Math.round((pe.price - peIntrinsic) * 100) / 100,
          moneyness: strike > spotPrice ? 'ITM' : strike === atmStrike ? 'ATM' : 'OTM',
          lotValue: Math.round(pe.price * fnoConfig.lotSize * 100) / 100,
        },
      };
    });

    res.json({
      symbol,
      spotPrice,
      atmStrike,
      expiry: {
        date: expiry.toISOString(),
        daysToExpiry,
        expiryString,
      },
      lotSize: fnoConfig.lotSize,
      strikeInterval: fnoConfig.strikeInterval,
      volatility,
      chain,
    });
  });

  // ─── Quick quote (from reference data + last trade) ─────
  router.get('/:symbol/quote', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const refPrice = REFERENCE_PRICES[symbol] || null;

    // Try to get last trade from DB
    let lastTradePrice: number | null = null;
    let lastTradeTime: string | null = null;
    try {
      const trades = repository.getByState('CLOSED');
      const symbolTrades = trades.filter((t: any) => t.symbol.toUpperCase() === symbol);
      if (symbolTrades.length > 0) {
        const last = symbolTrades[symbolTrades.length - 1];
        lastTradePrice = last.exitPrice || last.entryPrice || null;
        lastTradeTime = (last.exitTime || last.entryTime)?.toISOString() || null;
      }
    } catch { /* ignores */ }

    // Also check open trades
    let openPositions = 0;
    try {
      const openTrades = repository.getByState('OPEN');
      openPositions = openTrades.filter((t: any) => t.symbol.toUpperCase() === symbol).length;
    } catch { /* ignores */ }

    const bestPrice = lastTradePrice || refPrice;
    const fnoConfig = getFnOConfig(symbol);

    res.json({
      symbol,
      referencePrice: refPrice,
      lastTradePrice,
      lastTradeTime,
      bestEstimatePrice: bestPrice,
      openPositions,
      lotSize: fnoConfig.lotSize,
      strikeInterval: fnoConfig.strikeInterval,
      source: lastTradePrice ? 'last_trade' : refPrice ? 'reference' : 'unknown',
      note: 'Prices are estimates. Connect a live broker feed (Upstox/AngelOne) for real-time data.',
    });
  });

  // ─── All available symbols list ─────────────────────────
  router.get('/', (req: Request, res: Response) => {
    res.json({
      symbols: ALL_SYMBOLS.map(s => getSymbolMeta(s)),
      total: ALL_SYMBOLS.length,
    });
  });

  return router;
}
