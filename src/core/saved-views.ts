/**
 * Saved views and view sequences (#71, ADR-0007 and its amendments): named
 * snapshots of the arrangement, in one of three modes, written only when asked,
 * and an ordered walk through them.
 *
 * - **No autosave, and no nagging.** There is always an implicit working
 *   state, the live `ViewState`. Nothing here is needed to arrange a matrix,
 *   and `viewMarker(current, undefined)` is never modified: a reader who saves
 *   nothing is never told they have something to save.
 * - **Dirty state is per dimension**, structural, and blind to derivation and
 *   session (`dirtyDimensions`, in `view-state.ts`); revert is per dimension
 *   too (`revertDimension`). The marker names which dimensions differ.
 * - **Three modes.** `personal` lives in its owner's store; `shared` lives with
 *   the analysis, written by whoever the host permits; `locked` is shared, and
 *   no in-place write is offered to anybody until it is unlocked, which is a
 *   deliberate, attributed act the host must permit. `Save as new` is always
 *   offered, so a lock never dead-ends a reader. The mode says what kind of
 *   write is intended; the host's `authorize` says who may make it
 *   (ADR-0012): `viewAffordances` composes the two, and nothing else does.
 * - **A sequence is an ordered list of view ids**, each step with an optional
 *   caption and nothing else. A step whose view is gone is a visibly broken
 *   step that names what is missing, never closed up.
 * - **Addressable.** A view, or a sequence's step, is a URL fragment
 *   (`viewFragment`, `parseViewFragment`): a fragment in the standalone file,
 *   the same fragment on a host's link.
 *
 * Pure functions over plain records, no DOM. `comparanda/store` keeps them.
 */
import * as z from 'zod/mini';

import { hostAnswer, type Affordance } from './affordances.js';
import { dirtyDimensions, snapshotOf, ViewState, type Dimension, type SavedViewState } from './view-state.js';

export const SAVED_VIEW_MODES = ['personal', 'shared', 'locked'] as const;
export type SavedViewMode = (typeof SAVED_VIEW_MODES)[number];

/** Every change to a saved view, attributed: what an unlock is recorded as, like any other change (ADR-0011). */
export const SavedViewEvent = z.strictObject({
  act: z.enum(['created', 'renamed', 'updated', 'locked', 'unlocked']),
  by: z.string(),
  at: z.string(),
});
export type SavedViewEvent = z.infer<typeof SavedViewEvent>;

/** A saved view: a name, a mode, an owner, the arrangement without the session, and its history. */
export const SavedView = z.strictObject({
  id: z.string(),
  /** The analysis it arranges. */
  analysisId: z.string(),
  name: z.string().check(z.trim(), z.minLength(1)),
  mode: z.enum(SAVED_VIEW_MODES),
  /** Who saved it first: a personal view's only reader. */
  ownerId: z.string(),
  /** The arrangement: no session, so a cursor position can never mark it modified (ADR-0007, 2026-08-21). */
  snapshot: z.omit(ViewState, { session: true }),
  events: z.array(SavedViewEvent),
});
export type SavedView = z.infer<typeof SavedView>;

/** A step of a sequence: a saved view's id, and an optional caption. Nothing more (ADR-0007 clause 4). */
export const ViewStep = z.strictObject({ viewId: z.string(), caption: z.optional(z.string()) });
export type ViewStep = z.infer<typeof ViewStep>;

/** A named, ordered walk through saved views. */
export const ViewSequence = z.strictObject({
  id: z.string(),
  analysisId: z.string(),
  name: z.string().check(z.trim(), z.minLength(1)),
  steps: z.array(ViewStep),
});
export type ViewSequence = z.infer<typeof ViewSequence>;

/** Who acted, and when: every write is attributed. */
export interface Act { by: string; at: string }

/**
 * Save the working state as a new view: personal by default, which is always
 * allowed, the escape from a lock; shared where the host allows
 * (`createAffordance`). Never born locked: a lock is an act of its own,
 * recorded as one (`lockView`).
 */
export function createView(
  current: ViewState | SavedViewState,
  { id, analysisId, name, mode = 'personal', by, at }: { id: string; analysisId: string; name: string; mode?: SavedViewMode } & Act,
): SavedView {
  if (mode === 'locked') throw new Error('a view is locked after it is saved, as an act of its own: save it shared, then lock it.');
  const snapshot = 'session' in current ? snapshotOf(current as ViewState) : structuredClone(current);
  return SavedView.parse({ id, analysisId, name, mode, ownerId: by, snapshot, events: [{ act: 'created', by, at }] });
}

/** A saved view refused an in-place write: it is locked. The message says what to do instead. */
export class LockedViewError extends Error {
  constructor(view: Pick<SavedView, 'name'>) {
    super(`the view "${view.name}" is locked, so nobody can save over it until it is unlocked. Save as a new view instead.`);
    this.name = 'LockedViewError';
  }
}

const withEvent = (v: SavedView, act: SavedViewEvent['act'], { by, at }: Act): SavedView['events'] => [...v.events, { act, by, at }];

/** Save the working state over a view. A locked view refuses, however asked. */
export function updateView(v: SavedView, current: ViewState | SavedViewState, act: Act): SavedView {
  if (v.mode === 'locked') throw new LockedViewError(v);
  const snapshot = 'session' in current ? snapshotOf(current as ViewState) : structuredClone(current);
  return SavedView.parse({ ...v, snapshot, events: withEvent(v, 'updated', act) });
}

/** Rename a view. A locked view refuses: its name is part of what it says. */
export function renameView(v: SavedView, name: string, act: Act): SavedView {
  if (v.mode === 'locked') throw new LockedViewError(v);
  return SavedView.parse({ ...v, name, events: withEvent(v, 'renamed', act) });
}

