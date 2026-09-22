/**
 * Tests for the boundary checker itself (#39).
 *
 * A guard that never fires is worse than no guard: it produces a green check and
 * a false sense that the property holds. The checker was made *less* eager after
 * it flagged `{ document: current }` -- a field named "document", not the DOM --
 * and this file exists so that loosening cannot silently go too far.
 *
 * Everything here imports the predicates from `scripts/boundary-rules.ts`, the
 * module `check-boundaries.ts` runs. An earlier version tested a copy of each
 * predicate, which is how the static "core must not import view" rule went
 * unnoticed as a no-op: it matched import paths in text whose string literals
 * had already been blanked out.
 *
 * Each rule has a deliberately violating fixture under `tests/fixtures/boundaries`
 * that it must catch, and there is one fixture full of near-misses it must not.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bundleViolations, importChain, isClassicZod, sourceViolations, usesDomGlobal, type Metafile,
} from '../scripts/boundary-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, 'fixtures', 'boundaries', `${name}.fixture`), 'utf8');
const rulesHit = (file: string, text: string) => sourceViolations(file, text).map((v) => v.rule);

describe('DOM-global detection', () => {
  it('catches real usage', () => {
    const violations = [
      'const el = document.querySelector(".cell");',
      'window.addEventListener("resize", onResize);',
      'localStorage.setItem("view", JSON.stringify(state));',
      'const raw = sessionStorage["comparanda"];',
      'if (typeof window !== "undefined") { }',
      'const ch = new BroadcastChannel("comparanda");',
    ];
    const globals = ['document', 'window', 'localStorage', 'sessionStorage', 'BroadcastChannel'];
    for (const line of violations) {
      const hit = globals.some((g) => usesDomGlobal(line, g));
      expect(hit, `should have flagged: ${line}`).toBe(true);
    }
  });

  it('does not fire on a field that merely shares the name', () => {
    const innocent = [
      'return { document: current, path, applied };',
      'const { document } = result;',
      'interface MigrationResult { document: VersionedDocument }',
      'export function migrate(doc: VersionedDocument): MigrationResult',
      'a.window = 3;',
      'const windowSize = 5;',
      'const documentId = cell.id;',
    ];
    const globals = ['document', 'window', 'localStorage', 'sessionStorage', 'BroadcastChannel'];
    for (const line of innocent) {
      const hit = globals.some((g) => usesDomGlobal(line, g));
      expect(hit, `should NOT have flagged: ${line}`).toBe(false);
    }
  });

  it('is not fooled by a property access on another object', () => {
    // `foo.document.bar` is reaching through an object, not the global.
    expect(usesDomGlobal('const x = adapter.document.title;', 'document')).toBe(false);
  });
});

describe('each rule catches its deliberately violating fixture', () => {
  const cases: [fixture: string, pretendPath: string, rule: RegExp][] = [
    ['core-uses-dom', 'src/core/schema/leaky.ts', /^core-has-no-dom \(document\)$/],
    ['core-imports-view', 'src/core/analyses/leaky.ts', /^core-must-not-import-view$/],
    ['view-fetches', 'src/view/leaky.ts', /^no-network-outside-store \(fetch\(\)$/],
    ['classic-zod', 'src/view/leaky.ts', /^no-classic-zod \("zod"\)$/],
    ['self-registers', 'src/view/encodings/heat.ts', /^no-self-registration$/],
  ];

  it.each(cases)('%s', (name, path, rule) => {
    const hits = rulesHit(path, fixture(name));
    expect(hits, `expected exactly one violation from ${name}, got ${JSON.stringify(hits)}`).toHaveLength(1);
    expect(hits[0]).toMatch(rule);
  });

  it('passes a file full of near-misses', () => {
    // Field names, strings that mention globals and imports, a URL containing
    // a comment marker, zod/mini, and registration inside a function.
    expect(sourceViolations('src/core/schema/clean.ts', fixture('clean'))).toEqual([]);
  });

  it('says why self-registration is a correctness rule, not a style one', () => {
    const [v] = sourceViolations('src/view/encodings/heat.ts', fixture('self-registers'));
    expect(v!.text).toMatch(/correctness rule, not a style one/);
    expect(v!.text).toMatch(/sideEffects/);
  });

  it('applies rules by location: store may fetch, and only core is DOM-free', () => {
    expect(rulesHit('src/store/http.ts', fixture('view-fetches'))).toEqual([]);
    expect(rulesHit('src/view/leaky.ts', fixture('core-uses-dom'))).toEqual([]);
  });

  it('sees view imports however they are written', () => {
    for (const src of [
      "export { x } from '../../view/index.js';",
      "export * from '../../view/index.js';",
      "const v = await import('../../view/matrix.js');",
      "import type { Props } from '../../view';",
    ]) {
      expect(rulesHit('src/core/analyses/a.ts', src), src).toContain('core-must-not-import-view');
    }
  });

  it('resolves the path rather than matching the word "view"', () => {
    for (const src of [
      "import { x } from './view/helpers.js';", // a core subdirectory that happens to be called view
      "import { x } from '../preview.js';",
      "import { x } from '../viewport.js';",
    ]) {
      expect(rulesHit('src/core/analyses/a.ts', src), src).not.toContain('core-must-not-import-view');
    }
  });

  it('finds registration wherever it runs at import, and nowhere else', () => {
    const atImport = [
      'registerEncoding(heat);',
      'export const heat = registerEncoding({ id: "heat" });',
      'const _ = register(impl);',
      'export default register(impl);',
      '(() => { registerMigration(m); })();',
      'if (ready) registerMigration(m);',
      'ENCODING_REGISTRY.set("heat", heat);',
      'encodings.registry.add(heat);',
    ];
    for (const src of atImport) {
      expect(rulesHit('src/view/x.ts', src), src).toEqual(['no-self-registration']);
    }
    const later = [
      'export function compose() { registerEncoding(heat); }',
      'export const compose = () => registerEncoding(heat);',
      'class Root { start() { registerEncoding(heat); } }',
      'const n = registeredMigrations().length;',
      'const map = new Map(); map.set("heat", heat);',
    ];
    for (const src of later) expect(rulesHit('src/view/x.ts', src), src).toEqual([]);
  });

  it('tells classic zod from zod/mini', () => {
    for (const s of ['zod', 'zod/v4', 'zod/v3', 'zod/v4/classic']) expect(isClassicZod(s), s).toBe(true);
    for (const s of ['zod/mini', 'zod/v4/mini', 'zod/v4/core', 'zod/v4/locales/en.js', 'zodal', '@zodal/groups-core']) {
      expect(isClassicZod(s), s).toBe(false);
    }
  });

  it('passes the real source tree (the same walk the script makes)', async () => {
    const { readdirSync } = await import('node:fs');
    const root = join(here, '..');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
    const found = walk(join(root, 'src')).flatMap((f) =>
      sourceViolations(f.slice(root.length + 1).split('\\').join('/'), readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });
});

/**
 * The bundle half of the check -- ADR-0005's stated condition of acceptance,
 * that a core-only consumer gets no view code, and ADR-0017's, that it gets no
 * classic zod.
 *
 * It reads the esbuild metafile tsup emits. What made it a potential no-op: the
 * metafile not being emitted (a loud failure in the script), the field names
 * drifting (`bundle-check-cannot-run` below), and code splitting, which puts
 * shared code in chunks the entry imports rather than in the entry itself.
 */
