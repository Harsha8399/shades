/**
 * Phase 2 prefix tests: detect look-ahead bias in HTF resampling.
 *
 * A causal resampler must never emit a higher-timeframe candle whose period
 * has not fully completed at the point in history where it is consumed.
 * These tests feed truncated prefixes of synthetic data and assert that the
 * resampler output for a given HTF period is identical whether or not the
 * data *after* that period is present.
 */
import {
	CandleResampler,
	NseCandleResampler,
} from "../src/core/CandleResampler";
import { makeCandles } from "./helpers";
import { Candle } from "../src/types";

function rows(n: number, base = 100): Array<[number, number, number, number]> {
	const out: Array<[number, number, number, number]> = [];
	for (let i = 0; i < n; i++) {
		const b = base + (i % 10) * 0.5;
		out.push([b, b + 1, b - 1, b + 0.25]);
	}
	return out;
}

describe("CandleResampler causality (Phase 2 prefix tests)", () => {
	it("prefix output is stable: resampling a prefix matches the full series", () => {
		const full = makeCandles(rows(96 * 4)); // 4 days of hourly candles
		const fullRes = CandleResampler.resample(full, 60, 240);

		for (const cut of [50, 100, 200, 300]) {
			const prefix = full.slice(0, cut);
			const prefixRes = CandleResampler.resample(prefix, 60, 240);
			expect(prefixRes.length).toBeLessThanOrEqual(fullRes.length);
			prefixRes.forEach((a, i) => {
				const b = fullRes[i];
				expect(a.timestamp).toBe(b.timestamp);
				expect(a.open).toBe(b.open);
				expect(a.high).toBe(b.high);
				expect(a.low).toBe(b.low);
				expect(a.close).toBe(b.close);
				expect(a.volume).toBe(b.volume);
			});
		}
	});

	it("never emits a forming bar when the input ends mid-period", () => {
		// 10 hourly candles = 2 full 4h periods + 2 leftover candles.
		const candles = makeCandles(rows(10));
		const res = CandleResampler.resample(candles, 60, 240);
		expect(res.length).toBe(2);
	});

	it("empty and short inputs produce no output", () => {
		expect(CandleResampler.resample([], 60, 240)).toEqual([]);
		expect(CandleResampler.resample(makeCandles(rows(2)), 60, 240)).toEqual([]);
	});

	it("appending future candles does not change historical buckets", () => {
		// The decisive look-ahead test: resampling the series truncated at
		// bar k, then resampling the FULL series, must give the same candles
		// for every bucket that closed at or before bar k.
		const full = makeCandles(rows(96 * 4)); // 4 days
		const k = 150; // decision point

		const prefixRes = CandleResampler.resample(full.slice(0, k), 60, 240);
		const fullRes = CandleResampler.resample(full, 60, 240);

		expect(prefixRes.length).toBeGreaterThan(0);
		prefixRes.forEach((a, i) => {
			const b = fullRes[i];
			expect(a.timestamp).toBe(b.timestamp);
			expect(a.open).toBe(b.open);
			expect(a.high).toBe(b.high);
			expect(a.low).toBe(b.low);
			expect(a.close).toBe(b.close);
			expect(a.volume).toBe(b.volume);
		});
		// Future data adds buckets; it never rewrites existing ones.
		expect(fullRes.length).toBeGreaterThan(prefixRes.length);
	});

	it("wall-clock anchoring matches the Python resampler convention", () => {
		// Epoch-aligned buckets: a 4h bucket starts at epoch multiples of 4h.
		// 2024-01-01T00:00Z is such a multiple, so buckets are 00:00, 04:00...
		const candles = makeCandles(rows(10));
		const res = CandleResampler.resample(candles, 60, 240);
		const FOUR_H = 4 * 60 * 60 * 1000;
		res.forEach((c) => expect(c.timestamp % FOUR_H).toBe(0));
	});
});

