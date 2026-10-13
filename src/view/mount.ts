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
import { threadDoing, type Affordances, type ThreadAct } from '../core/affordances.js';
import { initialViewState, setDetailPanel, setFocus, ViewState, type Session } from '../core/view-state.js';
import {
  anonymousIdentity, DEFAULT_CAPABILITIES, editAffordances, type AnalysisSource, type DataChangeEvent, type DataProvider,
} from '../store/index.js';

/** Who writes when the host names no one: usable, not a stub (ADR-0012). */
const DEFAULT_IDENTITY = anonymousIdentity();
/** What the anonymous identity is called (`anonymousIdentity`'s default id). */
const DEFAULT_IDENTITY_ID = 'anonymous';
import { createEncodingRegistry, type EncodingRegistry } from './encodings/registry.js';
import type { Author } from '../core/schema/provenance.js';
import { commentTarget, editComment, reopenThread, replyToThread, resolveThread, startThread } from '../core/threads.js';
import type { Anchor } from '../core/schema/annotations.js';
import type { ThreadWrites } from './threads.js';
import { textOnly } from './encodings/shipped.js';
import { Matrix, TEXT_ONLY, type MatrixViewProps } from './matrix.js';
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
  'analysis', 'measure', 'vocabulary', 'encoding', 'view', 'standing', 'viewer', 'source', 'authorize', 'onViewChange', 'identity',
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
  { component = Matrix, encodings, now = () => new Date(), newId = randomUuid, arrange }: MountOptions = {},
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
  let moved: { focus?: Session['focus']; panel?: boolean; orders?: Pick<ViewState, 'alternativeOrder' | 'criterionOrder'> } | undefined;
  /** The last sentence for the live region, and how many have been said, so a repeat is heard again. */
  let announcement: string | undefined;
  let said = 0;
  /** Who moves things, for the order's provenance: the identity's id once known (ADR-0012). */
  let actor = DEFAULT_IDENTITY_ID;
  /** Who the last render was drawn for, to tell whether a new reader changes what it shows. */
  let drawnFor: string | undefined;
  /** The identity's id as a viewer: the anonymous identity is nobody in particular, and must not be taken for an author who happens to be called that. */
  const viewerIdOf = (id: string) => (id === DEFAULT_IDENTITY_ID ? undefined : id);
  /** Redraw if, and only if, the reader now known sees different authors from the one drawn for: a redraw for nothing resets what the reader is in the middle of. */
  const refreshViewer = () => {
    if (destroyed || current.viewer) return;
    const at = now().toISOString();
    if (hiddenAuthors(analysis, { viewerId: drawnFor, now: at }) !== hiddenAuthors(analysis, { viewerId: viewerIdOf(actor), now: at })) draw();
  };
  const learnActor = (identity = current.identity ?? DEFAULT_IDENTITY) => {
    // Until the new identity answers, nobody known: the previous one must not sign moves made in the gap, or see what only they may.
    actor = DEFAULT_IDENTITY_ID;
    refreshViewer();
    // Only the identity still in force: a slow one the host has since replaced, or cleared, never signs a move.
    identity.current().then((a) => {
      if ((current.identity ?? DEFAULT_IDENTITY) !== identity) return;
      actor = a.id;
      refreshViewer();
    }, () => undefined);
  };
  /** What the `view` the caller last gave said about the session, to tell a new one from a re-passed one. */
  let givenFocus = sessionIn(props.view);
  /** The view state of the last render: what `onViewChange` reports. */
  let shown: ViewState;

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
  /**
   * The reader rearranged an axis: laid over the host's order until the host
   * gives a view with a different one, announced, and reported.
   */
  const reorder = (state: ViewState, sentence: string) => {
    if (destroyed) return;
    said += 1;
    // The same sentence twice is still news: a trailing no-break space alternates so the region changes.
    announcement = said % 2 === 0 ? `${sentence}\u00a0` : sentence;
    const same = JSON.stringify([state.alternativeOrder, state.criterionOrder]) === JSON.stringify([shown.alternativeOrder, shown.criterionOrder]);
    // Said, but nothing moved (a pick-up, a put-down, a refusal): no new arrangement to lay over the host's or report.
    if (same) return moveSession({});
    moveSession({ orders: { alternativeOrder: state.alternativeOrder, criterionOrder: state.criterionOrder } });
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
  const writeThread = (act: ThreadAct, anchorOf: (a: Analysis) => Anchor | undefined, change: (a: Analysis, author: Author, at: string) => Analysis,
    ofComment?: (a: Analysis) => { id: string; authorId: string } | undefined,
  ): Promise<void> => {
    const run = async () => {
      const { source, identity = DEFAULT_IDENTITY, authorize } = current;
      const id = analysis.id;
      if (destroyed || !source) throw new Error('there is no source behind this matrix to write to.');
      /** After every wait: a write the host has since cut off (destroyed, swapped source or document) is not made. */
      const stillHere = () => {
        if (destroyed || current.source !== source || analysis.id !== id) {
          throw new Error('the matrix changed document while the comment was being written; nothing was written.');
        }
      };
      const author = await identity.current();
      stillHere();
      // The source's own latest document, not the one shown: a write in flight may not have come back as an event yet.
      const latest = await source.getOne(id);
      stillHere();
      if (!latest) throw new Error(`the source no longer holds this analysis ("${id}"); nothing was written.`);
      // Asked again of the document being written, not the one the button was drawn from: the host is never overruled (ADR-0012).
      const anchor = anchorOf(latest);
      const of = ofComment?.(latest);
      const may = anchor && editAffordances(source, latest, authorize ? { authorize } : {}).comment(commentTarget(anchor), act, of);
      if (may && !may.enabled) throw new Error(may.reason);
      // With no host to decide, a comment is its author's to edit; a host that authorises is asked, with the author named, and decides (ADR-0012).
      if (of && !authorize && of.authorId !== author.id) throw new Error('only the comment\u2019s author may edit it unless the host says otherwise.');
      await source.update(id, change(latest, author, now().toISOString()));
    };
    // One write at a time: two sent together would each build on the same document, and the second would undo the first.
    const next = writes.then(run, run);
    writes = next.catch(() => undefined);
    return next;
  };
  /** A thread's anchor in a document; absent, the thread's own write says there is no such thread. */
  const anchorIn = (threadId: string) => (a: Analysis) => a.threads.find((t) => t.id === threadId)?.anchor;
  /** A comment's id and author in a document; absent, the edit itself says there is no such comment. */
  const commentIn = (threadId: string, commentId: string) => (a: Analysis) => {
    const c = a.threads.find((t) => t.id === threadId)?.comments.find((x) => x.id === commentId);
    return c && { id: c.id, authorId: c.authorId };
  };
  const threadWrites: ThreadWrites = {
    start: (anchor, body) => writeThread('start', () => anchor, (a, author, at) =>
      startThread(a, { threadId: newId(), anchor, comment: { id: newId(), at, body, author } })),
    reply: (threadId, body) => writeThread('reply', anchorIn(threadId), (a, author, at) => replyToThread(a, threadId, { id: newId(), at, body, author })),
    edit: (threadId, commentId, body) => writeThread('edit', anchorIn(threadId), (a, by, at) =>
      editComment(a, threadId, commentId, { body, id: newId(), by, at }), commentIn(threadId, commentId)),
    resolve: (threadId) => writeThread('resolve', anchorIn(threadId), (a, by, at) => resolveThread(a, threadId, { by, at })),
    reopen: (threadId) => writeThread('reopen', anchorIn(threadId), (a, by, at) => reopenThread(a, threadId, { id: newId(), by, at })),
  };

  const draw = () => {
    const { measure, vocabulary, encoding, view, standing, source, authorize } = current;
    const viewer = current.viewer ?? { viewerId: viewerIdOf(actor), now: now().toISOString() };
    drawnFor = viewer.viewerId;
    // Without one, the document's own order, so a source's added alternative shows.
    const base = view ?? initialViewState(analysis);
    shown = moved && 'focus' in moved ? setFocus(base, moved.focus) : base;
    if (moved?.panel !== undefined) shown = setDetailPanel(shown, moved.panel);
    if (moved?.orders) shown = { ...shown, ...moved.orders };
    const resolved: MatrixViewProps = {
      analysis,
      measure,
      vocabulary: vocabulary ?? vocabularyOf(analysis),
      encoding: encoding ?? view?.encoding ?? TEXT_ONLY,
      view: shown,
      onFocusChange: moveFocus,
      onPanelChange: changePanel,
      onReorder: reorder,
      actor: () => actor,
      ...(arrange ? { arrange } : {}),
      ...(announcement !== undefined ? { announcement } : {}),
      ...(source ? { threadWrites } : {}),
      encodings: registry,
      affordances: source
        ? editAffordances(source, analysis, authorize ? { authorize } : {})
        : withoutSource(editAffordances(NO_SOURCE, analysis, authorize ? { authorize } : {})),
      ...(standing ? { standing } : {}),
      // The caller's, else the reader the identity names at the moment drawn: an outside reader, if no one has said who they are.
      viewer,
    };
    const was = focused();
    render(h(component, resolved), el);
    // Before focus moves: a focus that scrolls must already see the padding.
    sticky.measure();
    settle(was);
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
  const settle = (was: Element | null) => {
    if (was === null) return;
    const stop = el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]');
    const now = focused();
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
    settle(was);
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

/** What a given `view` says about the reader's position (comparable by value, blind to key order) and the panel. */
function sessionIn(view: unknown): { focus: string; panel: boolean; orders: string } {
  const v = view as ViewState | undefined;
  const focus = v?.session?.focus;
  return {
    focus: JSON.stringify([focus?.alternativeId ?? null, focus?.criterionId ?? null]),
    panel: v?.session?.detailPanelOpen === true,
    // The host's arrangement, by value: a re-passed view keeps the reader's moves, a new order replaces them.
    orders: JSON.stringify([v?.alternativeOrder ?? null, v?.criterionOrder ?? null]),
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
