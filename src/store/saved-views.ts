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
 * nothing. The same answers are read before anything is offered
 * (`affordances`, `saveAffordance`), so a view never offers a control the
 * store would refuse, and never refuses one without the reason the store
 * gives. There is no autosave: nothing here is called unless a person asked
 * to save.
 *
 * Writes go one at a time through this store, each built on the record as it
 * stands when its turn comes, so a lock and an update sent together through one
 * store cannot lose the lock: the update is refused, as any write to a locked
 * view is. Several clients write one shared provider, and there
 * `DataProvider.update` would be last-write-wins, which ADR-0011 clause 6 and
 * ADR-0006 (2026-08-22, clause 3) rule out. So shared and locked views, and
 * sequences, are read with their version and written only against it, through
 * the versioned port the analysis uses (`VersionedCollection`,
 * `versioned-source.ts`): a write another client made in between rejects with a
 * `WriteConflict` that names what moved, and nothing is written. A lock racing
 * an update ends locked, or one of the two is told it lost; never shared and
 * updated with the lock gone. `savedViewStore` versions a plain provider it is
 * given (`asVersioned`, once per provider object, so every store in the page
 * over it checks the others); a provider other pages write must honour the
 * port itself, over its own revisions. Personal views have one writer, their
 * owner, and are written plainly. The version lives in the provider, never in
 * the record, so a stored view's shape is unchanged (no migration).
 *
 * What it hands out is a copy, read through the schema (and the view-state
 * migrations) on the way out: a caller who edits what it was given edits
 * nothing stored, and a malformed record is refused loudly, never shown.
 */
import type { DataProvider } from '@zodal/store';

import { hostAnswer, type Affordance } from '../core/affordances.js';
import {
  createAffordance, createView, lockView, renameView, SavedView, unlockView, updateView, viewAffordances, ViewSequence,
  type Act, type AuthorizeView, type SavedViewAct, type SavedViewMode, type ViewStep,
} from '../core/saved-views.js';
import { parseViewState, snapshotOf, type SavedViewState, type ViewState } from '../core/view-state.js';
import { affordanceOf, type EditAction, type IdentityStorage } from './index.js';
import { localCollectionProvider, memoryCollection, type LocalCollection } from './local-collection.js';
import { asVersioned, isVersionedCollection, type VersionedCollection } from './versioned-source.js';

export interface SavedViewStoreOptions {
  /** The owner's own store, for personal views. Default: in memory. */
  personal?: DataProvider<SavedView>;
  /**
   * The analysis's store, for shared and locked views. Several clients write it, so it is written through the
   * versioned port: a plain provider is versioned here (`asVersioned`). Default: in memory, versioned.
   */
  shared?: DataProvider<SavedView>;
  /** The analysis's store for sequences, written as `shared` is. Default: in memory, versioned. */
  sequences?: DataProvider<ViewSequence>;
  /** The host's say over each write (ADR-0012). Default: whatever the mode allows. */
  authorize?: AuthorizeView;
  /** Makes a new view's or sequence's id. */
  newId?: () => string;
}

/** `versionedSavedViewStore`'s options: the shared providers already honour the versioned port, so nothing here makes them. */
export interface VersionedSavedViewStoreOptions extends Omit<SavedViewStoreOptions, 'shared' | 'sequences'> {
  shared: VersionedCollection<SavedView>;
  sequences: VersionedCollection<ViewSequence>;
}

/** What may be done to one saved view here: each write, and saving as new, each refused with its reason. */
export type SavedViewAffordances = Record<SavedViewAct | 'saveAsNew', Affordance>;

