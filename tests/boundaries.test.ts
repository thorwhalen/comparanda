/**
 * Tests for the boundary checker itself.
 *
 * A guard that never fires is worse than no guard: it produces a green check and
 * a false sense that the property holds. The checker was made *less* eager after
 * it flagged `{ document: current }` -- a field named "document", not the DOM --
 * and this file exists so that loosening cannot silently go too far.
 *
 * Rather than shelling out to the script, the same detection rules are exercised
 * directly against representative lines. The point is the rules, and testing
 * them here keeps the failure message readable.
 */
import { describe, it, expect } from 'vitest';

/** The predicate `check-boundaries.ts` applies for a DOM global. */
function usesDomGlobal(line: string, global: string): boolean {
  const used = new RegExp(`(?<![.\\w$])${global}\\s*[.\\[(]`);
  const typeofGuard = new RegExp(`typeof\\s+${global}\\b`);
  return used.test(line) || typeofGuard.test(line);
}

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

/**
 * The bundle half of the check — ADR-0005's stated condition of acceptance,
 * that a core-only consumer gets no view code.
 *
 * It reads the esbuild metafile tsup emits. Two things can make it a no-op: the
 * metafile not being emitted at all, and the field names drifting. The first is
 * now a loud failure in the script; the second is what this covers, by running
 * the same predicate against a synthetic metafile of each shape.
 */
type Metafile = { outputs: Record<string, { entryPoint?: string; inputs?: Record<string, unknown> }> };

function coreBundleLeaks(meta: Metafile): string[] {
  const leaks: string[] = [];
  for (const [, info] of Object.entries(meta.outputs)) {
    if (info.entryPoint !== 'src/index.ts') continue;
    for (const input of Object.keys(info.inputs ?? {})) {
      if (input.includes('src/view/')) leaks.push(input);
    }
  }
  return leaks;
}

describe('core bundle isolation', () => {
  it('flags view code that reached the core bundle', () => {
    const leaked: Metafile = {
      outputs: {
        'dist/index.js': {
          entryPoint: 'src/index.ts',
          inputs: { 'src/core/schema/analysis.ts': {}, 'src/view/matrix.ts': {} },
        },
      },
    };
    expect(coreBundleLeaks(leaked)).toEqual(['src/view/matrix.ts']);
  });

  it('does not flag view code in the view bundle, which is where it belongs', () => {
    const fine: Metafile = {
      outputs: {
        'dist/index.js': { entryPoint: 'src/index.ts', inputs: { 'src/core/schema/analysis.ts': {} } },
        'dist/view/index.js': { entryPoint: 'src/view/index.ts', inputs: { 'src/view/index.ts': {} } },
      },
    };
    expect(coreBundleLeaks(fine)).toEqual([]);
  });

  it('reads the real metafile when one has been built', async () => {
    // Skipped rather than failed when dist is absent: `pnpm test` is expected to
    // work without a prior build. CI builds first, so there it does run.
    const { existsSync, readFileSync } = await import('node:fs');
    const path = new URL('../dist/metafile-esm.json', import.meta.url).pathname;
    if (!existsSync(path)) return;
    const meta = JSON.parse(readFileSync(path, 'utf8')) as Metafile;
    const entries = Object.values(meta.outputs).filter((o) => o.entryPoint === 'src/index.ts');
    expect(entries.length, 'no core entry in the metafile — field names may have drifted').toBe(1);
    expect(coreBundleLeaks(meta)).toEqual([]);
  });
});
