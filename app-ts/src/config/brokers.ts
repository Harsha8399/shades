/**
 * Broker Profiles
 * 
 * Pre-configured fee structures for popular Indian brokers.
 * Users can select their broker or create custom profiles.
 */
import { MarketSegment, FeeStructure } from './indianMarket';

/**
 * Broker profile identifier
 */
export type BrokerId = 'ZERODHA' | 'ANGEL_ONE' | 'UPSTOX' | 'FYERS' | 'CUSTOM';

/**
 * Broker profile
 */
export interface BrokerProfile {
  id: BrokerId;
  name: string;
  description: string;
  equity: FeeStructure;
  fno: FeeStructure;
  mcx?: FeeStructure;
}

/**
 * Zerodha - Most popular discount broker
 */
const ZERODHA_PROFILE: BrokerProfile = {
  id: 'ZERODHA',
  name: 'Zerodha',
  description: 'Zero brokerage on equity delivery, flat Rs 20 on F&O',
  equity: {
    brokeragePercent: 0,           // Zero brokerage on delivery
    brokerageMax: 0,
    sttPercent: 0.001,            // 0.1% on sell
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000345,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00015,
    gstPercent: 0.18,
    slippagePercent: 0.001,
  },
  fno: {
    brokeragePercent: 0,
    brokerageMax: 20,              // Flat Rs 20 per order
    sttPercent: 0.0001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000190,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,
    gstPercent: 0.18,
    slippagePercent: 0.0005,
  },
};

/**
 * Angel One - Free API, competitive fees
 */
const ANGEL_ONE_PROFILE: BrokerProfile = {
  id: 'ANGEL_ONE',
  name: 'Angel One',
  description: 'Free SmartAPI, competitive brokerage rates',
  equity: {
    brokeragePercent: 0.00025,     // 0.025% (slightly lower than Zerodha for intraday)
    brokerageMax: 20,
    sttPercent: 0.001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000345,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00015,
    gstPercent: 0.18,
    slippagePercent: 0.001,
  },
  fno: {
    brokeragePercent: 0,
    brokerageMax: 20,
    sttPercent: 0.0001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000190,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,
    gstPercent: 0.18,
    slippagePercent: 0.0005,
  },
};

/**
 * Upstox - Popular discount broker
 */
const UPSTOX_PROFILE: BrokerProfile = {
  id: 'UPSTOX',
  name: 'Upstox',
  description: 'Zero brokerage on delivery, competitive F&O rates',
  equity: {
    brokeragePercent: 0,
    brokerageMax: 0,
    sttPercent: 0.001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000345,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00015,
    gstPercent: 0.18,
    slippagePercent: 0.001,
  },
  fno: {
    brokeragePercent: 0,
    brokerageMax: 20,
    sttPercent: 0.0001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000190,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,
    gstPercent: 0.18,
    slippagePercent: 0.0005,
  },
};

/**
 * Fyers - API-first broker
 */
const FYERS_PROFILE: BrokerProfile = {
  id: 'FYERS',
  name: 'Fyers',
  description: 'API-first platform, zero brokerage on delivery',
  equity: {
    brokeragePercent: 0,
    brokerageMax: 0,
    sttPercent: 0.001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000345,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00015,
    gstPercent: 0.18,
    slippagePercent: 0.001,
  },
  fno: {
    brokeragePercent: 0,
    brokerageMax: 20,
    sttPercent: 0.0001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000190,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,
    gstPercent: 0.18,
    slippagePercent: 0.0005,
  },
};

/**
 * Custom profile - user-defined
 */
const CUSTOM_PROFILE: BrokerProfile = {
  id: 'CUSTOM',
  name: 'Custom',
  description: 'User-defined fee structure',
  equity: {
    brokeragePercent: 0.0003,
    brokerageMax: 20,
    sttPercent: 0.001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000345,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00015,
    gstPercent: 0.18,
    slippagePercent: 0.001,
  },
  fno: {
    brokeragePercent: 0,
    brokerageMax: 20,
    sttPercent: 0.0001,
    sttAppliesTo: 'sell',
    exchangeTxnPercent: 0.0000190,
    sebiPercent: 0.000001,
    stampDutyPercent: 0.00002,
    gstPercent: 0.18,
    slippagePercent: 0.0005,
  },
};

/**
 * All broker profiles
 */
export const BROKER_PROFILES: Record<BrokerId, BrokerProfile> = {
  ZERODHA: ZERODHA_PROFILE,
  ANGEL_ONE: ANGEL_ONE_PROFILE,
  UPSTOX: UPSTOX_PROFILE,
  FYERS: FYERS_PROFILE,
  CUSTOM: CUSTOM_PROFILE,
};

/**
 * Get broker profile by ID
 */
export function getBrokerProfile(brokerId: BrokerId): BrokerProfile {
  return BROKER_PROFILES[brokerId] || BROKER_PROFILES.ZERODHA;
}

/**
 * Get fee structure for a broker and market segment
 */
export function getBrokerFees(brokerId: BrokerId, segment: MarketSegment): FeeStructure {
  const profile = getBrokerProfile(brokerId);
  
  switch (segment) {
    case 'NSE_EQUITY':
      return profile.equity;
    case 'NSE_FNO':
      return profile.fno;
    case 'MCX':
      return profile.mcx || profile.fno; // Fallback to FNO if MCX not defined
    default:
      return profile.equity;
  }
}

export default {
  BROKER_PROFILES,
  getBrokerProfile,
  getBrokerFees,
};

