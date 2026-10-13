/**
 * Identity (#74, ADR-0012): the local identity is a typed name honestly
 * labelled unverified; an agent is told from a person by the typed `kind`;
 * authorisation is the intersection with the host, failing closed.
 */
import { describe, expect, it } from 'vitest';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { makeAffordances, type Authorize } from '../src/core/affordances.js';
import { attribution, attributions } from '../src/core/identity.js';
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
      .toBe('Ada (human, verified by idp.example)');
    expect(attribution({ displayName: 'Ada', kind: 'human', attestation: { method: 'host-session' } })).toBe('Ada (human, signed in)');
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
    expect(map.get('ada-buyer')).toBe('Ada as buyer (human, acting as the buyer, for Ada, unverified)');
    expect(map.get('ghost-buyer')).toBe('Buyer (human, for ghost, unverified)');
  });
});

describe('the local identity: a name typed once, under a stable id', () => {
  it('is anonymous until named, then a human with a generated id, unverified', async () => {
    const storage = memory();
    const me = localIdentity({ storage, newId: () => 'local-1' });
    expect((await me.current()).id).toBe('anonymous');
    const named = await me.name('  Ada ');
    expect(named).toEqual({ id: 'local-1', displayName: 'Ada', kind: 'human', principalId: 'local-1', attestation: { method: 'unverified' } });
    expect(await me.current()).toEqual(named);
    // Another page over the same storage is the same contributor.
    expect((await localIdentity({ storage }).current()).id).toBe('local-1');
  });

  it('keeps the id across a rename, and forgets both on request', async () => {
    let n = 0;
    const me = localIdentity({ storage: memory(), newId: () => `local-${(n += 1)}` });
    await me.name('Ada');
    expect((await me.name('Ada L.')).id).toBe('local-1');
    await me.forget();
    expect((await me.current()).id).toBe('anonymous');
    expect((await me.name('Bo')).id).toBe('local-2');
  });

  it('reads storage as untrusted: nothing stored can promote it, and malformed reads as no name', async () => {
    const forged = memory({ 'comparanda.identity': JSON.stringify({ id: 'x', displayName: 'X', kind: 'agent', attestation: { method: 'signature' } }) });
    expect(await localIdentity({ storage: forged }).current()).toEqual(
      { id: 'x', displayName: 'X', kind: 'human', principalId: 'x', attestation: { method: 'unverified' } },
    );
    for (const bad of ['{', '"ada"', '{"id":"","displayName":"A"}', '{"id":"a","displayName":"  "}', '{"id":3,"displayName":"A"}']) {
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
  });
});
