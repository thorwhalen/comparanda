/**
 * The view-state provider: fallback chain, cross-tab sync, loud quota failure (#73, ADR-0006).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { initialViewState, setGrouping, serializeViewState } from '../src/core/view-state.js';
import {
  inMemoryAnalysisSource, oneItemProvider, StorageQuotaError, viewStateProvider, VIEW_STATE_RECORD_ID,
  type StorageEvents, type ViewStateRecord,
} from '../src/store/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const analysis = Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));
const initial = initialViewState(analysis);
const changed = { ...initial, transposed: true };

const mapStorage = (map = new Map<string, string>()) => ({
  map,
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, v),
  removeItem: (k: string) => void map.delete(k),
});
const domError = (name: string) => Object.assign(new Error(name), { name });
const bus = () => {
  const ls = new Set<(e: { key: string | null; newValue: string | null }) => void>();
  const events: StorageEvents = {
    addEventListener: (_t, l) => void ls.add(l),
    removeEventListener: (_t, l) => void ls.delete(l),
  };
  return { events, fire: (e: { key: string | null; newValue: string | null }) => ls.forEach((l) => l(e)), count: () => ls.size };
};

describe('the fallback chain', () => {
  it('1: a caller-provided provider is used as is', () => {
    const p = oneItemProvider<ViewStateRecord>({ id: VIEW_STATE_RECORD_ID, state: initial });
    const h = viewStateProvider(initial, { provider: p });
    expect(h.provider).toBe(p);
    expect(h.status()).toEqual({ backing: 'provided' });
  });

  it('2: writable storage is used, and what it holds wins over the initial state', async () => {
    const s = mapStorage();
    const first = viewStateProvider(initial, { storage: s, events: null });
    expect(first.status()).toEqual({ backing: 'local-storage' });
    await first.provider.update(VIEW_STATE_RECORD_ID, { state: changed });
    const second = viewStateProvider(initial, { storage: s, events: null });
    expect((await second.provider.getOne(VIEW_STATE_RECORD_ID)).state.transposed).toBe(true);
  });

  it('3: storage that throws on write -- though the API is present -- falls to memory WITH a notice', async () => {
    const throwing = { getItem: () => null, setItem: () => { throw domError('SecurityError'); }, removeItem: () => {} };
    const h = viewStateProvider(initial, { storage: throwing, events: null });
    expect(h.status().backing).toBe('memory');
    expect(h.status().notice).toMatch(/lost when this tab closes/);
    // memory still works as a session store
    await h.provider.update(VIEW_STATE_RECORD_ID, { state: changed });
    expect((await h.provider.getOne(VIEW_STATE_RECORD_ID)).state.transposed).toBe(true);
    // not dismissable by accident: only an explicit acknowledge clears it
    h.acknowledge();
    expect(h.status().notice).toBeUndefined();
  });

  it('malformed stored state is ignored, not half-read', async () => {
    const s = mapStorage(new Map([['comparanda.view-state', '{"nope":1}']]));
    const h = viewStateProvider(initial, { storage: s, events: null });
    expect((await h.provider.getOne(VIEW_STATE_RECORD_ID)).state).toEqual(initial);
  });
});

describe('quota failure is loud', () => {
  it('rejects with a StorageQuotaError, tells the person, and keeps the last good value', async () => {
    const s = mapStorage();
    let full = false;
    const storage = { ...s, setItem: (k: string, v: string) => { if (full && k === 'comparanda.view-state') throw domError('QuotaExceededError'); s.setItem(k, v); } };
    const h = viewStateProvider(initial, { storage, events: null });
    const heard: (string | undefined)[] = [];
    h.onStatus((st) => heard.push(st.notice));
    await h.provider.update(VIEW_STATE_RECORD_ID, { state: changed });
    full = true;
    await expect(h.provider.update(VIEW_STATE_RECORD_ID, { state: initial })).rejects.toBeInstanceOf(StorageQuotaError);
    expect(h.status().notice).toMatch(/NOT saved/);
    expect(heard.at(-1)).toMatch(/NOT saved/);
    expect((await h.provider.getOne(VIEW_STATE_RECORD_ID)).state.transposed).toBe(true);
    expect(JSON.parse(s.map.get('comparanda.view-state')!).transposed).toBe(true);
  });

  it('an error that is not a quota error is not relabelled as one', async () => {
    const s = mapStorage();
    let broken = false;
    const storage = { ...s, setItem: (k: string, v: string) => { if (broken && k === 'comparanda.view-state') throw new Error('disk on fire'); s.setItem(k, v); } };
    const h = viewStateProvider(initial, { storage, events: null });
    broken = true;
    await expect(h.provider.update(VIEW_STATE_RECORD_ID, { state: changed })).rejects.toThrow('disk on fire');
  });
});

describe('cross-tab sync is last-write-wins, for view state only', () => {
  it("another tab's write replaces ours and subscribers hear it", async () => {
    const b = bus();
    const h = viewStateProvider(initial, { storage: mapStorage(), events: b.events });
    const heard: boolean[] = [];
    h.provider.subscribe!((e) => { if (e.type === 'updated') heard.push((e.item as ViewStateRecord).state.transposed); });
    b.fire({ key: 'comparanda.view-state', newValue: serializeViewState(changed) });
    expect((await h.provider.getOne(VIEW_STATE_RECORD_ID)).state.transposed).toBe(true);
    expect(heard).toEqual([true]);
  });

  it('ignores other keys, malformed values and removals', async () => {
    const b = bus();
    const h = viewStateProvider(initial, { storage: mapStorage(), events: b.events });
    b.fire({ key: 'something.else', newValue: serializeViewState(changed) });
    b.fire({ key: 'comparanda.view-state', newValue: 'not json' });
    b.fire({ key: 'comparanda.view-state', newValue: null });
    expect((await h.provider.getOne(VIEW_STATE_RECORD_ID)).state).toEqual(initial);
  });

  it('dispose stops listening', () => {
    const b = bus();
    const h = viewStateProvider(initial, { storage: mapStorage(), events: b.events });
    expect(b.count()).toBe(1);
    h.dispose();
    expect(b.count()).toBe(0);
  });

  it('is not reachable for the analysis: a view-state provider refuses a non-view-state write, and the analysis source never listens', async () => {
    const b = bus();
    const h = viewStateProvider(initial, { storage: mapStorage(), events: b.events });
    await expect(h.provider.update(VIEW_STATE_RECORD_ID, { state: { title: 'x' } as never })).rejects.toThrow(/view state only/);
    const source = inMemoryAnalysisSource(analysis);
    b.fire({ key: 'comparanda.view-state', newValue: serializeViewState(setGrouping(initial, 'criteria', []) ) });
    expect((await source.getOne(analysis.id)).title).toBe(analysis.title);
    expect(b.count()).toBe(1); // only the view-state provider registered
  });
});
