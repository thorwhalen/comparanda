/**
 * Core never branches on a literal missingness reason code.
 *
 * ADR-0009 as amended, and #44: the `structural` / `terminal` / `informative`
 * flags are enough to drive every completeness computation and every rendering
 * decision. That is what makes a deployment's custom code -- which core has
 * never heard of -- unable to break the completeness report: it declares its
 * flags and a `broader` parent, and everything downstream reads the flags.
 *
 * The first `case 'not-evidenced':` in core quietly ends that guarantee, because
 * a custom child of `not-evidenced` will not take the branch. So this file scans
 * `src/core` and fails on any comparison, membership test or lookup table keyed
 * on a core code -- `offendingNodes` below lists exactly what.
 *
 * Writing a code (`code: NOT_ASSESSED`) is not branching on one and is not
 * flagged. The allowed exceptions -- the flag table itself, and one declaration
 * invariant -- are listed in `ALLOWED` with their reasons; each must match
 * exactly one node, so an entry can neither go stale nor quietly cover a second
 * offence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = join(root, 'src', 'core');

const CODES = Object.keys(CORE_MISSING_CODES);
/** Exported constants whose value is a core code. Kept in step by a test below. */
const CODE_CONSTANTS = ['NOT_ASSESSED', 'NOT_APPLICABLE', 'WITHHELD'];

/**
 * Comparisons that are declaration invariants rather than behaviour keyed on a
 * code. Each entry is a file (relative to the repo) and a fragment of the line.
 */
const ALLOWED: { file: string; fragment: string; why: string }[] = [
  {
    file: 'src/core/schema/missingness.ts',
    fragment: "{ 'not-applicable': { structural: true",
    why: 'CORE_MISSING_CODES itself: the one table keyed by code, holding the flags every ' +
      'consumer reads instead of branching on the code. It is the cure, not the disease.',
  },
  {
    file: 'src/core/schema/analysis.ts',
    fragment: 'broader !== NOT_APPLICABLE',
    why: 'ADR-0009 precedence: a code declaring structural: true must have broader ' +
      '"not-applicable". This validates a declaration; it does not branch on a cell\'s code.',
  },
];

/**
 * The detector reads the syntax tree, not the text.
 *
 * A line scanner was tried first and was fooled by a string containing `/*`
 * (everything after it read as a comment), by `case` and its label on separate
 * lines, and by an import alias. The TypeScript parser already knows what is a
 * string, a comment and a comparison, so this asks it.
 *
 * Flagged, anywhere in a file:
 *   - `case <code>` and `==`/`===`/`!=`/`!==` with a code on either side;
 *   - `Object.is(..., <code>)`;
 *   - `[<code>, ...].includes(x)` -- membership is a branch by another name;
 *   - an object literal keyed by a core code -- a lookup table does the job of
 *     a switch, and is the likeliest way round a switch-only guard.
 * where `<code>` is a string literal naming a core code, a constant bound to one
 * (including under an import alias), `X.enum.<code>`, or any of those in
 * parentheses.
 *
 * Not flagged, knowingly: a code reached through a variable the parser cannot
 * see the value of (`const c = 'withheld'; ... === c`). That needs type-level
 * analysis and would buy little: the pattern here is written by hand, and the
 * obvious ways of writing it are covered.
 */
interface Hit { line: number; text: string }

