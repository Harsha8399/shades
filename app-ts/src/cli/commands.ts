import { Command } from 'commander';
import { Dashboard } from './dashboard';
import { LiveMonitor } from '../core/LiveMonitor';
import { MultiSymbolMonitor } from '../core/MultiSymbolMonitor';
import { PatternEngine } from '../core/PatternEngine';
import { PaperTradingEngine } from '../core/PaperTradingEngine';
import { PatternRegistry } from '../core/PatternRegistry';
import { registerAllPatterns } from '../patterns';
import { Timeframe, Candle } from '../types';
import { AngelOneAdapter, AngelOneCredentials, NSE_STOCK_TOKENS } from '../data/AngelOneAdapter';
import { NotificationService } from '../notifications/NotificationService';
import { IndianMarketCalendar } from '../data/IndianMarketCalendar';

const program = new Command();

program
  .name('shades')
  .description('Trading Pattern Research Platform CLI')
  .version('0.1.0');

// Dashboard command
program
  .command('dashboard')
  .description('Show trading dashboard')
  .action(() => {
    const dashboard = new Dashboard();
    dashboard.showFullDashboard();
  });

// Stats command
program
  .command('stats')
  .description('Show trading statistics')
  .action(() => {
    const dashboard = new Dashboard();
    dashboard.showStats();
  });

// Trades command
program
  .command('trades')
  .description('Show trades')
  .option('-o, --open', 'Show only open trades')
  .option('-c, --closed', 'Show only closed trades')
  .option('-a, --all', 'Show all trades')
  .option('-l, --limit <number>', 'Limit number of trades', '10')
  .action((options) => {
    const dashboard = new Dashboard();
    
    if (options.open) {
      dashboard.showOpenTrades();
    } else if (options.closed) {
      dashboard.showClosedTrades(parseInt(options.limit));
    } else if (options.all) {
      dashboard.showAllTrades();
    } else {
      dashboard.showOpenTrades();
      dashboard.showClosedTrades(parseInt(options.limit));
    }
  });

// Trade details command
program
  .command('trade <id>')
  .description('Show trade details')
  .action((id) => {
    const dashboard = new Dashboard();
    dashboard.showTradeDetails(id);
  });

// Patterns command
program
  .command('patterns')
  .description('Show pattern leaderboard')
  .action(() => {
    const dashboard = new Dashboard();
    dashboard.showPatternLeaderboard();
  });

// List patterns command
program
  .command('list-patterns')
  .description('List registered patterns')
  .action(() => {
    registerAllPatterns();
    const registry = PatternRegistry.getInstance();
    const patterns = registry.getPatternInfo();
    
    console.log('\n=== REGISTERED PATTERNS ===\n');
    for (const pattern of patterns) {
      console.log(`${pattern.name} (${pattern.id})`);
      console.log(`  Version: ${pattern.version}`);
      console.log(`  Description: ${pattern.description}`);
      console.log(`  Timeframes: ${pattern.supportedTimeframes.join(', ')}`);
      console.log(`  Required Candles: ${pattern.requiredCandles}`);
      console.log('');
    }
  });

// Simulate command
program
  .command('simulate')
  .description('Run simulation on CSV data')
  .requiredOption('-f, --file <path>', 'Path to CSV file')
  .requiredOption('-s, --symbol <symbol>', 'Trading symbol (e.g., BTCUSDT)')
  .option('-t, --timeframe <tf>', 'Timeframe', '1h')
  .option('--start <index>', 'Start index', '0')
  .option('--no-filters', 'Disable all trade filters (structure, regime, MTF, volume)')
  .option('--loose-filters', 'Use loose filter settings')
  .action((options) => {
    console.log('\n=== SHADES SIMULATION ===\n');
    
    // Register patterns
    registerAllPatterns();
    
    // Filter configuration
    let filterConfig = {};
    let useFilters = true;
    
    if (options.filters === false) {
      // --no-filters flag passed
      useFilters = false;
      console.log('⚠️  Filters DISABLED - all pattern signals will be used\n');
    } else if (options.looseFilters) {
      // --loose-filters flag passed
      filterConfig = {
        useStructure: false,      // Don't require market structure
        useRegime: false,         // Allow ranging markets
        useMTF: false,            // Don't require HTF alignment
        useVolume: false,         // Don't require volume confirmation
      };
      console.log('⚠️  Loose filters - minimal filtering applied\n');
    }
    
    // Create components
    const patternEngine = new PatternEngine(undefined, filterConfig, useFilters);
    const paperTrading = new PaperTradingEngine();
    
    const monitor = new LiveMonitor(
      {
        symbol: options.symbol,
        timeframe: options.timeframe as Timeframe,
      },
      patternEngine,
      paperTrading
    );
    
    // Load data
    try {
      monitor.loadFromCSV(options.file);
    } catch (error) {
      console.error(`Error loading CSV: ${error}`);
      process.exit(1);
    }
    
    // Run simulation
    monitor.runSimulation(parseInt(options.start));
    
    // Show results
    const dashboard = new Dashboard();
    dashboard.showFullDashboard();
  });

