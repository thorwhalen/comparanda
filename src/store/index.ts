/**
 * comparanda/store -- the ports, and in-memory adapters for every one of them.
 *
 * ADR-0013 injects the view's dependencies as ports; ADR-0006 as amended says
 * what shape they have: `DataProvider<T>` from `@zodal/store`, not a key-value
 * store. The five providers it names:
 *
 *     AnalysisSource  = DataProvider<Analysis>   // one-item provider
 *     ViewStateStore  = DataProvider<StoredViewState>
 *     AnnotationSink  = DataProvider<Thread>
 *     AssertionStore  = DataProvider<StoredAssertion>
 *     SavedViewStore  = DataProvider<SavedView>  // shape settled with #71
 *
 * plus the two ports that are not collections -- `EvidenceResolver` (ADR-0014)
 * and `IdentityProvider` (ADR-0012).
 *
 * **`getCapabilities()` is the only source of truth for what the UI offers**
 * (ADR-0006 clause 3): `affordanceOf()` derives every enable/disable from it and
 * returns the *reason* alongside, so a control is never present and silently
 * inert. `comparanda` invents no parallel read-only flag; the one document-level
 * policy that exists -- `Cell.readOnly` / `Analysis.locked`, which the schema
 * owns (a declaration, not a capability) -- is combined by
 * `cellAffordanceOf()` rather than consulted anywhere else.
 *
 * This module is the only place permitted to reach the network or browser
 * storage; nothing here does, which is why the whole view can be tested against
 * `inMemory*` adapters with no network at all.
 */
import { DEFAULT_CAPABILITIES, createInMemoryProvider } from '@zodal/store';
import type { DataProvider, ProviderCapabilities } from '@zodal/store';

import type { Analysis } from '../core/schema/analysis.js';
import type { Assertion, Cell } from '../core/schema/values.js';
import type { Thread } from '../core/schema/annotations.js';
import type { Author } from '../core/schema/provenance.js';
import type { EvidenceRef, Rendition } from '../core/schema/evidence.js';
import type { ViewState } from '../core/view-state.js';

export type { DataProvider, ProviderCapabilities };
export { DEFAULT_CAPABILITIES, createInMemoryProvider };

/** The analysis, as a degenerate one-item provider (ADR-0006 amendment, clause 2). */
export type AnalysisSource = DataProvider<Analysis>;

/** View state, per reader per device. One item, under a stable id. */
export interface StoredViewState extends ViewState { id: string }
export type ViewStateStore = DataProvider<StoredViewState>;

/** Annotation threads. A genuine collection (ADR-0011). */
export type AnnotationSink = DataProvider<Thread>;

/** Rater assertions, when they are written separately from the document. */
export interface StoredAssertion extends Assertion {
  alternativeId: string;
  criterionId: string;
  measure: string;
}
export type AssertionStore = DataProvider<StoredAssertion>;

/**
 * What a resolved evidence reference gives a reader (ADR-0014).
 *
 * Resolution is lazy and may fail: a reference that cannot be resolved is a
 * surfaced state, never a dead link rendered as if it worked.
 */
export type ResolvedEvidence =
  | { status: 'embedded'; excerpt: string; rendition?: Rendition }
  | { status: 'resolved'; excerpt?: string; rendition?: Rendition; url?: string }
  | { status: 'unresolvable'; reason: string };

/**
 * The host's way of turning an opaque reference into something openable
 * (ADR-0013, ADR-0014). `core` never assumes where documents live.
 */
export interface EvidenceResolver {
  resolve(ref: EvidenceRef, context: { analysis: Analysis }): Promise<ResolvedEvidence>;
}

/** Who is acting (ADR-0012). The anonymous default is usable, not a stub. */
export interface IdentityProvider {
  current(): Promise<Author>;
  /** Authors this deployment can name, for attribution UIs. Optional. */
  known?(): Promise<Author[]>;
}

/** Whether an action is offered, and -- when it is not -- why not, in words. */
export interface Affordance {
  enabled: boolean;
  /** Always present when `enabled` is false; a control that does nothing must say so. */
  reason?: string;
}

/** Capability discovery with the documented default for providers that do not implement it. */
export function capabilitiesOf(provider: Pick<DataProvider<unknown>, 'getCapabilities'>): ProviderCapabilities {
  return provider.getCapabilities?.() ?? DEFAULT_CAPABILITIES;
}

const ACTION_CAPABILITY = {
  create: 'canCreate',
  update: 'canUpdate',
  delete: 'canDelete',
} as const;

export type EditAction = keyof typeof ACTION_CAPABILITY;

/**
 * The single derivation every editable affordance goes through.
 *
 * A view asks this and renders accordingly; it never reads a flag of its own.
 * Flip a capability and the control disables **with a stated reason** -- which
 * is the whole mechanism ADR-0013 asks for by description.
 */