export interface SavedViewStore {
  /**
   * What this actor may do to `view` here, read before anything is offered: the
   * provider that keeps it (`getCapabilities`), then the view's mode and the
   * host (`viewAffordances`). The same answers every write is refused by.
   */
  affordances(view: SavedView, actorId: string | undefined): SavedViewAffordances;
  /**
   * Whether this actor may save the working arrangement as a new view of `mode`
   * here: the provider that would keep it, then the host (`createAffordance`).
   * The host is asked about the view as it would be saved, under `name`.
   */
  saveAffordance(
    current: ViewState | SavedViewState,
    options: { analysisId: string; mode: Exclude<SavedViewMode, 'locked'>; actorId: string | undefined; name?: string | undefined },
  ): Affordance;
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

/** The view the host is asked about before one is saved: its id is none of the store's, and its name may not be chosen yet. */
const DRAFT_ID = 'draft';
const DRAFT_NAME = 'a new view';

/** A random hex id, from `getRandomValues`: `randomUUID` is missing outside secure contexts. */
const randomId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** A stored view as it is handed out: a copy, its snapshot through the view-state migrations, the whole through the schema. */
function fromStore(raw: SavedView): SavedView {
  try {
    const { state } = parseViewState(JSON.stringify({ ...raw.snapshot, session: {} }));
    return SavedView.parse({ ...structuredClone(raw), snapshot: snapshotOf(state) });
  } catch (error) {
    throw new Error(`the stored view "${String((raw as { id?: unknown }).id)}" is not a saved view this version can read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * What `read` gives for one record, or `undefined` when the provider has none.
 * Only "has none": a provider that fails for another reason (offline) is not
 * taken for an empty one, so an id is never thought free nor a view thought gone.
 */
async function held<T extends { id: string }, R>(p: DataProvider<T>, id: string, read: () => Promise<R>): Promise<R | undefined> {
  try {
    return await read();
  } catch (error) {
    const listed = await p.getList({});
    if (listed.data.some((x) => x.id === id)) throw error;
    return undefined;
  }
}

/** One record, or `undefined` when the provider has none (`held`). */
const maybe = <T extends { id: string }>(p: DataProvider<T>, id: string) => held(p, id, () => p.getOne(id));

/** How a conflict names what it is about: the record as it stands, or as it was read when it is gone. */
const viewNamed = (v: SavedView | undefined) => (v ? `the view "${v.name}"` : 'this view');
const sequenceNamed = (s: ViewSequence | undefined) => (s ? `the sequence "${s.name}"` : 'this sequence');

/** A refusal, as the rejection a write gives: the reason, and nothing changed. */
function refused(what: string, a: Affordance): never {
  throw new Error(`${what}: ${a.reason ?? 'not allowed here.'}`);
}

/**
 * The saved-view store, over any providers: a plain `shared` or `sequences`
 * provider is versioned here (`asVersioned`), and each defaults to one in memory.
 */
export function savedViewStore({
  shared = memoryCollection<SavedView>(),
  sequences = memoryCollection<ViewSequence>(),
  ...rest
}: SavedViewStoreOptions = {}): SavedViewStore {
  return versionedSavedViewStore({
    ...rest,
    shared: asVersioned(shared, { describe: viewNamed }),
    sequences: asVersioned(sequences, { describe: sequenceNamed }),
  });
}

/**
 * The saved-view store over shared providers that already honour the versioned
 * port (`VersionedCollection`): a deployed store's, over its own revisions, or
 * one that takes no writes at all (`emptyReadOnlyProvider`, the standalone
 * page's). `savedViewStore` is this with the versioning done for you; this one
 * leaves it out, so a page that never writes a shared view does not carry it.
 */
export function versionedSavedViewStore({
  personal = memoryCollection<SavedView>(),
  shared,
  sequences,
  authorize,
  newId = randomId,
}: VersionedSavedViewStoreOptions): SavedViewStore {
  const versioned = (name: string, p: DataProvider<SavedView> | DataProvider<ViewSequence>) => {
    if (!isVersionedCollection<unknown>(p as DataProvider<unknown>)) {
      // Kept short: this ships in the standalone page, whose byte budget is tight.
      throw new TypeError(`"${name}" must be a versioned collection (markVersioned), as several clients write it; savedViewStore versions a plain one.`);
    }
  };
  versioned('shared', shared);
  versioned('sequences', sequences);
  const home = (mode: SavedViewMode) => (mode === 'personal' ? personal : shared);
  /** A view and, for a shared or locked one, the version it was read at: what its write is checked against. */
  const located = async (id: string): Promise<{ view: SavedView; version?: number } | undefined> => {
    const mine = await maybe(personal, id);
    if (mine) return { view: fromStore(mine) };
    const ours = await held(shared, id, () => shared.getVersioned(id));
    return ours && { view: fromStore(ours.item), version: ours.version };
  };
  const found = async (id: string) => (await located(id))?.view;
  /** Who may be told a view exists: anyone, for a shared one; its owner only, for a personal one. */
  const visible = (v: SavedView | undefined, actorId: string | undefined) => (v && (v.mode !== 'personal' || v.ownerId === actorId) ? v : undefined);
  /** A view this actor may write to, or the same "no such view" an unknown id gets: another's personal view is not confirmed to exist. */
  const existing = async (id: string, actorId: string) => {
    const at = await located(id);
    if (!at || !visible(at.view, actorId)) throw new Error(`there is no saved view "${id}".`);
    return at;
  };
  /**
   * Each answer gated on the provider that keeps the view: the first refusal is the one given, and the host is not
   * asked about a write the provider would refuse anyway.
   */
  const affordances = (v: SavedView, actorId: string | undefined): SavedViewAffordances => {
    const store = (act: SavedViewAct) => affordanceOf(home(v.mode), act === 'delete' ? 'delete' : 'update', { what: `the view "${v.name}"` });
    const host: AuthorizeView | undefined = authorize && ((r) => (r.act === 'create' || r.act === 'edit-sequence' || store(r.act).enabled ? authorize(r) : true));
    const mode = viewAffordances(v, { actorId, authorize: host });
    const gated = (act: SavedViewAct) => {
      const s = store(act);
      return s.enabled ? mode[act] : s;
    };
    const keep = affordanceOf(personal, 'create', { what: 'a view' });
    return {
      update: gated('update'), rename: gated('rename'), delete: gated('delete'), lock: gated('lock'), unlock: gated('unlock'),
      // As a personal view, which needs nobody's leave: only somewhere to keep it.
      saveAsNew: keep.enabled ? mode.saveAsNew : keep,
    };
  };
  /** Whether `v`, not yet saved, may be: the provider that would keep it, then the host. */
  const creatable = (v: SavedView, actorId: string | undefined): Affordance => {
    const store = affordanceOf(home(v.mode), 'create', { what: v.mode === 'personal' ? 'a view' : `a ${v.mode} view` });
    return store.enabled ? createAffordance(v, { actorId, authorize }) : store;
  };
  /** A write, asked first: the first refusal rejects, with its reason, and nothing is written. */
  const may = (v: SavedView, act: SavedViewAct, by: string) => {
    const a = affordances(v, by)[act];
    if (!a.enabled) refused(`"${v.name}" cannot be changed`, a);
  };
  /** One write at a time: two sent together would each build on the same record, and the second would undo the first. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(write: () => Promise<T>): Promise<T> => {
    const next = chain.then(write, write);
    chain = next.catch(() => undefined);
    return next;
  };
  /**
   * A change to one view, asked and written on the record as it stands now. Lock and unlock keep it beside the
   * analysis, where the write is checked against the version read: another client's write in between is a conflict.
   */
  const change = (act: SavedViewAct, apply: (v: SavedView, a: Act) => SavedView) => (id: string, a: Act) => serial(async () => {
    const { view: v, version } = await existing(id, a.by);
    may(v, act, a.by);
    const after = apply(v, a);
    return fromStore(version === undefined ? await personal.update(after.id, after) : (await shared.updateIfVersion(after.id, after, version)).item);
  });
  const freshId = async () => {
    const id = newId();
    if ((await found(id)) ?? (await maybe(sequences, id))) throw new Error(`the new id "${id}" is already taken; nothing was saved.`);
    return id;
  };
  /**
   * The steps a change adds name shared views of the same analysis: a personal one is not the reader's to walk, nor
   * its id theirs to see. Steps already there are not asked again: a view deleted since is a broken step, shown as
   * one (`stepsOf`), never a reason the sequence cannot be renamed.
   */
  const checkSteps = async (analysisId: string, steps: readonly ViewStep[], already: readonly ViewStep[] = []) => {
    for (const { viewId } of steps) {
      if (already.some((s) => s.viewId === viewId)) continue;
      const raw = await maybe(shared, viewId);
      if (raw && fromStore(raw).analysisId === analysisId) continue;
      throw new Error(`a sequence can name only this analysis's shared views; "${viewId}" is not one.`);
    }
  };
  /** A sequence and the version it was read at, or the refusal an unknown id gets. */
  const sequenceAt = async (id: string) => {
    const at = await held(sequences, id, () => sequences.getVersioned(id));
    if (!at) throw new Error(`there is no view sequence "${id}".`);
    return at;
  };
  const maySequence = (sequence: ViewSequence, by: string, action: EditAction) => {
    const store = affordanceOf(sequences, action, { what: `the sequence "${sequence.name}"` });
    if (!store.enabled) refused(`"${sequence.name}" cannot be changed`, store);
    const host = authorize ? hostAnswer(() => authorize({ act: 'edit-sequence', sequence, actorId: by })) : { enabled: true };
    if (!host.enabled) refused(`"${sequence.name}" cannot be changed`, host);
  };

  return {
    affordances,
    saveAffordance: (current, { analysisId, mode, actorId, name = DRAFT_NAME }) =>
      creatable(createView(current, { id: DRAFT_ID, analysisId, name: name.trim() || DRAFT_NAME, mode, by: actorId ?? '', at: '' }), actorId),
    async list(analysisId, actorId) {
      const all = async (p: DataProvider<SavedView>) => (await p.getList({})).data;
      const mine = (await all(personal)).filter((v) => v.ownerId === actorId);
      return [...mine, ...(await all(shared))].filter((v) => v.analysisId === analysisId).map(fromStore);
    },
    get: async (id, actorId) => visible(await found(id), actorId),
    create: (current, options) => serial(async () => {
      const v = createView(current, { id: await freshId(), ...options });
      const a = creatable(v, options.by);
      if (!a.enabled) refused(v.mode === 'personal' ? 'the view was not saved' : `the view was not saved as ${v.mode}`, a);
      return fromStore(await home(v.mode).create(v));
    }),
    update: (id, current, a) => change('update', (v, x) => updateView(v, current, x))(id, a),
    rename: (id, name, a) => change('rename', (v, x) => renameView(v, name, x))(id, a),
    delete: (id, a) => serial(async () => {
      const { view: v, version } = await existing(id, a.by);
      may(v, 'delete', a.by);
      await (version === undefined ? personal.delete(id) : shared.deleteIfVersion(id, version));
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
        await checkSteps(s.analysisId, s.steps);
        return ViewSequence.parse(structuredClone(await sequences.create(s)));
      }),
      update: (id, changes, a) => serial(async () => {
        const { item: before, version } = await sequenceAt(id);
        const s = ViewSequence.parse({ ...structuredClone(before), ...changes });
        maySequence(s, a.by, 'update');
        await checkSteps(s.analysisId, s.steps, before.steps);
        return ViewSequence.parse(structuredClone((await sequences.updateIfVersion(id, s, version)).item));
      }),
      delete: (id, a) => serial(async () => {
        const { item: s, version } = await sequenceAt(id);
        maySequence(ViewSequence.parse(s), a.by, 'delete');
        await sequences.deleteIfVersion(id, version);
      }),
    },
  };
}

/**
 * A reader's personal views of one analysis, kept in this browser (#117): the
 * personal provider for the standalone page, with `localCollectionProvider`'s
 * fallback chain and its notice. One key per analysis, since every page opened
 * from `file://` shares one origin. A stored view this version cannot read (a
 * newer field, a tampered record) is not listed, and is written back unchanged.
 */
export function localSavedViews(
  analysisId: string,
  { storage, key = `comparanda.saved-views.${analysisId}` }: { storage?: IdentityStorage; key?: string } = {},
): LocalCollection<SavedView> {
  return localCollectionProvider<SavedView>({ key, ...(storage ? { storage } : {}), accept: readable });
}

/** Whether this version can read a stored view: the store's own reading of it. One it cannot is left in storage as it was, never listed. */
function readable(raw: unknown): raw is SavedView {
  try {
    fromStore(raw as SavedView);
    return true;
  } catch {
    return false;
  }
}
