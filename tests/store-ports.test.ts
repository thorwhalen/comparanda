/**
 * The ports, and getCapabilities as the single source of truth (#72, ADR-0006
 * as amended, ADR-0013).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { tombstone } from '../src/core/schema/anchors.js';
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
      'src/core/affordances.ts',     // cellPolicy and documentPolicy, the readers of those declarations (#52, #72)
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
    revise: (aff) => aff.revise('renaming a criterion', { kind: 'criterion', id: 'rent' }),
    changeLock: (aff) => aff.changeLock(),
    decideSuggestion: (aff) => aff.decideSuggestion('sg-day-tai', 'accept'),
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
    const notWrites = ['value', 'missingCodes', 'missingCode', 'inapplicable', 'inapplicableBlock', 'screens'];
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
    // A lock leaves suggestions, comments, its own removal and the owner's
    // decision on a suggestion to the host.
    expect(open.suggest('lisbon', 'rent', 'score').enabled).toBe(true);
    expect(open.comment()).toEqual({ enabled: false, reason: 'you are not authorised to do this here.' });
    expect(open.changeLock().enabled).toBe(true);
    expect(open.decideSuggestion('sg-day-tai', 'accept').enabled).toBe(true);
    expect(asked).toEqual(['suggest', 'comment', 'change-lock', 'decide-suggestion']);
    // A frozen source answers before either, with its own reason.
    asked.length = 0;
    const frozen = editAffordances(inMemoryAnalysisSource(a, { canUpdate: false }), a, { authorize });
    expect(frozen.assert('lisbon', 'rent', 'score').reason).toMatch(/does not accept updates/);
    expect(frozen.comment().reason).toMatch(/does not accept updates/);
    expect(asked).toEqual([]);
  });

  it('the host is asked about document edits by name and by target, and may refuse them with its own reason', () => {
    const a = relocation();
    const aff = editAffordances(inMemoryAnalysisSource(a), a, {
      authorize: (r) => (r.action === 'revise' && 'target' in r && r.target?.id === 'rent'
        ? { enabled: false, reason: `only the owner of rent may be ${r.doing}.` } : true),
    });
    expect(aff.revise('renaming a criterion', { kind: 'criterion', id: 'rent' }))
      .toEqual({ enabled: false, reason: 'only the owner of rent may be renaming a criterion.' });
    expect(aff.revise('renaming a criterion', { kind: 'criterion', id: 'income-tax' })).toEqual({ enabled: true });
    expect(aff.comment()).toEqual({ enabled: true });
  });

  it('refuses an empty description of an edit at once, whatever the provider says', () => {
    const a = relocation();
    for (const source of [inMemoryAnalysisSource(a), inMemoryAnalysisSource(a, { canUpdate: false })]) {
      expect(() => editAffordances(source, a).revise('  ')).toThrow(/gerund phrase/);
    }
    expect(affordanceOf({ getCapabilities: () => ({ ...DEFAULT_CAPABILITIES, canUpdate: false }) }, 'update', { doing: '' }).reason)
      .toBe('this source does not accept updates, so this cannot be updated here.');
  });

  it('decides only a suggestion that exists and is still open', () => {
    const a = relocation();
    const decided = { ...a, suggestions: a.suggestions.map((s) => ({ ...s, status: 'accepted' as const })) };
    expect(editAffordances(inMemoryAnalysisSource(a), a).decideSuggestion('nope', 'decline').reason).toMatch(/no suggestion "nope"/);
    expect(editAffordances(inMemoryAnalysisSource(decided), decided).decideSuggestion('sg-day-tai', 'decline').reason)
      .toMatch(/already been accepted/);
  });

  it('offers accepting a suggestion only where its assertion could be written; declining stays open', () => {
    const a = relocation();
    const asked: unknown[] = [];
    const deleted = tombstone(a, { kind: 'alternative', id: 'taipei' });
    const ro = { ...a, cells: a.cells.map((c) => (c.alternativeId === 'taipei' && c.criterionId === 'winter-daylight' ? { ...c, readOnly: true } : c)) };
    for (const [doc, why] of [[deleted, /has been deleted/], [ro, /read-only in the analysis; decline it instead/]] as const) {
      const aff = editAffordances(inMemoryAnalysisSource(doc), doc, { authorize: (r) => { asked.push(r); return true; } });
      expect(aff.decideSuggestion('sg-day-tai', 'accept').reason).toMatch(why);
      expect(aff.decideSuggestion('sg-day-tai', 'decline')).toEqual({ enabled: true });
    }
    // The host is told which way, and about what.
    expect(asked).toContainEqual({
      action: 'decide-suggestion', doing: 'declining a suggestion', target: { kind: 'suggestion', id: 'sg-day-tai' }, decision: 'decline',
    });
    // Accepting is a write to the anchored cell, and the host sees that cell.
    asked.length = 0;
    editAffordances(inMemoryAnalysisSource(a), a, { authorize: (r) => { asked.push(r); return true; } })
      .decideSuggestion('sg-day-tai', 'accept');
    expect(asked).toEqual([{
      action: 'decide-suggestion', doing: 'accepting a suggestion', target: { kind: 'suggestion', id: 'sg-day-tai' },
      decision: 'accept', cell: { alternativeId: 'taipei', criterionId: 'winter-daylight', measure: 'score' },
    }]);
    for (const source of [inMemoryAnalysisSource(a), inMemoryAnalysisSource(a, { canUpdate: false })]) {
      expect(() => editAffordances(source, a).decideSuggestion('sg-day-tai', 'acept' as never)).toThrow(/"accept" or "decline"/);
    }
    const noMeasure = { ...a, suggestions: a.suggestions.map((sg) => ({ ...sg, anchor: { ...sg.anchor, measure: undefined } })) };
    expect(editAffordances(inMemoryAnalysisSource(noMeasure as never), noMeasure as never).decideSuggestion('sg-day-tai', 'accept').reason)
      .toMatch(/not the measure it scores/);
    const frozen = editAffordances(inMemoryAnalysisSource(a, { canUpdate: false }), a);
    expect(frozen.decideSuggestion('sg-day-tai', 'decline').reason).toBe('this source does not accept updates, so declining a suggestion is not possible here.');
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

  it('reports that it delivers writes, through the one source of truth', () => {
    expect(capabilitiesOf(inMemoryAnalysisSource(relocation())).realtime).toBe(true);
  });

  it('delivers in the order writes happened, even when a subscriber writes while being told', async () => {
    const p = oneItemProvider({ id: 'doc', n: 0 });
    const heard: number[] = [];
    p.subscribe!((e) => { if (e.type === 'updated' && e.item.n === 1) void p.update('doc', { n: 2 }); });
    p.subscribe!((e) => { if (e.type === 'updated') heard.push(e.item.n); });
    await p.update('doc', { n: 1 });
    expect(heard).toEqual([1, 2]);
    expect((await p.getOne('doc')).n).toBe(2);
  });

  it('gives each subscriber its own copy: nothing a subscriber does reaches the store', async () => {
    const p = oneItemProvider({ id: 'doc', n: 0 });
    let seenBySecond = -1;
    p.subscribe!((e) => { if (e.type === 'updated') (e.item as { n: number }).n = 999; });
    p.subscribe!((e) => { if (e.type === 'updated') seenBySecond = e.item.n; });
    const returned = await p.update('doc', { n: 1 });
    expect(seenBySecond).toBe(1);
    expect(returned.n).toBe(1);
    expect((await p.getOne('doc')).n).toBe(1);
  });

  it('an unsubscribed subscriber hears nothing more, even mid-notification', async () => {
    const p = oneItemProvider({ id: 'doc', n: 0 });
    const heard: string[] = [];
    let stopB = () => {};
    p.subscribe!(() => { heard.push('A'); stopB(); });
    stopB = p.subscribe!(() => heard.push('B'));
    await p.update('doc', { n: 1 });
    expect(heard).toEqual(['A']);
  });

  it('checks writes issued together one after another, so neither slips past the other', async () => {
    const a = relocation();
    const gone = tombstone(a, { kind: 'group', id: 'g-americas' }, { reopensInapplicable: true });
    const source = inMemoryAnalysisSource(a);
    const [tomb, attach] = await Promise.allSettled([
      source.update(a.id, { groups: gone.groups, inapplicable: gone.inapplicable }),
      source.update(a.id, {
        alternatives: a.alternatives.map((x) => (x.id === 'lisbon' ? { ...x, groupIds: [...(x.groupIds ?? []), 'g-americas'] } : x)),
      }),
    ]);
    expect(tomb.status).toBe('fulfilled');
    expect(attach.status).toBe('rejected');
    const after = await source.getOne(a.id);
    expect(after.alternatives.find((x) => x.id === 'lisbon')!.groupIds).not.toContain('g-americas');
    // A refused write does not block the next one.
    expect((await source.update(a.id, { title: 'still writable' })).title).toBe('still writable');
  });

  it('lets nothing but update reach the stored document', async () => {
    const initial = { id: 'doc', n: 0 };
    const p = oneItemProvider(initial);
    initial.n = 5;
    expect((await p.getOne('doc')).n).toBe(0);
    (await p.getOne('doc')).n = 6;
    (await p.getList({})).data[0]!.n = 7;
    (await p.update('doc', { n: 1 })).n = 777;
    expect((await p.getOne('doc')).n).toBe(1);
  });

  it('refuses, with nothing stored, a write it cannot copy', async () => {
    const p = oneItemProvider<{ id: string; n: unknown }>({ id: 'doc', n: 0 });
    await expect(p.update('doc', { n: () => 1 })).rejects.toThrow();
    expect((await p.getOne('doc')).n).toBe(0);
  });

  it('returns the caller\'s own write, not one a subscriber made while being told', async () => {
    const p = oneItemProvider({ id: 'doc', n: 0 });
    p.subscribe!((e) => { if (e.type === 'updated' && e.item.n === 1) void p.update('doc', { n: 2 }); });
    expect((await p.update('doc', { n: 1 })).n).toBe(1);
    expect((await p.getOne('doc')).n).toBe(2);
  });

  it('copies real analyses faithfully', async () => {
    const a = relocation();
    const source = inMemoryAnalysisSource(a);
    const back = await source.getOne(a.id);
    expect(back).toEqual(a);
    expect(back).not.toBe(a);
    expect(Analysis.safeParse(back).success).toBe(true);
  });

  it('refuses to change the document\'s id', async () => {
    const p = oneItemProvider({ id: 'doc', n: 0 });
    const heard: unknown[] = [];
    p.subscribe!((e) => heard.push(e));
    await expect(p.update('doc', { id: 'other' })).rejects.toThrow(/cannot change its document's id/);
    expect((await p.getOne('doc')).id).toBe('doc');
    expect(heard).toEqual([]);
  });

  it('a throwing error handler neither fails the write nor silences anyone; the default takes over', async () => {
    const later: unknown[] = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (cb: () => void) => { try { cb(); } catch (e) { later.push(e); } };
    try {
      const p = oneItemProvider({ id: 'doc', n: 0 }, { onSubscriberError: () => { throw new Error('handler broke'); } });
      const heard: number[] = [];
      p.subscribe!(() => { throw new Error('subscriber broke'); });
      p.subscribe!((e) => { if (e.type === 'updated') heard.push(e.item.n); });
      expect((await p.update('doc', { n: 1 })).n).toBe(1);
      expect(heard).toEqual([1]);
      expect(later.map(String)).toEqual(['Error: subscriber broke', 'Error: handler broke']);
    } finally {
      globalThis.queueMicrotask = original;
    }
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