// Live command (simulated)
program
  .command('live')
  .description('Run live monitoring (simulated from CSV)')
  .requiredOption('-f, --file <path>', 'Path to CSV file')
  .requiredOption('-s, --symbol <symbol>', 'Trading symbol')
  .option('-t, --timeframe <tf>', 'Timeframe', '1h')
  .option('-i, --interval <ms>', 'Poll interval in ms', '1000')
  .action(async (options) => {
    console.log('\n=== SHADES LIVE MONITOR ===\n');
    console.log('Press Ctrl+C to stop\n');
    
    // Register patterns
    registerAllPatterns();
    
    const monitor = new LiveMonitor({
      symbol: options.symbol,
      timeframe: options.timeframe as Timeframe,
      pollIntervalMs: parseInt(options.interval),
    });
    
    // Load data
    try {
      monitor.loadFromCSV(options.file);
    } catch (error) {
      console.error(`Error loading CSV: ${error}`);
      process.exit(1);
    }
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\nStopping monitor...');
      monitor.stop();
    });
    
    // Run live
    await monitor.runLive();
  });

// Multi-symbol command
program
  .command('multi-symbol')
  .description('Run multi-symbol simulation')
  .requiredOption('-c, --config <path>', 'Path to JSON config file with symbols')
  .option('-t, --timeframe <tf>', 'Default timeframe', '1h')
  .action((options) => {
    console.log('\n=== SHADES MULTI-SYMBOL SIMULATION ===\n');
    
    // Register patterns
    registerAllPatterns();
    
    const monitor = new MultiSymbolMonitor();
    
    // Load config
    try {
      const fs = require('fs');
      const configPath = require('path').resolve(options.config);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      if (!config.symbols || !Array.isArray(config.symbols)) {
        console.error('Config must have a "symbols" array');
        process.exit(1);
      }
      
      for (const sym of config.symbols) {
        monitor.addSymbol({
          symbol: sym.symbol,
          dataPath: sym.dataPath,
          timeframe: sym.timeframe || options.timeframe,
        });
      }
    } catch (error) {
      console.error(`Error loading config: ${error}`);
      process.exit(1);
    }
    
    // Run simulation
    monitor.runSimulation();
    
    // Show results
    const dashboard = new Dashboard();
    dashboard.showFullDashboard();
  });

