/**
 * The ports, and getCapabilities as the single source of truth (#72, ADR-0006
 * as amended, ADR-0013).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { initialViewState } from '../src/core/view-state.js';
import {
  affordanceOf, anonymousIdentity, capabilitiesOf, cellAffordanceOf, embeddedEvidenceResolver,
  inMemoryAnalysisSource, inMemoryAnnotationSink, inMemoryAssertionStore, inMemoryViewStateStore,
  DEFAULT_CAPABILITIES,
} from '../src/store/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));

describe('in-memory adapters exist for every port, so nothing needs a network', () => {
  it('analysis: one-item provider that loads and writes', async () => {
    const a = relocation();
    const source = inMemoryAnalysisSource(a);
    expect((await source.getOne(a.id)).id).toBe(a.id);
    expect((await source.getList({})).total).toBe(1);
    const updated = await source.update(a.id, { title: 'Relocation, revisited' });
    expect(updated.title).toBe('Relocation, revisited');
    await expect(source.create({})).rejects.toThrow(/one-item provider/);
  });

  it('view state, threads and assertions', async () => {
    const v = inMemoryViewStateStore(initialViewState(relocation()));
    expect((await v.getOne('view-state')).id).toBe('view-state');
    const threads = inMemoryAnnotationSink(relocation().threads);
    expect((await threads.getList({})).total).toBe(relocation().threads.length);
    const created = await threads.create({ id: 't-new', anchor: { scope: 'analysis' }, comments: [] } as never);
    expect(created.id).toBe('t-new');
    const assertions = inMemoryAssertionStore();
    expect((await assertions.getList({})).total).toBe(0);
  });

  it('evidence resolves through the port, and says so when it cannot', async () => {
    const a = relocation();
    const resolver = embeddedEvidenceResolver();
    const withExcerpt = a.cells.flatMap((c) => c.assertions).flatMap((s) => s.evidence).find((e) => e.excerpt);
    expect(withExcerpt, 'the fixture should embed an excerpt').toBeDefined();
    const hit = await resolver.resolve(withExcerpt!, { analysis: a });
    expect(hit.status).toBe('embedded');
    const miss = await resolver.resolve({ ...withExcerpt!, excerpt: undefined } as never, { analysis: a });
    expect(miss.status).toBe('unresolvable');
    if (miss.status === 'unresolvable') expect(miss.reason.length).toBeGreaterThan(20);
  });

  it('identity has a usable anonymous default', async () => {
    const who = await anonymousIdentity().current();
    expect(who.id).toBe('anonymous');
    expect(who.kind).toBe('human');
  });
});

describe('every editable affordance is derived from getCapabilities', () => {
  it('flipping a capability disables the control, with a stated reason', () => {
    const a = relocation();
    const writable = inMemoryAnalysisSource(a);
    const frozen = inMemoryAnalysisSource(a, { canUpdate: false });
    expect(affordanceOf(writable, 'update')).toEqual({ enabled: true });
    const denied = affordanceOf(frozen, 'update', { what: 'this analysis' });
    expect(denied.enabled).toBe(false);
    expect(denied.reason).toMatch(/this analysis/);
    expect(denied.reason!.length).toBeGreaterThan(20);
    // Create and delete are refused by a one-item provider whatever else it allows.
    expect(affordanceOf(writable, 'create').enabled).toBe(false);
    expect(affordanceOf(writable, 'delete').reason).toBeTruthy();
  });

  it('assumes the documented defaults when a provider does not implement getCapabilities', () => {
    expect(capabilitiesOf({})).toEqual(DEFAULT_CAPABILITIES);
    expect(affordanceOf({}, 'update').enabled).toBe(DEFAULT_CAPABILITIES.canUpdate);
  });

  it('meets the document\'s own policy in one place, and nowhere else', () => {
    const a = relocation();
    const source = inMemoryAnalysisSource(a);
    expect(cellAffordanceOf(source, a, undefined)).toEqual({ enabled: true });
    expect(cellAffordanceOf(source, a, { readOnly: true })).toMatchObject({ enabled: false });
    expect(cellAffordanceOf(source, { locked: true }, undefined).reason).toMatch(/locked/);
    // The provider's answer comes first: a frozen source disables the cell
    // whatever the document says.
    const frozen = inMemoryAnalysisSource(a, { canUpdate: false });
    expect(cellAffordanceOf(frozen, a, undefined).enabled).toBe(false);
  });

  it('has no second read-only flag anywhere in the source', () => {
    // Allowed: the schema's two *policy declarations*, and the one place that
    // combines them with the provider's capability.
    const allowed = new Set([
      'src/core/schema/values.ts',   // Cell.readOnly -- a declaration in the document
      'src/core/schema/analysis.ts', // Analysis.locked -- the same
      'src/store/index.ts',          // cellAffordanceOf, where they meet capabilities
    ]);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const offenders = walk(join(root, 'src'))
      .map((f) => [relative(root, f).split('\\').join('/'), readFileSync(f, 'utf8')] as const)
      .filter(([rel]) => !allowed.has(rel))
      .filter(([, src]) => /\b(readOnly|isReadOnly|canEdit|editable)\b\s*[:=?]/.test(
        src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '),
      ))
      .map(([rel]) => rel);
    expect(offenders, 'editability has one source of truth: getCapabilities, plus the document policy it meets in store/').toEqual([]);
  });
});
