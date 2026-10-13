/**
 * The accessibility gate's checks that need a real browser (ADR-0029, #105):
 * the grid's tab stop, what every cell says, reordering by keyboard, sticky
 * geometry, tooltips, composited contrast, colour-vision simulation, forced
 * colors, print and reduced motion.
 *
 * Each check mounts the shipped matrix through `env.mount` and reads what the
 * browser made of it -- computed styles, boxes, focus, live regions -- never
 * the source that produced it. Each comes with the smallest fault that should
 * make it fail, applied to the same mounted DOM.
 */
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { CORE_MISSING_CODES, vocabularyOf } from '../../src/index.js';
import { anonymousIdentity } from '../../src/store/index.js';
import { SHIPPED_ENCODINGS, type MountMatrixProps } from '../../src/view/index.js';
import { vsupTrees } from '../../src/view/encodings/vsup-derive.js';
import { GRAPHIC_CONTRAST_MIN, TEXT_CONTRAST_MIN } from '../../src/view/encodings/contrast.js';
import { vsupGrid } from '../fixtures/vsup-grid.js';
import { treeFailures } from '../support/cvd-browser.js';
import { everyCode, heard } from '../support/every-code.js';
import { obscured } from '../support/sticky-geometry.js';
import { FIXTURES, THEMES, type BrowserEnv } from './browser-env.js';
import type { Check } from './gate.js';

/** The browser's own timer, taken before any check patches `setTimeout` to watch the view's: the check's waiting is not the view's timers. */
const ownSetTimeout = window.setTimeout.bind(window);
const tick = () => new Promise<void>((resolve) => ownSetTimeout(resolve, 0));
const sleep = (ms: number) => new Promise<void>((resolve) => ownSetTimeout(resolve, ms));
const languages = FIXTURES['languages']!;
const relocation = FIXTURES['relocation']!;
const confident = FIXTURES['languages with confidence']!;
const crits = languages.criteria.map((c) => c.id);
const ENCODING_IDS = SHIPPED_ENCODINGS.map((e) => e.id);

/** A sentence cap: a check that finds a hundred faults reports the first dozen and the count. */
const REPORT_MAX = 12;
const cap = (found: string[]): string[] => found.length <= REPORT_MAX ? found : [...found.slice(0, REPORT_MAX), `... and ${found.length - REPORT_MAX} more`];

/** Everything a Tab press could stop on inside `root`. */
const tabbable = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
  .filter((n) => n.tabIndex >= 0 && !(n as HTMLButtonElement).disabled);

/** Elements a keyboard can reach by the roving stop or by Tab. */
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';

const header = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`th[data-entry="${id}"]`)!;

// ---- colour arithmetic (WCAG 2) -------------------------------------------------------------

type Rgba = readonly [number, number, number, number];
/** A computed colour as 0-255 channels and alpha. Throws on a colour function it does not read, so a new one cannot pass unmeasured. */
function parseColour(css: string): Rgba {
  const srgb = css.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
  const rgb = css.match(/^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  if (css === 'transparent') return [0, 0, 0, 0];
  throw new Error(`the gate cannot read the computed colour ${css}`);
}
const over = (top: Rgba, below: Rgba): Rgba => {
  const a = top[3] + below[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i: 0 | 1 | 2) => (top[i] * top[3] + below[i] * below[3] * (1 - top[3])) / a;
  return [ch(0), ch(1), ch(2), a];
};
const PAPER: Rgba = [255, 255, 255, 1];
/** What is painted behind `node`'s own ink: its background and every ancestor's, composited, over white paper. */
function backdrop(node: Element): Rgba {
  const layers: Rgba[] = [];
  for (let n: Element | null = node; n; n = n.parentElement) {
    const layer = parseColour(getComputedStyle(n).backgroundColor);
    if (layer[3] > 0) layers.push(layer);
    if (layer[3] === 1) break;
  }
  return layers.reduceRight<Rgba>((below, layer) => over(layer, below), PAPER);
}
const luminance = ([r, g, b]: Rgba) => {
  const [lr, lg, lb] = [r, g, b].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
};
const ratio = (x: Rgba, y: Rgba) => { const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (hi! + 0.05) / (lo! + 0.05); };
/** An element's ink or stroke, as painted: its own alpha composited over its backdrop. */
const painted = (css: string, on: Rgba) => over(parseColour(css), on);

/** Whether `node` is clipped away for sighted readers, as the screen-reader-only spans are. */
const visuallyHidden = (node: Element) => node.closest('.comparanda-sr') !== null;

/** How opaque `node` is as painted: its own `opacity` and every ancestor's, multiplied. (A `filter` is not read.) */
function opacityOf(node: Element): number {
  let alpha = 1;
  for (let n: Element | null = node; n; n = n.parentElement) alpha *= parseFloat(getComputedStyle(n).opacity);
  return alpha;
}

const TEXT_CONTRAST_WHAT = (text: string, r: number, min: number) => `"${text.slice(0, 24)}" is ${r.toFixed(2)}:1 against what is behind it, under ${min}:1`;

/**
 * What cannot be read in `cell`: every element that draws text of its own, and
 * every glyph or hatch stroke or fill, measured as painted (alpha, `opacity`) against what is
 * behind it -- the cell's backdrop, or `paper` where backgrounds are suppressed.
 */
function contrastFaults(cell: Element, where: string, { paper }: { paper?: Rgba } = {}): string[] {
  const found: string[] = [];
  const behind = (node: Element) => paper ?? backdrop(node);
  for (const node of [cell, ...Array.from(cell.querySelectorAll('*'))]) {
    if (visuallyHidden(node)) continue;
    const text = Array.from(node.childNodes).filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent!.trim()).join('');
    // A filter changes what is painted in ways this arithmetic does not follow: say so rather than pass it unmeasured.
    const { filter, backdropFilter } = getComputedStyle(node);
    if (filter !== 'none' || (backdropFilter && backdropFilter !== 'none')) found.push(`${where}: <${node.tagName.toLowerCase()}> has a filter (${filter !== 'none' ? filter : backdropFilter}), which the gate cannot measure`);
    if (text !== '') {
      const on = behind(node);
      const ink = parseColour(getComputedStyle(node).color);
      const r = ratio(painted(`rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${ink[3] * opacityOf(node)})`, on), on);
      if (r < TEXT_CONTRAST_MIN) found.push(`${where}: ${TEXT_CONTRAST_WHAT(text, r, TEXT_CONTRAST_MIN)}`);
    }
    if (node instanceof SVGElement && node.tagName.toLowerCase() === 'svg') {
      const style = getComputedStyle(node);
      for (const [what, css] of [['stroke', style.stroke], ['fill', style.fill]] as const) {
        if (css === 'none') continue;
        const on = behind(node);
        const c = parseColour(css);
        const r = ratio(painted(`rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] * opacityOf(node)})`, on), on);
        if (r < GRAPHIC_CONTRAST_MIN) found.push(`${where}: a ${node.getAttribute('class')} ${what} is ${r.toFixed(2)}:1 against what is behind it, under ${GRAPHIC_CONTRAST_MIN}:1`);
      }
    }
  }
  return found;
}

