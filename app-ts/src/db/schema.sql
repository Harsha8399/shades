-- Shades Trading Platform - SQLite Schema
-- Version: 1.0.0

-- Trades table - stores all paper trades
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    pattern_id TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    state TEXT NOT NULL CHECK (state IN ('PENDING', 'OPEN', 'CLOSED', 'STOPPED', 'CANCELLED', 'EXPIRED')),
    
    -- Prices
    signal_price REAL NOT NULL,
    entry_price REAL,
    initial_stop_loss REAL NOT NULL,
    current_stop_loss REAL NOT NULL,
    target REAL NOT NULL,
    exit_price REAL,
    
    -- Position sizing
    quantity REAL NOT NULL DEFAULT 0,
    risk_amount REAL NOT NULL DEFAULT 0,
    risk_percent REAL NOT NULL DEFAULT 0,
    
    -- Timestamps (stored as ISO strings)
    signal_time TEXT NOT NULL,
    entry_time TEXT,
    exit_time TEXT,
    expiry_time TEXT NOT NULL,
    
    -- Results
    pnl REAL,
    pnl_percent REAL,
    r_multiple REAL,
    
    -- Metadata (stored as JSON)
    confluence_factors TEXT DEFAULT '[]',
    notes TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    state_history TEXT DEFAULT '[]',
    
    -- Indexes
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_trades_state ON trades(state);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_pattern ON trades(pattern_id);
CREATE INDEX IF NOT EXISTS idx_trades_signal_time ON trades(signal_time);

-- Pattern stats table - aggregated statistics per pattern
CREATE TABLE IF NOT EXISTS pattern_stats (
    pattern_id TEXT PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    avg_r_multiple REAL DEFAULT 0,
    win_rate REAL DEFAULT 0,
    profit_factor REAL DEFAULT 0,
    last_updated TEXT DEFAULT (datetime('now'))
);

-- Daily stats table - track daily performance
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Configuration table - store runtime config
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default config values
INSERT OR IGNORE INTO config (key, value) VALUES 
    ('initial_capital', '100000'),
    ('max_risk_per_trade', '0.02'),
    ('max_open_trades', '3'),
    ('min_risk_reward', '1.5'),
    ('max_daily_trades', '5');

