import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Brain,
  Zap,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  ShieldAlert,
  Clock,
  Settings,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  MessageSquare,
} from 'lucide-react';
import clsx from 'clsx';

/** Analysis types and their labels */
const ANALYSIS_TYPES = [
  { value: 'performance_review', label: 'Performance Review', icon: Zap, description: 'Overall system health and performance analysis' },
  { value: 'pattern_analysis', label: 'Pattern Analysis', icon: Brain, description: 'Evaluate effectiveness of each trading pattern' },
  { value: 'risk_assessment', label: 'Risk Assessment', icon: ShieldAlert, description: 'Drawdown analysis and risk exposure review' },
  { value: 'strategy_suggestion', label: 'Strategy Suggestions', icon: Lightbulb, description: 'Concrete improvements based on your data' },
  { value: 'trade_review', label: 'Trade Review', icon: MessageSquare, description: 'Analyze winning vs losing trade characteristics' },
  { value: 'market_context', label: 'Market Context', icon: AlertTriangle, description: 'Performance across different market conditions' },
] as const;

/** LLM providers */
const PROVIDERS = [
  { value: 'ollama', label: 'Ollama (Local)', description: 'Free, runs on your machine' },
  { value: 'deepseek', label: 'DeepSeek', description: 'Cloud API, fast and cheap' },
  { value: 'openai', label: 'OpenAI', description: 'GPT-4o-mini, high quality' },
] as const;

interface AnalysisResult {
  id: string;
  type: string;
  provider: string;
  model: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  riskWarnings: string[];
  rawResponse: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  timestamp: string;
}

interface LLMHealth {
  provider: string;
  available: boolean;
  model: string;
  latencyMs?: number;
  error?: string;
}