// ---- A2 -----------------------------------------------------------------------------------

const TAB_STOP_KEYS = ['{ArrowRight}', '{ArrowDown}', '{ArrowDown}', '{ArrowLeft}', '{End}', '{Home}', '{Control>}{End}{/Control}', '{Control>}{Home}{/Control}', '{ArrowDown}'];

const a2: Check<BrowserEnv> = {
  id: 'A2',
  async run(env) {
    const { el } = env.mount({ analysis: languages, measure: 'score' });
    const found: string[] = [];
    const count = (after: string) => {
      const stops = tabbable(el.querySelector('.comparanda-scroll')!);
      if (stops.length !== 1) found.push(`${stops.length} tab stops in the grid after ${after}, not one`);
    };
    count('mounting');
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')?.focus();
    for (const key of TAB_STOP_KEYS) {
      await userEvent.keyboard(key);
      count(key);
    }
    // And in the other states the grid has: the panel up, a header held in grab mode, the move menu open.
    await userEvent.keyboard('{Enter}');
    count('Enter, which opens the panel');
    const held = mountReorderable(env);
    await tick();
    header(held.el, crits[1]!).focus();
    await userEvent.keyboard('{Enter}');
    const heldCount = tabbable(held.el.querySelector('.comparanda-scroll')!).length;
    if (heldCount !== 1) found.push(`${heldCount} tab stops in the grid while a header is held, not one`);
    await userEvent.keyboard('{ArrowRight}');
    if (tabbable(held.el.querySelector('.comparanda-scroll')!).length !== 1) found.push('a move in grab mode leaves more than one tab stop');
    await userEvent.keyboard('{Escape}');
    return found;
  },
  broken: {
    what: 'every key release gives the last cell a tab stop of its own',
    sabotage: (env) => env.afterMount((el) => el.addEventListener('keyup', () => el.querySelector('tbody tr:last-child td:last-child')?.setAttribute('tabindex', '0'))),
  },
};

// ---- A3, A4 -------------------------------------------------------------------------------

const a3: Check<BrowserEnv> = {
  id: 'A3',
  run(env) {
    const found: string[] = [];
    for (const [name, analysis] of Object.entries(FIXTURES)) {
      for (const encoding of ENCODING_IDS) {
        const { el } = env.mount({ analysis, measure: 'score', encoding });
        const cells = el.querySelectorAll<HTMLElement>('tbody td');
        if (cells.length === 0) found.push(`${name} / ${encoding}: no cells were drawn`);
        for (const td of Array.from(cells)) {
          if (heard(td) === '') found.push(`${name} / ${encoding}: cell ${td.dataset['cell']} is announced as blank`);
        }
      }
    }
    return cap(found);
  },
  broken: {
    what: 'a value cell is emptied of everything, hidden text included',
    sabotage: (env) => env.afterMount((el) => el.querySelector('td[data-state="value"]')!.replaceChildren()),
    // Emptied, the cell has no numeral either: the channels' checks see that too.
  },
  alsoTrips: { A15: 'an emptied cell has no numeral under forced colors either', A18: 'nor in print' },
};

