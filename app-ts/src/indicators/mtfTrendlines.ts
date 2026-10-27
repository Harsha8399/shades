/**
 * Multi-timeframe broader-trendline extractor.
 *
 * TypeScript counterpart of `research-py/src/indicators/mtf_trendlines.py`.
 * Implements the design in `docs/stage3/MTF_TRENDLINE_DESIGN.md`:
 *
 *   entry-timeframe candles
 *           |
 *           +-(1) resample to the higher time frame (drop the forming HTF candle)
 *           +-(2) find confirmed swings on the HTF series
 *           +-(3) build candidate trendlines from same-type swing pairs
 *           |       (keep those with >= TRENDLINE_MIN_TOUCHES touches)
 *           +-(4) return the SET of valid lines -- no scoring, no ranking
 *           +-(5) evaluate each line at the entry bar (caller picks the
 *                 binding one)
 *
 * Causality invariants L1-L6 (design doc section 4) are enforced
 * structurally, mirroring the Python implementation exactly.
 *
 * No scoring, no weights, no invented selection criteria.
 */
import { Candle } from "../types";
import { CandleResampler, NseCandleResampler } from "../core/CandleResampler";
import { findSwingPoints, BasicSwingPoint } from "./swingPoints";
import { calculateATR } from "./atr";
import { TRENDLINE_MIN_TOUCHES } from "./trendlines";
/**
 * A candidate broader trendline expressed on the HTF bar axis.
 * Mirrors Python's `BroaderTrendline`.
 */
export interface BroaderTrendline {
	type: "SUPPORT" | "RESISTANCE";
	slope: number; // price change per HTF bar
	intercept: number; // price at HTF index 0
	startIdx: number; // first HTF bar index used
	endIdx: number; // second HTF bar index used
	touches: number; // touch count (informational, NOT a score)
	anchorIndex: number; // index of the last completed HTF candle
	anchorTimestamp: number; // OPEN time (epoch ms) of the anchor HTF candle
	htfBarDeltaMs: number; // HTF bar duration in ms
}

/**
 * Evaluate the line at an entry timestamp (epoch ms).
 *
 * Mapping rule (design doc section 6): the line's price at the last
 * completed HTF bar, extrapolated along the line's own slope by the
 * fraction of an HTF period between that bar's close and the entry
 * timestamp.
 */
export function broaderTrendlinePriceAt(
	tl: BroaderTrendline,
	entryTimestampMs: number,
): number {
	const anchorClose = tl.anchorTimestamp + tl.htfBarDeltaMs;
	const frac = (entryTimestampMs - anchorClose) / tl.htfBarDeltaMs;
	return tl.intercept + tl.slope * (tl.anchorIndex + frac);
}

/** Extractor output: the set of valid lines plus diagnostics. */
export interface MtfTrendlineResult {
	trendlines: BroaderTrendline[];
	nHtfCandles: number;
	nSwingHighs: number;
	nSwingLows: number;
	lastHtfCloseMs: number | null;
}

/** Convert a timeframe string to milliseconds. */
export function timeframeToMs(timeframe: string): number {
	const m: Record<string, number> = {
		"1m": 60_000,
		"5m": 300_000,
		"15m": 900_000,
		"30m": 1_800_000,
		"1h": 3_600_000,
		"4h": 14_400_000,
		"1d": 86_400_000,
		"1w": 604_800_000,
	};
	const v = m[timeframe];
	if (v === undefined) throw new Error(`Unknown timeframe: ${timeframe}`);
	return v;
}

/**
 * Spec-configurable defaults for the broader-trendline extractor.
 *
 * These MUST match SWING_LEFT_BARS / SWING_RIGHT_BARS /
 * TRENDLINE_TOLERANCE_ATR / TRENDLINE_MIN_TOUCHES in
 * shared/fixtures/strategy_spec.json. The spec-drift guard test
 * (mtf-spec-drift.test.ts) pins them, so a change to either side without the
 * other is caught.
 *
 * DEFAULT_MIN_TOUCHES re-exports TRENDLINE_MIN_TOUCHES from ./trendlines so
 * that there is exactly ONE definition of this constant in the TypeScript
 * engine.  The spec-drift test already pins DEFAULT_MIN_TOUCHES against the
 * spec, so TRENDLINE_MIN_TOUCHES is also covered transitively.
 */
export const DEFAULT_SWING_LEFT_BARS = 3;
export const DEFAULT_SWING_RIGHT_BARS = 3;
export const DEFAULT_TOLERANCE_ATR = 0.3;
export { TRENDLINE_MIN_TOUCHES as DEFAULT_MIN_TOUCHES } from "./trendlines";

