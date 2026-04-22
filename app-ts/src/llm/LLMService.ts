/**
 * LLM Service
 * 
 * Manages communication with LLM providers (Ollama local, DeepSeek cloud, OpenAI cloud).
 * Acts as a trading analyst — analyzes results, explains weaknesses, suggests improvements.
 * The LLM is NEVER a decision-maker; it's an advisory layer.
 */
import { v4 as uuidv4 } from 'uuid';
import {
  LLMProvider,
  LLMProviderConfig,
  LLMHealthStatus,
  AnalysisRequest,
  AnalysisResponse,
  AnalysisType,
  AnalysisContext,
  DEFAULT_OLLAMA_CONFIG,
  DEFAULT_DEEPSEEK_CONFIG,
  DEFAULT_OPENAI_CONFIG,
} from './types';
import { buildAnalysisPrompt } from './prompts';

/**
 * Raw LLM API response shapes
 */
interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

interface OpenAICompatibleResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}


export class LLMService {
  private static instance: LLMService;
  private configs: Map<LLMProvider, LLMProviderConfig> = new Map();
  private activeProvider: LLMProvider = 'ollama';
  private analysisHistory: AnalysisResponse[] = [];
  private maxHistory = 50;

  constructor() {
    // Initialize with defaults
    this.configs.set('ollama', { ...DEFAULT_OLLAMA_CONFIG });
    this.configs.set('deepseek', { ...DEFAULT_DEEPSEEK_CONFIG });
    this.configs.set('openai', { ...DEFAULT_OPENAI_CONFIG });
  }

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  // ─── Configuration ────────────────────────────────────────

  /**
   * Update provider configuration
   */
  configure(provider: LLMProvider, config: Partial<LLMProviderConfig>): void {
    const existing = this.configs.get(provider);
    if (existing) {
      this.configs.set(provider, { ...existing, ...config, provider });
    }
  }