const a4: Check<BrowserEnv> = {
  id: 'A4',
  run(env) {
    const found: string[] = [];
    const { analysis, placed } = everyCode();
    const vocabulary = vocabularyOf(analysis);
    for (const encoding of ['text-only', 'missingness']) {
      const { el } = env.mount({ analysis, measure: 'score', encoding });
      const rows = analysis.alternatives.map((a) => a.id);
      const cols = analysis.criteria.map((c) => c.id);
      const byCell = new Map(Array.from(el.querySelectorAll<HTMLElement>('td[data-cell]')).map((td) => {
        const [r, c] = td.dataset['cell']!.split(':').map(Number) as [number, number];
        return [`${rows[r - 1]}\u0000${cols[c - 1]}`, td] as const;
      }));
      for (const { alt, crit, code } of placed) {
        const td = byCell.get(`${alt}\u0000${crit}`);
        if (!td) { found.push(`${encoding}: no cell for ${code}`); continue; }
        const said = heard(td);
        const facts = vocabulary.resolve(code, crit).facts;
        // A blank meaning is worded from the id, an undeclared code too: never an empty cell, never a bare code on its own.
        const phrase = facts && facts.means.trim() ? facts.means : code;
        if (!said.includes(phrase)) found.push(`${encoding}: ${code} is heard as "${said}", without "${phrase}"`);
        // ADR-0029: a code added without its glyph fails the build as surely as one added without its phrase.
        if (!td.querySelector('svg.comparanda-glyph[data-glyph]')) found.push(`${encoding}: ${code} has a phrase but no glyph`);
      }
    }
    // The set under test is the whole set: a core code with no cell above would pass unheard.
    const used = new Set(placed.map((p) => p.code));
    for (const code of Object.keys(CORE_MISSING_CODES)) if (!used.has(code)) found.push(`core code ${code} is not exercised`);
    return cap(found);
  },
  broken: {
    what: 'the phrase of every absent cell is replaced by an ellipsis',
    sabotage: (env) => env.afterMount((el) => el.querySelectorAll('td[data-absence] .comparanda-shown').forEach((n) => { n.textContent = '…'; })),
  },
};

// ---- A12, A11 (tooltips) ---------------------------------------------------------------------

/** The longest a tooltip may be made to wait before it shows, which a check allows for after each hover. */
const TOOLTIP_DELAY_MAX_MS = 350;

/**
 * Hover, and focus, a few cells and both kinds of header, and return every
 * tooltip the page showed -- including one that showed and went again -- each
 * given time to appear after a delay.
 */
async function tooltipsAfterHover(el: HTMLElement): Promise<HTMLElement[]> {
  const seen = new Set<HTMLElement>();
  const collect = () => document.querySelectorAll<HTMLElement>('[role="tooltip"]').forEach((t) => seen.add(t));
  const watch = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => {
      if (!(n instanceof HTMLElement)) return;
      if (n.matches('[role="tooltip"]')) seen.add(n);
      n.querySelectorAll<HTMLElement>('[role="tooltip"]').forEach((t) => seen.add(t));
    });
  });
  watch.observe(document.body, { childList: true, subtree: true });
  try {
    const targets = [
      ...Array.from(el.querySelectorAll<HTMLElement>('tbody td')).slice(0, 2),
      el.querySelector<HTMLElement>('thead th[scope="col"]:not(.comparanda-corner)'),
      el.querySelector<HTMLElement>('tbody th[scope="row"]'),
    ].filter((t): t is HTMLElement => t !== null);
    for (const target of targets) {
      await userEvent.hover(target);
      await sleep(TOOLTIP_DELAY_MAX_MS);
      collect();
      target.focus();
      await sleep(TOOLTIP_DELAY_MAX_MS);
      collect();
    }
  } finally {
    watch.disconnect();
  }
  return Array.from(seen);
}

/** Timers of at least this long, started while something is open, are a way to close it on the reader. */
const AUTO_DISMISS_MIN_MS = 100;

/** A frame loop: this many `requestAnimationFrame` requests within a check's window is a clock, not a layout. */
const FRAME_LOOP_MIN = 60;

/** What `timersDuring` saw: the delay of each timer started, and how many animation frames were asked for. */
export interface TimersSeen { delays: number[]; frames: number }

/**
 * Record the timers started while `during` runs, and while `when` holds at the
 * moment of the call: `setTimeout` and `setInterval`, `AbortSignal.timeout`,
 * `scheduler.postTask` with a delay, and `requestAnimationFrame` (counted, since
 * a loop of frames is a clock too).
 */
export async function timersDuring(during: () => Promise<void>, when: () => boolean = () => true): Promise<TimersSeen> {
  const seen: TimersSeen = { delays: [], frames: 0 };
  const undo: (() => void)[] = [];
  const wrap = <T extends object, K extends keyof T>(owner: T | undefined, name: K, make: (real: T[K]) => T[K]) => {
    if (!owner || typeof owner[name] !== 'function') return;
    const real = owner[name];
    owner[name] = make(real);
    undo.push(() => { owner[name] = real; });
  };
  type AnyFn = (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  wrap(window, 'setTimeout', (real) => ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => { if (when()) seen.delays.push(ms ?? 0); return (real as AnyFn)(fn, ms, ...rest); }) as typeof window.setTimeout);
  wrap(window, 'setInterval', (real) => ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => { if (when()) seen.delays.push(ms ?? 0); return (real as AnyFn)(fn, ms, ...rest); }) as typeof window.setInterval);
  wrap(window, 'requestAnimationFrame', (real) => ((cb: FrameRequestCallback) => { if (when()) seen.frames += 1; return (real as AnyFn)(cb); }) as typeof window.requestAnimationFrame);
  wrap(AbortSignal as unknown as { timeout: AnyFn }, 'timeout', (real) => ((ms: number) => { if (when()) seen.delays.push(ms); return real(ms); }));
  const scheduler = (window as unknown as { scheduler?: { postTask: AnyFn } }).scheduler;
  wrap(scheduler, 'postTask', (real) => ((task: AnyFn, options?: { delay?: number }) => { if (when()) seen.delays.push(options?.delay ?? 0); return real.call(scheduler, task, options); }));
  try { await during(); } finally { for (const u of undo.reverse()) u(); }
  return seen;
}

