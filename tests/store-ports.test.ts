/**
 * The ports, and getCapabilities as the single source of truth (#72, ADR-0006
 * as amended, ADR-0013).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { makeAffordances, WRITE_AFFORDANCES, type Affordance, type Affordances } from '../src/core/affordances.js';
import {
  affordanceOf, anonymousIdentity, capabilitiesOf, cellAffordanceOf, editAffordances, embeddedEvidenceResolver,
  inMemoryAnalysisSource, oneItemProvider, writeSafety, DEFAULT_CAPABILITIES,
  type DataChangeEvent, type ProviderCapabilities,
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

  it('one more one-item provider is all the other roles cost, when they arrive', async () => {
    // ADR-0006's 2026-08-22 amendment: v1 builds one port. The others are the
    // same shape over their own document when a second implementation exists.
    const p = oneItemProvider({ id: 'view-state', kept: 1 });
    expect((await p.getOne('view-state')).kept).toBe(1);
    expect((await p.update('view-state', { kept: 2 })).kept).toBe(2);
    await expect(p.getOne('other')).rejects.toThrow(/no item with id/);
  });

  it('evidence resolves through the port, and says so when it cannot', async () => {
    const a = relocation();
    const resolver = embeddedEvidenceResolver();
    const withRendition = a.cells.flatMap((c) => c.assertions).flatMap((s) => s.evidence)
      .find((e) => e.excerpt && e.renditionId);
    expect(withRendition, 'the fixture should embed an excerpt with a rendition').toBeDefined();
    const hit = await resolver.resolve(withRendition!, { analysis: a, now: new Date('2026-09-22T00:00:00Z') });
    expect(hit.status).toBe('from-excerpt');
    if (hit.status === 'from-excerpt') {
      expect(hit.rendition?.id).toBe(withRendition!.renditionId);
      expect(hit.standing).toBeDefined();
    }
    const miss = await resolver.resolve({ ...withRendition!, excerpt: undefined } as never, { analysis: a });
    expect(miss.status).toBe('unresolvable');
    if (miss.status === 'unresolvable') expect(miss.reason.length).toBeGreaterThan(20);
  });

  it('never renders a stale or unlocatable quote as a live one (ADR-0014)', async () => {
    const a = relocation();
    const resolver = embeddedEvidenceResolver();
    const stale = a.cells.flatMap((c) => c.assertions).flatMap((s) => s.evidence)
      .find((e) => e.excerpt && e.check && e.check.status !== 'exact');
    expect(stale, 'the fixture should carry a failed check').toBeDefined();
    const shown = await resolver.resolve(stale!, { analysis: a, now: new Date('2026-09-22T00:00:00Z') });
    if (shown.status !== 'from-excerpt') throw new Error('expected the excerpt to be shown with caveats');
    expect(shown.caveats.join(' ')).toMatch(new RegExp(stale!.check!.status));
    expect(shown.caveats.join(' ').length).toBeGreaterThan(20);

    // And a check whose source has moved on says that too.
    const drifted = a.cells.flatMap((c) => c.assertions).flatMap((s) => s.evidence)
      .find((e) => e.excerpt && e.check?.originalDrifted);
    const shownDrifted = await resolver.resolve(drifted!, { analysis: a, now: new Date('2026-09-22T00:00:00Z') });
    if (shownDrifted.status !== 'from-excerpt') throw new Error('expected the excerpt to be shown');
    expect(shownDrifted.standing.sourceChanged).toBe(true);
    expect(shownDrifted.caveats.join(' ')).toMatch(/changed since it was ingested/);

    // A reference pointing at a rendition this document does not carry: the
    // quote cannot be located in its source, and the reader is told.
    const dangling = await resolver.resolve(
      { ...stale!, renditionId: 'no-such-rendition' } as never,
      { analysis: a, now: new Date('2026-09-22T00:00:00Z') },
    );
    if (dangling.status !== 'from-excerpt') throw new Error('expected the excerpt to be shown with caveats');
    expect(dangling.rendition).toBeUndefined();
    expect(dangling.caveats.some((c) => c.includes('no-such-rendition'))).toBe(true);
  });

  it('identity has a usable anonymous default', async () => {
    const who = await anonymousIdentity().current();
    expect(who.id).toBe('anonymous');
    expect(who.kind).toBe('human');
    // ADR-0012: no persona means principalId === id, and an unattested identity says so.
    expect(who.principalId).toBe(who.id);
    expect(who.attestation?.method).toBe('unverified');
  });

  it('refuses the multiWriter combination the ADR calls a defect', () => {
    const caps = (over: Record<string, unknown>) => ({ getCapabilities: () => ({ ...DEFAULT_CAPABILITIES, ...over }) as never });
    expect(writeSafety(caps({})).safe).toBe(true);
    expect(writeSafety(caps({ multiWriter: true, perContributorFiles: true })).safe).toBe(true);
    const unsafe = writeSafety(caps({ multiWriter: true }));
    expect(unsafe.safe).toBe(false);
    expect(unsafe.reason).toMatch(/perContributorFiles/);
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
      'src/core/affordances.ts',     // cellPolicy, the one reader of those declarations (#52)
      'src/store/index.ts',          // cellAffordanceOf, where that policy meets capabilities
    ]);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const offenders = walk(join(root, 'src'))
      .map((f) => [relative(root, f).split('\\').join('/'), readFileSync(f, 'utf8')] as const)
      .filter(([rel]) => !allowed.has(rel))
      // Any mention at all, declaration or read: a second place that *consults*
      // editability is the failure as much as a second place that declares it.
      // `locked` only where it is the *analysis field* (`.locked`, `locked:`):
      // view state's locked runs (ADR-0008) are an ordering constraint and have
      // nothing to do with who may write.
      .filter(([, src]) => /\b(readOnly|isReadOnly|canEdit|editable)\b|(?:\.locked\b|\blocked\s*[:?])/.test(
        src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '),
      ))
      .map(([rel]) => rel);
    expect(offenders, 'editability has one source of truth: getCapabilities, plus the document policy it meets in store/').toEqual([]);
  });
});

describe('editAffordances: what the view reads, every write gated on getCapabilities (#72)', () => {
  /** One call per write the view can offer, on a cell the fixture leaves open to edits. */
  const ask: Record<typeof WRITE_AFFORDANCES[number], (aff: Affordances) => Affordance> = {
    assert: (aff) => aff.assert('lisbon', 'rent', 'score'),
    suggest: (aff) => aff.suggest('lisbon', 'rent', 'score'),
    comment: (aff) => aff.comment(),
    revise: (aff) => aff.revise('renaming a criterion'),
  };

  it('flipping canUpdate disables every write the view can offer, each with a stated reason', () => {
    const a = relocation();
    let caps: ProviderCapabilities = { ...DEFAULT_CAPABILITIES, canUpdate: true };
    // One provider, one affordances object: the capability is read at query
    // time, so a flip shows on the next question without rebuilding anything.
    const aff = editAffordances({ getCapabilities: () => caps }, a);
    for (const name of WRITE_AFFORDANCES) expect(ask[name](aff), name).toEqual({ enabled: true });
    caps = { ...caps, canUpdate: false };
    for (const name of WRITE_AFFORDANCES) {
      const r = ask[name](aff);
      expect(r.enabled, name).toBe(false);
      expect(r.reason, name).toMatch(/^this source does not accept updates, so .+ is not possible here\.$/);
    }
    expect(aff.revise('renaming a criterion').reason).toMatch(/renaming a criterion/);
    caps = { ...caps, canUpdate: true };
    for (const name of WRITE_AFFORDANCES) expect(ask[name](aff).enabled, name).toBe(true);
  });

  it('a frozen in-memory source is the same flip, through the real adapter', () => {
    const a = relocation();
    const frozen = editAffordances(inMemoryAnalysisSource(a, { canUpdate: false }), a);
    for (const name of WRITE_AFFORDANCES) expect(ask[name](frozen).reason, name).toMatch(/does not accept updates/);
  });

  it('classifies every member of the affordance layer as a write or not, so a new one cannot slip past the gate', () => {
    // A member added to Affordances must be added to one of these two lists;
    // only the first is gated on the provider.
    const notWrites = ['value', 'missingCodes', 'missingCode', 'inapplicable', 'screens'];
    const members = Object.keys(makeAffordances(relocation())).sort();
    expect(members).toEqual([...WRITE_AFFORDANCES, ...notWrites].sort());
  });

  it('passes the document-only questions through unchanged: a frozen source changes no legality', () => {
    const a = relocation();
    const doc = makeAffordances(a);
    const frozen = editAffordances(inMemoryAnalysisSource(a, { canUpdate: false }), a);
    expect(frozen.missingCodes('rent')).toEqual(doc.missingCodes('rent'));
    expect(frozen.missingCode('rent', 'unknown')).toEqual(doc.missingCode('rent', 'unknown'));
    expect(frozen.value('rent', 'score', 99)).toEqual(doc.value('rent', 'score', 99));
    expect(frozen.inapplicable('taipei', 'eu-residency-path')).toBe(true);
    expect(frozen.screens('score')).toEqual(doc.screens('score'));
  });

  it('asks the provider first, then the document, then the host', () => {
    const a = { ...relocation(), locked: true };
    const asked: string[] = [];
    const authorize = (r: { action: string }) => { asked.push(r.action); return r.action !== 'comment'; };
    const open = editAffordances(inMemoryAnalysisSource(a), a, { authorize });
    // The document refuses a direct edit and a revision of a locked analysis, and the host is not asked.
    expect(open.assert('lisbon', 'rent', 'score').reason).toMatch(/locked; propose a suggestion/);
    expect(open.revise('adding a criterion').reason).toMatch(/locked/);
    expect(asked).toEqual([]);
    // A lock leaves suggestions and comments to the host.
    expect(open.suggest('lisbon', 'rent', 'score').enabled).toBe(true);
    expect(open.comment()).toEqual({ enabled: false, reason: 'you are not authorised to do this here.' });
    expect(asked).toEqual(['suggest', 'comment']);
    // A frozen source answers before either, with its own reason.
    asked.length = 0;
    const frozen = editAffordances(inMemoryAnalysisSource(a, { canUpdate: false }), a, { authorize });
    expect(frozen.assert('lisbon', 'rent', 'score').reason).toMatch(/does not accept updates/);
    expect(frozen.comment().reason).toMatch(/does not accept updates/);
    expect(asked).toEqual([]);
  });

  it('the host is asked about document edits by name, and may refuse them with its own reason', () => {
    const a = relocation();
    const aff = editAffordances(inMemoryAnalysisSource(a), a, {
      authorize: (r) => (r.action === 'revise' ? { enabled: false, reason: `only the owner may be ${r.doing}.` } : true),
    });
    expect(aff.revise('renaming a criterion')).toEqual({ enabled: false, reason: 'only the owner may be renaming a criterion.' });
    expect(aff.comment()).toEqual({ enabled: true });
  });
});

