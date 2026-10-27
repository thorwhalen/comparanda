/**
 * Where saved views and view sequences are kept (#71, ADR-0007 as amended).
 *
 * A personal view lives in its owner's store, so nobody else's client ever
 * holds it, and nobody else is handed it. Shared and locked views, and
 * sequences, live beside the analysis. Each is an ordinary `DataProvider`,
 * injected, and in memory when none is given, so a host swaps in its own
 * without the rules changing.
 *
 * Every write is asked first of the provider (`getCapabilities`, ADR-0006
 * clause 3), then of `viewAffordances` / `createAffordance`
 * (`core/saved-views.ts`), where a view's mode and the host's `authorize` are
 * composed. A refused write rejects with the refusal's reason and changes
 * nothing. Writes go one at a time through this store, each built on the
 * record as it stands when its turn comes, so a lock and an update sent
 * together cannot lose the lock. That is within one store: several clients
 * writing one shared provider need its versioned write (#290). There is no
 * autosave: nothing here is called unless a person asked to save.
 *
 * What it hands out is a copy, read through the schema (and the view-state
 * migrations) on the way out: a caller who edits what it was given edits
 * nothing stored, and a malformed record is refused loudly, never shown.
 */
import { createInMemoryProvider, type DataProvider } from '@zodal/store';

import { hostAnswer, type Affordance } from '../core/affordances.js';
import {
  createAffordance, createView, lockView, renameView, SavedView, unlockView, updateView, viewAffordances, ViewSequence,
  type Act, type AuthorizeView, type SavedViewAct, type SavedViewMode, type ViewStep,
} from '../core/saved-views.js';
import { parseViewState, snapshotOf, type SavedViewState, type ViewState } from '../core/view-state.js';
import { affordanceOf, type EditAction } from './index.js';

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
  /** One view, if this actor may read it: another's personal view is not theirs to be handed. */
  get(id: string, actorId: string | undefined): Promise<SavedView | undefined>;
  /** Save as new: always allowed as a personal view, the escape from a lock; shared where the host allows. */
  create(current: ViewState | SavedViewState, options: { analysisId: string; name: string; mode?: Exclude<SavedViewMode, 'locked'> } & Act): Promise<SavedView>;
  update(id: string, current: ViewState | SavedViewState, act: Act): Promise<SavedView>;
  rename(id: string, name: string, act: Act): Promise<SavedView>;
  delete(id: string, act: Act): Promise<void>;
  lock(id: string, act: Act): Promise<SavedView>;
  unlock(id: string, act: Act): Promise<SavedView>;
  /** Sequences: an ordered list of shared view ids, each with an optional caption. */
  sequences: {
    list(analysisId: string): Promise<ViewSequence[]>;
    get(id: string): Promise<ViewSequence | undefined>;
    create(options: { analysisId: string; name: string; steps: readonly ViewStep[] }, act: Act): Promise<ViewSequence>;
    update(id: string, change: Partial<Pick<ViewSequence, 'name' | 'steps'>>, act: Act): Promise<ViewSequence>;
    delete(id: string, act: Act): Promise<void>;
  };
}

/** A random hex id, from `getRandomValues`: `randomUUID` is missing outside secure contexts. */
const randomId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** A stored view as it is handed out: a copy, its snapshot through the view-state migrations, the whole through the schema. */
function fromStore(raw: SavedView): SavedView {
  const { state } = parseViewState(JSON.stringify({ ...raw.snapshot, session: {} }));
  return SavedView.parse({ ...structuredClone(raw), snapshot: snapshotOf(state) });
}

async function maybe<T>(p: DataProvider<T>, id: string): Promise<T | undefined> {
  try {
    return await p.getOne(id);
  } catch {
    return undefined;
  }
}

/** A refusal, as the rejection a write gives: the reason, and nothing changed. */
function refused(what: string, a: Affordance): never {
  throw new Error(`${what}: ${a.reason ?? 'not allowed here.'}`);
}

