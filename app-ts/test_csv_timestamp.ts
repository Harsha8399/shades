import { CSVLoader } from './src/data/CSVLoader';

const csv = `timestamp,open,high,low,close,volume
2024-01-01 09:15:00,99.9011,100.3882,99.5749,99.9930,612.8526
2024-01-01 09:30:00,100.4545,101.1028,100.1501,100.5555,955.5710
2024-01-01 09:45:00,101.4792,101.8861,100.9893,101.4041,859.8961`;

const loader = new CSVLoader({ dateFormat: 'iso' });
const candles = loader.loadFromString(csv);

console.log('TypeScript CSVLoader (dateFormat=iso):');
candles.forEach((c: any) => {
  const d = new Date(c.timestamp);
  console.log(`  ${c.timestamp} -> ${d.toISOString()} (local: ${d.toString()})`);
});