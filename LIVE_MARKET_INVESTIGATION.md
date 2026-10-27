# Live Market Data Investigation Report

**Repository:** /Users/harshavardhanreddy/projects/shades  
**Investigation Type:** READ-ONLY (no files modified, no npm install)  
**Date:** 2026-10-24

---

## 1. UpstoxFeed.ts (`app-ts/src/data/UpstoxFeed.ts`)

### Class/Interface
- **Class:** `UpstoxFeed` extends `EventEmitter` (line 120, ends at line 611)
- **Interfaces defined:** `UpstoxConfig` (18-23), `UpstoxInstrument` (28-37), `UpstoxOHLCV` (42-50), `WSMessage` (55-58), `WSTickData` (60-70)
- **Types:** `WSMode` = `'ltpc' | 'full' | 'full_d30' | 'option_greeks'` (line 95)
- **Helper:** `createUpstoxFeedFromEnv()` (616-632) returns `UpstoxFeed` instance

### What it connects to
- **REST API:** `https://api.upstox.com/v2` (`UPSTOX_API_BASE`, line 88)
- **Auth URL:** `https://api.upstox.com/v2/login/authorization/dialog` (`UPSTOX_AUTH_URL`, line 89)
- **WebSocket:** `wss://api.upstox.com/v2/feed/market-data-feed` (`UPSTOX_WS_URL`, line 90)

### Methods
| Method | Exists? | Line(s) | Notes |
|---|---|---|---|
| `connect()` | **NO** | — | There is NO `connect()` method. WebSocket uses `connectWebSocket()` (line 402) |
| `subscribe()` | **NO** | — | Uses `subscribeToInstruments(instrumentKeys: string[], mode: WSMode = 'full')` (line 479) |
| `fetchHistorical()` | **NO** | — | Uses `getHistoricalData(instrumentKey, timeframe, fromDate, toDate)` (222-250) and `getIntradayData(...)` (255-277) |

### Credentials
- **Required:** `apiKey`, `apiSecret` in `UpstoxConfig` (19-20). `accessToken` optional (22).
- **Auth flow:** `getAuthorizationUrl()` (143-151) generates OAuth URL; `exchangeCode(authCode)` (156-180) POSTs to `/login/authorization/token` to get access token; `setAccessToken(token)` (185-187); `isAuthenticated()` (192-194); `apiRequest()` requires token (199-217).
- **From env:** `createUpstoxFeedFromEnv()` (616-632) reads `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, `UPSTOX_REDIRECT_URI` (default `http://localhost:3000/callback`), `UPSTOX_ACCESS_TOKEN`. Throws if apiKey/apiSecret missing.

### Instantiation
- **In non-test code:** Instantiated in `app-ts/src/data/LiveMarketDataService.ts:100` via `new UpstoxFeed(feedConfig)`. Also via `createUpstoxFeedFromEnv()` helper (exported, definition only - not found instantiated elsewhere).  
- **In tests:** No references found (grep for `UpstoxFeed` in tests returned nothing).  
- **Status:** **VERIFIED WORKING IN CODE** (full implementation exists). Used by LiveMarketDataService.

---

## 2. LiveMarketDataService.ts (`app-ts/src/data/LiveMarketDataService.ts`)

### What it does
Unified singleton service (`getInstance()`, 75-80) that wraps Upstox for live/historical market data with both WebSocket and polling fallback. Builds candles from ticks, manages subscriptions, provides callbacks.

### Wrapper around UpstoxFeed?
- **YES.** Holds `private upstoxFeed: UpstoxFeed | null = null` (57). Initialized in `initialize()` (85-118): creates UpstoxFeed from ConfigManager credentials (87-101), sets access token (104-106), loads instrument keys (109), sets up WS handlers if enabled (112-114). Delegates all API calls to `this.upstoxFeed` (quotes, historical, market status, search).

### Methods
| Method | Exists? | Line(s) | Notes |
|---|---|---|---|
| `getQuote()` | **YES** | 557-578 | Takes symbol, looks up instrument key, calls `this.upstoxFeed.getQuote()`, returns quote or null if not authenticated/error |
| `getHistorical()` | **YES** (as `getHistoricalData`) | 533-552 | Takes symbol, timeframe, days (default 30). Calls `this.upstoxFeed.getHistoricalData()` with date range |
| `onCandleUpdate()` | **YES** | 504-514 | Registers callback, returns unsubscribe function |
| `onTickUpdate()` | **YES** | 519-528 | Same pattern for ticks |
| `subscribe()` | **YES** | 326-368 | Subscribes to symbols/timeframes, connects WS or starts polling |
| `getMarketStatus()` | **YES** | 583-594 | Delegates to UpstoxFeed |