export function savedViewStore({
  personal = createInMemoryProvider<SavedView>([], { idField: 'id' }),
  shared = createInMemoryProvider<SavedView>([], { idField: 'id' }),
  sequences = createInMemoryProvider<ViewSequence>([], { idField: 'id' }),
  authorize,
  newId = randomId,
}: SavedViewStoreOptions = {}): SavedViewStore {
  const home = (mode: SavedViewMode) => (mode === 'personal' ? personal : shared);
  const found = async (id: string) => {
    const raw = (await maybe(personal, id)) ?? (await maybe(shared, id));
    return raw && fromStore(raw);
  };
  const existing = async (id: string) => {
    const v = await found(id);
    if (!v) throw new Error(`there is no saved view "${id}".`);
    return v;
  };
  /** The provider first, then the mode and the host: the first refusal rejects. */
  const may = (v: SavedView, act: SavedViewAct, by: string, action: EditAction = act === 'delete' ? 'delete' : 'update') => {
    const store = affordanceOf(home(v.mode), action, { what: `the view "${v.name}"` });
    if (!store.enabled) refused(`"${v.name}" cannot be changed`, store);
    const a = viewAffordances(v, { actorId: by, authorize })[act];
    if (!a.enabled) refused(`"${v.name}" cannot be changed that way`, a);
  };
  /** One write at a time: two sent together would each build on the same record, and the second would undo the first. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(write: () => Promise<T>): Promise<T> => {
    const next = chain.then(write, write);
    chain = next.catch(() => undefined);
    return next;
  };
  /** A change to one view, asked and written on the record as it stands now. Lock and unlock keep it beside the analysis. */
  const change = (act: SavedViewAct, apply: (v: SavedView, a: Act) => SavedView) => (id: string, a: Act) => serial(async () => {
    const v = await existing(id);
    may(v, act, a.by);
    const after = apply(v, a);
    return fromStore(await home(after.mode).update(after.id, after));
  });
  const freshId = async () => {
    const id = newId();
    if ((await found(id)) ?? (await maybe(sequences, id))) throw new Error(`the new id "${id}" is already taken; nothing was saved.`);
    return id;
  };
  /** A sequence names shared views only: a personal one is not the reader's to walk, nor its id theirs to see. */
  const checkSteps = async (steps: readonly ViewStep[]) => {
    for (const { viewId } of steps) {
      if (await maybe(shared, viewId)) continue;
      throw new Error(`a sequence can name only shared views; "${viewId}" is not one.`);
    }
  };
  const maySequence = (sequence: ViewSequence, by: string, action: EditAction) => {
    const store = affordanceOf(sequences, action, { what: `the sequence "${sequence.name}"` });
    if (!store.enabled) refused(`"${sequence.name}" cannot be changed`, store);
    const host = authorize ? hostAnswer(() => authorize({ act: 'edit-sequence', sequence, actorId: by })) : { enabled: true };
    if (!host.enabled) refused(`"${sequence.name}" cannot be changed`, host);
  };

  return {
    async list(analysisId, actorId) {
      const all = async (p: DataProvider<SavedView>) => (await p.getList({})).data;
      const mine = (await all(personal)).filter((v) => v.ownerId === actorId);
      return [...mine, ...(await all(shared))].filter((v) => v.analysisId === analysisId).map(fromStore);
    },
    async get(id, actorId) {
      const v = await found(id);
      return v && (v.mode !== 'personal' || v.ownerId === actorId) ? v : undefined;
    },
    create: (current, options) => serial(async () => {
      const v = createView(current, { id: await freshId(), ...options });
      const store = affordanceOf(home(v.mode), 'create', { what: 'a view' });
      if (!store.enabled) refused('the view was not saved', store);
      const host = createAffordance(v, { actorId: options.by, authorize });
      if (!host.enabled) refused('the view was not saved as shared', host);
      return fromStore(await home(v.mode).create(v));
    }),
    update: (id, current, a) => change('update', (v, x) => updateView(v, current, x))(id, a),
    rename: (id, name, a) => change('rename', (v, x) => renameView(v, name, x))(id, a),
    delete: (id, a) => serial(async () => {
      const v = await existing(id);
      may(v, 'delete', a.by);
      await home(v.mode).delete(id);
    }),
    lock: change('lock', lockView),
    unlock: change('unlock', unlockView),
    sequences: {
      async list(analysisId) {
        return (await sequences.getList({})).data.filter((s) => s.analysisId === analysisId).map((s) => ViewSequence.parse(structuredClone(s)));
      },
      async get(id) {
        const s = await maybe(sequences, id);
        return s && ViewSequence.parse(structuredClone(s));
      },
      create: ({ analysisId, name, steps }, a) => serial(async () => {
        const s = ViewSequence.parse({ id: await freshId(), analysisId, name, steps });
        maySequence(s, a.by, 'create');
        await checkSteps(s.steps);
        return ViewSequence.parse(structuredClone(await sequences.create(s)));
      }),
      update: (id, changes, a) => serial(async () => {
        const before = await maybe(sequences, id);
        if (!before) throw new Error(`there is no view sequence "${id}".`);
        const s = ViewSequence.parse({ ...structuredClone(before), ...changes });
        maySequence(s, a.by, 'update');
        await checkSteps(s.steps);
        return ViewSequence.parse(structuredClone(await sequences.update(id, s)));
      }),
      delete: (id, a) => serial(async () => {
        const s = await maybe(sequences, id);
        if (!s) throw new Error(`there is no view sequence "${id}".`);
        maySequence(ViewSequence.parse(s), a.by, 'delete');
        await sequences.delete(id);
      }),
    },
  };
}
