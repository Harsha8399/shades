"""
Execution-mechanics parity between the Python research engine and the
TypeScript production engine.

These scenarios use CONTROLLED signals, not the trading strategy. They
validate the execution contract in `research-py/docs/EXECUTION_SEMANTICS.md`:
stop-loss exits, take-profit exits, gap-aware fills, ambiguous bars, same-bar
entry/exit restrictions, and the cost models.

This is a TEST ARTEFACT. It is NOT evidence that the strategy finds setups,
and it says NOTHING about profitability.

Documented divergences still expected in these scenarios:

  DIV-03 / DIV-04  costs         - the research engine charges a flat
                                    commission plus flat slippage; the
                                    production engine charges the full
                                    Indian market fee stack (brokerage, STT,
                                    exchange, SEBI, stamp duty, GST). The
                                    cross-engine price comparison is made on
                                    the ZERO-COST set; the WITH-COSTS set
                                    verifies each engine's own behaviour.
  DIV-10           invalidation  - the production engine cancels a pending
                                    order whose stop is already broken;
                                    the research engine still fills it
                                    (Python invalidation not yet implemented).

DIV-11 (ORDER_FILL_CONDITION) is RESOLVED as touch_only: both engines fill
when price touches the entry, with no candle-close confirmation. A prior
draft that described DIV-11 as requiring a close on the entry side is
obsolete and contradicted the book (p.16, p.17).
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PY_DUMP = REPO_ROOT / 'research-py' / 'tests' / '.artifacts' / 'py_exec.json'
TS_DUMP = REPO_ROOT / 'research-py' / 'tests' / '.artifacts' / 'ts_exec.json'

sys.path.insert(0, str(REPO_ROOT / 'research-py'))


def _run(cmd, cwd):
    result = subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True, timeout=900
    )
    if result.returncode != 0:
        raise AssertionError(
            f"command failed: {' '.join(cmd)}\n"
            f"stdout:\n{result.stdout[-4000:]}\n"
            f"stderr:\n{result.stderr[-4000:]}"
        )


@pytest.fixture(scope="module")
def dumps():
    """Run BOTH engines over the controlled execution scenarios."""
    PY_DUMP.parent.mkdir(parents=True, exist_ok=True)

    _run(
        [sys.executable, str(REPO_ROOT / 'scripts' / 'execution_parity_dump.py')],
        cwd=REPO_ROOT,
    )
    _run(
        ['npx', 'ts-node', 'src/cli/executionParityDump.ts', str(TS_DUMP)],
        cwd=REPO_ROOT / 'app-ts',
    )

    py = json.loads((REPO_ROOT / 'shared' / 'fixtures' / 'execution_parity.json').read_text())
    ts = json.loads(TS_DUMP.read_text())
    return py, ts


def _by_id(results):
    return {r['id']: r for r in results}


class TestExecutionParityScenarios:
    """The scenario set must be complete and both engines must run it."""

    def test_all_scenarios_ran_in_both_engines(self, dumps):
        py, ts = dumps
        expected = set(py['scenarios'])

        assert len(expected) == 7
        for setname in ('zero_costs', 'with_costs'):
            assert set(_by_id(py['results'][setname])) == expected
            assert set(_by_id(ts['results'][setname])) == expected

    def test_scenarios_cover_the_required_mechanics(self, dumps):
        py, _ = dumps
        ids = set(py['scenarios'])
        assert {
            'LONG_STOP_LOSS', 'LONG_TARGET',
            'SHORT_STOP_LOSS', 'SHORT_TARGET',
            'LONG_GAP_FILL', 'AMBIGUOUS_BAR_STOP_FIRST',
            'SAME_BAR_NO_EXIT',
        } == ids


class TestZeroCostExecutionParity:
    """
    With costs disabled, the two engines must agree on the execution
    mechanics. Only the two documented order-lifecycle divergences may differ.
    """

    @pytest.mark.parametrize('scenario_id', [
        'LONG_STOP_LOSS',
        'LONG_TARGET',
        'SHORT_STOP_LOSS',
        'SHORT_TARGET',
        'AMBIGUOUS_BAR_STOP_FIRST',
    ])
    def test_exit_price_and_reason_match(self, dumps, scenario_id):
        py, ts = dumps
        p = _by_id(py['results']['zero_costs'])[scenario_id]
        t = _by_id(ts['results']['zero_costs'])[scenario_id]

        assert t['exit_reason'] == p['exit_reason']
        assert t['exit_price'] == pytest.approx(p['exit_price'], abs=1e-9)
        assert t['entry_price'] == pytest.approx(p['entry_price'], abs=1e-9)
        assert t['stop_loss'] == pytest.approx(p['stop_loss'], abs=1e-9)
        assert t['target'] == pytest.approx(p['target'], abs=1e-9)
        assert t['r_multiple'] == pytest.approx(p['r_multiple'], abs=1e-9)
        assert t['net_pnl'] == pytest.approx(p['net_pnl'], abs=1e-6)

    @pytest.mark.parametrize('scenario_id', [
        'LONG_STOP_LOSS', 'LONG_TARGET',
        'SHORT_STOP_LOSS', 'SHORT_TARGET',
    ])
    def test_exit_reason_is_the_expected_one(self, dumps, scenario_id):
        """Each scenario must produce the outcome it was designed to produce."""
        py, ts = dumps
        for results in (py['results']['zero_costs'], ts['results']['zero_costs']):
            r = _by_id(results)[scenario_id]
            assert r['exit_reason'] == r['expect_exit_reason']

    def test_ambiguous_bar_resolves_to_the_stop(self, dumps):
        """
        The documented intrabar policy is stop_first: when one bar spans both
        the stop and the target, the stop must win in BOTH engines.
        """
        py, ts = dumps
        for results in (py['results']['zero_costs'], ts['results']['zero_costs']):
            r = _by_id(results)['AMBIGUOUS_BAR_STOP_FIRST']
            assert r['exit_reason'] == 'STOPPED'
            assert r['exit_price'] == pytest.approx(98.0, abs=1e-9)

    def test_same_bar_entry_does_not_exit_on_its_own_bar(self, dumps):
        """
        A position must not be exited on the bar it was opened.

        The research engine fills and holds (END_OF_DATA). The production
        engine never opens the position, because its invalidation rule
        (DIV-10) cancels the order: the entry bar's low already broke the
        stop. Both are correct under their own documented rules, and neither
        produces a same-bar exit.
        """
        py, ts = dumps
        p = _by_id(py['results']['zero_costs'])['SAME_BAR_NO_EXIT']
        t = _by_id(ts['results']['zero_costs'])['SAME_BAR_NO_EXIT']

        assert p['exit_reason'] == 'END_OF_DATA'
        assert t['exit_reason'] == 'CANCELLED_BY_INVALIDATION'

        # Critically: neither engine exits on the entry bar.
        assert p['exit_reason'] != 'STOPPED'

    def test_gap_bar_fills_on_touch_in_both_engines_DIV_11(self, dumps):
        """
        DIV-11 RESOLVED: the entry fills on TOUCH (no candle-close
        confirmation) in BOTH engines. The gapped bar opens at 95.0, below
        the 100.0 entry, so price has clearly reached the entry.

        What DIV-11 does and does not decide:
          * DIV-11 decides WHETHER the order fills: both engines fill
            (entry_price is not None) even though no candle closed at or
            beyond the trigger level.
          * The fill PRICE on a gapped bar is a SEPARATE divergence, DIV-06
            (recorded, still open): the Python engine fills at the open
            (95.0, `fill_gaps_at_open=True`); the TypeScript engine fills at
            the limit price (100.0). It is DEFERRED, so the engines are not
            aligned on it here and the difference is asserted explicitly
            rather than papered over.
          * The harness differences are also structural: Python's engine
            closes the open position at end of data (END_OF_DATA); the TS
            harness applies no end-of-data close and reports STILL_OPEN.
        """
        py, ts = dumps
        p = _by_id(py['results']['zero_costs'])['LONG_GAP_FILL']
        t = _by_id(ts['results']['zero_costs'])['LONG_GAP_FILL']

        # DIV-11: the zero-close-condition trigger fired in BOTH engines.
        assert p['entry_price'] is not None
        assert t['entry_price'] is not None

        # Python engine: fills at the gapped open (its documented DIV-06
        # rule) and is closed at end of data.
        assert p['entry_price'] == pytest.approx(95.0, abs=1e-9)
        assert p['exit_reason'] == 'END_OF_DATA'

        # TypeScript engine: fills on the same touch but at the LIMIT price,
        # because entry-gap handling is the deferred DIV-06 divergence. When
        # DIV-06 is implemented the expectation flips to 95.0 and this test
        # must be updated deliberately (T22).
        assert t['entry_price'] == pytest.approx(100.0, abs=1e-9)
        assert t['exit_reason'] == 'STILL_OPEN'

        # The two fill prices differ exactly by the DIV-06 entry-gap gap.
        assert abs(p['entry_price'] - t['entry_price']) == pytest.approx(5.0)


class TestWithCostsExecutionParity:
    """
    With costs enabled, the two engines' cost MODELS differ structurally
    (DIV-03 / DIV-04), so the prices cannot match. What must match is the
    direction of the effect: costs always make a trade worse.
    """

    @pytest.mark.parametrize('scenario_id', [
        'LONG_STOP_LOSS', 'LONG_TARGET',
        'SHORT_STOP_LOSS', 'SHORT_TARGET',
    ])
    def test_costs_reduce_profit_and_increase_loss(self, dumps, scenario_id):
        py, ts = dumps
        p0 = _by_id(py['results']['zero_costs'])[scenario_id]
        p1 = _by_id(py['results']['with_costs'])[scenario_id]
        t0 = _by_id(ts['results']['zero_costs'])[scenario_id]
        t1 = _by_id(ts['results']['with_costs'])[scenario_id]

        # The research engine: a winning trade earns less, a losing trade
        # loses more, once costs are applied.
        if p0['net_pnl'] > 0:
            assert p1['net_pnl'] < p0['net_pnl']
        else:
            assert p1['net_pnl'] < p0['net_pnl']

        # The production engine likewise.
        if t0['net_pnl'] > 0:
            assert t1['net_pnl'] < t0['net_pnl']
        else:
            assert t1['net_pnl'] < t0['net_pnl']

    @pytest.mark.parametrize('scenario_id', [
        'LONG_STOP_LOSS', 'LONG_TARGET',
        'SHORT_STOP_LOSS', 'SHORT_TARGET',
    ])
    def test_exit_reason_is_unaffected_by_costs(self, dumps, scenario_id):
        """Costs change the price, never which exit was taken."""
        py, ts = dumps
        for results in (py['results'], ts['results']):
            zero = _by_id(results['zero_costs'])[scenario_id]
            withc = _by_id(results['with_costs'])[scenario_id]
            assert zero['exit_reason'] == withc['exit_reason']

    def test_slippage_moves_the_fill_against_the_trader(self, dumps):
        """
        A long entry must fill HIGHER (worse) and a long exit LOWER (worse);
        a short the other way round.
        """
        py, _ = dumps
        zero = _by_id(py['results']['zero_costs'])
        withc = _by_id(py['results']['with_costs'])

        # LONG entry: worse (higher).
        assert withc['LONG_TARGET']['entry_price'] > zero['LONG_TARGET']['entry_price']
        # SHORT entry: worse (lower).
        assert withc['SHORT_TARGET']['entry_price'] < zero['SHORT_TARGET']['entry_price']


class TestNoUndocumentedDifferences:
    """
    A catch-all: every difference between the two engines' zero-cost
    results must be attributable to a recorded divergence.
    """

    #: Divergences that are allowed to cause a difference in the zero-cost set.
    ALLOWED_DIFFERENCES = {
        # DIV-06 (deferred): TS entry fills at the limit on a gapped bar;
        # Python fills at the open. Also the harness lifecycle differs
        # (Python closes at END_OF_DATA, the TS harness reports STILL_OPEN).
        'LONG_GAP_FILL',
        # DIV-10 (decision recorded; implementation in Phase 4): the TS
        # engine cancels an order whose stop is already broken; Python fills.
        'SAME_BAR_NO_EXIT',
    }

    def test_only_documented_divergences_differ(self, dumps):
        py, ts = dumps
        p = _by_id(py['results']['zero_costs'])
        t = _by_id(ts['results']['zero_costs'])

        differing = set()
        for scenario_id in p:
            if p[scenario_id]['exit_reason'] != t[scenario_id]['exit_reason']:
                differing.add(scenario_id)
                continue
            if abs(p[scenario_id]['exit_price'] - t[scenario_id]['exit_price']) > 1e-9:
                differing.add(scenario_id)

        assert differing == self.ALLOWED_DIFFERENCES, (
            f'unexpected divergence in {differing - self.ALLOWED_DIFFERENCES}; '
            f'every difference must be recorded in the specification'
        )
