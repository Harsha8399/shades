/**
 * Swing confirmation semantics — cross-engine parity guard.
 *
 * Verifies that the TypeScript `findSwingPoints` `confirmedAt` field matches
 * the Python `find_confirmed_swings` `confirmed_at` semantics exactly:
 *   - confirmedAt = index + rightBars
 *   - every returned swing satisfies confirmedAt <= candles.length - 1
 *   - a swing is usable only from bar confirmedAt onward
 *   - boundary conditions: too-short input, swing at the earliest possible
 *     index, swing confirmed exactly at the last bar
 */
import { findSwingPoints } from "../src/indicators/swingPoints";
import { makeCandles } from "./helpers";

function rows(n: number, base = 100): Array<[number, number, number, number]> {
	const out: Array<[number, number, number, number]> = [];
	for (let i = 0; i < n; i++) {
		const b = base + (i % 10) * 0.5;
		out.push([b, b + 1, b - 1, b + 0.25]);
	}
	return out;
}

describe("swing confirmation semantics (parity with Python)", () => {
	it("confirmedAt equals index + rightBars for every swing", () => {
		const candles = makeCandles(rows(40));
		const swings = findSwingPoints(candles, 3, 3);
		expect(swings.length).toBeGreaterThan(0);
		for (const s of swings) {
			expect(s.confirmedAt).toBe(s.index + 3);
		}
	});

	it("every returned swing is confirmed within the supplied data", () => {
		// The Python guarantee: confirmed_at <= len(df) - 1.
		const candles = makeCandles(rows(40));
		const swings = findSwingPoints(candles, 3, 3);
		for (const s of swings) {
			expect(s.confirmedAt).toBeLessThanOrEqual(candles.length - 1);
		}
	});

	it("a swing is not usable before its confirmation bar", () => {
		// Construct an unambiguous swing high at index 3 (rising into it,
		// falling after). With rightBars=3 it is confirmed at index 6.
		const c = makeCandles([
			[100, 101, 99, 100], // 0
			[100, 102, 99, 101], // 1
			[101, 103, 100, 102], // 2
			[102, 105, 101, 104], // 3  <- swing high
			[103, 104, 102, 103], // 4
			[102, 103, 101, 102], // 5
			[101, 102, 100, 101], // 6  <- confirms the swing
			[100, 101, 99, 100], // 7
		]);
		const swings = findSwingPoints(c, 3, 3);
		const swingHigh = swings.find((s) => s.type === "HIGH");
		expect(swingHigh).not.toBeNull();
		expect(swingHigh!.index).toBe(3);
		expect(swingHigh!.confirmedAt).toBe(6);

		// Filtering at as_of = 5 must EXCLUDE it; at as_of = 6 it is visible.
		const visibleAt5 = swings.filter((s) => s.confirmedAt <= 5);
		const visibleAt6 = swings.filter((s) => s.confirmedAt <= 6);
		expect(visibleAt5.find((s) => s.index === 3)).toBeUndefined();
		expect(visibleAt6.find((s) => s.index === 3)).toBeDefined();
	});

	it("too-short input returns no swings (boundary)", () => {
		// leftBars + rightBars + 1 = 7 candles is the minimum.
		expect(findSwingPoints(makeCandles(rows(6)), 3, 3)).toEqual([]);
	});

	it("a swing confirmed exactly at the last bar is returned (boundary)", () => {
		// Swing at index 3 with rightBars=3 confirms at index 6, which is the
		// last bar of an 7-candle series. It must still be returned.
		const c = makeCandles([
			[100, 101, 99, 100],
			[100, 102, 99, 101],
			[101, 103, 100, 102],
			[102, 105, 101, 104], // swing high
			[103, 104, 102, 103],
			[102, 103, 101, 102],
			[101, 102, 100, 101], // confirmation bar == last bar
		]);
		const swings = findSwingPoints(c, 3, 3);
		expect(
			swings.find((s) => s.type === "HIGH" && s.index === 3),
		).toBeDefined();
	});
});
