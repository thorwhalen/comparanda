/**
 * The byte budget (#116, ADR-0017 clause 8): every example fixture builds
 * within it, reported per fixture (and into the CI job summary); a build over
 * it fails and names where the bytes went; a dependency that breaks it is
 * named first; and a reserved dependency stops being an estimate once bundled.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BudgetExceeded, buildStandalone, STANDALONE_BUDGET } from '../../src/build/index.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const examples = join(repo, 'examples');
const fixtures = (await readdir(examples)).filter((f) => f.endsWith('.json')).sort();
const relocationJson = JSON.parse(await readFile(join(examples, 'relocation.json'), 'utf8'));
const realEntry = join(repo, 'src', 'standalone', 'main.ts');
const DND = STANDALONE_BUDGET.reserved[0]!.package;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'comparanda-budget-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An entry that is the real page plus one more package, installed in a scratch `node_modules`. */
async function entryWith(pkg: string, source: string): Promise<string> {
  const home = await mkdtemp(join(dir, 'entry-'));
  const at = join(home, 'node_modules', ...pkg.split('/'));
  await mkdir(at, { recursive: true });
  await writeFile(join(at, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0', type: 'module', main: 'index.js', sideEffects: false }));
  await writeFile(join(at, 'index.js'), source);
  const entry = join(home, 'entry.js');
  await writeFile(entry, `import ${JSON.stringify(realEntry)};\nimport extra from ${JSON.stringify(pkg)};\nglobalThis.__extra = extra;\n`);
  return entry;
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

describe('every example fixture builds within the budget', () => {
  const rows: string[] = [];
  afterAll(async () => {
    const table = ['| fixture | page (raw) | analysis excluded | charged | budget |', '|---|---:|---:|---:|---:|', ...rows].join('\n');
    console.log(`\nStandalone byte budget (ADR-0017 clause 8)\n${table}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Standalone byte budget\n\n${table}\n`);
  });

  for (const fixture of fixtures) {
    it(fixture, async () => {
      const json = JSON.parse(await readFile(join(examples, fixture), 'utf8'));
      const { bytes, budget } = await buildStandalone(json);
      rows.push(`| ${fixture} | ${kb(bytes)} | ${kb(budget.shellBytes)} | ${kb(budget.charged)} | ${kb(budget.limit)} |`);
      expect(budget.within).toBe(true);
      expect(budget.charged).toBeLessThanOrEqual(budget.limit);
      // The analysis is what makes the files differ; the budget is held against the rest.
      expect(budget.shellBytes).toBeLessThan(bytes);
      // Attribution accounts for every byte of the shell, and the code is ours and our dependencies'.
      expect(budget.contributions.reduce((a, c) => a + c.bytes, 0)).toBe(budget.shellBytes);
      expect(budget.contributions.map((c) => c.package)).toEqual(expect.arrayContaining(['comparanda', 'preact']));
      // The drag-and-drop dependency is charged before it lands (ADR-0008).
      expect(budget.reserved.map((r) => r.package)).toContain(DND);
      expect(budget.charged).toBe(budget.shellBytes + budget.reserved.reduce((a, r) => a + r.bytes, 0));
    });
  }
});

describe('over budget, the build fails and says why', () => {
  it('names where the bytes went, largest first', async () => {
    const tight = { limit: 10_000, reserved: [] };
    const failure = await buildStandalone(relocationJson, { budget: tight }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BudgetExceeded);
    const { message, report } = failure as BudgetExceeded;
    expect(message).toMatch(/over its byte budget/);
    expect(message).toMatch(/against 10,000/);
    expect(message).toContain('preact');
    expect(report.contributions[0]!.bytes).toBeGreaterThanOrEqual(report.contributions[1]!.bytes);
  });

  it('a dependency that breaks the budget is named first', async () => {
    // Incompressible enough that minification cannot shrink it, and larger than the headroom.
    const heavy = `export default ${JSON.stringify(Array.from({ length: 12_000 }, (_, i) => `item-${i}-${(i * 7919) % 10007}`))};\n`;
    const entry = await entryWith('heavy-charting-lib', heavy);
    const failure = await buildStandalone(relocationJson, { entry }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BudgetExceeded);
    const { message, report } = failure as BudgetExceeded;
    expect(report.contributions[0]!.package).toBe('heavy-charting-lib');
    expect(message.split('\n')[2]).toMatch(/^ {2}heavy-charting-lib: [\d,]+ bytes$/);
  });

  it('`budget: false` reports without enforcing', async () => {
    const { budget } = await buildStandalone(relocationJson, { budget: false });
    expect(budget.limit).toBe(STANDALONE_BUDGET.limit);
    expect(budget.within).toBe(true);
  });
});

describe('a reservation', () => {
  it('lapses once its package is bundled, which is then charged by measurement', async () => {
    const entry = await entryWith(DND, `export default function draggable(el) { return () => el; }\n`);
    const { budget } = await buildStandalone(relocationJson, { entry });
    expect(budget.reserved.map((r) => r.package)).not.toContain(DND);
    expect(budget.contributions.map((c) => c.package)).toContain(DND);
    expect(budget.charged).toBe(budget.shellBytes);
  });
});
