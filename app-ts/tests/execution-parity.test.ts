/**
 * Execution-mechanics parity (TypeScript side).
 *
 * The Python suite (`research-py/tests/test_execution_parity.py`) drives both
 * engines and asserts the comparison. This file runs the TypeScript side of
 * the same harness and asserts the production engine's own behaviour against
 * the documented expectations, so a regression in the production execution
 * path is caught even if the Python harness is not run.
 *
 * The scenarios use CONTROLLED signals, not the trading strategy. They
 * validate execution mechanics only and say nothing about the strategy.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DUMP = path.join(
	os.tmpdir(),
	`shades-ts-exec-parity-${process.pid}.json`,
);

interface ScenarioResult {
	id: string;
	direction: string;
	entry_price: number | null;
	stop_loss: number;
	target: number;
	exit_price: number | null;
	exit_reason: string;
	size: number;
	net_pnl: number;
	r_multiple: number;
	expect_exit_reason: string;
}

interface Dump {
	scenarios: string[];
	results: Record<string, ScenarioResult[]>;
	tolerances: Record<string, number>;
}

function runHarness(): Dump {
	execFileSync("npx", ["ts-node", "src/cli/executionParityDump.ts", DUMP], {
		cwd: path.join(REPO_ROOT, "app-ts"),
		encoding: "utf-8",
		stdio: "pipe",
	});
	return JSON.parse(fs.readFileSync(DUMP, "utf-8"));
}

const dump = runHarness();

const byId = (set: string): Map<string, ScenarioResult> =>
	new Map(dump.results[set].map((r) => [r.id, r]));

describe("Execution parity: the production engine runs every scenario", () => {
	it("covers all seven execution scenarios", () => {
		expect(dump.scenarios.sort()).toEqual([
			"AMBIGUOUS_BAR_STOP_FIRST",
			"LONG_GAP_FILL",
			"LONG_STOP_LOSS",
			"LONG_TARGET",
			"SAME_BAR_NO_EXIT",
			"SHORT_STOP_LOSS",
			"SHORT_TARGET",
		]);
	});

	it("produces a result for every scenario in every cost set", () => {
		for (const set of ["zero_costs", "with_costs"]) {
			expect(dump.results[set]).toHaveLength(dump.scenarios.length);
		}
	});
});

describe("Execution parity: exit mechanics", () => {
	const zero = byId("zero_costs");

	it("exits a long at the stop-loss", () => {
		const r = zero.get("LONG_STOP_LOSS")!;
		expect(r.exit_reason).toBe("STOPPED");
		expect(r.exit_price).toBeCloseTo(98.0, 9);
		expect(r.r_multiple).toBeCloseTo(-1.0, 9);
	});

	it("exits a long at the target", () => {
		const r = zero.get("LONG_TARGET")!;
		expect(r.exit_reason).toBe("TARGET");
		expect(r.exit_price).toBeCloseTo(102.0, 9);
		expect(r.r_multiple).toBeCloseTo(1.0, 9);
	});

	it("exits a short at the stop-loss", () => {
		const r = zero.get("SHORT_STOP_LOSS")!;
		expect(r.exit_reason).toBe("STOPPED");
		expect(r.exit_price).toBeCloseTo(102.0, 9);
		expect(r.r_multiple).toBeCloseTo(-1.0, 9);
	});

	it("exits a short at the target", () => {
		const r = zero.get("SHORT_TARGET")!;
		expect(r.exit_reason).toBe("TARGET");
		expect(r.exit_price).toBeCloseTo(98.0, 9);
		expect(r.r_multiple).toBeCloseTo(1.0, 9);
	});

	it("resolves an ambiguous bar with the stop (stop_first policy)", () => {
		const r = zero.get("AMBIGUOUS_BAR_STOP_FIRST")!;
		expect(r.exit_reason).toBe("STOPPED");
		expect(r.exit_price).toBeCloseTo(98.0, 9);
	});
});

describe("Execution parity: order lifecycle", () => {
	const zero = byId("zero_costs");

	it("does not exit on the bar it was opened", () => {
		/**
		 * The entry bar's low (98.0) already breaks the stop (99.0). The
		 * production engine's invalidation rule (DIV-10) cancels the order, so no
		 * position is ever opened and therefore never exited on that bar.
		 */
		const r = zero.get("SAME_BAR_NO_EXIT")!;
		expect(r.exit_reason).toBe("CANCELLED_BY_INVALIDATION");
		expect(r.exit_reason).not.toBe("STOPPED");
	});

	it("fills a gapped order on touch (DIV-11), at the limit (DIV-06)", () => {
		/**
		 * DIV-11 resolved: the entry fills on TOUCH, with no candle-close
		 * confirmation. The gapped bar opens at 95.0, below the 100.0 entry, so
		 * the trigger fires.
		 *
		 * The fill PRICE is governed by DIV-06 (recorded, still open): the
		 * production engine fills a gapped entry at the LIMIT price (100.0),
		 * unlike the Python engine's fill-at-open (95.0). When DIV-06 is
		 * implemented the expected price flips to 95.0 and this test must be
		 * updated deliberately.
		 */
		const r = zero.get("LONG_GAP_FILL")!;
		expect(r.entry_price).toBeCloseTo(100.0, 9);
		// The harness applies no end-of-data close, so the filled position is
		// reported still open (the Python engine closes at END_OF_DATA).
		expect(r.exit_reason).toBe("STILL_OPEN");
	});
});

describe("Execution parity: cost model", () => {
	const zero = byId("zero_costs");
	const withCosts = byId("with_costs");

	it("makes a winning trade worse", () => {
		expect(withCosts.get("LONG_TARGET")!.net_pnl).toBeLessThan(
			zero.get("LONG_TARGET")!.net_pnl,
		);
		expect(withCosts.get("SHORT_TARGET")!.net_pnl).toBeLessThan(
			zero.get("SHORT_TARGET")!.net_pnl,
		);
	});

	it("makes a losing trade worse", () => {
		expect(withCosts.get("LONG_STOP_LOSS")!.net_pnl).toBeLessThan(
			zero.get("LONG_STOP_LOSS")!.net_pnl,
		);
		expect(withCosts.get("SHORT_STOP_LOSS")!.net_pnl).toBeLessThan(
			zero.get("SHORT_STOP_LOSS")!.net_pnl,
		);
	});

	it("does not change which exit was taken", () => {
		for (const id of [
			"LONG_STOP_LOSS",
			"LONG_TARGET",
			"SHORT_STOP_LOSS",
			"SHORT_TARGET",
			"AMBIGUOUS_BAR_STOP_FIRST",
		]) {
			expect(withCosts.get(id)!.exit_reason).toBe(zero.get(id)!.exit_reason);
		}
	});
});
