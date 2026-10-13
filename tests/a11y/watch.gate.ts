/**
 * The gate's instruments, tested on their own (#213): the timer watch behind
 * A11 sees every way a page can close something on the reader, and A13 refuses
 * what it cannot measure rather than passing it. A check is only as good as
 * what it can see, so what it can see is asserted here.
 */
import { describe, expect, it } from 'vitest';

import { withBrowserEnv, type BrowserEnv } from './browser-env.js';
import { autoDismissIn, BROWSER_CHECKS, plantTooltip, timersDuring, type AutoClose } from './browser-checks.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('the timer watch behind A11', () => {
  const cases: [string, () => Promise<void>][] = [
    ['setTimeout', async () => { setTimeout(() => {}, 3000); }],
    ['setInterval', async () => { const id = setInterval(() => {}, 3000); setTimeout(() => clearInterval(id), 50); }],
    ['AbortSignal.timeout', async () => { AbortSignal.timeout(3000); }],
    ['a loop of animation frames', async () => {
      let n = 0;
      await new Promise<void>((resolve) => { const tick = () => (++n < 80 ? requestAnimationFrame(tick) : resolve()); requestAnimationFrame(tick); });
    }],
  ];
  it.each(cases)('sees %s, started before or after something opened', async (_name, start) => {
    const openedAt = performance.now();
    const seen = await timersDuring(start);
    expect(autoDismissIn(seen, openedAt - 1)).toBeDefined(); // started after it opened
    expect(autoDismissIn(seen, openedAt + 10)).toBeDefined(); // started a moment before it opened, and still pending
  });

  it('does not count a timer that is due by the time something opens: its own show delay', async () => {
    const seen = await timersDuring(async () => { setTimeout(() => {}, 200); });
    const startedAt = seen.notes[0]!.at;
    expect(autoDismissIn(seen, startedAt + 200)).toBeUndefined();
    expect(autoDismissIn(seen, startedAt + 50)).toBeDefined();
  });

  it('does not count the zero-delay timers and few frames a layout needs, or anything when nothing opened', async () => {
    const openedAt = performance.now();
    const seen = await timersDuring(async () => { setTimeout(() => {}, 0); requestAnimationFrame(() => {}); await wait(10); });
    expect(autoDismissIn(seen, openedAt)).toBeUndefined();
    const long = await timersDuring(async () => { setTimeout(() => {}, 3000); });
    expect(autoDismissIn(long, undefined)).toBeUndefined();
  });

  it('puts the browser\'s timers back once the last overlapping watch ends', async () => {
    const real = window.setTimeout;
    await timersDuring(async () => { setTimeout(() => {}, 1); });
    expect(window.setTimeout).toBe(real);
    // A watch still unwinding after a timeout must not undo the next one's.
    let release!: () => void;
    const slow = timersDuring(() => new Promise<void>((resolve) => { release = resolve; }));
    await wait(5);
    const next = timersDuring(async () => { await wait(20); });
    await wait(5);
    release();
    await slow;
    expect(window.setTimeout).not.toBe(real); // the next watch is still installed
    await next;
    expect(window.setTimeout).toBe(real);
  });

  it('sees scheduler.postTask with a delay, where the browser has one', async () => {
    const scheduler = (window as unknown as { scheduler?: { postTask(t: () => void, o?: { delay?: number }): Promise<void> } }).scheduler;
    if (!scheduler) return;
    const openedAt = performance.now();
    const seen = await timersDuring(async () => { void scheduler.postTask(() => {}, { delay: 3000 }).catch(() => {}); });
    expect(autoDismissIn(seen, openedAt - 1)).toBeDefined();
  });
});

