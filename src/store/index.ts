/**
 * comparanda/store -- the ports, and in-memory adapters for every one of them.
 *
 * ADR-0013 injects the view's dependencies as ports; ADR-0006 as amended says
 * what shape they have -- `DataProvider<T>` from `@zodal/store`, not a
 * key-value store -- and **how many v1 builds**: exactly one,
 * `DataProvider<Analysis>` (amendment of 2026-08-22, clause 1). Saved views,
 * annotations and assertions travel *inside* the analysis document in v1, so a
 * provider each would be four interfaces over one aggregate; they arrive, in the
 * 2026-08-21 shape, when a second implementation of one of them exists.
 * `oneItemProvider` is what they will arrive through.
 *
 * Two ports here are not persistence and are not narrowed by that clause:
 * `EvidenceResolver` (ADR-0014) and `IdentityProvider` (ADR-0012).
 *
 * **`getCapabilities()` is the only source of truth for what the UI offers**
 * (ADR-0006 clause 3): `affordanceOf()` derives every enable/disable from it and
 * returns the *reason* alongside, so a control is never present and silently
 * inert. `comparanda` invents no parallel read-only flag; the one document-level
 * policy that exists -- `Cell.readOnly` / `Analysis.locked`, which the schema
 * owns (a declaration, not a capability) -- is combined by
 * `cellAffordanceOf()` rather than consulted anywhere else. The capability
 * report also carries the amendment's load-bearing pair: `multiWriter` may be
 * true only where `perContributorFiles` is, and `writeSafety()` refuses the
 * combination the amendment calls a defect.
 *
 * This module is the only place permitted to reach the network or browser
 * storage; nothing here does, which is why the whole view can be tested against
 * `inMemory*` adapters with no network at all.
 */
import { DEFAULT_CAPABILITIES, createInMemoryProvider } from '@zodal/store';
import type { DataProvider, ProviderCapabilities } from '@zodal/store';

import type { Analysis } from '../core/schema/analysis.js';
import type { Cell } from '../core/schema/values.js';
import type { Author } from '../core/schema/provenance.js';
import {
  checkStanding, verdictFound, type CheckStanding, type EvidenceRef, type Rendition,
} from '../core/schema/evidence.js';

export type { DataProvider, ProviderCapabilities };
export { DEFAULT_CAPABILITIES, createInMemoryProvider };

/** The analysis, as a degenerate one-item provider (ADR-0006 amendment, clause 2). */
export type AnalysisSource = DataProvider<Analysis>;


/**
 * What a resolved evidence reference gives a reader (ADR-0014).
 *
 * Resolution is lazy and may fail: a reference that cannot be resolved is a
 * surfaced state, never a dead link rendered as if it worked.
 */
export type ResolvedEvidence =
  | {
    /** The excerpt travelling in the document was shown; no source was fetched. */
    status: 'from-excerpt';
    excerpt: string;
    /** The cleaned copy the excerpt indexes into, when the document carries it. */
    rendition?: Rendition;
    /**
     * How the stored check stands *now* (ADR-0014): every non-current standing
     * carries a caveat, and a view may not render one as current. Present
     * whenever a reference carries a check, so staleness is surfaced rather
     * than silently rendered as a live quote.
     */
    standing: CheckStanding;
    /** Anything a reader must be told alongside the excerpt, in words. */
    caveats: string[];
  }
  | { status: 'unresolvable'; reason: string };

/**
 * The host's way of turning an opaque reference into something openable
 * (ADR-0013, ADR-0014). `core` never assumes where documents live.
 */
export interface EvidenceResolver {
  resolve(ref: EvidenceRef, context: ResolveContext): Promise<ResolvedEvidence>;
}

