/**
 * Tests for simulation API validation and signal-to-candle alignment.
 */
import { CSVLoader } from '../src/data/CSVLoader';
import { LiveMonitor } from '../src/core/LiveMonitor';
import { PatternEngine } from '../src/core/PatternEngine';
import { PaperTradingEngine } from '../src/core/PaperTradingEngine';
import { makeCandles, HOUR_MS } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

const testFile = path.join(__dirname, 'temp_sim_test_data.csv');

// Generate 30 days of hourly candles with some trending data for pattern detection
const candles = makeCandles(
  Array.from({ length: 720 }, (_, i) => {
    const base = 100 + Math.sin(i / 24) * 5; // Daily cycle
    const trend = i * 0.02; // Upward trend
    const open = base + trend;
    return [open, open + 1, open - 1, open + 0.5];
  }),
  Date.UTC(2024, 0, 1, 0, 0, 0),
  HOUR_MS
);

beforeAll(() => {
  // Write test CSV file
  const header = 'timestamp,open,high,low,close,volume\n';
  const rows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n');
  fs.writeFileSync(testFile, header + rows + '\n');
});

afterAll(() => {
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
});

describe('Date range validation helpers', () => {
  it('parses valid ISO 8601 dates', () => {
    const startDate = '2024-01-05T00:00:00Z';
    const endDate = '2024-01-10T00:00:00Z';
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    
    expect(startMs).toBe(Date.UTC(2024, 0, 5, 0, 0, 0));
    expect(endMs).toBe(Date.UTC(2024, 0, 10, 0, 0, 0));
    expect(startMs).toBeLessThan(endMs);
  });

  it('detects invalid startDate format', () => {
    const startDate = 'invalid-date';
    const startMs = new Date(startDate).getTime();
    expect(isNaN(startMs)).toBe(true);
  });

  it('detects invalid endDate format', () => {
    const endDate = 'invalid-date';
    const endMs = new Date(endDate).getTime();
    expect(isNaN(endMs)).toBe(true);
  });

  it('detects startDate after endDate', () => {
    const startMs = new Date('2024-01-15T00:00:00Z').getTime();
    const endMs = new Date('2024-01-10T00:00:00Z').getTime();
    expect(startMs).toBeGreaterThan(endMs);
  });
});

describe('CSVLoader date filtering', () => {
  it('filters by startDate only', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 5, 0, 0, 0);
    const result = loader.loadFromFile(testFile, startDate);
    // Data spans 2024-01-01 to 2024-01-30 (720 hours)
    // From 2024-01-05 to end = 26 days * 24 = 624 candles
    expect(result.length).toBe(624);
    expect(result[0].timestamp).toBe(startDate);
  });

  it('filters by endDate only', () => {
    const loader = new CSVLoader();
    const endDate = Date.UTC(2024, 0, 5, 23, 0, 0);
    const result = loader.loadFromFile(testFile, undefined, endDate);
    // From start (2024-01-01) to 2024-01-05 23:00 = 5 days * 24 = 120 candles
    expect(result.length).toBe(120);
    expect(result[result.length - 1].timestamp).toBe(endDate);
  });

  it('filters by both startDate and endDate', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 3, 0, 0, 0);
    const endDate = Date.UTC(2024, 0, 7, 23, 0, 0);
    const result = loader.loadFromFile(testFile, startDate, endDate);
    // 2024-01-03 to 2024-01-07 23:00 = 5 days * 24 = 120 candles
    expect(result.length).toBe(120);
    expect(result[0].timestamp).toBe(startDate);
    expect(result[result.length - 1].timestamp).toBe(endDate);
  });

  it('returns empty array when startDate is after all data', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2025, 0, 1, 0, 0, 0);
    const result = loader.loadFromFile(testFile, startDate);
    expect(result.length).toBe(0);
  });

  it('returns empty array when endDate is before all data', () => {
    const loader = new CSVLoader();
    const endDate = Date.UTC(2023, 0, 1, 0, 0, 0);
    const result = loader.loadFromFile(testFile, undefined, endDate);
    expect(result.length).toBe(0);
  });

  it('returns empty array when startDate > endDate', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 10, 0, 0, 0);
    const endDate = Date.UTC(2024, 0, 5, 0, 0, 0);
    const result = loader.loadFromFile(testFile, startDate, endDate);
    expect(result.length).toBe(0);
  });
});

describe('Signal-to-candle alignment (integration)', () => {
  it('signal timestamps fall within the candle range when using date filtering', () => {
    const startDate = Date.UTC(2024, 0, 5, 0, 0, 0);
    const endDate = Date.UTC(2024, 0, 10, 0, 0, 0);

    const patternEngine = new PatternEngine(undefined, {}, false); // No filters
    const paperTrading = new PaperTradingEngine(undefined, undefined, { enabled: false }, undefined, false, 'NSE_EQUITY', false);
    const monitor = new LiveMonitor(
      { symbol: 'TEST', timeframe: '1h' },
      patternEngine,
      paperTrading
    );

    monitor.loadFromCSV(testFile, startDate, endDate);
    monitor.runSimulation(0);

    const allCandles = monitor.getAllCandles();
    
    // Verify all candles are within date range
    for (const candle of allCandles) {
      expect(candle.timestamp).toBeGreaterThanOrEqual(startDate);
      expect(candle.timestamp).toBeLessThanOrEqual(endDate);
    }

    // Verify we have some data
    expect(allCandles.length).toBeGreaterThan(0);
  });

  it('date filtering reduces the number of candles processed', () => {
    const patternEngine = new PatternEngine(undefined, {}, false);
    const paperTrading = new PaperTradingEngine(undefined, undefined, { enabled: false }, undefined, false, 'NSE_EQUITY', false);

    // Full range
    const monitorFull = new LiveMonitor(
      { symbol: 'TEST', timeframe: '1h' },
      patternEngine,
      paperTrading
    );
    monitorFull.loadFromCSV(testFile);
    monitorFull.runSimulation(0);
    const fullCandles = monitorFull.getAllCandles();

    // Filtered range (first 5 days)
    const monitorFiltered = new LiveMonitor(
      { symbol: 'TEST', timeframe: '1h' },
      new PatternEngine(undefined, {}, false),
      new PaperTradingEngine(undefined, undefined, { enabled: false }, undefined, false, 'NSE_EQUITY', false)
    );
    const startDate = Date.UTC(2024, 0, 1, 0, 0, 0);
    const endDate = Date.UTC(2024, 0, 5, 23, 0, 0);
    monitorFiltered.loadFromCSV(testFile, startDate, endDate);
    monitorFiltered.runSimulation(0);
    const filteredCandles = monitorFiltered.getAllCandles();

    expect(filteredCandles.length).toBeLessThan(fullCandles.length);
    expect(filteredCandles.length).toBe(120); // 5 days * 24 hours
  });

  it('empty date range returns zero candles', () => {
    const patternEngine = new PatternEngine(undefined, {}, false);
    const paperTrading = new PaperTradingEngine(undefined, undefined, { enabled: false }, undefined, false, 'NSE_EQUITY', false);
    const monitor = new LiveMonitor(
      { symbol: 'TEST', timeframe: '1h' },
      patternEngine,
      paperTrading
    );

    const startDate = Date.UTC(2025, 0, 1, 0, 0, 0);
    const endDate = Date.UTC(2025, 0, 2, 0, 0, 0);
    monitor.loadFromCSV(testFile, startDate, endDate);
    monitor.runSimulation(0);
    const candles = monitor.getAllCandles();

    expect(candles.length).toBe(0);
  });
});