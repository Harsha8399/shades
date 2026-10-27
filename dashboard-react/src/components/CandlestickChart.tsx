import { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import type { Trade } from '../types';

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SignalMarker {
  timestamp: number;
  price: number;
  direction: 'LONG' | 'SHORT';
  tradeId: string;
  patternName: string;
  state: Trade['state'];
  entryPrice?: number;
  stopLoss?: number;
  target?: number;
  exitPrice?: number;
  pnl?: number | null;
  rMultiple?: number | null;
  confluenceFactors: string[];
}

interface CandlestickChartProps {
  candles: CandleData[];
  trades: Trade[];
  isLoading: boolean;
  timeframe: string;
}

/**
 * Custom candlestick rendering using Line and custom shapes
 * Since recharts doesn't have built-in candlestick, we render:
 * - Vertical lines for high-low (wicks)
 * - Rectangles for open-close (bodies)
 */
function CandlestickSeries({ data, onClick }: { data: (CandleData & { time: string; date: string; index: number })[]; onClick?: (index: number) => void }) {
  const wickWidth = 1;
  const bodyWidth = 6;

  return (
    <>
      {data.map((candle, index) => {
        const isGreen = candle.close >= candle.open;
        const bodyTop = isGreen ? candle.open : candle.close;
        const bodyBottom = isGreen ? candle.close : candle.open;
        
        return (
          <g key={candle.timestamp} onClick={() => onClick?.(index)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
            {/* Wick (high-low line) */}
            <Line
              type="monotone"
              dataKey="value"
              data={[
                { value: candle.high },
                { value: candle.low },
              ]}
              stroke={isGreen ? '#22c55e' : '#ef4444'}
              strokeWidth={wickWidth}
              dot={false}
              isAnimationActive={false}
            />
            {/* Body (open-close rectangle) - rendered as a thick line */}
            <Line
              type="monotone"
              dataKey="value"
              data={[
                { value: bodyTop },
                { value: bodyBottom },
              ]}
              stroke={isGreen ? '#22c55e' : '#ef4444'}
              strokeWidth={bodyWidth}
              dot={false}
              isAnimationActive={false}
            />
          </g>
        );
      })}
    </>
  );
}

export function CandlestickChart({ candles, trades, isLoading, timeframe }: CandlestickChartProps) {
  // Convert trades to signal markers for chart overlay
  const signalMarkers = useMemo((): SignalMarker[] => {
    return trades.map(trade => {
      const signalTime = new Date(trade.signalTime).getTime();
      return {
        timestamp: signalTime,
        price: trade.signalPrice,
        direction: trade.direction,
        tradeId: trade.id,
        patternName: trade.patternName,
        state: trade.state,
        entryPrice: trade.entryPrice || undefined,
        stopLoss: trade.initialStopLoss,
        target: trade.target,
        exitPrice: trade.exitPrice || undefined,
        pnl: trade.pnl,
        rMultiple: trade.rMultiple,
        confluenceFactors: trade.confluenceFactors,
      };
    });
  }, [trades]);

  // Prepare chart data with time labels
  const chartData = useMemo(() => {
    return candles.map((candle, index) => ({
      ...candle,
      time: new Date(candle.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date(candle.timestamp).toLocaleDateString(),
      index,
    }));
  }, [candles]);

  // Calculate price domain with padding
  const priceMin = useMemo(() => Math.min(...candles.map(c => c.low)) * 0.995, [candles]);
  const priceMax = useMemo(() => Math.max(...candles.map(c => c.high)) * 1.005, [candles]);

  // Filter signal markers to only those within the candle range
  const validMarkers = useMemo(() => {
    if (candles.length === 0) return [];
    const firstTime = candles[0].timestamp;
    const lastTime = candles[candles.length - 1].timestamp;
    return signalMarkers.filter(m => m.timestamp >= firstTime && m.timestamp <= lastTime);
  }, [candles, signalMarkers]);

  // Find the candle index for each marker for proper positioning
  const markersWithIndex = useMemo(() => {
    return validMarkers.map(marker => {
      let closestIndex = 0;
      let minDiff = Infinity;
      candles.forEach((candle, index) => {
        const diff = Math.abs(candle.timestamp - marker.timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = index;
        }
      });
      return { ...marker, candleIndex: closestIndex };
    });
  }, [validMarkers, candles]);

  // Selected trade for detail view
  const [selectedTrade, setSelectedTrade] = useState<SignalMarker | null>(null);

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Price Chart ({timeframe})</h3>
        </div>
        <div className="card-body h-[500px] flex items-center justify-center">
          <div className="animate-pulse text-slate-500">Loading chart...</div>
        </div>
      </div>
    );
  }

  if (candles.length < 2) {
    return (
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Price Chart ({timeframe})</h3>
        </div>
        <div className="card-body h-[500px] flex items-center justify-center">
          <div className="text-slate-500">Not enough data to display chart</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Price Chart ({timeframe})</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-400">{candles.length} candles</span>
          <span className="text-slate-400">{validMarkers.length} signals</span>
        </div>
      </div>
      <div className="card-body h-[500px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            layout="vertical"
            margin={{ top: 20, right: 60, left: 0, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              type="category"
              dataKey="time"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              interval={Math.max(1, Math.floor(candles.length / 20))}
              tickFormatter={(value) => value}
            />
            <YAxis
              yAxisId="price"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              domain={[priceMin, priceMax]}
              tickFormatter={(value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#e2e8f0',
              }}
            />
            <Legend />
            
            {/* Custom Candlestick Series */}
            <CandlestickSeries data={chartData} />
            
            {/* Signal markers - Long entries */}
            {markersWithIndex
              .filter(m => m.direction === 'LONG')
              .map((marker, idx) => (
                <ReferenceLine
                  key={`long-${marker.tradeId}-${idx}`}
                  x={marker.candleIndex}
                  y={marker.price}
                  label={{
                    value: '▲ LONG',
                    position: 'top',
                    fill: '#22c55e',
                    fontSize: 10,
                    fontWeight: 'bold',
                    offset: -10,
                  }}
                  stroke="#22c55e"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                />
              ))}

            {/* Signal markers - Short entries */}
            {markersWithIndex
              .filter(m => m.direction === 'SHORT')
              .map((marker, idx) => (
                <ReferenceLine
                  key={`short-${marker.tradeId}-${idx}`}
                  x={marker.candleIndex}
                  y={marker.price}
                  label={{
                    value: '▼ SHORT',
                    position: 'bottom',
                    fill: '#ef4444',
                    fontSize: 10,
                    fontWeight: 'bold',
                    offset: 10,
                  }}
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                />
              ))}

            {/* Stop loss and target lines for selected trade */}
            {selectedTrade && (
              <>
                {selectedTrade.stopLoss && (
                  <ReferenceLine
                    y={selectedTrade.stopLoss}
                    yAxisId="price"
                    stroke="#ef4444"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    label={{
                      value: `SL: ${selectedTrade.stopLoss.toFixed(2)}`,
                      fill: '#ef4444',
                      fontSize: 10,
                      position: 'right',
                    }}
                  />
                )}
                {selectedTrade.target && (
                  <ReferenceLine
                    y={selectedTrade.target}
                    yAxisId="price"
                    stroke="#22c55e"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    label={{
                      value: `TP: ${selectedTrade.target.toFixed(2)}`,
                      fill: '#22c55e',
                      fontSize: 10,
                      position: 'right',
                    }}
                  />
                )}
                {selectedTrade.entryPrice && (
                  <ReferenceLine
                    y={selectedTrade.entryPrice}
                    yAxisId="price"
                    stroke="#3b82f6"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    label={{
                      value: `Entry: ${selectedTrade.entryPrice.toFixed(2)}`,
                      fill: '#3b82f6',
                      fontSize: 10,
                      position: 'right',
                    }}
                  />
                )}
              </>
            )}

            {/* Clickable signal markers for selection */}
            {markersWithIndex.map((marker, idx) => (
              <ReferenceLine
                key={`marker-${marker.tradeId}-${idx}`}
                x={marker.candleIndex}
                y={marker.price}
                yAxisId="price"
                onClick={() => setSelectedTrade(marker)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Selected trade detail panel */}
        {selectedTrade && (
          <div className="absolute bottom-4 right-4 bg-bg-secondary border border-slate-700 rounded-lg p-4 min-w-[300px] max-w-[400px] z-10 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${selectedTrade.direction === 'LONG' ? 'bg-profit' : 'bg-loss'}`} />
                <span className="text-white font-semibold">{selectedTrade.direction} - {selectedTrade.patternName}</span>
              </div>
              <button
                onClick={() => setSelectedTrade(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <div><span className="text-slate-400">Signal Time: </span><span className="text-white">{new Date(selectedTrade.timestamp).toLocaleString()}</span></div>
              <div><span className="text-slate-400">State: </span><span className="text-white">{selectedTrade.state}</span></div>
              <div><span className="text-slate-400">Signal Price: </span><span className="text-white">{selectedTrade.price.toFixed(2)}</span></div>
              {selectedTrade.entryPrice && <div><span className="text-slate-400">Entry: </span><span className="text-white">{selectedTrade.entryPrice.toFixed(2)}</span></div>}
              {selectedTrade.stopLoss && <div><span className="text-slate-400">Stop Loss: </span><span className="text-white">{selectedTrade.stopLoss.toFixed(2)}</span></div>}
              {selectedTrade.target && <div><span className="text-slate-400">Target: </span><span className="text-white">{selectedTrade.target.toFixed(2)}</span></div>}
              {selectedTrade.exitPrice && <div><span className="text-slate-400">Exit: </span><span className="text-white">{selectedTrade.exitPrice.toFixed(2)}</span></div>}
              {selectedTrade.pnl !== null && selectedTrade.pnl !== undefined && (
                <div className="col-span-2"><span className="text-slate-400">P&L: </span><span className={selectedTrade.pnl >= 0 ? 'text-profit' : 'text-loss'}>{selectedTrade.pnl >= 0 ? '+' : ''}{selectedTrade.pnl.toFixed(2)}</span></div>
              )}
              {selectedTrade.rMultiple !== null && selectedTrade.rMultiple !== undefined && (
                <div className="col-span-2"><span className="text-slate-400">R-Multiple: </span><span className="text-white">{selectedTrade.rMultiple.toFixed(2)}R</span></div>
              )}
            </div>
            {selectedTrade.confluenceFactors.length > 0 && (
              <div className="border-t border-slate-700 pt-3">
                <div className="text-slate-400 text-sm mb-1">Confluence Factors:</div>
                <div className="flex flex-wrap gap-1">
                  {selectedTrade.confluenceFactors.map((factor, idx) => (
                    <span key={idx} className="bg-slate-800 text-slate-200 text-xs px-2 py-1 rounded">{factor}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 text-xs text-slate-500">
              Stop-loss methodology: approximate (recent swing ±10% buffer). Book rules (EM1/EM2-A/EM2-B) not yet implemented.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}