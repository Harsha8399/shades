# Shades - Trading Pattern Research Platform

A dual-stack trading pattern research platform for backtesting, paper trading, and pattern validation.

## Overview

- **TypeScript Production System** (`app-ts/`): Pattern engine, paper trading, live monitoring, CLI dashboard
- **Python Research Lab** (`research-py/`): Backtesting, strategy evaluation, performance analysis

## Quick Start

### TypeScript System

```bash
cd app-ts
npm install
npm run dev
```

### Python Research Lab

```bash
cd research-py
pip install -r requirements.txt
python -m src.backtesting.engine data/sample_btc_1h.csv
```

### Tests

```bash
cd research-py
pip install -e ".[dev]"   # or: pip install pytest
python -m pytest            # runs the full suite
python -m pytest -v         # verbose
```

The backtest execution semantics (signal timing, order fills, ambiguous
candle handling, cost model) are specified in
[`research-py/docs/EXECUTION_SEMANTICS.md`](research-py/docs/EXECUTION_SEMANTICS.md).

## Architecture

```
Shades/
├── app-ts/          # TypeScript production system
├── research-py/     # Python research lab
└── shared/          # Shared configurations
```

## Features

- **Pattern Engine**: Modular pattern plugins with standardized interface
- **Paper Trading**: Simulated trade execution with state machine
- **Live Monitor**: Process candles and detect patterns in real-time
- **CLI Dashboard**: View trades and performance metrics
- **Backtesting**: Historical simulation with comprehensive metrics

## Patterns Included

1. **Confluence Zone + Entry Model 2**: Detects high-probability entries where S/R, Fib, and trendlines align

## Important

This platform is for **research and paper trading only**. It does NOT support real money trading.

## License

MIT

