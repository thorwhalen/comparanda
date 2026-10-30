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
const RESERVED = 'reserved-example-lib';

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

/**
 * A dependency incompressible enough that minification cannot shrink it, larger than the headroom, and
 * larger than comparanda's own code as the budget attributes it (by rendered length), so it is named first.
 */
const HEAVY = `export default ${JSON.stringify(Array.from({ length: 24_000 }, (_, i) => `item-${i}-${(i * 7919) % 10007}`))};\n`;

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
      const built = await buildStandalone(json).catch((error: unknown) => {
        rows.push(`| ${fixture} | over budget: ${error instanceof Error ? error.message.split('\n')[0] : String(error)} | | | |`);
        throw error;
      });
      const { bytes, budget } = built;
      rows.push(`| ${fixture} | ${kb(bytes)} | ${kb(budget.shellBytes)} | ${kb(budget.charged)} | ${kb(budget.limit)} |`);
      expect(budget.within).toBe(true);
      expect(budget.charged).toBeLessThanOrEqual(budget.limit);
      // The analysis is what makes the files differ; the budget is held against the rest.
      expect(budget.shellBytes).toBeLessThan(bytes);
      // Attribution accounts for every byte of the shell, and the code is ours and our dependencies'.
      expect(budget.contributions.reduce((a, c) => a + c.bytes, 0)).toBe(budget.shellBytes);
      expect(budget.contributions.map((c) => c.package)).toEqual(expect.arrayContaining(['comparanda', 'preact']));
      // No reservation is held (ADR-0008 amendment, #190): the page is charged for what it carries.
      expect(budget.reserved).toEqual([]);
      expect(budget.charged).toBe(budget.shellBytes);
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
    const entry = await entryWith('heavy-charting-lib', HEAVY);
    const failure = await buildStandalone(relocationJson, { entry }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BudgetExceeded);
    const { message, report } = failure as BudgetExceeded;
    expect(report.contributions[0]!.package).toBe('heavy-charting-lib');
    expect(message.split('\n')[2]).toMatch(/^ {2}heavy-charting-lib: [\d,]+ bytes$/);
  });

  it('`budget: false` reports an overrun without enforcing it', async () => {
    const entry = await entryWith('heavy-charting-lib', HEAVY);
    const { budget } = await buildStandalone(relocationJson, { entry, budget: false, check: 'static' });
    expect(budget.limit).toBe(STANDALONE_BUDGET.limit);
    expect(budget.within).toBe(false);
    expect(budget.contributions[0]!.package).toBe('heavy-charting-lib');
  });
});

describe('a reservation', () => {
  const held = { limit: STANDALONE_BUDGET.limit, reserved: [{ package: RESERVED, bytes: 4 * 1024, why: 'a test reservation' }] };

  it('is charged until its package is bundled', async () => {
    const { budget } = await buildStandalone(relocationJson, { budget: held, check: 'static' });
    expect(budget.reserved.map((r) => r.package)).toEqual([RESERVED]);
    expect(budget.charged).toBe(budget.shellBytes + 4 * 1024);
  });

  it('lapses once its package is bundled, which is then charged by measurement', async () => {
    const entry = await entryWith(RESERVED, `export default function draggable(el) { return () => el; }\n`);
    const { budget } = await buildStandalone(relocationJson, { entry, budget: held, check: 'static' });
    expect(budget.reserved.map((r) => r.package)).not.toContain(RESERVED);
    expect(budget.contributions.map((c) => c.package)).toContain(RESERVED);
    expect(budget.charged).toBe(budget.shellBytes);
  });
});
