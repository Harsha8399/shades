"""
Tests for the data loading layer: timestamp parsing, ordering, duplicates
and OHLCV integrity.
"""
import os
import tempfile

import pandas as pd
import pytest

from conftest import make_ohlcv

from src.data.loaders import (
    load_csv,
    load_ohlcv,
    parse_timestamps,
    validate_ohlcv,
    infer_timeframe,
    infer_bars_per_year,
    resample_ohlcv,
    DataValidationError,
)


def write_csv(content):
    """Write CSV content to a temp file and return its path."""
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w") as f:
        f.write(content)
    return path


class TestTimestampParsing:
    """Epoch timestamps must be interpreted correctly."""

    def test_epoch_milliseconds_are_parsed_as_milliseconds(self):
        """
        A regression test for a real bug: pandas produces numpy.int64 values
        for integer columns, and numpy.int64 is NOT a subclass of int in
        NumPy 2.x. The old `isinstance(sample, (int, float))` check therefore
        never matched, so every epoch-millisecond file was parsed as
        nanoseconds and collapsed onto 1970-01-01.
        """
        series = pd.Series([1705500000000, 1705503600000])
        parsed = parse_timestamps(series)

        assert parsed.iloc[0] == pd.Timestamp("2024-01-17 14:00:00")
        assert parsed.iloc[1] == pd.Timestamp("2024-01-17 15:00:00")

    def test_epoch_seconds_are_parsed_as_seconds(self):
        series = pd.Series([1705500000, 1705503600])
        parsed = parse_timestamps(series)

        assert parsed.iloc[0] == pd.Timestamp("2024-01-17 14:00:00")

    def test_iso_strings_are_parsed(self):
        series = pd.Series(["2024-01-17 14:00:00", "2024-01-17 15:00:00"])
        parsed = parse_timestamps(series)

        assert parsed.iloc[0] == pd.Timestamp("2024-01-17 14:00:00")

    def test_a_numpy_int64_sample_is_recognised_as_numeric(self):
        """
        The exact type produced by read_csv for an integer column.
        """
        series = pd.Series([1705500000000, 1705503600000])
        assert series.iloc[0].__class__.__name__ == "int64"
        parsed = parse_timestamps(series)
        assert parsed.iloc[0].year == 2024

    def test_explicit_date_format_is_honoured(self):
        series = pd.Series(["17/01/2024 14:00", "17/01/2024 15:00"])
        parsed = parse_timestamps(series, date_format="%d/%m/%Y %H:%M")
        assert parsed.iloc[0] == pd.Timestamp("2024-01-17 14:00:00")


class TestLoadCsv:
    """End-to-end CSV loading."""

    def test_epoch_ms_file_loads_with_correct_dates(self):
        content = (
            "timestamp,open,high,low,close,volume\n"
            "1705500000000,100,110,90,105,10\n"
            "1705503600000,105,115,95,110,20\n"
        )
        path = write_csv(content)
        try:
            df = load_csv(path)
            assert len(df) == 2
            assert df.index[0] == pd.Timestamp("2024-01-17 14:00:00")
            assert df.index[1] == pd.Timestamp("2024-01-17 15:00:00")
        finally:
            os.unlink(path)

    def test_datetime_column_is_preferred_when_present(self):
        """
        The bundled datasets carry both a `datetime` string column and a
        `timestamp` epoch column. The string column must win, otherwise the
        epoch column's unit has to be guessed.
        """
        content = (
            "datetime,timestamp,open,high,low,close,volume\n"
            "2024-01-17 14:00:00,1705500000000,100,110,90,105,10\n"
            "2024-01-17 15:00:00,1705503600000,105,115,95,110,20\n"
        )
        path = write_csv(content)
        try:
            df = load_csv(path)
            assert df.index[0] == pd.Timestamp("2024-01-17 14:00:00")
        finally:
            os.unlink(path)

    def test_missing_volume_column_is_filled_with_zero(self):
        content = (
            "timestamp,open,high,low,close\n"
            "1705500000000,100,110,90,105\n"
        )
        path = write_csv(content)
        try:
            df = load_csv(path)
            assert df["volume"].iloc[0] == 0
        finally:
            os.unlink(path)

    def test_missing_required_column_raises(self):
        content = "timestamp,open,close\n1705500000000,100,105\n"
        path = write_csv(content)
        try:
            with pytest.raises(ValueError, match="Missing required column"):
                load_csv(path)
        finally:
            os.unlink(path)

    def test_duplicate_timestamps_raise_by_default(self):
        content = (
            "timestamp,open,high,low,close,volume\n"
            "1705500000000,100,110,90,105,10\n"
            "1705500000000,100,110,90,105,10\n"
        )
        path = write_csv(content)
        try:
            with pytest.raises(DataValidationError, match="Duplicate timestamps"):
                load_csv(path)
        finally:
            os.unlink(path)

    def test_duplicate_timestamps_can_be_kept_last(self):
        content = (
            "timestamp,open,high,low,close,volume\n"
            "1705500000000,100,110,90,105,10\n"
            "1705500000000,100,110,90,106,10\n"
        )
        path = write_csv(content)
        try:
            df = load_csv(path, on_duplicate="last")
            assert len(df) == 1
            assert df["close"].iloc[0] == 106
        finally:
            os.unlink(path)

    def test_out_of_order_rows_are_sorted(self):
        content = (
            "timestamp,open,high,low,close,volume\n"
            "1705503600000,105,115,95,110,20\n"
            "1705500000000,100,110,90,105,10\n"
        )
        path = write_csv(content)
        try:
            df = load_csv(path)
            assert df.index.is_monotonic_increasing
            assert df.index[0] == pd.Timestamp("2024-01-17 14:00:00")
        finally:
            os.unlink(path)

    def test_invalid_ohlc_rows_raise(self):
        content = (
            "timestamp,open,high,low,close,volume\n"
            "1705500000000,100,50,90,105,10\n"
        )
        path = write_csv(content)
        try:
            with pytest.raises(DataValidationError, match="invalid OHLC"):
                load_csv(path)
        finally:
            os.unlink(path)


