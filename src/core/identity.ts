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
 * `tagged` adds the author's own id after the display name; `attributions` sets
 * it for every author whose name another author in the document also bears.
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
  { principal, vouched = false, tagged = false }: { principal?: string | undefined; vouched?: boolean; tagged?: boolean } = {},
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
  // A name another author shares is told apart by id (#265): `tagged`, set by `attributions` where names collide.
  return `${author.displayName}${tagged && author.id !== undefined ? ` [${author.id}]` : ''} (${parts.filter(Boolean).join(', ')})`;
}

/**
 * Whether the host itself performed `author`'s attestation (a host-session
 * sign-in, say), so it reads as attested rather than as a claim (#243, #263).
 * Supplied by the host; the document cannot vouch for itself.
 */
export type Vouched = (author: Author) => boolean;

/** Letters that read as a Latin one, so `Ana` and `Аna` (Cyrillic A) are the same name to a reader. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ζ: 'z',
};

/**
 * A display name as a reader would compare it: case, accents, spacing and the
 * common look-alike letters folded away. Two names with one fold read alike.
 * Not a full confusables table; `principalId` and the id tag state the truth.
 */
export function nameFold(name: string): string {
  return Array.from(name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase())
    .map((ch) => LOOK_ALIKES[ch] ?? ch).join('').replace(/[\s\p{P}]+/gu, ' ').trim();
}

/**
 * Every author of a document, attributed, by id: what a view looks a name up
 * in. A persona's principal is named by display name and id when the document
 * describes it, and by its id when it does not -- never dropped. An author
 * whose display name another author also bears (case-, accent- and look-alike-
 * folded), persona or not, is told apart by ` [id]` after the name (#265).
 * `vouched` says which authors' attestations the host itself performed; none
 * by default.
 */
export function attributions(
  authors: readonly Author[],
  { vouched = () => false }: { vouched?: Vouched | undefined } = {},
): Map<string, string> {
  const names = new Map(authors.map((a) => [a.id, a.displayName]));
  const bearers = new Map<string, number>();
  for (const a of authors) bearers.set(nameFold(a.displayName), (bearers.get(nameFold(a.displayName)) ?? 0) + 1);
  return new Map(authors.map((a) => [a.id, attribution(a, {
    principal: a.principalId === undefined ? undefined : names.get(a.principalId),
    vouched: vouched(a),
    tagged: (bearers.get(nameFold(a.displayName)) ?? 0) > 1,
  })]));
}
