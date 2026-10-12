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
 * inert. `editAffordances()` is what a view reads: the document's affordances
 * (core's `makeAffordances`), with every write -- the `WRITE_AFFORDANCES` --
 * gated on the provider first. `comparanda` invents no parallel read-only flag;
 * the one document-level policy that exists -- `Cell.readOnly` /
 * `Analysis.locked`, which the schema owns (a declaration, not a capability) --
 * is read by core's policy functions and meets the capability only here. A
 * boundary rule keeps the view from reaching the provider-blind ones. The capability
 * report also carries the amendment's load-bearing pair: `multiWriter` may be
 * true only where `perContributorFiles` is, and `writeSafety()` refuses the
 * combination the amendment calls a defect.
 *
 * This module is the only place permitted to reach the network or browser
 * storage; nothing here does, which is why the whole view can be tested against
 * `inMemory*` adapters with no network at all.
 */
import { DEFAULT_CAPABILITIES, createInMemoryProvider } from '@zodal/store';
import type { DataChangeEvent, DataProvider, ProviderCapabilities } from '@zodal/store';

import type { Analysis } from '../core/schema/analysis.js';
import { revisionProblems } from '../core/revision.js';
import {
  cellPolicy, makeAffordances, requireDoing, type Affordance, type Affordances, type Authorize, type WriteAffordance,
} from '../core/affordances.js';
import type { Cell } from '../core/schema/values.js';
import type { Author } from '../core/schema/provenance.js';
import {
  checkStanding, verdictFound, type CheckStanding, type EvidenceRef, type Rendition,
} from '../core/schema/evidence.js';

export type { DataChangeEvent, DataProvider, ProviderCapabilities };
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

/** Whether an action is offered, and why not. One type, defined by the core's affordance layer. */
export type { Affordance };

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
  { what = 'this', doing }: {
    /** What would be changed: "this cell cannot be updated here". */
    what?: string;
    /** The edit, as a gerund phrase, when that reads better: "commenting is not possible here". Blank falls back to `what`. */
    doing?: string;
  } = {},
): Affordance {
  const caps = capabilitiesOf(provider);
  if (caps[ACTION_CAPABILITY[action]]) return { enabled: true };
  const refused = `this source does not accept ${action === 'create' ? 'new items' : `${action}s`}`;
  return {
    enabled: false,
    reason: doing === undefined || doing.trim() === ''
      ? `${refused}, so ${what} cannot be ${action === 'create' ? 'added' : `${action}d`} here.`
      : `${refused}, so ${doing} is not possible here.`,
  };
}

/**
 * What a view reads to decide what it offers: the document's affordances, with
 * every write gated on the provider.
 *
 * In v1 every edit -- a score, a suggestion, a comment, a revision of the
 * structure -- is an `update` of the one analysis document (ADR-0006's
 * 2026-08-22 amendment), so each of the `WRITE_AFFORDANCES` asks `canUpdate`
 * first and returns the provider's reason when it is refused; only then the
 * document's policy and the host's `authorize`. The capability is read at
 * query time, so a provider whose capabilities change is reflected on the next
 * question. Everything else -- legal values, legal blanks, inapplicable
 * blocks, screens -- is the document's alone, and passes through.
 *
 * When the other ports arrive (saved views, annotations, assertions in their
 * own providers), the edit that moves gates on *its* provider here, and no view
 * changes.
 *
 * **The document half is a snapshot.** The capability is live; the analysis is
 * the one passed in. After a write -- a lock toggled, an alternative added --
 * build a new one from the item `subscribe` delivers, or the answers describe
 * the document as it was.
 */