describe('subscribe: the analysis source is load-and-subscribe (ADR-0013, ADR-0006 clause 2)', () => {
  it('tells a subscriber about every write, and stops when unsubscribed', async () => {
    const a = relocation();
    const source = inMemoryAnalysisSource(a);
    const heard: DataChangeEvent<typeof a>[] = [];
    const stop = source.subscribe!((e) => heard.push(e));
    await source.update(a.id, { title: 'Relocation, revisited' });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: 'updated', id: a.id, item: { title: 'Relocation, revisited' } });
    stop();
    await source.update(a.id, { title: 'Relocation, again' });
    expect(heard).toHaveLength(1);
  });

  it('says nothing about a write it refused', async () => {
    const a = relocation();
    const frozen = inMemoryAnalysisSource(a, { canUpdate: false });
    const guarded = inMemoryAnalysisSource(a);
    const heard: unknown[] = [];
    frozen.subscribe!((e) => heard.push(e));
    guarded.subscribe!((e) => heard.push(e));
    await expect(frozen.update(a.id, { title: 'x' })).rejects.toThrow(/read-only/);
    // A schema version the write path refuses (revisionProblems).
    await expect(guarded.update(a.id, { schemaVersion: 2 } as never)).rejects.toThrow(/refused/);
    expect(heard).toEqual([]);
  });

  it('a subscriber that throws neither fails the write nor silences the next subscriber', async () => {
    const errors: unknown[] = [];
    const p = oneItemProvider({ id: 'doc', n: 0 }, { onSubscriberError: (e) => errors.push(e) });
    const heard: number[] = [];
    p.subscribe!(() => { throw new Error('subscriber broke'); });
    p.subscribe!((e) => { if (e.type === 'updated') heard.push(e.item.n); });
    expect((await p.update('doc', { n: 1 })).n).toBe(1);
    expect(heard).toEqual([1]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/subscriber broke/);
  });
});
