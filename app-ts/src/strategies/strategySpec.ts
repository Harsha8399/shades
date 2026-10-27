/**
 * Loader for the canonical strategy specification.
 *
 * The specification lives in `shared/fixtures/strategy_spec.json` and is the
 * single source of truth for every strategy parameter. This module exposes it
 * read-only; it does NOT become a second copy of the values.
 *
 * Usage:
 *   import { getSpec } from '../strategies/strategySpec';
 *   const spec = getSpec();
 *   spec.value('MIN_CONFLUENCE_FACTORS');   // -> 2
 *   spec.provenance('MIN_CONFLUENCE_FACTORS'); // -> 'book'
 */
import * as fs from 'fs';
import * as path from 'path';

export const SPEC_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'fixtures',
  'strategy_spec.json'
);

export const VALID_PROVENANCE = ['book', 'inferred', 'invented'] as const;
export type Provenance = (typeof VALID_PROVENANCE)[number];

export class StrategySpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategySpecError';
  }
}

export interface SpecParameter {
  id: string;
  name: string;
  purpose: string;
  value: any;
  type: string;
  range?: any;
  provenance: Provenance;
  pdf_page: number | null;
  pdf_passage: string | null;
  rationale: string;
  status: string;
  configurable: boolean;
  consumers: string[];
  tests: string[];
}

export interface SpecDivergence {
  id: string;
  parameter: string;
  python: any;
  typescript: any;
  severity: string;
  detail: string;
  resolution_stage: number;
}

export interface SpecAmbiguity {
  id: string;
  topic: string;
  book_position: string;
  proposed_interpretation: string;
  affects: string[];
  resolution_stage: number;
}

/**
 * Read-only view over the canonical strategy specification.
 */
export class StrategySpec {
  private readonly data: any;
  private readonly params: Map<string, SpecParameter>;

  constructor(data: any) {
    this.data = data;
    this.params = new Map<string, SpecParameter>();
    for (const p of (data.parameters ?? []) as SpecParameter[]) {
      this.params.set(p.id, p);
    }
    this.validate();
  }

  /** Load and validate the specification from disk. */
  static load(specPath: string = SPEC_PATH): StrategySpec {
    if (!fs.existsSync(specPath)) {
      throw new StrategySpecError(`Strategy spec not found: ${specPath}`);
    }
    const data = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    return new StrategySpec(data);
  }

  /**
   * Structural validation of the specification itself.
   *
   * A parameter tagged 'book' must cite a page and a passage; one tagged
   * 'inferred' or 'invented' must carry a rationale.
   */
  private validate(): void {
    for (const key of ['spec_id', 'spec_version', 'parameters', 'provenance_values']) {
      if (!(key in this.data)) {
        throw new StrategySpecError(`Spec is missing required key: ${key}`);
      }
    }

    const seen = new Set<string>();
    for (const p of (this.data.parameters ?? []) as SpecParameter[]) {
      for (const key of [
        'id', 'name', 'purpose', 'value', 'type', 'provenance',
        'rationale', 'status', 'configurable', 'consumers', 'tests',
      ]) {
        if (!(key in p)) {
          throw new StrategySpecError(
            `Parameter '${p.id ?? '<unknown>'}' is missing '${key}'`
          );
        }
      }

      if (seen.has(p.id)) {
        throw new StrategySpecError(`Duplicate parameter id: ${p.id}`);
      }
      seen.add(p.id);

      if (!VALID_PROVENANCE.includes(p.provenance)) {
        throw new StrategySpecError(
          `Parameter '${p.id}' has invalid provenance '${p.provenance}'. ` +
          `Expected one of ${VALID_PROVENANCE.join(', ')}.`
        );
      }

      if (p.provenance === 'book' && (!p.pdf_page || !p.pdf_passage)) {
        throw new StrategySpecError(
          `Parameter '${p.id}' is tagged 'book' but has no PDF page and/or passage.`
        );
      }

      if (p.provenance === 'inferred' && !p.rationale) {
        throw new StrategySpecError(
          `Parameter '${p.id}' is tagged 'inferred' but has no rationale.`
        );
      }

      if (p.provenance === 'invented' && !(p.rationale && p.status)) {
        throw new StrategySpecError(
          `Parameter '${p.id}' is tagged 'invented' but lacks a rationale ` +
          `and/or explicit status.`
        );
      }
    }

    this.validateDivergences();
    this.validateAmbiguities();
  }

