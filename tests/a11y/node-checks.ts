/**
 * The accessibility gate's checks that need no browser (ADR-0029, #105): the
 * announcement of a move, and the source-level bans.
 *
 * The environment is the pieces under test, held as values so a broken fixture
 * can swap one: `describeMove` for A5, and a map of source files for A16 and
 * A17 that a fixture adds a file to.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../../src/core/schema/analysis.js';
import { describeMove as shippedDescribeMove, moveTo, type MoveReport } from '../../src/core/reorder.js';
import { initialViewState } from '../../src/core/view-state.js';
import relocationJson from '../../examples/relocation.json';
import type { WithEnv, Check } from './gate.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the view's code lives: what the source bans are about. */
const VIEW_DIRS = ['src/view', 'src/standalone'];

export interface NodeEnv {
  describeMove: (a: Analysis, report: MoveReport) => string;
  /** Repo-relative path to text, for every file in the view's directories. */
  sources: Map<string, string>;
}

function readSources(): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of VIEW_DIRS) {
    for (const entry of readdirSync(join(repo, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx|css)$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      files.set(relative(repo, path), readFileSync(path, 'utf8'));
    }
  }
  return files;
}

export const withNodeEnv: WithEnv<NodeEnv> = async (sabotage, use) => {
  const env: NodeEnv = { describeMove: shippedDescribeMove, sources: readSources() };
  await sabotage?.(env);
  return use(env);
};

/** Lines of code (comments removed) matching `pattern`, as `path:line: text`. */
function offences(sources: Map<string, string>, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const [path, text] of sources) {
    // Keep line numbers: blank the comments rather than deleting them.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    code.split('\n').forEach((line, i) => { if (pattern.test(line)) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  return found;
}

// ---- A5 -----------------------------------------------------------------------------------

const relocation = Analysis.parse(relocationJson);
const ACTOR = { by: 'a5', at: '2026-01-01T00:00:00Z' };

const a5: Check<NodeEnv> = {
  id: 'A5',
  run({ describeMove }) {
    const found: string[] = [];
    const ids = relocation.alternatives.map((a) => a.id);
    const last = ids.length - 1;
    const middle = Math.floor(ids.length / 2);
    const start = initialViewState(relocation);
    /** One move, its sentence, and the position the new order really puts the entry at: an oracle apart from the report. */
    const scenario = (name: string, analysis: Analysis, view: typeof start, from: number, to: number, expectMoved: boolean) => {
      const { state, report } = moveTo(view, 'alternatives', from, to, ACTOR);
      const sentence = describeMove(analysis, report);
      const order = state.alternativeOrder.order;
      const label = analysis.alternatives.find((a) => a.id === report.id)?.label ?? report.id;
      const row = order.indexOf(report.id) + 1;
      if (!sentence.includes(label)) found.push(`${name}: "${sentence}" does not name ${label}`);
      if (!sentence.includes(`${row} of ${order.length}`)) found.push(`${name}: "${sentence}" does not say ${row} of ${order.length}`);
      if (report.noOp === expectMoved) found.push(`${name}: the move ${expectMoved ? 'did not happen' : 'happened'}`);
      if (!expectMoved && !/already|did not move/.test(sentence)) found.push(`${name}: a move that did not happen is announced as one: "${sentence}"`);
      if (expectMoved && !/ moved to /.test(sentence)) found.push(`${name}: "${sentence}" does not say it moved`);
      return { state, sentence };
    };
    // Start, middle, end.
    const first = scenario('to the start', relocation, start, middle, 0, true);
    if (!/, first\./.test(first.sentence)) found.push(`to the start: "${first.sentence}" does not say it is first`);
    scenario('to the middle', relocation, start, 0, middle, true);
    const end = scenario('to the end', relocation, start, 0, last, true);
    if (!end.sentence.includes(`after ${relocation.alternatives.find((a) => a.id === end.state.alternativeOrder.order[last - 1])!.label}`)) found.push(`to the end: "${end.sentence}" does not say what it follows`);
    // A step past either end is clamped and said so, not announced as a move.
    scenario('past the end', relocation, start, last, last + 3, false);
    scenario('before the start', relocation, start, 0, -3, false);
    // An axis of one entry.
    const lone = { ...relocation, alternatives: relocation.alternatives.slice(0, 1) } as Analysis;
    scenario('a single-element axis', lone, initialViewState(lone), 0, 0, false);
    // Cancel: picking up and putting back says where it is again, in the same words as the move out did.
    const out = moveTo(start, 'alternatives', 1, 3, ACTOR);
    scenario('cancel, putting it back', relocation, out.state, 3, 1, true);
    return found;
  },
  broken: {
    what: 'the announced position is one past the real one',
    sabotage: (env) => {
      const real = env.describeMove;
      env.describeMove = (a, report) => real(a, { ...report, to: report.to + 1 });
    },
  },
};

// ---- A16, A17 ----------------------------------------------------------------------------------

/** Anything that can paint an image behind a cell: a gradient, or a background-image that is not `none`. */
const BACKGROUND_IMAGE = /gradient\s*\(|background-image\s*:\s*(?!none\b|initial\b|unset\b)|['"]background-image['"]|backgroundImage\s*[:=]\s*(?!['"](?:none|initial|unset)['"])|background\s*:[^;]*\burl\s*\(|\bbackground-image\b.*\burl\s*\(/i;

const a16: Check<NodeEnv> = {
  id: 'A16',
  run: ({ sources }) => offences(sources, BACKGROUND_IMAGE).map((o) => `a background image or gradient in code: ${o}`),
  broken: {
    what: 'a stylesheet hatches a cell with a repeating gradient',
    sabotage: ({ sources }) => void sources.set('src/view/planted.ts', 'export const css = `td.low { background-image: repeating-linear-gradient(45deg, #000 0 2px, transparent 2px 4px); }`;'),
  },
};

/** The drag attributes ARIA 1.1 deprecated, and a native tooltip on anything: neither is announced reliably, and neither is keyboard-reachable. */
const FORBIDDEN_ATTRIBUTES = /aria-grabbed|aria-dropeffect|ariaGrabbed|ariaDropEffect|\btitle\s*=\s*[{"'`]|setAttribute\(\s*['"]title['"]|(?<!document)\.title\s*=[^=]/;

const a17: Check<NodeEnv> = {
  id: 'A17',
  run: ({ sources }) => offences(sources, FORBIDDEN_ATTRIBUTES).map((o) => `a forbidden attribute: ${o}`),
  broken: {
    what: 'a cell is given a title attribute',
    sabotage: ({ sources }) => void sources.set('src/view/planted.tsx', 'export const cell = (t: string) => <td title={t}>{t}</td>;'),
  },
};

export const NODE_CHECKS: readonly Check<NodeEnv>[] = [a5, a16, a17];
