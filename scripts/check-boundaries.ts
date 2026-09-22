/**
 * Enforces the module boundaries the ADRs make load-bearing.
 *
 * The rules themselves live in `boundary-rules.ts`, as pure functions, so the
 * tests run exactly what this script runs against deliberately-violating
 * fixtures (#39). This file only walks the tree, reads the metafile and exits.
 *
 * Run before the build (static) and again after (bundle inputs), because the
 * second is the one that actually proves ADR-0005's stated condition of
 * acceptance: that a core-only consumer gets no view code -- and, per ADR-0017,
 * no classic zod.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { bundleViolations, sourceViolations, type Metafile, type Violation } from './boundary-rules.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

function checkSources(): Violation[] {
  return walk(SRC).flatMap((file) =>
    sourceViolations(relative(ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8')));
}

function checkBundle(): Violation[] {
  const dist = join(ROOT, 'dist');
  const meta = join(dist, 'metafile-esm.json');

  // Before a build there is no dist, and running the static half alone is the
  // intended behaviour. But a dist with no metafile means the build stopped
  // emitting one and this check has quietly become a no-op -- which is exactly
  // the failure it exists to prevent, so say so instead of passing.
  if (!existsSync(dist)) return [];
  if (!existsSync(meta)) {
    return [{
      file: 'dist/metafile-esm.json',
      line: 0,
      rule: 'bundle-check-cannot-run',
      text: 'dist exists but no metafile was emitted; set `metafile: true` in tsup.config.ts. ' +
        'Without it the core-contains-no-view check silently passes.',
    }];
  }
  return bundleViolations(JSON.parse(readFileSync(meta, 'utf8')) as Metafile);
}

const violations = [...checkSources(), ...checkBundle()];

if (violations.length === 0) {
  console.log(
    'boundaries ok: core has no DOM, core does not import view, no network outside store, ' +
      'no classic zod, no module-scope registration' +
      (existsSync(join(ROOT, 'dist')) ? '; core bundle holds no view code and no classic zod' : ''),
  );
  process.exit(0);
}

console.error(`\n${violations.length} boundary violation(s):\n`);
for (const x of violations) {
  console.error(`  ${x.file}:${x.line}\n    ${x.rule}\n    ${x.text}\n`);
}
console.error('See ADR-0005 (headless core), ADR-0013 (nothing reaches past its adapter) and ADR-0017 ' +
  '(zod/mini, explicit registries).\n');
process.exit(1);
