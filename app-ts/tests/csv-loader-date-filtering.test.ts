/**
 * Tests for CSVLoader date filtering functionality.
 */
import { CSVLoader } from '../src/data/CSVLoader';
import { makeCandles, HOUR_MS } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

describe('CSVLoader date filtering', () => {
  const testFile = path.join(__dirname, 'temp_test_data.csv');

  // Generate 10 days of hourly candles starting 2024-01-01
  const candles = makeCandles(
    Array.from({ length: 240 }, (_, i) => [100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100.5 + i * 0.1]),
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

  it('loads all candles when no date filter provided', () => {
    const loader = new CSVLoader();
    const result = loader.loadFromFile(testFile);
    expect(result.length).toBe(240);
    expect(result[0].timestamp).toBe(Date.UTC(2024, 0, 1, 0, 0, 0));
    expect(result[239].timestamp).toBe(Date.UTC(2024, 0, 10, 23, 0, 0));
  });

  it('filters by startDate only', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 5, 0, 0, 0); // 2024-01-05
    const result = loader.loadFromFile(testFile, startDate);
    expect(result.length).toBe(144); // 6 days * 24 hours
    expect(result[0].timestamp).toBe(startDate);
  });

  it('filters by endDate only', () => {
    const loader = new CSVLoader();
    const endDate = Date.UTC(2024, 0, 5, 23, 0, 0); // 2024-01-05 23:00
    const result = loader.loadFromFile(testFile, undefined, endDate);
    expect(result.length).toBe(120); // 5 days * 24 hours
    expect(result[result.length - 1].timestamp).toBe(endDate);
  });

  it('filters by both startDate and endDate', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 3, 0, 0, 0); // 2024-01-03
    const endDate = Date.UTC(2024, 0, 7, 23, 0, 0);  // 2024-01-07 23:00
    const result = loader.loadFromFile(testFile, startDate, endDate);
    expect(result.length).toBe(120); // 5 days * 24 hours
    expect(result[0].timestamp).toBe(startDate);
    expect(result[result.length - 1].timestamp).toBe(endDate);
  });

  it('returns empty array when startDate is after all data', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01
    const result = loader.loadFromFile(testFile, startDate);
    expect(result.length).toBe(0);
  });

  it('returns empty array when endDate is before all data', () => {
    const loader = new CSVLoader();
    const endDate = Date.UTC(2023, 0, 1, 0, 0, 0); // 2023-01-01
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

  it('loadFromString also supports date filtering', () => {
    const header = 'timestamp,open,high,low,close,volume\n';
    const rows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n');
    const csvContent = header + rows + '\n';

    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 5, 0, 0, 0);
    const result = loader.loadFromString(csvContent, startDate);
    expect(result.length).toBe(144);
    expect(result[0].timestamp).toBe(startDate);
  });

  it('preserves candle order after filtering', () => {
    const loader = new CSVLoader();
    const startDate = Date.UTC(2024, 0, 5, 0, 0, 0);
    const endDate = Date.UTC(2024, 0, 7, 23, 0, 0);
    const result = loader.loadFromFile(testFile, startDate, endDate);
    
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
    }
  });
});