class TestValidateOhlcv:
    """The integrity rules in isolation."""

    def test_valid_data_passes_unchanged(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(5)])
        out = validate_ohlcv(df)
        assert len(out) == 5
        pd.testing.assert_frame_equal(out, df)

    def test_high_below_low_is_rejected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(3)])
        df.iloc[1, df.columns.get_loc("high")] = 50.0
        with pytest.raises(DataValidationError):
            validate_ohlcv(df)

    def test_close_above_high_is_rejected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(3)])
        df.iloc[1, df.columns.get_loc("close")] = 200.0
        with pytest.raises(DataValidationError):
            validate_ohlcv(df)

    def test_open_below_low_is_rejected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(3)])
        df.iloc[1, df.columns.get_loc("open")] = 10.0
        with pytest.raises(DataValidationError):
            validate_ohlcv(df)

    def test_nan_is_rejected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(3)])
        df.iloc[1, df.columns.get_loc("close")] = float("nan")
        with pytest.raises(DataValidationError, match="NaN"):
            validate_ohlcv(df)

    def test_negative_volume_is_rejected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(3)])
        df.iloc[1, df.columns.get_loc("volume")] = -1.0
        with pytest.raises(DataValidationError, match="negative volume"):
            validate_ohlcv(df)

    def test_on_invalid_drop_removes_bad_rows(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(3)])
        df.iloc[1, df.columns.get_loc("high")] = 50.0
        out = validate_ohlcv(df, on_invalid="drop")
        assert len(out) == 2

    def test_data_validation_error_is_a_value_error(self):
        """Existing `except ValueError` handlers must keep working."""
        assert issubclass(DataValidationError, ValueError)


class TestTimeframeInference:
    """Timeframe and annualisation inference."""

    def test_hourly_data_is_detected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(30)], freq="h")
        assert infer_timeframe(df) == "1h"

    def test_four_hourly_data_is_detected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(30)], freq="4h")
        assert infer_timeframe(df) == "4h"

    def test_daily_data_is_detected(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(30)], freq="1D")
        assert infer_timeframe(df) == "1d"

    def test_bars_per_year_for_hourly_data(self):
        """
        Hourly data has ~8766 bars per year, not 252. Using 252 would
        understate volatility by a factor of ~sqrt(35).
        """
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(30)], freq="h")
        bpy = infer_bars_per_year(df)
        assert bpy == pytest.approx(365.25 * 24, rel=1e-3)

    def test_bars_per_year_for_daily_data(self):
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(30)], freq="1D")
        assert infer_bars_per_year(df) == pytest.approx(365.25, rel=1e-3)

    def test_median_spacing_is_used_not_mean(self):
        """
        A long overnight gap must not distort the inferred timeframe.
        """
        idx = pd.to_datetime(
            ["2024-01-01 09:00", "2024-01-01 10:00", "2024-01-01 11:00",
             "2024-01-02 09:00", "2024-01-02 10:00", "2024-01-02 11:00"]
        )
        df = pd.DataFrame(
            [[100, 110, 90, 105, 1]] * 6,
            columns=["open", "high", "low", "close", "volume"],
            index=idx,
        )
        assert infer_timeframe(df) == "1h"


