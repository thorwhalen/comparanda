/**
 * Identity (#74, ADR-0012): the local identity is a typed name honestly
 * labelled unverified; an agent is told from a person by the typed `kind`;
 * authorisation is the intersection with the host, failing closed.
 */
import { describe, expect, it } from 'vitest';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { makeAffordances, type Authorize } from '../src/core/affordances.js';
import { attribution, attributions } from '../src/core/identity.js';
import { startThread } from '../src/core/threads.js';
import { activityRecord } from '../src/core/activity.js';
import { describeOrphans } from '../src/core/orphans.js';
import { agentIdentity, localIdentity, type IdentityStorage } from '../src/store/index.js';
import relocationJson from '../examples/relocation.json';

const relocation = () => Analysis.parse(relocationJson);

function memory(seed: Record<string, string> = {}): IdentityStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('attribution says what kind of author, and how well it is known', () => {
  it('labels a typed name unverified, and an attestation by what it is worth', () => {
    expect(attribution({ displayName: 'Ada', kind: 'human' })).toBe('Ada (human, unverified)');
    expect(attribution({ displayName: 'Ada', kind: 'human', attestation: { method: 'oauth', issuer: 'idp.example' } }))
      .toBe('Ada (human, unverified; claims verified by idp.example)');
    expect(attribution({ displayName: 'Ada', kind: 'human', attestation: { method: 'host-session' } }, { vouched: true })).toBe('Ada (human, signed in)');
  });

  it('names an agent by its kind and its run, not by its display name', () => {
    const author = { displayName: 'Ada', kind: 'agent' as const, agent: { name: 'scorer', model: 'm-1', promptVersion: 'v3', runId: 'r9' } };
    expect(attribution(author)).toBe('Ada (agent scorer, model m-1, prompt v3, run r9, unverified)');
  });

  it('names a persona\'s perspective and its principal, by display name or by id', () => {
    const map = attributions([
      { id: 'ada', displayName: 'Ada', kind: 'human' },
      { id: 'ada-buyer', displayName: 'Ada as buyer', kind: 'human', principalId: 'ada', actingAs: 'the buyer' },
      { id: 'ghost-buyer', displayName: 'Buyer', kind: 'human', principalId: 'ghost' },
    ]);
    expect(map.get('ada')).toBe('Ada (human, unverified)');
    expect(map.get('ada-buyer')).toBe('Ada as buyer (human, acting as the buyer, for Ada [ada], unverified)');
    expect(map.get('ghost-buyer')).toBe('Buyer (human, for ghost, unverified)');
  });
});

describe('a look-alike persona never shows only a display name (#243)', () => {
  it('names the principal id beside a display name that copies another author', () => {
    const map = attributions([
      { id: 'ana', displayName: 'Ana', kind: 'human' },
      { id: 'aaa', displayName: 'Ana', kind: 'human' },
      { id: 'aaa:Ana', displayName: 'Ana', kind: 'human', principalId: 'aaa', actingAs: 'ana' },
      { id: 'aaa:\u0430na', displayName: 'Ana', kind: 'human', principalId: 'aaa', actingAs: 'ana' },
    ]);
    expect(map.get('ana')).toBe('Ana (human, unverified)');
    expect(map.get('aaa:Ana')).toBe('Ana (human, acting as ana, for Ana [aaa], unverified)');
    expect(map.get('aaa:\u0430na')).toBe('Ana (human, acting as ana, for Ana [aaa], unverified)');
    // Without the principal's display name, the id alone; never dropped.
    expect(attribution({ id: 'aaa:Ana', displayName: 'Ana', kind: 'human', principalId: 'aaa' })).toBe('Ana (human, for aaa, unverified)');
  });

  it('reads a claimed attestation as a claim unless the host vouches for it', () => {
    const signed = { id: 'ada', displayName: 'Ada', kind: 'human' as const, attestation: { method: 'host-session' as const, issuer: 'intranet' } };
    expect(attributions([signed]).get('ada')).toBe('Ada (human, unverified; claims signed in to intranet)');
    expect(attributions([signed], { vouched: (a) => a.id === 'ada' }).get('ada')).toBe('Ada (human, signed in to intranet)');
  });

  it('lets a host vouch through the descriptions the view shows (#263)', () => {
    const base = relocation();
    const a: Analysis = {
      ...base,
      authors: base.authors.map((x) => x.id === 'ana' ? { ...x, attestation: { method: 'host-session' as const, issuer: 'intranet' } } : x),
    };
    const viewer = { viewerId: 'ana', now: '2100-01-01T00:00:00Z' };
    const said = (vouched?: (x: { id: string }) => boolean) =>
      activityRecord(a, viewer, { vouched }).map((e) => e.who ?? '').filter((w) => w.startsWith('Ana Ruiz (human'));
    expect(said()[0]).toContain('unverified; claims signed in to intranet');
    expect(said((x) => x.id === 'ana')[0]).toBe('Ana Ruiz (human, signed in to intranet)');
    // Orphans accept the same option; with none vouched, nothing changes.
    expect(describeOrphans(a, { vouched: () => false })).toEqual(describeOrphans(a));
  });
});

