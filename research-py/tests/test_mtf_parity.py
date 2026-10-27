"""
Cross-engine MTF trendline parity (Python side).

Both engines load the SAME fixture (``shared/fixtures/parity_15m.csv``)
and must produce identical extractor output: HTF candle count, swing
counts, last HTF close, and the full set of line parameters.

The TypeScript side of this test lives in
``app-ts/tests/mtf-parity.test.ts`` and writes its results to a JSON
file; this test compares the Python results against that file. Run the
TS side first (``npx jest tests/mtf-parity.test.ts``), then this test.
"""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from conftest import SHARED_FIXTURE  # noqa: E402
from src.indicators.mtf_trendlines import (  # noqa: E402
    extract_broader_trendlines,
)

TS_OUTPUT = REPO_ROOT.parent / 'shared' / 'fixtures' / 'mtf_parity_ts.json'

HTF = '4h'
AS_OF = 400  # decision bar within the fixture


def _load_fixture() -> pd.DataFrame:
    df = pd.read_csv(SHARED_FIXTURE, parse_dates=['timestamp'])
    df.set_index('timestamp', inplace=True)
    return df


def _python_result():
    df = _load_fixture()
    return extract_broader_trendlines(df, HTF, as_of_index=AS_OF)


def _line_dict(tl):
    return {
        'type': tl.type,
        'slope': round(tl.slope, 8),
        'intercept': round(tl.intercept, 8),
        'start_idx': tl.start_idx,
        'end_idx': tl.end_idx,
        'touches': tl.touches,
    }


def _prices_at_python():
    """Evaluate every line at the decision bar's timestamp, like the stop
    rule would: the cross-engine check of the design doc's index-mapping
    rule (section 6)."""
    df = _load_fixture()
    res = extract_broader_trendlines(df, HTF, as_of_index=AS_OF)
    entry_ts = df.index[AS_OF]
    return sorted(round(tl.price_at(entry_ts), 8) for tl in res.trendlines)


class TestMtfParity:
    @pytest.fixture(scope='class')
    def py(self):
        return _python_result()

    def test_ts_output_exists(self):
        if not TS_OUTPUT.exists():
            pytest.skip(
                'Run `npx jest tests/mtf-parity.test.ts` first to generate '
                'shared/fixtures/mtf_parity_ts.json'
            )

    def test_htf_candle_count_matches(self, py):
        ts = json.loads(TS_OUTPUT.read_text())
        assert py.n_htf_candles == ts['n_htf_candles']

    def test_swing_counts_match(self, py):
        ts = json.loads(TS_OUTPUT.read_text())
        assert py.n_swing_highs == ts['n_swing_highs']
        assert py.n_swing_lows == ts['n_swing_lows']

    def test_last_htf_close_matches(self, py):
        ts = json.loads(TS_OUTPUT.read_text())
        assert py.last_htf_close is not None
        # TS writes ISO with a trailing '.000Z'; normalize both sides.
        py_iso = pd.Timestamp(py.last_htf_close).isoformat()
        ts_iso = ts['last_htf_close'].replace('.000Z', '')
        assert py_iso == ts_iso

    def test_trendline_sets_match(self, py):
        ts = json.loads(TS_OUTPUT.read_text())
        py_lines = sorted(map(_line_dict, py.trendlines), key=str)
        ts_lines = sorted(ts['trendlines'], key=str)
        assert py_lines == ts_lines, (
            f'Python lines: {len(py_lines)}, TS lines: {len(ts_lines)}; '
            f'first diff: '
            f'{next((f"{a} != {b}" for a, b in zip(py_lines, ts_lines) if a != b), "length mismatch")}'
        )

    def test_evaluated_price_at_the_entry_bar_matches(self):
        """The indexed price both engines would hand to the stop rule must
        agree. This is the design doc's section 6 mapping rule: same line,
        same anchor, same extrapolation to the entry timestamp."""
        ts = json.loads(TS_OUTPUT.read_text())
        py_prices = _prices_at_python()
        assert len(py_prices) == len(ts['prices_at']), (
            'line count mismatch in prices_at'
        )
        for a, b in zip(py_prices, ts['prices_at']):
            assert a == pytest.approx(b, abs=1e-8), (
                f'price_at divergence: python {a} vs TS {b}'
            )
