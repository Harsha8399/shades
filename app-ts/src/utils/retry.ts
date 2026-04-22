/**
 * Retry Utility
 * 
 * Provides retry logic with exponential backoff for API calls
 * and transient failures.
 */

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
  retryableErrors?: string[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  exponentialBase: 2,
  retryableErrors: [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'socket hang up',
    'network error',
    'timeout',
    'rate limit',
    'too many requests',
  ],
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: Error, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();
  
  for (const pattern of config.retryableErrors || []) {
    if (errorMessage.includes(pattern.toLowerCase()) || errorName.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  
  // Check for network-related errors
  const errorCode = (error as any).code;
  if (errorCode && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'].includes(errorCode)) {
    return true;
  }
  
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  // Exponential backoff
  const exponentialDelay = config.baseDelayMs * Math.pow(config.exponentialBase, attempt);
  
  // Add jitter (0-50% of delay)
  const jitter = Math.random() * 0.5 * exponentialDelay;
  
  // Cap at max delay
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      const result = await fn();
      
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
      
    } catch (error: any) {
      lastError = error;
      
      // Log retry attempt
      console.warn(`[Retry] Attempt ${attempt + 1}/${fullConfig.maxRetries + 1} failed: ${error.message}`);
      
      // Check if we should retry
      if (attempt < fullConfig.maxRetries && isRetryableError(error, fullConfig)) {
        const delay = calculateDelay(attempt, fullConfig);
        console.warn(`[Retry] Waiting ${delay}ms before retry...`);
        await sleep(delay);
      } else {
        // Non-retryable error or max retries reached
        break;
      }
    }
  }
  
  return {
    success: false,
    error: lastError,
    attempts: fullConfig.maxRetries + 1,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Retry decorator for class methods
 */
export function withRetry(config: Partial<RetryConfig> = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const result = await retry(() => originalMethod.apply(this, args), config);
      
      if (!result.success) {
        throw result.error;
      }
      
      return result.result;
    };
    
    return descriptor;
  };
}

/**
 * Circuit breaker states
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker for preventing repeated failures
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;
  
  constructor(
    private failureThreshold: number = 5,
    private resetTimeoutMs: number = 60000,
    private halfOpenSuccessThreshold: number = 3
  ) {}
  
  /**
   * Execute function through circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      // Check if timeout has passed
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('[CircuitBreaker] Transitioning to HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }
    
    try {
      const result = await fn();
      
      // Success
      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= this.halfOpenSuccessThreshold) {
          this.state = 'CLOSED';
          this.failureCount = 0;
          console.log('[CircuitBreaker] Transitioning to CLOSED');
        }
      } else {
        this.failureCount = 0;  // Reset on success
      }
      
      return result;
      
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        console.error(`[CircuitBreaker] Circuit OPEN after ${this.failureCount} failures`);
      }
      
      throw error;
    }
  }
  
  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }
  
  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
  }
}

/**
 * Rate limiter to prevent API throttling
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number = Date.now();
  
  constructor(
    private maxTokens: number = 10,
    private refillRatePerSecond: number = 1
  ) {
    this.tokens = maxTokens;
  }
  
  /**
   * Acquire a token (wait if necessary)
   */
  async acquire(): Promise<void> {
    this.refill();
    
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    
    // Calculate wait time for next token
    const waitTime = 1000 / this.refillRatePerSecond;
    await sleep(waitTime);
    
    this.refill();
    this.tokens--;
  }
  
  /**
   * Try to acquire a token (don't wait)
   */
  tryAcquire(): boolean {
    this.refill();
    
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    
    return false;
  }
  
  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRatePerSecond;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
  
  /**
   * Get available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export default { retry, isRetryableError, CircuitBreaker, RateLimiter };

