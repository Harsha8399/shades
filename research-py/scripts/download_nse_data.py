#!/usr/bin/env python3
"""
NSE Historical Data Downloader

Downloads historical OHLCV data for Indian stocks from Yahoo Finance.
This data can be used directly with the existing CSVLoader in TypeScript.

Usage:
    python scripts/download_nse_data.py --symbols RELIANCE,TCS,INFY --interval 15m --period 60d
    python scripts/download_nse_data.py --nifty50  # Download all Nifty 50 stocks
    python scripts/download_nse_data.py --index NIFTY  # Download Nifty 50 index

Note: Yahoo Finance symbols for NSE stocks use '.NS' suffix (e.g., RELIANCE.NS)
"""

import argparse
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

import pandas as pd
import yfinance as yf

# NSE stock symbols (without .NS suffix)
NIFTY_50_STOCKS = [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
    'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'KOTAKBANK', 'ITC',
    'LT', 'HCLTECH', 'AXISBANK', 'MARUTI', 'ASIANPAINT',
    'TITAN', 'BAJFINANCE', 'DMART', 'SUNPHARMA', 'ULTRACEMCO',
    'WIPRO', 'NESTLEIND', 'TATAMOTORS', 'TECHM', 'NTPC',
    'POWERGRID', 'ONGC', 'COALINDIA', 'JSWSTEEL', 'TATASTEEL',
    'ADANIPORTS', 'BAJAJFINSV', 'GRASIM', 'HINDALCO', 'INDUSINDBK',
    'BRITANNIA', 'M&M', 'DIVISLAB', 'CIPLA', 'EICHERMOT',
    'HEROMOTOCO', 'DRREDDY', 'APOLLOHOSP', 'BPCL', 'TATACONSUM',
    'SBILIFE', 'ADANIENT', 'BAJAJ-AUTO', 'UPL', 'SHREECEM',
]

# MCX Commodity symbols (futures - need special handling)
MCX_COMMODITIES = {
    'GOLD': 'GC=F',        # Gold Futures
    'SILVER': 'SI=F',      # Silver Futures
    'CRUDEOIL': 'CL=F',    # Crude Oil Futures
    'NATURALGAS': 'NG=F',  # Natural Gas Futures
}

# Index symbols
INDICES = {
    'NIFTY': '^NSEI',      # Nifty 50
    'BANKNIFTY': '^NSEBANK',  # Bank Nifty
    'SENSEX': '^BSESN',    # Sensex
}

# Valid intervals for yfinance
VALID_INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo']


def to_yahoo_symbol(symbol: str) -> str:
    """Convert NSE symbol to Yahoo Finance format"""
    symbol = symbol.upper()
    
    # Check if it's an index
    if symbol in INDICES:
        return INDICES[symbol]
    
    # Check if it's a commodity
    if symbol in MCX_COMMODITIES:
        return MCX_COMMODITIES[symbol]
    
    # NSE stocks need .NS suffix
    if not symbol.endswith('.NS'):
        return f"{symbol}.NS"
    
    return symbol


