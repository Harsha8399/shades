#!/usr/bin/env python3
"""
Download historical OHLCV data for backtesting.

Supports multiple data sources:
- Binance via CCXT (primary)
- Yahoo Finance via yfinance (fallback)

Usage:
    python download_data.py                    # Download all defaults
    python download_data.py --symbol BTC/USDT  # Specific symbol
    python download_data.py --source yfinance  # Use yfinance
"""
import argparse
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List

import pandas as pd

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


def download_binance(
    symbol: str,
    timeframe: str = '1h',
    days: int = 730,  # ~2 years
    output_dir: Path = None,
) -> pd.DataFrame:
    """
    Download data from Binance using CCXT.
    
    Args:
        symbol: Trading pair (e.g., 'BTC/USDT')
        timeframe: Candle timeframe ('1h', '4h', '1d')
        days: Number of days of history
        output_dir: Directory to save CSV
    
    Returns:
        DataFrame with OHLCV data
    """
    try:
        import ccxt
    except ImportError:
        print("Error: ccxt not installed. Run: pip install ccxt")
        sys.exit(1)
    
    print(f"[Binance] Downloading {symbol} {timeframe} data...")
    
    exchange = ccxt.binance({
        'enableRateLimit': True,
    })
    
    # Calculate time range
    end_time = datetime.now()
    start_time = end_time - timedelta(days=days)
    since = int(start_time.timestamp() * 1000)
    
    all_ohlcv = []
    
    # Binance returns max 1000 candles per request
    limit = 1000
    
    while True:
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=limit)
            
            if not ohlcv:
                break
            
            all_ohlcv.extend(ohlcv)
            
            # Update since for next batch
            since = ohlcv[-1][0] + 1
            
            print(f"  Downloaded {len(all_ohlcv)} candles...")
            
            # Check if we've reached current time
            if ohlcv[-1][0] >= int(end_time.timestamp() * 1000):
                break
            
            # Rate limiting
            time.sleep(0.5)
            
        except Exception as e:
            print(f"  Warning: {e}")
            time.sleep(2)
            continue
    
    # Convert to DataFrame
    df = pd.DataFrame(
        all_ohlcv,
        columns=['timestamp', 'open', 'high', 'low', 'close', 'volume']
    )
    
    # Convert timestamp to datetime
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df.set_index('datetime', inplace=True)
    
    # Remove duplicates
    df = df[~df.index.duplicated(keep='first')]
    df = df.sort_index()
    
    print(f"[Binance] Downloaded {len(df)} candles from {df.index[0]} to {df.index[-1]}")
    
    # Save to CSV
    if output_dir:
        filename = symbol.replace('/', '_').lower() + f'_{timeframe}.csv'
        filepath = output_dir / filename
        df.to_csv(filepath)
        print(f"[Binance] Saved to {filepath}")
    
    return df


def download_yfinance(
    symbol: str,
    interval: str = '1h',
    period: str = '2y',
    output_dir: Path = None,
) -> pd.DataFrame:
    """
    Download data from Yahoo Finance.
    
    Note: yfinance has limitations:
    - 1h data only available for last 730 days
    - Some crypto pairs may not be available
    
    Args:
        symbol: Yahoo symbol (e.g., 'BTC-USD')
        interval: Candle interval ('1h', '1d')
        period: History period ('1y', '2y', 'max')
        output_dir: Directory to save CSV
    
    Returns:
        DataFrame with OHLCV data
    """
    try:
        import yfinance as yf
    except ImportError:
        print("Error: yfinance not installed. Run: pip install yfinance")
        sys.exit(1)
    
    print(f"[yfinance] Downloading {symbol} {interval} data...")
    
    df = yf.download(symbol, period=period, interval=interval, progress=False)
    
    if df.empty:
        print(f"[yfinance] No data returned for {symbol}")
        return df
    
    # Flatten multi-index columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    
    # Rename columns to lowercase
    df.columns = [c.lower() for c in df.columns]
    
    # Add timestamp column
    df['timestamp'] = (df.index.astype('int64') // 10**6).astype('int64')
    
    print(f"[yfinance] Downloaded {len(df)} candles from {df.index[0]} to {df.index[-1]}")
    
    # Save to CSV
    if output_dir:
        filename = symbol.replace('-', '_').lower() + f'_{interval}.csv'
        filepath = output_dir / filename
        df.to_csv(filepath)
        print(f"[yfinance] Saved to {filepath}")
    
    return df


def download_all_defaults(output_dir: Path, source: str = 'binance') -> dict:
    """
    Download default set of symbols.
    
    Returns:
        Dictionary of symbol -> DataFrame
    """
    results = {}
    
    if source == 'binance':
        symbols = [
            ('BTC/USDT', '1h'),
            ('ETH/USDT', '1h'),
            ('BTC/USDT', '4h'),
            ('ETH/USDT', '4h'),
        ]
        
        for symbol, timeframe in symbols:
            try:
                df = download_binance(symbol, timeframe, output_dir=output_dir)
                results[f"{symbol}_{timeframe}"] = df
            except Exception as e:
                print(f"Error downloading {symbol} {timeframe}: {e}")
    
    else:  # yfinance
        symbols = [
            ('BTC-USD', '1h'),
            ('ETH-USD', '1h'),
        ]
        
        for symbol, interval in symbols:
            try:
                df = download_yfinance(symbol, interval, output_dir=output_dir)
                results[f"{symbol}_{interval}"] = df
            except Exception as e:
                print(f"Error downloading {symbol} {interval}: {e}")
    
    return results


def main():
    parser = argparse.ArgumentParser(description='Download OHLCV data for backtesting')
    parser.add_argument('--symbol', type=str, help='Trading symbol (e.g., BTC/USDT or BTC-USD)')
    parser.add_argument('--timeframe', type=str, default='1h', help='Timeframe (1h, 4h, 1d)')
    parser.add_argument('--days', type=int, default=730, help='Days of history')
    parser.add_argument('--source', type=str, default='binance', choices=['binance', 'yfinance'])
    parser.add_argument('--output', type=str, default=None, help='Output directory')
    
    args = parser.parse_args()
    
    # Determine output directory
    if args.output:
        output_dir = Path(args.output)
    else:
        output_dir = Path(__file__).parent.parent / 'data'
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Output directory: {output_dir}")
    print()
    
    if args.symbol:
        # Download specific symbol
        if args.source == 'binance':
            download_binance(args.symbol, args.timeframe, args.days, output_dir)
        else:
            download_yfinance(args.symbol, args.timeframe, output_dir=output_dir)
    else:
        # Download all defaults
        print("Downloading default symbols...")
        print()
        download_all_defaults(output_dir, args.source)
    
    print()
    print("Done!")
    
    # List downloaded files
    print("\nDownloaded files:")
    for f in sorted(output_dir.glob('*.csv')):
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name}: {size_mb:.2f} MB")


if __name__ == '__main__':
    main()

