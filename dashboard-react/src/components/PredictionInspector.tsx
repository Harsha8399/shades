import { X, CircleCheck, CircleX, CircleDashed, MinusCircle } from 'lucide-react';
import type { Prediction, ConditionEvaluation } from '../types/replay';

interface PredictionInspectorProps {
  prediction: Prediction;
  onClose?: () => void;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtValue(v: number | string | boolean | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) < 1 ? v.toFixed(4) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(v);
}

function ConditionRow({ condition }: { condition: ConditionEvaluation }) {
  const icon =
    condition.passed === true ? (
      <CircleCheck size={14} className="text-green-400 shrink-0" />
    ) : condition.passed === false ? (
      <CircleX size={14} className="text-red-400 shrink-0" />
    ) : condition.evaluated ? (
      <CircleDashed size={14} className="text-slate-500 shrink-0" />
    ) : (
      <MinusCircle size={14} className="text-slate-600 shrink-0" />
    );
  const statusLabel =
    condition.passed === true ? 'passed' : condition.passed === false ? 'failed' : condition.evaluated ? 'unavailable' : 'not evaluated';

  return (
    <div className="border-b border-slate-800/60 py-2 last:border-0">
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">{condition.label}</span>
            <span
              className={
                'text-xs font-semibold shrink-0 ' +
                (condition.passed === true
                  ? 'text-green-400'
                  : condition.passed === false
                    ? 'text-red-400'
                    : 'text-slate-500')
              }
            >
              {statusLabel}
            </span>
          </div>
          {condition.detail && <div className="text-xs text-slate-400 mt-0.5">{condition.detail}</div>}
          {condition.values && Object.keys(condition.values).length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {Object.entries(condition.values).map(([k, v]) => (
                <span key={k} className="text-[11px] text-slate-500 font-mono">
                  {k}: <span className="text-slate-300">{fmtValue(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  PASS: 'text-green-400 bg-green-400/10',
  FAIL: 'text-red-400 bg-red-400/10',
  SKIPPED: 'text-slate-500 bg-slate-500/10',
  UNAVAILABLE: 'text-slate-500 bg-slate-500/10',
};

export function PredictionInspector({ prediction, onClose }: PredictionInspectorProps) {
  const dir = prediction.direction;
  const dirColor = dir === 'LONG' ? 'text-green-400' : dir === 'SHORT' ? 'text-red-400' : 'text-slate-400';
  const dirLabel = dir === 'LONG' ? '▲ BULLISH (LONG)' : dir === 'SHORT' ? '▼ BEARISH (SHORT)' : 'NO TRADE';

  const snap = prediction.snapshot;
  const trace = prediction.trace;
  const evaluation = prediction.evaluation;
  const isSignal = dir !== 'NO_TRADE';

  const directional = evaluation?.directional;
  const stopTarget = evaluation?.stopTarget;

  const firstBlockingFail = trace?.stages.find(
    s => s.result === 'FAIL' && ['market_context', 'data_sufficient', 'min_confluence', 'rejection_candle', 'risk_reward'].includes(s.id)
  );

  const conditions: ConditionEvaluation[] = snap?.conditions ?? trace?.conditions ?? [];

  return (
    <div className="card h-full">
      <div className="card-header flex justify-between items-start gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-bold text-sm ${dirColor}`}>{dirLabel}</span>
            {evaluation && (
              <span
                className={
                  'text-xs px-2 py-0.5 rounded font-semibold ' +
                  (evaluation.directional.outcome === 'CORRECT'
                    ? 'bg-green-400/10 text-green-400'
                    : evaluation.directional.outcome === 'INCORRECT'
                      ? 'bg-red-400/10 text-red-400'
                      : 'bg-slate-500/10 text-slate-400')
                }
              >
                {evaluation.directional.outcome}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {prediction.symbol} · {new Date(prediction.timestamp).toLocaleString()} · {prediction.timeframe}
          </div>
          <div className="text-xs text-slate-500">
            {prediction.strategyName}
            {snap && ` · v${snap.strategyVersion}`}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0" aria-label="Close inspector">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="card-body space-y-4 text-sm">
        {/* Prediction details */}
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Prediction details</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <Detail label="Signal price" value={fmt(prediction.entryPrice)} />
            <Detail label="Confidence" value={`${(prediction.confidence * 100).toFixed(0)}%`} />
            <Detail label="Stop-loss" value={fmt(prediction.stopLoss)} valueClass="text-red-400" />
            <Detail label="Target" value={fmt(prediction.target)} valueClass="text-green-400" />
            <Detail
              label="Risk : reward"
              value={snap?.levels.riskReward ? `1 : ${snap.levels.riskReward.toFixed(2)}` : '—'}
            />
            <Detail label="Horizon" value={`${prediction.evaluationHorizon.candles} candles`} />
            <Detail label="Candle index" value={String(prediction.candleIndex)} />
            <Detail
              label="Status"
              value={prediction.evaluationStatus}
              valueClass={
                prediction.evaluationStatus === 'COMPLETED'
                  ? 'text-green-400'
                  : prediction.evaluationStatus === 'INCONCLUSIVE'
                    ? 'text-yellow-400'
                    : 'text-slate-400'
              }
            />
          </div>
        </div>

        {/* Outcome */}
        {evaluation && (
          <div className="border-t border-slate-800 pt-3">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Outcome (evaluated on later candles)</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <Detail label="Price change" value={
                `${directional!.priceChange >= 0 ? '+' : ''}${fmt(directional!.priceChange)} pts (${directional!.priceChangePercent >= 0 ? '+' : ''}${directional!.priceChangePercent.toFixed(2)}%)`
              } valueClass={directional!.priceChange >= 0 ? 'text-green-400' : 'text-red-400'} />
              <Detail label="Price at horizon" value={fmt(directional!.horizonPrice)} />
              <Detail label="Max favourable move" value={directional!.maxFavourablePoints !== undefined ? `+${fmt(directional!.maxFavourablePoints)} pts` : '—'} valueClass="text-green-400" />
              <Detail label="Max adverse move" value={directional!.maxAdversePoints !== undefined ? `−${fmt(directional!.maxAdversePoints)} pts` : '—'} valueClass="text-red-400" />
              <Detail label="Stop/target outcome" value={stopTarget!.outcome.replace(/_/g, ' ').toLowerCase()} valueClass={
                stopTarget!.outcome === 'TARGET_FIRST' ? 'text-green-400' : stopTarget!.outcome === 'STOP_FIRST' ? 'text-red-400' : 'text-slate-400'
              } />
              <Detail label="R multiple" value={stopTarget!.rMultiple !== undefined ? `${stopTarget!.rMultiple.toFixed(2)}R` : '—'} />
            </div>
          </div>
        )}

        {/* Why did the engine predict this? */}
        <div className="border-t border-slate-800 pt-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
            {isSignal ? 'Why did the engine predict this?' : 'Why was no trade taken?'}
          </div>
          <p className="text-xs text-slate-500 mb-2">
            Evidence below comes from the engine's actual calculations at prediction time (strategy v
            {snap?.strategyVersion ?? trace?.strategyVersion ?? '—'}).
          </p>

          {/* Evidence summary blocks */}
          {snap?.zone && (
            <div className="mb-2 p-2 bg-slate-800/40 rounded text-xs">
              <span className="text-slate-400">S/R zone: </span>
              <span className="text-slate-200">
                {snap.zone.type} @ {fmt(snap.zone.priceLevel)} ({snap.zone.touches} touches, tolerance ±{fmt(snap.zone.tolerance, 4)})
              </span>
            </div>
          )}
          {snap?.fib && (
            <div className="mb-2 p-2 bg-slate-800/40 rounded text-xs">
              <span className="text-slate-400">Fibonacci: </span>
              <span className="text-slate-200">
                {(snap.fib.ratio * 100).toFixed(1)}% level @ {fmt(snap.fib.priceLevel)} ({snap.fib.direction} retracement)
              </span>
            </div>
          )}
          {snap?.trendline && (
            <div className="mb-2 p-2 bg-slate-800/40 rounded text-xs">
              <span className="text-slate-400">Trendline: </span>
              <span className="text-slate-200">{snap.trendline.type} @ {fmt(snap.trendline.priceLevel)}</span>
            </div>
          )}
          {snap?.rejection && (
            <div className="mb-2 p-2 bg-slate-800/40 rounded text-xs">
              <span className="text-slate-400">Rejection candle: </span>
              <span className="text-slate-200">
                body {fmt(snap.rejection.body)}, lower wick {fmt(snap.rejection.lowerWick)}, upper wick {fmt(snap.rejection.upperWick)},
                wick:body {fmt(snap.rejection.wickRatio)} (min {fmt(snap.rejection.minWickRatio)}), wick touched zone:{' '}
                {snap.rejection.wickTouchesZone ? 'yes' : 'no'}, close beyond zone: {snap.rejection.closeBeyondZone ? 'yes' : 'no'}
              </span>
            </div>
          )}
          {snap?.marketContext && (
            <div className="mb-2 p-2 bg-slate-800/40 rounded text-xs">
              <span className="text-slate-400">Market context: </span>
              <span className="text-slate-200">
                ATR {fmt(snap.marketContext.atr, 4)} · trend {snap.marketContext.trend ?? '—'} · volatility {snap.marketContext.volatility ?? '—'} · {snap.candlesAvailable} candles available
              </span>
            </div>
          )}

          {/* Condition list */}
          {conditions.length > 0 ? (
            <div className="mt-1">
              {conditions.map((c, i) => <ConditionRow key={`${c.id}-${i}`} condition={c} />)}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No condition-level evidence recorded for this prediction.</div>
          )}

          {/* Decision line */}
          <div className="mt-2 text-sm">
            {isSignal ? (
              <span className="text-slate-200">
                Decision: <span className={dirColor}>{dirLabel} signal generated</span>
                {' — '}{conditions.filter(c => c.passed === true).length} of {conditions.filter(c => c.evaluated).length} evaluated conditions passed.
              </span>
            ) : firstBlockingFail ? (
              <span className="text-slate-400">
                Decision: no trade — <span className="text-red-400">{firstBlockingFail.label}</span> failed
                {firstBlockingFail.detail ? ` (${firstBlockingFail.detail})` : ''}.
              </span>
            ) : (
              <span className="text-slate-400">Decision: no trade — strategy conditions were not met.</span>
            )}
          </div>
        </div>

        {/* Decision trace */}
        {trace && trace.stages.length > 0 && (
          <div className="border-t border-slate-800 pt-3">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Decision trace</div>
            <ol className="space-y-1.5">
              {trace.stages.map((s, i) => (
                <li key={`${s.id}-${i}`} className="flex items-start gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${STAGE_COLORS[s.result] || 'text-slate-500 bg-slate-500/10'}`}>
                    {s.result}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs text-slate-200">{s.label}</div>
                    {s.detail && <div className="text-[11px] text-slate-500">{s.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Evaluation rule */}
        <div className="border-t border-slate-800 pt-3 text-[11px] text-slate-500">
          A prediction is scored only on candles that closed after the signal candle. Directional accuracy does not imply option
          profitability — index-point evaluation only.
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-mono ${valueClass || 'text-slate-200'}`}>{value}</div>
    </div>
  );
}