describe('the local identity: a name typed once, under a stable id', () => {
  it('is anonymous until named, then a human with a generated id, unverified', async () => {
    const storage = memory();
    const me = localIdentity({ storage, newId: () => '1' });
    expect((await me.current()).id).toBe('anonymous');
    const named = await me.name('  Ada ');
    expect(named).toEqual({ id: 'local-1', displayName: 'Ada', kind: 'human', principalId: 'local-1', attestation: { method: 'unverified' } });
    expect(await me.current()).toEqual(named);
    // Another page over the same storage is the same contributor.
    expect((await localIdentity({ storage }).current()).id).toBe('local-1');
  });

  it('keeps the id across a rename, and forgets both on request', async () => {
    let n = 0;
    const me = localIdentity({ storage: memory(), newId: () => `${(n += 1)}` });
    await me.name('Ada');
    expect((await me.name('Ada L.')).id).toBe('local-1');
    await me.forget();
    expect((await me.current()).id).toBe('anonymous');
    expect((await me.name('Bo')).id).toBe('local-2');
  });

  it('reads storage as untrusted: nothing stored can promote it, and malformed reads as no name', async () => {
    const forged = memory({ 'comparanda.identity': JSON.stringify({ id: 'local-x', displayName: 'X', kind: 'agent', attestation: { method: 'signature' } }) });
    expect(await localIdentity({ storage: forged }).current()).toEqual(
      { id: 'local-x', displayName: 'X', kind: 'human', principalId: 'local-x', attestation: { method: 'unverified' } },
    );
    // An id this adapter could not have made is not taken: a stored "ana" must not sign as the document's Ana.
    expect((await localIdentity({ storage: memory({ 'comparanda.identity': '{"id":"ana","displayName":"Mallory"}' }) }).current()).id).toBe('anonymous');
    for (const bad of ['{', '"ada"', '{"id":"","displayName":"A"}', '{"id":"local-a","displayName":"  "}', '{"id":3,"displayName":"A"}']) {
      expect((await localIdentity({ storage: memory({ 'comparanda.identity': bad }) }).current()).id).toBe('anonymous');
    }
  });

  it('refuses an empty name, and works without any storage given', async () => {
    const me = localIdentity({ storage: memory() });
    await expect(me.name('  ')).rejects.toThrow(/needs a name/);
    const fallback = localIdentity();
    expect((await fallback.name('Ada')).displayName).toBe('Ada');
    expect((await fallback.current()).id).toMatch(/^local-[0-9a-f]{32}$/);
  });
});