def download_stock_data(
    symbol: str,
    interval: str = '15m',
    period: str = '60d',
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """
    Download historical data for a single stock.
    
    Args:
        symbol: Stock symbol (e.g., 'RELIANCE')
        interval: Candle interval ('1m', '5m', '15m', '1h', '1d')
        period: How far back to fetch ('7d', '30d', '60d', '1y', '2y')
        start_date: Optional start date (YYYY-MM-DD)
        end_date: Optional end date (YYYY-MM-DD)
    
    Returns:
        DataFrame with OHLCV data or None if failed
    """
    yahoo_symbol = to_yahoo_symbol(symbol)
    
    print(f"  Downloading {symbol} ({yahoo_symbol})...")
    
    try:
        ticker = yf.Ticker(yahoo_symbol)
        
        if start_date and end_date:
            df = ticker.history(start=start_date, end=end_date, interval=interval)
        else:
            df = ticker.history(period=period, interval=interval)
        
        if df.empty:
            print(f"    WARNING: No data returned for {symbol}")
            return None
        
        # Rename columns to match our format
        df = df.rename(columns={
            'Open': 'open',
            'High': 'high',
            'Low': 'low',
            'Close': 'close',
            'Volume': 'volume',
        })
        
        # Keep only OHLCV columns
        df = df[['open', 'high', 'low', 'close', 'volume']]
        
        # Reset index to get timestamp as column
        df = df.reset_index()
        df = df.rename(columns={'Datetime': 'timestamp', 'Date': 'timestamp'})
        
        # Convert timestamp to ISO format
        df['timestamp'] = pd.to_datetime(df['timestamp']).dt.strftime('%Y-%m-%dT%H:%M:%S')
        
        print(f"    Downloaded {len(df)} candles")
        
        return df
        
    except Exception as e:
        print(f"    ERROR: Failed to download {symbol}: {e}")
        return None


def save_to_csv(df: pd.DataFrame, symbol: str, interval: str, output_dir: str) -> str:
    """Save DataFrame to CSV file"""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    filename = f"{symbol.lower()}_{interval}.csv"
    filepath = os.path.join(output_dir, filename)
    
    df.to_csv(filepath, index=False)
    print(f"    Saved to {filepath}")
    
    return filepath


def download_multiple_stocks(
    symbols: List[str],
    interval: str = '15m',
    period: str = '60d',
    output_dir: str = 'data/nse',
) -> dict:
    """Download data for multiple stocks"""
    results = {}
    
    print(f"\nDownloading {len(symbols)} stocks...")
    print(f"Interval: {interval}, Period: {period}")
    print(f"Output directory: {output_dir}\n")
    
    for i, symbol in enumerate(symbols, 1):
        print(f"[{i}/{len(symbols)}] {symbol}")
        
        df = download_stock_data(symbol, interval, period)
        
        if df is not None and not df.empty:
            filepath = save_to_csv(df, symbol, interval, output_dir)
            results[symbol] = {
                'filepath': filepath,
                'candles': len(df),
                'start': df['timestamp'].iloc[0],
                'end': df['timestamp'].iloc[-1],
            }
        else:
            results[symbol] = {'error': 'No data'}
    
    return results


def print_summary(results: dict):
    """Print download summary"""
    print("\n" + "="*60)
    print("DOWNLOAD SUMMARY")
    print("="*60)
    
    success = [s for s, r in results.items() if 'error' not in r]
    failed = [s for s, r in results.items() if 'error' in r]
    
    print(f"\nSuccessful: {len(success)}")
    for symbol in success:
        r = results[symbol]
        print(f"  {symbol}: {r['candles']} candles ({r['start']} to {r['end']})")
    
    if failed:
        print(f"\nFailed: {len(failed)}")
        for symbol in failed:
            print(f"  {symbol}: {results[symbol].get('error', 'Unknown error')}")
    
    print("\n" + "="*60)


def main():
    parser = argparse.ArgumentParser(
        description='Download NSE stock data for backtesting',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Download specific stocks
    python download_nse_data.py --symbols RELIANCE,TCS,INFY
    
    # Download all Nifty 50 stocks
    python download_nse_data.py --nifty50
    
    # Download Nifty 50 index
    python download_nse_data.py --index NIFTY
    
    # Download with custom interval and period
    python download_nse_data.py --symbols RELIANCE --interval 1h --period 1y
    
    # Download daily data for 2 years
    python download_nse_data.py --symbols RELIANCE,TCS --interval 1d --period 2y
        """
    )
    
    parser.add_argument('--symbols', type=str, help='Comma-separated stock symbols')
    parser.add_argument('--nifty50', action='store_true', help='Download all Nifty 50 stocks')
    parser.add_argument('--index', type=str, help='Index to download (NIFTY, BANKNIFTY, SENSEX)')
    parser.add_argument('--interval', type=str, default='15m', 
                       choices=VALID_INTERVALS, help='Candle interval')
    parser.add_argument('--period', type=str, default='60d',
                       help='Data period (7d, 30d, 60d, 1y, 2y)')
    parser.add_argument('--output', type=str, default='data/nse',
                       help='Output directory')
    
    args = parser.parse_args()
    
    # Determine symbols to download
    symbols = []
    
    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(',')]
    
    if args.nifty50:
        symbols.extend(NIFTY_50_STOCKS)
    
    if args.index:
        symbols.append(args.index.upper())
    
    if not symbols:
        print("Error: No symbols specified. Use --symbols, --nifty50, or --index")
        parser.print_help()
        return
    
    # Remove duplicates while preserving order
    symbols = list(dict.fromkeys(symbols))
    
    # Note about interval limitations
    if args.interval in ['1m', '2m', '5m', '15m', '30m', '60m', '90m']:
        print(f"\nNote: For {args.interval} interval, Yahoo Finance limits to ~60 days of history")
    
    # Download data
    results = download_multiple_stocks(
        symbols=symbols,
        interval=args.interval,
        period=args.period,
        output_dir=args.output,
    )
    
    # Print summary
    print_summary(results)
    
    print("\nData is ready for backtesting!")
    print("Load in TypeScript: CSVLoader.load('data/nse/reliance_15m.csv')")


if __name__ == '__main__':
    main()

