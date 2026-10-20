/**
 * The orphaned-annotations tray, in words (#108, ADR-0011 clause 2).
 *
 * A thread or suggestion whose anchor no longer resolves -- its alternative,
 * criterion or group tombstoned, or gone -- is never dropped: it is listed
 * here, with what it was about and why it lost its place, so a human can see
 * the argument and decide what became of it. `anchors.ts` decides *which*
 * annotations are orphaned; this module says so, for the view to draw.
 *
 * Headless: plain data and sentences, no DOM.
 */
import type { Analysis } from './schema/analysis.js';
import { orphanedSuggestionsOf, orphanedThreadsOf, type AnchorResolution } from './schema/anchors.js';
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
    said: `A thread on ${aboutOf(a, t.anchor)}: ${whyOf(a, resolution)}`,
    standing: t.resolved ? `resolved by ${who(t.resolvedBy)}${t.resolvedAt ? `, ${t.resolvedAt}` : ''}` : 'open',
    comments: t.comments.map((c) => ({ id: c.id, who: who(c.authorId), at: c.at, body: c.body })),
  }));
  const suggestions = orphanedSuggestionsOf(a).map(({ suggestion: s, resolution }): OrphanEntry => ({
    kind: 'suggestion', id: s.id,
    said: `A suggestion by ${who(s.authorId)} on ${aboutOf(a, s.anchor)}: ${whyOf(a, resolution)}`,
    standing: s.status === 'open' ? 'open' : `${s.status}${s.decidedBy ? ` by ${who(s.decidedBy)}` : ''}`,
    comments: [],
  }));
  return [...threads, ...suggestions];
}

/** What an anchor named, by the entity's label where the document still has it, else by its repair hint. */
function aboutOf(a: Analysis, anchor: Anchor): string {
  const words = aliasesOf(a);
  const label = (kind: 'alternative' | 'criterion' | 'group', id: string | undefined) => {
    const list: readonly { id: string; label: string }[] =
      kind === 'alternative' ? a.alternatives : kind === 'criterion' ? a.criteria : a.groups;
    return list.find((x) => x.id === id)?.label;
  };
  const hint = anchor.repairHint ? ` (when it was attached: “${anchor.repairHint}”)` : '';
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