/** What a resolver needs besides the reference. `now` is a parameter, never a hidden clock. */
export interface ResolveContext {
  analysis: Analysis;
  now?: Date;
  currentCheckerVersion?: string;
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


/**
 * The standalone resolver ADR-0013 names: it opens embedded excerpts and says
 * plainly when there is nothing embedded to open. No network, by construction.
 */
export function embeddedEvidenceResolver(
  { currentCheckerVersion = 'comparanda-check/1.0.0' }: { currentCheckerVersion?: string } = {},
): EvidenceResolver {
  return {
    resolve: async (ref, context) => {
      if (ref.excerpt === undefined) {
        return {
          status: 'unresolvable',
          reason: 'this reference carries no embedded excerpt, and this deployment has no resolver that can fetch its source.',
        };
      }
      const rendition = ref.renditionId === undefined
        ? undefined
        : context.analysis.renditions.find((r) => r.id === ref.renditionId);
      const standing = checkStanding(ref.check, {
        currentCheckerVersion: context.currentCheckerVersion ?? currentCheckerVersion,
        now: context.now ?? new Date(0),
      });
      const caveats: string[] = [];
      // The verdict itself, before its freshness: a check that did not find the
      // quote must not be rendered as a quote the reader can go and look at.
      if (ref.check && ref.check.status !== 'unchecked' && !verdictFound(ref.check.status)) {
        caveats.push(`the last check could not confirm this quote in its source (verdict "${ref.check.status}"); ` +
          'what is shown is the copy stored in this document.');
      }
      // ADR-0014: a non-current standing must be shown as such, and the source
      // having moved on is its own caveat.
      if (standing.freshness === 'unchecked') caveats.push('this quote has not been checked against its source.');
      else if (standing.freshness !== 'current') {
        caveats.push(`this quote's check is ${standing.freshness.replace('-', ' ')}; it may no longer hold.`);
      }
      if (standing.sourceChanged) caveats.push('the source has changed since it was ingested; the original may no longer contain this quote.');
      if (ref.renditionId !== undefined && rendition === undefined) {
        caveats.push(`the cleaned copy this quote indexes into ("${ref.renditionId}") is not in this document, so the quote cannot be located in its source.`);
      }
      return rendition
        ? { status: 'from-excerpt', excerpt: ref.excerpt, rendition, standing, caveats }
        : { status: 'from-excerpt', excerpt: ref.excerpt, standing, caveats };
    },
  };
}

/** The anonymous identity ADR-0012 requires to be usable rather than a stub. */
export function anonymousIdentity(author: Partial<Author> = {}): IdentityProvider {
  // ADR-0012: an author with no persona carries `principalId === id`, and an
  // unverified identity says so rather than leaving the field absent.
  const id = author.id ?? 'anonymous';
  const current: Author = {
    id,
    displayName: 'Anonymous',
    kind: 'human',
    principalId: id,
    attestation: { method: 'unverified' },
    ...author,
  };
  return { current: async () => current, known: async () => [current] };
}

/**
 * The invariant ADR-0006's 2026-08-22 amendment (clause 3) writes into the
 * capability report: `DataProvider.update` is last-write-wins with no version
 * field, which ADR-0011 forbids for the analysis -- so several contributors may
 * write only where each writes their own key.
 *
 * A provider reporting `multiWriter: true` without `perContributorFiles` is a
 * defect, not a configuration, and this is where that stops being folklore.
 */
export function writeSafety(
  provider: Pick<DataProvider<unknown>, 'getCapabilities'>,
): { safe: boolean; reason?: string } {
  const caps = capabilitiesOf(provider) as ProviderCapabilities & { multiWriter?: boolean; perContributorFiles?: boolean };
  if (caps.multiWriter !== true) return { safe: true };
  if (caps.perContributorFiles === true) return { safe: true };
  return {
    safe: false,
    reason: 'this source reports multiWriter without perContributorFiles: two contributors would write the same key, ' +
      'and DataProvider.update is last-write-wins, so a contribution would be lost silently (ADR-0006, ADR-0011).',
  };
}
