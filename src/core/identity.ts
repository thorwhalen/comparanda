/**
 * How an author is named to a reader (ADR-0012).
 *
 * Every place a view names who asserted, commented or resolved something says
 * it through `attribution`, so two things hold wherever a name appears:
 *
 * - **a person and a model are told apart by the typed field**, `Author.kind`,
 *   with the agent's run (model, prompt version, run id) beside it -- never by
 *   a display name that happens to look like a tool's;
 * - **how well the identity is known is said, not implied.** An absent
 *   `attestation` reads as `unverified`, which is what a local identity -- a
 *   name somebody typed -- is, and the label says so.
 *
 * Plain strings, no DOM: a second view, or a CLI, names authors the same way.
 */
import type { Attestation, Author } from './schema/provenance.js';

/** What each attestation method is worth, in a reader's words. */
function attestedAs(a: Attestation): string {
  switch (a.method) {
    case 'host-session': return `signed in${a.issuer ? ` to ${a.issuer}` : ''}`;
    case 'oauth': return `verified by ${a.issuer ?? 'an identity provider'}`;
    case 'signature': return `signed${a.issuer ? ` by ${a.issuer}` : ''}`;
    default: return 'unverified';
  }
}

/** The methods that claim more than `unverified`; anything else reads as `unverified`. */
const CLAIMED_METHODS: ReadonlySet<string> = new Set(['host-session', 'oauth', 'signature']);

/**
 * How well the identity is known. A method other than `unverified` is a claim
 * the document makes about itself until the host that shows it says it
 * performed the check (`vouched`), so by default it reads as a claim (#243).
 */
function attested(a: Attestation | undefined, vouched: boolean): string {
  if (!a || !CLAIMED_METHODS.has(a.method)) return 'unverified';
  return vouched ? attestedAs(a) : `unverified; claims ${attestedAs(a)}`;
}

/**
 * An author as a reader should see them: the display name, then what kind of
 * author it is, the agent run behind it, the perspective a persona takes, the
 * principal behind a persona, and how well the identity is known.
 *
 * A persona (an author whose `principalId` differs from its `id`) always names
 * its principal's id, beside the principal's display name when one is given:
 * a display name alone is not an identity, since `aaa:Ana` can look like `ana`.
 *
 *     attribution(ada)              // 'Ada (human, unverified)'
 *     attribution(scorer)           // 'Scorer (agent rubricator, model m-1, prompt v3, run r9, unverified)'
 *     attribution(asBuyer, { principal: 'Ada' })
 *                                   // 'Ada as buyer (human, acting as the buyer, for Ada [ada], unverified)'
 *     attribution(signedIn, { vouched: true })
 *                                   // 'Ada (human, signed in to intranet)'
 */
export function attribution(
  author: Pick<Author, 'displayName' | 'kind' | 'role' | 'actingAs' | 'attestation' | 'agent'>
    & Partial<Pick<Author, 'id' | 'principalId'>>,
  { principal, vouched = false }: { principal?: string | undefined; vouched?: boolean } = {},
): string {
  const run = author.agent;
  const principalId = author.principalId !== undefined && author.principalId !== author.id ? author.principalId : undefined;
  const parts = [
    run ? `${author.kind} ${run.name}` : author.kind,
    run?.model && `model ${run.model}`,
    run?.promptVersion && `prompt ${run.promptVersion}`,
    run?.runId && `run ${run.runId}`,
    author.role,
    author.actingAs && `acting as ${author.actingAs}`,
    principalId && `for ${principal !== undefined && principal !== principalId ? `${principal} [${principalId}]` : principalId}`,
    attested(author.attestation, vouched),
  ];
  return `${author.displayName} (${parts.filter(Boolean).join(', ')})`;
}

/**
 * Every author of a document, attributed, by id: what a view looks a name up
 * in. A persona's principal is named by display name and id when the document
 * describes it, and by its id when it does not -- never dropped. `vouched`
 * says which authors' attestations the host itself performed; none by default.
 */
export function attributions(
  authors: readonly Author[],
  { vouched = () => false }: { vouched?: (author: Author) => boolean } = {},
): Map<string, string> {
  const names = new Map(authors.map((a) => [a.id, a.displayName]));
  return new Map(authors.map((a) => [a.id, attribution(a, {
    principal: a.principalId === undefined ? undefined : names.get(a.principalId),
    vouched: vouched(a),
  })]));
}
