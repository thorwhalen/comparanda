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
import type { Affordances } from '../core/affordances.js';
import { initialViewState, setFocus, ViewState, type Session } from '../core/view-state.js';
import {
  DEFAULT_CAPABILITIES, editAffordances, type AnalysisSource, type DataChangeEvent, type DataProvider,
} from '../store/index.js';
import { Matrix, TEXT_ONLY, type MatrixViewProps } from './matrix.js';
import type { MatrixPropsUpdate, MountMatrixProps } from './props.js';

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
    comment: () => refused,
    revise: (doing, target) => (a.revise(doing, target), refused),
    changeLock: () => refused,
    decideSuggestion: (id, decision) => (a.decideSuggestion(id, decision), refused),
  };
}

/** Every prop `mountMatrix` reads. A key outside this list is a typo, and is refused rather than ignored. */
const PROP_KEYS = [
  'analysis', 'measure', 'vocabulary', 'encoding', 'view', 'standing', 'source', 'authorize', 'onViewChange',
] as const satisfies readonly (keyof MountMatrixProps)[];

/** Elements with a live matrix. Two mounts on one element would each think they own its children. */
const mounted = new WeakSet<object>();

/**
 * Render a matrix into `el` and keep it current.
 *
 * With a `source`, the view subscribes to it and re-renders on every write to
 * this analysis; `analysis` is the document as of mount (`await source.getOne(id)`).
 * Without one, it shows `analysis` read-only until `update` says otherwise.
 */
export function mountMatrix(el: Element, props: MountMatrixProps, { component = Matrix }: MountOptions = {}): MatrixHandle {
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
  /**
   * Where the reader moved since the host last gave a `view`: the matrix's
   * one piece of view state of its own, laid over the host's until the host
   * hands over a different view object (typically the one `onViewChange` sent).
   */
  let moved: { focus: Session['focus'] } | undefined;
  /** The `view` object the caller last gave, before parsing, to tell a new one from a re-passed one. */
  let givenView: unknown = props.view;
  /** The view state of the last render: what `onViewChange` reports. */
  let shown: ViewState;

  const moveFocus = (focus: Session['focus']) => {
    if (destroyed) return;
    moved = { focus };
    draw();
    current.onViewChange?.(shown);
  };

  const draw = () => {
    const { measure, vocabulary, encoding, view, standing, source, authorize } = current;
    // Without one, the document's own order, so a source's added alternative shows.
    const base = view ?? initialViewState(analysis);
    shown = moved ? setFocus(base, moved.focus) : base;
    const resolved: MatrixViewProps = {
      analysis,
      measure,
      vocabulary: vocabulary ?? vocabularyOf(analysis),
      encoding: encoding ?? view?.encoding ?? TEXT_ONLY,
      view: shown,
      onFocusChange: moveFocus,
      affordances: source
        ? editAffordances(source, analysis, authorize ? { authorize } : {})
        : withoutSource(editAffordances(NO_SOURCE, analysis, authorize ? { authorize } : {})),
      ...(standing ? { standing } : {}),
    };
    render(h(component, resolved), el);
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
      analysis = event.item;
      try {
        draw();
      } catch (error) {
        // A write the view cannot render leaves the last good render, and the
        // document it rendered; the error goes to the source's subscriber handler.
        analysis = before;
        redraw();
        throw error;
      }
    });
  };

  /**
   * Render from scratch. A render that threw part-way leaves Preact's record of
   * the tree half-updated, and every later diff against it fails; unmounting
   * first is what makes a rollback a rollback.
   */
  const redraw = () => {
    render(null, el);
    // If the old props fail too, unmount again: an empty element and a clean
    // tree, so the next good render fills it rather than diffing against debris.
    try { draw(); } catch { render(null, el); }
  };

  mounted.add(el);
  try {
    unsubscribe = follow(current.source);
    draw();
  } catch (error) {
    // A mount that failed holds nothing: no subscription, no claim, no half a tree.
    destroyed = true;
    unsubscribe?.();
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

      // A view object the caller had not given before replaces the reader's
      // moves; the same one re-passed (a wrapper on every render) keeps them.
      const nextGiven = replace || 'view' in next ? next.view : givenView;
      const before = { current, analysis, unsubscribe, moved, givenView };
      const followed = swapped ? follow(props.source) : unsubscribe;
      current = props;
      analysis = nextAnalysis;
      unsubscribe = followed;
      if (nextGiven !== givenView) moved = undefined;
      givenView = nextGiven;
      try {
        draw();
      } catch (error) {
        // All or nothing, as at mount: the previous props, document and
        // subscription come back, and so does the previous render.
        if (swapped) followed?.();
        ({ current, analysis, unsubscribe, moved, givenView } = before);
        redraw();
        throw error;
      }
      if (swapped) before.unsubscribe?.();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unsubscribe = undefined;
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