### Wired into live monitor?
- **PARTIALLY.** `LiveMarketDataService` exists and is fully implemented as a singleton with WS/tick/candle handling. However, **neither `LiveMonitor.ts` nor `MultiSymbolMonitor.ts` imports or uses `LiveMarketDataService`**.  
- `LiveMonitor` works from CSV data loaded via `CSVLoader` (loads into `allCandles`, iterates them in `runSimulation()`/`runLive()` which simulate with delays).  
- `MultiSymbolMonitor` also works from CSV files.  
- `LiveMarketDataService` is **NOT wired into the core live monitors** - it appears to be an alternative/unintegrated implementation. Status: **VERIFIED IMPLEMENTED but NOT WIRED** into LiveMonitor/MultiSymbolMonitor.

---

## 3. LiveMonitor.ts (`app-ts/src/core/LiveMonitor.ts`)

### Data flow
`feed → monitor → pattern detection → signal → trade`

Based on code:
1. **Feed/input:** LiveMonitor loads from CSV via `loadFromCSV(filePath)` (49-63) using `CSVLoader`. It stores candles in `allCandles[]`. It does NOT consume from UpstoxFeed or LiveMarketDataService.
2. **Monitor processes:** `processCandle(candle: Candle)` (86-139) is the core method. Flow:
   - Takes incoming candle as "forming candle" (not added to buffer yet)
   - Uses `closedCandles = this.candles` (buffer holds only closed candles)
   - If insufficient candles (`< patternEngine.getMinRequiredCandles()`): calls `this.paperTrading.updateTrades(candle)` on forming candle, adds candle via `addCandle(candle)` (92-97)
   - Builds HTF candles from closed candles only via `CandleResampler.resampleByTimeframe()` (102-120) - **never sees forming bar**
   - Detects signals with `closedCandles` only via `this.patternEngine.detectSignals(closedCandles, symbol, timeframe, validHTFCandles)` (122-128)
   - Processes each signal with `this.paperTrading.processSignal(signal)` (131-133)
   - Executes trades against forming candle with `this.paperTrading.updateTrades(candle)` AFTER detection (135-138)
   - Adds candle to buffer with `this.addCandle(candle)` (making it available for next iteration) (140)
3. **Pattern detection:** Done via `PatternEngine.detectSignals()` on closed candles only
4. **Signal → trade:** Signals passed to `PaperTradingEngine.processSignal()` which creates pending/open trades; `updateTrades()` manages fills/exits

### Method to get each new candle
- In simulation: `runSimulation(startIndex?: number)` (144-175) iterates through `this.allCandles` array sequentially by index, calling `processCandle(candle)` for each
- In live mode (simulated): `runLive(startIndex?: number)` (180-207) same iteration but with `await this.sleep(this.config.pollIntervalMs)` between candles and logs
- External API: `addCandle(candle: Candle)` (68-75) adds to buffer; `step()` (212-223) processes one candle from `allCandles`
- **No real-time feed integration** - all data comes from pre-loaded CSV arrays

### Polling loop or websocket push?
- **Polling loop / simulated iteration.** `runSimulation()` uses a `while` loop iterating through array indices. `runLive()` uses `while` loop with `setTimeout` via `sleep()`. No WebSocket, no event listeners for live feeds. The `pollIntervalMs` in config is used for delay in `runLive()` simulation only.

### Generating signals?
- **YES, it generates signals** when conditions met. PatternEngine.detectSignals() is called with closed candles only (line 122-128). Signals go to PaperTradingEngine.processSignal(). The code is explicitly designed for correct timing - tests confirm it tries to avoid using forming candles (see regression tests).  
- Status: **VERIFIED WORKING IN CODE** for CSV-based simulation. The live path logic is correct per design (closed-candle only detection). But "live" here means simulated from CSV, not connected to real market data feeds.

---

## 4. The `angelone` command in commands.ts (line 249-468)

### Full read summary (lines 249-468)

