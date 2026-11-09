/**
 * The matrix stylesheet's source writes its scope as `& ` (#208): only an `&`
 * that starts a selector is expanded, so any other one -- in a value, a
 * string, a comment -- survives into the built stylesheet, and fails here.
 */
import { describe, expect, it } from 'vitest';

import { MATRIX_CSS } from '../src/view/matrix-css.js';

/** A selector list's members: split on its own commas, not those inside `:is(...)`. */
function members(list: string): string[] {
  const out = [''];
  let depth = 0;
  for (const c of list) {
    depth += c === '(' ? 1 : c === ')' ? -1 : 0;
    if (c === ',' && depth === 0) out.push('');
    else out[out.length - 1] += c;
  }
  return out.map((s) => s.trim());
}

describe('the matrix stylesheet\'s scope', () => {
  it('leaves no `&` behind: every one in the source stood where a selector starts', () => {
    expect(MATRIX_CSS).not.toContain('&');
  });

  it('scopes every rule outside an at-rule to the matrix', () => {
    // A rule's selector list is what precedes its `{`; at-rules and the theme blocks' own selectors aside, each starts with the scope.
    const selectors = [...MATRIX_CSS.matchAll(/(?:^|})\s*([^{}@]+?)\s*{/g)].map((m) => m[1]!.trim()).filter((s) => s !== '');
    expect(selectors.length).toBeGreaterThan(100);
    for (const list of selectors) {
      for (const one of members(list)) {
        expect(one, list).toMatch(/^(\.comparanda-matrix\b|:root|:host|\[data-theme="dark"\] > \.comparanda-matrix)/);
      }
    }
  });
});