describe('core bundle isolation', () => {
  const meta = (m: Metafile) => m;

  it('flags view code that reached the core bundle, and names the chain', () => {
    const leaked = meta({
      inputs: {
        'src/index.ts': { imports: [{ path: 'src/core/schema/analysis.ts' }] },
        'src/core/schema/analysis.ts': { imports: [{ path: 'src/view/matrix.ts' }] },
        'src/view/matrix.ts': { imports: [] },
      },
      outputs: {
        'dist/index.js': {
          entryPoint: 'src/index.ts',
          inputs: { 'src/core/schema/analysis.ts': {}, 'src/view/matrix.ts': {} },
        },
      },
    });
    const v = bundleViolations(leaked);
    expect(v.map((x) => x.rule)).toEqual(['core-bundle-contains-view']);
    expect(v[0]!.text).toBe('src/index.ts -> src/core/schema/analysis.ts -> src/view/matrix.ts');
  });

  it('follows chunk imports: view code in a shared chunk still reaches core', () => {
    const viaChunk = meta({
      outputs: {
        'dist/index.js': { entryPoint: 'src/index.ts', inputs: { 'src/index.ts': {} }, imports: [{ path: 'dist/chunk-A.js', kind: 'import-statement' }] },
        'dist/chunk-A.js': { inputs: { 'src/view/shared.ts': {} } },
        'dist/view/index.js': { entryPoint: 'src/view/index.ts', inputs: {}, imports: [{ path: 'dist/chunk-A.js', kind: 'import-statement' }] },
      },
    });
    expect(bundleViolations(viaChunk).map((x) => [x.file, x.rule]))
      .toEqual([['dist/chunk-A.js', 'core-bundle-contains-view']]);
  });

  it('flags classic zod imported by the core bundle, and names who asked', () => {
    const zodded = meta({
      inputs: {
        'src/index.ts': { imports: [{ path: 'src/core/x.ts' }] },
        'src/core/x.ts': { imports: [{ path: 'zod' }] },
      },
      outputs: {
        'dist/index.js': {
          entryPoint: 'src/index.ts', inputs: { 'src/core/x.ts': {} },
          imports: [{ path: 'zod/mini', kind: 'import-statement' }, { path: 'zod', kind: 'import-statement' }],
        },
      },
    });
    const v = bundleViolations(zodded);
    expect(v.map((x) => x.rule)).toEqual(['core-bundle-imports-classic-zod']);
    expect(v[0]!.text).toBe('src/index.ts -> src/core/x.ts -> zod');
  });

  it('does not flag view code in the view bundle, which is where it belongs', () => {
    const fine = meta({
      outputs: {
        'dist/index.js': { entryPoint: 'src/index.ts', inputs: { 'src/core/schema/analysis.ts': {} } },
        'dist/view/index.js': { entryPoint: 'src/view/index.ts', inputs: { 'src/view/index.ts': {} } },
      },
    });
    expect(bundleViolations(fine)).toEqual([]);
  });

  it('refuses to pass having read nothing', () => {
    // A metafile whose entry is not where we look must not read as clean.
    const drifted = meta({ outputs: { 'dist/index.js': { inputs: { 'src/view/x.ts': {} } } } });
    expect(bundleViolations(drifted).map((x) => x.rule)).toEqual(['bundle-check-cannot-run']);
  });

  it('follows dynamic imports: a lazy view import from core still reaches core consumers', () => {
    const lazy = meta({
      outputs: {
        'dist/index.js': { entryPoint: 'src/index.ts', inputs: {}, imports: [{ path: 'dist/matrix-X.js', kind: 'dynamic-import' }] },
        'dist/matrix-X.js': { inputs: { 'src/view/matrix.ts': {} } },
      },
    });
    expect(bundleViolations(lazy).map((x) => x.rule)).toEqual(['core-bundle-contains-view']);
  });

  it('names the core-side importer of classic zod, not a view file that also imports it', () => {
    const both = meta({
      inputs: {
        'src/view/a.ts': { imports: [{ path: 'zod' }] },
        'src/index.ts': { imports: [{ path: 'src/core/x.ts' }] },
        'src/core/x.ts': { imports: [{ path: 'zod' }] },
      },
      outputs: {
        'dist/index.js': { entryPoint: 'src/index.ts', inputs: { 'src/core/x.ts': {} }, imports: [{ path: 'zod' }] },
      },
    });
    // The view file is listed first; a first-match lookup would name it.
    expect(bundleViolations(both)[0]!.text).toBe('src/index.ts -> src/core/x.ts -> zod');
  });

  it('names a chain it cannot connect by the input alone', () => {
    expect(importChain(meta({ outputs: {} }), 'src/index.ts', 'src/view/x.ts')).toBe('src/view/x.ts');
  });

  it('reads the real metafile when one has been built', () => {
    // Skipped when dist is absent: `pnpm test` must work without a build, and CI
    // runs the tests before it builds. The script's post-build run is what
    // checks the real bundle in CI; this covers a local run after a build.
    const path = join(here, '..', 'dist', 'metafile-esm.json');
    if (!existsSync(path)) return;
    expect(bundleViolations(JSON.parse(readFileSync(path, 'utf8')) as Metafile)).toEqual([]);
  });
});
