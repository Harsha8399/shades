import { Pattern, PatternInfo } from '../types';

/**
 * Registry for managing pattern plugins
 */
export class PatternRegistry {
  private patterns: Map<string, Pattern> = new Map();
  private static instance: PatternRegistry | null = null;
  
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  static getInstance(): PatternRegistry {
    if (!PatternRegistry.instance) {
      PatternRegistry.instance = new PatternRegistry();
    }
    return PatternRegistry.instance;
  }
  
  /**
   * Register a pattern
   */
  register(pattern: Pattern): void {
    if (this.patterns.has(pattern.id)) {
      console.warn(`Pattern ${pattern.id} already registered, overwriting`);
    }
    this.patterns.set(pattern.id, pattern);
    console.log(`Registered pattern: ${pattern.name} (${pattern.id})`);
  }
  
  /**
   * Unregister a pattern
   */
  unregister(patternId: string): boolean {
    return this.patterns.delete(patternId);
  }
  
  /**
   * Get a pattern by ID
   */
  get(patternId: string): Pattern | undefined {
    return this.patterns.get(patternId);
  }
  
  /**
   * Get all registered patterns
   */
  getAll(): Pattern[] {
    return Array.from(this.patterns.values());
  }
  
  /**
   * Get all enabled patterns
   */
  getEnabled(): Pattern[] {
    return this.getAll().filter(p => p.config.enabled);
  }
  
  /**
   * Get patterns for a specific timeframe
   */
  getForTimeframe(timeframe: string): Pattern[] {
    return this.getEnabled().filter(p => 
      p.config.timeframes.includes(timeframe as Pattern['config']['timeframes'][number])
    );
  }
  
  /**
   * Get patterns for a specific symbol
   */
  getForSymbol(symbol: string): Pattern[] {
    return this.getEnabled().filter(p => 
      p.config.symbols.length === 0 || p.config.symbols.includes(symbol)
    );
  }
  
  /**
   * Get pattern info for all registered patterns
   */
  getPatternInfo(): PatternInfo[] {
    return this.getAll().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      requiredCandles: p.getRequiredCandleCount(),
      supportedTimeframes: p.config.timeframes,
    }));
  }
  
  /**
   * Enable a pattern
   */
  enable(patternId: string): boolean {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.config.enabled = true;
      return true;
    }
    return false;
  }
  
  /**
   * Disable a pattern
   */
  disable(patternId: string): boolean {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.config.enabled = false;
      return true;
    }
    return false;
  }
  
  /**
   * Get count of registered patterns
   */
  count(): number {
    return this.patterns.size;
  }
  
  /**
   * Clear all patterns
   */
  clear(): void {
    this.patterns.clear();
  }
}

export default PatternRegistry;