describe('A11 sees a tooltip that closes itself, however it does it', { timeout: 30_000 }, () => {
  const a11 = BROWSER_CHECKS.find((c) => c.id === 'A11')!;
  const ways: [string, AutoClose][] = [
    ['a timer started with the hover', { how: 'timeout', ms: 4000 }],
    ['AbortSignal.timeout started with the hover', { how: 'abort', ms: 4000 }],
    ['an animation that ends and removes it', { how: 'animation', ms: 700 }],
  ];
  it.each(ways)('%s', async (_name, autoClose) => {
    const found = await withBrowserEnv(
      (env) => env.afterMount((el) => env.onDispose(plantTooltip(el, { dismissOnEscape: true, withLink: false, delayMs: 100, autoClose }))),
      async (env) => a11.run(env),
    );
    expect(found.length, 'A11 did not notice').toBeGreaterThan(0);
  });
});

describe('A13 refuses what it cannot measure', () => {
  it('a filter on a cell is a finding, not a pass', async () => {
    const a13 = BROWSER_CHECKS.find((c) => c.id === 'A13')!;
    const found = await withBrowserEnv(
      (env) => env.afterMount((el) => { el.querySelector<HTMLElement>('tbody td')!.style.filter = 'contrast(0.1)'; }),
      async (env) => a13.run(env),
    );
    expect(found.join('\n')).toMatch(/has a filter \(contrast\(0\.1\)\), which the gate cannot measure/);
  });

  it('and reads opacity: faded ink is measured as faded', async () => {
    const a13 = BROWSER_CHECKS.find((c) => c.id === 'A13')!;
    const found = await withBrowserEnv(
      (env) => env.afterMount((el) => { el.querySelector<HTMLElement>('tbody td .comparanda-shown')!.style.opacity = '0.1'; }),
      async (env) => a13.run(env),
    );
    expect(found.length).toBeGreaterThan(0);
  });

});

describe('what the twins and A13 can see (#213)', { timeout: 60_000 }, () => {
  const run = (id: string, sabotage: (env: BrowserEnv) => void) => withBrowserEnv(sabotage, async (env) => BROWSER_CHECKS.find((c) => c.id === id)!.run(env));
  const css = (text: string) => (env: BrowserEnv) => env.afterMount((el) => {
    const style = document.createElement('style');
    style.textContent = text;
    el.append(style);
  });
  const HATCH = 'repeating-linear-gradient(45deg, #000 0 2px, #fff 2px 4px)';

  it.each([
    ['A hatch on ::before', css(`.comparanda-matrix td::before { content: ""; background-image: ${HATCH}; }`)],
    ['a hatch only on focus', css(`.comparanda-matrix td:focus { background-image: ${HATCH}; }`)],
    ['a hatch only on hover', css(`.comparanda-matrix td:hover { background-image: ${HATCH}; }`)],
  ] as const)('A16 sees %s', async (_name, sabotage) => {
    expect((await run('A16', sabotage)).length).toBeGreaterThan(0);
  });

  it.each([
    ['aria-grabbed during a pointer drag', (env: BrowserEnv) => env.afterMount((el) => {
      window.addEventListener('pointermove', () => el.querySelector('th[data-entry]')?.setAttribute(['aria', 'grabbed'].join('-'), 'true'));
    })],
    ['aria-dropeffect after an arrow step', (env: BrowserEnv) => env.afterMount((el) => {
      el.addEventListener('keyup', (e) => { if (e.key === 'ArrowRight') el.querySelector('th[data-entry]')?.setAttribute(['aria', 'dropeffect'].join('-'), 'move'); });
    })],
  ] as const)('A17 sees %s', async (_name, sabotage) => {
    expect((await run('A17', sabotage)).length).toBeGreaterThan(0);
  });

  it.each([
    ['a blend mode on a cell', css('.comparanda-matrix td { mix-blend-mode: multiply; }')],
    ['a filter on the row', css('.comparanda-matrix tbody tr { filter: contrast(0.2); }')],
    ['a filter on the scroller', css('.comparanda-scroll { filter: brightness(1.5); }')],
    ['an overlay on ::after', css('.comparanda-matrix td::after { content: ""; position: absolute; inset: 0; background: rgba(255, 255, 255, 0.8); }')],
  ] as const)('A13 refuses %s', async (_name, sabotage) => {
    expect((await run('A13', sabotage)).join('\n')).toMatch(/cannot measure/);
  });
});
