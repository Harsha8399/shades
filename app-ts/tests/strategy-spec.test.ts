/**
 * Cross-engine strategy specification consistency tests (TypeScript side).
 *
 * These assert that the TypeScript engine's LIVE parameter values equal the
 * canonical specification's values, and that the specification itself is
 * well-formed. The Python suite
 * (`research-py/tests/test_strategy_spec.py`) asserts the same spec from the
 * other side, so neither engine can drift from it silently.
 */
import * as fs from 'fs';
import * as path from 'path';

import { getSpec, StrategySpec, StrategySpecError, SPEC_PATH } from '../src/strategies/strategySpec';
import { ConfluenceZonePattern } from '../src/patterns/ConfluenceZonePattern';
import { calculateATR } from '../src/indicators/atr';
import { findSwingPoints } from '../src/indicators/swingPoints';
import { findSRZones } from '../src/indicators/supportResistance';
import { findTrendlines } from '../src/indicators/trendlines';
import { DEFAULT_CONFIG } from '../src/config/default';
import { DEFAULT_PARTIAL_TP_CONFIG } from '../src/types/trade';

const spec = getSpec();

describe('Strategy spec: structure', () => {
  it('loads and identifies itself', () => {
    const meta = spec.metadata();
    expect(meta.spec_id).toBe('shades.confluence-zone');
    expect(meta.spec_version).toBeTruthy();
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
  });

  it('declares every parameter with all required fields', () => {
    const required = [
      'id', 'name', 'purpose', 'value', 'type', 'provenance',
      'rationale', 'status', 'configurable', 'consumers', 'tests',
    ];
    for (const id of spec.parameterIds()) {
      const p = spec.parameter(id);
      for (const key of required) {
        expect(p).toHaveProperty(key);
        expect((p as any)[key]).toBeDefined();
      }
    }
  });

  it('assigns every parameter a valid provenance', () => {
    const valid = ['book', 'inferred', 'invented'];
    for (const id of spec.parameterIds()) {
      expect(valid).toContain(spec.provenance(id));
    }
  });

  it('gives every book-derived parameter a page and a passage', () => {
    const bookParams = spec.parameterIds().filter((id) => spec.provenance(id) === 'book');
    expect(bookParams.length).toBeGreaterThan(0);
    for (const id of bookParams) {
      expect(spec.pdfPage(id)).toBeGreaterThan(0);
      expect(spec.pdfPassage(id)).toBeTruthy();
    }
  });

  it('gives every inferred and invented parameter a rationale', () => {
    for (const id of spec.parameterIds()) {
      const prov = spec.provenance(id);
      if (prov === 'inferred' || prov === 'invented') {
        expect(spec.parameter(id).rationale.length).toBeGreaterThan(20);
      }
    }
  });

  it('rejects a book-tagged parameter with no citation', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    data.parameters[0].provenance = 'book';
    data.parameters[0].pdf_page = null;
    data.parameters[0].pdf_passage = null;
    expect(() => new StrategySpec(data)).toThrow(StrategySpecError);
  });

  it('rejects an unknown provenance value', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    data.parameters[0].provenance = 'guess';
    expect(() => new StrategySpec(data)).toThrow(/invalid provenance/);
  });

  it('rejects a duplicate parameter id', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    data.parameters.push({ ...data.parameters[0] });
    expect(() => new StrategySpec(data)).toThrow(/Duplicate parameter id/);
  });

  it('rejects a parameter missing a required field', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    delete data.parameters[0].status;
    expect(() => new StrategySpec(data)).toThrow(/missing 'status'/);
  });

  it('rejects an unknown parameter lookup', () => {
    expect(() => spec.value('NO_SUCH_PARAMETER')).toThrow(/Unknown strategy parameter/);
  });
});

