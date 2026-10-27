/**
 * `mountMatrix(el, props) => { update, destroy }` -- the public mounting
 * contract (ADR-0017 clause 5), framework-agnostic, on Preact.
 *
 * Any framework wraps this in a dozen lines (README); no `comparanda/react`
 * ships in v1. Everything that outlives one render lives here and nowhere else:
 * the source subscription, the current props, the element's claim. The
 * component it renders is a pure function, so `destroy` has exactly one
 * subscription and one tree to release, and leaves no listener or timer behind.
 */
import { h, render, type ComponentType } from 'preact';

import { unknownMeasure, vocabularyOf, type Analysis } from '../core/schema/analysis.js';
import { assertionVisibility, type ViewerContext } from '../core/schema/redaction.js';
import { threadDoing, type Affordance, type Affordances, type ThreadAct } from '../core/affordances.js';
import type { decideSuggestions as DecideSuggestions } from '../core/suggestions.js';
import { initialViewState, setDetailPanel, setFocus, ViewState, type Session } from '../core/view-state.js';
import { focusInLayout, matrixLayout } from '../core/layout.js';
import {
  anonymousIdentity, DEFAULT_CAPABILITIES, editAffordances, isVersioned, takesName, type AnalysisSource, type DataChangeEvent, type DataProvider, type IdentityProvider,
} from '../store/index.js';

/** Who writes when the host names no one: usable, not a stub (ADR-0012). */
const DEFAULT_IDENTITY = anonymousIdentity();
/** What the anonymous identity is called (`anonymousIdentity`'s default id). */
const DEFAULT_IDENTITY_ID = 'anonymous';
import { createEncodingRegistry, type EncodingRegistry } from './encodings/registry.js';
import type { Author } from '../core/schema/provenance.js';
import { commentTarget, reopenThread, replyToThread, resolveThread, startThread } from '../core/threads.js';
import type { Anchor } from '../core/schema/annotations.js';
import type { ThreadWrites } from './threads.js';
import type { SuggestionWrites } from './suggestions.js';
import type { ReattachWrite } from './orphans.js';
import { reattach } from '../core/orphans.js';
import { joinGroup } from '../core/group-membership.js';
import type { Axis } from '../core/schema/groups.js';
import { textOnly } from './encodings/shipped.js';
import { Matrix, TEXT_ONLY, type Arrangement, type MatrixViewProps } from './matrix.js';
import type { MatrixPropsUpdate, MountMatrixProps } from './props.js';
import { trackStickyExtents } from './sticky.js';
import { activeElementOf } from './dom.js';

/** What `mountMatrix` returns. */
export interface MatrixHandle {
  /**
   * Re-render with these props changed. An optional prop given as `undefined`
   * is cleared; with `{ replace: true }` every prop not given is cleared, which
   * is what a framework wrapper wants. Changing `source` needs that source's
   * `analysis` in the same call. All or nothing: an update that throws changes
   * nothing.
   */
  update(next: MatrixPropsUpdate, options?: { replace?: boolean }): void;
  /** Unsubscribe from the source and empty the element. Safe to call twice. */
  destroy(): void;
}

export interface MountOptions {
  /** What renders the resolved props. Default: `Matrix`. The seam #89 grows behind, and tests observe through. */
  component?: ComponentType<MatrixViewProps>;
  /**
   * The encodings this matrix can draw, assembled by the caller (ADR-0010
   * clause 8): `createEncodingRegistry([textOnly, value, missingness])`, or
   * `createEncodingRegistry(SHIPPED_ENCODINGS)` for all nine. Default:
   * `text-only` alone (ADR-0032), so a consumer ships only the encodings it names.
   */
  encodings?: EncodingRegistry;
  /** The time a thread write records. Default: the system clock. */
  now?: () => Date;
  /** Mints thread and comment ids. Default: a random version-4 UUID, from `crypto.randomUUID` where the context offers it. */
  newId?: () => string;
  /**
   * Seriation as an action, registered like an encoding (ADR-0017 clause 4):
   * pass core's `arrangeToRevealStructure` to offer "arrange to reveal
   * structure" on each axis. Not by default: the seriation analysis is a large
   * share of the standalone page's byte budget, so a build ships it by naming it.
   */
  arrange?: MatrixViewProps['arrange'];
  /**
   * Analysis panels, registered like `arrange` (#253): pass `[AgreementPanel]`
   * to draw per-criterion agreement and the camps' common ground below the
   * grid. None by default, for the same byte-budget reason.
   */
  panels?: MatrixViewProps['panels'];
  /**
   * Lets the suggestions panel write its staged decisions (#256): pass core's
   * `decideSuggestions`. Registered like `arrange`, not by default: it carries
   * the document's revision checks, about 47 kB of the standalone page's budget,
   * and that page has no source to write to anyway. Without it, accept and
   * decline are shown refused, with the reason.
   */
  decideSuggestions?: typeof DecideSuggestions;
}

