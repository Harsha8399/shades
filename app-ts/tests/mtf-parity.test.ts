/**
 * Cross-engine MTF trendline parity (TypeScript side).
 *
 * Loads the SAME fixture as the Python test
 * (`research-py/tests/test_mtf_parity.py`) and writes the extractor
 * output to `shared/fixtures/mtf_parity_ts.json`, which the Python test
 * compares against. Run this test FIRST, then the Python one.
 */
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { Candle } from "../src/types";
import {
	BroaderTrendline,
	broaderTrendlinePriceAt,
	extractBroaderTrendlines,
} from "../src/indicators/mtfTrendlines";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO_ROOT, "shared", "fixtures", "parity_15m.csv");
const OUTPUT = path.join(REPO_ROOT, "shared", "fixtures", "mtf_parity_ts.json");

const HTF = "4h";
const AS_OF = 400;

function loadFixture(): Candle[] {
	const csv = fs.readFileSync(FIXTURE, "utf-8");
	const records = parse(csv.trim(), {
		columns: true,
		skip_empty_lines: true,
	}) as Array<Record<string, string>>;
	return records.map((r) => ({
		timestamp: new Date(r.timestamp + "Z").getTime(),
		open: parseFloat(r.open),
		high: parseFloat(r.high),
		low: parseFloat(r.low),
		close: parseFloat(r.close),
		volume: parseFloat(r.volume),
	}));
}

function lineDict(tl: BroaderTrendline) {
	return {
		type: tl.type,
		slope: Number(tl.slope.toFixed(8)),
		intercept: Number(tl.intercept.toFixed(8)),
		start_idx: tl.startIdx,
		end_idx: tl.endIdx,
		touches: tl.touches,
	};
}

describe("MTF parity dump (TypeScript side)", () => {
	it("extracts and writes the parity output", () => {
		const candles = loadFixture();
		expect(candles.length).toBeGreaterThan(AS_OF);

		const res = extractBroaderTrendlines(candles, HTF, { asOfIndex: AS_OF });

		// Evaluate every line at the decision bar's timestamp -- the exact price
		// a stop rule would consume. Cross-engine agreement here is the point of
		// design doc section 6 (the HTF->entry index mapping).
		const entryTsMs = candles[AS_OF].timestamp;
		const pricesAt = res.trendlines
			.map((tl) => broaderTrendlinePriceAt(tl, entryTsMs))
			.map((p) => Number(p.toFixed(8)))
			.sort((a, b) => a - b);

		const output = {
			htf_timeframe: HTF,
			as_of_index: AS_OF,
			n_htf_candles: res.nHtfCandles,
			n_swing_highs: res.nSwingHighs,
			n_swing_lows: res.nSwingLows,
			last_htf_close: new Date(res.lastHtfCloseMs!).toISOString(),
			trendlines: res.trendlines.map(lineDict),
			entry_ts: new Date(entryTsMs).toISOString(),
			prices_at: pricesAt,
		};

		fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

		// Sanity assertions on the TS side itself.
		expect(res.nHtfCandles).toBeGreaterThan(0);
		expect(res.trendlines.length).toBeGreaterThan(0);
	});
});
