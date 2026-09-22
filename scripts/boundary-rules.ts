/**
 * The module-boundary rules, as pure functions over source text and a metafile.
 *
 * `check-boundaries.ts` is the CLI that walks the tree and exits non-zero; this
 * module is what it applies, so that `tests/boundaries.test.ts` can run the
 * *same* predicates against deliberately-violating fixtures instead of a copy of
 * them that could drift (#39).
 *
 * Five source rules and three bundle rules, each of which has failed silently
 * somewhere real:
 *
 *   core-has-no-dom            ADR-0005: "If you need a DOM API in `core`, the
 *                              design is wrong."
 *   core-must-not-import-view  The dependency runs one way (ADR-0005).
 *   no-network-outside-store   ADR-0013: one stray `fetch()` in a renderer breaks
 *                              the standalone bundle, and only offline.
 *   no-classic-zod             ADR-0017: `zod/mini` only. The classic `zod`
 *                              barrel measured 310,946 raw bytes against
 *                              `zod/mini`'s 15,250, and a namespace object's
 *                              properties cannot be tree-shaken.
 *   no-self-registration       ADR-0017 clause 4: registries are populated by the
 *                              composition root. A module that registers itself
 *                              at import time is deleted by the bundler under
 *                              `"sideEffects": false` -- an empty registry, no
 *                              error (findings-visualisation.md §5.2).
 *
 * The bundle rules re-check the first and fourth against what the build actually
 * contains, following chunk imports, and name the import chain that got there.
 */
import { posix } from 'node:path';
import ts from 'typescript';

export interface Violation { file: string; line: number; rule: string; text: string }

/** Globals that only exist in a browser. Their presence in `core` is the bug. */
export const DOM_GLOBALS = [
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  'HTMLElement', 'Element', 'Node', 'CustomEvent', 'DOMParser',
  'requestAnimationFrame', 'getComputedStyle', 'matchMedia', 'BroadcastChannel',
] as const;

/** Network reach. Legal only behind an adapter in `store/`. */
export const NETWORK = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon'] as const;

/**
 * Module specifiers that resolve to classic zod. `zod/mini` and the internal
 * `zod/v4/core` it is built on are fine; everything else under `zod` pulls the
 * classic namespace in.
 */
export function isClassicZod(specifier: string): boolean {
  if (specifier !== 'zod' && !specifier.startsWith('zod/')) return false;
  // Locales are zod's own tree-shakable per-language message maps, meant for
  // mini users too.
  return !/^zod\/(?:mini|v4\/mini|v4\/core|v4-mini|locales|v4\/locales)(?:\/|$)/.test(specifier);
}

/** Strip comments and string literals so a mention in prose is not a violation. */
export function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => ' '.repeat(m.length));
}

/**
 * Whether `line` uses a DOM global -- as a member access, an index, a call, or a
 * `typeof` guard -- rather than merely containing the word. `{ document: current }`
 * is a field called "document", not the DOM, and flagging it trains people to
 * ignore this check.
 */
export function usesDomGlobal(line: string, global: string): boolean {
  const used = new RegExp(`(?<![.\\w$])${global}\\s*[.\\[(]`);
  const typeofGuard = new RegExp(`typeof\\s+${global}\\b`);
  return used.test(line) || typeofGuard.test(line);
}

/** Every module specifier a file imports, re-exports, `import()`s or `require()`s. */
export function moduleSpecifiers(sf: ts.SourceFile): { specifier: string; node: ts.Node }[] {
  const out: { specifier: string; node: ts.Node }[] = [];
  sf.forEachChild(function walk(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ specifier: n.moduleSpecifier.text, node: n });
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]!) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      out.push({ specifier: n.arguments[0].text, node: n });
    }
    n.forEachChild(walk);
  });
  return out;
}