/**
 * Without a source there is nothing to write to: every write affordance is
 * refused by the same path a frozen source takes, and `withoutSource` then
 * words the reason about the matrix rather than about a source it lacks.
 */
const NO_SOURCE: Pick<DataProvider<unknown>, 'getCapabilities'> = {
  getCapabilities: () => ({
    ...DEFAULT_CAPABILITIES, canCreate: false, canUpdate: false, canDelete: false,
    canBulkUpdate: false, canBulkDelete: false, canUpsert: false,
  }),
};

/**
 * The write affordances without a source, in words about the matrix rather
 * than about a source that does not exist. Still asked through, so a malformed
 * request (an empty `doing`, an unknown decision) throws as it would with one.
 */
function withoutSource(a: Affordances): Affordances {
  const refused = Object.freeze({ enabled: false, reason: 'there is no source behind this matrix, so it does not accept updates; it is read-only.' });
  return {
    ...a,
    assert: () => refused,
    suggest: () => refused,
    comment: (_target, act) => (threadDoing(act), refused),
    revise: (doing, target) => (a.revise(doing, target), refused),
    changeLock: () => refused,
    decideSuggestion: (id, decision) => (a.decideSuggestion(id, decision), refused),
  };
}

/** Every prop `mountMatrix` reads. A key outside this list is a typo, and is refused rather than ignored. */
const PROP_KEYS = [
  'analysis', 'measure', 'vocabulary', 'encoding', 'view', 'standing', 'viewer', 'vouched', 'source', 'authorize', 'onViewChange', 'identity', 'notice',
] as const satisfies readonly (keyof MountMatrixProps)[];

/** Which assertions' authors the rounds hide from `viewer`, as a string to compare: equal strings, equal view. */
function hiddenAuthors(a: Analysis, viewer: ViewerContext): string {
  return a.cells.flatMap((c) => c.assertions.filter((s) => !assertionVisibility(a, s, viewer).author).map((s) => s.id)).join('\n');
}

/** Elements with a live matrix. Two mounts on one element would each think they own its children. */
const mounted = new WeakSet<object>();

/**
 * Render a matrix into `el` and keep it current.
 *
 * With a `source`, the view subscribes to it and re-renders on every write to
 * this analysis; `analysis` is the document as of mount (`await source.getOne(id)`).
 * Without one, it shows `analysis` read-only until `update` says otherwise.
 */
