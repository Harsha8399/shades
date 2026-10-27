import { Candle } from "../types";

/**
 * Basic swing point representation for indicators
 * (See types/structure.ts for the more detailed SwingPoint used in market structure analysis)
 */
export interface BasicSwingPoint {
	type: "HIGH" | "LOW";
	price: number;
	index: number;
	timestamp: number;
	/**
	 * Index of the last candle required to prove this swing.
	 *
	 * For a fractal with `rightBars` confirmation bars, a swing at index `k` is
	 * only knowable at `k + rightBars` -- before that a later candle could still
	 * invalidate it. This mirrors `ConfirmedSwing.confirmed_at` in
	 * `research-py/src/indicators/trendlines.py`.
	 *
	 * Swings returned by `findSwingPoints` already satisfy
	 * `k + rightBars <= candles.length - 1`, so they are all confirmed by the
	 * data supplied; `confirmedAt` makes that guarantee explicit and testable,
	 * and lets callers filter when they pass a wider window.
	 */
	confirmedAt: number;
}

/**
 * Find swing highs and lows in price data
 * A swing high has lower highs on both sides
 * A swing low has higher lows on both sides
 *
 * @param candles - Array of OHLCV candles
 * @param leftBars - Bars to look left (default: 3)
 * @param rightBars - Bars to look right (default: 3)
 */
export function findSwingPoints(
	candles: Candle[],
	leftBars: number = 3,
	rightBars: number = 3,
): BasicSwingPoint[] {
	const swings: BasicSwingPoint[] = [];

	if (candles.length < leftBars + rightBars + 1) {
		return swings;
	}

	for (let i = leftBars; i < candles.length - rightBars; i++) {
		const current = candles[i];

		// Check for swing high
		let isSwingHigh = true;
		for (let j = i - leftBars; j < i; j++) {
			if (candles[j].high >= current.high) {
				isSwingHigh = false;
				break;
			}
		}
		if (isSwingHigh) {
			for (let j = i + 1; j <= i + rightBars; j++) {
				if (candles[j].high >= current.high) {
					isSwingHigh = false;
					break;
				}
			}
		}

		if (isSwingHigh) {
			swings.push({
				type: "HIGH",
				price: current.high,
				index: i,
				timestamp: current.timestamp,
				confirmedAt: i + rightBars,
			});
		}

		// Check for swing low
		let isSwingLow = true;
		for (let j = i - leftBars; j < i; j++) {
			if (candles[j].low <= current.low) {
				isSwingLow = false;
				break;
			}
		}
		if (isSwingLow) {
			for (let j = i + 1; j <= i + rightBars; j++) {
				if (candles[j].low <= current.low) {
					isSwingLow = false;
					break;
				}
			}
		}

		if (isSwingLow) {
			swings.push({
				type: "LOW",
				price: current.low,
				index: i,
				timestamp: current.timestamp,
				confirmedAt: i + rightBars,
			});
		}
	}

	// Sort by index
	return swings.sort((a, b) => a.index - b.index);
}

/**
 * Find most recent swing high
 */
export function findRecentSwingHigh(
	candles: Candle[],
	leftBars: number = 3,
): BasicSwingPoint | null {
	const swings = findSwingPoints(candles.slice(0, -1), leftBars, 1);
	const highs = swings.filter((s) => s.type === "HIGH");
	return highs.length > 0 ? highs[highs.length - 1] : null;
}

/**
 * Find most recent swing low
 */
export function findRecentSwingLow(
	candles: Candle[],
	leftBars: number = 3,
): BasicSwingPoint | null {
	const swings = findSwingPoints(candles.slice(0, -1), leftBars, 1);
	const lows = swings.filter((s) => s.type === "LOW");
	return lows.length > 0 ? lows[lows.length - 1] : null;
}

/**
 * Detect trend direction based on swing points
 */
export function detectTrend(
	candles: Candle[],
	minSwings: number = 4,
): "UP" | "DOWN" | "RANGE" {
	const swings = findSwingPoints(candles, 5, 2);

	if (swings.length < minSwings) {
		return "RANGE";
	}

	const recentSwings = swings.slice(-minSwings);
	const highs = recentSwings.filter((s) => s.type === "HIGH");
	const lows = recentSwings.filter((s) => s.type === "LOW");

	if (highs.length < 2 || lows.length < 2) {
		return "RANGE";
	}

	// Check for higher highs and higher lows (uptrend)
	const lastTwoHighs = highs.slice(-2);
	const lastTwoLows = lows.slice(-2);

	const higherHighs = lastTwoHighs[1].price > lastTwoHighs[0].price;
	const higherLows = lastTwoLows[1].price > lastTwoLows[0].price;

	const lowerHighs = lastTwoHighs[1].price < lastTwoHighs[0].price;
	const lowerLows = lastTwoLows[1].price < lastTwoLows[0].price;

	if (higherHighs && higherLows) return "UP";
	if (lowerHighs && lowerLows) return "DOWN";
	return "RANGE";
}
