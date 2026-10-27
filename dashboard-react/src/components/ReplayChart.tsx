import { useMemo, useRef, useState, useEffect } from 'react';
import type { CandleData, Prediction } from '../types/replay';

interface ReplayChartProps {
  candles: CandleData[];
  predictions: Prediction[];
  timeframe: string;
  warmupCandleCount?: number;
  selectedPrediction?: Prediction | null;
  onSelectPrediction?: (p: Prediction) => void;
  isLive?: boolean;
}

interface RenderCandle extends CandleData {
  /** Index of the first candle represented (for marker mapping) */
  startIndex: number;
  /** Index of the last candle represented */
  endIndex: number;
}

const MAX_RENDER_BUCKETS = 500;
const PAD = { top: 16, right: 90, bottom: 26, left: 12 };
const CHART_HEIGHT = 460;

const CANDLE_UP = '#22c55e';
const CANDLE_DOWN = '#ef4444';
const BULL_MARKER = '#3b82f6';   // blue upward marker = bullish prediction
const BEAR_MARKER = '#f97316';   // orange downward marker = bearish prediction

const OUTCOME_STROKE: Record<string, string> = {
  CORRECT: '#22c55e',
  INCORRECT: '#ef4444',
  TIE: '#94a3b8',
  NONE: '#64748b',
};

/** Aggregate candles into at most MAX_RENDER_BUCKETS buckets */
function bucketize(candles: CandleData[]): RenderCandle[] {
  if (candles.length <= MAX_RENDER_BUCKETS) {
    return candles.map((c, i) => ({ ...c, startIndex: i, endIndex: i }));
  }
  const bucketCount = MAX_RENDER_BUCKETS;
  const per = candles.length / bucketCount;
  const buckets: RenderCandle[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const from = Math.floor(b * per);
    const to = Math.min(candles.length, Math.floor((b + 1) * per));
    if (from >= to) continue;
    const slice = candles.slice(from, to);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume ?? 0;
    }
    buckets.push({
      timestamp: slice[0].timestamp,
      open: slice[0].open,
      high,
      low,
      close: slice[slice.length - 1].close,
      volume,
      startIndex: from,
      endIndex: to - 1,
    });
  }
  return buckets;
}

function candleIndexToBucket(index: number, render: RenderCandle[]): number {
  for (let b = 0; b < render.length; b++) {
    if (index >= render[b].startIndex && index <= render[b].endIndex) return b;
  }
  return index < render[0]?.startIndex ? 0 : render.length - 1;
}