// Angel One live command
program
  .command('angelone')
  .description('Run live monitoring with Angel One feed')
  .requiredOption('-s, --symbols <symbols>', 'Comma-separated symbols (e.g., RELIANCE,TCS,INFY)')
  .option('-t, --timeframe <tf>', 'Timeframe', '15m')
  .option('-i, --interval <seconds>', 'Poll interval in seconds', '60')
  .option('--paper', 'Paper trading mode (default)', true)
  .action(async (options) => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║          SHADES - Angel One Live Monitor                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    // Check environment variables
    const apiKey = process.env.ANGELONE_API_KEY;
    const clientId = process.env.ANGELONE_CLIENT_ID;
    const password = process.env.ANGELONE_PASSWORD;
    const totpSecret = process.env.ANGELONE_TOTP_SECRET;
    
    if (!apiKey || !clientId || !password || !totpSecret) {
      console.error('❌ Missing Angel One credentials!');
      console.error('');
      console.error('Set these environment variables:');
      console.error('  ANGELONE_API_KEY=your_api_key');
      console.error('  ANGELONE_CLIENT_ID=your_client_id');
      console.error('  ANGELONE_PASSWORD=your_password');
      console.error('  ANGELONE_TOTP_SECRET=your_totp_secret');
      console.error('');
      console.error('Or copy config/env.example to .env and fill in values.');
      process.exit(1);
    }
    
    // Check market hours
    const calendar = new IndianMarketCalendar('NSE');
    const marketStatus = calendar.getMarketStatus();
    
    console.log(`📅 Today: ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`);
    console.log(`🏛️  Market: ${marketStatus.session}`);
    
    if (!marketStatus.isOpen) {
      const untilOpen = calendar.getTimeUntilOpen();
      if (untilOpen) {
        console.log(`⏰ Market opens in ${untilOpen.hours}h ${untilOpen.minutes}m`);
      }
      console.log('');
      console.warn('⚠️  Market is closed. Will monitor but no new candles expected.');
    }
    console.log('');
    
    // Parse symbols
    const symbols = options.symbols.split(',').map((s: string) => s.trim().toUpperCase());
    console.log(`📊 Symbols: ${symbols.join(', ')}`);
    console.log(`⏱️  Timeframe: ${options.timeframe}`);
    console.log(`🔄 Poll interval: ${options.interval}s`);
    console.log('');
    
    // Validate symbols
    const invalidSymbols = symbols.filter((s: string) => !NSE_STOCK_TOKENS[s]);
    if (invalidSymbols.length > 0) {
      console.warn(`⚠️  Unknown symbol tokens: ${invalidSymbols.join(', ')}`);
      console.warn('   These may not work. Add tokens to NSE_STOCK_TOKENS if needed.');
      console.log('');
    }
    
    // Register patterns
    registerAllPatterns();
    console.log('✅ Patterns registered');
    
    // Create Angel One adapter
    const adapter = new AngelOneAdapter();
    
    console.log('🔐 Connecting to Angel One...');
    
    try {
      const authenticated = await adapter.authenticate({
        apiKey,
        clientId,
        userId: clientId,
        password,
        totpSecret,
      } as AngelOneCredentials);
      
      if (!authenticated) {
        console.error('❌ Authentication failed');
        process.exit(1);
      }
      
      console.log('✅ Connected to Angel One\n');
      
    } catch (error: any) {
      console.error(`❌ Connection failed: ${error.message}`);
      console.error('');
      console.error('Common issues:');
      console.error('  - Invalid API key or credentials');
      console.error('  - TOTP secret is wrong');
      console.error('  - Account not activated for SmartAPI');
      process.exit(1);
    }
    
    // Create pattern engine and paper trading
    const patternEngine = new PatternEngine();
    const paperTrading = new PaperTradingEngine();
    const notifications = NotificationService.getInstance();
    
    // Candle buffers for each symbol
    const candleBuffers: Map<string, Candle[]> = new Map();
    for (const symbol of symbols) {
      candleBuffers.set(symbol, []);
    }
    
    console.log('📈 Starting live monitoring...');
    console.log('   Press Ctrl+C to stop\n');
    console.log('─'.repeat(60));
    
    let running = true;
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping monitor...');
      running = false;
      adapter.disconnect();
      
      // Show final dashboard
      const dashboard = new Dashboard();
      dashboard.showFullDashboard();
      
      process.exit(0);
    });
    
    // Main polling loop
    const pollIntervalMs = parseInt(options.interval) * 1000;
    
    while (running) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-IN');
      
      for (const symbol of symbols) {
        try {
          // Get latest price
          const quote = await adapter.getQuote(symbol);
          
          if (quote) {
            // Create candle from quote
            const candle: Candle = {
              timestamp: Date.now(),
              open: quote.open,
              high: quote.high,
              low: quote.low,
              close: quote.ltp,
              volume: quote.volume,
            };
            
            // Add to buffer
            const buffer = candleBuffers.get(symbol)!;
            buffer.push(candle);
            
            // Keep buffer at reasonable size
            if (buffer.length > 500) {
              buffer.shift();
            }
            
            // Only run pattern detection if we have enough candles
            if (buffer.length >= 50) {
              // Detect signals
              const signals = patternEngine.detectSignals(
                buffer,
                symbol,
                options.timeframe as Timeframe
              );
              
              // Process signals
              for (const signal of signals) {
                console.log('');
                console.log(`🎯 SIGNAL: ${signal.direction} ${symbol}`);
                console.log(`   Pattern: ${signal.patternName}`);
                console.log(`   Entry: ₹${signal.entryPrice.toFixed(2)}`);
                console.log(`   Stop: ₹${signal.stopLoss.toFixed(2)}`);
                console.log(`   Target: ₹${signal.target.toFixed(2)}`);
                console.log(`   Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
                console.log('');
                
                // Notify
                notifications.notifySignal(signal);
                
                // Paper trade
                if (options.paper) {
                  const trade = paperTrading.processSignal(signal);
                  if (trade) {
                    notifications.notifyTradeOpened(trade);
                  }
                }
              }
            }
            
            // Log current prices
            const changeStr = quote.change >= 0 
              ? `+${quote.change.toFixed(2)} (+${quote.changePercent.toFixed(2)}%)` 
              : `${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`;
            const changeColor = quote.change >= 0 ? '\x1b[32m' : '\x1b[31m';
            
            console.log(`[${timeStr}] ${symbol}: ₹${quote.ltp.toFixed(2)} ${changeColor}${changeStr}\x1b[0m`);
            
          }
        } catch (error: any) {
          console.error(`[${timeStr}] ${symbol}: Error - ${error.message}`);
        }
      }
      
      // Update open trades
      for (const symbol of symbols) {
        const buffer = candleBuffers.get(symbol);
        if (buffer && buffer.length > 0) {
          const lastCandle = buffer[buffer.length - 1];
          paperTrading.updateTrades(lastCandle);
        }
      }
      
      // Wait for next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  });

// Download NSE data command
program
  .command('download-nse')
  .description('Download NSE stock data using Angel One')
  .requiredOption('-s, --symbols <symbols>', 'Comma-separated symbols')
  .option('-t, --timeframe <tf>', 'Timeframe', '15m')
  .option('-d, --days <days>', 'Number of days', '60')
  .option('-o, --output <dir>', 'Output directory', './data/nse')
  .action(async (options) => {
    console.log('\n=== SHADES - NSE Data Download ===\n');
    
    // Check credentials
    const apiKey = process.env.ANGELONE_API_KEY;
    const clientId = process.env.ANGELONE_CLIENT_ID;
    const password = process.env.ANGELONE_PASSWORD;
    const totpSecret = process.env.ANGELONE_TOTP_SECRET;
    
    if (!apiKey || !clientId || !password || !totpSecret) {
      console.error('Missing Angel One credentials. See config/env.example');
      process.exit(1);
    }
    
    const symbols = options.symbols.split(',').map((s: string) => s.trim().toUpperCase());
    const days = parseInt(options.days);
    const timeframe = options.timeframe as Timeframe;
    const outputDir = options.output;
    
    console.log(`Symbols: ${symbols.join(', ')}`);
    console.log(`Timeframe: ${timeframe}`);
    console.log(`Days: ${days}`);
    console.log(`Output: ${outputDir}\n`);
    
    // Create adapter
    const adapter = new AngelOneAdapter();
    
    try {
      await adapter.authenticate({
        apiKey,
        clientId,
        userId: clientId,
        password,
        totpSecret,
      } as AngelOneCredentials);
      
      console.log('Connected to Angel One\n');
      
    } catch (error: any) {
      console.error(`Connection failed: ${error.message}`);
      process.exit(1);
    }
    
    const fs = require('fs');
    const path = require('path');
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    
    for (const symbol of symbols) {
      console.log(`Downloading ${symbol}...`);
      
      try {
        const candles = await adapter.getHistoricalData(symbol, timeframe, fromDate, toDate);
        
        if (candles.length === 0) {
          console.log(`  No data for ${symbol}`);
          continue;
        }
        
        // Convert to CSV
        const csvLines = ['timestamp,open,high,low,close,volume'];
        for (const candle of candles) {
          const ts = new Date(candle.timestamp).toISOString();
          csvLines.push(`${ts},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume}`);
        }
        
        const filename = `${symbol.toLowerCase()}_${timeframe}.csv`;
        const filepath = path.join(outputDir, filename);
        
        fs.writeFileSync(filepath, csvLines.join('\n'));
        
        console.log(`  Saved ${candles.length} candles to ${filepath}`);
        
      } catch (error: any) {
        console.error(`  Error: ${error.message}`);
      }
    }
    
    await adapter.disconnect();
    console.log('\nDownload complete!');
  });

// Parse and execute
program.parse();

