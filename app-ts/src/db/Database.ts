import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SQLite database wrapper
 */
export class DatabaseConnection {
  private db: Database.Database;
  private static instance: DatabaseConnection | null = null;
  
  private constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(dbPath?: string): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      const defaultPath = path.join(process.cwd(), 'data', 'shades.db');
      DatabaseConnection.instance = new DatabaseConnection(dbPath || defaultPath);
    }
    return DatabaseConnection.instance;
  }
  
  /**
   * Initialize database schema
   */
  private initialize(): void {
    const schemaPath = path.join(__dirname, 'schema.sql');
    
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
    } else {
      // Inline schema if file not found (for compiled version)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          pattern_id TEXT NOT NULL,
          pattern_name TEXT NOT NULL,
          symbol TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          direction TEXT NOT NULL,
          state TEXT NOT NULL,
          signal_price REAL NOT NULL,
          entry_price REAL,
          initial_stop_loss REAL NOT NULL,
          current_stop_loss REAL NOT NULL,
          target REAL NOT NULL,
          exit_price REAL,
          quantity REAL NOT NULL DEFAULT 0,
          risk_amount REAL NOT NULL DEFAULT 0,
          risk_percent REAL NOT NULL DEFAULT 0,
          signal_time TEXT NOT NULL,
          entry_time TEXT,
          exit_time TEXT,
          expiry_time TEXT NOT NULL,
          pnl REAL,
          pnl_percent REAL,
          r_multiple REAL,
          confluence_factors TEXT DEFAULT '[]',
          notes TEXT DEFAULT '[]',
          tags TEXT DEFAULT '[]',
          state_history TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE INDEX IF NOT EXISTS idx_trades_state ON trades(state);
        CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
        
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        
        INSERT OR IGNORE INTO config (key, value) VALUES 
          ('initial_capital', '100000'),
          ('max_risk_per_trade', '0.02'),
          ('max_open_trades', '3');
      `);
    }
  }
  
  /**
   * Get the raw database connection
   */
  getDb(): Database.Database {
    return this.db;
  }
  
  /**
   * Execute a query with parameters
   */
  run(sql: string, params: unknown[] = []): Database.RunResult {
    return this.db.prepare(sql).run(...params);
  }
  
  /**
   * Get a single row
   */
  get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  
  /**
   * Get all matching rows
   */
  all<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  
  /**
   * Get config value
   */
  getConfig(key: string): string | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM config WHERE key = ?', [key]);
    return row?.value;
  }
  
  /**
   * Set config value
   */
  setConfig(key: string, value: string): void {
    this.run(
      'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime("now"))',
      [key, value]
    );
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    DatabaseConnection.instance = null;
  }
}

export default DatabaseConnection;

