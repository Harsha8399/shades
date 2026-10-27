/**
 * MTF broader-trendline extractor tests.
 *
 * Mirrors `research-py/tests/test_mtf_trendlines.py`. The decisive test is
 * the prefix test: extractor output at a prefix's last bar must be
 * identical whether or not future data is present (covers L1-L6 at once).
 *
 * No scoring or ranking rules are tested because none exist.
 */
import { Candle } from "../src/types";
import {
	BroaderTrendline,
	broaderTrendlinePriceAt,
	extractBroaderTrendlines,
} from "../src/indicators/mtfTrendlines";

const HOUR_MS = 3_600_000;

function makeSineCandles(n: number, startMs = Date.UTC(2024, 0, 1)): Candle[] {
	// A sine wave guarantees regular swing highs and lows on any timeframe.
	const out: Candle[] = [];
	for (let i = 0; i < n; i++) {
		const base = 100 + 10 * Math.sin(i / 6);
		out.push({
			timestamp: startMs + i * HOUR_MS,
			open: base,
			high: base + 1,
			low: base - 1,
			close: base + 0.25,
			volume: 1000,
		});
	}
	return out;
}

function lineKey(tl: BroaderTrendline): string {
	return [
		tl.type,
		tl.slope.toFixed(10),
		tl.intercept.toFixed(10),
		tl.startIdx,
		tl.endIdx,
		tl.touches,
	].join("|");
}

function sortedKeys(tls: BroaderTrendline[]): string[] {
	return tls.map(lineKey).sort();
}

describe("MTF extractor basics", () => {
	it("returns lines from sufficient history", () => {
		const candles = makeSineCandles(400); // 400 hourly -> ~16 4h candles
		const res = extractBroaderTrendlines(candles, "4h");
		expect(res.nHtfCandles).toBeGreaterThan(0);
		expect(res.trendlines.length).toBeGreaterThan(0);
		for (const tl of res.trendlines) {
			expect(["SUPPORT", "RESISTANCE"]).toContain(tl.type);
			expect(tl.touches).toBeGreaterThanOrEqual(2);
		}
	});

	it("no lines from short history", () => {
		const res = extractBroaderTrendlines(makeSineCandles(2), "4h");
		expect(res.trendlines).toEqual([]);
		expect(res.nHtfCandles).toBe(0);
		expect(res.lastHtfCloseMs).toBeNull();
	});

	it("no fallback on missing trendline (flat series)", () => {
		// A flat series has no swings, hence no trendlines. The extractor must
		// return an EMPTY SET -- never a fallback or default line.
		const candles: Candle[] = [];
		for (let i = 0; i < 200; i++) {
			candles.push({
				timestamp: Date.UTC(2024, 0, 1) + i * HOUR_MS,
				open: 100,
				high: 100.5,
				low: 99.5,
				close: 100,
				volume: 1000,
			});
		}
		const res = extractBroaderTrendlines(candles, "4h");
		expect(res.trendlines).toEqual([]);
		expect(res.nHtfCandles).toBeGreaterThan(0);
	});

	it("price_at evaluation matches the mapping rule", () => {
		const res = extractBroaderTrendlines(makeSineCandles(400), "4h");
		const tl = res.trendlines[0];
		const anchorClose = tl.anchorTimestamp + tl.htfBarDeltaMs;
		const p = broaderTrendlinePriceAt(tl, anchorClose);
		const expected = tl.intercept + tl.slope * tl.anchorIndex;
		expect(p).toBeCloseTo(expected, 8);

		// One full HTF period later adds exactly one slope.
		const p2 = broaderTrendlinePriceAt(tl, anchorClose + tl.htfBarDeltaMs);
		expect(p2).toBeCloseTo(expected + tl.slope, 8);
	});
});