/** Lock a shared view: nobody writes over it in place until it is unlocked. A personal one has nobody else to protect it from. */
export function lockView(v: SavedView, act: Act): SavedView {
  if (v.mode !== 'shared') throw new Error(`only a shared view can be locked; "${v.name}" is ${v.mode}.`);
  return { ...v, mode: 'locked', events: withEvent(v, 'locked', act) };
}

/** Unlock a view, as a recorded act. Whether this actor may is the host's to say (`viewAffordances`). */
export function unlockView(v: SavedView, act: Act): SavedView {
  if (v.mode !== 'locked') throw new Error(`"${v.name}" is not locked.`);
  return { ...v, mode: 'shared', events: withEvent(v, 'unlocked', act) };
}

/** Load a view into a working state: its arrangement, with the reader's session kept where they are. */
export function loadView(v: SavedView, current?: ViewState): ViewState {
  return ViewState.parse({ ...structuredClone(v.snapshot), session: current?.session ?? {} });
}

/** The marker beside a view's name: which dimensions differ from the loaded view. Nothing loaded, nothing to mark. */
export function viewMarker(current: ViewState, loaded: SavedView | undefined): { modified: boolean; dimensions: Dimension[] } {
  const dimensions = loaded ? dirtyDimensions(current, loaded.snapshot) : [];
  return { modified: dimensions.length > 0, dimensions };
}

/** A write to a saved view, as the host is asked about it. */
export type SavedViewAct = 'update' | 'rename' | 'delete' | 'lock' | 'unlock';

/** What the host is asked about: a write to a saved view, saving a new shared one, or a change to a sequence. */
export type SavedViewRequest =
  | { act: SavedViewAct | 'create'; view: SavedView; actorId: string | undefined }
  | { act: 'edit-sequence'; sequence: ViewSequence; actorId: string | undefined };

/**
 * The host's say over each write (ADR-0012), answered as `Authorize` answers
 * for the analysis: `true` or an enabled `Affordance` allows; anything else,
 * a throw included, refuses (`hostAnswer`). Absent, whatever the mode allows.
 */
export type AuthorizeView = (request: SavedViewRequest) => Affordance | boolean;

/** Whether this actor may save `view` as new: a personal view always; a shared one where the host allows. */
export function createAffordance(view: SavedView, { actorId, authorize }: { actorId: string | undefined; authorize?: AuthorizeView | undefined }): Affordance {
  if (view.mode === 'personal' || !authorize) return { enabled: true };
  return hostAnswer(() => authorize({ act: 'create', view, actorId }));
}

/** What may be done to a saved view by this actor: the mode's rule, then the host's, each refusal with its reason. */
export function viewAffordances(
  v: SavedView,
  { actorId, authorize }: { actorId: string | undefined; authorize?: AuthorizeView | undefined },
): Record<SavedViewAct | 'saveAsNew', Affordance> {
  const host = (act: SavedViewAct): Affordance => (authorize ? hostAnswer(() => authorize({ act, view: v, actorId })) : { enabled: true });
  const ifMode = (allowed: boolean, act: SavedViewAct, why: string): Affordance => (allowed ? host(act) : { enabled: false, reason: why });
  const locked = v.mode === 'locked';
  const personalOfAnother = v.mode === 'personal' && v.ownerId !== actorId;
  const lockedWhy = 'it is locked; save as a new view, or unlock it first.';
  const ownerWhy = 'it is someone else\'s personal view.';
  return {
    update: personalOfAnother ? { enabled: false, reason: ownerWhy } : ifMode(!locked, 'update', lockedWhy),
    rename: personalOfAnother ? { enabled: false, reason: ownerWhy } : ifMode(!locked, 'rename', lockedWhy),
    delete: personalOfAnother ? { enabled: false, reason: ownerWhy } : ifMode(!locked, 'delete', lockedWhy),
    lock: ifMode(v.mode === 'shared', 'lock', v.mode === 'locked' ? 'it is locked already.' : 'only a shared view can be locked.'),
    unlock: ifMode(locked, 'unlock', 'it is not locked.'),
    // Never refused: a lock must not dead-end a reader (ADR-0007 clause 3). As a personal view, which needs nobody's leave.
    saveAsNew: { enabled: true },
  };
}

/** A sequence's steps with their views, or, for a view that is gone, a broken step that says so. */
export function stepsOf(
  sequence: ViewSequence,
  views: readonly SavedView[],
): ({ step: ViewStep; view: SavedView } | { step: ViewStep; broken: string })[] {
  return sequence.steps.map((step, i) => {
    const view = views.find((x) => x.id === step.viewId);
    return view ? { step, view } : { step, broken: `step ${i + 1} names the view "${step.viewId}", which no longer exists.` };
  });
}

/** Where a fragment points: a saved view, or a step of a sequence (1-based, as a reader counts). */
export type ViewAddress = { viewId: string } | { sequenceId: string; step: number };

/** The URL fragment that loads a view or a sequence's step: `#view=<id>` or `#sequence=<id>&step=<n>`. */
export function viewFragment(address: ViewAddress): string {
  return 'viewId' in address
    ? `#view=${encodeURIComponent(address.viewId)}`
    : `#sequence=${encodeURIComponent(address.sequenceId)}&step=${address.step}`;
}

/** Read a fragment written by `viewFragment`; anything else, or a malformed one, is no address. */
export function parseViewFragment(hash: string): ViewAddress | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const view = params.get('view');
  if (view) return { viewId: view };
  const sequenceId = params.get('sequence');
  const step = Number(params.get('step') ?? '1');
  return sequenceId && Number.isInteger(step) && step >= 1 ? { sequenceId, step } : undefined;
}
