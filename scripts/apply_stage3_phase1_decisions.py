#!/usr/bin/env python3
"""
Phase 1 of Stage 3 implementation: record the approved decisions in
shared/fixtures/strategy_spec.json.

Decisions recorded here (each traceable to docs/stage3/):

  DIV-10  ORDER_INVALIDATION      -> stop_already_broken_cancels_order
                                     (Q13 option (a))
  DIV-11  ORDER_FILL_CONDITION    -> touch_only
                                     (Q14 option (a); p.16 + p.17)
  Q1+Q10 HTF_TRENDLINE_MISSING    -> reject_signal (consolidated decision)
  Q2     STOP_LEVEL_COMBINATION   -> max_of_level_and_broader_trendline_then_add_buffer
  Q3     STOP_BUFFER_SCOPE        -> shared_single_buffer
  Q4     STOP_BUFFER_APPLICATION  -> applied_to_binding_reference
  Q5     EM1_TRENDLINE_CLAUSE     -> beyond_the_trendline
  Q6     FIB_LEVEL_ELIGIBILITY    -> book_ratios_only

Provenance discipline: book-derived rules are labelled 'book' with the page;
reasonable readings of unquantified prose are 'inferred'; engineering
choices are 'invented'. Nothing here is tuned for profitability.
"""
import json
import sys
from pathlib import Path

SPEC_PATH = Path(__file__).resolve().parents[1] / "shared" / "fixtures" / "strategy_spec.json"


def find_param(spec, pid):
    for p in spec["parameters"]:
        if p["id"] == pid:
            return p
    return None


def upsert_param(spec, pid, name, purpose, value, vtype, vrange,
                 provenance, pdf_page, pdf_passage, rationale, status,
                 configurable, consumers, tests):
    existing = find_param(spec, pid)
    entry = {
        "id": pid,
        "name": name,
        "purpose": purpose,
        "value": value,
        "type": vtype,
        "range": vrange,
        "provenance": provenance,
        "pdf_page": pdf_page,
        "pdf_passage": pdf_passage,
        "rationale": rationale,
        "status": status,
        "configurable": configurable,
        "consumers": consumers,
        "tests": tests,
    }
    if existing is None:
        spec["parameters"].append(entry)
    else:
        existing.update(entry)
    return entry