class TestResample:
    """Resampling must aggregate OHLC correctly."""

    def test_resample_aggregates_open_high_low_close(self):
        rows = []
        for i in range(8):
            rows.append((100 + i, 105 + i, 95 + i, 102 + i))
        df = make_ohlcv(rows, freq="h")

        out = resample_ohlcv(df, "4h")
        assert len(out) == 2
        assert out["open"].iloc[0] == 100
        assert out["high"].iloc[0] == 108   # max of 105..108
        assert out["low"].iloc[0] == 95
        assert out["close"].iloc[0] == 105  # close of the 4th bar


class TestResampleCausality:
    """
    The resampler must never emit a higher-timeframe candle that had not
    closed at the decision time (spec: HTF_COMPLETION = completed_htf_only).

    These are the Phase 2 lookahead tests. The primary guard is the PREFIX
    test: resampling a prefix of the series and resampling the full series
    must give IDENTICAL rows up to the prefix's last complete bucket. If any
    future data leaks into the trailing bucket, this test fails.
    """

    def test_forming_bucket_is_dropped(self):
        # 15 hourly bars = 3 full 4h buckets + 3 bars of a forming 4th.
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(15)], freq="h")
        out = resample_ohlcv(df, "4h")
        assert len(out) == 3, (
            "the trailing, still-forming 4h bucket must be dropped"
        )

    def test_complete_final_bucket_is_kept(self):
        # 16 hourly bars = exactly 4 complete 4h buckets.
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(16)], freq="h")
        out = resample_ohlcv(df, "4h")
        assert len(out) == 4

    def test_drop_forming_bar_false_keeps_trailing_bucket(self):
        # Explicit opt-out for callers that know the series is complete.
        df = make_ohlcv([(100, 110, 90, 105) for _ in range(15)], freq="h")
        out = resample_ohlcv(df, "4h", drop_forming_bar=False)
        assert len(out) == 4

    def test_prefix_equals_full_series(self):
        """
        THE lookahead guard: for every prefix of the source series, the
        resampled rows that the prefix can prove must be identical to the
        corresponding rows of the full-series resample. A trailing bucket
        that depends on future bars would differ.
        """
        df = make_ohlcv(
            [(100 + i, 110 + i, 90 + i, 105 + i) for i in range(40)],
            freq="h",
        )
        full = resample_ohlcv(df, "4h")

        for cut in range(5, len(df) + 1):
            prefix = resample_ohlcv(df.iloc[:cut], "4h")
            # The prefix's last bucket may be dropped (forming); every bucket
            # the prefix DOES emit must match the full series exactly.
            n = len(prefix)
            assert n <= len(full)
            pd.testing.assert_frame_equal(
                prefix, full.iloc[:n], check_freq=False
            )

    def test_prefix_causality_with_varying_prices(self):
        """
        A stronger variant: give every bar a distinct close so that any leak
        of future data into a trailing bucket changes its close value and is
        caught by the prefix comparison.
        """
        rows = [(100.0 + i, 101.0 + i, 99.0 + i, 100.5 + i) for i in range(33)]
        df = make_ohlcv(rows, freq="15min")
        full = resample_ohlcv(df, "4h")

        for cut in (20, 25, 30, 33):
            prefix = resample_ohlcv(df.iloc[:cut], "4h")
            n = len(prefix)
            assert n <= len(full)
            pd.testing.assert_frame_equal(
                prefix, full.iloc[:n], check_freq=False
            )

    def test_single_bar_series_drops_its_only_bucket(self):
        # One bar can never be shown to complete a bucket.
        df = make_ohlcv([(100, 110, 90, 105)], freq="h")
        out = resample_ohlcv(df, "4h")
        assert len(out) == 0

    def test_empty_series(self):
        df = make_ohlcv([(100, 110, 90, 105)], freq="h").iloc[:0]
        out = resample_ohlcv(df, "4h")
        assert len(out) == 0


class TestLoadOhlcv:
    """Date filtering helper."""

    def test_date_filtering(self):
        rows = [(100, 110, 90, 105) for _ in range(10)]
        df = make_ohlcv(rows, freq="h")

        filtered = df[df.index >= df.index[5]]
        assert len(filtered) == 5
        assert filtered.index[0] == df.index[5]
