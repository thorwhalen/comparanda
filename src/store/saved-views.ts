/**
 * Where saved views and view sequences are kept (#71, ADR-0007 as amended).
 *
 * A personal view lives in its owner's store, so nobody else's client ever
 * holds it. Shared and locked views live with the analysis. Sequences live with
 * the analysis too. Each is an ordinary `DataProvider`, injected, and in memory
 * when none is given, so a host swaps in its own without the rules changing.
 *
 * Every write is asked first of `viewAffordances` (`core/saved-views.ts`), the
 * one place a view's mode and the host's `authorize` are composed. A refused
 * write rejects with the refusal's reason and changes nothing. There is no
 * autosave: nothing here is called unless a person asked to save.
 */
import { createInMemoryProvider, type DataProvider } from '@zodal/store';

import {
  createView, lockView, renameView, unlockView, updateView, viewAffordances, ViewSequence, ViewStep,
  type Act, type AuthorizeView, type SavedView, type SavedViewAct, type SavedViewMode,
} from '../core/saved-views.js';
import type { SavedViewState, ViewState } from '../core/view-state.js';

export interface SavedViewStoreOptions {
  /** The owner's own store, for personal views. Default: in memory. */
  personal?: DataProvider<SavedView>;
  /** The analysis's store, for shared and locked views. Default: in memory. */
  shared?: DataProvider<SavedView>;
  /** The analysis's store for sequences. Default: in memory. */
  sequences?: DataProvider<ViewSequence>;
  /** The host's say over each write (ADR-0012). Default: whatever the mode allows. */
  authorize?: AuthorizeView;
  /** Makes a new view's or sequence's id. */
  newId?: () => string;
}

export interface SavedViewStore {
  /** The views of one analysis this actor can read: their own personal views, and every shared and locked one. */
  list(analysisId: string, actorId: string | undefined): Promise<SavedView[]>;
  get(id: string): Promise<SavedView | undefined>;
  /** Save as new: always allowed, the escape from a lock. */
  create(current: ViewState | SavedViewState, options: { analysisId: string; name: string; mode?: SavedViewMode } & Act): Promise<SavedView>;
  update(id: string, current: ViewState | SavedViewState, act: Act): Promise<SavedView>;
  rename(id: string, name: string, act: Act): Promise<SavedView>;
  delete(id: string, act: Act): Promise<void>;
  lock(id: string, act: Act): Promise<SavedView>;
  unlock(id: string, act: Act): Promise<SavedView>;
  /** Sequences: an ordered list of view ids, each with an optional caption. */
  sequences: {
    list(analysisId: string): Promise<ViewSequence[]>;
    get(id: string): Promise<ViewSequence | undefined>;
    create(options: { analysisId: string; name: string; steps: readonly ViewStep[] }): Promise<ViewSequence>;
    update(id: string, change: Partial<Pick<ViewSequence, 'name' | 'steps'>>): Promise<ViewSequence>;
    delete(id: string): Promise<void>;
  };
}

/** A random hex id, from `getRandomValues`: `randomUUID` is missing outside secure contexts. */
const randomId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Everything a provider holds, through its list: the facade filters, the provider stays a plain store. */
async function all<T>(p: DataProvider<T>): Promise<T[]> {
  return (await p.getList({})).data;
}

async function maybe<T>(p: DataProvider<T>, id: string): Promise<T | undefined> {
  try {
    return await p.getOne(id);
  } catch {
    return undefined;
  }
}

export function savedViewStore({
  personal = createInMemoryProvider<SavedView>([], { idField: 'id' }),
  shared = createInMemoryProvider<SavedView>([], { idField: 'id' }),
  sequences = createInMemoryProvider<ViewSequence>([], { idField: 'id' }),
  authorize,
  newId = randomId,
}: SavedViewStoreOptions = {}): SavedViewStore {
  const home = (mode: SavedViewMode) => (mode === 'personal' ? personal : shared);
  const find = async (id: string) => (await maybe(personal, id)) ?? (await maybe(shared, id));
  const existing = async (id: string) => {
    const v = await find(id);
    if (!v) throw new Error(`there is no saved view "${id}".`);
    return v;
  };
  /** Ask the mode and the host; a refusal rejects with its reason. */
  const may = (v: SavedView, act: SavedViewAct, by: string) => {
    const a = viewAffordances(v, { actorId: by, ...(authorize ? { authorize } : {}) })[act];
    if (!a.enabled) throw new Error(`"${v.name}" cannot be changed that way: ${a.reason}`);
  };
  /** Write a changed view where its mode keeps it: a lock or unlock keeps it in the analysis's store. */
  const put = async (before: SavedView, after: SavedView) => {
    if (home(before.mode) !== home(after.mode)) {
      await home(before.mode).delete(before.id);
      return home(after.mode).create(after);
    }
    return home(after.mode).update(after.id, after);
  };
  const write = (act: SavedViewAct, change: (v: SavedView, a: Act) => SavedView) => async (id: string, a: Act) => {
    const v = await existing(id);
    may(v, act, a.by);
    return put(v, change(v, a));
  };

  return {
    async list(analysisId, actorId) {
      const mine = (await all(personal)).filter((v) => v.ownerId === actorId);
      return [...mine, ...(await all(shared))].filter((v) => v.analysisId === analysisId);
    },
    get: find,
    async create(current, options) {
      const v = createView(current, { id: newId(), ...options });
      return home(v.mode).create(v);
    },
    update: (id, current, a) => write('update', (v, x) => updateView(v, current, x))(id, a),
    rename: (id, name, a) => write('rename', (v, x) => renameView(v, name, x))(id, a),
    async delete(id, a) {
      const v = await existing(id);
      may(v, 'delete', a.by);
      await home(v.mode).delete(id);
    },
    lock: write('lock', lockView),
    unlock: write('unlock', unlockView),
    sequences: {
      async list(analysisId) {
        return (await all(sequences)).filter((s) => s.analysisId === analysisId);
      },
      get: (id) => maybe(sequences, id),
      async create({ analysisId, name, steps }) {
        return sequences.create(ViewSequence.parse({ id: newId(), analysisId, name, steps }));
      },
      async update(id, change) {
        const s = await maybe(sequences, id);
        if (!s) throw new Error(`there is no view sequence "${id}".`);
        return sequences.update(id, ViewSequence.parse({ ...s, ...change }));
      },
      delete: (id) => sequences.delete(id),
    },
  };
}
