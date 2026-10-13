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
function attested(a: Attestation | undefined): string {
  switch (a?.method) {
    case 'host-session': return `signed in${a.issuer ? ` to ${a.issuer}` : ''}`;
    case 'oauth': return `verified by ${a.issuer ?? 'an identity provider'}`;
    case 'signature': return `signed${a.issuer ? ` by ${a.issuer}` : ''}`;
    default: return 'unverified';
  }
}

/**
 * An author as a reader should see them: the display name, then what kind of
 * author it is, the agent run behind it, the perspective a persona takes, the
 * principal behind a persona, and how well the identity is known.
 *
 *     attribution(ada)              // 'Ada (human, unverified)'
 *     attribution(scorer)           // 'Scorer (agent rubricator, model m-1, prompt v3, run r9, unverified)'
 *     attribution(asBuyer, { principal: 'Ada' })
 *                                   // 'Ada as buyer (human, acting as the buyer, for Ada, unverified)'
 */
export function attribution(
  author: Pick<Author, 'displayName' | 'kind' | 'role' | 'actingAs' | 'attestation' | 'agent'>,
  { principal }: { principal?: string | undefined } = {},
): string {
  const run = author.agent;
  const parts = [
    run ? `${author.kind} ${run.name}` : author.kind,
    run?.model && `model ${run.model}`,
    run?.promptVersion && `prompt ${run.promptVersion}`,
    run?.runId && `run ${run.runId}`,
    author.role,
    author.actingAs && `acting as ${author.actingAs}`,
    principal && `for ${principal}`,
    attested(author.attestation),
  ];
  return `${author.displayName} (${parts.filter(Boolean).join(', ')})`;
}

/**
 * Every author of a document, attributed, by id: what a view looks a name up
 * in. A persona's principal is named by display name when the document
 * describes it, and by its id when it does not -- never dropped.
 */
export function attributions(authors: readonly Author[]): Map<string, string> {
  const names = new Map(authors.map((a) => [a.id, a.displayName]));
  return new Map(authors.map((a) => [a.id, attribution(a, {
    principal: a.principalId && a.principalId !== a.id ? names.get(a.principalId) ?? a.principalId : undefined,
  })]));
}
