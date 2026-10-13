/**
 * The accessibility gate in a second engine (#213): the checks whose answer
 * depends on what the engine does with an emulated medium or a computed style.
 * Forced colors, print and reduced motion are recoloured, dropped and honoured
 * differently by each engine; contrast and the background-image ban are read
 * off what it computed. The rest (focus, keys, announcements) is the DOM's and
 * the view's, run once in Chromium. WebKit is not here: it needs system
 * libraries the CI image does not carry, and B6 is the real-device pass.
 */
import { BROWSER_CHECKS } from './browser-checks.js';
import { withBrowserEnv } from './browser-env.js';
import { gateTests } from './gate.js';

const ENGINE_DEPENDENT = ['A13', 'A15', 'A16', 'A18', 'A20'];

gateTests('browser', BROWSER_CHECKS.filter((c) => ENGINE_DEPENDENT.includes(c.id)), withBrowserEnv, { partial: true });
