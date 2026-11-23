/**
 * Press a control the way a reader whose focus is on it does: focus, then click.
 *
 * A test about where focus is after a press has to say where it was before.
 * Chromium focuses a button on click and WebKit (Safari) does not (#371), so a
 * bare click starts the two engines from different places and only Chromium
 * reaches the control. Starting from focus on the control is what a keyboard
 * reader's press is, and what Chromium's click gives anyway.
 */
import { server, userEvent } from '@vitest/browser/context';

export async function press(control: HTMLElement): Promise<void> {
  control.focus();
  await userEvent.click(control);
}

/**
 * Whether this run is WebKit, for the few tests of what WebKit does differently
 * on purpose, not by a defect of ours (#371): it has no forced-colors emulation,
 * and Safari moves Tab past buttons unless the reader turns on keyboard
 * navigation (Full Keyboard Access) in macOS, so a test that reaches a button by
 * Tab tests a setting, not the view.
 */
export const inWebKit = server.browser === 'webkit';