export function extractBroaderTrendlines(
	candles: Candle[],
	htfTimeframe: string,
	options: {
		asOfIndex?: number;
		swingLeftBars?: number;
		swingRightBars?: number;
		toleranceAtr?: number;
		minTouches?: number;
		entryTimeframe?: string; // Optional: entry timeframe to select correct resampler
	} = {},
): MtfTrendlineResult {
	const {
		asOfIndex = candles.length - 1,
		swingLeftBars = DEFAULT_SWING_LEFT_BARS,
		swingRightBars = DEFAULT_SWING_RIGHT_BARS,
		toleranceAtr = DEFAULT_TOLERANCE_ATR,
		minTouches = TRENDLINE_MIN_TOUCHES,
		entryTimeframe = "15m", // Default to 15m for backward compatibility
	} = options;

	if (asOfIndex < 0 || asOfIndex >= candles.length) {
		throw new Error(`asOfIndex ${asOfIndex} out of range`);
	}

	// --- (1) HTF series: only bars up to the decision bar (L1); only
	// completed HTF candles (L5, the resampler drops the forming chunk).
	const history = candles.slice(0, asOfIndex + 1);
	const htfDeltaMs = timeframeToMs(htfTimeframe);

	// Use NSE-specific session-aware resampler for 30m entry -> 1h HTF
	const isNse30mTo1h = entryTimeframe === "30m" && htfTimeframe === "1h";
	let htf: Candle[];

	if (isNse30mTo1h) {
		htf = NseCandleResampler.resample30mTo1hSessionAligned(history);
	} else {
		htf = CandleResampler.resample(
			history,
			// The resampler takes (ltfMinutes, targetMinutes); derive from deltas.
			deltaToMinutes(history),
			htfDeltaMs / 60_000,
		);
	}

	const nHtf = htf.length;
	if (nHtf === 0) {
		return {
			trendlines: [],
			nHtfCandles: 0,
			nSwingHighs: 0,
			nSwingLows: 0,
			lastHtfCloseMs: null,
		};
	}

	const lastHtfCloseMs = htf[htf.length - 1].timestamp + htfDeltaMs;

	// --- (2) confirmed swings on the HTF series (L2, L3).
	const swings = findSwingPoints(htf, swingLeftBars, swingRightBars);
	// findSwingPoints guarantees confirmedAt <= nHtf - 1; filter explicitly
	// so the invariant is enforced by construction, not by convention.
	const asOfHtf = nHtf - 1;
	const visible = swings.filter((s) => s.confirmedAt <= asOfHtf);
	const highs = visible.filter((s) => s.type === "HIGH");
	const lows = visible.filter((s) => s.type === "LOW");

	// --- (3) candidate lines from same-type swing pairs, filtered by
	// touches. ATR computed on the HTF series only (L6), using the shared
	// Wilder ATR (must match Python's support_resistance.calculate_atr).
	const atr = calculateATR(htf);
	const tolPrice = atr * toleranceAtr;

	function build(
		sw: BasicSwingPoint[],
		type: "SUPPORT" | "RESISTANCE",
	): BroaderTrendline[] {
		const out: BroaderTrendline[] = [];
		for (let i = 0; i < sw.length - 1; i++) {
			for (let j = i + 1; j < sw.length; j++) {
				const s1 = sw[i],
					s2 = sw[j];
				const slope = (s2.price - s1.price) / (s2.index - s1.index);
				const intercept = s1.price - slope * s1.index;
				let touches = 2;
				for (let k = 0; k < sw.length; k++) {
					if (k === i || k === j) continue;
					const expected = intercept + slope * sw[k].index;
					if (Math.abs(sw[k].price - expected) <= tolPrice) touches++;
				}
				if (touches >= minTouches) {
					out.push({
						type,
						slope,
						intercept,
						startIdx: s1.index,
						endIdx: s2.index,
						touches,
						anchorIndex: asOfHtf,
						anchorTimestamp: htf[asOfHtf].timestamp,
						htfBarDeltaMs: htfDeltaMs,
					});
				}
			}
		}
		return out;
	}

	const trendlines = [...build(lows, "SUPPORT"), ...build(highs, "RESISTANCE")];

	return {
		trendlines,
		nHtfCandles: nHtf,
		nSwingHighs: highs.length,
		nSwingLows: lows.length,
		lastHtfCloseMs,
	};
}

/** Derive the LTF minutes from candle spacing (for the resampler call). */
function deltaToMinutes(candles: Candle[]): number {
	if (candles.length < 2) return 60;
	const d = candles[1].timestamp - candles[0].timestamp;
	return Math.round(d / 60_000);
}
