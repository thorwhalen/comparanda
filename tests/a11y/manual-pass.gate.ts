/**
 * The manual half of the accessibility gate (ADR-0029, #105): B1-B8 are run by
 * a person once per release and recorded in the release notes. A machine
 * cannot run them, but it can see that the template a release starts from asks
 * for every one, in the words of the research section they came from, so the
 * list cannot drift into a wiki or lose a row.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

/** The research section's manual list: `1. **Title.** ...` up to the next heading. */
function manualPass(): { n: number; title: string }[] {
  const section = read('docs/research/sections/c7-interaction-a11y.md');
  const body = section.slice(section.indexOf('### B. Manual pass'));
  const end = body.search(/\n---|\n## /);
  return Array.from(body.slice(0, end < 0 ? undefined : end).matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)).map((m) => ({ n: Number(m[1]), title: m[2]!.replace(/\.$/, '') }));
}

describe('the manual pass (B1-B8) is in the release notes template', () => {
  const template = read('docs/release-notes-template.md');
  const checks = manualPass();

  it('the research section lists eight', () => {
    expect(checks.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each(checks)('B$n: "$title" has a row asking for the environment, the result and what was done', ({ n, title }) => {
    const row = template.split('\n').find((line) => line.startsWith(`| B${n} |`));
    expect(row, `no row for B${n}`).toBeDefined();
    expect(row!.replace(/\*\*/g, '')).toContain(title.replace(/\*\*/g, ''));
    // Four cells after the number and the check: environment, result, what was done.
    expect(row!.split('|').length).toBe(7);
  });

  it('says that the pass is recorded in the notes, and that a skipped row is published as skipped', () => {
    expect(template).toMatch(/recorded \*\*in the release notes\*\*/);
    expect(template).toMatch(/`not run \(why\)`/);
    expect(template).toMatch(/release gate/);
  });
});