describe('an agent identity is typed, not named', () => {
  it('is kind agent, carries its run, and is attributable per run', async () => {
    const run = await agentIdentity({ name: 'rubricator', model: 'm-1', promptVersion: 'v3', runId: 'r9' }).current();
    expect(run).toMatchObject({ id: 'rubricator:r9', principalId: 'rubricator:r9', displayName: 'rubricator', kind: 'agent', attestation: { method: 'unverified' } });
    expect(run.agent).toEqual({ name: 'rubricator', model: 'm-1', promptVersion: 'v3', runId: 'r9' });
    // A host may vouch, rename or re-id it; it may not make it a person.
    const vouched = await agentIdentity({ name: 'r' }, { id: 'r-1', attestation: { method: 'host-session' }, kind: 'human' } as never).current();
    expect(vouched).toMatchObject({ id: 'r-1', kind: 'agent', attestation: { method: 'host-session' } });
    expect(() => agentIdentity({ name: ' ' })).toThrow(/agent's name/);
  });

  it('a document where the typed field and the agent record disagree is refused', () => {
    const a = relocation();
    const ruleIds = (authors: unknown[]) =>
      validateAnalysis({ ...a, authors: [...a.authors, ...authors] }).problems.map((p) => p.ruleId);
    expect(ruleIds([{ id: 'bot', displayName: 'Bot', kind: 'human', agent: { name: 'bot' } }])).toContain('agent-is-typed');
    // An import that records the run behind it is not a disguise, and v1 documents carrying one still load.
    expect(ruleIds([{ id: 'imp', displayName: 'Import', kind: 'imported', agent: { name: 'bot' } }])).not.toContain('agent-is-typed');
    const principal = a.authors[0]!;
    expect(ruleIds([{ id: 'p', displayName: 'P', kind: principal.kind === 'agent' ? 'human' : 'agent', principalId: principal.id }]))
      .toContain('persona-keeps-kind');
    expect(ruleIds([{ id: 'p', displayName: 'P', kind: principal.kind, principalId: principal.id }])).not.toContain('persona-keeps-kind');
  });
});

describe('the host is never overruled: authorisation fails closed', () => {
  const ask = (authorize: Authorize) => makeAffordances(relocation(), { authorize }).assert('lisbon', 'rent', 'score');
  it('refuses when the host throws, saying so', () => {
    expect(ask(() => { throw new Error('directory down'); })).toEqual({
      enabled: false, reason: 'the host could not decide whether you may do this (directory down).',
    });
  });
  it('refuses anything but an explicit yes', () => {
    for (const answer of [undefined, null, 'yes', 1, {}, { enabled: 'true' }]) {
      expect(ask(() => answer as never).enabled, JSON.stringify(answer)).toBe(false);
    }
    expect(ask(() => ({ enabled: true, reason: 'ignored' }))).toEqual({ enabled: true });
    expect(ask(() => Promise.resolve(true) as never).reason).toMatch(/must answer at once/);
    expect(ask(() => ({ enabled: false, reason: 42 }) as never).reason).toBe('you are not authorised to do this here.');
    expect(ask(() => ({ get enabled(): boolean { throw new Error('getter'); } })).reason).toMatch(/could not decide.*getter/);
  });
});

describe('a writer cannot sign as an author the document already describes differently', () => {
  it('refuses an identity whose id is a different kind, or known differently well', () => {
    const a = relocation();
    const ana = { id: 'ana', displayName: 'Ana', kind: 'human' as const, attestation: { method: 'oauth' as const, issuer: 'corp' } };
    const doc = { ...a, authors: [...a.authors.filter((x) => x.id !== 'ana'), ana] };
    const write = (author: Parameters<typeof startThread>[1]['comment']['author']) => startThread(doc, {
      threadId: 't-new', anchor: { scope: 'analysis' }, comment: { id: 'c-new', at: '2026-10-13', body: 'hi', author },
    });
    expect(() => write({ id: 'ana', displayName: 'Mallory', kind: 'human', attestation: { method: 'unverified' } })).toThrow(/verified by corp/);
    expect(() => write({ id: 'ana', displayName: 'Ana', kind: 'agent', attestation: ana.attestation })).toThrow(/cannot write as them/);
    expect(write({ ...ana }).threads.at(-1)!.comments[0]!.authorId).toBe('ana');
  });

  it('refuses another agent run, or another persona, under a known id (#209)', () => {
    const a = relocation();
    const bot = { id: 'bot', displayName: 'Bot', kind: 'agent' as const, agent: { name: 'scorer', model: 'm1', runId: 'r1' } };
    const persona = { id: 'p', displayName: 'P', kind: 'human' as const, principalId: 'ana', actingAs: 'skeptic' };
    const doc = { ...a, authors: [...a.authors, bot, persona, { id: 'p0', displayName: 'P0', kind: 'human' as const }] };
    const write = (author: Parameters<typeof startThread>[1]['comment']['author']) => startThread(doc, {
      threadId: 't-new', anchor: { scope: 'analysis' }, comment: { id: 'c-new', at: '2026-10-13', body: 'hi', author },
    });
    expect(() => write({ ...bot, agent: { ...bot.agent, runId: 'r2' } })).toThrow(/another run or persona/);
    expect(() => write({ ...persona, actingAs: 'champion' })).toThrow(/another run or persona/);
    expect(write({ ...bot, agent: { ...bot.agent } }).threads.at(-1)!.comments[0]!.authorId).toBe('bot');
    // An absent principal is the author themself: a host identity that spells it out is the same author (review).
    expect(write({ id: 'p0', displayName: 'P0', kind: 'human', principalId: 'p0' }).threads.at(-1)!.comments[0]!.authorId).toBe('p0');
  });
});

describe('every attestation method has its own words (sprint review)', () => {
  it('names the issuer when there is one, and says so plainly when there is not', () => {
    const ada = (attestation: object) => attribution({ displayName: 'Ada', kind: 'human', attestation } as never, { vouched: true });
    expect(ada({ method: 'host-session', issuer: 'intranet' })).toBe('Ada (human, signed in to intranet)');
    expect(ada({ method: 'oauth' })).toBe('Ada (human, verified by an identity provider)');
    expect(ada({ method: 'signature' })).toBe('Ada (human, signed)');
    expect(ada({ method: 'signature', issuer: 'key-1' })).toBe('Ada (human, signed by key-1)');
    expect(ada({ method: 'unverified' })).toBe('Ada (human, unverified)');
  });
});

describe('an attestation method outside the schema reads as unverified (#243 review)', () => {
  it('never renders "claims unverified"', () => {
    const odd = { displayName: 'Ada', kind: 'human' as const, attestation: { method: 'telepathy' } } as never;
    expect(attribution(odd)).toBe('Ada (human, unverified)');
  });
});
