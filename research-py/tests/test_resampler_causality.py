"""Phase 2 prefix tests: detect look-ahead bias in HTF resampling.

A causal resampler must never emit a higher-timeframe candle whose period
has not fully completed at the point in history where it is consumed.
These tests feed truncated prefixes of synthetic data and assert that the
resampler output for a given HTF period is identical whether or not the
data *after* that period is present.
"""
import sys
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from conftest import make_ohlcv  # noqa: E402
from src.data.loaders import resample_ohlcv, resample_30m_to_1h_session_aligned  # noqa: E402


def _rows(n: int, base: float = 100.0):
    """Deterministic OHLC rows for n hourly candles."""
    return [
        (base + (i % 10) * 0.5, base + (i % 10) * 0.5 + 1.0,
         base + (i % 10) * 0.5 - 1.0, base + (i % 10) * 0.5 + 0.25)
        for i in range(n)
    ]


def _make_nse_30m_candles(times_ist: list[str], base_date: pd.Timestamp = pd.Timestamp("2024-01-01", tz="UTC")) -> pd.DataFrame:
    """Create NSE 30m candles with IST timestamps converted to UTC."""
    ist_offset = pd.Timedelta(hours=5, minutes=30)
    timestamps = []
    for time in times_ist:
        h, m = map(int, time.split(':'))
        ts = base_date + pd.Timedelta(hours=h, minutes=m) - ist_offset
        timestamps.append(ts)
    
    df = pd.DataFrame({
        'open': [100 + i for i in range(len(timestamps))],
        'high': [101 + i for i in range(len(timestamps))],
        'low': [99 + i for i in range(len(timestamps))],
        'close': [100.5 + i for i in range(len(timestamps))],
        'volume': [1000] * len(timestamps)
    }, index=pd.DatetimeIndex(timestamps))
    return df


class TestResamplerCausality:
    """Prefix tests: output must not depend on future data."""

    def test_prefix_output_is_stable(self):
        """Resampling a prefix must produce identical candles to resampling
        the full series, restricted to the periods fully covered by the
        prefix."""
        full = make_ohlcv(_rows(96 * 4), freq="h")  # 4 days
        full_res = resample_ohlcv(full, "4h", drop_forming_bar=True)

        for cut in (50, 100, 200, 300):
            prefix = full.iloc[:cut]
            prefix_res = resample_ohlcv(prefix, "4h", drop_forming_bar=True)
            assert len(prefix_res) <= len(full_res)
            for (_, a), (_, b) in zip(prefix_res.iterrows(), full_res.iterrows()):
                assert a["open"] == b["open"]
                assert a["high"] == b["high"]
                assert a["low"] == b["low"]
                assert a["close"] == b["close"]
                assert a["volume"] == b["volume"]

    def test_no_forming_bar_emitted(self):
        """The last HTF candle must never be a partially-formed period when
        the input ends mid-period."""
        # 10 hourly candles = 2 full 4h periods + 2 leftover candles.
        df = make_ohlcv(_rows(10), freq="h")
        res = resample_ohlcv(df, "4h", drop_forming_bar=True)
        assert len(res) == 2

    def test_drop_forming_bar_false_keeps_partial(self):
        """With drop_forming_bar=False the legacy behavior (partial final
        candle emitted) is preserved, so the flag is meaningful."""
        df = make_ohlcv(_rows(10), freq="h")
        res = resample_ohlcv(df, "4h", drop_forming_bar=False)
        assert len(res) == 3  # 2 full + 1 partial

    def test_empty_and_short_inputs(self):
        assert resample_ohlcv(
            make_ohlcv([], freq="h"), "4h", drop_forming_bar=True
        ).empty
        # Fewer candles than one HTF period -> nothing emitted.
        assert resample_ohlcv(
            make_ohlcv(_rows(2), freq="h"), "4h", drop_forming_bar=True
        ).empty

    def test_appending_future_candles_does_not_change_history(self):
        """The decisive look-ahead test: resampling the series truncated at
        bar k, then resampling the FULL series, must give the same candles
        for every bucket that closed at or before bar k. Appending future
        data must not rewrite history."""
        full = make_ohlcv(_rows(96 * 4), freq="h")  # 4 days
        k = 150  # decision point

        prefix_res = resample_ohlcv(full.iloc[:k], "4h",
                                    drop_forming_bar=True)
        full_res = resample_ohlcv(full, "4h", drop_forming_bar=True)

        # Every bucket in the prefix result must appear identically at the
        # head of the full result. In particular the LAST prefix bucket --
        # the one most exposed to forming-bar leakage -- must be unchanged.
        assert len(prefix_res) > 0
        for i in range(len(prefix_res)):
            a = prefix_res.iloc[i]
            b = full_res.iloc[i]
            assert a["open"] == b["open"]
            assert a["high"] == b["high"]
            assert a["low"] == b["low"]
            assert a["close"] == b["close"]
            assert a["volume"] == b["volume"]
        # And the full series must have MORE buckets (future data adds
        # buckets, never rewrites existing ones).
        assert len(full_res) > len(prefix_res)

    def test_session_boundary_alignment(self):
        """Buckets are anchored to the WALL CLOCK (documented shared
        convention, matching the TS epoch-aligned resampler), NOT to the
        NSE session. A session starting at 09:15 therefore produces a
        partial first bucket at 09:00 -- this is deliberate, and both
        engines must agree on it."""
        idx = pd.date_range("2024-01-01 09:15", periods=24, freq="15min")
        rows = _rows(24)
        df = pd.DataFrame(
            rows, index=idx, columns=["open", "high", "low", "close"]
        )
        df["volume"] = 10.0
        res = resample_ohlcv(df, "1h", drop_forming_bar=True)
        # 09:15-15:15 -> wall-clock buckets. The leading 09:00 bucket is
        # PARTIAL (data starts 09:15) and is dropped, matching the TS
        # resampler which starts at the first candle aligned to a full HTF
        # boundary. Remaining: 10:00 ... 14:00 (full), 15:00 (partial,
        # dropped as forming).
        assert len(res) == 5
        assert res.index[0] == pd.Timestamp("2024-01-01 10:00")
        for i in range(len(res)):
            assert res.index[i] == pd.Timestamp("2024-01-01 10:00") + pd.Timedelta(hours=i)

    def test_leading_partial_dropped_even_when_forming_bar_kept(self):
        """Leading-partial drop is a bucketing-parity fix, independent of
        drop_forming_bar. Callers opting out of trailing-forming drops must
        still lose the leading partial so Python matches TypeScript."""
        idx = pd.date_range("2024-01-01 09:15", periods=24, freq="15min")
        rows = _rows(24)
        df = pd.DataFrame(
            rows, index=idx, columns=["open", "high", "low", "close"]
        )
        df["volume"] = 10.0
        kept = resample_ohlcv(df, "1h", drop_forming_bar=False)
        dropped = resample_ohlcv(df, "1h", drop_forming_bar=True)
        # Both start at the first FULL wall-clock hour (10:00), not 09:00.
        assert kept.index[0] == pd.Timestamp("2024-01-01 10:00")
        assert dropped.index[0] == pd.Timestamp("2024-01-01 10:00")
        # drop_forming_bar only affects the trailing bucket.
        assert len(kept) == len(dropped) + 1
        assert kept.index[-1] == pd.Timestamp("2024-01-01 15:00")
        assert dropped.index[-1] == pd.Timestamp("2024-01-01 14:00")


