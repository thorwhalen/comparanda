# Release notes: comparanda X.Y.Z

Copy this file into the release's notes (the GitHub release body) and fill it in. The automated accessibility set (A1–A20) is a merge gate and needs nothing here; the manual pass below is the release gate of ADR-0029, and it is recorded **in the release notes**, not in a wiki or a comment.

A release with a blank row is not blocked by the blank, but the blank is published: write `not run` and why, so a reader of the notes can tell a pass that was skipped from a pass that found nothing.

## What changed

- …

## Accessibility manual pass (ADR-0029, B1–B8)

Run by: … on …. Build: the standalone page built from this release's tag, and the demo.

For each row, record the exact browser, assistive technology and version, the operating system, and what was done, in a sentence. Result is `pass`, `fail (link to the issue)` or `not run (why)`.

| # | Check | Environment (browser, AT, version, OS) | Result | What was done and heard |
|---|---|---|---|---|
| B1 | **NVDA + Firefox, NVDA + Chrome.** Enter the matrix; it is announced as a table/grid with correct dimensions. With `Ctrl+Alt+Arrow` table navigation, the criterion and alternative headers are announced with each cell, followed by "*n* of 5, confidence *x*". | | | |
| B2 | **JAWS + Chrome.** Same, plus `Ctrl+Alt+Arrow`. The grab-mode arrow keys reach the handler; if they do not, the `Tab` route works and the menu route works. | | | |
| B3 | **VoiceOver + Safari (macOS).** Sort announcements arrive via the live region (VoiceOver on macOS is documented not to announce `aria-sort` changes on activation). | | | |
| B4 | **VoiceOver + Safari (iOS 17+).** Cells and headers are announced; a tap opens the panel (there is no tooltip on touch). | | | |
| B5 | **Keyboard only, no screen reader.** A criterion is reordered by menu and by grab. The keyboard-help affordance is discoverable without a screen reader. | | | |
| B6 | **Windows High Contrast Mode, real, not emulated.** Compared against what A15 asserts under emulation: the numeral, the glyph and the cell border are all present. | | | |
| B7 | **400 % browser zoom, 320 px viewport.** Sticky headers, the panel and the menus are still usable. | | | |
| B8 | **Print to PDF** with "background graphics" **off**, on Chrome and on Safari. Every cell is legible. Record whether the headers repeat on page 2, per browser. | | | |

## Known issues

- …
