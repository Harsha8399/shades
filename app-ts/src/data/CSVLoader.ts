import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { Candle, Timeframe } from '../types';

/**
 * CSV column mapping options
 */
interface CSVColumnMapping {
  timestamp?: string;
  date?: string;
  time?: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

/**
 * CSV loading options
 */
interface CSVLoadOptions {
  delimiter?: string;
  hasHeader?: boolean;
  columnMapping?: Partial<CSVColumnMapping>;
  dateFormat?: 'unix' | 'unix_ms' | 'iso' | 'custom';
  skipRows?: number;
}

/**
 * Default column mappings for common formats
 */
const DEFAULT_COLUMN_MAPPING: CSVColumnMapping = {
  timestamp: 'timestamp',
  date: 'date',
  time: 'time',
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  volume: 'volume',
};

/**
 * CSV Data Loader
 * Loads OHLCV data from CSV files
 */
export class CSVLoader {
  private options: CSVLoadOptions;
  
  constructor(options?: CSVLoadOptions) {
    this.options = {
      delimiter: ',',
      hasHeader: true,
      columnMapping: DEFAULT_COLUMN_MAPPING,
      dateFormat: 'unix_ms',
      skipRows: 0,
      ...options,
    };
  }
  
  /**
   * Load candles from a CSV file
   */
  loadFromFile(filePath: string): Candle[] {
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return this.parseCSV(content);
  }
  
  /**
   * Load candles from CSV string
   */
  loadFromString(csvContent: string): Candle[] {
    return this.parseCSV(csvContent);
  }
  
  /**
   * Parse CSV content into candles
   */
  private parseCSV(content: string): Candle[] {
    const mapping = { ...DEFAULT_COLUMN_MAPPING, ...this.options.columnMapping };
    
    const records = parse(content, {
      delimiter: this.options.delimiter,
      columns: this.options.hasHeader,
      skip_empty_lines: true,
      from_line: (this.options.skipRows || 0) + 1,
    });
    
    const candles: Candle[] = [];
    
    for (const record of records) {
      try {
        const candle = this.parseRecord(record, mapping);
        if (candle) {
          candles.push(candle);
        }
      } catch (error) {
        console.warn('Failed to parse record:', record, error);
      }
    }
    
    // Sort by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);
    
    return candles;
  }
  
  /**
   * Parse a single CSV record into a Candle
   */
  private parseRecord(
    record: Record<string, string>,
    mapping: CSVColumnMapping
  ): Candle | null {
    // Parse timestamp
    let timestamp: number;
    
    if (mapping.timestamp && record[mapping.timestamp]) {
      timestamp = this.parseTimestamp(record[mapping.timestamp]);
    } else if (mapping.date && record[mapping.date]) {
      const dateStr = record[mapping.date];
      const timeStr = mapping.time && record[mapping.time] ? record[mapping.time] : '00:00:00';
      timestamp = new Date(`${dateStr} ${timeStr}`).getTime();
    } else {
      // Try common column names
      const timestampValue = record['timestamp'] || record['time'] || record['date'] || record['Date'] || record['Time'];
      if (timestampValue) {
        timestamp = this.parseTimestamp(timestampValue);
      } else {
        console.warn('No timestamp found in record');
        return null;
      }
    }
    
    // Parse OHLCV
    const open = this.parseNumber(record[mapping.open] || record['Open'] || record['o']);
    const high = this.parseNumber(record[mapping.high] || record['High'] || record['h']);
    const low = this.parseNumber(record[mapping.low] || record['Low'] || record['l']);
    const close = this.parseNumber(record[mapping.close] || record['Close'] || record['c']);
    const volume = this.parseNumber(record[mapping.volume || 'volume'] || record['Volume'] || record['v'] || '0');
    
    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      return null;
    }
    
    return {
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    };
  }
  
  /**
   * Parse timestamp from various formats
   */
  private parseTimestamp(value: string): number {
    const { dateFormat } = this.options;
    
    // Try to detect format
    const numValue = Number(value);
    
    if (!isNaN(numValue)) {
      // Unix timestamp
      if (dateFormat === 'unix' || numValue < 10000000000) {
        return numValue * 1000; // Convert to ms
      }
      return numValue; // Already in ms
    }
    
    // ISO or other date format
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
    
    throw new Error(`Unable to parse timestamp: ${value}`);
  }
  
  /**
   * Parse number from string
   */
  private parseNumber(value: string | undefined): number {
    if (!value) return NaN;
    return parseFloat(value.replace(/,/g, ''));
  }
  
  /**
   * Get the inferred timeframe from candle data
   */
  static inferTimeframe(candles: Candle[]): Timeframe {
    if (candles.length < 2) return '1h';
    
    // Calculate average time between candles
    let totalDiff = 0;
    for (let i = 1; i < Math.min(candles.length, 10); i++) {
      totalDiff += candles[i].timestamp - candles[i - 1].timestamp;
    }
    const avgDiff = totalDiff / Math.min(candles.length - 1, 9);
    const minutes = avgDiff / (1000 * 60);
    
    if (minutes <= 1.5) return '1m';
    if (minutes <= 7.5) return '5m';
    if (minutes <= 22.5) return '15m';
    if (minutes <= 90) return '1h';
    if (minutes <= 360) return '4h';
    if (minutes <= 1440 * 1.5) return '1d';
    return '1w';
  }
}

export default CSVLoader;

