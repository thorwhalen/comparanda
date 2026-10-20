/**
 * The byte budget's arithmetic (#116), without a bundler: which package a
 * module belongs to, how the bundle's bytes are shared out, and how
 * reservations are charged. The build itself is tests/standalone/budget.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  attribute, BudgetExceeded, chargeBudget, lengthsByPackage, OWN_CODE, packageOf, PAGE, STANDALONE_BUDGET,
} from '../src/build/budget.js';

describe('packageOf', () => {
  it.each([
    ['/repo/node_modules/preact/dist/preact.module.js', 'preact'],
    ['/repo/node_modules/@zodal/core/dist/index.js', '@zodal/core'],
    ['/repo/node_modules/.pnpm/preact@10.27.0/node_modules/preact/hooks/dist/hooks.module.js', 'preact'],
    ['/repo/node_modules/.pnpm/@zodal+core@0.3.0/node_modules/@zodal/core/dist/index.js', '@zodal/core'],
    ['C:\\repo\\node_modules\\zod\\mini\\index.js', 'zod'],
    ['/repo/src/view/matrix.tsx', OWN_CODE],
    ['node_modules/.pnpm/preact@10.27.0/node_modules/preact/dist/preact.module.js', 'preact'],
    ['node_modules/zod/v4/mini/index.js', 'zod'],
    ['src/standalone/main.ts', OWN_CODE],
    ['\0vite/modulepreload-polyfill.js', OWN_CODE],
  ])('%s is %s', (id, pkg) => {
    expect(packageOf(id)).toBe(pkg);
  });
});

describe('attribute', () => {
  it('shares the code bytes by rendered length, gives the rest to the page, and adds up exactly', () => {
    const rendered = new Map([
      ['/r/node_modules/preact/a.js', 300],
      ['/r/node_modules/preact/b.js', 100],
      ['/r/src/x.ts', 600],
    ]);
    const shares = attribute(1100, 1000, lengthsByPackage(rendered));
    expect(shares).toEqual([
      { package: OWN_CODE, bytes: 600 },
      { package: 'preact', bytes: 400 },
      { package: PAGE, bytes: 100 },
    ]);
    expect(shares.reduce((a, c) => a + c.bytes, 0)).toBe(1100);
  });
});

describe('lengthsByPackage', () => {
  it('shares a pre-bundled module among the packages its manifest names', () => {
    const rendered = new Map([['/dist/standalone/main.js', 1000], ['/r/src/extra.ts', 100]]);
    const inside = { comparanda: 600, preact: 300, '@atlaskit/pragmatic-drag-and-drop': 100 };
    const lengths = lengthsByPackage(rendered, (id) => (id.endsWith('main.js') ? inside : undefined));
    expect(Object.fromEntries(lengths)).toEqual({ comparanda: 700, preact: 300, '@atlaskit/pragmatic-drag-and-drop': 100 });
  });

  it('attributes a module whole when its manifest is empty', () => {
    const lengths = lengthsByPackage(new Map([['/dist/main.js', 50]]), () => ({}));
    expect(Object.fromEntries(lengths)).toEqual({ [OWN_CODE]: 50 });
  });
});

describe('chargeBudget', () => {
  const budget = { limit: 1000, reserved: [{ package: 'dnd', bytes: 200, why: 'test' }] };

  it('charges a reservation whose package is not bundled', () => {
    const report = chargeBudget(900, [{ package: OWN_CODE, bytes: 900 }], budget);
    expect(report.charged).toBe(1100);
    expect(report.within).toBe(false);
    expect(() => { throw new BudgetExceeded(report); }).toThrow(/dnd \(reserved, not yet bundled\): 200 bytes/);
  });

  it('drops the reservation once the package is bundled', () => {
    const report = chargeBudget(950, [{ package: OWN_CODE, bytes: 900 }, { package: 'dnd', bytes: 50 }], budget);
    expect(report.reserved).toEqual([]);
    expect(report.charged).toBe(950);
    expect(report.within).toBe(true);
  });

  it('the shipped budget is ADR-0017 clause 8\'s budget (200 kB, raised to 206 kB, then 213 kB, by the 2026-10-20 amendments), and charges the drag-and-drop dependency ADR-0008 names', () => {
    expect(STANDALONE_BUDGET.limit).toBe(213 * 1024);
    expect(STANDALONE_BUDGET.reserved.map((r) => r.package)).toContain('@atlaskit/pragmatic-drag-and-drop');
  });
});