**Provider:** **Angel One** (via `AngelOneAdapter` imported at line 10).  
**Uses UpstoxFeed?** **NO.** No imports/references to UpstoxFeed or LiveMarketDataService in the angelone command.  
**Uses Angel One?** **YES.** Creates `AngelOneAdapter()`, calls `authenticate()` with credentials from env vars.

### Real broker connection or CSV simulation?
- **Real broker connection attempt.** It connects to Angel One SmartAPI via `adapter.authenticate()` (317-345). It polls live data using `adapter.getQuote(symbol)` every `pollIntervalMs` (380-467). Creates candles from quotes (390-398), maintains buffers, runs pattern detection on buffers (411-440), updates paper trades (457-464).  
- **Not CSV simulation** - it fetches live quotes from Angel One API in a polling loop.

### Credential checks
**YES - extensive checks (262-278):** Checks for `ANGELONE_API_KEY`, `ANGELONE_CLIENT_ID`, `ANGELONE_PASSWORD`, `ANGELONE_TOTP_SECRET`. If any missing, prints error with instructions and exits with code 1. Also validates symbols against `NSE_STOCK_TOKENS` (305-310) with warnings. Authentication failure causes exit (330-345).

### What happens if credentials missing?
As above - logs clear error message listing required env vars, references `config/env.example`, calls `process.exit(1)`. Does NOT fall back to simulation.

### Additional details
- Checks market hours via `IndianMarketCalendar` (281-295) - warns if closed but continues
- Paper trading by default (`--paper` option, default true at line 255; actual trading only happens if `options.paper` is true at line 433-439)
- Registers all patterns (313), creates PatternEngine, PaperTradingEngine, NotificationService
- Handles Ctrl+C to disconnect and show dashboard (365-375)
- Updates trades on each poll (457-464)

**Status:** **VERIFIED IMPLEMENTED** - connects to real Angel One API, does real polling, but all trading is paper trading (processes signals through PaperTradingEngine, no actual order placement).

---

## 5. Angel One adapter

**Search results:** `app-ts/src/data/AngelOneAdapter.ts` exists (684 lines). Also referenced in `NseAdapter.ts` (TODOs mention Angel One WebSocket/login/getCandleData).

### What it does (AngelOneAdapter.ts)
Full SmartAPI integration:
- **Auth:** `authenticate()` (239-254) takes credentials, calls `connect()` (167-211). `connect()` initializes SmartAPI with apiKey/clientId/totp/password, calls `generateSession()`, stores session (jwtToken, refreshToken, feedToken, clientCode). `disconnect()` (216-234) logs out. `refreshToken()` (259-283). TOTP generation via `totp-generator` (288-298).
- **Historical data:** `getHistoricalData()` (322-384) with circuit breaker, rate limiter, retry logic. Converts Angel One candle format to our Candle format. Supports timeframes via `INTERVAL_MAP` (72-81).
- **Quotes:** `getQuote()` (425-483) gets full quote with LTP, OHLC, volume, change. `getLatestCandle()` (389-420) creates candle from LTP.
- **Tokens:** Has hardcoded `NSE_STOCK_TOKENS` (87-124) and `INDEX_TOKENS` (129-133). `getSymbolToken()` looks them up.
- **WebSocket:** `subscribeToFeed()` (503-523) has simplified implementation that logs note "For real WebSocket, use SmartWebSocket SDK" and falls back to polling via `startPolling()` (528-548).
- **Orders:** `placeOrder()` (600-652) is **completely stubbed/disabled** - logs warnings and returns null. Actual implementation is commented out (620-651). **No real order placement.**
- **Utils:** `getProfile()`, `getFunds()`, circuit breaker/rate limiter integration, date formatting.

**Status:** **VERIFIED IMPLEMENTED** with real API calls for auth/historical/quotes, but WebSocket is simplified/polling fallback, order placement is disabled/stubbed.

---

## 6. Live vs historical divergence

