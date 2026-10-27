// ATR calculations (custom implementation)
export {
  calculateATR,
  calculateTrueRange,
  calculateATRPercent,
  getVolatilityRegime,
} from './atr';

// Volume analysis
export {
  VolumeClassification,
  VolumeTrend,
  VolumeAnalysis,
  VolumeConfig,
  DEFAULT_VOLUME_CONFIG,
  analyzeVolume,
  isBreakoutConfirmed,
  isRejectionConfirmed,
  getVolumeSignal,
  getVolumeSummary,
} from './volume';

// Technical indicators using technicalindicators library
export {
  calculateATR_TI,
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateADX,
  getCurrentATR,
  getCurrentRSI,
  isOverbought,
  isOversold,
} from './technical';

// Swing point detection
export {
  BasicSwingPoint,
  findSwingPoints,
  findRecentSwingHigh,
  findRecentSwingLow,
  detectTrend,
} from './swingPoints';

// Support/Resistance zones
export {
  SRZone,
  findSRZones,
  isPriceAtZone,
  findNearestSupport,
  findNearestResistance,
} from './supportResistance';

// Trendlines
export {
  Trendline,
  findTrendlines,
  getTrendlinePrice,
  isPriceAtTrendline,
  projectTrendline,
  TRENDLINE_MIN_TOUCHES,
} from './trendlines';

// Fibonacci
export {
  FibLevel,
  FibRetracement,
  FIB_RATIOS,
  calculateFibLevels,
  findFibRetracement,
  isPriceAtFibLevel,
  getKeyFibLevels,
  calculateFibExtensions,
} from './fibonacci';