/** The longest timer in `seen` that could be closing something on the reader, or a frame loop standing in for one; `undefined` when none. */
export function autoDismissIn(seen: TimersSeen): string | undefined {
  const long = seen.delays.find((ms) => ms >= AUTO_DISMISS_MIN_MS);
  if (long !== undefined) return `a timer of ${long} ms`;
  if (seen.frames >= FRAME_LOOP_MIN) return `a loop of ${seen.frames} animation frames`;
  return undefined;
}

/** A tooltip that follows the pointer onto a cell, after `delayMs`: a fixture for A11 and A12. Returns how to take it away. */
function plantTooltip(el: HTMLElement, { dismissOnEscape, withLink, delayMs }: { dismissOnEscape: boolean; withLink: boolean; delayMs: number }): () => void {
  const off = new AbortController();
  el.addEventListener('mouseover', (e) => {
    const td = (e.target as Element).closest('td');
    if (!td || document.querySelector('[role="tooltip"]')) return;
    setTimeout(() => {
      const tip = document.createElement('div');
      tip.setAttribute('role', 'tooltip');
      tip.innerHTML = withLink ? 'Evidence: <a href="#evidence">read more</a>' : 'Evidence';
      td.append(tip);
      if (dismissOnEscape) document.addEventListener('keydown', (k) => { if (k.key === 'Escape') tip.remove(); }, { once: true, signal: off.signal });
    }, delayMs);
  }, { signal: off.signal });
  return () => off.abort();
}

const a12: Check<BrowserEnv> = {
  id: 'A12',
  async run(env) {
    const { el } = env.mount({ analysis: relocation, measure: 'score' });
    const found: string[] = [];
    for (const tip of await tooltipsAfterHover(el)) {
      const inside = tip.querySelectorAll(FOCUSABLE);
      if (inside.length > 0) found.push(`a tooltip holds ${inside.length} focusable element(s): ${inside[0]!.outerHTML}`);
    }
    return found;
  },
  broken: {
    what: 'a tooltip, shown after a delay, carries a link',
    sabotage: (env) => env.afterMount((el) => env.onDispose(plantTooltip(el, { dismissOnEscape: true, withLink: true, delayMs: 200 }))),
  },
};

const a11: Check<BrowserEnv> = {
  id: 'A11',
  async run(env) {
    const { el } = env.mount({ analysis: relocation, measure: 'score' });
    const found: string[] = [];
    const cell = el.querySelector<HTMLElement>('tbody td')!;
    // 1. Any tooltip the cell shows: Escape closes it, focus stays on the cell, no timer closes it.
    cell.focus();
    let tips: HTMLElement[] = [];
    // A timer started while a tooltip is up is a way to close it on the reader; one started to show it is not.
    const seen = await timersDuring(async () => { tips = await tooltipsAfterHover(el); }, () => document.querySelector('[role="tooltip"]') !== null);
    const closer = autoDismissIn(seen);
    if (closer) found.push(`${closer} ran while a tooltip was showing`);
    const shown = tips.filter((t) => t.isConnected);
    if (shown.length > 0) {
      cell.focus();
      await userEvent.keyboard('{Escape}');
      await tick();
      if (shown.some((t) => t.isConnected && getComputedStyle(t).display !== 'none')) found.push('Escape did not close the tooltip');
      if (document.activeElement !== cell) found.push('Escape moved focus off the cell');
    }
    // 2. The panel that stands in for a tooltip (ADR-0027) is not dismissed by anything but the reader.
    cell.focus();
    const opened = await timersDuring(async () => {
      await userEvent.keyboard('{Enter}');
      await sleep(AUTO_DISMISS_MIN_MS * 4);
    });
    if (!el.querySelector('[role="complementary"]')) found.push('the panel the cell opens did not stay open without the reader');
    const closing = autoDismissIn(opened);
    if (closing) found.push(`${closing} ran while the panel opened`);
    return found;
  },
  broken: {
    what: 'a tooltip ignores Escape',
    sabotage: (env) => env.afterMount((el) => env.onDispose(plantTooltip(el, { dismissOnEscape: false, withLink: false, delayMs: 0 }))),
  },
};

// ---- A6, A7, A8, A9 (reorder) ---------------------------------------------------------------

/** A matrix that can be reordered: the identity and the view-change callback switch the reorder surface on. */
function mountReorderable(env: BrowserEnv) {
  const views: { criterionOrder: { order: string[] } }[] = [];
  const mounted = env.mount({
    analysis: languages, measure: 'score', identity: anonymousIdentity({ id: 'dana', displayName: 'Dana' }),
    onViewChange: (v) => views.push(v),
  } as MountMatrixProps);
  const order = () => views.at(-1)?.criterionOrder.order ?? crits;
  return { ...mounted, order, announced: () => mounted.el.querySelector('[data-announce]')!.textContent!.replace(/ $/, '') };
}