interface LLMConfig {
  activeProvider: string;
  config: {
    provider: string;
    baseUrl: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  availableTypes: string[];
}

export function Analysis() {
  const [health, setHealth] = useState<LLMHealth | null>(null);
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [selectedType, setSelectedType] = useState<string>('performance_review');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings form state
  const [settingsProvider, setSettingsProvider] = useState('ollama');
  const [settingsModel, setSettingsModel] = useState('');
  const [settingsApiKey, setSettingsApiKey] = useState('');

  // Load initial state
  useEffect(() => {
    async function init() {
      try {
        const [configRes, historyRes] = await Promise.all([
          api.llm.getConfig(),
          api.llm.getHistory(),
        ]);
        setConfig(configRes);
        setSettingsProvider(configRes.activeProvider);
        setSettingsModel(configRes.config.model);
        setHistory(historyRes.analyses);
      } catch (err) {
        console.error('Failed to load LLM config:', err);
      }
    }
    init();
  }, []);

  // Health check
  const checkHealth = useCallback(async () => {
    setIsCheckingHealth(true);
    try {
      const h = await api.llm.checkHealth();
      setHealth(h);
    } catch (err) {
      setHealth({ provider: 'unknown', available: false, model: 'unknown', error: 'Failed to reach API server' });
    } finally {
      setIsCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // Run analysis
  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.llm.analyze(selectedType, customPrompt || undefined);
      setResult(res);
      // Refresh history
      const historyRes = await api.llm.getHistory();
      setHistory(historyRes.analyses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Save settings
  const saveSettings = async () => {
    try {
      const update: Record<string, any> = { provider: settingsProvider };
      if (settingsModel) update.model = settingsModel;
      if (settingsApiKey) update.apiKey = settingsApiKey;
      
      const res = await api.llm.updateConfig(update);
      setConfig(prev => prev ? { ...prev, ...res } : null);
      setShowSettings(false);
      // Re-check health with new provider
      checkHealth();
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <Brain className="text-accent" size={32} />
            AI Analysis
          </h1>
          <p className="text-slate-400 mt-1">LLM-powered trading performance insights</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Health indicator */}
          <div className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
            health?.available 
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          )}>
            {isCheckingHealth ? (
              <Loader2 size={14} className="animate-spin" />
            ) : health?.available ? (
              <CheckCircle size={14} />
            ) : (
              <XCircle size={14} />
            )}
            <span>{config?.activeProvider || 'ollama'}: {health?.available ? health.model : 'Offline'}</span>
          </div>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={clsx(
              'p-2 rounded-lg transition-colors',
              showSettings ? 'bg-accent text-white' : 'bg-bg-tertiary text-slate-400 hover:text-white'
            )}
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-white">LLM Provider Settings</h3>
          </div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PROVIDERS.map(p => (
                <button
                  key={p.value}
                  onClick={() => {
                    setSettingsProvider(p.value);
                    // Set sensible default model
                    if (p.value === 'ollama') setSettingsModel('mistral');
                    else if (p.value === 'deepseek') setSettingsModel('deepseek-chat');
                    else setSettingsModel('gpt-4o-mini');
                  }}
                  className={clsx(
                    'p-4 rounded-lg border transition-all text-left',
                    settingsProvider === p.value 
                      ? 'border-accent bg-accent/10'
                      : 'border-slate-700/50 bg-bg-tertiary hover:border-slate-600'
                  )}
                >
                  <div className="text-white font-medium">{p.label}</div>
                  <div className="text-xs text-slate-400 mt-1">{p.description}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Model</label>
                <input
                  type="text"
                  value={settingsModel}
                  onChange={e => setSettingsModel(e.target.value)}
                  placeholder={settingsProvider === 'ollama' ? 'mistral' : 'deepseek-chat'}
                  className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
                />
              </div>
              {settingsProvider !== 'ollama' && (
                <div>
                  <label className="block text-sm text-slate-400 mb-1">API Key</label>
                  <input
                    type="password"
                    value={settingsApiKey}
                    onChange={e => setSettingsApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSettings}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
              >
                Save & Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Type Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ANALYSIS_TYPES.map(({ value, label, icon: Icon, description }) => (
          <button
            key={value}
            onClick={() => setSelectedType(value)}
            className={clsx(
              'p-4 rounded-lg border transition-all text-left',
              selectedType === value
                ? 'border-accent bg-accent/10 ring-1 ring-accent/50'
                : 'border-slate-700/50 bg-bg-secondary hover:border-slate-600'
            )}
          >
            <div className="flex items-center gap-3 mb-2">
              <Icon size={20} className={selectedType === value ? 'text-accent' : 'text-slate-400'} />
              <span className={clsx('font-medium', selectedType === value ? 'text-white' : 'text-slate-300')}>
                {label}
              </span>
            </div>
            <p className="text-xs text-slate-500">{description}</p>
          </button>
        ))}
      </div>

      {/* Custom Prompt + Run */}
      <div className="card">
        <div className="card-body space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">Additional Focus (optional)</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="e.g., Focus on why the Fibonacci pullback pattern has a low win rate..."
              rows={2}
              className="w-full bg-bg-tertiary border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none resize-none placeholder-slate-600"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Analysis type: <span className="text-slate-300">{ANALYSIS_TYPES.find(t => t.value === selectedType)?.label}</span>
              {' '} | Provider: <span className="text-slate-300">{config?.activeProvider || 'ollama'}</span>
            </div>
            <button
              onClick={runAnalysis}
              disabled={isAnalyzing || !health?.available}
              className={clsx(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm transition-all',
                isAnalyzing || !health?.available
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent/80 shadow-lg shadow-accent/20'
              )}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain size={16} />
                  Run Analysis
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading State */}
      {isAnalyzing && (
        <div className="card">
          <div className="card-body flex flex-col items-center justify-center py-16">
            <Loader2 size={40} className="text-accent animate-spin mb-4" />
            <div className="text-white font-medium">Analyzing your trading data...</div>
            <div className="text-slate-500 text-sm mt-1">This may take 15-60 seconds depending on your LLM provider</div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !isAnalyzing && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Summary</h3>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {(result.latencyMs / 1000).toFixed(1)}s
                </span>
                <span>{result.model}</span>
              </div>
            </div>
            <div className="card-body">
              <div className="text-slate-300 leading-relaxed whitespace-pre-wrap">{result.summary}</div>
            </div>
          </div>

          {/* Strengths + Weaknesses side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Strengths */}
            {result.strengths.length > 0 && (
              <div className="card">
                <div className="card-header flex items-center gap-2">
                  <ThumbsUp size={18} className="text-green-400" />
                  <h3 className="text-lg font-semibold text-white">Strengths</h3>
                </div>
                <div className="card-body">
                  <ul className="space-y-3">
                    {result.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2 shrink-0" />
                        <span className="text-sm text-slate-300">{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Weaknesses */}
            {result.weaknesses.length > 0 && (
              <div className="card">
                <div className="card-header flex items-center gap-2">
                  <ThumbsDown size={18} className="text-red-400" />
                  <h3 className="text-lg font-semibold text-white">Weaknesses</h3>
                </div>
                <div className="card-body">
                  <ul className="space-y-3">
                    {result.weaknesses.map((w, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-2 shrink-0" />
                        <span className="text-sm text-slate-300">{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <Lightbulb size={18} className="text-yellow-400" />
                <h3 className="text-lg font-semibold text-white">Recommendations</h3>
              </div>
              <div className="card-body">
                <ul className="space-y-3">
                  {result.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-xs font-bold shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-slate-300">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Risk Warnings */}
          {result.riskWarnings.length > 0 && (
            <div className="card border-yellow-500/20">
              <div className="card-header flex items-center gap-2">
                <AlertTriangle size={18} className="text-yellow-400" />
                <h3 className="text-lg font-semibold text-white">Risk Warnings</h3>
              </div>
              <div className="card-body bg-yellow-500/5">
                <ul className="space-y-3">
                  {result.riskWarnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <ShieldAlert size={14} className="text-yellow-400 mt-1 shrink-0" />
                      <span className="text-sm text-slate-300">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Raw Response Toggle */}
          <div className="card">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="w-full card-header flex items-center justify-between cursor-pointer hover:bg-bg-tertiary/50 transition-colors"
            >
              <h3 className="text-sm font-medium text-slate-400">Raw LLM Response</h3>
              {showRaw ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {showRaw && (
              <div className="card-body">
                <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                  {result.rawResponse}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-white">Recent Analyses</h3>
          </div>
          <div className="card-body">
            <div className="space-y-3">
              {history.slice(0, 5).map((h) => (
                <button
                  key={h.id}
                  onClick={() => { setResult(h); setShowRaw(false); }}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-bg-tertiary hover:bg-bg-tertiary/80 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <Brain size={16} className="text-accent" />
                    <div>
                      <div className="text-sm text-white font-medium">
                        {ANALYSIS_TYPES.find(t => t.value === h.type)?.label || h.type}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {h.provider}/{h.model} — {(h.latencyMs / 1000).toFixed(1)}s
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(h.timestamp).toLocaleString('en-IN', { 
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                    })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Getting Started (when no health and no history) */}
      {!health?.available && !isAnalyzing && history.length === 0 && (
        <div className="card">
          <div className="card-body text-center py-12">
            <Brain size={48} className="text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Set up your LLM provider</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto mb-6">
              For local analysis, install Ollama and pull a model:
            </p>
            <div className="bg-bg-tertiary rounded-lg p-4 max-w-sm mx-auto text-left">
              <code className="text-sm text-slate-300 block">
                <span className="text-slate-500">$</span> curl -fsSL https://ollama.com/install.sh | sh
              </code>
              <code className="text-sm text-slate-300 block mt-2">
                <span className="text-slate-500">$</span> ollama pull mistral
              </code>
            </div>
            <p className="text-slate-500 text-xs mt-4">
              Or click Settings to configure DeepSeek / OpenAI with an API key
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
