/**
 * How far a focused cell is covered by the sticky header row and column
 * (SC 2.4.11), from the rendered boxes. Shared by the sticky tests (#103) and
 * the accessibility gate (A10, #105).
 */

/**
 * How far the focused element is covered by the sticky header row and column;
 * 0 when clear. Measured from the sticky `<th>`s, where they are painted -- a
 * `<thead>` or `<tr>` box scrolls away with the content while its cells stick.
 */
export function obscured(el: HTMLElement, focused: HTMLElement): { block: number; inline: number; cut: number } {
  const scroller = el.querySelector<HTMLElement>('.comparanda-scroll')!;
  const cell = focused.getBoundingClientRect();
  const headBottom = Math.max(...Array.from(el.querySelectorAll('thead th')).map((th) => th.getBoundingClientRect().bottom));
  const rtl = getComputedStyle(scroller).direction === 'rtl';
  const inHead = focused.closest('thead') !== null;
  const isRowHeader = focused.matches('th[scope="row"]');
  // A header is sticky along its own axis: only the other axis's chrome can cover it.
  const block = inHead ? 0 : Math.max(0, headBottom - cell.top);
  let inline = 0;
  if (!isRowHeader && !focused.matches('.comparanda-corner')) {
    const corner = el.querySelector('.comparanda-corner')!.getBoundingClientRect();
    inline = rtl ? Math.max(0, cell.right - corner.left) : Math.max(0, corner.right - cell.left);
  }
  // And a cell that fits in the clear area is wholly in it: its far edges inside the scrollport too.
  // In screen pixels, as the boxes are: the scroller's own lengths are CSS pixels, scaled by a host.
  const s = scroller;
  const box = s.getBoundingClientRect();
  const [kx, ky] = [s.offsetWidth / box.width, s.offsetHeight / box.height];
  const clearHeight = (s.clientHeight - parseFloat(getComputedStyle(s).scrollPaddingBlockStart)) / ky;
  const clearWidth = (s.clientWidth - parseFloat(getComputedStyle(s).scrollPaddingInlineStart)) / kx;
  const bottom = box.top + (s.clientTop + s.clientHeight) / ky;
  const [lo, hi] = [box.left + s.clientLeft / kx, box.left + (s.clientLeft + s.clientWidth) / kx];
  const cut = Math.max(
    !inHead && cell.height <= clearHeight ? cell.bottom - bottom : 0,
    !isRowHeader && cell.width <= clearWidth ? Math.max(cell.right - hi, lo - cell.left) : 0,
    0,
  );
  return { block, inline, cut };
}
