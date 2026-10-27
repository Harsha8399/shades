/**
 * Spec-drift guard (T20) for the MTF / confluence constants.
 *
 * These values are marked `configurable: true` in shared/fixtures/strategy_spec.json.
 * Every one of them used to be re-literalized at its call site, so a change to
 * the spec (or to one site) silently left the rest -- and the other engine --
 * on the old value. Each assertion below pins a code constant to the canonical
 * spec value; changing either side without the other now fails a test.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getSpec, SPEC_PATH } from '../src/strategies/strategySpec';
import { getHigherTimeframe } from '../src/core/CandleResampler';
import { TIMEFRAME_HIERARCHY } from '../src/types/mtf';
import { Timeframe } from '../src/types';
import {
  DEFAULT_SWING_LEFT_BARS,
  DEFAULT_SWING_RIGHT_BARS,
  DEFAULT_TOLERANCE_ATR,
  DEFAULT_MIN_TOUCHES,
} from '../src/indicators/mtfTrendlines';
import {
  TRENDLINE_TOLERANCE_ATR,
  SR_ZONE_TOLERANCE_ATR,
  SR_MIN_TOUCHES,
  MIN_TARGET_RR,
} from '../src/patterns/ConfluenceZonePattern';

const spec = getSpec();

describe('spec drift guard: MTF trendline extractor defaults', () => {
  it('extractor swing/tolerance defaults equal the spec', () => {
    expect(DEFAULT_SWING_LEFT_BARS).toBe(spec.value('SWING_LEFT_BARS'));
    expect(DEFAULT_SWING_RIGHT_BARS).toBe(spec.value('SWING_RIGHT_BARS'));
    expect(DEFAULT_TOLERANCE_ATR).toBeCloseTo(spec.value('TRENDLINE_TOLERANCE_ATR'), 9);
    expect(DEFAULT_MIN_TOUCHES).toBe(spec.value('TRENDLINE_MIN_TOUCHES'));
  });
});

describe('spec drift guard: timeframe hierarchy', () => {
  const specHierarchy: Record<string, string> = spec.value('MTF_TIMEFRAME_HIERARCHY');

  it('getHigherTimeframe matches MTF_TIMEFRAME_HIERARCHY for every entry timeframe', () => {
    for (const [ltf, htf] of Object.entries(specHierarchy)) {
      expect(getHigherTimeframe(ltf as any)).toBe(htf);
    }
  });

  it('TIMEFRAME_HIERARCHY (types/mtf.ts) matches MTF_TIMEFRAME_HIERARCHY for every entry timeframe', () => {
    for (const [ltf, htf] of Object.entries(specHierarchy)) {
      // TIMEFRAME_HIERARCHY is Record<Timeframe, Timeframe>; ltf is a valid Timeframe string
      expect(TIMEFRAME_HIERARCHY[ltf as Timeframe]).toBe(htf);
    }
  });
});

describe('spec drift guard: confluence zone constants', () => {
  it('TRENDLINE_TOLERANCE_ATR equals the spec', () => {
    expect(TRENDLINE_TOLERANCE_ATR).toBeCloseTo(spec.value('TRENDLINE_TOLERANCE_ATR'), 9);
  });

  it('SR_ZONE_TOLERANCE_ATR and SR_MIN_TOUCHES equal the spec', () => {
    expect(SR_ZONE_TOLERANCE_ATR).toBeCloseTo(spec.value('SR_ZONE_TOLERANCE_ATR'), 9);
    expect(SR_MIN_TOUCHES).toBe(spec.value('SR_MIN_TOUCHES'));
  });

  it('MIN_TARGET_RR equals the spec', () => {
    expect(MIN_TARGET_RR).toBeCloseTo(spec.value('MIN_TARGET_RR'), 9);
  });
});

describe('spec drift guard: AMB-08 timeframe hierarchy mapping', () => {
  const specHierarchy: Record<string, string> = spec.value('MTF_TIMEFRAME_HIERARCHY');
  const amb08 = spec.ambiguities().find((a) => a.id === 'AMB-08')!;

  it('records AMB-08 as open with correct affected parameters', () => {
    expect(amb08).toBeDefined();
    // Access status from raw spec data since interface doesn't include it yet
    const rawData = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    const rawAmb08 = rawData.ambiguities_in_the_book.find((a: any) => a.id === 'AMB-08');
    expect(rawAmb08.status).toBe('open');
    expect(amb08.affects).toContain('STOP_LOSS_RULE');
    expect(amb08.affects).toContain('MTF_TIMEFRAME_HIERARCHY');
    expect(amb08.affects).toContain('HTF_COMPLETION');
    expect(amb08.affects).toContain('STOP_LEVEL_COMBINATION');
  });

  it('documents mapping provenance as inferred, not book', () => {
    const param = spec.parameter('MTF_TIMEFRAME_HIERARCHY');
    expect(param.provenance).toBe('inferred');
    expect(param.pdf_page).toBe(9);
    expect(param.rationale).toContain('interpretation');
  });

  it('maps each entry timeframe to a strictly higher timeframe', () => {
    const tfMinutes: Record<string, number> = {
      '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080,
    };
    for (const [ltf, htf] of Object.entries(specHierarchy)) {
      expect(tfMinutes[htf]).toBeGreaterThan(tfMinutes[ltf]);
    }
  });

  it('maps 5m to 1h (not 15m) per spec interpretation', () => {
    expect(specHierarchy['5m']).toBe('1h');
  });

  it('maps both 15m and 1h to 4h per spec interpretation', () => {
    expect(specHierarchy['15m']).toBe('4h');
    expect(specHierarchy['1h']).toBe('4h');
  });

  it('maps 4h to 1d and 1d to 1w per spec interpretation', () => {
    expect(specHierarchy['4h']).toBe('1d');
    expect(specHierarchy['1d']).toBe('1w');
  });
});

describe('spec drift guard: HTF completed-candle invariant', () => {
  it('HTF_COMPLETION parameter enforces completed_htf_only', () => {
    const param = spec.parameter('HTF_COMPLETION');
    expect(param.value).toBe('completed_htf_only');
    expect(param.provenance).toBe('inferred');
  });

  it('HTF_SWING_PARAMS reuses entry timeframe parameters', () => {
    const param = spec.parameter('HTF_SWING_PARAMS');
    expect(param.value).toBe('reuse_entry_timeframe');
    expect(param.provenance).toBe('inferred');
  });

  it('HTF_TRENDLINE_MISSING_BEHAVIOUR rejects signal when trendline unavailable', () => {
    const param = spec.parameter('HTF_TRENDLINE_MISSING_BEHAVIOUR');
    expect(param.value).toBe('reject_signal');
    expect(param.provenance).toBe('inferred');
  });
});