function outcomeOf(p: Prediction): string {
  if (!p.evaluation) return 'NONE';
  return p.evaluation.directional.outcome;
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtTime(ts: number, timeframe: string): string {
  const d = new Date(ts);
  if (timeframe === '1d' || timeframe === '4h') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Interactive candlestick replay chart.
 *
 * - Green/red candlesticks for price action
 * - Blue upward / orange downward markers for bullish/bearish predictions,
 *   outlined by evaluated outcome (green=correct, red=incorrect, gray=tie,
 *   dashed=not evaluated)
 * - Entry / stop-loss / target lines for the selected prediction
 * - Warm-up region dimmed; the evaluation window after a selected signal is
 *   shaded so future (evaluation) data stays distinguishable from the data
 *   the engine saw at prediction time.
 */
export function ReplayChart({
  candles,
  predictions,
  timeframe,
  warmupCandleCount = 0,
  selectedPrediction,
  onSelectPrediction,
  isLive,
}: ReplayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1100);
  const [hover, setHover] = useState<{ x: number; bucket: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth || 1100);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const render = useMemo(() => bucketize(candles), [candles]);

  const priceDomain = useMemo(() => {
    if (candles.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const c of candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    // Include selected prediction levels so lines stay visible
    if (selectedPrediction) {
      for (const v of [selectedPrediction.entryPrice, selectedPrediction.stopLoss, selectedPrediction.target]) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    const span = max - min || max * 0.01 || 1;
    return { min: min - span * 0.05, max: max + span * 0.05 };
  }, [candles, selectedPrediction]);

  const innerWidth = Math.max(200, containerWidth - PAD.left - PAD.right);
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const slot = render.length > 0 ? innerWidth / render.length : innerWidth;
  const bodyWidth = Math.max(1, Math.min(13, slot * 0.65));

  const xOf = (bucket: number) => PAD.left + slot * (bucket + 0.5);
  const yOf = (price: number) =>
    PAD.top + innerHeight * (1 - (price - priceDomain.min) / (priceDomain.max - priceDomain.min));

  // Marker positions
  const markers = useMemo(() => {
    if (render.length === 0) return [];
    return predictions
      .filter(p => p.direction !== 'NO_TRADE')
      .map(p => {
        const candleIdx = Math.max(0, Math.min(candles.length - 1, p.candleIndex - 1));
        const b = candleIndexToBucket(candleIdx, render);
        const rc = render[b];
        const isLong = p.direction === 'LONG';
        const y = isLong ? yOf(rc.low) + 14 : yOf(rc.high) - 14;
        return { pred: p, bucket: b, x: xOf(b), y, isLong, outcome: outcomeOf(p) };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictions, render, candles, priceDomain, containerWidth]);

  const selectedIdx = useMemo(() => {
    if (!selectedPrediction || render.length === 0) return null;
    const candleIdx = Math.max(0, Math.min(candles.length - 1, selectedPrediction.candleIndex - 1));
    return candleIndexToBucket(candleIdx, render);
  }, [selectedPrediction, render, candles]);

  // Evaluation window for the selected prediction (future data shading)
  const evalWindow = useMemo(() => {
    if (!selectedPrediction || render.length === 0) return null;
    const from = selectedPrediction.candleIndex; // first candle after the signal candle
    const to = Math.min(candles.length - 1, selectedPrediction.candleIndex + selectedPrediction.evaluationHorizon.candles - 1);
    if (from > candles.length - 1) return null;
    const fromB = candleIndexToBucket(from, render);
    const toB = candleIndexToBucket(to, render);
    return {
      x1: PAD.left + slot * fromB,
      x2: PAD.left + slot * (toB + 1),
    };
  }, [selectedPrediction, render, candles, slot]);

  // Y axis ticks
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 5; i++) {
      ticks.push(priceDomain.min + (i / 5) * (priceDomain.max - priceDomain.min));
    }
    return ticks;
  }, [priceDomain]);

  // X axis ticks (dates)
  const xTicks = useMemo(() => {
    if (render.length === 0) return [];
    const count = Math.min(6, render.length);
    const step = Math.max(1, Math.floor((render.length - 1) / (count - 1)));
    const ticks: Array<{ bucket: number; label: string }> = [];
    for (let b = 0; b < render.length; b += step) ticks.push({ bucket: b, label: fmtTime(render[b].timestamp, timeframe) });
    return ticks;
  }, [render, timeframe]);

  const warmupEndBucket = warmupCandleCount > 0 && render.length > 0
    ? candleIndexToBucket(Math.min(warmupCandleCount - 1, candles.length - 1), render)
    : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const b = Math.floor((x - PAD.left) / slot);
    if (b >= 0 && b < render.length) setHover({ x, bucket: b });
    else setHover(null);
  };

  const hoverCandle = hover ? render[hover.bucket] : null;

  if (candles.length === 0) return null;

  return (
    <div className="card">
      <div className="card-header flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-white">Interactive Chart ({timeframe})</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-400">{candles.length} candles</span>
          {warmupCandleCount > 0 && (
            <span className="text-yellow-500/80">{warmupCandleCount} warm-up (not evaluated)</span>
          )}
          <span className="text-slate-400">{predictions.filter(p => p.direction !== 'NO_TRADE').length} signals</span>
          {isLive && <span className="animate-pulse text-green-400">● LIVE</span>}
        </div>
      </div>
      <div className="card-body">
        <div ref={containerRef} className="relative w-full">
          <svg
            width="100%"
            height={CHART_HEIGHT}
            viewBox={`0 0 ${containerWidth} ${CHART_HEIGHT}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            className="select-none"
          >
            {/* Warm-up region */}
            {warmupEndBucket !== null && (
              <>
                <rect
                  x={PAD.left}
                  y={PAD.top}
                  width={Math.max(0, slot * (warmupEndBucket + 1))}
                  height={innerHeight}
                  fill="rgba(234, 179, 8, 0.05)"
                  stroke="rgba(234, 179, 8, 0.25)"
                  strokeDasharray="4 4"
                />
                <text x={PAD.left + 6} y={PAD.top + 14} fontSize={11} fill="#eab308">
                  Warm-up — strategy history, not evaluated
                </text>
              </>
            )}

            {/* Grid + Y labels */}
            {yTicks.map((t, i) => (
              <g key={`yt-${i}`}>
                <line x1={PAD.left} x2={containerWidth - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="#1e293b" strokeWidth={1} />
                <text x={containerWidth - PAD.right + 6} y={yOf(t) + 3} fontSize={10} fill="#64748b">{fmt(t)}</text>
              </g>
            ))}

            {/* X labels */}
            {xTicks.map((t, i) => (
              <text key={`xt-${i}`} x={xOf(t.bucket)} y={CHART_HEIGHT - 8} fontSize={10} fill="#64748b" textAnchor="middle">
                {t.label}
              </text>
            ))}

            {/* Evaluation window shading for the selected prediction */}
            {evalWindow && (
              <>
                <rect
                  x={evalWindow.x1}
                  y={PAD.top}
                  width={Math.max(0, evalWindow.x2 - evalWindow.x1)}
                  height={innerHeight}
                  fill="rgba(59, 130, 246, 0.07)"
                />
                <text x={evalWindow.x1 + 4} y={PAD.top + innerHeight - 6} fontSize={10} fill="#60a5fa">
                  after signal — evaluation data (future)
                </text>
              </>
            )}

            {/* Candles */}
            {render.map((c, b) => {
              const up = c.close >= c.open;
              const color = up ? CANDLE_UP : CANDLE_DOWN;
              const x = xOf(b);
              const inWarmup = warmupCandleCount > 0 && c.endIndex < warmupCandleCount;
              const opacity = inWarmup ? 0.35 : 1;
              const yHigh = yOf(c.high);
              const yLow = yOf(c.low);
              const yOpen = yOf(c.open);
              const yClose = yOf(c.close);
              const bodyTop = Math.min(yOpen, yClose);
              const bodyH = Math.max(1, Math.abs(yClose - yOpen));
              return (
                <g key={`c-${b}`} opacity={opacity}>
                  <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
                  <rect
                    x={x - bodyWidth / 2}
                    y={bodyTop}
                    width={bodyWidth}
                    height={bodyH}
                    fill={color}
                    stroke={color}
                    strokeWidth={1}
                  />
                </g>
              );
            })}

            {/* Selected prediction lines */}
            {selectedPrediction && selectedIdx !== null && (
              <>
                {/* Signal candle vertical marker */}
                <line
                  x1={xOf(selectedIdx)} x2={xOf(selectedIdx)}
                  y1={PAD.top} y2={PAD.top + innerHeight}
                  stroke="#e2e8f0" strokeWidth={1} strokeDasharray="2 3" opacity={0.7}
                />
                <text x={xOf(selectedIdx) + 4} y={PAD.top + 12} fontSize={10} fill="#e2e8f0">
                  signal
                </text>
                {typeof selectedPrediction.entryPrice === 'number' && (
                  <ValueLine y={yOf(selectedPrediction.entryPrice)} color="#e2e8f0" width={containerWidth} label={`Entry ${fmt(selectedPrediction.entryPrice)}`} dash="" />
                )}
                {selectedPrediction.stopLoss != null && (
                  <ValueLine y={yOf(selectedPrediction.stopLoss)} color="#ef4444" width={containerWidth} label={`SL ${fmt(selectedPrediction.stopLoss)}`} dash="5 4" />
                )}
                {selectedPrediction.target != null && (
                  <ValueLine y={yOf(selectedPrediction.target)} color="#22c55e" width={containerWidth} label={`Target ${fmt(selectedPrediction.target)}`} dash="5 4" />
                )}
              </>
            )}

            {/* Prediction markers */}
            {markers.map((m, i) => {
              const stroke = OUTCOME_STROKE[m.outcome] || OUTCOME_STROKE.NONE;
              const evaluated = m.outcome !== 'NONE';
              const size = 7;
              const tri = m.isLong
                ? `${m.x},${m.y - size} ${m.x - size},${m.y + size} ${m.x + size},${m.y + size}`
                : `${m.x},${m.y + size} ${m.x - size},${m.y - size} ${m.x + size},${m.y - size}`;
              const isSelected = selectedPrediction?.id === m.pred.id;
              return (
                <g key={`m-${m.pred.id}-${i}`} onClick={() => onSelectPrediction?.(m.pred)} style={{ cursor: 'pointer' }}>
                  <circle cx={m.x} cy={m.y} r={size + 5} fill="transparent" />
                  <polygon
                    points={tri}
                    fill={m.isLong ? BULL_MARKER : BEAR_MARKER}
                    fillOpacity={evaluated ? 1 : 0.45}
                    stroke={stroke}
                    strokeWidth={isSelected ? 3 : evaluated ? 2 : 1.5}
                    strokeDasharray={evaluated ? undefined : '2 2'}
                  />
                  {isSelected && (
                    <circle cx={m.x} cy={m.y} r={size + 4} fill="none" stroke="#e2e8f0" strokeWidth={1.5} />
                  )}
                </g>
              );
            })}

            {/* Hover crosshair */}
            {hover && hoverCandle && (
              <line
                x1={xOf(hover.bucket)} x2={xOf(hover.bucket)}
                y1={PAD.top} y2={PAD.top + innerHeight}
                stroke="#475569" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none"
              />
            )}
          </svg>

          {/* Hover tooltip */}
          {hover && hoverCandle && (
            <div
              className="absolute z-10 pointer-events-none bg-slate-900/95 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 shadow-xl"
              style={{
                left: Math.min(Math.max(hover.x - 70, 0), Math.max(0, containerWidth - 190)),
                top: 8,
              }}
            >
              <div className="text-slate-400 mb-1">{new Date(hoverCandle.timestamp).toLocaleString()}</div>
              <div className="grid grid-cols-2 gap-x-3">
                <span>O <span className="text-white font-mono">{fmt(hoverCandle.open)}</span></span>
                <span>H <span className="text-white font-mono">{fmt(hoverCandle.high)}</span></span>
                <span>L <span className="text-white font-mono">{fmt(hoverCandle.low)}</span></span>
                <span>C <span className="text-white font-mono">{fmt(hoverCandle.close)}</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 text-xs text-slate-400">
          <LegendSwatch color={CANDLE_UP} label="closed above open" />
          <LegendSwatch color={CANDLE_DOWN} label="closed below open" />
          <LegendTriangle color={BULL_MARKER} up label="bullish prediction" />
          <LegendTriangle color={BEAR_MARKER} up={false} label="bearish prediction" />
          <span>outline: <span style={{ color: OUTCOME_STROKE.CORRECT }}>■ correct</span>{' '}
            <span style={{ color: OUTCOME_STROKE.INCORRECT }}>■ incorrect</span>{' '}
            <span style={{ color: OUTCOME_STROKE.TIE }}>■ tie</span>{' '}
            <span className="inline-block border border-dashed border-slate-500 px-1 text-slate-500">not evaluated</span>
          </span>
          <span className="text-slate-500">Click a marker or explorer row to inspect the prediction</span>
        </div>
      </div>
    </div>
  );
}

function ValueLine({ y, color, width, label, dash }: { y: number; color: string; width: number; label: string; dash: string }) {
  return (
    <>
      <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={color} strokeWidth={1.25} strokeDasharray={dash || undefined} opacity={0.85} />
      <text x={width - PAD.right + 6} y={y + 3} fontSize={10} fill={color}>{label}</text>
    </>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function LegendTriangle({ color, up, label }: { color: string; up: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="12" height="12" viewBox="0 0 12 12">
        <polygon
          points={up ? '6,1 11,11 1,11' : '6,11 11,1 1,1'}
          fill={color}
        />
      </svg>
      {label}
    </span>
  );
}