export function affordanceOf(
  provider: Pick<DataProvider<unknown>, 'getCapabilities'>,
  action: EditAction,
  { what = 'this' }: { what?: string } = {},
): Affordance {
  const caps = capabilitiesOf(provider);
  if (caps[ACTION_CAPABILITY[action]]) return { enabled: true };
  return {
    enabled: false,
    reason: `this source does not accept ${action === 'create' ? 'new items' : `${action}s`}, so ${what} cannot be ${action === 'create' ? 'added' : `${action}d`} here.`,
  };
}

/**
 * The affordance for editing one cell: the provider's capability, and the
 * document's own policy.
 *
 * `Cell.readOnly` and `Analysis.locked` are *declarations in the document*
 * (the schema owns policy, ADR-0004), not a second answer to "can this backend
 * write". They meet exactly here, so nothing downstream consults either.
 */
export function cellAffordanceOf(
  provider: Pick<DataProvider<unknown>, 'getCapabilities'>,
  analysis: Pick<Analysis, 'locked'>,
  cell: Pick<Cell, 'readOnly'> | undefined,
): Affordance {
  const fromProvider = affordanceOf(provider, 'update', { what: 'this cell' });
  if (!fromProvider.enabled) return fromProvider;
  if (analysis.locked) {
    return { enabled: false, reason: 'this analysis is locked; propose a suggestion instead of editing it.' };
  }
  if (cell?.readOnly) {
    return { enabled: false, reason: 'this cell is declared read-only in the analysis.' };
  }
  return { enabled: true };
}

/**
 * A one-item provider over a single document, as ADR-0006 clause 2 describes:
 * `getOne` loads it, `update` writes it, and `getList` returns the one item.
 * `create`/`delete` are refused rather than pretended.
 */
export function oneItemProvider<T extends { id: string }>(
  initial: T,
  { canUpdate = true }: { canUpdate?: boolean } = {},
): DataProvider<T> {
  let current = initial;
  const refuse = (what: string) => async (): Promise<never> => {
    throw new Error(`a one-item provider cannot ${what}; it holds exactly one document ("${current.id}").`);
  };
  return {
    getList: async () => ({ data: [current], total: 1 }),
    getOne: async (id: string) => {
      if (id !== current.id) throw new Error(`no item with id "${id}"; this provider holds "${current.id}".`);
      return current;
    },
    create: refuse('create'),
    update: async (id: string, data: Partial<T>) => {
      if (!canUpdate) throw new Error('this source is read-only.');
      if (id !== current.id) throw new Error(`no item with id "${id}"; this provider holds "${current.id}".`);
      current = { ...current, ...data };
      return current;
    },
    updateMany: refuse('update many items'),
    delete: refuse('delete'),
    deleteMany: refuse('delete many items'),
    getCapabilities: () => ({
      ...DEFAULT_CAPABILITIES, canCreate: false, canUpdate, canDelete: false,
      canBulkUpdate: false, canBulkDelete: false, canUpsert: false,
    }),
  };
}

/** The analysis, in memory. Pass `{ canUpdate: false }` for a standalone bundle's frozen source. */
export function inMemoryAnalysisSource(analysis: Analysis, options?: { canUpdate?: boolean }): AnalysisSource {
  return oneItemProvider(analysis, options);
}

/** View state, in memory, under its own stable id. */
export function inMemoryViewStateStore(state: ViewState, { id = 'view-state' } = {}): ViewStateStore {
  return oneItemProvider<StoredViewState>({ ...state, id });
}

/** Threads, in memory. */
export function inMemoryAnnotationSink(threads: readonly Thread[] = []): AnnotationSink {
  return createInMemoryProvider([...threads] as Thread[]) as AnnotationSink;
}

/** Assertions, in memory. */
export function inMemoryAssertionStore(assertions: readonly StoredAssertion[] = []): AssertionStore {
  return createInMemoryProvider([...assertions] as StoredAssertion[]) as AssertionStore;
}

/**
 * The standalone resolver ADR-0013 names: it opens embedded excerpts and says
 * plainly when there is nothing embedded to open. No network, by construction.
 */
export function embeddedEvidenceResolver(): EvidenceResolver {
  return {
    resolve: async (ref, { analysis }) => {
      const rendition = analysis.renditions.find((r) => r.id === ref.renditionId);
      if (ref.excerpt !== undefined) {
        return rendition ? { status: 'embedded', excerpt: ref.excerpt, rendition } : { status: 'embedded', excerpt: ref.excerpt };
      }
      return {
        status: 'unresolvable',
        reason: 'this reference carries no embedded excerpt, and this deployment has no resolver that can fetch its source.',
      };
    },
  };
}

/** The anonymous identity ADR-0012 requires to be usable rather than a stub. */
export function anonymousIdentity(author: Partial<Author> = {}): IdentityProvider {
  const current: Author = {
    id: 'anonymous', displayName: 'Anonymous', kind: 'human', ...author,
  } as Author;
  return { current: async () => current, known: async () => [current] };
}