function offendingNodes(source: string, fileName = 'x.ts'): Hit[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const constants = new Set(CODE_CONSTANTS);
  // Import aliases: `import { NOT_ASSESSED as NA }` makes `NA` a code too.
  sf.forEachChild(function aliases(n) {
    if (ts.isImportSpecifier(n) && CODE_CONSTANTS.includes((n.propertyName ?? n.name).text)) {
      constants.add(n.name.text);
    }
    n.forEachChild(aliases);
  });

  const isCode = (e: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(e)) return isCode(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return CODES.includes(e.text);
    if (ts.isIdentifier(e)) return constants.has(e.text);
    if (ts.isPropertyAccessExpression(e)) {
      return CODES.includes(e.name.text) && ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === 'enum';
    }
    if (ts.isElementAccessExpression(e)) {
      return isCode(e.argumentExpression) && ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === 'enum';
    }
    return false;
  };
  const EQ = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ]);
  const keyText = (k: ts.PropertyName): string | undefined =>
    ts.isIdentifier(k) || ts.isStringLiteral(k) ? k.text : undefined;

  const hits: Hit[] = [];
  const flag = (n: ts.Node) => hits.push({
    line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
    text: n.getText(sf).replace(/\s+/g, ' '),
  });
  sf.forEachChild(function walk(n) {
    if (ts.isCaseClause(n) && isCode(n.expression)) flag(n.expression);
    else if (ts.isBinaryExpression(n) && EQ.has(n.operatorToken.kind) && (isCode(n.left) || isCode(n.right))) flag(n);
    else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const { expression: target, name } = n.expression;
      if (name.text === 'is' && ts.isIdentifier(target) && target.text === 'Object' && n.arguments.some(isCode)) flag(n);
      if (name.text === 'includes' && ts.isArrayLiteralExpression(target) && target.elements.some(isCode)) flag(n);
    } else if (ts.isObjectLiteralExpression(n) && n.properties.some((p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name &&
      CODES.includes(keyText(p.name) ?? ''))) {
      flag(n);
    }
    n.forEachChild(walk);
  });
  return hits;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('the detector', () => {
  const flagged = (src: string) => offendingNodes(src).length;

  it('catches a switch, and an equality either way round, on a literal code', () => {
    const offending = [
      "switch (c) { case 'not-evidenced': break; }",
      'switch (c) { case "withheld": return 0; }',
      "if (m.code === 'deferred') {}",
      "if ('indeterminate' !== code) {}",
      'const quiet = code == `not-assessed`;',
      'if (code === NOT_ASSESSED) {}',
      'switch (c) { case NOT_APPLICABLE: break; }',
      'const r = NOT_APPLICABLE !== c;',
    ];
    for (const src of offending) expect(flagged(src), `should have flagged: ${src}`).toBe(1);
  });

  it('catches the ways round a switch-only guard', () => {
    const offending = [
      // an alias
      "import { NOT_ASSESSED as NA } from './missingness.js';\nif (c === NA) {}",
      // the zod enum
      'if (c === MissingCode.enum.withheld) {}',
      "if (c === MissingCode.enum['not-assessed']) {}",
      // parentheses
      'if (c === (NOT_ASSESSED)) {}',
      // label on its own line
      "switch (c) {\n  case\n    'withheld':\n    break;\n}",
      // Object.is and membership
      "if (Object.is(c, 'deferred')) {}",
      "if (['withheld', 'not-evidenced'].includes(c)) {}",
      // a lookup table keyed by code
      'const weight = { withheld: 0, deferred: 1 };',
      "const label = { 'not-assessed': 'not yet' };",
    ];
    for (const src of offending) expect(flagged(src), `should have flagged: ${src}`).toBe(1);
  });

  it('is not fooled by comment markers inside strings', () => {
    // The line scanner this replaced read everything after '/*' as a comment.
    const src = "const glob = 'src/*';\nconst url = 'http://x'; if (c === 'withheld') {}";
    expect(offendingNodes(src).map((h) => h.line)).toEqual([2]);
  });

  it('does not fire on writing a code, a comment, or an unrelated string', () => {
    const innocent = [
      'cells.push({ hasValue: false, code: NOT_ASSESSED });',
      "const fallback = { code: 'not-assessed' };",
      "// case 'withheld': used to be here",
      "/* if (c === 'withheld') */ const x = 1;",
      "if (level === 'nominal') {}",
      "if (status === 'deferred-review') {}",
      'const fix = `set broader to "${NOT_APPLICABLE}"`;',
      'if (facts.terminal === true) {}',
      "const msg = 'the code withheld is terminal';",
    ];
    for (const src of innocent) expect(flagged(src), `should NOT have flagged: ${src}`).toBe(0);
  });

  it('knows every constant that names a core code', () => {
    const missingness = readFileSync(join(coreDir, 'schema', 'missingness.ts'), 'utf8');
    const named = [...missingness.matchAll(/export const (\w+) = (['"])([\w-]+)\2 as const/g)]
      .filter((m) => CODES.includes(m[3]!))
      .map((m) => m[1]);
    expect(named.sort()).toEqual([...CODE_CONSTANTS].sort());
  });
});

describe('src/core', () => {
  const files = tsFiles(coreDir);
  const relOf = (f: string) => relative(root, f).split('\\').join('/');
  const allowed = (rel: string, h: Hit) => ALLOWED.some((a) => a.file === rel && h.text.startsWith(a.fragment));

  it('has files to scan (so a pass means something)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never branches on a literal missingness reason code', () => {
    const found: string[] = [];
    for (const f of files) {
      const rel = relOf(f);
      for (const h of offendingNodes(readFileSync(f, 'utf8'), f)) {
        if (!allowed(rel, h)) found.push(`${rel}:${h.line}: ${h.text.slice(0, 120)}`);
      }
    }
    expect(
      found,
      'core branched on a reason code. Read the code\'s flags (structural / terminal / ' +
        'informative) or resolve it through its `broader` chain instead (ADR-0009):\n' +
        found.join('\n'),
    ).toEqual([]);
  });

  it('allows each listed exception exactly once, and none is stale', () => {
    for (const a of ALLOWED) {
      const hits = offendingNodes(readFileSync(join(root, a.file), 'utf8'))
        .filter((h) => h.text.startsWith(a.fragment));
      expect(hits.length, `ALLOWED entry should match exactly one node: ${a.file}: ${a.fragment}`).toBe(1);
    }
  });
});