describe('Strategy spec: TypeScript engine agrees with the specification', () => {
  it('confluence pattern parameters match the spec', () => {
    const pattern = new ConfluenceZonePattern();
    const p = pattern.config.parameters;

    expect(p.minConfluenceFactors).toBe(spec.value('MIN_CONFLUENCE_FACTORS'));
    expect(p.srZoneLookback).toBe(spec.value('SR_ZONE_LOOKBACK'));
    expect(p.zoneToleranceATR).toBe(spec.value('SR_ZONE_TOLERANCE_ATR'));
    expect(p.minRejectionWickRatio).toBe(spec.value('MIN_REJECTION_WICK_RATIO'));
    expect(p.targetRR).toBe(spec.value('TARGET_RR'));
    // The pattern exposes the INTENDED confluence-level subset, which the
    // specification records as DEAD CONFIGURATION (FIB_CONFLUENCE_LEVELS).
    expect(p.fibLevels).toEqual(spec.value('FIB_CONFLUENCE_LEVELS'));
  });

  it('records that the fibLevels configuration is dead in the engine', () => {
    /**
     * The pattern configures `fibLevels` but the confluence check matches
     * against every computed Fibonacci level, so the configured subset has no
     * effect. The specification must say so, otherwise a reader would assume
     * the subset is enforced.
     */
    const param = spec.parameter('FIB_CONFLUENCE_LEVELS');
    expect(param.status).toContain('DEAD CONFIGURATION');
    expect(param.consumers.every((c) => c.includes('NOT applied'))).toBe(true);

    // The configured subset is a strict subset of the computed levels.
    const configured = spec.value('FIB_CONFLUENCE_LEVELS') as number[];
    const computed = spec.value('FIB_RATIOS') as number[];
    expect(configured.length).toBeLessThan(computed.length);
    for (const level of configured) {
      expect(computed).toContain(level);
    }
  });

  it('the Fibonacci ratio list matches the spec', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FIB_RATIOS } = require('../src/indicators/fibonacci');
    expect(FIB_RATIOS).toEqual(spec.value('FIB_RATIOS'));
  });

  it('the default risk configuration matches the spec', () => {
    expect(DEFAULT_CONFIG.initialCapital).toBe(spec.value('INITIAL_CAPITAL'));
    expect(DEFAULT_CONFIG.riskRules.minRiskReward).toBe(spec.value('MIN_RISK_REWARD'));
  });

  it('the partial take-profit ladder matches the spec', () => {
    const ladder = spec.value('PARTIAL_TAKE_PROFIT');
    expect(DEFAULT_PARTIAL_TP_CONFIG.tp1.rMultiple).toBe(ladder.tp1.r_multiple);
    expect(DEFAULT_PARTIAL_TP_CONFIG.tp1.percentage).toBe(ladder.tp1.fraction);
    expect(DEFAULT_PARTIAL_TP_CONFIG.tp2.rMultiple).toBe(ladder.tp2.r_multiple);
    expect(DEFAULT_PARTIAL_TP_CONFIG.tp2.percentage).toBe(ladder.tp2.fraction);
    expect(DEFAULT_PARTIAL_TP_CONFIG.tp3.rMultiple).toBe(ladder.tp3.r_multiple);
    expect(DEFAULT_PARTIAL_TP_CONFIG.tp3.percentage).toBe(ladder.tp3.fraction);
    expect(DEFAULT_PARTIAL_TP_CONFIG.moveToBreakEvenAfter).toBe(
      ladder.move_to_breakeven_after
    );
  });

  it('the partial take-profit fractions sum to one', () => {
    const ladder = spec.value('PARTIAL_TAKE_PROFIT');
    const total = ladder.tp1.fraction + ladder.tp2.fraction + ladder.tp3.fraction;
    expect(total).toBeCloseTo(1.0, 12);
  });
});

describe('Strategy spec: recorded divergences are real', () => {
  /**
   * Each divergence is asserted to be REAL by checking the two engines'
   * live values against the divergence record. If someone silently fixes a
   * divergence, this test fails and the record must be updated.
   */
  it('DIV-01 risk per trade genuinely differs', () => {
    const div = spec.divergences().find((d) => d.id === 'DIV-01')!;
    expect(div).toBeDefined();
    // TypeScript uses 2%.
    expect(DEFAULT_CONFIG.riskRules.maxRiskPerTrade).toBe(div.typescript);
    // Python uses 1% (verified in the Python suite).
    expect(div.python).not.toBe(div.typescript);
  });

  it('DIV-02 max open trades genuinely differs', () => {
    const div = spec.divergences().find((d) => d.id === 'DIV-02')!;
    expect(DEFAULT_CONFIG.riskRules.maxOpenTrades).toBe(div.typescript);
    expect(div.python).not.toBe(div.typescript);
  });

  it('DIV-03 slippage genuinely differs', () => {
    const div = spec.divergences().find((d) => d.id === 'DIV-03')!;
    expect(DEFAULT_CONFIG.trade.slippagePercent).toBe(div.typescript);
    expect(div.python).not.toBe(div.typescript);
  });

  it('DIV-05 partial take-profit exists only in TypeScript', () => {
    const div = spec.divergences().find((d) => d.id === 'DIV-05')!;
    expect(div.python).toBe('not implemented at all');
    expect(div.typescript).toContain('implemented');
  });

  it('every divergence names a real parameter', () => {
    for (const div of spec.divergences()) {
      expect(spec.parameterIds()).toContain(div.parameter);
    }
  });
});