export function mountMatrix(
  el: Element, props: MountMatrixProps,
  { component = Matrix, encodings, now = () => new Date(), newId = randomUuid, arrange, panels, decideSuggestions }: MountOptions = {},
): MatrixHandle {
  const registry = encodings ?? createEncodingRegistry([textOnly]);
  if (el === null || typeof el !== 'object' || typeof (el as { appendChild?: unknown }).appendChild !== 'function') {
    throw new TypeError(`mountMatrix needs a DOM element to render into; got ${describe(el)}.`);
  }
  if (mounted.has(el)) {
    throw new Error('this element already holds a matrix: call update() on its handle, or destroy() it first.');
  }
  let current: MountMatrixProps = checked(props);
  measureOf(current.analysis, current.measure);
  /** The document shown: the props' until the source writes, then the source's. */
  let analysis: Analysis = current.analysis;
  let unsubscribe: (() => void) | undefined;
  let destroyed = false;
  /** The sticky header's extents, as the scroll padding focus is kept clear of (#103). */
  const sticky = trackStickyExtents(el);
  /**
   * Where the reader moved, and whether they opened the detail panel, since the
   * host last said: the matrix's own session state, laid over the host's
   * `view`, each part until the host gives a `view` that says something new
   * about that part: a host that keeps only focus does not close the panel.
   */
  let moved: {
    focus?: Session['focus']; panel?: boolean; orders?: Pick<ViewState, 'alternativeOrder' | 'criterionOrder'>; encoding?: string; arranged?: Arrangement;
  } | undefined;
  /** The last sentence for the live region, and how many have been said, so a repeat is heard again. */
  let announcement: string | undefined;
  let said = 0;
  /** Who the identity said it is, and which identity said it (ADR-0012). */
  let known: { identity: IdentityProvider; id: string } | undefined;
  const inForce = () => current.identity ?? DEFAULT_IDENTITY;
  /** Who is acting, for the order's provenance and as the viewer: the id the identity in force gave; until it answers, nobody known. */
  const actor = () => (known?.identity === inForce() ? known.id : undefined);
  /** Who the last render was drawn for, to tell whether a new reader changes what it shows. */
  let drawnFor: string | undefined;
  /** Whether the last render asked for a name (#193). */
  let drawnAskingName = false;
  /** The identity's id as a viewer: the anonymous identity is nobody in particular, and must not be taken for an author who happens to be called that. */
  const viewerIdOf = (id: string | undefined) => (id === DEFAULT_IDENTITY_ID ? undefined : id);
  /** A name is asked for while the source takes writes and the identity is one that takes a name, known to have none (#193). */
  const asksName = () => !!current.source && takesName(inForce()) && actor() === DEFAULT_IDENTITY_ID;
  /**
   * Redraw if, and only if, the reader now known sees something different from
   * the render drawn for the last one: other authors hidden, or a name asked for
   * or no longer. A redraw for nothing resets what the reader is in the middle of.
   */
  const refreshViewer = () => {
    if (destroyed) return;
    const at = now().toISOString();
    const othersHidden = !current.viewer
      && hiddenAuthors(analysis, { viewerId: drawnFor, now: at }) !== hiddenAuthors(analysis, { viewerId: viewerIdOf(actor()), now: at });
    if (othersHidden || drawnAskingName !== asksName()) draw();
  };
  const learnActor = (identity = inForce()) => {
    // Until the new identity answers, nobody known: the previous one must not sign moves made in the gap, or see what only they may.
    known = undefined;
    refreshViewer();
    // Only the identity still in force: a slow one the host has since replaced, or cleared, never signs a move.
    identity.current().then((a) => {
      if (inForce() !== identity) return;
      known = { identity, id: a.id };
      refreshViewer();
    }, () => undefined);
  };
  /** What the `view` the caller last gave said about the session, to tell a new one from a re-passed one. */
  let givenFocus = sessionIn(props.view);
  /** The view state of the last render: what `onViewChange` reports. */
  let shown: ViewState;
  /** Whether the last render moved the reader's focus off something it no longer shows (#283): reported once by whoever drew. */
  let focusSettled = false;
  /** After a render nobody else reports (a host's update, a source's write): report a focus it settled. */
  const reportSettled = () => {
    if (focusSettled) current.onViewChange?.(shown);
  };

  /** Lay a session change over the host's view and render it; a render that throws changes nothing. */
  const moveSession = (change: NonNullable<typeof moved>) => {
    const before = moved;
    const was = focused();
    moved = { ...moved, ...change };
    try {
      draw();
    } catch (error) {
      moved = before;
      redraw(was);
      throw error;
    }
  };
  const moveFocus = (focus: Session['focus']) => {
    if (destroyed) return;
    moveSession({ focus });
    current.onViewChange?.(shown);
  };
  /** Say a sentence in the live region. The same sentence twice is still news: a trailing no-break space alternates so the region changes. */
  const announce = (sentence: string) => {
    said += 1;
    announcement = said % 2 === 0 ? `${sentence}\u00a0` : sentence;
  };
  /**
   * The reader rearranged an axis: laid over the host's order until the host
   * gives a view with a different one, announced, and reported.
   */
  const reorder = (state: ViewState, sentence: string) => {
    if (destroyed) return;
    announce(sentence);
    const same = JSON.stringify([state.alternativeOrder, state.criterionOrder]) === JSON.stringify([shown.alternativeOrder, shown.criterionOrder]);
    // Said, but nothing moved (a pick-up, a put-down, a refusal): no new arrangement to lay over the host's or report.
    if (same) return moveSession({});
    moveSession({ orders: { alternativeOrder: state.alternativeOrder, criterionOrder: state.criterionOrder } });
    current.onViewChange?.(shown);
  };
  /** The reader switched encoding by key (ADR-0024): laid over the host's until the host says something new about it. */
  const changeEncoding = (id: string, sentence: string) => {
    if (destroyed) return;
    announce(sentence);
    moveSession({ encoding: id });
    current.onViewChange?.(shown);
  };
  /**
   * The reader grouped, selected or hid (#93): each part laid over the host's
   * until the host says something new about that part, announced, and reported.
   */
  const rearrange = (change: Arrangement, sentence: string) => {
    if (destroyed) return;
    announce(sentence);
    moveSession({ arranged: { ...moved?.arranged, ...change } });
    current.onViewChange?.(shown);
  };
  /** Open or close the detail panel; `into` moves focus to its heading once it is drawn. */
  const changePanel = (open: boolean, { into = false }: { into?: boolean } = {}) => {
    if (destroyed) return;
    moveSession({ panel: open });
    if (open && into) el.querySelector<HTMLElement>('[data-panel-heading]')?.focus();
    current.onViewChange?.(shown);
  };

  /** The thread writes in flight, chained so each builds on the last. */
  let writes: Promise<unknown> = Promise.resolve();
  /**
   * A thread write, through the source the matrix follows: who is acting comes
   * from the host's identity (the anonymous one by default, ADR-0012). Writes
   * are queued and each is built on the source's latest document, so none
   * undoes another. The source's event re-renders the matrix; nothing here draws.
   */
  const writeDocument = (
    ask: (latest: Analysis, may: Affordances) => Affordance | undefined,
    change: (a: Analysis, author: Author, at: string) => Analysis,
    what: string,
  ): Promise<void> => {
    const run = async () => {
      const { source, identity = DEFAULT_IDENTITY, authorize } = current;
      const id = analysis.id;
      if (destroyed || !source) throw new Error('there is no source behind this matrix to write to.');
      /** After every wait: a write the host has since cut off (destroyed, swapped source or document) is not made. */
      const stillHere = () => {
        if (destroyed || current.source !== source || analysis.id !== id) {
          throw new Error(`the matrix changed document while ${what} was being written; nothing was written.`);
        }
      };
      const author = await identity.current();
      stillHere();
      // The source's own latest document, not the one shown: a write in flight may not have come back as an event yet.
      // A versioned source is read with its version, and written only against it: another contributor's write in between is a conflict, never overwritten (ADR-0011 clause 6).
      const versioned = isVersioned(source) ? await source.getVersioned(id) : undefined;
      const latest = versioned ? versioned.item : await source.getOne(id);
      stillHere();
      if (!latest) throw new Error(`the source no longer holds this analysis ("${id}"); nothing was written.`);
      // Asked again of the document being written, not the one the button was drawn from: the host is never overruled (ADR-0012).
      const may = ask(latest, editAffordances(source, latest, authorize ? { authorize } : {}));
      if (may && !may.enabled) throw new Error(may.reason);
      const written = change(latest, author, now().toISOString());
      if (versioned && isVersioned(source)) await source.updateIfVersion(id, written, versioned.version);
      // A source with no versions is the host's own last-write-wins: ADR-0011 clause 6 asks hosts with several contributors to supply a versioned one.
      else await source.update(id, written);
    };
    // One write at a time: two sent together would each build on the same document, and the second would undo the first.
    const next = writes.then(run, run);
    writes = next.catch(() => undefined);
    return next;
  };
  const writeThread = (act: ThreadAct, anchorOf: (a: Analysis) => Anchor | undefined, change: (a: Analysis, author: Author, at: string) => Analysis, threadId?: string): Promise<void> =>
    writeDocument((latest, may) => {
      const anchor = anchorOf(latest);
      return anchor && may.comment(commentTarget(anchor), act, threadId === undefined ? {} : { threadId });
    }, change, 'the comment');
  /** "Group with…" (#279): the entry joins the group in the document, asked of `revise` on the latest one, and said either way. */
  const joinGroupWrite = (axis: Axis, id: string, groupId: string) => {
    const name = (axis === 'alternatives' ? analysis.alternatives : analysis.criteria).find((e) => e.id === id)?.label ?? id;
    const group = analysis.groups.find((g) => g.id === groupId)?.label ?? groupId;
    writeDocument((_latest, may) => may.revise('adding an entry to a group'), (a) => joinGroup(a, axis, id, groupId), 'the grouping').then(
      () => { announce(`${name} is now in ${group}.`); if (!destroyed) draw(); },
      (e: unknown) => { announce(`${name} was not added to ${group}: ${e instanceof Error ? e.message : String(e)}`); if (!destroyed) draw(); },
    );
  };
  /** Move an orphan to a live anchor (#249), asked of the new anchor's comment affordance on the latest document. */
  const reattachWrite: ReattachWrite = (which, anchor) => writeDocument(
    (_latest, may) => may.comment(commentTarget(anchor), 'reattach', which.kind === 'thread' ? { threadId: which.id } : {}),
    (a) => reattach(a, which, anchor),
    'the re-attachment',
  );
  /** Staged suggestion decisions (#256), written as one change: every one is asked again of the latest document first. */
  const suggestionWrites: SuggestionWrites | undefined = decideSuggestions && {
    decide: (choices) => writeDocument(
      (_latest, may) => choices.map((c) => may.decideSuggestion(c.suggestionId, c.decision)).find((x) => !x.enabled),
      (a, by, at) => decideSuggestions(a, choices, { by, at }).analysis,
      'the decisions',
    ),
  };
  /**
   * The name a local identity writes under, taken from the panel (#193): once
   * it answers to it, the field is gone. Never a rename: an identity named
   * meanwhile (another tab, the host) keeps the name it has.
   */
  const takeName = async (typed: string): Promise<void> => {
    const identity = inForce();
    if (destroyed || !takesName(identity)) throw new Error('this matrix\'s identity does not take a name.');
    const already = await identity.current();
    const author = already.id === DEFAULT_IDENTITY_ID ? await identity.name(typed) : already;
    // Only the identity still in force: one the host has since replaced keeps its own.
    if (destroyed || inForce() !== identity) return;
    known = { identity, id: author.id };
    refreshViewer();
  };
  /** A thread's anchor in a document; absent, the thread's own write says there is no such thread. */
  const anchorIn = (threadId: string) => (a: Analysis) => a.threads.find((t) => t.id === threadId)?.anchor;
  const threadWrites: ThreadWrites = {
    start: (anchor, body) => writeThread('start', () => anchor, (a, author, at) =>
      startThread(a, { threadId: newId(), anchor, comment: { id: newId(), at, body, author } })),
    reply: (threadId, body) => writeThread('reply', anchorIn(threadId), (a, author, at) => replyToThread(a, threadId, { id: newId(), at, body, author }), threadId),
    resolve: (threadId) => writeThread('resolve', anchorIn(threadId), (a, by, at) => resolveThread(a, threadId, { by, at }), threadId),
    reopen: (threadId) => writeThread('reopen', anchorIn(threadId), (a, by, at) => reopenThread(a, threadId, { id: newId(), by, at }), threadId),
  };

  const draw = () => {
    const { measure, vocabulary, encoding, view, standing, source, authorize } = current;
    const viewer = current.viewer ?? { viewerId: viewerIdOf(actor()), now: now().toISOString() };
    drawnFor = viewer.viewerId;
    drawnAskingName = asksName();
    // Without one, the document's own order, so a source's added alternative shows.
    const base = view ?? initialViewState(analysis);
    shown = moved && 'focus' in moved ? setFocus(base, moved.focus) : base;
    if (moved?.panel !== undefined) shown = setDetailPanel(shown, moved.panel);
    if (moved?.orders) shown = { ...shown, ...moved.orders };
    if (moved?.encoding) shown = { ...shown, encoding: moved.encoding };
    if (moved?.arranged) shown = { ...shown, ...moved.arranged };
    // A focus on what is no longer shown (hidden, tombstoned) settles where the grid's stop is, and stays there.
    const settledFocus = focusInLayout(matrixLayout(analysis, shown), shown.session.focus);
    focusSettled = settledFocus !== shown.session.focus;
    if (focusSettled) shown = setFocus(shown, settledFocus);
    const resolved: MatrixViewProps = {
      analysis,
      measure,
      vocabulary: vocabulary ?? vocabularyOf(analysis),
      encoding: moved?.encoding ?? encoding ?? view?.encoding ?? TEXT_ONLY,
      view: shown,
      onFocusChange: moveFocus,
      onPanelChange: changePanel,
      onReorder: reorder,
      onEncodingChange: changeEncoding,
      onArrange: rearrange,
      ...(current.notice ? { notice: current.notice } : {}),
      actor: () => actor() ?? DEFAULT_IDENTITY_ID,
      ...(arrange ? { arrange } : {}),
      ...(panels ? { panels } : {}),
      ...(announcement !== undefined ? { announcement } : {}),
      ...(source ? { onJoinGroup: joinGroupWrite } : {}),
      ...(source ? { threadWrites: drawnAskingName ? { ...threadWrites, name: takeName } : threadWrites, reattachWrite } : {}),
      ...(source && suggestionWrites ? { suggestionWrites } : {}),
      encodings: registry,
      affordances: source
        ? editAffordances(source, analysis, authorize ? { authorize } : {})
        : withoutSource(editAffordances(NO_SOURCE, analysis, authorize ? { authorize } : {})),
      ...(standing ? { standing } : {}),
      ...(current.vouched ? { vouched: current.vouched } : {}),
      // The caller's, else the reader the identity names at the moment drawn: an outside reader, if no one has said who they are.
      viewer,
    };
    const was = focused();
    const inPanel = inPanelOf(was);
    render(h(component, resolved), el);
    // Kept only once drawn: a render that throws leaves the reader's focus where it was.
    if (focusSettled) moved = { ...moved, focus: settledFocus };
    // Before focus moves: a focus that scrolls must already see the padding.
    sticky.measure();
    settle(was, inPanel);
  };

  /** The focused element, if it is in the matrix; read from the root it lives in, a shadow root's own. */
  const focused = (): Element | null => {
    const active = activeElementOf(el);
    return active !== null && el.contains(active) ? active : null;
  };
  /**
   * A reader who was in the matrix before a render is on the roving stop after
   * it: a render that moved the focused cell (a reorder, a transpose, a
   * rollback) can drop focus, and a host that moved the stop leaves focus on a
   * cell that is no longer one -- two tab stops, where ADR-0027 allows one.
   */
  /** Whether focus was in this matrix's details panel. Asked of the element as it was found: a removed control keeps its ancestors only until the render. */
  const inPanelOf = (was: Element | null) => {
    const panel = was?.closest('aside.comparanda-panel');
    // This matrix's own panel, or one a failed render has already detached; never a host's panel around the matrix.
    return panel != null && (!panel.isConnected || el.contains(panel));
  };
  const settle = (was: Element | null, inPanel = false) => {
    if (was === null) return;
    const now = focused();
    // Focus lost from inside the details panel (a control that left with its write) stays in the panel, on its heading,
    // never passing through the grid (#275).
    const heading = inPanel && now === null ? el.querySelector<HTMLElement>('[data-panel-heading]') : null;
    if (heading) return heading.focus();
    const stop = el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]');
    if (stop && (now === null || (now !== stop && now.matches('[data-cell]')))) stop.focus();
  };

  /** Subscribe to `source`; the returned function unsubscribes. */
  const follow = (source: AnalysisSource | undefined): (() => void) | undefined => {
    if (!source) return undefined;
    // Checked against the props on every event, not captured: during an update
    // both sources are briefly live, and the one not in the props is ignored.
    return source.subscribe!((event: DataChangeEvent<Analysis>) => {
      if (destroyed || current.source !== source) return;
      if (event.type !== 'updated' || event.id !== analysis.id) return;
      const before = analysis;
      const was = focused();
      analysis = event.item;
      try {
        draw();
      } catch (error) {
        // A write the view cannot render leaves the last good render, and the
        // document it rendered; the error goes to the source's subscriber handler.
        analysis = before;
        redraw(was);
        throw error;
      }
      reportSettled();
    });
  };

  /**
   * Render from scratch. A render that threw part-way leaves Preact's record of
   * the tree half-updated, and every later diff against it fails; unmounting
   * first is what makes a rollback a rollback.
   */
  /** `was`: where focus was before the render that failed, which may already have dropped it. */
  const redraw = (was: Element | null = focused()) => {
    render(null, el);
    // If the old props fail too, unmount again: an empty element and a clean
    // tree, so the next good render fills it rather than diffing against debris.
    try { draw(); } catch { render(null, el); }
    settle(was, inPanelOf(was));
  };

  mounted.add(el);
  try {
    unsubscribe = follow(current.source);
    learnActor();
    draw();
  } catch (error) {
    // A mount that failed holds nothing: no subscription, no claim, no half a tree.
    destroyed = true;
    unsubscribe?.();
    sticky.release();
    render(null, el);
    mounted.delete(el);
    throw error;
  }

  return {
    update(next, { replace = false } = {}) {
      if (destroyed) throw new Error('this matrix was destroyed; mount a new one instead of updating it.');
      unknownKeys(next);
      const merged: Record<string, unknown> = replace ? {} : { ...current };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }
      const props = checked(merged as unknown as MountMatrixProps);
      const swapped = props.source !== current.source;
      // The new source's document, as a new object: re-passing the document
      // already given (a wrapper in replace mode) would show the old source's
      // document gated on the new source's capabilities.
      if (swapped && props.source && (next.analysis === undefined || next.analysis === current.analysis)) {
        throw new TypeError(
          'a new source needs its own document in the same update, as an object not given before: ' +
            'update({ source, analysis: await source.getOne(id) }), fetched at the time of the swap. ' +
            'Without it the matrix would show the old source\'s document gated on the new source\'s capabilities.',
        );
      }
      // The document changes when the caller hands over a different one, or a
      // different source. Re-passing the same props object (a framework wrapper
      // on every render) must not undo writes the source has delivered since.
      const docChanged = props.analysis !== current.analysis || (swapped && props.source !== undefined);
      const nextAnalysis = docChanged ? props.analysis : analysis;
      // Against the document that will be shown, which a source may have moved
      // on from the props'; and only when the caller changed the measure or the
      // document, so a source that dropped a measure does not refuse every
      // re-render of unchanged props.
      if (props.measure !== current.measure || docChanged) measureOf(nextAnalysis, props.measure);

      // A view that says something new about focus (typically the one
      // `onViewChange` sent back) replaces the reader's move; any other -- the
      // same one re-passed, or a transpose or regroup the host made -- keeps it.
      const nextFocus = replace || 'view' in next ? sessionIn(next.view) : givenFocus;
      const before = { current, analysis, unsubscribe, moved, givenFocus };
      const was = focused();
      const followed = swapped ? follow(props.source) : unsubscribe;
      current = props;
      analysis = nextAnalysis;
      unsubscribe = followed;
      // Each part of the reader's session yields only to a host that says something new about that part.
      if (moved) {
        const kept = { ...moved };
        if (nextFocus.focus !== givenFocus.focus) delete kept.focus;
        if (nextFocus.panel !== givenFocus.panel) delete kept.panel;
        if (nextFocus.orders !== givenFocus.orders) delete kept.orders;
        if (nextFocus.encoding !== givenFocus.encoding || 'encoding' in next) delete kept.encoding;
        if (kept.arranged) {
          const arranged = { ...kept.arranged };
          for (const part of ARRANGED) if (nextFocus[part] !== givenFocus[part]) delete arranged[part];
          kept.arranged = arranged;
        }
        moved = kept;
      }
      givenFocus = nextFocus;
      try {
        draw();
      } catch (error) {
        // All or nothing, as at mount: the previous props, document and
        // subscription come back, and so does the previous render.
        if (swapped) followed?.();
        ({ current, analysis, unsubscribe, moved, givenFocus } = before);
        redraw(was);
        throw error;
      }
      if (swapped) before.unsubscribe?.();
      reportSettled();
      if (props.identity !== before.current.identity) learnActor();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      sticky.release();
      render(null, el);
      mounted.delete(el);
    },
  };
}