describe("Resampler: 5m and 1d timeframe validation", () => {
	it("resamples 1m to 5m (5m HTF for 1m entry per spec hierarchy)", () => {
		// Create 1m candles (1 minute each) starting at a 5-minute boundary
		const startMs = Date.UTC(2024, 0, 1, 9, 15); // 9:15 is a 5-min boundary
		const ONE_M = 60 * 1000;
		const FIVE_M = 5 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 20 * 5; i++) {
			// 100 1m candles = 20 5m periods
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * ONE_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const res = CandleResampler.resample(candles, 1, 5);
		// 100 1m candles / 5 = 20 5m candles
		expect(res.length).toBe(20);
		res.forEach((c) => expect(c.timestamp % FIVE_M).toBe(0));
	});

	it("resamples 5m to 1h (1h HTF for 5m entry per spec hierarchy)", () => {
		// Create 5m candles (5 minutes each) starting at an hour boundary
		const startMs = Date.UTC(2024, 0, 1, 9, 0); // 9:00 UTC = hour boundary
		const FIVE_M = 5 * 60 * 1000;
		const ONE_H = 60 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 12 * 12; i++) {
			// 144 5m candles = 12 hours
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * FIVE_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const res = CandleResampler.resample(candles, 5, 60);
		// 144 5m candles / 12 = 12 hourly candles
		expect(res.length).toBe(12);
		res.forEach((c) => expect(c.timestamp % ONE_H).toBe(0));
	});

	it("resamples 4h to 1d (1d HTF for 4h entry per spec hierarchy)", () => {
		// Create 4h candles (240 minutes each)
		const startMs = Date.UTC(2024, 0, 1);
		const FOUR_H = 4 * 60 * 60 * 1000;
		const ONE_D = 24 * 60 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 24; i++) {
			// 24 4h candles = 4 days (6 4h per day)
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * FOUR_H,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const res = CandleResampler.resample(candles, 240, 1440);
		// 24 4h candles / 6 = 4 daily candles
		expect(res.length).toBe(4);
		res.forEach((c) => expect(c.timestamp % ONE_D).toBe(0));
	});

	it("resamples 1d to 1w (1w HTF for 1d entry per spec hierarchy)", () => {
		// Start at epoch-aligned week boundary (Thursday 00:00 UTC)
		// 2024-01-04 is a Thursday
		const startMs = Date.UTC(2024, 0, 4);
		const ONE_D = 24 * 60 * 60 * 1000;
		const ONE_W = 7 * 24 * 60 * 60 * 1000;
		// Create DAILY candles (1440 minutes each) - 7 calendar days per week
		const candles: Candle[] = [];
		for (let i = 0; i < 35; i++) {
			// 35 daily candles = 5 weeks (7 calendar days each)
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * ONE_D,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const res = CandleResampler.resample(candles, 1440, 10080);
		// 35 daily candles / 7 = 5 weekly candles (7 calendar days per week)
		expect(res.length).toBe(5);
		res.forEach((c) => expect(c.timestamp % ONE_W).toBe(0));
	});

	it("prefix test for 1m->5m resampling (causality invariant)", () => {
		const full = makeCandles(rows(50 * 5)); // 50 5m periods
		const fullRes = CandleResampler.resample(full, 1, 5);

		for (const cut of [25, 50, 100, 200]) {
			const prefix = full.slice(0, cut);
			const prefixRes = CandleResampler.resample(prefix, 1, 5);
			expect(prefixRes.length).toBeLessThanOrEqual(fullRes.length);
			prefixRes.forEach((a, i) => {
				const b = fullRes[i];
				expect(a.timestamp).toBe(b.timestamp);
				expect(a.open).toBe(b.open);
				expect(a.high).toBe(b.high);
				expect(a.low).toBe(b.low);
				expect(a.close).toBe(b.close);
				expect(a.volume).toBe(b.volume);
			});
		}
	});

	it("prefix test for 4h->1d resampling (causality invariant)", () => {
		const full = makeCandles(rows(20 * 4)); // 20 1d periods
		const fullRes = CandleResampler.resample(full, 240, 1440);

		for (const cut of [20, 40, 60, 80]) {
			const prefix = full.slice(0, cut);
			const prefixRes = CandleResampler.resample(prefix, 240, 1440);
			expect(prefixRes.length).toBeLessThanOrEqual(fullRes.length);
			prefixRes.forEach((a, i) => {
				const b = fullRes[i];
				expect(a.timestamp).toBe(b.timestamp);
				expect(a.open).toBe(b.open);
				expect(a.high).toBe(b.high);
				expect(a.low).toBe(b.low);
				expect(a.close).toBe(b.close);
				expect(a.volume).toBe(b.volume);
			});
		}
	});

	it("resamples 1m to 30m (30m HTF for 1m entry)", () => {
		// Create 1m candles (1 minute each) starting at a 30-minute boundary
		const startMs = Date.UTC(2024, 0, 1, 9, 0); // 9:00 UTC = 30-min boundary
		const ONE_M = 60 * 1000;
		const THIRTY_M = 30 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 20 * 30; i++) {
			// 600 1m candles = 20 30m periods
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * ONE_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const res = CandleResampler.resample(candles, 1, 30);
		// 600 1m candles / 30 = 20 30m candles
		expect(res.length).toBe(20);
		res.forEach((c) => expect(c.timestamp % THIRTY_M).toBe(0));
	});

	it("resamples 30m to 1h (1h HTF for 30m entry per spec hierarchy)", () => {
		// Create 30m candles (30 minutes each) starting at an hour boundary
		const startMs = Date.UTC(2024, 0, 1, 9, 0); // 9:00 UTC = hour boundary
		const THIRTY_M = 30 * 60 * 1000;
		const ONE_H = 60 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 12 * 2; i++) {
			// 24 30m candles = 12 hours
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * THIRTY_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const res = CandleResampler.resample(candles, 30, 60);
		// 24 30m candles / 2 = 12 hourly candles
		expect(res.length).toBe(12);
		res.forEach((c) => expect(c.timestamp % ONE_H).toBe(0));
	});

	it("prefix test for 1m->30m resampling (causality invariant)", () => {
		const startMs = Date.UTC(2024, 0, 1, 9, 0);
		const ONE_M = 60 * 1000;
		const THIRTY_M = 30 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 50 * 30; i++) {
			// 1500 1m candles = 50 30m periods
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * ONE_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const fullRes = CandleResampler.resample(candles, 1, 30);

		for (const cut of [150, 300, 600, 900]) {
			const prefix = candles.slice(0, cut);
			const prefixRes = CandleResampler.resample(prefix, 1, 30);
			expect(prefixRes.length).toBeLessThanOrEqual(fullRes.length);
			prefixRes.forEach((a, i) => {
				const b = fullRes[i];
				expect(a.timestamp).toBe(b.timestamp);
				expect(a.open).toBe(b.open);
				expect(a.high).toBe(b.high);
				expect(a.low).toBe(b.low);
				expect(a.close).toBe(b.close);
				expect(a.volume).toBe(b.volume);
			});
		}
	});

	it("prefix test for 30m->1h resampling (causality invariant)", () => {
		const startMs = Date.UTC(2024, 0, 1, 9, 0);
		const THIRTY_M = 30 * 60 * 1000;
		const candles: Candle[] = [];
		for (let i = 0; i < 30 * 2; i++) {
			// 60 30m candles = 30 hours
			const base = 100 + (i % 10) * 0.5;
			candles.push({
				timestamp: startMs + i * THIRTY_M,
				open: base,
				high: base + 1,
				low: base - 1,
				close: base + 0.25,
				volume: 1000,
			});
		}
		const fullRes = CandleResampler.resample(candles, 30, 60);

		for (const cut of [10, 20, 30, 50]) {
			const prefix = candles.slice(0, cut);
			const prefixRes = CandleResampler.resample(prefix, 30, 60);
			expect(prefixRes.length).toBeLessThanOrEqual(fullRes.length);
			prefixRes.forEach((a, i) => {
				const b = fullRes[i];
				expect(a.timestamp).toBe(b.timestamp);
				expect(a.open).toBe(b.open);
				expect(a.high).toBe(b.high);
				expect(a.low).toBe(b.low);
				expect(a.close).toBe(b.close);
				expect(a.volume).toBe(b.volume);
			});
		}
	});
});

describe("NSE session-aware 30m → 1h resampling", () => {
	const IST_OFFSET = 5.5 * 60 * 60 * 1000;
	const baseDate = Date.UTC(2024, 0, 1);

	function makeNse30mCandles(timesIST: string[]): Candle[] {
		return timesIST.map((time, i) => {
			const [h, m] = time.split(":").map(Number);
			const timestamp = baseDate + (h * 60 + m) * 60 * 1000 - IST_OFFSET;
			return {
				timestamp,
				open: 100 + i,
				high: 101 + i,
				low: 99 + i,
				close: 100.5 + i,
				volume: 1000,
			};
		});
	}

	it("produces six complete session-aligned hourly bars from a normal NSE session", () => {
		// Normal NSE session: 13 30m candles (09:15–15:15 IST)
		const nse30mTimesIST = [
			"09:15",
			"09:45",
			"10:15",
			"10:45",
			"11:15",
			"11:45",
			"12:15",
			"12:45",
			"13:15",
			"13:45",
			"14:15",
			"14:45",
			"15:15",
		];
		const candles = makeNse30mCandles(nse30mTimesIST);

		const res = NseCandleResampler.resample30mTo1hSessionAligned(candles);

		// Expect 6 complete pairs (15:15 is unpaired partial)
		expect(res.length).toBe(6);

		// Verify exact timestamps (UTC = IST - 5.5h)
		// 09:15 IST = 03:45 UTC, 10:15 IST = 04:45 UTC, etc.
		const expectedTimestamps = [
			Date.UTC(2024, 0, 1, 3, 45), // 09:15 IST
			Date.UTC(2024, 0, 1, 4, 45), // 10:15 IST
			Date.UTC(2024, 0, 1, 5, 45), // 11:15 IST
			Date.UTC(2024, 0, 1, 6, 45), // 12:15 IST
			Date.UTC(2024, 0, 1, 7, 45), // 13:15 IST
			Date.UTC(2024, 0, 1, 8, 45), // 14:15 IST
		];
		res.forEach((c, i) => {
			expect(c.timestamp).toBe(expectedTimestamps[i]);
		});

		// Verify OHLCV aggregation (source candles identifiable by open values)
		// Pair 0: 09:15(O=100) + 09:45(O=101) → O=100, H=102, L=99, C=101.5
		expect(res[0].open).toBe(100);
		expect(res[0].high).toBe(102);
		expect(res[0].low).toBe(99);
		expect(res[0].close).toBe(101.5);
		expect(res[0].volume).toBe(2000);

		// Pair 5: 14:15(O=110) + 14:45(O=111) → O=110, H=112, L=109, C=111.5
		expect(res[5].open).toBe(110);
		expect(res[5].high).toBe(112);
		expect(res[5].low).toBe(109);
		expect(res[5].close).toBe(111.5);
		expect(res[5].volume).toBe(2000);
	});

	it("excludes the 15:15 partial candle (does not pair with 14:45)", () => {
		const nse30mTimesIST = [
			"09:15",
			"09:45",
			"10:15",
			"10:45",
			"11:15",
			"11:45",
			"12:15",
			"12:45",
			"13:15",
			"13:45",
			"14:15",
			"14:45",
			"15:15",
		];
		const candles = makeNse30mCandles(nse30mTimesIST);

		const res = NseCandleResampler.resample30mTo1hSessionAligned(candles);

		// 6 complete pairs, 15:15 (index 12) is dropped
		expect(res.length).toBe(6);
		// Last pair is 14:15+14:45, not 14:45+15:15
		expect(res[5].open).toBe(110); // 14:15 open
		expect(res[5].close).toBe(111.5); // 14:45 close
	});

	it("does not pair candles across trading days", () => {
		// Day 1: only ONE candle (14:45) - no pair possible
		const day1Times = ["14:45"];
		// Day 2: first two 30m candles (next day)
		const day2Times = ["09:15", "09:45"];

		const day1Candles = day1Times.map((time, i) => {
			const [h, m] = time.split(":").map(Number);
			return {
				timestamp: baseDate + (h * 60 + m) * 60 * 1000 - IST_OFFSET,
				open: 111 + i,
				high: 112 + i,
				low: 110 + i,
				close: 111.5 + i,
				volume: 1000,
			};
		});

		const day2Candles = day2Times.map((time, i) => {
			const [h, m] = time.split(":").map(Number);
			return {
				timestamp:
					baseDate +
					24 * 60 * 60 * 1000 +
					(h * 60 + m) * 60 * 1000 -
					IST_OFFSET,
				open: 114 + i,
				high: 115 + i,
				low: 113 + i,
				close: 114.5 + i,
				volume: 1000,
			};
		});

		const candles = [...day1Candles, ...day2Candles];
		const res = NseCandleResampler.resample30mTo1hSessionAligned(candles);

		// Day 1: only 14:45 (single candle, no pair) → no output
		// Day 2: 09:15 + 09:45 → 1 pair
		expect(res.length).toBe(1);
		expect(res[0].open).toBe(114); // Day2 09:15
		expect(res[0].close).toBe(115.5); // Day2 09:45
		expect(new Date(res[0].timestamp).toISOString()).toBe(
			new Date(
				baseDate + 24 * 60 * 60 * 1000 + (9 * 60 + 15) * 60 * 1000 - IST_OFFSET,
			).toISOString(),
		);
	});

	it("skips pairs with missing candles (gap validation)", () => {
		// Normal session but missing 10:15 candle (gap at index 2)
		const nse30mTimesIST = [
			"09:15",
			"09:45",
			// '10:15' missing
			"10:45",
			"11:15",
			"11:45",
			"12:15",
			"12:45",
			"13:15",
			"13:45",
			"14:15",
			"14:45",
			"15:15",
		];
		const candles = makeNse30mCandles(nse30mTimesIST);

		const res = NseCandleResampler.resample30mTo1hSessionAligned(candles);

		// Pairs are formed sequentially: (0,1), (2,3), (4,5), (6,7), (8,9), (10,11), (12,13)...
		// With missing 10:15 (was index 2), the array shifts:
		// Index: 0=09:15, 1=09:45, 2=10:45, 3=11:15, 4=11:45, 5=12:15, 6=12:45, 7=13:15, 8=13:45, 9=14:15, 10=14:45, 11=15:15
		// Pair (0,1): 09:15+09:45 ✓ (30min)
		// Pair (2,3): 10:45+11:15 ✓ (30min) - this is VALID
		// Pair (4,5): 11:45+12:15 ✓ (30min)
		// Pair (6,7): 12:45+13:15 ✓ (30min)
		// Pair (8,9): 13:45+14:15 ✓ (30min)
		// Pair (10,11): 14:45+15:15 ✓ (30min)
		// Total: 6 pairs (the missing candle shifts indices but remaining pairs are valid)
		expect(res.length).toBe(6);

		// Verify first pair is correct
		expect(res[0].open).toBe(100);
		expect(res[0].close).toBe(101.5);
	});

	it("handles partial sessions (fewer than 12 candles)", () => {
		// Only first 4 candles (09:15–10:45)
		const partialTimes = ["09:15", "09:45", "10:15", "10:45"];
		const candles = makeNse30mCandles(partialTimes);

		const res = NseCandleResampler.resample30mTo1hSessionAligned(candles);

		// Two complete pairs
		expect(res.length).toBe(2);
		expect(res[0].open).toBe(100);
		expect(res[1].open).toBe(102);
	});

	it("handles duplicate timestamps by skipping invalid pairs", () => {
		// Normal session with duplicate at 10:15
		const nse30mTimesIST = [
			"09:15",
			"09:45",
			"10:15",
			"10:15",
			"10:45",
			"11:15",
			"11:45",
			"12:15",
			"12:45",
			"13:15",
			"13:45",
			"14:15",
			"14:45",
			"15:15",
		];
		const candles = makeNse30mCandles(nse30mTimesIST);
		// Make the duplicate have same timestamp
		candles[3].timestamp = candles[2].timestamp;

		const res = NseCandleResampler.resample30mTo1hSessionAligned(candles);

		// Pair 09:15+09:45 ✓ (interval 30min)
		// Pair 10:15+10:15 ✗ (interval 0, not 30min)
		// Pair 10:45+11:15 ✗ (interval 30min but 10:15 was skipped)
		// Actually the logic pairs (0,1), (2,3), (4,5)... so:
		// (0,1): 09:15+09:45 ✓
		// (2,3): 10:15+10:15 ✗ (0 interval)
		// (4,5): 10:45+11:15 ✓ (30min)
		// (6,7): 11:45+12:15 ✓
		// (8,9): 12:45+13:15 ✓
		// (10,11): 13:45+14:15 ✓
		// (12,13): 14:45+15:15 ✓
		expect(res.length).toBe(6);
		expect(res[0].open).toBe(100);
		expect(res[1].open).toBe(104); // 10:45
	});

	it("prefix causality: future candles do not alter earlier HTF outputs", () => {
		const nse30mTimesIST = [
			"09:15",
			"09:45",
			"10:15",
			"10:45",
			"11:15",
			"11:45",
			"12:15",
			"12:45",
			"13:15",
			"13:45",
			"14:15",
			"14:45",
			"15:15",
		];
		const fullCandles = makeNse30mCandles(nse30mTimesIST);
		const fullRes =
			NseCandleResampler.resample30mTo1hSessionAligned(fullCandles);

		// Test various prefixes
		for (const cut of [4, 6, 8, 10, 12]) {
			const prefix = fullCandles.slice(0, cut);
			const prefixRes =
				NseCandleResampler.resample30mTo1hSessionAligned(prefix);

			expect(prefixRes.length).toBeLessThanOrEqual(fullRes.length);
			prefixRes.forEach((a, i) => {
				const b = fullRes[i];
				expect(a.timestamp).toBe(b.timestamp);
				expect(a.open).toBe(b.open);
				expect(a.high).toBe(b.high);
				expect(a.low).toBe(b.low);
				expect(a.close).toBe(b.close);
				expect(a.volume).toBe(b.volume);
			});
		}
	});
});