/** The criterion at index 1, moved two places later by `keys`; its order after, and whether focus is still on its header. */
async function reorderBy(env: BrowserEnv, grab: string, step: string, drop: string) {
  const m = mountReorderable(env);
  await tick(); // the identity resolves asynchronously; a move made before it would be anonymous
  header(m.el, crits[1]!).focus();
  await userEvent.keyboard(grab);
  await userEvent.keyboard(step);
  await userEvent.keyboard(step);
  await userEvent.keyboard(drop);
  await tick();
  return { ...m, focusKept: document.activeElement === header(m.el, crits[1]!), moved: m.order() };
}
const MOVED_TWO_LATER = [crits[0]!, crits[2]!, crits[3]!, crits[1]!, ...crits.slice(4)];

const a6: Check<BrowserEnv> = {
  id: 'A6',
  async run(env) {
    const r = await reorderBy(env, '{Enter}', '{ArrowRight}', '{Enter}');
    const found: string[] = [];
    if (r.moved.join() !== MOVED_TWO_LATER.join()) found.push(`the order after Enter, ArrowRight x2, Enter is ${r.moved.join(', ')}`);
    if (!r.focusKept) found.push(`focus is on ${(document.activeElement as HTMLElement)?.tagName} instead of the moved header`);
    return found;
  },
  broken: {
    what: 'focus is dropped when the held header is put down',
    sabotage: (env) => env.afterMount((el) => el.addEventListener('keydown', (e) => {
      // In the capture phase, so the header is seen as it was before this key: held, and about to be put down.
      if (e.key === 'Enter' && (e.target as HTMLElement).dataset['grabbed'] === 'true') setTimeout(() => (document.activeElement as HTMLElement | null)?.blur(), 0);
    }, true)),
  },
  alsoTrips: { A7: 'the Tab route is put down with Enter too, so it loses focus the same way' },
};

const a7: Check<BrowserEnv> = {
  id: 'A7',
  async run(env) {
    const byArrow = await reorderBy(env, '{Enter}', '{ArrowRight}', '{Enter}');
    const byTab = await reorderBy(env, '{Enter}', '{Tab}', '{Enter}');
    const found: string[] = [];
    if (byTab.moved.join() !== byArrow.moved.join()) found.push(`Tab gave ${byTab.moved.join(', ')}; the arrow gave ${byArrow.moved.join(', ')}`);
    // Equal is not enough: both routes failing the same way is equal too.
    if (byTab.moved.join() !== MOVED_TWO_LATER.join()) found.push(`the Tab route left the order ${byTab.moved.join(', ')}, not the criterion moved two later`);
    if (!byTab.focusKept) found.push('the Tab route left focus off the moved header');
    return found;
  },
  broken: {
    what: 'Tab never reaches the grab handler',
    sabotage: (env) => env.afterMount((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Tab') e.stopPropagation(); }, true)),
  },
};

const a8: Check<BrowserEnv> = {
  id: 'A8',
  async run(env) {
    const m = mountReorderable(env);
    await tick();
    header(m.el, crits[1]!).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    const found: string[] = [];
    if (m.order().join() === crits.join()) found.push('the grab did not move anything before Escape, so Escape restored nothing');
    await userEvent.keyboard('{Escape}');
    await tick();
    if (m.order().join() !== crits.join()) found.push(`Escape left the order ${m.order().join(', ')}`);
    if (document.activeElement !== header(m.el, crits[1]!)) found.push('Escape did not leave focus on the held header');
    return found;
  },
  broken: {
    what: 'Escape never reaches the grab handler',
    sabotage: (env) => env.afterMount((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); }, true)),
  },
};

const a9: Check<BrowserEnv> = {
  id: 'A9',
  async run(env) {
    const m = mountReorderable(env);
    await tick();
    const region = m.el.querySelector('[data-announce]');
    if (!region) return ['the matrix has no live region to announce a reorder in'];
    if (!/^(polite|assertive)$/.test(region.getAttribute('aria-live') ?? '')) return ['the live region is not aria-live'];
    header(m.el, crits[1]!).focus();
    await userEvent.keyboard('{Enter}'); // picking up is announced too; the reorder is the step
    await tick();
    const said: string[] = [];
    const watch = new MutationObserver(() => said.push(region.textContent!.replace(/ $/, '')));
    watch.observe(region, { childList: true, characterData: true, subtree: true });
    await userEvent.keyboard('{ArrowRight}');
    await tick();
    watch.disconnect();
    const found: string[] = [];
    if (said.length !== 1) found.push(`${said.length} announcements for one step: ${JSON.stringify(said)}`);
    const sentence = said[0] ?? '';
    const label = languages.criteria[1]!.label ?? crits[1]!;
    if (!sentence.includes(label)) found.push(`the announcement does not name "${label}": "${sentence}"`);
    if (!/\bof \d+\b/.test(sentence)) found.push(`the announcement has no "of N": "${sentence}"`);
    return found;
  },
  broken: {
    what: 'every announcement is followed by a second one',
    sabotage: (env) => env.afterMount((el) => {
      const region = el.querySelector('[data-announce]');
      if (!region) return;
      const watch = new MutationObserver(() => {
        watch.disconnect();
        queueMicrotask(() => {
          region.textContent = `${region.textContent!} Again.`;
          watch.takeRecords(); // the echo is not itself announced again
          watch.observe(region, { childList: true, characterData: true, subtree: true });
        });
      });
      watch.observe(region, { childList: true, characterData: true, subtree: true });
    }),
  },
};

