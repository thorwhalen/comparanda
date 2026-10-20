/**
 * The orphaned-annotations tray, in words (#108, ADR-0011 clause 2).
 *
 * A thread or suggestion whose anchor no longer resolves -- its alternative,
 * criterion or group tombstoned, or gone -- is never dropped: it is listed
 * here, with what it was about and why it lost its place, so a human can see
 * the argument and decide what became of it. `anchors.ts` decides *which*
 * annotations are orphaned; this module says so, for the view to draw.
 *
 * `reattachChoices` and `reattach` are the repair (ADR-0011 clause 2): where an
 * orphan could go, successors of a split or merge first, and the document with
 * it moved there. Whether this person may move it is `affordances.comment(target,
 * 'reattach')`'s, asked by whoever writes it.
 *
 * Headless: plain data and sentences, no DOM.
 */
import type { Analysis } from './schema/analysis.js';
import { orphanedSuggestionsOf, orphanedThreadsOf, resolveAnchor, type AnchorResolution } from './schema/anchors.js';
import type { Anchor } from './schema/annotations.js';
import { aliasesOf } from './schema/structure.js';
import { attributions, type Vouched } from './identity.js';

/** One orphaned annotation, as the tray shows it. */
export interface OrphanEntry {
  kind: 'thread' | 'suggestion';
  id: string;
  /** What it was attached to, and why it no longer is: one sentence. */
  said: string;
  /** Where it stands: "open", "resolved by …", or a suggestion's status. */
  standing: string;
  /** A thread's comments, attributed; empty for a suggestion. */
  comments: { id: string; who: string; at: string; body: string }[];
}

/** Every orphaned thread, then every orphaned suggestion, resolved and decided ones included. */
export function describeOrphans(a: Analysis, { vouched }: { vouched?: Vouched | undefined } = {}): OrphanEntry[] {
  const names = attributions(a.authors, { vouched });
  const who = (id: string | undefined) =>
    id === undefined ? 'someone' : names.get(id) ?? `an author this analysis does not describe ("${id}")`;
  const threads = orphanedThreadsOf(a).map(({ thread: t, resolution }): OrphanEntry => ({
    kind: 'thread', id: t.id,
    said: `A thread on ${describeAnchor(a, t.anchor)}: ${whyOf(a, resolution)}`,
    standing: t.resolved ? `resolved by ${who(t.resolvedBy)}${t.resolvedAt ? `, ${t.resolvedAt}` : ''}` : 'open',
    comments: t.comments.map((c) => ({ id: c.id, who: who(c.authorId), at: c.at, body: c.body })),
  }));
  const suggestions = orphanedSuggestionsOf(a).map(({ suggestion: s, resolution }): OrphanEntry => ({
    kind: 'suggestion', id: s.id,
    said: `A suggestion by ${who(s.authorId)} on ${describeAnchor(a, s.anchor)}: ${whyOf(a, resolution)}`,
    standing: s.status === 'open' ? 'open' : `${s.status}${s.decidedBy ? ` by ${who(s.decidedBy)}` : ''}`,
    comments: [],
  }));
  return [...threads, ...suggestions];
}

/**
 * What an anchor named, by the entity's label where the document still has it,
 * and, unless `hint` is false (a live anchor needs none), its repair hint.
 */
export function describeAnchor(a: Analysis, anchor: Anchor, { hint: withHint = true }: { hint?: boolean } = {}): string {
  const words = aliasesOf(a);
  const label = (kind: 'alternative' | 'criterion' | 'group', id: string | undefined) => {
    const list: readonly { id: string; label: string }[] =
      kind === 'alternative' ? a.alternatives : kind === 'criterion' ? a.criteria : a.groups;
    return list.find((x) => x.id === id)?.label;
  };
  const hint = withHint && anchor.repairHint ? ` (when it was attached: “${anchor.repairHint}”)` : '';
  const named = (kind: 'alternative' | 'criterion' | 'group', id: string | undefined) => {
    const l = label(kind, id);
    return l === undefined ? `“${id ?? ''}”` : l;
  };
  switch (anchor.scope) {
    case 'analysis': return 'the analysis';
    case 'alternative': return `the ${words.alternative} ${named('alternative', anchor.alternativeId)}${hint}`;
    case 'criterion': return `the ${words.criterion} ${named('criterion', anchor.criterionId)}${hint}`;
    case 'cell': return `the cell ${named('criterion', anchor.criterionId)}, ${named('alternative', anchor.alternativeId)}${hint}`;
    case 'group': return `the group ${named('group', anchor.groupId)}${hint}`;
    case 'group-pair': return `the block ${named('group', anchor.groupId)} × ${named('group', anchor.otherGroupId)}${hint}`;
  }
}

