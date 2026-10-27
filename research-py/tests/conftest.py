"""
Shared pytest fixtures and helpers for the research engine test suite.

All tests use deterministic synthetic OHLCV data. No test depends on network
access, on files under ``data/``, or on the current date.
"""
import sys
from pathlib import Path

import pandas as pd
import pytest

# Make the `src` package importable regardless of the invocation directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.patterns.base import BasePattern, Signal  # noqa: E402

# The shared cross-engine fixture. Both the Python and TypeScript test
# suites load THIS file, so any divergence between the engines shows up as a
# test failure rather than as a silent difference.
SHARED_FIXTURE = REPO_ROOT.parent / 'shared' / 'fixtures' / 'parity_15m.csv'


def load_shared_fixture():
    """Load the shared cross-engine parity fixture."""
    from src.data.loaders import load_csv
    assert SHARED_FIXTURE.exists(), (
        f"shared parity fixture missing: {SHARED_FIXTURE}"
    )
    return load_csv(str(SHARED_FIXTURE))


# ----------------------------------------------------------------------
# Data builders
# ----------------------------------------------------------------------

def make_ohlcv(rows, start="2024-01-01", freq="h"):
    """
    Build a DataFrame from a list of (open, high, low, close) or
    (open, high, low, close, volume) tuples.

    Args:
        rows: Sequence of tuples
        start: First timestamp
        freq: Pandas frequency string for the index

    Returns:
        DataFrame with DatetimeIndex and OHLCV columns
    """
    rows = [tuple(r) + (10,) if len(r) == 4 else tuple(r) for r in rows]
    idx = pd.date_range(start, periods=len(rows), freq=freq)
    return pd.DataFrame(
        rows,
        columns=["open", "high", "low", "close", "volume"],
        index=idx,
    )


def flat_bars(n, o=100.0, h=101.0, l=99.0, c=100.0):
    """Return ``n`` identical flat candles."""
    return [(o, h, l, c) for _ in range(n)]


# ----------------------------------------------------------------------
# Test patterns
# ----------------------------------------------------------------------

class RecordingPattern(BasePattern):
    """
    Pattern that records every DataFrame it is given and emits a signal on a
    caller-controlled bar.

    Used to assert exactly what information the engine exposes to a strategy.
    """

    def __init__(self, signal_on_call=None, direction="LONG",
                 entry=100.0, stop=95.0, target=110.0, required_bars=5):
        super().__init__({})
        self.signal_on_call = signal_on_call
        self.direction = direction
        self.entry = entry
        self.stop = stop
        self.target = target
        self._required_bars = required_bars
        self.calls = []          # list of DataFrames received
        self.seen_last_index = []  # last timestamp of each received frame

    @property
    def id(self):
        return "recording"

    @property
    def name(self):
        return "Recording Pattern"

    def detect_signal(self, df, symbol=""):
        self.calls.append(df)
        self.seen_last_index.append(df.index[-1])

        if self.signal_on_call is None:
            return None
        if len(self.calls) != self.signal_on_call:
            return None

        return Signal(
            pattern_id=self.id,
            pattern_name=self.name,
            direction=self.direction,
            timestamp=df.index[-1],
            entry_price=self.entry,
            stop_loss=self.stop,
            target=self.target,
            confidence=1.0,
            confluence_factors=["test"],
            risk_reward_ratio=2.0,
        )

    def calculate_stop_loss(self, entry_price, direction, df):
        return self.stop

    def get_required_bars(self):
        return self._required_bars


class AlwaysSignalPattern(RecordingPattern):
    """Emits a signal on every single call."""

    def detect_signal(self, df, symbol=""):
        self.calls.append(df)
        self.seen_last_index.append(df.index[-1])
        return Signal(
            pattern_id=self.id,
            pattern_name=self.name,
            direction=self.direction,
            timestamp=df.index[-1],
            entry_price=self.entry,
            stop_loss=self.stop,
            target=self.target,
            confidence=1.0,
            confluence_factors=["test"],
            risk_reward_ratio=2.0,
        )


@pytest.fixture
def recording_pattern():
    return RecordingPattern()


@pytest.fixture
def always_signal_pattern():
    return AlwaysSignalPattern()
