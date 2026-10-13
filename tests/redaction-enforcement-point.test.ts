/**
 * One enforcement point (#107, ADR-0023): the view reaches an assertion's
 * author only through what core hands it. A view module that read `authorId`,
 * a principal or an author's name itself would be a second place the round's
 * redaction has to be remembered, which is what the ADR says it must not be.
 *
 * So the places in `src/view` that name an author are listed here, each with why
 * it may; adding another fails this test until someone says why it is safe.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const view = join(repo, 'src', 'view');

/** Reads of an author's identity in the view, by file, with the reason each is not an assertion's author. */
const ALLOWED: Readonly<Record<string, { reads: number; because: string }>> = {
  'threads.tsx': { reads: 3, because: 'comments, not assertions: they belong to no round (ADR-0023), so their authors are always shown' },
  'detail-panel.tsx': {
    reads: 7,
    because: 'the redacted detail core hands it: `author`, `principal` and the successor\'s name are absent when `authorHidden`, and the fallback for an author the document does not describe is reached only when it is not',
  },
  'mount.ts': { reads: 1, because: '`.author` of a visibility verdict (may this viewer be told who), compared to decide whether a new reader needs a redraw' },
};

const NAMES_AN_AUTHOR = /\bauthorId\b|\bprincipalId\b|\bdisplayName\b|\bprocedureId\b|\.authors\b|\.author\b|\.principal\b|\battributions?\(/g;

describe('the view names an author only where core has already decided it may', () => {
  const files = readdirSync(view, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.tsx?$/.test(e.name));
  const reads = new Map<string, number>();
  for (const f of files) {
    const path = join(f.parentPath, f.name);
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const n = (code.match(NAMES_AN_AUTHOR) ?? []).length;
    if (n > 0) reads.set(relative(view, path), n);
  }

  it('in no file but the allowed ones', () => {
    expect([...reads.keys()].sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it.each(Object.entries(ALLOWED))('%s reads an author no more often than allowed', (file, { reads: allowed }) => {
    expect(reads.get(file)).toBe(allowed);
  });
});