/** Why the anchor no longer resolves, as a sentence. */
function whyOf(a: Analysis, r: Exclude<AnchorResolution, { status: 'live' }>): string {
  const { kind, id } = r.entity;
  const words = aliasesOf(a);
  const called = kind === 'group' ? 'group' : words[kind];
  if (r.reason === 'missing') return `the ${called} "${id ?? ''}" is not in this analysis.`;
  const successors = (r.supersededBy ?? []).map((x) => {
    const list: readonly { id: string; label: string }[] = kind === 'alternative' ? a.alternatives : kind === 'criterion' ? a.criteria : a.groups;
    return list.find((y) => y.id === x)?.label ?? x;
  });
  return `the ${called} was deleted (tombstoned)${successors.length ? `; it was replaced by ${successors.join(', ')}, and which one this was about is a person's call` : ''}.`;
}

/** A place an orphaned annotation could be re-attached to, in words. */
export interface ReattachChoice {
  anchor: Anchor;
  said: string;
  /** What the lost entity was split or merged into: offered first. */
  successor: boolean;
}

type Annotated = { kind: 'thread' | 'suggestion'; id: string };

function annotationOf(a: Analysis, { kind, id }: Annotated): { anchor: Anchor } | undefined {
  return kind === 'thread' ? a.threads.find((t) => t.id === id) : a.suggestions.find((x) => x.id === id);
}

/**
 * Where an orphan could go: its anchor with the lost alternative, criterion or
 * group replaced by a live one -- its successors first, then every other live
 * one of that kind -- and, last, the analysis as a whole. Only anchors that
 * resolve are offered. Empty for an annotation that is not orphaned.
 */
export function reattachChoices(a: Analysis, which: Annotated): ReattachChoice[] {
  const anchor = annotationOf(a, which)?.anchor;
  const r = anchor && resolveAnchor(a, anchor);
  if (!anchor || !r || r.status === 'live') return [];
  const { kind, id: lost } = r.entity;
  const list: readonly { id: string; tombstoned?: boolean | undefined }[] =
    kind === 'alternative' ? a.alternatives : kind === 'criterion' ? a.criteria : a.groups;
  const live = list.filter((x) => !x.tombstoned && x.id !== lost).map((x) => x.id);
  const successors = (r.supersededBy ?? []).filter((x) => live.includes(x));
  const { repairHint: _hint, ...kept } = anchor;
  const field = kind === 'alternative' ? 'alternativeId' : kind === 'criterion' ? 'criterionId'
    : anchor.scope === 'group-pair' && anchor.otherGroupId === lost ? 'otherGroupId' : 'groupId';
  const out: ReattachChoice[] = [];
  for (const id of [...successors, ...live.filter((x) => !successors.includes(x))]) {
    const moved = { ...kept, [field]: id } as Anchor;
    if (resolveAnchor(a, moved).status !== 'live') continue;
    const successor = successors.includes(id);
    out.push({ anchor: moved, successor, said: `${capitalised(describeAnchor(a, moved, { hint: false }))}${successor ? ' (what it was split or merged into)' : ''}` });
  }
  out.push({ anchor: { scope: 'analysis' }, successor: false, said: 'The analysis as a whole' });
  return out;
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The document with an orphaned thread or suggestion moved to `anchor`. Throws when it is not orphaned, or `anchor` does not resolve. */
export function reattach(a: Analysis, which: Annotated, anchor: Anchor): Analysis {
  const found = annotationOf(a, which);
  if (!found) throw new Error(`there is no ${which.kind} "${which.id}" in this analysis.`);
  if (resolveAnchor(a, found.anchor).status === 'live') throw new Error(`${which.kind} "${which.id}" is attached to something live; only an orphan is re-attached.`);
  if (resolveAnchor(a, anchor).status !== 'live') throw new Error(`the new anchor does not resolve to anything live, so ${which.kind} "${which.id}" would still be orphaned.`);
  return which.kind === 'thread'
    ? { ...a, threads: a.threads.map((t) => (t.id === which.id ? { ...t, anchor } : t)) }
    : { ...a, suggestions: a.suggestions.map((x) => (x.id === which.id ? { ...x, anchor } : x)) };
}