// ---- A10 ---------------------------------------------------------------------------------

const a10: Check<BrowserEnv> = {
  id: 'A10',
  async run(env) {
    const { el } = env.mount({ analysis: FIXTURES['video-generation']!, measure: 'score' }, { style: { width: '480px', '--comparanda-max-height': '320px' } });
    const found: string[] = [];
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
    await userEvent.keyboard('{Control>}{End}{/Control}');
    const [rows, cols] = (document.activeElement as HTMLElement).dataset['cell']!.split(':').map(Number) as [number, number];
    const walk = async (key: string, times: number, where: string) => {
      for (let i = 0; i < times; i++) {
        await userEvent.keyboard(`{${key}}`);
        const focused = document.activeElement as HTMLElement;
        const { block, inline, cut } = obscured(el, focused);
        // A pixel: layout is subpixel, scroll offsets are whole pixels.
        if (block > 1) found.push(`${where}: ${key} to ${focused.dataset['cell']} leaves it ${block.toFixed(0)}px under the header row`);
        if (inline > 1) found.push(`${where}: ${key} to ${focused.dataset['cell']} leaves it ${inline.toFixed(0)}px under the header column`);
        if (cut > 1) found.push(`${where}: ${key} to ${focused.dataset['cell']} fits but is cut off`);
      }
    };
    await walk('ArrowUp', rows, 'up the last column');
    await walk('ArrowLeft', cols, 'along the last row');
    return cap(found);
  },
  broken: {
    what: 'the scroll container reserves no room for the sticky headers',
    sabotage: (env) => env.afterMount((el) => {
      const scroller = el.querySelector<HTMLElement>('.comparanda-scroll')!;
      scroller.style.setProperty('scroll-padding-block-start', '0px', 'important');
      scroller.style.setProperty('scroll-padding-inline-start', '0px', 'important');
    }),
  },
};

// ---- A13 ---------------------------------------------------------------------------------

const a13: Check<BrowserEnv> = {
  id: 'A13',
  run(env) {
    const found: string[] = [];
    for (const theme of THEMES) {
      for (const [name, analysis] of Object.entries(FIXTURES)) {
        for (const encoding of ENCODING_IDS) {
          const where = `${name} / ${encoding} / ${theme}`;
          const { el } = env.mount({ analysis, measure: 'score', encoding }, { theme });
          const cells = Array.from(el.querySelectorAll('tbody td, tbody th, thead th'));
          if (cells.length === 0) found.push(`${where}: nothing was drawn to measure`);
          for (const cell of cells) found.push(...contrastFaults(cell, where));
        }
      }
    }
    return cap(found);
  },
  broken: {
    what: 'a value cell\'s ink is transparent, so its text is the colour of its fill',
    sabotage: (env) => env.afterMount((el) => { el.querySelector<HTMLElement>('tbody td[data-state="value"]')!.style.color = 'transparent'; }),
  },
  alsoTrips: { A18: 'ink that is invisible on screen is invisible on paper too' },
  mayAlsoTrip: { A15: 'under forced colors an engine may or may not let an author\'s transparent ink through' },
};

// ---- A14 ---------------------------------------------------------------------------------

/** The hardest tree: the most score levels and the most confidence layers, the least room between steps. */
const HARDEST = vsupTrees().reduce((a, b) => (b.scoreLevels * b.confidenceLevels > a.scoreLevels * a.confidenceLevels ? b : a));

const a14: Check<BrowserEnv> = {
  id: 'A14',
  async run(env) {
    const found: string[] = [];
    for (const theme of THEMES) {
      const { el, handle } = env.mount(
        { analysis: vsupGrid(HARDEST.scoreLevels, HARDEST.confidenceLevels), measure: 'score', encoding: 'uncertainty-suppressed' }, { theme },
      );
      found.push(...await treeFailures(el, handle, HARDEST, theme));
    }
    // The colour-vision faults first: they are what this check is for, and a cap should not hide them behind palette mismatches.
    return cap(found.sort((a, b) => Number(/ΔE/.test(b)) - Number(/ΔE/.test(a))));
  },
  broken: {
    what: 'every swatched cell is painted the colour of the first',
    // Caught as a colour-vision fault (steps no longer apart), not only as a cell that is not the palette's colour.
    mustSay: /ΔE .* apart|from the surface/,
    sabotage: (env) => env.afterMount((el) => {
      const swatched = Array.from(el.querySelectorAll<HTMLElement>('td[data-swatch]'));
      if (swatched.length === 0) return; // not the palette's grid: nothing to flatten
      const flat = getComputedStyle(swatched[0]!).backgroundColor;
      for (const td of swatched) td.style.setProperty('background-color', flat, 'important');
    }),
  },
  alsoTrips: { A13: 'ink chosen for the original fills is unreadable on some of the flattened ones' },
};

// ---- A15, A18 (forced colors, print) -------------------------------------------------------------

/**
 * Both channels, in a medium: every value keeps its numeral; every absence its
 * glyph, whichever reason it is; every cell its frame; nothing is drawn with a
 * background image; and what survives is legible against what is behind it.
 */
