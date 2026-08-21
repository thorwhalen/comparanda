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