export function editAffordances(
  source: Pick<DataProvider<unknown>, 'getCapabilities'>,
  analysis: Analysis,
  options: { authorize?: Authorize } = {},
): Affordances {
  const doc = makeAffordances(analysis, options);
  const gated = (doing: string, own: () => Affordance): Affordance => {
    const fromProvider = affordanceOf(source, 'update', { doing });
    return fromProvider.enabled ? own() : fromProvider;
  };
  const writes: Pick<Affordances, WriteAffordance> = {
    assert: (alt, crit, measure) => gated('writing to this cell', () => doc.assert(alt, crit, measure)),
    suggest: (alt, crit, measure) => gated('proposing a suggestion', () => doc.suggest(alt, crit, measure)),
    comment: (target) => gated('commenting', () => doc.comment(target)),
    revise: (doing, target) => {
      const phrase = requireDoing(doing);
      return gated(phrase, () => doc.revise(phrase, target));
    },
    changeLock: () => gated(analysis.locked ? 'unlocking the analysis' : 'locking the analysis', () => doc.changeLock()),
    decideSuggestion: (id, decision) => gated(
      `${decision === 'accept' ? 'accepting' : 'declining'} a suggestion`, () => doc.decideSuggestion(id, decision),
    ),
  };
  return { ...doc, ...writes };
}

/**
 * The affordance for editing one cell: the provider's capability, and the
 * document's own policy. The narrow form, with no structural check and no
 * host; a view reads `editAffordances(...).assert`, which includes both.
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
  return cellPolicy(analysis, cell);
}

export interface OneItemProviderOptions {
  /** `false` for a frozen source: reported by `getCapabilities`, and `update` refuses. */
  canUpdate?: boolean;
  /** Where an error thrown by a subscriber goes. Default: rethrown on a microtask. */
  onSubscriberError?: (error: unknown) => void;
}

const rethrowLater = (error: unknown): void => queueMicrotask(() => { throw error; });

/**
 * A one-item provider over a single document, as ADR-0006 clause 2 describes:
 * `getOne` loads it, `update` writes it, `getList` returns the one item, and
 * `subscribe` hears every write made through it -- ADR-0013's "load /
 * subscribe". `create`/`delete` are refused rather than pretended.
 *
 * Subscribers hear writes in the order they happened, even when one of them
 * writes while being notified (events queue, and drain in order); each gets
 * its own copy of the item, so a subscriber cannot reach into the store; and
 * one unsubscribed mid-notification hears nothing more. A subscriber that
 * throws does not undo or fail the write that notified it, nor keep the next
 * subscriber from hearing it: the write has happened, and the caller is told
 * so. The error goes to `onSubscriberError`, which by default rethrows it on a
 * microtask so it is loud rather than swallowed; if that handler throws too,
 * the default takes over.
 *
 * `update` may not change the item's `id`: a one-item provider holds one
 * document, and renaming it would orphan every reference to the old id.
 *
 * **Nothing reaches the stored document except `update`.** The provider keeps
 * its own copy of `initial`, and `getOne`, `getList`, `update` and every event
 * hand out copies -- so a write cannot skip the checks a source puts on
 * `update` (`inMemoryAnalysisSource`'s `revisionProblems`), nor happen without
 * an event. `T` must therefore survive `structuredClone`: plain data, as every
 * schema document is, not class instances or functions. A write whose result
 * cannot be copied is refused before anything is stored.
 *
 * The copies cost about 15 ms each on a 5 MB analysis, a handful per write:
 * nothing at cell-by-cell editing speed. If a profile ever says otherwise,
 * frozen objects are the replacement, at the same boundary.
 */