/** The props, or an error that says which one is wrong and what was given. */
function checked(props: MountMatrixProps): MountMatrixProps {
  if (props === null || typeof props !== 'object') {
    throw new TypeError(`mountMatrix needs props ({ analysis, measure, ... }); got ${describe(props)}.`);
  }
  unknownKeys(props);
  const { analysis, measure, view, source } = props;
  if (analysis === null || typeof analysis !== 'object' ||
    !Array.isArray(analysis.alternatives) || !Array.isArray(analysis.criteria)) {
    throw new TypeError(
      `props.analysis must be a parsed Analysis (Analysis.parse(json)), with alternatives and criteria arrays; got ${describe(analysis)}.`,
    );
  }
  if (typeof measure !== 'string' || measure.trim() === '') {
    throw new TypeError(`props.measure must name a measure ("score", "confidence", or a declared one); got ${describe(measure)}.`);
  }
  if (view !== undefined) {
    const parsed = ViewState.safeParse(view);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new TypeError(
        `props.view must be a ViewState (initialViewState(analysis), or one parsed with parseViewState); ` +
          `${issue ? `${issue.path.join('.') || 'it'}: ${issue.message}` : `got ${describe(view)}`}.`,
      );
    }
    // The parsed copy, defaults filled, so the component never meets a partial one.
    props = { ...props, view: parsed.data };
  }
  if (props.identity !== undefined && typeof props.identity?.current !== 'function') {
    throw new TypeError(`props.identity must be an IdentityProvider ({ current(): Promise<Author> }), e.g. anonymousIdentity(); got ${describe(props.identity)}.`);
  }
  if (props.vouched !== undefined && typeof props.vouched !== 'function') {
    throw new TypeError(`props.vouched must be a function (author) => boolean; got ${describe(props.vouched)}.`);
  }
  if (props.onViewChange !== undefined && typeof props.onViewChange !== 'function') {
    throw new TypeError(`props.onViewChange must be a function (view) => void; got ${describe(props.onViewChange)}.`);
  }
  if (source !== undefined && typeof source.subscribe !== 'function') {
    // A source the view cannot follow would offer edits against a document it
    // never refreshes -- a lock written elsewhere would never close them.
    throw new TypeError(
      'props.source must implement subscribe(), so the matrix can follow its writes; ' +
        'to show an analysis read-only, pass no source.',
    );
  }
  return props;
}

