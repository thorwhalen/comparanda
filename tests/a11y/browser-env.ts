/**
 * The browser half's environment: a fresh element to mount matrices into, and
 * the hooks a broken fixture uses to break what was mounted, or what was opened.
 *
 * A check mounts through `env.mount` (or `env.mountPanels`), never `mountMatrix`, so the sabotage is
 * applied to exactly the DOM the check then reads -- the same code path with
 * and without the fault.
 */
import { commands } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { sensitivity } from '../../src/core/analyses/sensitivity.js';
import { weightedSum } from '../../src/core/analyses/weighted-sum.js';
import {
  AgreementPanel, createEncodingRegistry, DotPlotsPanel, mountMatrix, rankFlowPanel, ScatterPanel, SHIPPED_ENCODINGS, type MatrixHandle, type MountMatrixProps,
} from '../../src/view/index.js';
import type { Theme } from '../../src/view/theme.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';
import videoJson from '../../examples/video-generation.json';
import { languagesWithConfidence } from '../fixtures/confidence.js';
import type { WithEnv } from './gate.js';

export interface MediaOptions {
  forcedColors?: 'active' | 'none';
  media?: 'print' | 'screen' | null;
  reducedMotion?: 'reduce' | 'no-preference';
}

// Declared here for every browser test: the command is defined in vitest.browser.config.ts.
declare module '@vitest/browser/context' {
  interface BrowserCommands {
    emulateMedia(options: MediaOptions): Promise<void>;
  }
}

/** The example analyses, plus the confident one the value-suppressing encoding needs. */
export const FIXTURES: Readonly<Record<string, Analysis>> = {
  languages: Analysis.parse(languagesJson),
  relocation: Analysis.parse(relocationJson),
  'video-generation': Analysis.parse(videoJson),
  'languages with confidence': languagesWithConfidence(),
};
export const ENCODINGS = createEncodingRegistry(SHIPPED_ENCODINGS);
export const THEMES = ['light', 'dark'] as const satisfies readonly Theme[];
/**
 * The analysis panels the package ships, registered as a composition root would (#292). The rank-flow is made from
 * the weighted aggregation it is gated behind (#98), and draws only over an analysis that declares weights.
 */
export const PANELS = [AgreementPanel, ScatterPanel, DotPlotsPanel, rankFlowPanel({ weightedSum, sensitivity })] as const;

export interface MountOptions {
  readonly theme?: Theme;
  /** CSS on the mount element, e.g. a width small enough that the grid scrolls. */
  readonly style?: Readonly<Record<string, string>>;
}

export interface BrowserEnv {
  /** Mount a matrix in a fresh element and apply the sabotage to it. */
  mount(props: MountMatrixProps, options?: MountOptions): { el: HTMLElement; handle: MatrixHandle };
  /** Mount a matrix with every shipped panel, open each one, wait for its body, then apply the sabotage meant for opened panels. */
  mountPanels(props: MountMatrixProps, options?: MountOptions): Promise<{ el: HTMLElement; panels: HTMLDetailsElement[] }>;
  /** Break each matrix mounted from now on, once mounted. For a fixture. */
  afterMount(fn: (el: HTMLElement) => void): void;
  /** Break each set of panels opened from now on, once open: their bodies are not drawn before. For a fixture. */
  afterOpen(fn: (panels: HTMLDetailsElement[]) => void): void;
  /** Undo something a fixture did to the page, when the run is over. */
  onDispose(fn: () => void): void;
  /** Emulate a media feature; reset when the run is over. */
  media(options: MediaOptions): Promise<void>;
}

/** The browser's own timer, taken before any check patches `setTimeout` to watch the view's: the gate's waiting is not the view's timers. */
export const ownSetTimeout = window.setTimeout.bind(window);
export const tick = () => new Promise<void>((resolve) => ownSetTimeout(resolve, 0));

/** Open a panel and wait for its body: a panel draws it on the `toggle` event, which comes a task after `open` is set, and renders a microtask after that. */
async function opened(panel: HTMLDetailsElement): Promise<void> {
  if (panel.open) return;
  const toggled = new Promise<void>((resolve) => panel.addEventListener('toggle', () => resolve(), { once: true }));
  panel.open = true;
  await toggled;
  await tick();
}

/** The environment for one run: fresh elements, torn down afterwards, media put back. */
export const withBrowserEnv: WithEnv<BrowserEnv> = async (sabotage, use) => {
  const mounted: { el: HTMLElement; handle: MatrixHandle }[] = [];
  const hooks: ((el: HTMLElement) => void)[] = [];
  const openHooks: ((panels: HTMLDetailsElement[]) => void)[] = [];
  const disposers: (() => void)[] = [];
  const env: BrowserEnv = {
    mount: (props, options) => mountWith(props, options),
    async mountPanels(props, options) {
      const { el } = mountWith(props, options, { panels: PANELS });
      const panels = Array.from(el.querySelectorAll<HTMLDetailsElement>('details.comparanda-analysis'));
      for (const panel of panels) await opened(panel);
      for (const hook of openHooks) hook(panels);
      return { el, panels };
    },
    afterMount: (fn) => void hooks.push(fn),
    afterOpen: (fn) => void openHooks.push(fn),
    onDispose: (fn) => void disposers.push(fn),
    media: (options) => commands.emulateMedia(options),
  };
  function mountWith(props: MountMatrixProps, { theme, style = {} }: MountOptions = {}, extra: { panels?: typeof PANELS } = {}) {
    const el = document.createElement('div');
    for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v);
    if (theme) el.dataset['theme'] = theme;
    document.body.append(el);
    const handle = mountMatrix(el, props, { encodings: ENCODINGS, ...extra });
    const made = { el, handle };
    mounted.push(made);
    for (const hook of hooks) hook(el);
    return made;
  }
  try {
    await sabotage?.(env);
    return await use(env);
  } finally {
    // Whatever one step does, the rest still run: a leaked emulation would fail every later check for the wrong reason.
    const quietly = (step: () => void) => { try { step(); } catch { /* the check's own result is the failure that matters */ } };
    for (const { el, handle } of mounted) {
      quietly(() => handle.destroy());
      el.remove();
    }
    for (const dispose of disposers.reverse()) quietly(dispose);
    await commands.emulateMedia({ forcedColors: 'none', media: null, reducedMotion: 'no-preference' });
  }
};