### Live signal path
**Files touched:**
- **For CSV-simulated "live" (LiveMonitor.runLive):** `app-ts/src/cli/commands.ts` (live command, 165-201) → `app-ts/src/core/LiveMonitor.ts` → `app-ts/src/core/PatternEngine.ts` → patterns in `app-ts/src/patterns/*` → `app-ts/src/core/PaperTradingEngine.ts` → `app-ts/src/core/CandleResampler.ts` (for HTF)
- **For real broker "live" (angelone command):** `app-ts/src/cli/commands.ts` (249-468) → `app-ts/src/data/AngelOneAdapter.ts` → `app-ts/src/core/PatternEngine.ts` → patterns → `app-ts/src/core/PaperTradingEngine.ts` + `app-ts/src/notifications/NotificationService.ts` + `app-ts/src/data/IndianMarketCalendar.ts`
- **LiveMarketDataService path (exists but NOT wired):** `app-ts/src/data/LiveMarketDataService.ts` → `app-ts/src/data/UpstoxFeed.ts` → would need to connect to monitors (not currently connected)

### Historical/simulate/backtest path
**Files touched:**
- **simulate command:** `app-ts/src/cli/commands.ts` (100-162) → `app-ts/src/core/LiveMonitor.ts` (runSimulation) → same as above: PatternEngine, patterns, PaperTradingEngine, CandleResampler
- **multi-symbol:** `app-ts/src/cli/commands.ts` (203-246) → `app-ts/src/core/MultiSymbolMonitor.ts` → PatternEngine, patterns, PaperTradingEngine, CandleResampler
- **API simulation routes:** `app-ts/src/api/routes/simulation.ts` (exists in glob listing)

### Shared vs separate logic?
- **Strategy/pattern logic is SHARED.** Both paths use `PatternEngine`, same pattern classes from `app-ts/src/patterns/` (BasePattern, SRRetestPattern, TrendlineBreakPattern, FibPullbackPattern, ConfluenceZonePattern, etc.), same `PatternRegistry`. Both use `PaperTradingEngine` for trade management.
- **Data loading differs:** Live (simulated) reads CSV via `CSVLoader` into arrays; Angel One live polls via adapter; historical simulation also uses CSV. LiveMarketDataService would use UpstoxFeed/WebSocket if wired.
- **Execution flow is similar** but LiveMonitor has specific timing logic (closed candles only, HTF resampling from closed candles) as documented in comments and tested in regression tests. MultiSymbolMonitor has similar but slightly different structure (processes per-symbol buffers).
- **Divergence:** The "live" in CLI can mean two different things - (1) simulated real-time from CSV (LiveMonitor.runLive) or (2) connected to real broker (angelone command). They share pattern/strategy logic but different data sources and slightly different orchestration code. LiveMarketDataService represents yet another live path that is **not integrated**.

**Conclusion:** Strategy/pattern logic is shared. Data acquisition and orchestration differ. Some duplication exists (e.g., candle buffering logic in angelone command duplicates what monitors do).

---

## 7. Broker order execution

### Search results
Searched for "order", "placeOrder", "buyOrder", "sellOrder", "broker" across app-ts/src/.

**Findings:**
- **AngelOneAdapter.placeOrder()** (600-652): **EXISTS but DISABLED/STUBBED.** Logs warnings "Order placement is disabled in paper trading mode" and returns `null`. Actual implementation is fully commented out (620-651). Never actually places orders.
- **NseAdapter.ts** has interface comment `// placeOrder(order: Order): Promise<OrderResult>;` (line ~39) but no implementation found in grep results - likely abstract/interface placeholder.
- **PaperTradingEngine** handles "trades" but all are simulated (paper trading). No actual broker API calls.
- **Config files** mention brokerage costs (indianMarket.ts, brokers.ts) for simulation/paper trading calculations.

**Conclusion:** **NO CODE PLACES REAL BROKER ORDERS.** Everything is paper trading. AngelOneAdapter has a placeOrder method but it's stubbed/disabled with a big comment saying "Uncomment for live trading (AFTER TESTING)". No other broker order placement found.

**Status:** **VERIFIED - ALL PAPER TRADING ONLY**

---

## 8. Tests for live path

### Tests found
**Only in `app-ts/tests/regression.test.ts`:**
- Lines 425-520: `describe('LiveMonitor signal timing', ...)` with tests:
  1. `never hands the pattern the candle that is currently being processed` (473-504) - Tests that pattern doesn't see the forming candle. Creates SpyPattern, registers with PatternEngine, creates LiveMonitor with mocked candles, calls runSimulation(), checks spy.seen doesn't contain last timestamp. **Comments say "VERIFIED DEFECT" in test description** - test expects the CORRECT behavior (pattern should NOT see forming candle). The implementation in LiveMonitor.processCandle DOES follow correct behavior per current code (adds candle AFTER processing, uses closedCandles buffer).
  2. `advances the detection window by exactly one candle per bar` (506-535) - Checks each observation is distinct and in order.