/**
 * Calls that run at module scope and register something.
 *
 * "At module scope" means: anywhere in the file that executes on import --
 * a bare statement, an initialiser (`export const heat = registerEncoding(...)`),
 * `export default register(...)`, a condition, a comma expression, or the body
 * of an immediately invoked function. Not inside a function, method or class
 * member that runs later: a composition root calling `registerMigration(...)`
 * inside a function is exactly the intended pattern.
 *
 * "Registers" means a callee named `register` / `registerX` (not `registered…`
 * or `registry…`), or `set` / `add` / `register` called on something named like
 * a registry.
 */
export function moduleScopeRegistrations(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const isRegisterName = (name: string) => /^[Rr]egister(?![a-z])/.test(name);
  const registers = (e: ts.CallExpression): boolean => {
    const callee = e.expression;
    if (ts.isIdentifier(callee)) return isRegisterName(callee.text);
    if (ts.isPropertyAccessExpression(callee)) {
      if (isRegisterName(callee.name.text)) return true;
      const target = callee.expression;
      const targetName = ts.isIdentifier(target) ? target.text
        : ts.isPropertyAccessExpression(target) ? target.name.text : '';
      return /registry/i.test(targetName) && ['set', 'add', 'register'].includes(callee.name.text);
    }
    return false;
  };
  const isFunctionLike = (n: ts.Node) =>
    ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n) ||
    ts.isPropertyDeclaration(n);
  const isIife = (n: ts.Node): n is ts.CallExpression => {
    if (!ts.isCallExpression(n)) return false;
    let callee: ts.Expression = n.expression;
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
    return ts.isFunctionExpression(callee) || ts.isArrowFunction(callee);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && registers(n)) out.push(n);
    if (isIife(n)) {
      // Its body runs now, at import.
      let callee: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
      const fn = callee as ts.FunctionExpression | ts.ArrowFunction;
      if (fn.body) visit(fn.body);
      n.arguments.forEach(visit);
      return;
    }
    if (isFunctionLike(n)) return;
    n.forEachChild(visit);
  };
  sf.statements.forEach(visit);
  return out;
}

const REGISTRATION_WHY =
  'This is a correctness rule, not a style one: under "sideEffects": false the bundler may drop ' +
  'a module nothing imports a binding from, and with it the registration -- shipping an empty ' +
  'registry with no error (ADR-0017 clause 4; findings-visualisation.md §5.2). Export the thing ' +
  'and register it in the composition root.';

/**
 * Violations in one source file. `file` is its path relative to the repo root,
 * with forward slashes; which rules apply depends on where it lives.
 */
export function sourceViolations(file: string, text: string): Violation[] {
  const v: Violation[] = [];
  const inCore = file.startsWith('src/core/');
  const inView = file.startsWith('src/view/');
  const inSrc = file.startsWith('src/');
  const lines = text.split('\n');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
  const add = (i: number, rule: string, detail = lines[i] ?? '') =>
    v.push({ file, line: i + 1, rule, text: detail.trim().slice(0, 160) });

  if (inCore) {
    strip(text).split('\n').forEach((line, i) => {
      for (const g of DOM_GLOBALS) if (usesDomGlobal(line, g)) add(i, `core-has-no-dom (${g})`);
    });
  }
  if (inCore || inView) {
    strip(text).split('\n').forEach((line, i) => {
      for (const n of NETWORK) if (line.includes(n)) add(i, `no-network-outside-store (${n})`);
    });
  }
  for (const { specifier, node } of moduleSpecifiers(sf)) {
    // Read from the parse tree, not the stripped text: stripping blanks string
    // literals, so a specifier is exactly what a text scan cannot see.
    if (inCore && specifier.startsWith('.') &&
      /^src\/view(\/|$)/.test(posix.normalize(posix.join(posix.dirname(file), specifier)))) {
      add(lineOf(node), 'core-must-not-import-view');
    }
    if (inSrc && isClassicZod(specifier)) {
      add(lineOf(node), `no-classic-zod ("${specifier}")`,
        `import from "${specifier}": use "zod/mini". Classic zod is ~300 kB that cannot be ` +
          'tree-shaken, and only Node-only scripts may use it (ADR-0017).');
    }
  }
  if (inSrc) {
    for (const call of moduleScopeRegistrations(sf)) {
      add(lineOf(call), 'no-self-registration', `${call.getText(sf).slice(0, 80)} -- ${REGISTRATION_WHY}`);
    }
  }
  return v;
}