function channelsSurvive(el: HTMLElement, where: string, { paper }: { paper?: Rgba } = {}): string[] {
  const found: string[] = [];
  const cells = Array.from(el.querySelectorAll<HTMLElement>('tbody td[data-cell]'));
  if (cells.length === 0) return [`${where}: nothing was drawn`];
  for (const td of cells) {
    const at = `${where}: cell ${td.dataset['cell']}`;
    if ((td.querySelector('.comparanda-shown')?.textContent ?? '').trim() === '') found.push(`${at} shows no numeral`);
    const style = getComputedStyle(td);
    if (style.borderTopStyle === 'none' || parseFloat(style.borderTopWidth) === 0) found.push(`${at} has no border`);
    for (const node of [td, ...Array.from(td.querySelectorAll('*'))]) {
      if (getComputedStyle(node).backgroundImage !== 'none') found.push(`${at} carries meaning in a background image (${node.tagName.toLowerCase()})`);
    }
    for (const svg of Array.from(td.querySelectorAll('svg'))) {
      const box = svg.getBoundingClientRect();
      if (getComputedStyle(svg).display === 'none' || box.width === 0 || getComputedStyle(svg).stroke === 'none') found.push(`${at} lost its ${svg.getAttribute('class')} mark`);
    }
    // An absence, of any reason, is a shape (ADR-0028): not only the ones recorded as `missing`.
    if (td.dataset['absence'] !== undefined && !td.querySelector('svg.comparanda-glyph')) found.push(`${at} is absent (${td.dataset['state']}) and shows no glyph`);
    found.push(...contrastFaults(td, at, paper ? { paper } : {}));
  }
  return found;
}

/** Every reason code in force on a cell of its own, so a code added without its glyph fails here (ADR-0009, ADR-0029). */
const EVERY_CODE = everyCode().analysis;
const MEDIUM_CASES = [['missingness', relocation], ['missingness', EVERY_CODE], ['uncertainty-suppressed', confident], ['text-only', relocation]] as const;

const a15: Check<BrowserEnv> = {
  id: 'A15',
  async run(env) {
    await env.media({ forcedColors: 'active' });
    const found: string[] = [];
    if (!matchMedia('(forced-colors: active)').matches) return ['this browser does not honour forcedColors emulation, so the check cannot see what a forced-colors reader sees'];
    for (const [encoding, analysis] of MEDIUM_CASES) {
      const { el } = env.mount({ analysis, measure: 'score', encoding });
      found.push(...channelsSurvive(el, `forced colors / ${encoding}${analysis === EVERY_CODE ? ' / every code' : ''}`));
      if (encoding !== 'text-only' && el.querySelector('td svg') === null) found.push(`forced colors / ${encoding}: no glyph or hatch was drawn at all`);
    }
    return cap(found);
  },
  broken: {
    what: 'the glyphs are hidden under forced colors only',
    sabotage: (env) => env.afterMount((el) => {
      const style = document.createElement('style');
      style.textContent = '@media (forced-colors: active) { .comparanda-matrix td svg { display: none !important; } }';
      el.append(style);
    }),
  },
};

const a18: Check<BrowserEnv> = {
  id: 'A18',
  async run(env) {
    await env.media({ media: 'print' });
    const found: string[] = [];
    if (!matchMedia('print').matches) return ['the print medium was not emulated'];
    for (const theme of THEMES) {
      for (const [encoding, analysis] of MEDIUM_CASES) {
        const where = `print / ${encoding}${analysis === EVERY_CODE ? ' / every code' : ''} / ${theme} on screen`;
        const { el } = env.mount({ analysis, measure: 'score', encoding }, { theme });
        // A printer may drop backgrounds: the ink and the marks must hold against paper, wherever the cells' own fills were.
        found.push(...channelsSurvive(el, where, { paper: PAPER }));
        for (const node of Array.from(el.querySelectorAll('th, td'))) {
          if (parseColour(getComputedStyle(node).backgroundColor)[3] !== 0) found.push(`${where}: ${node.tagName.toLowerCase()} "${node.textContent!.trim().slice(0, 20)}" still paints a background`);
        }
      }
    }
    return cap(found);
  },
  broken: {
    what: 'the glyphs are hidden in print only',
    sabotage: (env) => env.afterMount((el) => {
      const style = document.createElement('style');
      style.textContent = '@media print { .comparanda-matrix td svg { display: none !important; } }';
      el.append(style);
    }),
  },
};

// ---- A16, A17 (the mounted DOM: the twin of the source greps) ----------------------------------------

/** Every mount the DOM twins look at: each fixture under each encoding in each theme, and the states a grab or a panel add. */
async function* everyMount(env: BrowserEnv): AsyncGenerator<{ el: HTMLElement; where: string }> {
  for (const theme of THEMES) {
    for (const [name, analysis] of Object.entries(FIXTURES)) {
      for (const encoding of ENCODING_IDS) yield { ...env.mount({ analysis, measure: 'score', encoding }, { theme }), where: `${name} / ${encoding} / ${theme}` };
    }
  }
  // Where a drag attribute would be written: a header held, and the panel open.
  const held = mountReorderable(env);
  await tick();
  header(held.el, crits[1]!).focus();
  await userEvent.keyboard('{Enter}');
  yield { el: held.el, where: 'a header held in grab mode' };
  await userEvent.keyboard('{Escape}');
  const { el } = env.mount({ analysis: relocation, measure: 'score' });
  el.querySelector<HTMLElement>('tbody td')!.focus();
  await userEvent.keyboard('{Enter}');
  yield { el, where: 'the detail panel open' };
}