### Are they testing real connections or mocked data?
- **All mocked/simulated data.** Tests create `flatCandles(10)` helper, manually set `(monitor as any).allCandles = candles`, inject spy pattern into engine. No real API calls, no WebSocket connections, no Upstox/Angel One credentials needed. Uses in-memory arrays.

**Other live-related code:** No tests for LiveMarketDataService, UpstoxFeed, AngelOneAdapter found. No tests for angelone CLI command.

**Status:** **Tests exist but only for LiveMonitor timing tests with mocked data. No tests for real live connections.**

---

## 9. TODO/FIXME/placeholder in core/ and data/

### In `app-ts/src/core/`:
**No TODO/FIXME/placeholder/"not implemented"/"stub" found.**

### In `app-ts/src/data/`:
Found in `app-ts/src/data/NseAdapter.ts` (9 matches):
- Line ~259: `// TODO: Implement Shoonya WebSocket connection`
- Line ~272: `// TODO: Call Shoonya login API`  
- Line ~284: `// TODO: Use Shoonya's GetQuotes or subscribe to WebSocket`
- Line ~289: `// TODO: Call Shoonya's TPSeries API`
- Line ~309: `// TODO: Implement Angel One WebSocket`
- Line ~322: `// TODO: Call Angel One login API with TOTP`
- Line ~329: `// TODO: Call generateToken API`
- Line ~334: `// TODO: Use SmartAPI's getLTP or getCandleData`
- Line ~339: `// TODO: Call getCandleData API`

Also `AngelOneAdapter.ts` has:
- Place order implementation commented out with warnings (lines ~620-651) - effectively a stub/disabled feature
- WebSocket says "Note: For real WebSocket, use SmartWebSocket SDK" and falls back to polling (line ~519-520)
- SmartAPI SDK import has try/catch with warning if not installed (23-29)

**Summary:** Core logic is clean (no TODOs). Data layer has TODOs in NseAdapter.ts for incomplete broker adapter implementations. Angel One adapter is mostly implemented but has disabled order placement and simplified WebSocket.

---

## Summary of Key Findings

| Component | Status | Notes |
|---|---|---|
| **UpstoxFeed** | ✅ Implemented | Full REST + WebSocket client, OAuth flow, methods exist (different names than asked). Credentials from env/config. **Not used by LiveMonitor/MultiSymbolMonitor**. Used by LiveMarketDataService. |
| **LiveMarketDataService** | ⚠️ Implemented but not wired | Complete singleton with WS + polling, candle building from ticks, callbacks. **Not imported/used by core monitors**. |
| **LiveMonitor** | ✅ Implemented (CSV-based) | Correct timing logic (closed candles only), HTF resampling, feeds to PatternEngine → PaperTradingEngine. Polling/simulation loop, not real-time feeds. |
| **angelone command** | ✅ Implemented (real broker) | Connects to Angel One SmartAPI, polls quotes, does pattern detection, **paper trading only**. Proper credential checks. |
| **AngelOneAdapter** | ⚠️ Mostly implemented | Auth, historical, quotes work. WebSocket simplified (polling fallback). **placeOrder() stubbed/disabled** - no real orders. |
| **Live vs Historical** | 🔀 Divergent paths | Strategy logic shared (PatternEngine + patterns). Data sources differ. LiveMarketDataService is separate/unintegrated path. |
| **Order execution** | ✅ Paper trading only | No real broker orders. AngelOneAdapter.placeOrder returns null with warnings. |
| **Tests** | ⚠️ Limited | Only LiveMonitor timing tests with mocked data. No tests for real connections. |
| **TODOs** | ⚠️ In data layer | NseAdapter.ts has TODOs for Shoonya/Angel One incomplete methods. Core is clean. |

**Overall:** There is infrastructure for live market data (Upstox, Angel One), but the main "live" monitoring paths use either CSV simulation (LiveMonitor) or direct Angel One polling in CLI (angelone command). LiveMarketDataService exists as a unified service but is **not wired into the core monitors**. **No real order execution exists anywhere - everything is paper trading.**