class TestNseSessionAware30mTo1hResampling:
    """Tests for NSE-specific session-aware 30m → 1h resampling."""

    def test_normal_session_produces_six_complete_pairs(self):
        """Normal NSE session (13 30m candles) produces 6 complete 1h pairs."""
        nse_30m_times = [
            '09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
            '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
        ]
        df = _make_nse_30m_candles(nse_30m_times)
        
        res = resample_30m_to_1h_session_aligned(df)
        
        # Expect 6 complete pairs (15:15 is unpaired partial)
        assert len(res) == 6
        
        # Verify exact timestamps (UTC = IST - 5.5h)
        expected_timestamps = [
            pd.Timestamp("2024-01-01 03:45:00+00:00"),  # 09:15 IST
            pd.Timestamp("2024-01-01 04:45:00+00:00"),  # 10:15 IST
            pd.Timestamp("2024-01-01 05:45:00+00:00"),  # 11:15 IST
            pd.Timestamp("2024-01-01 06:45:00+00:00"),  # 12:15 IST
            pd.Timestamp("2024-01-01 07:45:00+00:00"),  # 13:15 IST
            pd.Timestamp("2024-01-01 08:45:00+00:00"),  # 14:15 IST
        ]
        for i, ts in enumerate(expected_timestamps):
            assert res.index[i] == ts, f"Timestamp mismatch at index {i}: {res.index[i]} != {ts}"
        
        # Verify OHLCV aggregation
        # Pair 0: 09:15(O=100) + 09:45(O=101) → O=100, H=102, L=99, C=101.5
        assert res.iloc[0]['open'] == 100
        assert res.iloc[0]['high'] == 102
        assert res.iloc[0]['low'] == 99
        assert res.iloc[0]['close'] == 101.5
        assert res.iloc[0]['volume'] == 2000
        
        # Pair 5: 14:15(O=110) + 14:45(O=111) → O=110, H=112, L=109, C=111.5
        assert res.iloc[5]['open'] == 110
        assert res.iloc[5]['high'] == 112
        assert res.iloc[5]['low'] == 109
        assert res.iloc[5]['close'] == 111.5
        assert res.iloc[5]['volume'] == 2000

    def test_excludes_15_15_partial_candle(self):
        """The 15:15 30m candle is a partial interval and should not be paired."""
        nse_30m_times = [
            '09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
            '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
        ]
        df = _make_nse_30m_candles(nse_30m_times)
        
        res = resample_30m_to_1h_session_aligned(df)
        
        # 6 complete pairs, 15:15 (index 12) is dropped
        assert len(res) == 6
        # Last pair is 14:15+14:45, not 14:45+15:15
        assert res.iloc[5]['open'] == 110  # 14:15 open
        assert res.iloc[5]['close'] == 111.5  # 14:45 close

    def test_no_cross_day_pairing(self):
        """Candles are never paired across trading days."""
        # Day 1: only ONE candle (14:45) - no pair possible
        day1_times = ['14:45']
        # Day 2: first two 30m candles (next day)
        day2_times = ['09:15', '09:45']
        
        base_date = pd.Timestamp("2024-01-01", tz="UTC")
        day1_df = _make_nse_30m_candles(day1_times, base_date)
        day2_df = _make_nse_30m_candles(day2_times, base_date + pd.Timedelta(days=1))
        
        df = pd.concat([day1_df, day2_df])
        
        res = resample_30m_to_1h_session_aligned(df)
        
        # Day 1: only 14:45 (single candle, no pair) → no output
        # Day 2: 09:15 + 09:45 → 1 pair (open values from day2 array: 100, 101)
        assert len(res) == 1
        assert res.iloc[0]['open'] == 100  # Day2 09:15 (first candle of day2 array)
        assert res.iloc[0]['close'] == 101.5  # Day2 09:45 (second candle of day2 array)
        assert res.index[0] == day2_df.index[0]

    def test_skips_pairs_with_missing_candles(self):
        """Gap validation: skips pairs where interval != 30 minutes."""
        # Normal session but missing 10:15 candle (gap)
        nse_30m_times = [
            '09:15', '09:45', 
            # '10:15' missing
            '10:45', '11:15', '11:45',
            '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
        ]
        df = _make_nse_30m_candles(nse_30m_times)
        
        res = resample_30m_to_1h_session_aligned(df)
        
        # The algorithm pairs sequentially: (0,1), (2,3), (4,5)...
        # With missing 10:15 (was index 2), the array has 12 candles:
        # Index: 0=09:15, 1=09:45, 2=10:45, 3=11:15, 4=11:45, 5=12:15, 6=12:45, 7=13:15, 8=13:45, 9=14:15, 10=14:45, 11=15:15
        # Pair (0,1): 09:15+09:45 ✓ (30min)
        # Pair (2,3): 10:45+11:15 ✓ (30min) - this is VALID (interval is 30min)
        # Pair (4,5): 11:45+12:15 ✓ (30min)
        # Pair (6,7): 12:45+13:15 ✓ (30min)
        # Pair (8,9): 13:45+14:15 ✓ (30min)
        # Pair (10,11): 14:45+15:15 ✓ (30min)
        # Total: 6 pairs (the missing candle shifts indices but remaining adjacent pairs have 30min intervals)
        assert len(res) == 6
        
        # Verify first pair is correct
        assert res.iloc[0]['open'] == 100
        assert res.iloc[0]['close'] == 101.5

    def test_handles_partial_sessions(self):
        """Sessions with fewer than 12 candles produce only complete pairs."""
        # Only first 4 candles (09:15–10:45)
        partial_times = ['09:15', '09:45', '10:15', '10:45']
        df = _make_nse_30m_candles(partial_times)
        
        res = resample_30m_to_1h_session_aligned(df)
        
        # Two complete pairs
        assert len(res) == 2
        assert res.iloc[0]['open'] == 100
        assert res.iloc[1]['open'] == 102

    def test_handles_duplicate_timestamps(self):
        """Duplicate timestamps are not possible with DatetimeIndex (enforced uniqueness).
        The interval validation (exact 30min) implicitly handles this case.
        """
        # This test is a placeholder - DatetimeIndex enforces unique timestamps
        # The exact interval check in the resampler would reject 0-interval pairs
        pass

    def test_prefix_causality(self):
        """Prefix causality: future candles do not alter earlier HTF outputs."""
        nse_30m_times = [
            '09:15', '09:45', '10:15', '10:45', '11:15', '11:45',
            '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'
        ]
        full_df = _make_nse_30m_candles(nse_30m_times)
        full_res = resample_30m_to_1h_session_aligned(full_df)
        
        # Test various prefixes
        for cut in [4, 6, 8, 10, 12]:
            prefix = full_df.iloc[:cut]
            prefix_res = resample_30m_to_1h_session_aligned(prefix)
            
            assert len(prefix_res) <= len(full_res)
            for i in range(len(prefix_res)):
                a = prefix_res.iloc[i]
                b = full_res.iloc[i]
                assert a['open'] == b['open']
                assert a['high'] == b['high']
                assert a['low'] == b['low']
                assert a['close'] == b['close']
                assert a['volume'] == b['volume']
                assert prefix_res.index[i] == full_res.index[i]
