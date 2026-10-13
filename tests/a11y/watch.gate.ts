/**
 * The gate's instruments, tested on their own (#213): the timer watch behind
 * A11 sees every way a page can close something on the reader, and A13 refuses
 * what it cannot measure rather than passing it. A check is only as good as
 * what it can see, so what it can see is asserted here.
 */
import { describe, expect, it } from 'vitest';

import { withBrowserEnv } from './browser-env.js';
import { autoDismissIn, BROWSER_CHECKS, timersDuring } from './browser-checks.js';

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
  it.each(cases)('sees %s', async (_name, start) => {
    const seen = await timersDuring(start);
    expect(autoDismissIn(seen)).toBeDefined();
  });

  it('does not count the zero-delay timers and few frames a layout needs', async () => {
    const seen = await timersDuring(async () => { setTimeout(() => {}, 0); requestAnimationFrame(() => {}); await wait(10); });
    expect(autoDismissIn(seen)).toBeUndefined();
  });

  it('counts only while its condition holds, and puts the browser\'s timers back', async () => {
    const real = window.setTimeout;
    const seen = await timersDuring(async () => { setTimeout(() => {}, 3000); }, () => false);
    expect(autoDismissIn(seen)).toBeUndefined();
    expect(window.setTimeout).toBe(real);
  });

  it('sees scheduler.postTask with a delay, where the browser has one', async () => {
    const scheduler = (window as unknown as { scheduler?: { postTask(t: () => void, o?: { delay?: number }): Promise<void> } }).scheduler;
    if (!scheduler) return;
    const seen = await timersDuring(async () => { void scheduler.postTask(() => {}, { delay: 3000 }).catch(() => {}); });
    expect(autoDismissIn(seen)).toBeDefined();
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
