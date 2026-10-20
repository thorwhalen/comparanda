/**
 * Writing as an author: the one rule every write that names its author keeps
 * (ADR-0012). Internal to `core`, shared by the thread and suggestion writes;
 * not part of the package's API.
 */
import type { Analysis } from './schema/analysis.js';
import type { Author } from './schema/provenance.js';
import { attribution } from './identity.js';

/**
 * The analysis with this author described, added when it is not; an existing
 * record is never overwritten. A writer whose id the document already gives to
 * a different kind of author, or one known differently well, is refused: the
 * reader sees the document's record, so writing under it would sign as them.
 */
export function withAuthor(a: Analysis, author: Author): Analysis {
  const known = a.authors.find((x) => x.id === author.id);
  if (!known) return { ...a, authors: [...a.authors, author] };
  // Who the record says made it, not only how well it is known: another model, run or principal is another author (ADR-0012, #209).
  const vouch = (x: Author) => JSON.stringify([
    x.kind, x.attestation?.method ?? 'unverified', x.attestation?.issuer ?? '', x.principalId ?? x.id, x.actingAs,
    x.agent && [x.agent.name, x.agent.model, x.agent.promptVersion, x.agent.runId],
  ]);
  if (vouch(known) !== vouch(author)) {
    throw new Error(`"${author.id}" is ${attribution(known)} in this analysis; a ${author.kind} identity known differently, ` +
      'or another run or persona, cannot write as them.');
  }
  return a;
}