/** The subset of an esbuild metafile these rules read. */
export interface Metafile {
  inputs?: Record<string, { imports?: { path: string }[] }>;
  outputs: Record<string, {
    entryPoint?: string;
    inputs?: Record<string, unknown>;
    imports?: { path: string; kind?: string }[];
  }>;
}

/**
 * Shortest import chain from `from` to `to` through the metafile's input graph,
 * as `a -> b -> c`; or just `to` when the graph does not connect them.
 */
export function importChain(meta: Metafile, from: string, to: string): string {
  const graph = meta.inputs ?? {};
  const prev = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const imp of graph[cur]?.imports ?? []) {
      if (!prev.has(imp.path)) { prev.set(imp.path, cur); queue.push(imp.path); }
    }
  }
  if (!prev.has(to)) return to;
  const chain: string[] = [];
  for (let at = to; at; at = prev.get(at)!) chain.unshift(at);
  return chain.join(' -> ');
}

/** Inputs reachable from `from` through the metafile's input graph, `from` included. */
function reachableInputs(meta: Metafile, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    for (const imp of meta.inputs?.[queue.shift()!]?.imports ?? []) {
      if (!seen.has(imp.path)) { seen.add(imp.path); queue.push(imp.path); }
    }
  }
  return seen;
}

/**
 * ADR-0005's condition of acceptance and ADR-0017's size rule, checked against
 * the real build: what reaches a core consumer?
 *
 * **Follows chunk imports.** With code splitting, the core entry's own output
 * lists only the inputs bundled *into that file*; anything shared lands in a
 * chunk the entry imports. Checking the entry file alone would miss view code
 * or classic zod that arrived through a chunk, which is exactly how it would
 * arrive.
 */
export function bundleViolations(meta: Metafile, { coreEntry = 'src/index.ts' } = {}): Violation[] {
  const v: Violation[] = [];
  const entries = Object.entries(meta.outputs).filter(([, o]) => o.entryPoint === coreEntry);
  if (entries.length === 0) {
    return [{
      file: 'metafile', line: 0, rule: 'bundle-check-cannot-run',
      text: `no output has entryPoint "${coreEntry}"; the metafile's shape may have drifted, and ` +
        'without an entry this check would pass having read nothing.',
    }];
  }
  for (const [entryOut] of entries) {
    const reached = new Set<string>();
    const queue = [entryOut];
    while (queue.length > 0) {
      const out = queue.shift()!;
      if (reached.has(out)) continue;
      reached.add(out);
      for (const imp of meta.outputs[out]?.imports ?? []) {
        // Dynamic imports too: a lazy import of view code from core still puts
        // view code one await away from every core consumer.
        if (meta.outputs[imp.path]) queue.push(imp.path);
      }
    }
    for (const out of reached) {
      // A library build keeps dependencies external, so classic zod shows up
      // as an import the output makes, not as an input it contains. Name the
      // source file that asked for it.
      for (const imp of meta.outputs[out]?.imports ?? []) {
        if (meta.outputs[imp.path] || !isClassicZod(imp.path)) continue;
        const importer = [...reachableInputs(meta, coreEntry)]
          .find((path) => (meta.inputs?.[path]?.imports ?? []).some((x) => x.path === imp.path));
        v.push({
          file: out, line: 0, rule: 'core-bundle-imports-classic-zod',
          text: importer ? `${importChain(meta, coreEntry, importer)} -> ${imp.path}` : imp.path,
        });
      }
      for (const input of Object.keys(meta.outputs[out]?.inputs ?? {})) {
        const rule = input.includes('src/view/') ? 'core-bundle-contains-view'
          : /node_modules\/.*zod\/v4\/classic\//.test(input) ? 'core-bundle-contains-classic-zod'
            : undefined;
        if (rule) v.push({ file: out, line: 0, rule, text: importChain(meta, coreEntry, input) });
      }
    }
  }
  return v;
}
