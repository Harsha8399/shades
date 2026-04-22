// Pattern exports
export { BasePattern } from './BasePattern';
export { ConfluenceZonePattern } from './ConfluenceZonePattern';
export { TrendlineBreakPattern } from './TrendlineBreakPattern';
export { FibPullbackPattern } from './FibPullbackPattern';
export { SRRetestPattern } from './SRRetestPattern';

// Register all patterns
import { PatternRegistry } from '../core/PatternRegistry';
import { ConfluenceZonePattern } from './ConfluenceZonePattern';
import { TrendlineBreakPattern } from './TrendlineBreakPattern';
import { FibPullbackPattern } from './FibPullbackPattern';
import { SRRetestPattern } from './SRRetestPattern';

/**
 * Register all built-in patterns
 */
export function registerAllPatterns(): void {
  const registry = PatternRegistry.getInstance();
  
  // Register all patterns
  registry.register(new ConfluenceZonePattern());
  registry.register(new TrendlineBreakPattern());
  registry.register(new FibPullbackPattern());
  registry.register(new SRRetestPattern());
  
  console.log(`Registered ${registry.count()} patterns`);
}