const a16twin: Check<BrowserEnv> = {
  id: 'A16',
  async run(env) {
    const found: string[] = [];
    for await (const { el, where } of everyMount(env)) {
      for (const node of Array.from(el.querySelectorAll('*'))) {
        const image = getComputedStyle(node).backgroundImage;
        if (image !== 'none') found.push(`${where}: <${node.tagName.toLowerCase()} class="${node.getAttribute('class') ?? ''}"> paints ${image.slice(0, 40)}`);
      }
    }
    return cap(found);
  },
  broken: {
    what: 'a cell is hatched with a repeating gradient, set from script so no source grep sees it',
    sabotage: (env) => env.afterMount((el) => el.querySelector<HTMLElement>('tbody td')!.style.setProperty('background-image', ['repeating', 'linear', 'gradient(45deg, #000 0 2px, #fff 2px 4px)'].join('-'))),
  },
  // The channels' own checks measure the same thing in their media.
  alsoTrips: { A14: 'a gradient over a swatched cell is the colour its screenshot reads', A18: 'a gradient on a cell is a background image in print too' },
  mayAlsoTrip: { A15: 'under forced colors an engine may drop a background image of its own accord' },
};

const a17twin: Check<BrowserEnv> = {
  id: 'A17',
  async run(env) {
    const found: string[] = [];
    for await (const { el, where } of everyMount(env)) {
      for (const node of Array.from(el.querySelectorAll('[title], [aria-grabbed], [aria-dropeffect]'))) {
        found.push(`${where}: <${node.tagName.toLowerCase()}> carries ${['title', 'aria-grabbed', 'aria-dropeffect'].filter((a) => node.hasAttribute(a)).join(', ')}`);
      }
    }
    return cap(found);
  },
  broken: {
    what: 'a cell is given a title attribute from script',
    sabotage: (env) => env.afterMount((el) => el.querySelector('tbody td')!.setAttribute('title', 'rent')),
  },
};

// ---- A20 ---------------------------------------------------------------------------------

const seconds = (list: string) => list.split(',').some((d) => parseFloat(d) > 0);

const a20: Check<BrowserEnv> = {
  id: 'A20',
  async run(env) {
    await env.media({ reducedMotion: 'reduce' });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) return ['reducedMotion was not emulated'];
    const found: string[] = [];
    const smooth: string[] = [];
    const proto = Element.prototype as unknown as Record<string, (this: Element, ...a: unknown[]) => unknown>;
    const real = (['scrollBy', 'scrollTo', 'scrollIntoView'] as const).map((name) => [name, proto[name]!] as const);
    for (const [name, fn] of real) {
      proto[name] = function (this: Element, ...args: unknown[]) {
        const options = args[0] as { behavior?: string } | boolean | undefined;
        if (typeof options === 'object' && options?.behavior === 'smooth') smooth.push(name);
        return fn.apply(this, args);
      };
    }
    /** Every element in `root` that moves on its own when it should not, said by name. */
    const motion = (root: Element, when: string) => {
      for (const node of [document.documentElement, ...Array.from(root.querySelectorAll('*'))]) {
        const style = getComputedStyle(node);
        const what = `${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? `.${node.className.split(' ')[0]}` : ''}`;
        if (seconds(style.transitionDuration) && style.transitionProperty !== 'none') found.push(`${what} transitions for ${style.transitionDuration} ${when} under reduced motion`);
        if (style.animationName !== 'none' && seconds(style.animationDuration)) found.push(`${what} animates (${style.animationName}) ${when} under reduced motion`);
        if (style.scrollBehavior === 'smooth') found.push(`${what} scrolls smoothly ${when} under reduced motion`);
      }
    };
    try {
      const { el } = env.mount({ analysis: FIXTURES['video-generation']!, measure: 'score' }, { style: { width: '480px', '--comparanda-max-height': '320px' } });
      motion(el, 'at rest');
      // The drag animation: a header picked up and carried is where a transition would be.
      const drag = mountReorderable(env);
      await tick();
      header(drag.el, crits[1]!).focus();
      await userEvent.keyboard('{Enter}');
      motion(drag.el, 'while a header is held');
      await userEvent.keyboard('{ArrowRight}');
      motion(drag.el, 'while a header is carried');
      await userEvent.keyboard('{Escape}');
      // And the keys that scroll: no smooth behaviour asked for from script.
      el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
      await userEvent.keyboard('{Control>}{End}{/Control}');
      await userEvent.keyboard('{ArrowUp}');
      await userEvent.keyboard('{ArrowLeft}');
      if (smooth.length > 0) found.push(`script asked for smooth scrolling (${[...new Set(smooth)].join(', ')}) under reduced motion`);
    } finally {
      for (const [name, fn] of real) proto[name] = fn;
    }
    return Array.from(new Set(found));
  },
  broken: {
    what: 'the scroller scrolls smoothly and every cell fades, with no reduced-motion rule',
    sabotage: (env) => env.afterMount((el) => {
      const style = document.createElement('style');
      style.textContent = '.comparanda-scroll { scroll-behavior: smooth; } .comparanda-matrix td { transition: background-color 1s; } .comparanda-matrix th[data-grabbed] { transition: outline-offset 0.3s; }';
      el.append(style);
    }),
  },
  alsoTrips: { A14: 'a fade still running when the screenshot is taken is the colour it captures' },
};

export const BROWSER_CHECKS: readonly Check<BrowserEnv>[] = [a2, a3, a4, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16twin, a17twin, a18, a20];