/** The parts of the view the reader rearranges from the matrix's own controls (#93). */
const ARRANGED = ['grouping', 'selection', 'filter'] as const;

/** What a given `view` says about the reader's position (comparable by value, blind to key order) and the panel. */
function sessionIn(view: unknown): { focus: string; panel: boolean; orders: string; encoding: string } & Record<typeof ARRANGED[number], string> {
  const v = view as ViewState | undefined;
  const focus = v?.session?.focus;
  return {
    focus: JSON.stringify([focus?.alternativeId ?? null, focus?.criterionId ?? null]),
    panel: v?.session?.detailPanelOpen === true,
    // The host's arrangement, by value: a re-passed view keeps the reader's moves, a new order replaces them.
    orders: JSON.stringify([v?.alternativeOrder ?? null, v?.criterionOrder ?? null]),
    encoding: v?.encoding ?? '',
    grouping: JSON.stringify(v?.grouping ?? null),
    selection: JSON.stringify(v?.selection ?? null),
    filter: JSON.stringify(v?.filter ?? null),
  };
}

/** Refuse a measure the analysis neither declares nor records (`unknownMeasure`). */
function measureOf(analysis: Analysis, measure: string): void {
  const problem = unknownMeasure(analysis, measure);
  if (problem !== undefined) throw new TypeError(`props.measure ${problem}.`);
}

function unknownKeys(props: object): void {
  const unknown = Object.keys(props).filter((k) => !(PROP_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new TypeError(`unknown matrix prop${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')}; the props are ${PROP_KEYS.join(', ')}.`);
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value);
  return typeof value === 'object' ? 'an object of the wrong shape' : String(value);
}

/**
 * A version-4 UUID. `crypto.randomUUID` exists only in secure contexts, and a
 * connected host may serve the page over plain http on a LAN; `getRandomValues`
 * exists everywhere, so the UUID is built from it there (RFC 9562 section 5.4:
 * the version nibble is 4, the variant bits are 10).
 */
function randomUuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
