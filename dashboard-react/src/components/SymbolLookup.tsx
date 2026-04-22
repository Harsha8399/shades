import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import {
  Search,
  Loader2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Calendar,
  BarChart3,
  Layers,
  Hash,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldAlert,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Types ───────────────────────────────────────────────

interface SymbolMeta {
  symbol: string;
  type: 'INDEX' | 'EQUITY';
  exchange: string;
  hasFnO: boolean;
  lotSize: number;
  strikeInterval: number;
  weeklyExpiry: boolean;
  referencePrice: number | null;
}

interface SymbolDetails {
  symbol: string;
  type: string;
  spotPrice: number | null;
  lastTradePrice: number | null;
  referencePrice: number | null;
  atmStrike: number | null;
  futuresPrice: number | null;
  lotSize: number;
  strikeInterval: number;
  weeklyExpiry: boolean;
  hasFnO: boolean;
  expiry: {
    date: string;
    daysToExpiry: number;
    expiryString: string;
    futuresSymbol: string;
  };
  fees: {
    segment: string;
    sampleLotValue: number;
    buy: { totalFees: number; brokerage: number; stt: number; gst: number } | null;
    sell: { totalFees: number; brokerage: number; stt: number; gst: number } | null;
    totalRoundTrip: number | null;
  };
  marketHours: {
    preOpen: { start: string; end: string };
    trading: { start: string; end: string };
    postClose: { start: string; end: string };
  };
}

interface OptionStrike {
  strike: number;
  isATM: boolean;
  ce: {
    symbol: string;
    price: number;
    delta: number;
    intrinsic: number;
    timeValue: number;
    moneyness: 'ITM' | 'ATM' | 'OTM';
    lotValue: number;
  };
  pe: {
    symbol: string;
    price: number;
    delta: number;
    intrinsic: number;
    timeValue: number;
    moneyness: 'ITM' | 'ATM' | 'OTM';
    lotValue: number;
  };
}

interface OptionsData {
  symbol: string;
  spotPrice: number;
  atmStrike: number;
  expiry: { date: string; daysToExpiry: number; expiryString: string };
  lotSize: number;
  strikeInterval: number;
  volatility: number;
  chain: OptionStrike[];
}

// ─── Main Component ──────────────────────────────────────

interface SymbolLookupProps {
  onSymbolSelect?: (symbol: string, price: number) => void;
}

export function SymbolLookup({ onSymbolSelect }: SymbolLookupProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SymbolMeta[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [details, setDetails] = useState<SymbolDetails | null>(null);
  const [options, setOptions] = useState<OptionsData | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [customPrice, setCustomPrice] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'options'>('details');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Autocomplete search ────────────────────────────────
  const searchSymbols = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSuggestions([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.instruments.search(q);
      setSuggestions(res.symbols);
      setShowDropdown(true);
    } catch {
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length >= 1) {
      debounceRef.current = setTimeout(() => searchSymbols(query), 200);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchSymbols]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ─── Load details for selected symbol ───────────────────
  const loadDetails = useCallback(async (symbol: string, spotPrice?: number) => {
    setIsLoadingDetails(true);
    try {
      const res = await api.instruments.getDetails(symbol, spotPrice);
      setDetails(res);
    } catch {
      setDetails(null);
    } finally {
      setIsLoadingDetails(false);
    }
  }, []);

  const loadOptions = useCallback(async (symbol: string, spotPrice?: number) => {
    setIsLoadingOptions(true);
    try {
      const res = await api.instruments.getOptions(symbol, spotPrice, 8);
      setOptions(res);
    } catch {
      setOptions(null);
    } finally {
      setIsLoadingOptions(false);
    }
  }, []);

  const handleSelect = (symbol: SymbolMeta) => {
    setSelectedSymbol(symbol.symbol);
    setQuery(symbol.symbol);
    setShowDropdown(false);
    setCustomPrice(symbol.referencePrice?.toString() || '');
    loadDetails(symbol.symbol);
    if (symbol.referencePrice) {
      onSymbolSelect?.(symbol.symbol, symbol.referencePrice);
    }
  };

  const handlePriceUpdate = () => {
    const price = parseFloat(customPrice);
    if (selectedSymbol && price > 0) {
      loadDetails(selectedSymbol, price);
      loadOptions(selectedSymbol, price);
      onSymbolSelect?.(selectedSymbol, price);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSelectedSymbol(null);
    setDetails(null);
    setOptions(null);
    setSuggestions([]);
    setCustomPrice('');
    setShowOptions(false);
    inputRef.current?.focus();
  };

  const toggleOptionsChain = () => {
    if (!showOptions && selectedSymbol) {
      const price = parseFloat(customPrice) || details?.spotPrice || 0;
      if (price > 0) loadOptions(selectedSymbol, price);
    }
    setShowOptions(!showOptions);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Search size={18} className="text-accent" />
            Symbol Lookup
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Search NSE stocks and indices — view F&O details and options chain</p>
        </div>
        <div className="card-body">
          <div className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-3 text-slate-500" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value.toUpperCase()); if (selectedSymbol) setSelectedSymbol(null); }}
                  onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
                  placeholder="Search symbol... e.g. RELIANCE, NIFTY, TCS"
                  className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg pl-10 pr-10 py-2.5 text-white text-sm focus:border-accent focus:outline-none"
                />
                {(query || selectedSymbol) && (
                  <button
                    onClick={handleClear}
                    className="absolute right-3 top-3 text-slate-500 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
                {isSearching && (
                  <Loader2 size={14} className="absolute right-10 top-3.5 animate-spin text-accent" />
                )}
              </div>
              {selectedSymbol && (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-500 text-sm">₹</span>
                    <input
                      type="number"
                      value={customPrice}
                      onChange={e => setCustomPrice(e.target.value)}
                      onBlur={handlePriceUpdate}
                      onKeyDown={e => e.key === 'Enter' && handlePriceUpdate()}
                      placeholder="Spot price"
                      className="w-36 bg-bg-tertiary border border-slate-700/50 rounded-lg pl-7 pr-3 py-2.5 text-white text-sm focus:border-accent focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handlePriceUpdate}
                    className="px-3 py-2.5 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 transition-colors"
                  >
                    Update
                  </button>
                </div>
              )}
            </div>

            {/* Dropdown */}
            {showDropdown && suggestions.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-50 mt-1 w-full bg-bg-secondary border border-slate-700/50 rounded-lg shadow-xl max-h-72 overflow-y-auto"
              >
                {suggestions.map(sym => (
                  <button
                    key={sym.symbol}
                    onClick={() => handleSelect(sym)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-tertiary transition-colors border-b border-slate-800/50 last:border-0',
                      selectedSymbol === sym.symbol && 'bg-accent/10'
                    )}
                  >
                    <div className={clsx(
                      'w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold',
                      sym.type === 'INDEX' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                    )}>
                      {sym.type === 'INDEX' ? 'IDX' : 'EQ'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{sym.symbol}</span>
                        {sym.hasFnO && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded font-medium">F&O</span>
                        )}
                        {sym.weeklyExpiry && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded">Weekly</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {sym.exchange} · Lot: {sym.lotSize} · Strike: ₹{sym.strikeInterval}
                      </div>
                    </div>
                    <div className="text-right">
                      {sym.referencePrice && (
                        <div className="text-sm text-white font-mono">₹{sym.referencePrice.toLocaleString()}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Details / Options Tabs */}
      {selectedSymbol && (
        <>
          <div className="flex gap-2 border-b border-slate-700/50 pb-0">
            <button
              onClick={() => setActiveTab('details')}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors',
                activeTab === 'details'
                  ? 'border-accent text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              )}
            >
              <Info size={14} />
              Details & Fees
            </button>
            <button
              onClick={() => { setActiveTab('options'); toggleOptionsChain(); }}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors',
                activeTab === 'options'
                  ? 'border-accent text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              )}
            >
              <Layers size={14} />
              Options Chain (CE / PE)
            </button>
          </div>

          {activeTab === 'details' && <DetailsPanel details={details} isLoading={isLoadingDetails} />}
          {activeTab === 'options' && <OptionsChainPanel data={options} isLoading={isLoadingOptions} />}
        </>
      )}
    </div>
  );
}

// ─── Details Panel ───────────────────────────────────────

function DetailsPanel({ details, isLoading }: { details: SymbolDetails | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="card-body flex items-center justify-center h-40">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      </div>
    );
  }

  if (!details) return null;

  const displayPrice = details.spotPrice || details.referencePrice || details.lastTradePrice;

  return (
    <div className="space-y-4">
      {/* Price Header */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-white">{details.symbol}</h2>
                <span className={clsx(
                  'text-xs px-2 py-1 rounded font-medium',
                  details.type === 'INDEX' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                )}>
                  {details.type}
                </span>
                {details.hasFnO && (
                  <span className="text-xs px-2 py-1 bg-accent/15 text-accent rounded font-medium">F&O Available</span>
                )}
              </div>
              <p className="text-slate-500 text-sm mt-1">NSE · {details.weeklyExpiry ? 'Weekly + Monthly Expiry' : 'Monthly Expiry'}</p>
            </div>
            <div className="text-right">
              {displayPrice ? (
                <div className="text-3xl font-bold font-mono text-white">₹{displayPrice.toLocaleString()}</div>
              ) : (
                <div className="text-sm text-slate-500">Enter spot price →</div>
              )}
              {details.lastTradePrice && details.lastTradePrice !== displayPrice && (
                <div className="text-xs text-slate-500 mt-1">Last traded: ₹{details.lastTradePrice.toLocaleString()}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoCard
          icon={<Layers size={16} />}
          label="Lot Size"
          value={details.lotSize.toString()}
          color="blue"
        />
        <InfoCard
          icon={<Hash size={16} />}
          label="Strike Interval"
          value={`₹${details.strikeInterval}`}
          color="purple"
        />
        <InfoCard
          icon={<BarChart3 size={16} />}
          label="ATM Strike"
          value={details.atmStrike ? `₹${details.atmStrike.toLocaleString()}` : '-'}
          color="accent"
        />
        <InfoCard
          icon={<TrendingUp size={16} />}
          label="Futures Price"
          value={details.futuresPrice ? `₹${details.futuresPrice.toLocaleString()}` : '-'}
          sub={details.futuresPrice && displayPrice ? `+${((details.futuresPrice / displayPrice - 1) * 100).toFixed(2)}%` : undefined}
          color="green"
        />
      </div>

      {/* Expiry + Fees */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Expiry Info */}
        <div className="card">
          <div className="card-header border-b border-slate-700/30">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Calendar size={14} className="text-accent" />
              Next Expiry
            </h4>
          </div>
          <div className="card-body space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Expiry Date</span>
              <span className="text-white font-mono">{new Date(details.expiry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Days to Expiry</span>
              <span className={clsx(
                'font-mono font-medium',
                details.expiry.daysToExpiry <= 3 ? 'text-red-400' : details.expiry.daysToExpiry <= 7 ? 'text-yellow-400' : 'text-white'
              )}>
                {details.expiry.daysToExpiry}d
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Series</span>
              <span className="text-white font-mono">{details.expiry.expiryString}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Futures Symbol</span>
              <span className="text-accent font-mono text-xs">{details.expiry.futuresSymbol}</span>
            </div>
          </div>
        </div>

        {/* Fee Breakdown */}
        <div className="card">
          <div className="card-header border-b border-slate-700/30">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <DollarSign size={14} className="text-accent" />
              F&O Fees (1 lot)
            </h4>
          </div>
          <div className="card-body space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Lot Value</span>
              <span className="text-white font-mono">₹{(details.fees.sampleLotValue || 0).toLocaleString()}</span>
            </div>
            {details.fees.buy && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Buy-side Fees</span>
                <span className="text-white font-mono">₹{details.fees.buy.totalFees.toFixed(2)}</span>
              </div>
            )}
            {details.fees.sell && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Sell-side Fees</span>
                <span className="text-white font-mono">₹{details.fees.sell.totalFees.toFixed(2)}</span>
              </div>
            )}
            {details.fees.totalRoundTrip !== null && (
              <>
                <div className="border-t border-slate-700/30 pt-2 flex justify-between text-sm font-medium">
                  <span className="text-slate-300">Total Round-trip</span>
                  <span className="text-accent font-mono">₹{details.fees.totalRoundTrip.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Market Hours */}
      <div className="card">
        <div className="card-header border-b border-slate-700/30">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock size={14} className="text-accent" />
            NSE Market Hours
          </h4>
        </div>
        <div className="card-body">
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-slate-500">Pre-Open</span>
              <span className="text-white ml-2 font-mono">{details.marketHours.preOpen.start}–{details.marketHours.preOpen.end}</span>
            </div>
            <div>
              <span className="text-slate-500">Trading</span>
              <span className="text-green-400 ml-2 font-mono">{details.marketHours.trading.start}–{details.marketHours.trading.end}</span>
            </div>
            <div>
              <span className="text-slate-500">Post-Close</span>
              <span className="text-white ml-2 font-mono">{details.marketHours.postClose.start}–{details.marketHours.postClose.end}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Info Card ───────────────────────────────────────────

function InfoCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400',
    purple: 'bg-purple-500/10 text-purple-400',
    green: 'bg-green-500/10 text-green-400',
    accent: 'bg-accent/10 text-accent',
    red: 'bg-red-500/10 text-red-400',
  };
  return (
    <div className="card">
      <div className="card-body p-3">
        <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center mb-2', colors[color] || colors.blue)}>
          {icon}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-lg font-bold font-mono text-white mt-0.5">{value}</div>
        {sub && <div className="text-xs text-green-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Options Chain Panel ─────────────────────────────────

function OptionsChainPanel({ data, isLoading }: { data: OptionsData | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="card-body flex items-center justify-center h-48">
          <Loader2 className="animate-spin text-accent" size={28} />
          <span className="text-slate-400 ml-3">Loading options chain...</span>
        </div>
      </div>
    );
  }

  if (!data || data.chain.length === 0) {
    return (
      <div className="card">
        <div className="card-body flex flex-col items-center justify-center h-40">
          <Layers size={32} className="text-slate-600 mb-2" />
          <div className="text-slate-400 text-sm">Enter a spot price to view the options chain</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-slate-500">Spot</div>
                <div className="text-lg font-bold font-mono text-white">₹{data.spotPrice.toLocaleString()}</div>
              </div>
              <div className="w-px h-8 bg-slate-700" />
              <div>
                <div className="text-xs text-slate-500">ATM Strike</div>
                <div className="text-lg font-bold font-mono text-accent">₹{data.atmStrike.toLocaleString()}</div>
              </div>
              <div className="w-px h-8 bg-slate-700" />
              <div>
                <div className="text-xs text-slate-500">Expiry</div>
                <div className="text-sm font-medium text-white">{data.expiry.expiryString} · {data.expiry.daysToExpiry}d</div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>Lot: <span className="text-white">{data.lotSize}</span></span>
              <span>IV: <span className="text-white">{(data.volatility * 100).toFixed(0)}%</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Chain Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary/50">
                {/* CE side */}
                <th className="text-left px-3 py-2.5 text-green-400 font-medium">
                  <div className="flex items-center gap-1"><ArrowUpRight size={12} /> CE Price</div>
                </th>
                <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Delta</th>
                <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Lot Cost</th>
                <th className="text-right px-3 py-2.5 text-slate-500 font-medium">TV</th>
                {/* Strike */}
                <th className="text-center px-3 py-2.5 text-white font-bold bg-bg-tertiary">Strike</th>
                {/* PE side */}
                <th className="text-left px-3 py-2.5 text-slate-500 font-medium">TV</th>
                <th className="text-left px-3 py-2.5 text-slate-500 font-medium">Lot Cost</th>
                <th className="text-left px-3 py-2.5 text-slate-500 font-medium">Delta</th>
                <th className="text-right px-3 py-2.5 text-red-400 font-medium">
                  <div className="flex items-center gap-1 justify-end">PE Price <ArrowDownRight size={12} /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.chain.map((row) => (
                <tr
                  key={row.strike}
                  className={clsx(
                    'border-t border-slate-800/30 transition-colors hover:bg-bg-tertiary/30',
                    row.isATM && 'bg-accent/5 border-accent/20'
                  )}
                >
                  {/* CE */}
                  <td className="px-3 py-2">
                    <span className={clsx(
                      'font-mono font-medium',
                      row.ce.moneyness === 'ITM' ? 'text-green-400' : row.ce.moneyness === 'ATM' ? 'text-white' : 'text-slate-400'
                    )}>
                      ₹{row.ce.price.toFixed(2)}
                    </span>
                    <span className={clsx(
                      'ml-1.5 text-[10px] px-1 py-0.5 rounded',
                      row.ce.moneyness === 'ITM' ? 'bg-green-500/10 text-green-400' :
                      row.ce.moneyness === 'ATM' ? 'bg-accent/10 text-accent' : 'bg-slate-700/30 text-slate-500'
                    )}>
                      {row.ce.moneyness}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400 text-xs">{row.ce.delta.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300 text-xs">₹{row.ce.lotValue.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500 text-xs">{row.ce.timeValue.toFixed(2)}</td>
                  {/* Strike */}
                  <td className={clsx(
                    'px-3 py-2 text-center font-mono font-bold bg-bg-tertiary/30',
                    row.isATM ? 'text-accent' : 'text-white'
                  )}>
                    {row.strike.toLocaleString()}
                    {row.isATM && <span className="block text-[10px] text-accent font-normal">ATM</span>}
                  </td>
                  {/* PE */}
                  <td className="px-3 py-2 text-left font-mono text-slate-500 text-xs">{row.pe.timeValue.toFixed(2)}</td>
                  <td className="px-3 py-2 text-left font-mono text-slate-300 text-xs">₹{row.pe.lotValue.toLocaleString()}</td>
                  <td className="px-3 py-2 text-left font-mono text-slate-400 text-xs">{row.pe.delta.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={clsx(
                      'font-mono font-medium',
                      row.pe.moneyness === 'ITM' ? 'text-red-400' : row.pe.moneyness === 'ATM' ? 'text-white' : 'text-slate-400'
                    )}>
                      ₹{row.pe.price.toFixed(2)}
                    </span>
                    <span className={clsx(
                      'ml-1.5 text-[10px] px-1 py-0.5 rounded',
                      row.pe.moneyness === 'ITM' ? 'bg-red-500/10 text-red-400' :
                      row.pe.moneyness === 'ATM' ? 'bg-accent/10 text-accent' : 'bg-slate-700/30 text-slate-500'
                    )}>
                      {row.pe.moneyness}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-xs text-yellow-400/80">
        <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
        <div>
          Estimated premiums using simplified Black-Scholes approximation (20% IV). Actual premiums depend on real-time implied volatility, open interest, and market conditions.
          Connect a live broker feed for real-time option prices.
        </div>
      </div>
    </div>
  );
}
