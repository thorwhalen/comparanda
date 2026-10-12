/**
 * Sticky header extents, measured, so that focus never lands under them (#103).
 *
 * ADR-0027: the scroll container's `scroll-padding-block-start` and
 * `scroll-padding-inline-start` equal the sticky header row and header column.
 * Without them the first arrow press scrolls the focused cell underneath the
 * header -- SC 2.4.11 fails at exactly the moment a keyboard reader needs to
 * see the cell. The extents depend on label wrapping, fonts, zoom and the
 * group band row, so no constant in the stylesheet is right; they are measured
 * and written as custom properties the stylesheet reads:
 *
 *   - `--cmp-sticky-block`  the height of the whole sticky `<thead>`;
 *   - `--cmp-sticky-inline` the width of the sticky header column;
 *   - `--cmp-band-block`    the height of a column band row, which is where
 *                           the header row below it sticks.
 *
 * This is `mountMatrix`'s, not the component's: measuring is an effect, and the
 * component stays a pure function of its props. Where there is no
 * `ResizeObserver` (a non-browser DOM), a measure still runs after every render.
 */

/** The custom properties the stylesheet reads, by what they measure. */
export const STICKY_VARS = Object.freeze({
  block: '--cmp-sticky-block',
  inline: '--cmp-sticky-inline',
  band: '--cmp-band-block',
});

export interface StickyExtents {
  /** Measure now and write the properties; call after every render. */
  measure(): void;
  /** Stop observing. Safe to call twice. */
  release(): void;
}

/** Track the sticky extents of the matrix rendered inside `root`. */
export function trackStickyExtents(root: Element): StickyExtents {
  const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  let observer: ResizeObserver | undefined;
  /** What is observed: re-observing the same elements would fire again and loop. */
  let watched: Element[] = [];

  const measure = () => {
    const scroller = root.querySelector<HTMLElement>('.comparanda-scroll');
    const head = scroller?.querySelector('thead');
    const corner = scroller?.querySelector('.comparanda-corner');
    if (!scroller || !head || !corner) return;
    const band = head.querySelector('tr.comparanda-band');
    const px = (n: number) => `${n}px`;
    scroller.style.setProperty(STICKY_VARS.block, px(head.getBoundingClientRect().height));
    scroller.style.setProperty(STICKY_VARS.inline, px(corner.getBoundingClientRect().width));
    if (band) scroller.style.setProperty(STICKY_VARS.band, px(band.getBoundingClientRect().height));
    else scroller.style.removeProperty(STICKY_VARS.band);
    const now = [head, corner];
    if (Observer && (now.length !== watched.length || now.some((n, i) => n !== watched[i]))) {
      observer ??= new Observer(() => measure());
      observer.disconnect();
      for (const n of now) observer.observe(n);
      watched = now;
    }
  };

  return {
    measure,
    release() {
      observer?.disconnect();
      observer = undefined;
      watched = [];
    },
  };
}

/**
 * Scroll `cell` clear of the sticky headers inside its scroll container: its
 * start edges (block and inline) below and beside the sticky chrome -- the
 * container's `scroll-padding-*` -- and all of it in view when it fits. A cell
 * larger than the clear area shows its start, where its text begins.
 *
 * Done by hand rather than with `scrollIntoView({ block: 'nearest' })`: a focus
 * leaves a cell that is inside the scrollport but under the sticky column where
 * it is, and `nearest` aligns an oversized cell's far edge, hiding its start.
 */
export function revealClear(cell: Element): void {
  const scroller = cell.closest<HTMLElement>('.comparanda-scroll');
  if (!scroller) return;
  const style = getComputedStyle(scroller);
  const padBlock = parseFloat(style.scrollPaddingBlockStart) || 0;
  const padInline = parseFloat(style.scrollPaddingInlineStart) || 0;
  const rtl = style.direction === 'rtl';
  const box = scroller.getBoundingClientRect();
  const left = box.left + scroller.clientLeft;
  const top = box.top + scroller.clientTop;
  const r = cell.getBoundingClientRect();
  /** How far to scroll along one axis: bring `start` to at least `clearStart`, then `end` within `clearEnd` if that keeps `start` clear. */
  const along = (start: number, end: number, clearStart: number, clearEnd: number) => {
    if (start < clearStart) return start - clearStart;
    if (end > clearEnd) return Math.min(end - clearEnd, start - clearStart);
    return 0;
  };
  // A header sticks along its own axis, so only the other one can hide it.
  const sticksBlock = cell.closest('thead') !== null;
  const sticksInline = cell.matches('th[scope="row"], .comparanda-corner');
  const dy = sticksBlock ? 0 : along(r.top, r.bottom, top + padBlock, top + scroller.clientHeight);
  // Right to left, the inline start is the right edge: mirror, then flip the sign back.
  const dx = sticksInline ? 0 : rtl
    ? -along(-r.right, -r.left, -(left + scroller.clientWidth - padInline), -left)
    : along(r.left, r.right, left + padInline, left + scroller.clientWidth);
  if (dx !== 0 || dy !== 0) scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' });
}
