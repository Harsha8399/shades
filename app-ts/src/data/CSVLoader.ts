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
 * Epoch timestamps at or above this magnitude are milliseconds; below it,
 * seconds. 1e11 ms is 1973-03-03 and 1e11 s is the year 5138, so the split
 * is unambiguous for any realistic market data.
 */
const EPOCH_MS_THRESHOLD = 1e11;

/**
 * CSV loading options
 */
interface CSVLoadOptions {
  delimiter?: string;
  hasHeader?: boolean;
  columnMapping?: Partial<CSVColumnMapping>;
  dateFormat?: 'unix' | 'unix_ms' | 'iso' | 'custom';
  skipRows?: number;
  startDate?: number;  // Unix milliseconds
  endDate?: number;    // Unix milliseconds
}

/**
 * Default column mappings for common formats.
 *
 * `datetime` is included because the bundled research datasets carry both a
 * `datetime` string column and a `timestamp` epoch column. The Python loader
 * prefers the `datetime` column; the TypeScript loader must match, otherwise
 * the two engines disagree about the same file.
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
 * Column names that may hold a date/time, in priority order.
 *
 * `datetime` comes first so that a human-readable ISO column wins over an
 * epoch column, matching the Python loader.
 */
const TIMESTAMP_COLUMN_CANDIDATES = [
  'datetime',
  'timestamp',
  'time',
  'date',
  'Date',
  'Time',
  'DateTime',
  'DATETIME',
];

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
loadFromFile(filePath: string, startDate?: number, endDate?: number): Candle[] {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return this.parseCSV(content, startDate, endDate);
}
  
/**
 * Load candles from CSV string
 */
loadFromString(csvContent: string, startDate?: number, endDate?: number): Candle[] {
  return this.parseCSV(csvContent, startDate, endDate);
}
  
/**
 * Parse CSV content into candles
 */
private parseCSV(content: string, startDate?: number, endDate?: number): Candle[] {
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
        // Apply date filtering if provided
        if (startDate !== undefined && candle.timestamp < startDate) continue;
        if (endDate !== undefined && candle.timestamp > endDate) continue;
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
    // Parse timestamp.
    //
    // Column precedence is unified with the Python loader so both engines
    // read the same file identically:
    //   1. an explicitly configured `columnMapping.timestamp`
    //   2. `datetime` (human-readable ISO)
    //   3. other known timestamp column names
    //   4. `date` + optional `time`
    let timestamp: number = 0;
    let timestampResolved = false;

    // 1. Explicit mapping wins, but only if the column is actually present.
    if (mapping.timestamp && record[mapping.timestamp]) {
      timestamp = this.parseTimestamp(record[mapping.timestamp]);
      timestampResolved = true;
    }

    // 2/3. Known column names, in priority order. `datetime` comes before
    // `timestamp` so a file carrying both is read the same way by both
    // engines.
    if (!timestampResolved) {
      for (const candidate of TIMESTAMP_COLUMN_CANDIDATES) {
        if (record[candidate]) {
          timestamp = this.parseTimestamp(record[candidate]);
          timestampResolved = true;
          break;
        }
      }
    }

    // 4. Separate date and time columns.
    if (!timestampResolved && mapping.date && record[mapping.date]) {
      const dateStr = record[mapping.date];
      const timeStr = mapping.time && record[mapping.time] ? record[mapping.time] : '00:00:00';
      const combined = this.parseDateString(`${dateStr} ${timeStr}`);
      if (combined !== null) {
        timestamp = combined;
        timestampResolved = true;
      }
    }

    if (!timestampResolved) {
      console.warn('No timestamp found in record');
      return null;
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

    // OHLC integrity: the bar's own high/low must contain its open/close.
    // A violation means the row is corrupt; silently keeping it would feed
    // invalid prices into the pattern engine.
    if (high < low || high < open || high < close || low > open || low > close) {
      console.warn(
        `Skipping record with invalid OHLC relationships: O=${open} H=${high} L=${low} C=${close}`
      );
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
   *
   * Numeric values are interpreted as epoch seconds or epoch milliseconds
   * based on their magnitude. The 1e11 threshold is unambiguous: 1e11 ms is
   * 1973-03-03, and 1e11 s is the year 5138, so no realistic market
   * timestamp can fall in the ambiguous zone.
   */
  private parseTimestamp(value: string): number {
    const { dateFormat } = this.options;

    // Try to detect format
    const numValue = Number(value);

    if (!isNaN(numValue)) {
      if (dateFormat === 'unix') {
        return numValue * 1000; // seconds -> ms
      }
      if (dateFormat === 'unix_ms') {
        // A value small enough to be seconds is still treated as seconds,
        // so an explicit 'unix_ms' request for a seconds file still works.
        if (numValue < EPOCH_MS_THRESHOLD) {
          return numValue * 1000;
        }
        return numValue;
      }
      // Auto-detect: magnitude decides seconds vs milliseconds.
      if (numValue < EPOCH_MS_THRESHOLD) {
        return numValue * 1000; // seconds -> ms
      }
      return numValue; // already in ms
    }

    // ISO or other date format.
    //
    // A naive timestamp (no timezone designator) is interpreted as UTC
    // WALL-CLOCK time, not local time. The Python loader treats naive
    // datetimes as timezone-naive wall clock, so interpreting them as local
    // time here would make the two engines disagree about which bar is
    // which (e.g. 14:00 IST would become 08:30 UTC in one engine).
    const parsed = this.parseDateString(value);
    if (parsed !== null) {
      return parsed;
    }

    throw new Error(`Unable to parse timestamp: ${value}`);
  }

  /**
   * Parse a date string.
   *
   * Naive strings (no Z / offset) are treated as UTC wall clock so that the
   * TypeScript and Python loaders agree on the same file.
   *
   * Returns null when the value cannot be parsed.
   */
  private parseDateString(value: string): number | null {
    const trimmed = value.trim();

    // Explicit timezone: let the runtime parse it.
    const hasExplicitZone =
      /[Zz]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed);
    if (hasExplicitZone) {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d.getTime();
    }

    // Naive: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
    const naive = trimmed.replace(' ', 'T');
    // Append Z so the value is read as UTC wall clock.
    const asUtc = new Date(`${naive}Z`);
    if (!isNaN(asUtc.getTime())) {
      return asUtc.getTime();
    }

    // Date only: "YYYY-MM-DD"
    const dateOnly = new Date(`${trimmed}T00:00:00Z`);
    if (!isNaN(dateOnly.getTime())) {
      return dateOnly.getTime();
    }

    return null;
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

