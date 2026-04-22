export interface Trade {
  id: string;
  patternId: string;
  patternName: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  state: TradeState;
  signalPrice: number;
  entryPrice: number | null;
  initialStopLoss: number;
  currentStopLoss: number;
  target: number;
  exitPrice: number | null;
  quantity: number;
  riskAmount: number;
  riskPercent: number;
  signalTime: string;
  entryTime: string | null;
  exitTime: string | null;
  pnl: number | null;
  pnlPercent: number | null;
  rMultiple: number | null;
  confluenceFactors: string[];
}

export type TradeState = 
  | 'PENDING'
  | 'OPEN'
  | 'CLOSED'
  | 'STOPPED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface TradeStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  stoppedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgRMultiple: number;
  maxDrawdown: number;
  bestTrade: number;
  worstTrade: number;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
}

export interface PatternInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  timeframes: string[];
  enabled: boolean;
  requiredCandles: number;
  stats?: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    avgRMultiple: number;
  };
}

export interface DailyStats {
  date: string;
  pnl: number;
  trades: number;
}