describe("MTF extractor causality", () => {
	const full = makeSineCandles(400);

	it("prefix test (decisive): output at a prefix last bar is identical", () => {
		for (const cut of [100, 200, 300, 380]) {
			const prefixRes = extractBroaderTrendlines(full.slice(0, cut), "4h");
			const fullAsOf = extractBroaderTrendlines(full, "4h", {
				asOfIndex: cut - 1,
			});
			expect(fullAsOf.nHtfCandles).toBe(prefixRes.nHtfCandles);
			expect(fullAsOf.lastHtfCloseMs).toBe(prefixRes.lastHtfCloseMs);
			expect(fullAsOf.nSwingHighs).toBe(prefixRes.nSwingHighs);
			expect(fullAsOf.nSwingLows).toBe(prefixRes.nSwingLows);
			expect(sortedKeys(fullAsOf.trendlines)).toEqual(
				sortedKeys(prefixRes.trendlines),
			);
		}
	});

	it("appending future bars does not change line parameters (L4)", () => {
		const k = 250;
		const asOfFull = extractBroaderTrendlines(full, "4h", { asOfIndex: k });
		const prefix = extractBroaderTrendlines(full.slice(0, k + 1), "4h");
		expect(sortedKeys(asOfFull.trendlines)).toEqual(
			sortedKeys(prefix.trendlines),
		);
	});

	it("no forming HTF candle is used (L5)", () => {
		const asOf = 250;
		const res = extractBroaderTrendlines(full, "4h", { asOfIndex: asOf });
		const decisionTs = full[asOf].timestamp;
		expect(res.lastHtfCloseMs!).toBeLessThanOrEqual(decisionTs + HOUR_MS);
	});

	it("HTF ATR is independent of future entry bars (L6)", () => {
		const k = 250;
		const res1 = extractBroaderTrendlines(full, "4h", { asOfIndex: k });

		// Mutate far-future entry bars; the as-of result must not change.
		const mutated = full.map((c, i) =>
			i > k ? { ...c, high: c.high + 50 } : c,
		);
		const res2 = extractBroaderTrendlines(mutated, "4h", { asOfIndex: k });

		expect(sortedKeys(res1.trendlines)).toEqual(sortedKeys(res2.trendlines));
	});

	it("validates asOfIndex", () => {
		expect(() =>
			extractBroaderTrendlines(makeSineCandles(100), "4h", { asOfIndex: 100 }),
		).toThrow();
		expect(() =>
			extractBroaderTrendlines(makeSineCandles(100), "4h", { asOfIndex: -1 }),
		).toThrow();
	});
});