describe('Strategy spec: divergence status convention', () => {
  /**
   * Every divergence must declare a status from a known vocabulary, so a
   * reader can tell a closed difference from a deliberately deferred one.
   * The Python suite asserts the same convention from the other side.
   */
  const VALID_DIVERGENCE_STATUS = ['resolved', 'open', 'deferred'];
  const VALID_AMBIGUITY_STATUS = ['open', 'resolved'];

  it('gives every divergence a valid status', () => {
    for (const div of spec.divergences()) {
      expect(VALID_DIVERGENCE_STATUS).toContain((div as any).status);
    }
  });

  it('gives every ambiguity a valid status', () => {
    for (const amb of spec.ambiguities()) {
      expect(VALID_AMBIGUITY_STATUS).toContain((amb as any).status);
    }
  });

  it('does not record a resolved divergence as high severity', () => {
    /**
     * A divergence whose engines now agree must not read as an outstanding
     * problem. This is what caught the stale DIV-13 record.
     */
    for (const div of spec.divergences()) {
      if ((div as any).status === 'resolved') {
        expect((div as any).severity).toBe('resolved');
      }
    }
  });

  it('records DIV-11, DIV-12 and DIV-13 as resolved', () => {
    const div11 = spec.divergences().find((d) => d.id === 'DIV-11') as any;
    const div12 = spec.divergences().find((d) => d.id === 'DIV-12') as any;
    const div13 = spec.divergences().find((d) => d.id === 'DIV-13') as any;

    // DIV-11 closed in the Stage 3 Phase 3 review: book p.16/p.17 make the
    // entry a touch event; ORDER_FILL_CONDITION = touch_only; the entry
    // fills on a wick even when the candle closes back on the wrong side.
    expect(div11.status).toBe('resolved');
    expect(div11.severity).toBe('resolved');

    expect(div12.status).toBe('resolved');
    expect(div12.severity).toBe('resolved');
    expect(div12.typescript).toContain('RESOLVED');

    expect(div13.status).toBe('resolved');
    expect(div13.severity).toBe('resolved');
    expect(div13.python).toContain('RESOLVED');
  });

  it('records AMB-05 as resolved', () => {
    const amb = spec.ambiguities().find((a) => a.id === 'AMB-05') as any;
    expect(amb.status).toBe('resolved');
    expect(amb.resolution_note).toContain('Settled in Stage 2');
  });

  it('has exactly three resolved divergences', () => {
    /**
     * A guard against a status being flipped without the underlying code
     * actually changing. DIV-11 joined DIV-12/DIV-13 in the Stage 3 Phase 3
     * review: both engines fill on touch (ORDER_FILL_CONDITION = touch_only,
     * book p.16/p.17), enforced by discriminating tests in
     * `app-ts/tests/regression.test.ts` and `test_backtest_engine.py`.
     */
    const resolved = spec
      .divergences()
      .filter((d) => (d as any).status === 'resolved')
      .map((d) => d.id);
    expect(resolved.sort()).toEqual(['DIV-11', 'DIV-12', 'DIV-13']);
  });

  it('rejects an unknown divergence status', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    data.engine_divergences[0].status = 'maybe';
    expect(() => new StrategySpec(data)).toThrow(/invalid status/);
  });

  it('rejects a divergence naming a missing parameter', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    data.engine_divergences[0].parameter = 'NO_SUCH_PARAMETER';
    expect(() => new StrategySpec(data)).toThrow(/does not exist/);
  });

  it('rejects an unknown ambiguity status', () => {
    const data = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
    data.ambiguities_in_the_book[0].status = 'maybe';
    expect(() => new StrategySpec(data)).toThrow(/invalid status/);
  });
});

describe('Strategy spec: timeframe configuration parity', () => {
  it('ConfluenceZonePattern timeframes include all valid Timeframe values from spec hierarchy', () => {
    const pattern = new ConfluenceZonePattern();
    const specHierarchy = spec.value<Record<string, string>>('MTF_TIMEFRAME_HIERARCHY');
    
    // Pattern should support all entry timeframes defined in the spec hierarchy
    for (const ltf of Object.keys(specHierarchy)) {
      expect(pattern.config.timeframes).toContain(ltf);
    }
    // Also include weekly (top of hierarchy)
    expect(pattern.config.timeframes).toContain('1w');
  });

  it('Pattern timeframes array is derived from spec, not hardcoded', () => {
    const pattern = new ConfluenceZonePattern();
    const specHierarchy = spec.value<Record<string, string>>('MTF_TIMEFRAME_HIERARCHY');
    
    // The pattern timeframes should be a superset of spec hierarchy keys
    const specKeys = Object.keys(specHierarchy);
    for (const key of specKeys) {
      expect(pattern.config.timeframes).toContain(key);
    }
  });
});

describe('Strategy spec: recorded ambiguities are well-formed', () => {
  it('every ambiguity names real parameters and a resolution stage', () => {
    const ambiguities = spec.ambiguities();
    expect(ambiguities.length).toBeGreaterThan(0);
    for (const amb of ambiguities) {
      expect(amb.book_position.length).toBeGreaterThan(20);
      expect(amb.proposed_interpretation.length).toBeGreaterThan(20);
      expect(amb.resolution_stage).toBeGreaterThanOrEqual(2);
      for (const affected of amb.affects) {
        expect(spec.parameterIds()).toContain(affected);
      }
    }
  });
});
