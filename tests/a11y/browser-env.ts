/**
 * The browser half's environment: a fresh element to mount matrices into, and
 * the hook a broken fixture uses to break what was mounted.
 *
 * A check mounts through `env.mount`, never `mountMatrix`, so the sabotage is
 * applied to exactly the DOM the check then reads -- the same code path with
 * and without the fault.
 */
import { commands } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
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

export interface MountOptions {
  readonly theme?: Theme;
  /** CSS on the mount element, e.g. a width small enough that the grid scrolls. */
  readonly style?: Readonly<Record<string, string>>;
}

export interface BrowserEnv {
  /** Mount a matrix in a fresh element and apply the sabotage to it. */
  mount(props: MountMatrixProps, options?: MountOptions): { el: HTMLElement; handle: MatrixHandle };
  /** Break each matrix mounted from now on, once mounted. For a fixture. */
  afterMount(fn: (el: HTMLElement) => void): void;
  /** Undo something a fixture did to the page, when the run is over. */
  onDispose(fn: () => void): void;
  /** Emulate a media feature; reset when the run is over. */
  media(options: MediaOptions): Promise<void>;
}

/** The environment for one run: fresh elements, torn down afterwards, media put back. */
export const withBrowserEnv: WithEnv<BrowserEnv> = async (sabotage, use) => {
  const mounted: { el: HTMLElement; handle: MatrixHandle }[] = [];
  const hooks: ((el: HTMLElement) => void)[] = [];
  const disposers: (() => void)[] = [];
  const env: BrowserEnv = {
    mount(props, { theme, style = {} } = {}) {
      const el = document.createElement('div');
      for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v);
      if (theme) el.dataset['theme'] = theme;
      document.body.append(el);
      const handle = mountMatrix(el, props, { encodings: ENCODINGS });
      const made = { el, handle };
      mounted.push(made);
      for (const hook of hooks) hook(el);
      return made;
    },
    afterMount: (fn) => void hooks.push(fn),
    onDispose: (fn) => void disposers.push(fn),
    media: (options) => commands.emulateMedia(options),
  };
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
