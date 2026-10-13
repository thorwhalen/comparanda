/**
 * The accessibility gate in a second engine (#213): the checks whose answer
 * depends on what the engine does with an emulated medium or a computed style.
 * Forced colors, print and reduced motion are recoloured, dropped and honoured
 * differently by each engine; contrast and the background-image ban are read
 * off what it computed. The rest (focus, keys, announcements) is the DOM's and
 * the view's, run once in Chromium. WebKit is not here, and why is in
 * ADR-0029's amendment on #216; B3, B4 and B8 are the Safari passes, and B6 is real forced colors.
 */
import { describe, expect, it } from 'vitest';

import { BROWSER_CHECKS } from './browser-checks.js';
import { withBrowserEnv } from './browser-env.js';
import { gateTests } from './gate.js';

const ENGINE_DEPENDENT = ['A13', 'A15', 'A16', 'A18', 'A20'];

const checks = BROWSER_CHECKS.filter((c) => ENGINE_DEPENDENT.includes(c.id));

// A partial run must not shrink without anyone noticing: a renumbered or misspelt id would drop a check from Firefox in silence.
describe('the Firefox half runs exactly the engine-dependent checks', () => {
  it('each is implemented once', () => {
    expect(checks.map((c) => c.id)).toEqual(ENGINE_DEPENDENT);
  });
});

gateTests('browser', checks, withBrowserEnv, { partial: true });