export function oneItemProvider<T extends { id: string }>(
  initial: T,
  { canUpdate = true, onSubscriberError = rethrowLater }: OneItemProviderOptions = {},
): DataProvider<T> {
  let current = structuredClone(initial);
  const copy = (): T => structuredClone(current);
  const listeners = new Set<(event: DataChangeEvent<T>) => void>();
  const pending: T[] = [];
  let draining = false;
  const report = (error: unknown) => {
    try { onSubscriberError(error); } catch (secondary) { rethrowLater(error); rethrowLater(secondary); }
  };
  const notify = (item: T) => {
    if (listeners.size === 0) return;
    pending.push(item); // already a private copy: `current` is replaced, never mutated
    if (draining) return; // a subscriber wrote: its event follows this one, in order
    draining = true;
    try {
      while (pending.length > 0) {
        const next = pending.shift()!;
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue; // unsubscribed by an earlier subscriber
          try { listener({ type: 'updated', id: next.id, item: structuredClone(next) }); } catch (error) { report(error); }
        }
      }
    } finally {
      draining = false;
    }
  };
  const refuse = (what: string) => async (): Promise<never> => {
    throw new Error(`a one-item provider cannot ${what}; it holds exactly one document ("${current.id}").`);
  };
  return {
    getList: async () => ({ data: [copy()], total: 1 }),
    getOne: async (id: string) => {
      if (id !== current.id) throw new Error(`no item with id "${id}"; this provider holds "${current.id}".`);
      return copy();
    },
    create: refuse('create'),
    update: async (id: string, data: Partial<T>) => {
      if (!canUpdate) throw new Error('this source is read-only.');
      if (id !== current.id) throw new Error(`no item with id "${id}"; this provider holds "${current.id}".`);
      if ('id' in data && data.id !== current.id) {
        throw new Error(`a one-item provider cannot change its document's id ("${current.id}" to "${String(data.id)}").`);
      }
      // Copied before it is stored: a value that cannot be copied is refused
      // with nothing changed, and nobody holds a reference into the store.
      const written = structuredClone({ ...current, ...data });
      current = written;
      notify(written);
      // This write, not whatever a subscriber wrote while being told about it.
      return structuredClone(written);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    updateMany: refuse('update many items'),
    delete: refuse('delete'),
    deleteMany: refuse('delete many items'),
    getCapabilities: () => ({
      ...DEFAULT_CAPABILITIES, canCreate: false, canUpdate, canDelete: false,
      canBulkUpdate: false, canBulkDelete: false, canUpsert: false,
      // `subscribe` delivers every write made through this provider.
      realtime: true,
    }),
  };
}

/**
 * The analysis, in memory. Pass `{ canUpdate: false }` for a standalone bundle's frozen source.
 *
 * `update` refuses what `revisionProblems` refuses: a change that rewrites what
 * a criterion means without moving the criteria-set version (#62), moves or
 * edits a stored score, attaches anything to a tombstoned group, or introduces
 * a validation error -- the rules a view consults through the affordance layer
 * are the validator's, so a write that bypassed the view still meets them
 * (#165). The write path is where a silent rewrite has to stop, because once
 * stored, nothing in the document says it happened. An error already in the
 * document does not block an unrelated write; warnings never block.
 *
 * Writes are **serialised**: each is checked against the document every
 * earlier write produced, so two writes issued together cannot both pass a
 * check that either would fail after the other (tombstoning a group while
 * attaching an alternative to it). That is ordering within one provider, not
 * ADR-0011 clause 6's versioned writes between contributors.
 */
export function inMemoryAnalysisSource(analysis: Analysis, options?: OneItemProviderOptions): AnalysisSource {
  const inner = oneItemProvider(analysis, options);
  let queue: Promise<unknown> = Promise.resolve();
  const checkedUpdate = async (id: string, data: Partial<Analysis>) => {
    const before = await inner.getOne(id);
    const problems = revisionProblems(before, { ...before, ...data });
    if (problems.length) {
      throw new Error(
        'refused: ' + problems.map((p) => `${p.path}: ${p.message} Fix: ${p.fix}`).join(' | '),
      );
    }
    return inner.update(id, data);
  };
  return {
    ...inner,
    update: (id: string, data: Partial<Analysis>) => {
      const result = queue.then(() => checkedUpdate(id, data));
      queue = result.catch(() => undefined); // a refused write does not block the next
      return result;
    },
  };
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
