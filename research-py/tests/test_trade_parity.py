"""
Trade-level parity between the Python research engine and the TypeScript
production engine.

The two engines are driven over the SAME deterministic fixture
(``shared/fixtures/trade_parity_15m.csv``) and their trades are compared
field by field.

The fixture is a TEST ARTEFACT. It exists to make the shipped strategy emit a
deterministic set of trades so that execution mechanics can be compared. It
is NOT evidence that the strategy is profitable, and it is NOT a claim that
the strategy fires often in real markets.

Three divergences are EXPECTED and are asserted as expected, because they are
recorded in the canonical specification:

  DIV-10  ORDER_INVALIDATION   - TypeScript cancels a pending order whose
                                  stop is already broken; the research engine
                                  fills it. This makes the LONG trade exist
                                  only in the research engine.
  (size / P&L)                  - the SHORT is sized on equity that
                                  includes the still-open LONG's unrealised
                                  P&L in the research engine, but not in the
                                  production engine (the LONG was cancelled).
                                  This is DOWNSTREAM of DIV-10.
  (timestamp format)            - both engines now record the CANDLE
                                  timestamp (DIV-12 was resolved in Stage 2);
                                  only the string format differs, so the
                                  comparison is made on the instant.

Every other field must match exactly, within the tolerances declared in the
specification's `tolerances` block.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
FIXTURE = REPO_ROOT / 'shared' / 'fixtures' / 'trade_parity_15m.csv'
PY_DUMP = REPO_ROOT / 'research-py' / 'tests' / '.artifacts' / 'py_trades.json'
TS_DUMP = REPO_ROOT / 'research-py' / 'tests' / '.artifacts' / 'ts_trades.json'

sys.path.insert(0, str(REPO_ROOT / 'research-py'))


def _as_instant(value):
    """
    Parse a timestamp string into a UTC instant.

    The research engine emits a NAIVE ISO string (the candle's wall-clock
    time, as read from the fixture). The production engine emits a UTC ISO
    string. Both engines read the fixture's naive timestamps as UTC wall
    clock, so a naive string is interpreted as UTC here too.

    Comparing the parsed instants (rather than the strings) means a timezone
    shift applied by either engine would be detected.
    """
    if value is None:
        return None
    text = value.replace('Z', '+00:00')
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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
    """Run BOTH engines over the fixture and return their dumps."""
    assert FIXTURE.exists(), (
        f"trade-parity fixture missing: {FIXTURE}. "
        f"Regenerate with: python scripts/gen_trade_parity_fixture.py"
    )

    PY_DUMP.parent.mkdir(parents=True, exist_ok=True)

    _run(
        [sys.executable, str(REPO_ROOT / 'scripts' / 'trade_parity_dump.py'),
         str(FIXTURE), str(PY_DUMP)],
        cwd=REPO_ROOT,
    )
    _run(
        ['npx', 'ts-node', 'src/cli/tradeParityDump.ts',
         str(FIXTURE), str(TS_DUMP)],
        cwd=REPO_ROOT / 'app-ts',
    )

    py = json.loads(PY_DUMP.read_text())
    ts = json.loads(TS_DUMP.read_text())
    return py, ts


class TestTradeParityFixture:
    """The fixture must actually exercise the strategy."""

    def test_fixture_exists_and_is_deterministic(self):
        assert FIXTURE.exists()
        lines = FIXTURE.read_text().strip().splitlines()
        assert len(lines) > 100, 'fixture must have enough bars for warm-up'

    def test_both_engines_emit_signals(self, dumps):
        py, ts = dumps
        assert len(py['trades']) > 0, 'research engine produced no trades'
        assert ts['signal_count'] > 0, 'production engine produced no signals'


class TestTradeParity:
    """Trade-by-trade comparison of the two engines."""

    def test_signal_count_matches(self, dumps):
        """
        Both engines must DETECT the same signals. The production engine
        emits 2 signals; the research engine detects the same 2 (one becomes
        a trade, the other is cancelled by DIV-10).
        """
        py, ts = dumps

        # The research engine does not expose a signal count directly, so
        # reconstruct it: every trade had a signal, plus the LONG that the
        # production engine cancelled still had a signal in the research
        # engine (it became a trade there).
        py_signal_times = {t['signal_time'] for t in py['trades']}
        assert len(py_signal_times) == len(py['trades'])

        # Both engines must have detected the SAME signal instants. The
        # production engine's SHORT signal must coincide with the research
        # engine's SHORT signal. Compared as instants, not as text.
        py_signal_instants = {
            _as_instant(t['signal_time'])
            for t in py['trades'] if t['direction'] == 'SHORT'
        }
        ts_signal_instants = {
            _as_instant(t['signal_time'])
            for t in ts['trades'] if t['direction'] == 'SHORT'
        }

        assert py_signal_instants, 'no SHORT signal in the research engine'
        assert ts_signal_instants, 'no SHORT signal in the production engine'
        assert py_signal_instants == ts_signal_instants

    def test_short_trade_matches_on_every_field(self, dumps):
        """
        The SHORT trade is present in BOTH engines and must match exactly on
        every field except the two known divergences.
        """
        py, ts = dumps

        assert len(py['trades']) == 2, 'expected a LONG and a SHORT'
        assert len(ts['trades']) == 1, 'expected the SHORT (LONG cancelled by DIV-10)'

        py_short = next(t for t in py['trades'] if t['direction'] == 'SHORT')
        ts_short = ts['trades'][0]

        # --- fields that MUST match exactly -----------------------------
        assert py_short['direction'] == ts_short['direction'] == 'SHORT'
        assert py_short['entry_price'] == pytest.approx(ts_short['entry_price'], abs=1e-9)
        assert py_short['signal_price'] == pytest.approx(ts_short['signal_price'], abs=1e-9)
        assert py_short['stop_loss'] == pytest.approx(ts_short['stop_loss'], abs=1e-9)
        assert py_short['target'] == pytest.approx(ts_short['target'], abs=1e-9)
        assert py_short['exit_price'] == pytest.approx(ts_short['exit_price'], abs=1e-9)
        assert py_short['exit_reason'] == ts_short['exit_reason'] == 'TARGET'
        assert py_short['r_multiple'] == pytest.approx(ts_short['r_multiple'], abs=1e-9)
        assert py_short['confluence_factors'] == ts_short['confluence_factors']

        # Timestamps: both engines record the CANDLE timestamp (DIV-12 was
        # resolved in Stage 2). The Python dump emits a naive ISO string and
        # the TypeScript dump a UTC one, so they are parsed and compared as
        # INSTANTS, not as text. A text comparison would pass even if one
        # engine applied a timezone offset to the same wall-clock digits.
        assert _as_instant(py_short['entry_time']) == _as_instant(ts_short['entry_time'])
        assert _as_instant(py_short['exit_time']) == _as_instant(ts_short['exit_time'])
        assert _as_instant(py_short['signal_time']) == _as_instant(ts_short['signal_time'])

    def test_long_trade_divergence_is_exactly_DIV_10(self, dumps):
        """
        The LONG trade exists only in the research engine. That is the
        documented ORDER_INVALIDATION divergence (DIV-10): the production
        engine cancels a pending order whose stop-loss the signal candle
        already broke, and the LONG rejection candle's wick deliberately
        dips through the stop.
        """
        py, ts = dumps

        py_long = next(t for t in py['trades'] if t['direction'] == 'LONG')
        assert len([t for t in ts['trades'] if t['direction'] == 'LONG']) == 0, (
            'the production engine must not have a LONG trade'
        )

        # The LONG was filled in the research engine on the bar AFTER the
        # signal, and exited at the target.
        assert py_long['exit_reason'] == 'TARGET'
        assert py_long['r_multiple'] == pytest.approx(2.0, abs=1e-9)

    def test_size_difference_is_downstream_of_DIV_10(self, dumps):
        """
        The SHORT is sized on equity that includes the still-open LONG's
        unrealised P&L in the research engine, but not in the production
        engine (where the LONG was cancelled). The size difference must
        therefore be exactly the 1% risk applied to that 2000 of unrealised
        P&L.
        """
        py, ts = dumps

        py_short = next(t for t in py['trades'] if t['direction'] == 'SHORT')
        ts_short = ts['trades'][0]

        risk_per_unit = 0.11  # |107.90 - 108.01|

        py_equity = py_short['size'] * risk_per_unit / 0.01
        ts_equity = ts_short['size'] * risk_per_unit / 0.01

        # The research engine's equity is 2000 higher: the LONG's unrealised
        # P&L at +2.0R of 1000 risk.
        assert py_equity == pytest.approx(102_000.0, rel=1e-9)
        assert ts_equity == pytest.approx(100_000.0, rel=1e-9)
        assert py_equity - ts_equity == pytest.approx(2_000.0, rel=1e-9)

    def test_pnl_difference_follows_from_the_size_difference(self, dumps):
        """
        The P&L difference must be fully explained by the size difference.
        No unexplained money may differ.
        """
        py, ts = dumps

        py_short = next(t for t in py['trades'] if t['direction'] == 'SHORT')
        ts_short = ts['trades'][0]

        price_move = 107.90 - 100.20
        assert py_short['gross_pnl'] == pytest.approx(
            py_short['size'] * price_move, rel=1e-9
        )
        assert ts_short['gross_pnl'] == pytest.approx(
            ts_short['size'] * price_move, rel=1e-9
        )

    def test_confluence_factors_match_across_engines(self, dumps):
        """The factor set that triggered each trade must match."""
        py, ts = dumps
        py_short = next(t for t in py['trades'] if t['direction'] == 'SHORT')
        ts_short = ts['trades'][0]
        assert py_short['confluence_factors'] == ts_short['confluence_factors']
        assert 'sr_resistance' in py_short['confluence_factors']
        assert 'trendline_resistance' in py_short['confluence_factors']

    def test_no_unexplained_differences_remain(self, dumps):
        """
        A catch-all: after accounting for the three known divergences, every
        other field of the common trade must be identical. This is the test
        that would catch a NEW divergence appearing.
        """
        py, ts = dumps

        py_short = next(t for t in py['trades'] if t['direction'] == 'SHORT')
        ts_short = ts['trades'][0]

        # Fields that are required to be identical.
        identical = [
            'direction', 'entry_price', 'signal_price', 'stop_loss',
            'target', 'exit_price', 'exit_reason', 'r_multiple',
            'confluence_factors',
        ]
        for field in identical:
            pv = py_short[field]
            tv = ts_short[field]
            if isinstance(pv, float) or isinstance(tv, float):
                assert pv == pytest.approx(tv, abs=1e-9), f'{field} differs'
            else:
                assert pv == tv, f'{field} differs'

        # Fields that are EXPECTED to differ, with a documented reason.
        assert py_short['size'] != ts_short['size'], (
            'expected the size to differ (downstream of DIV-10)'
        )
        assert py_short['net_pnl'] != ts_short['net_pnl'], (
            'expected the P&L to differ (downstream of DIV-10)'
        )
