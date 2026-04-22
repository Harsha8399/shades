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
python -m src.backtesting.engine
```

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