  /**
   * Switch active provider
   */
  setProvider(provider: LLMProvider): void {
    if (!this.configs.has(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    this.activeProvider = provider;
    console.log(`[LLM] Switched to provider: ${provider}`);
  }

  /**
   * Get the active provider name
   */
  getActiveProvider(): LLMProvider {
    return this.activeProvider;
  }

  /**
   * Get config of current provider (safe — no API key exposed)
   */
  getActiveConfig(): Omit<LLMProviderConfig, 'apiKey'> {
    const config = this.configs.get(this.activeProvider)!;
    const { apiKey, ...safe } = config;
    return safe;
  }

  // ─── Health Check ─────────────────────────────────────────

  /**
   * Check if the active LLM provider is reachable
   */
  async checkHealth(): Promise<LLMHealthStatus> {
    const config = this.configs.get(this.activeProvider)!;
    const start = Date.now();

    try {
      if (this.activeProvider === 'ollama') {
        const res = await fetchWithTimeout(`${config.baseUrl}/api/tags`, {
          method: 'GET',
        }, config.timeoutMs || 10_000);

        if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
        
        const data = await res.json() as { models?: Array<{ name: string }> };
        const models = data.models?.map((m: { name: string }) => m.name) || [];
        const hasModel = models.some((m: string) => m.includes(config.model));

        return {
          provider: 'ollama',
          available: true,
          model: hasModel ? config.model : `${config.model} (not found, available: ${models.slice(0, 5).join(', ')})`,
          latencyMs: Date.now() - start,
        };
      } else {
        // OpenAI-compatible health check (DeepSeek, OpenAI)
        const res = await fetchWithTimeout(`${config.baseUrl}/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.apiKey || ''}`,
          },
        }, config.timeoutMs || 10_000);

        return {
          provider: this.activeProvider,
          available: res.ok,
          model: config.model,
          latencyMs: Date.now() - start,
          error: res.ok ? undefined : `API returned ${res.status}`,
        };
      }
    } catch (error) {
      return {
        provider: this.activeProvider,
        available: false,
        model: config.model,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ─── Analysis ─────────────────────────────────────────────

  /**
   * Run a trading analysis using the active LLM provider
   */
  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    const config = this.configs.get(this.activeProvider)!;
    const { system, user } = buildAnalysisPrompt(request.type, request.context, request.customPrompt);

    console.log(`[LLM] Running ${request.type} analysis via ${this.activeProvider}/${config.model}...`);
    const start = Date.now();

    let rawResponse: string;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      if (this.activeProvider === 'ollama') {
        const result = await this.callOllama(system, user, config);
        rawResponse = result.response;
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;
      } else {
        const result = await this.callOpenAICompatible(system, user, config);
        rawResponse = result.response;
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown LLM error';
      console.error(`[LLM] Analysis failed:`, errMsg);
      
      // Return a structured error response
      const errorResponse: AnalysisResponse = {
        id: uuidv4(),
        type: request.type,
        provider: this.activeProvider,
        model: config.model,
        summary: `Analysis failed: ${errMsg}`,
        strengths: [],
        weaknesses: [],
        recommendations: ['Ensure the LLM provider is running and accessible.'],
        riskWarnings: [],
        rawResponse: `Error: ${errMsg}`,
        latencyMs: Date.now() - start,
        timestamp: new Date(),
      };
      return errorResponse;
    }

    const latencyMs = Date.now() - start;
    console.log(`[LLM] Analysis complete in ${latencyMs}ms (${promptTokens ?? '?'} prompt + ${completionTokens ?? '?'} completion tokens)`);

    // Parse the structured response
    const parsed = this.parseResponse(rawResponse);

    const response: AnalysisResponse = {
      id: uuidv4(),
      type: request.type,
      provider: this.activeProvider,
      model: config.model,
      ...parsed,
      rawResponse,
      promptTokens,
      completionTokens,
      latencyMs,
      timestamp: new Date(),
    };

    // Store in history
    this.analysisHistory.unshift(response);
    if (this.analysisHistory.length > this.maxHistory) {
      this.analysisHistory.pop();
    }

    return response;
  }

  /**
   * Get analysis history
   */
  getHistory(limit = 10): AnalysisResponse[] {
    return this.analysisHistory.slice(0, limit);
  }

  /**
   * Clear analysis history
   */
  clearHistory(): void {
    this.analysisHistory = [];
  }

  // ─── Provider-Specific Calls ──────────────────────────────

  /**
   * Call Ollama local API
   */
  private async callOllama(
    system: string,
    user: string,
    config: LLMProviderConfig
  ): Promise<{ response: string; promptTokens?: number; completionTokens?: number }> {
    const res = await fetchWithTimeout(
      `${config.baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          system,
          prompt: user,
          stream: false,
          options: {
            temperature: config.temperature ?? 0.3,
            num_predict: config.maxTokens ?? 4096,
          },
        }),
      },
      config.timeoutMs || 120_000
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const data = await res.json() as OllamaResponse;
    return {
      response: data.response,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
    };
  }

  /**
   * Call OpenAI-compatible API (DeepSeek, OpenAI, etc.)
   */
  private async callOpenAICompatible(
    system: string,
    user: string,
    config: LLMProviderConfig
  ): Promise<{ response: string; promptTokens?: number; completionTokens?: number }> {
    if (!config.apiKey) {
      throw new Error(`API key required for ${config.provider}. Set it via configure().`);
    }

    const res = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: config.temperature ?? 0.3,
          max_tokens: config.maxTokens ?? 4096,
        }),
      },
      config.timeoutMs || 60_000
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${config.provider} error ${res.status}: ${text}`);
    }

    const data = await res.json() as OpenAICompatibleResponse;
    return {
      response: data.choices[0]?.message?.content || '',
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  }

  // ─── Response Parsing ─────────────────────────────────────

  /**
   * Parse the structured markdown response into sections
   */
  private parseResponse(raw: string): Pick<AnalysisResponse, 'summary' | 'strengths' | 'weaknesses' | 'recommendations' | 'riskWarnings'> {
    const sections = {
      summary: '',
      strengths: [] as string[],
      weaknesses: [] as string[],
      recommendations: [] as string[],
      riskWarnings: [] as string[],
    };

    // Extract sections by header
    const sectionMap: Record<string, keyof typeof sections> = {
      'summary': 'summary',
      'strengths': 'strengths',
      'weaknesses': 'weaknesses',
      'recommendations': 'recommendations',
      'risk warnings': 'riskWarnings',
      'risk': 'riskWarnings',
    };

    // Split by markdown headers
    const headerRegex = /^##\s+(.+)$/gm;
    const parts: Array<{ name: string; content: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = headerRegex.exec(raw)) !== null) {
      if (parts.length > 0) {
        parts[parts.length - 1].content = raw.slice(lastIndex, match.index).trim();
      }
      parts.push({ name: match[1].toLowerCase().trim(), content: '' });
      lastIndex = match.index + match[0].length;
    }
    if (parts.length > 0) {
      parts[parts.length - 1].content = raw.slice(lastIndex).trim();
    }

    // Map parsed sections to our structure
    for (const part of parts) {
      const key = sectionMap[part.name];
      if (!key) continue;

      if (key === 'summary') {
        sections.summary = part.content;
      } else {
        // Parse bullet points
        sections[key] = part.content
          .split('\n')
          .map(line => line.replace(/^[-*•]\s*/, '').trim())
          .filter(line => line.length > 0);
      }
    }

    // Fallback: if no sections were parsed, use raw as summary
    if (!sections.summary && parts.length === 0) {
      sections.summary = raw.slice(0, 500);
    }

    return sections;
  }
}


/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}