def main():
    spec = json.loads(SPEC_PATH.read_text())

    # ------------------------------------------------------------------
    # DIV-10: order invalidation (Q13 -> (a))
    #
    # NOTE: status stays 'open' until the code change lands. The spec's own
    # guard test (test_the_two_resolved_divergences_are_the_only_ones)
    # exists to stop a status flip without an implementation; the DECISION
    # is recorded here, the status flips in Phase 4 when both engines
    # implement it.
    # ------------------------------------------------------------------
    for d in spec["engine_divergences"]:
        if d["id"] == "DIV-10":
            d["status"] = "open"
            d["decision"] = (
                "DECIDED in Stage 3 Phase 1 (Q13 option a): "
                "stop_already_broken_cancels_order. A pending order is "
                "cancelled when the bar's range has already broken the "
                "trade's initial stop-loss before the entry could fill. "
                "Rationale: the stop is the trade's risk boundary; an entry "
                "whose stop has already been violated is not a trade the "
                "method would take. The alternative (a plain resting limit "
                "with no invalidation) models a different order type and "
                "was rejected because it would let the engines disagree "
                "about whether a trade exists at all - which would make "
                "stop-placement parity uninterpretable. This decision MUST "
                "be implemented in both engines BEFORE the new stop rule "
                "lands, because the stop is the input to the invalidation "
                "check. Status flips to 'resolved' in Phase 4 when both "
                "engines implement it."
            )
        elif d["id"] == "DIV-11":
            d["status"] = "open"
            d["decision"] = (
                "DECIDED in Stage 3 Phase 1 (Q14 option a): touch_only. A "
                "long fills when bar.low <= entry; a short fills when "
                "bar.high >= entry. Book evidence: p.16 'As soon as the "
                "price reaches high liquidity zone, one can directly enter "
                "into the trade' and p.17 'there is no need to wait for any "
                "kind of candle closing confirmation, at-least this is how "
                "I use it'. The TypeScript engine's additional "
                "close-on-entry-side requirement was a close-confirmation "
                "trigger that the book explicitly rejects; it is a "
                "strategy-rule difference, not an execution-cost "
                "difference, so it is aligned to the book rather than "
                "preserved. The TypeScript engine is the one that changes. "
                "Status flips to 'resolved' in Phase 4 when both engines "
                "implement it."
            )

    # ORDER_INVALIDATION / ORDER_FILL_CONDITION parameter entries
    upsert_param(
        spec,
        "ORDER_INVALIDATION",
        "Order invalidation rule",
        "Whether a pending order is cancelled when price has already broken "
        "the stop-loss before the order fills.",
        "stop_already_broken_cancels_order",
        "enum",
        ["stop_already_broken_cancels_order", "no_invalidation"],
        "inferred",
        None,
        None,
        "The book does not discuss order invalidation. The decision follows "
        "the audit's recommendation (docs/stage3/DIVERGENCE_AUDIT.md Q13): "
        "the stop is the trade's risk boundary, and an entry whose stop has "
        "already been violated is not a trade the method would take. The "
        "alternative (no invalidation, a plain resting limit) was rejected "
        "because it would leave the engines disagreeing about whether a "
        "trade exists, making stop-placement parity uninterpretable.",
        "RESOLVED in Stage 3 Phase 1 (DIV-10 decision recorded; the status "
        "flips to 'resolved' in Phase 4 when both engines implement it).",
        True,
        [
            "research-py/src/backtesting/engine.py",
            "app-ts/src/core/PaperTradingEngine.ts::isInvalidated",
        ],
        [],
    )
    upsert_param(
        spec,
        "ORDER_FILL_CONDITION",
        "Order fill condition",
        "What a bar must do before a resting order is considered filled.",
        "touch_only",
        "enum",
        ["touch_only", "touch_plus_close_confirmation"],
        "book",
        17,
        "there is no need to wait for any kind of candle closing "
        "confirmation, at-least this is how I use it",
        "p.16 states the EM1 entry happens 'as soon as the price reaches "
        "high liquidity zone' and p.17 states for EM2 that 'there is no need "
        "to wait for any kind of candle closing confirmation'. The entry is "
        "a price event, not a close event. The TypeScript engine's "
        "close-confirmation requirement contradicted the book and was "
        "removed; the Python engine's touch-only behaviour is the shared "
        "rule.",
        "RESOLVED in Stage 3 Phase 1 (DIV-11 decision recorded; the status "
        "flips to 'resolved' in Phase 4 when both engines implement it).",
        True,
        [
            "research-py/src/backtesting/engine.py::_resolve_entry_fill",
            "app-ts/src/core/PaperTradingEngine.ts::isEntryHit",
        ],
        [],
    )

    # ------------------------------------------------------------------
    # Q1 + Q10 consolidated: missing / invalid broader trendline
    # ------------------------------------------------------------------
    upsert_param(
        spec,
        "HTF_TRENDLINE_MISSING_BEHAVIOUR",
        "Missing or invalid broader trendline behaviour",
        "What the stop rule does when no valid broader-timeframe trendline "
        "exists for an EM2-A / EM2-B stop (no HTF data, or no candidate line "
        "with the minimum touch count).",
        "reject_signal",
        "enum",
        ["reject_signal", "fallback_to_level"],
        "inferred",
        18,
        "If you do not see all the three confirmations, it is better to wait "
        "for the setup to become favourable rather than taking a trade just "
        "for the sake of it",
        "CONSOLIDATES review questions Q1 and Q10 into one decision. The "
        "book (p.18) treats a missing confirmation as a reason to WAIT, not "
        "as a licence to place a stop that does not satisfy the rule. "
        "Falling back to the Fibonacci level alone would produce a stop "
        "that violates the book's own two-constraint structure, and would "
        "make trade counts depend silently on dataset length (a short "
        "history has no HTF trendline and would trade differently from a "
        "long one). The cost is a lower signal count, which is reported, "
        "not absorbed. Applies identically to EM2-A and EM2-B. EM1 is NOT "
        "affected: its trendline clause is a secondary distance check and "
        "is handled by EM1_TRENDLINE_CLAUSE (Q5).",
        "RESOLVED in Stage 3 Phase 1 (Q1+Q10). The extractor must expose a "
        "diagnostic counting how many signals were rejected for a missing "
        "trendline so the effect is measurable.",
        True,
        [
            "research-py/src/patterns/confluence_zone.py::calculate_stop_loss",
            "app-ts/src/patterns/ConfluenceZonePattern.ts::calculateStopLoss",
        ],
        [],
    )

    # ------------------------------------------------------------------
    # Q2: level + trendline combination
    # ------------------------------------------------------------------
    p = find_param(spec, "STOP_LEVEL_COMBINATION")
    if p is not None:
        p["status"] = (
            "RESOLVED in Stage 3 Phase 1 (Q2 option a): hard max/min of the "
            "two positional constraints, then a single buffer. The prose "
            "states two positional constraints ('above the next fib level & "
            "above the broader ongoing trendline'); a minimum-separation "
            "distance would be an invented second buffer and is rejected."
        )

    # ------------------------------------------------------------------
    # Q3: one shared buffer or per-model
    # ------------------------------------------------------------------
    upsert_param(
        spec,
        "STOP_BUFFER_SCOPE",
        "Stop buffer scope",
        "Whether the ATR stop buffer is one shared value or one per entry "
        "model (EM1 / EM2-A / EM2-B).",
        "shared_single_buffer",
        "enum",
        ["shared_single_buffer", "per_model"],
        "invented",
        None,
        None,
        "The author's own charts show buffers of roughly 0.10 ATR (p.16/17) "
        "and 0.34 ATR (p.18) - a ~3x spread, which argues for per-model "
        "values. A per-model buffer would, however, add two more invented "
        "parameters to an already invention-heavy spec, and the p.16/p.17 "
        "charts are the SAME observation (same instrument, same levels, "
        "same drawn stop), so the effective evidence is n=2, not n=3. One "
        "shared buffer (STOP_BUFFER_ATR = 0.1) is chosen for parsimony; if "
        "the later sensitivity analysis shows the models need different "
        "buffers, this decision is revisited - as a hypothesis test, never "
        "as profit tuning.",
        "RESOLVED in Stage 3 Phase 1 (Q3 option a, against the analysis's "
        "initial lean, for parameter parsimony; the reasoning is recorded "
        "rather than the lean).",
        True,
        [
            "research-py/src/patterns/confluence_zone.py::calculate_stop_loss",
            "app-ts/src/patterns/ConfluenceZonePattern.ts::calculateStopLoss",
        ],
        [],
    )

    # ------------------------------------------------------------------
    # Q4: buffer applied to the binding reference
    # ------------------------------------------------------------------
    upsert_param(
        spec,
        "STOP_BUFFER_APPLICATION",
        "Stop buffer application point",
        "Whether the ATR buffer is added once beyond the binding reference "
        "(the more conservative of level and trendline) or beyond each "
        "reference before combining.",
        "applied_to_binding_reference",
        "enum",
        ["applied_to_binding_reference", "applied_to_each_then_combined"],
        "inferred",
        None,
        None,
        "Applying the buffer to each reference and then taking the more "
        "conservative double-counts the buffer whenever both constraints "
        "bind, pushing the stop further than either reading of 'slightly "
        "beyond' supports. The buffer expresses 'slightly beyond the "
        "reference', and there is one binding reference, so it is applied "
        "once, after the combination.",
        "RESOLVED in Stage 3 Phase 1 (Q4 option a).",
        True,
        [
            "research-py/src/patterns/confluence_zone.py::calculate_stop_loss",
            "app-ts/src/patterns/ConfluenceZonePattern.ts::calculateStopLoss",
        ],
        [],
    )

    # ------------------------------------------------------------------
    # Q5: EM1's trendline clause
    # ------------------------------------------------------------------
    upsert_param(
        spec,
        "EM1_TRENDLINE_CLAUSE",
        "EM1 trendline clause semantics",
        "What 'keeping a suitable distance away from the trendline' (p.16, "
        "EM1) requires of the stop.",
        "beyond_the_trendline",
        "enum",
        ["beyond_the_trendline", "not_too_close_only"],
        "inferred",
        16,
        "Stoploss in this situation can be put slightly above the next "
        "retracement whilst keeping a suitable distance away from the "
        "trendline as well.",
        "Two readings exist: (a) the stop must lie beyond the trendline "
        "(the trendline is a second positional constraint, like EM2-A), or "
        "(b) the stop must merely not sit too close to it. (a) is adopted "
        "for symmetry with EM2-A and EM2-B, which both use 'above the "
        "broader ongoing trendline' as a positional constraint; reading "
        "EM1's clause as the weaker 'not too close' would make EM1's stop "
        "the only one allowed between the level and the trendline, which "
        "has no support in the text. When no entry-timeframe trendline is "
        "available the clause is treated as VACUOUS (EM1's binding "
        "reference is the retracement level), so EM1 does not depend on "
        "multi-timeframe data availability - this is the design document's "
        "recommended default and is recorded here rather than left "
        "implicit.",
        "RESOLVED in Stage 3 Phase 1 (Q5 option a).",
        True,
        [
            "research-py/src/patterns/confluence_zone.py::calculate_stop_loss",
            "app-ts/src/patterns/ConfluenceZonePattern.ts::calculateStopLoss",
        ],
        [],
    )

    # ------------------------------------------------------------------
    # Q6: eligible Fibonacci levels
    # ------------------------------------------------------------------
    upsert_param(
        spec,
        "FIB_LEVEL_ELIGIBILITY",
        "Eligible Fibonacci levels for the stop reference",
        "Which retracement levels may serve as the 'next' level for EM1 and "
        "EM2-A stops.",
        "book_ratios_only",
        "enum",
        ["book_ratios_only", "any_computed_level"],
        "book",
        10,
        "Fibonacci levels of 23.6%, 38.2%, 50%, 61.8%, 78.6% are considered "
        "the most crucial retracement zones.",
        "The stop reference must be one of the book's ratio set "
        "{23.6%, 38.2%, 50%, 61.8%, 78.6%} (p.10, FIB_RATIOS). Using any "
        "computed level (e.g. extensions or confluence-derived prices) "
        "would let an invented level become the stop anchor. The author's "
        "own charts use only levels from this set.",
        "RESOLVED in Stage 3 Phase 1 (Q6 option a).",
        True,
        [
            "research-py/src/patterns/confluence_zone.py::calculate_stop_loss",
            "app-ts/src/patterns/ConfluenceZonePattern.ts::calculateStopLoss",
        ],
        [],
    )

    # ------------------------------------------------------------------
    # Flip the interpretation params from OPEN to RESOLVED
    # ------------------------------------------------------------------
    for pid in ("NEXT_RETRACEMENT_SELECTION", "NEXT_FIB_LEVEL_SELECTION",
                "EM2B_SWING_SELECTION", "STOP_BUFFER_ATR"):
        p = find_param(spec, pid)
        if p is None:
            continue
        if pid == "STOP_BUFFER_ATR":
            p["status"] = (
                "RESOLVED in Stage 3 Phase 1 as the shared buffer value "
                "(see STOP_BUFFER_SCOPE). It remains an INVENTED parameter "
                "and a candidate for the sensitivity analysis in a later "
                "stage; it must NOT be tuned to improve backtest results."
            )
        else:
            p["status"] = (
                "RESOLVED in Stage 3 Phase 1. The interpretation is adopted "
                "and implementation follows in Phase 4."
            )

    # ------------------------------------------------------------------
    # DIV-05: record the decision direction (implementation gated on the
    # extractor, per the audit's order of operations)
    # ------------------------------------------------------------------
    for d in spec["engine_divergences"]:
        if d["id"] == "DIV-05":
            d["resolution_stage"] = 3
            d["resolution"] = (
                "DECIDED in Stage 3 Phase 1 (Q15 option a): the invented "
                "50/30/20 partial ladder is dropped and the book's p.19 "
                "trendline trailing stop ('This trendline can now be used "
                "as a trailing stoploss on candle closing basis') becomes "
                "the exit-management rule in BOTH engines. IMPLEMENTATION "
                "IS GATED on the multi-timeframe trendline extractor "
                "(Phase 3), because the trailing stop is evaluated on the "
                "broader trendline. Until then the ladder stays disabled "
                "in the TypeScript engine so no parity claim is made on an "
                "invented rule."
            )

    # ------------------------------------------------------------------
    # MTF_TIMEFRAME_HIERARCHY provenance correction (flagged in the report)
    # ------------------------------------------------------------------
    p = find_param(spec, "MTF_TIMEFRAME_HIERARCHY")
    if p is not None:
        p["provenance"] = "inferred"
        p["status"] = (
            "PROVENANCE CORRECTED in Stage 3 Phase 1: 'book' -> 'inferred'. "
            "p.9 describes the ROLES of the time frames, not a "
            "time-frame-to-time-frame mapping; the pairing is an "
            "interpretation. The mapping remains data in this spec and both "
            "engines must read it from here. The choice of mapping itself "
            "is AMB-08 and stays open for Stage 4."
        )

    SPEC_PATH.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n")
    print(f"spec updated: {SPEC_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
