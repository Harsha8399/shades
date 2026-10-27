"""
Data loading utilities for the research lab.
"""
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Optional, Union, Literal
from datetime import datetime


class DataValidationError(ValueError):
    """
    Raised when OHLCV data violates the integrity rules.

    Subclasses ValueError so existing ``except ValueError`` handlers continue
    to work.
    """
    pass


# Timestamps whose magnitude is at least this value are interpreted as
# milliseconds since the epoch; smaller values are interpreted as seconds.
# 1e11 ms is 1973-03-03, and 1e11 s is year 5138, so the split is unambiguous
# for any realistic market data.
_EPOCH_MS_THRESHOLD = 1e11


def _is_numeric(value) -> bool:
    """
    Return True if the value is a real number.

    Uses ``numbers.Number`` semantics rather than ``isinstance(x, (int, float))``
    because pandas/numpy integer columns yield ``numpy.int64`` values, which are
    NOT subclasses of ``int`` in NumPy 2.x. Relying on ``isinstance`` caused every
    epoch-millisecond CSV to be mis-parsed as nanoseconds and collapse to 1970.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float, np.integer, np.floating)):
        return True
    return False


def parse_timestamps(
    series: pd.Series,
    date_format: Optional[str] = None,
) -> pd.Series:
    """
    Parse a timestamp column into a timezone-naive datetime series.

    Handles the three shapes encountered in practice:

    * numeric epoch values (seconds or milliseconds)
    * ISO-8601 style strings
    * already-datetime values

    Args:
        series: Raw timestamp column
        date_format: Optional explicit format string

    Returns:
        Series of ``pd.Timestamp``
    """
    if date_format:
        return pd.to_datetime(series, format=date_format)

    # Already datetime-like?
    if pd.api.types.is_datetime64_any_dtype(series):
        return pd.to_datetime(series)

    sample = series.iloc[0] if len(series) else None
    if _is_numeric(sample):
        values = pd.to_numeric(series, errors='coerce')
        if values.isna().any():
            raise DataValidationError(
                "Timestamp column contains non-numeric values that could not be coerced"
            )
        # Decide seconds vs milliseconds from the magnitude of the values.
        if float(values.abs().max()) >= _EPOCH_MS_THRESHOLD:
            return pd.to_datetime(values, unit='ms')
        return pd.to_datetime(values, unit='s')

    return pd.to_datetime(series)


def validate_ohlcv(
    df: pd.DataFrame,
    on_duplicate: Literal['raise', 'first', 'last'] = 'raise',
    on_invalid: Literal['raise', 'drop'] = 'raise',
) -> pd.DataFrame:
    """
    Validate OHLCV data integrity.

    Enforces the rules documented in ``docs/EXECUTION_SEMANTICS.md`` section 6:

    * unique, monotonically increasing timestamps
    * ``high >= max(open, close)``
    * ``low <= min(open, close)``
    * ``high >= low``
    * strictly positive prices
    * non-negative volume
    * no NaN values

    Args:
        df: DataFrame with DatetimeIndex and OHLCV columns
        on_duplicate: How to handle duplicate timestamps
        on_invalid: How to handle rows violating the OHLC rules

    Returns:
        A validated, sorted DataFrame

    Raises:
        DataValidationError: When data violates a rule and the policy is 'raise'
    """
    required = ['open', 'high', 'low', 'close']
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise DataValidationError(f"Missing required column(s): {missing}")

    df = df.copy()

    # --- duplicates -------------------------------------------------------
    if df.index.has_duplicates:
        if on_duplicate == 'raise':
            dupes = df.index[df.index.duplicated()].unique()
            raise DataValidationError(
                f"Duplicate timestamps found ({len(dupes)} unique): {list(dupes[:5])}"
            )
        df = df[~df.index.duplicated(keep='first' if on_duplicate == 'first' else 'last')]

    # --- ordering ---------------------------------------------------------
    if not df.index.is_monotonic_increasing:
        df = df.sort_index()

    # --- NaN --------------------------------------------------------------
    check_cols = required + (['volume'] if 'volume' in df.columns else [])
    if df[check_cols].isna().any().any():
        bad = df[df[check_cols].isna().any(axis=1)]
        raise DataValidationError(
            f"Found {len(bad)} row(s) with NaN in OHLCV columns"
        )

    # --- OHLC relationships ----------------------------------------------
    invalid_mask = (
        (df['high'] < df['low'])
        | (df['high'] < df['open'])
        | (df['high'] < df['close'])
        | (df['low'] > df['open'])
        | (df['low'] > df['close'])
    )
    if invalid_mask.any():
        if on_invalid == 'raise':
            bad = df[invalid_mask]
            raise DataValidationError(
                f"Found {len(bad)} row(s) with invalid OHLC relationships "
                f"(high must be >= max(open, close); low must be <= min(open, close); "
                f"high must be >= low). First offending rows:\n{bad.head(3)}"
            )
        df = df[~invalid_mask]

    # --- positivity -------------------------------------------------------
    nonpositive_mask = (df[required] <= 0).any(axis=1)
    if nonpositive_mask.any():
        if on_invalid == 'raise':
            bad = df[nonpositive_mask]
            raise DataValidationError(
                f"Found {len(bad)} row(s) with non-positive prices"
            )
        df = df[~nonpositive_mask]

    # --- volume -----------------------------------------------------------
    if 'volume' in df.columns and (df['volume'] < 0).any():
        if on_invalid == 'raise':
            raise DataValidationError("Found negative volume values")
        df = df[df['volume'] >= 0]

    return df


def load_csv(
    filepath: Union[str, Path],
    timestamp_col: str = 'timestamp',
    date_format: Optional[str] = None,
    validate: bool = True,
    on_duplicate: Literal['raise', 'first', 'last'] = 'raise',
    on_invalid: Literal['raise', 'drop'] = 'raise',
) -> pd.DataFrame:
    """
    Load OHLCV data from a CSV file.

    Args:
        filepath: Path to the CSV file
        timestamp_col: Name of the timestamp column
        date_format: Optional date format string for parsing
        validate: Run OHLCV integrity validation
        on_duplicate: How to handle duplicate timestamps
        on_invalid: How to handle rows violating the OHLC rules

    Returns:
        DataFrame with DatetimeIndex and OHLCV columns
    """
    df = pd.read_csv(filepath)
    
    # Normalize column names
    df.columns = df.columns.str.lower().str.strip()
    
    # Handle various timestamp column names
    timestamp_candidates = [timestamp_col, 'date', 'time', 'datetime', 'timestamp']
    timestamp_column = None
    
    for col in timestamp_candidates:
        if col in df.columns:
            timestamp_column = col
            break
    
    if timestamp_column is None:
        raise ValueError(f"No timestamp column found. Available columns: {df.columns.tolist()}")

    # Parse timestamps (handles epoch seconds/ms and ISO strings correctly)
    df['timestamp'] = parse_timestamps(df[timestamp_column], date_format)

    # Set index
    df.set_index('timestamp', inplace=True)
    df.sort_index(inplace=True)

    # Normalize OHLCV columns
    column_mapping = {
        'o': 'open', 'h': 'high', 'l': 'low', 'c': 'close', 'v': 'volume',
        'Open': 'open', 'High': 'high', 'Low': 'low', 'Close': 'close', 'Volume': 'volume',
    }
    df.rename(columns=column_mapping, inplace=True)

    # Ensure required columns exist
    required = ['open', 'high', 'low', 'close']
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")

    # Add volume if missing
    if 'volume' not in df.columns:
        df['volume'] = 0

    df = df[required + ['volume']]

    if validate:
        df = validate_ohlcv(df, on_duplicate=on_duplicate, on_invalid=on_invalid)

    return df


def load_ohlcv(
    filepath: Union[str, Path],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> pd.DataFrame:
    """
    Load OHLCV data with optional date filtering.
    
    Args:
        filepath: Path to the data file
        start_date: Optional start date filter
        end_date: Optional end date filter
    
    Returns:
        Filtered DataFrame
    """
    df = load_csv(filepath)
    
    if start_date:
        df = df[df.index >= start_date]
    
    if end_date:
        df = df[df.index <= end_date]
    
    return df


def infer_timeframe(df: pd.DataFrame) -> str:
    """
    Infer timeframe from OHLCV data.

    Uses the *median* spacing between bars rather than the mean, so that
    overnight/weekend gaps do not distort the result.

    Args:
        df: DataFrame with DatetimeIndex

    Returns:
        Timeframe string (e.g., '1h', '4h', '1d')
    """
    if len(df) < 2:
        return '1h'

    # Median spacing between bars (robust to session gaps)
    deltas = df.index.to_series().diff().dropna()
    if len(deltas) == 0:
        return '1h'
    avg_delta = deltas.median()

    minutes = avg_delta.total_seconds() / 60

    if minutes <= 1.5:
        return '1m'
    elif minutes <= 7.5:
        return '5m'
    elif minutes <= 22.5:
        return '15m'
    elif minutes <= 90:
        return '1h'
    elif minutes <= 360:
        return '4h'
    elif minutes <= 1440 * 1.5:
        return '1d'
    else:
        return '1w'


def infer_bars_per_year(df: pd.DataFrame) -> float:
    """
    Estimate the number of bars per year implied by the data's own spacing.

    Used to annualise Sharpe/Sortino/volatility. Hard-coding 252 (trading days
    at daily frequency) is wrong for intraday data: hourly data has ~8766 bars
    per year, so a 252 factor understates volatility by roughly sqrt(35).

    Args:
        df: DataFrame with DatetimeIndex

    Returns:
        Bars per year (252.0 for daily data)
    """
    if len(df) < 2:
        return 252.0

    deltas = df.index.to_series().diff().dropna()
    if len(deltas) == 0:
        return 252.0

    median_delta = deltas.median()
    minutes = median_delta.total_seconds() / 60
    if minutes <= 0:
        return 252.0

    minutes_per_year = 365.25 * 24 * 60
    return minutes_per_year / minutes


def resample_ohlcv(
    df: pd.DataFrame,
    timeframe: str,
    drop_forming_bar: bool = True,
) -> pd.DataFrame:
    """
    Resample OHLCV data to a different timeframe.

    Causality
    ---------
    The final bucket produced by a resample is almost always **incomplete**: the
    source series simply ends part-way through a higher-timeframe period. Such a
    bucket is not a settled higher-timeframe candle -- it is a snapshot of the
    data that happens to have arrived so far, and its high/low/close will keep
    changing until the period closes.

    Handing that bucket to a decision made at the last source bar is a
    look-ahead bug in disguise: the decision "sees" a higher-timeframe candle
    that, at the decision time, had not yet formed. ``dropna()`` does NOT solve
    this, because an incomplete bucket that contains at least one source bar is
    not NaN.

    With ``drop_forming_bar=True`` (the default) the trailing bucket is dropped
    unless the source data is known to extend to the bucket's closing time. This
    mirrors the TypeScript resampler (``CandleResampler.resample``), which drops
    a trailing full-but-unterminated chunk for the same reason. See
    ``HTF_COMPLETION`` in ``shared/fixtures/strategy_spec.json``.

    Completeness test
    -----------------
    A bucket starting at ``t0`` covering ``[t0, t0 + rule)`` is complete only if
    the last source bar *plus one source bar's duration* reaches ``t0 + rule``.
    Adding the bar duration (rather than testing the bar's start timestamp) is
    what makes a bucket whose final source bar is the last bar of the period
    count as complete.

    Bucketing convention
    --------------------
    Buckets are anchored to the **wall clock** (the pandas default), i.e. a 4h
    bucket starts at 00:00, 04:00, 08:00, ... in the index's own timezone. It
    is NOT session-anchored: on NSE (09:15-15:30, 375 minutes) a 4h wall-clock
    bucket is not aligned to the trading session, so the first bucket of a
    session is partial. That is the convention this engine uses, and it is
    stated in ``docs/stage3/PHASE2_CAUSALITY.md``.

    PARITY CAVEAT (measured; see ``docs/stage3/STAGE3_REVIEW_REPORT.md`` §12):
    the TypeScript ``CandleResampler.resample`` only agrees with this
    wall-clock anchoring when the source series contains a candle exactly on
    an HTF boundary (true for 15m/5m/1h/1m sources; FALSE for offsets that
    never hit a boundary, e.g. 30m candles aligned to 09:15, and for NSE
    session series where every wall-clock 4h bucket is partial). The
    extractor tests use aligned sources; the non-aligned and session cases
    remain open design decisions (Q11/Q12) for Stage 4.

    Args:
        df: Source DataFrame with a DatetimeIndex
        timeframe: Target timeframe (e.g. '1h', '4h', '1d')
        drop_forming_bar: Drop a trailing incomplete bucket (default True).
            Set False only when the caller knows the series is complete, e.g.
            when resampling a fixed historical fixture for a stored expectation.

    Returns:
        Resampled DataFrame
    """
    timeframe_map = {
        '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
        '1h': '1h', '4h': '4h', '1d': '1D', '1w': '1W',
    }

    rule = timeframe_map.get(timeframe, timeframe)

    if len(df) == 0:
        return df.iloc[0:0].copy()

    resampled = df.resample(rule).agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum',
    }).dropna()

    # Drop a LEADING partial bucket. This is independent of
    # ``drop_forming_bar``: it is a bucketing-parity fix against the
    # TypeScript resampler, not a forming-bar causality fix.
    #
    # The first wall-clock bucket usually starts before the first source
    # bar (e.g. a 4h bucket at 08:00 when the data begins at 09:15), so it
    # aggregates only part of its period. The TypeScript resampler never
    # emits such a bucket (it starts at the first candle whose timestamp
    # is aligned to a full HTF boundary), so keeping it here would make
    # the engines' HTF series differ by one leading candle. A bucket is
    # leading-partial when the first source bar arrives after the bucket's
    # own start.
    #
    # Callers that previously relied on pandas' default of keeping that
    # leading partial will see one fewer candle at the head. That change
    # is intentional and shared; it is NOT gated by ``drop_forming_bar``.
    if len(resampled) > 0 and df.index[0] > resampled.index[0]:
        resampled = resampled.iloc[1:]

    if not drop_forming_bar or len(resampled) == 0:
        return resampled

    # Duration of one source bar, used to decide whether the final source bar
    # reaches the end of its bucket.
    deltas = df.index.to_series().diff().dropna()
    if len(deltas) == 0:
        # A single source bar cannot be shown to complete any bucket.
        return resampled.iloc[:-1]

    bar_delta = deltas.median()

    try:
        rule_delta = pd.tseries.frequencies.to_offset(rule)
    except (ValueError, TypeError):
        # Unknown rule: be conservative and drop the trailing bucket.
        return resampled.iloc[:-1]

    last_bucket_start = resampled.index[-1]
    bucket_end = last_bucket_start + rule_delta
    covers_until = df.index[-1] + bar_delta

    if covers_until < bucket_end:
        return resampled.iloc[:-1]

    return resampled


def resample_30m_to_1h_session_aligned(df: pd.DataFrame) -> pd.DataFrame:
    """
    Resample NSE 30m candles to 1h session-aligned candles.

    NSE session: 09:15–15:30 IST (375 minutes = 12.5 × 30m periods)
    Complete 1h pairs (6 pairs per normal session):
      09:15 + 09:45 → 09:15–10:15
      10:15 + 10:45 → 10:15–11:15
      11:15 + 11:45 → 11:15–12:15
      12:15 + 12:45 → 12:15–13:15
      13:15 + 13:45 → 13:15–14:15
      14:15 + 14:45 → 14:15–15:15

    The 15:15 30m candle (if present) is a partial interval and is NOT paired.
    Candles are grouped by trading day; never paired across days or gaps.
    Missing opening candle (not at 09:15 IST) causes the entire day to be skipped.

    Args:
        df: Source DataFrame with DatetimeIndex (UTC timestamps representing IST candle starts)
            and OHLCV columns. Must have at least 2 candles.

    Returns:
        DataFrame with session-aligned 1h candles (UTC timestamps = IST open time)
    """
    if len(df) < 2:
        return df.iloc[0:0].copy()

    # Ensure we have a DatetimeIndex
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("DataFrame must have a DatetimeIndex")

    expected_interval = pd.Timedelta(minutes=30)
    # Session open in UTC: 09:15 IST = 03:45 UTC
    session_open_utc = pd.Timedelta(hours=3, minutes=45)
    resampled_rows = []

    # Group by trading day (IST date)
    # Convert UTC timestamps to IST for grouping, then back
    ist_offset = pd.Timedelta(hours=5, minutes=30)
    ist_index = df.index + ist_offset
    day_keys = pd.Series(ist_index.date, index=df.index)

    for day in sorted(day_keys.unique()):
        day_mask = day_keys == day
        day_df = df[day_mask]

        if len(day_df) < 2:
            continue

        # Validate session opens at expected time (09:15 IST = 03:45 UTC)
        # Missing or misaligned opening candle invalidates the entire day's pairing
        first_candle_time = day_df.index[0]
        first_candle_time_of_day = first_candle_time - first_candle_time.normalize()
        if first_candle_time_of_day != session_open_utc:
            continue

        # Pair consecutive 30m candles: (0,1), (2,3), ...
        for i in range(0, len(day_df) - 1, 2):
            c1 = day_df.iloc[i]
            c2 = day_df.iloc[i + 1]

            # Validate exact expected interval (no missing candles, no gaps)
            actual_interval = day_df.index[i + 1] - day_df.index[i]
            if actual_interval != expected_interval:
                # Gap or missing candle: skip this pair
                continue

            # Valid pair: aggregate into 1h candle
            # Timestamp = first candle's timestamp (session-aligned, e.g., 03:45 UTC for 09:15 IST)
            htf_row = {
                'open': c1['open'],
                'high': max(c1['high'], c2['high']),
                'low': min(c1['low'], c2['low']),
                'close': c2['close'],
                'volume': (c1.get('volume', 0) + c2.get('volume', 0)),
            }
            resampled_rows.append((day_df.index[i], htf_row))

    if not resampled_rows:
        return df.iloc[0:0].copy()

    resampled_df = pd.DataFrame(
        [row for _, row in resampled_rows],
        index=pd.DatetimeIndex([ts for ts, _ in resampled_rows])
    )
    resampled_df.index.name = 'timestamp'
    return resampled_df