  /**
   * Every divergence must carry a valid status and name a real parameter.
   */
  private validateDivergences(): void {
    const conventions = (this.data as any).status_conventions?.divergence_status ?? {};
    const valid = Object.keys(conventions).length
      ? Object.keys(conventions)
      : ['resolved', 'open', 'deferred'];

    const paramIds = new Set(
      ((this.data.parameters ?? []) as SpecParameter[]).map((p) => p.id)
    );
    const seen = new Set<string>();

    for (const d of (this.data.engine_divergences ?? []) as any[]) {
      const id = d.id ?? '<unknown>';

      if (seen.has(id)) {
        throw new StrategySpecError(`Duplicate divergence id: ${id}`);
      }
      seen.add(id);

      if (!valid.includes(d.status)) {
        throw new StrategySpecError(
          `Divergence '${id}' has invalid status '${d.status}'. ` +
          `Expected one of ${valid.join(', ')}.`
        );
      }

      if (!paramIds.has(d.parameter)) {
        throw new StrategySpecError(
          `Divergence '${id}' names parameter '${d.parameter}' which does not exist.`
        );
      }
    }
  }

  /**
   * Every ambiguity must carry a valid status, record the book position and
   * the proposed interpretation, and name real parameters.
   */
  private validateAmbiguities(): void {
    const conventions = (this.data as any).status_conventions?.ambiguity_status ?? {};
    const valid = Object.keys(conventions).length
      ? Object.keys(conventions)
      : ['open', 'resolved'];

    const paramIds = new Set(
      ((this.data.parameters ?? []) as SpecParameter[]).map((p) => p.id)
    );
    const seen = new Set<string>();

    for (const a of (this.data.ambiguities_in_the_book ?? []) as any[]) {
      const id = a.id ?? '<unknown>';

      if (seen.has(id)) {
        throw new StrategySpecError(`Duplicate ambiguity id: ${id}`);
      }
      seen.add(id);

      if (!valid.includes(a.status)) {
        throw new StrategySpecError(
          `Ambiguity '${id}' has invalid status '${a.status}'. ` +
          `Expected one of ${valid.join(', ')}.`
        );
      }

      if (!a.book_position || !a.proposed_interpretation) {
        throw new StrategySpecError(
          `Ambiguity '${id}' must record both the book position and the ` +
          `proposed interpretation.`
        );
      }

      for (const affected of a.affects ?? []) {
        if (!paramIds.has(affected)) {
          throw new StrategySpecError(
            `Ambiguity '${id}' names parameter '${affected}' which does not exist.`
          );
        }
      }
    }
  }

  value<T = any>(paramId: string): T {
    return this.require(paramId).value as T;
  }

  provenance(paramId: string): Provenance {
    return this.require(paramId).provenance;
  }

  pdfPage(paramId: string): number | null {
    return this.require(paramId).pdf_page ?? null;
  }

  pdfPassage(paramId: string): string | null {
    return this.require(paramId).pdf_passage ?? null;
  }

  status(paramId: string): string {
    return this.require(paramId).status;
  }

  consumers(paramId: string): string[] {
    return [...this.require(paramId).consumers];
  }

  parameter(paramId: string): SpecParameter {
    return { ...this.require(paramId) };
  }

  parameters(): Record<string, SpecParameter> {
    const out: Record<string, SpecParameter> = {};
    for (const [k, v] of this.params) out[k] = { ...v };
    return out;
  }

  parameterIds(): string[] {
    return (this.data.parameters ?? []).map((p: SpecParameter) => p.id);
  }

  divergences(): SpecDivergence[] {
    return [...(this.data.engine_divergences ?? [])];
  }

  ambiguities(): SpecAmbiguity[] {
    return [...(this.data.ambiguities_in_the_book ?? [])];
  }

  metadata(): Record<string, any> {
    return {
      spec_id: this.data.spec_id,
      spec_version: this.data.spec_version,
      schema_version: this.data.$schema_version,
      title: this.data.title,
      authority: this.data.authority ?? {},
    };
  }

  private require(paramId: string): SpecParameter {
    const p = this.params.get(paramId);
    if (!p) {
      throw new StrategySpecError(`Unknown strategy parameter: ${paramId}`);
    }
    return p;
  }
}

let cached: StrategySpec | null = null;

/** Return the cached specification, loading it on first use. */
export function getSpec(): StrategySpec {
  if (cached === null) {
    cached = StrategySpec.load();
  }
  return cached;
}