describe("MTF extractor: 5m and 1d timeframe validation", () => {
	const FIVE_M = 5 * 60 * 1000;
	const ONE_H = 60 * 60 * 1000;
	const ONE_D = 24 * 60 * 60 * 1000;
	const ONE_W = 7 * 24 * 60 * 60 * 1000;

	function make5mCandles(
		n: number,
		startMs = Date.UTC(2024, 0, 1, 9, 15),
	): Candle[] {
		// NSE market hours: 9:15 to 15:30
		// 5m candles within session
		const out: Candle[] = [];
		for (let i = 0; i < n; i++) {
			const base = 100 + 10 * Math.sin(i / 20);
			out.push({
				timestamp: startMs + i * FIVE_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		return out;
	}

	function make30mCandles(
		n: number,
		startMs = Date.UTC(2024, 0, 1, 9, 15),
	): Candle[] {
		// NSE market hours: 9:15 to 15:30
		// 30m candles within session
		const out: Candle[] = [];
		const THIRTY_M = 30 * 60 * 1000;
		for (let i = 0; i < n; i++) {
			const base = 100 + 10 * Math.sin(i / 10);
			out.push({
				timestamp: startMs + i * THIRTY_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		return out;
	}

	function make1dCandles(n: number, startMs = Date.UTC(2024, 0, 1)): Candle[] {
		const out: Candle[] = [];
		for (let i = 0; i < n; i++) {
			const base = 100 + 10 * Math.sin(i / 10);
			out.push({
				timestamp: startMs + i * ONE_D,
				open: base,
				high: base + 2,
				low: base - 2,
				close: base + 0.5,
				volume: 10000,
			});
		}
		return out;
	}

	it("extracts trendlines from 5m entry timeframe with 1h HTF", () => {
		// 5m entry -> 1h HTF per spec hierarchy
		// Need enough 5m candles to form several 1h HTF candles
		// 1h = 12 * 5m candles, need ~50 1h candles = 600 5m candles
		const candles = make5mCandles(600);
		const res = extractBroaderTrendlines(candles, "1h");
		expect(res.nHtfCandles).toBeGreaterThan(10);
		expect(res.trendlines.length).toBeGreaterThan(0);
		for (const tl of res.trendlines) {
			expect(["SUPPORT", "RESISTANCE"]).toContain(tl.type);
			expect(tl.touches).toBeGreaterThanOrEqual(2);
		}
	});

	it("extracts trendlines from 1d entry timeframe with 1w HTF", () => {
		// 1d entry -> 1w HTF per spec hierarchy
		// 1w = 5 1d candles (trading days), need ~30 1w candles = 150 1d candles
		const candles = make1dCandles(200);
		const res = extractBroaderTrendlines(candles, "1w");
		expect(res.nHtfCandles).toBeGreaterThan(10);
		expect(res.trendlines.length).toBeGreaterThan(0);
		for (const tl of res.trendlines) {
			expect(["SUPPORT", "RESISTANCE"]).toContain(tl.type);
			expect(tl.touches).toBeGreaterThanOrEqual(2);
		}
	});

	it("no lines from short history for 5m->1h", () => {
		const res = extractBroaderTrendlines(make5mCandles(10), "1h");
		expect(res.trendlines).toEqual([]);
		expect(res.nHtfCandles).toBe(0);
		expect(res.lastHtfCloseMs).toBeNull();
	});

	it("no lines from short history for 1d->1w", () => {
		const res = extractBroaderTrendlines(make1dCandles(3), "1w");
		expect(res.trendlines).toEqual([]);
		expect(res.nHtfCandles).toBe(0);
		expect(res.lastHtfCloseMs).toBeNull();
	});

	it("prefix test for 5m->1h (causality invariant)", () => {
		const full = make5mCandles(600);
		for (const cut of [150, 300, 450, 550]) {
			const prefixRes = extractBroaderTrendlines(full.slice(0, cut), "1h");
			const fullAsOf = extractBroaderTrendlines(full, "1h", {
				asOfIndex: cut - 1,
			});
			expect(fullAsOf.nHtfCandles).toBe(prefixRes.nHtfCandles);
			expect(fullAsOf.lastHtfCloseMs).toBe(prefixRes.lastHtfCloseMs);
			expect(sortedKeys(fullAsOf.trendlines)).toEqual(
				sortedKeys(prefixRes.trendlines),
			);
		}
	});

	it("prefix test for 1d->1w (causality invariant)", () => {
		const full = make1dCandles(200);
		for (const cut of [50, 100, 150, 180]) {
			const prefixRes = extractBroaderTrendlines(full.slice(0, cut), "1w");
			const fullAsOf = extractBroaderTrendlines(full, "1w", {
				asOfIndex: cut - 1,
			});
			expect(fullAsOf.nHtfCandles).toBe(prefixRes.nHtfCandles);
			expect(fullAsOf.lastHtfCloseMs).toBe(prefixRes.lastHtfCloseMs);
			expect(sortedKeys(fullAsOf.trendlines)).toEqual(
				sortedKeys(prefixRes.trendlines),
			);
		}
	});

	it("extracts trendlines from 30m entry timeframe with 1h HTF", () => {
		// 30m entry -> 1h HTF per spec hierarchy
		// 1h = 2 * 30m candles, need ~50 1h candles = 100 30m candles
		const candles = make30mCandles(120);
		const res = extractBroaderTrendlines(candles, "1h");
		expect(res.nHtfCandles).toBeGreaterThan(10);
		expect(res.trendlines.length).toBeGreaterThan(0);
		for (const tl of res.trendlines) {
			expect(["SUPPORT", "RESISTANCE"]).toContain(tl.type);
			expect(tl.touches).toBeGreaterThanOrEqual(2);
		}
	});

	it("no lines from short history for 30m->1h", () => {
		// 5 30m candles = 2 full 1h candles + partial -> 2 HTF candles
		// But not enough for swing points (need 5+5=10 bars lookback)
		const res = extractBroaderTrendlines(make30mCandles(5), "1h");
		expect(res.trendlines).toEqual([]);
		expect(res.nHtfCandles).toBe(2);
		expect(res.lastHtfCloseMs).not.toBeNull();
	});

	it("prefix test for 30m->1h (causality invariant)", () => {
		const full = make30mCandles(120);
		for (const cut of [30, 60, 90, 110]) {
			const prefixRes = extractBroaderTrendlines(full.slice(0, cut), "1h");
			const fullAsOf = extractBroaderTrendlines(full, "1h", {
				asOfIndex: cut - 1,
			});
			expect(fullAsOf.nHtfCandles).toBe(prefixRes.nHtfCandles);
			expect(fullAsOf.lastHtfCloseMs).toBe(prefixRes.lastHtfCloseMs);
			expect(sortedKeys(fullAsOf.trendlines)).toEqual(
				sortedKeys(prefixRes.trendlines),
			);
		}
	});

	it("no forming HTF candle used for 30m->1h (L5)", () => {
		const full = make30mCandles(80);
		const asOf = 60;
		const res = extractBroaderTrendlines(full, "1h", { asOfIndex: asOf });
		const decisionTs = full[asOf].timestamp;
		expect(res.lastHtfCloseMs!).toBeLessThanOrEqual(decisionTs + ONE_H);
	});

	it("HTF ATR independent of future entry bars for 30m->1h (L6)", () => {
		const full = make30mCandles(80);
		const k = 60;
		const res1 = extractBroaderTrendlines(full, "1h", { asOfIndex: k });

		// Mutate far-future entry bars
		const mutated = full.map((c, i) =>
			i > k ? { ...c, high: c.high + 50 } : c,
		);
		const res2 = extractBroaderTrendlines(mutated, "1h", { asOfIndex: k });

		expect(sortedKeys(res1.trendlines)).toEqual(sortedKeys(res2.trendlines));
	});

	it("no forming HTF candle used for 5m->1h (L5)", () => {
		const full = make5mCandles(300);
		const asOf = 200;
		const res = extractBroaderTrendlines(full, "1h", { asOfIndex: asOf });
		const decisionTs = full[asOf].timestamp;
		expect(res.lastHtfCloseMs!).toBeLessThanOrEqual(decisionTs + ONE_H);
	});

	it("no forming HTF candle used for 1d->1w (L5)", () => {
		const full = make1dCandles(100);
		const asOf = 60;
		const res = extractBroaderTrendlines(full, "1w", { asOfIndex: asOf });
		const decisionTs = full[asOf].timestamp;
		expect(res.lastHtfCloseMs!).toBeLessThanOrEqual(decisionTs + ONE_D);
	});

	it("HTF ATR independent of future entry bars for 5m->1h (L6)", () => {
		const full = make5mCandles(300);
		const k = 200;
		const res1 = extractBroaderTrendlines(full, "1h", { asOfIndex: k });

		// Mutate far-future entry bars
		const mutated = full.map((c, i) =>
			i > k ? { ...c, high: c.high + 50 } : c,
		);
		const res2 = extractBroaderTrendlines(mutated, "1h", { asOfIndex: k });

		expect(sortedKeys(res1.trendlines)).toEqual(sortedKeys(res2.trendlines));
	});

	it("HTF ATR independent of future entry bars for 1d->1w (L6)", () => {
		const full = make1dCandles(100);
		const k = 50;
		const res1 = extractBroaderTrendlines(full, "1w", { asOfIndex: k });

		// Mutate far-future entry bars
		const mutated = full.map((c, i) =>
			i > k ? { ...c, high: c.high + 50 } : c,
		);
		const res2 = extractBroaderTrendlines(mutated, "1w", { asOfIndex: k });

		expect(sortedKeys(res1.trendlines)).toEqual(sortedKeys(res2.trendlines));
	});
});
