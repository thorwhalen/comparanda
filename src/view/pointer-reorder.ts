/**
 * Pointer drag for reordering (#92, ADR-0008 as amended): the thin second
 * path. Everything it decides is *which header it was dropped on, and on
 * which side*; the move itself is the caller's, through the same core
 * `moveByMenu` -> `moveTo` -> `describeMove` as the menu and grab mode. Delete
 * this module and the one `onPointerDown` that starts it, and reordering still
 * works by keyboard and by menu.
 *
 * Pointer events, not HTML drag and drop, and no library (#190): the matrix
 * scrolls in both axes under sticky headers, so the one thing a library would
 * add -- auto-scroll near an edge -- is a frame loop here. A drag lives only
 * between press and release: every listener it adds is removed when it ends,
 * however it ends -- release, cancel, `Escape`, or the cancel it returns,
 * which the matrix calls when it unmounts mid-drag -- so nothing outlives it.
 */
import { treeOf } from './dom.js';

/** Pixels a press must travel before it is a drag rather than a click on the handle. */
const DRAG_THRESHOLD = 4;
/** How near an edge of the scroll container, in pixels, auto-scroll starts. */
const EDGE = 40;
/** The fastest auto-scroll, in pixels per frame, reached at the very edge. */
const MAX_SPEED = 18;

export interface PointerDrop {
  /** The header dropped on. */
  targetId: string;
  /** Which side of it, in reading order. */
  edge: 'before' | 'after';
}

export interface PointerDragOptions {
  /** The container that scrolls under the drag. */
  scroller: HTMLElement;
  /** The axis attribute value headers of the dragged axis carry (`data-axis`). */
  axis: string;
  /** The dragged entry's id. */
  id: string;
  /** Rows move vertically, columns horizontally. */
  direction: 'vertical' | 'horizontal';
  onDrop(drop: PointerDrop): void;
}

/**
 * Start following a press on a handle. The drag ends on release, on cancel,
 * or on `Escape`, and cleans up after itself; the function returned ends it
 * early, dropping nothing (a no-op once it has ended).
 */
export function startPointerDrag(event: PointerEvent, opts: PointerDragOptions): () => void {
  if (event.button !== 0) return () => undefined;
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  let x = startX;
  let y = startY;
  let dragging = false;
  let marked: HTMLElement | undefined;
  let frame = 0;
  const doc = handle.ownerDocument;
  // The tree hit-tests read from, taken at the press: the handle may be re-mounted elsewhere mid-drag.
  const tree = treeOf(handle);
  const view = doc.defaultView!;
  const rtl = view.getComputedStyle(opts.scroller).direction === 'rtl';

  const target = (): { th: HTMLElement; drop: PointerDrop } | undefined => {
    const th = tree.elementFromPoint(x, y)?.closest<HTMLElement>(`th[data-entry][data-axis="${opts.axis}"]`);
    if (!th || !opts.scroller.contains(th)) return undefined;
    const r = th.getBoundingClientRect();
    const first = opts.direction === 'vertical' ? y < r.top + r.height / 2 : (x < r.left + r.width / 2) !== rtl;
    return { th, drop: { targetId: th.getAttribute('data-entry')!, edge: first ? 'before' : 'after' } };
  };
  const mark = () => {
    const t = target();
    if (marked && marked !== t?.th) marked.removeAttribute('data-drop');
    marked = t?.th;
    if (t) t.th.setAttribute('data-drop', t.drop.edge);
  };
  const scroll = () => {
    const r = opts.scroller.getBoundingClientRect();
    const speed = (near: number) => (near < EDGE ? Math.ceil(MAX_SPEED * (1 - Math.max(near, 0) / EDGE)) : 0);
    const dx = speed(x - r.left) > 0 ? -speed(x - r.left) : speed(r.right - x);
    const dy = speed(y - r.top) > 0 ? -speed(y - r.top) : speed(r.bottom - y);
    if (dx !== 0 || dy !== 0) {
      opts.scroller.scrollBy(dx, dy);
      mark();
    }
    frame = view.requestAnimationFrame(scroll);
  };
  let ended = false;
  const end = (drop: boolean) => {
    if (ended) return;
    ended = true;
    view.cancelAnimationFrame(frame);
    marked?.removeAttribute('data-drop');
    handle.removeAttribute('data-dragging');
    view.removeEventListener('pointermove', move);
    view.removeEventListener('pointerup', up);
    view.removeEventListener('pointercancel', cancel);
    view.removeEventListener('keydown', key, true);
    if (!drop) return;
    const t = target();
    if (t) opts.onDrop(t.drop);
  };
  const move = (e: PointerEvent) => {
    x = e.clientX;
    y = e.clientY;
    if (!dragging && Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      handle.setAttribute('data-dragging', 'true');
      frame = view.requestAnimationFrame(scroll);
    }
    mark();
  };
  const up = () => {
    // A press that never travelled is a click, which the handle's own click handler takes.
    if (!dragging) return end(false);
    // The click that follows a drag, wherever it lands, is not a click on anything: swallowed
    // in this task only, so a later real click is never eaten.
    const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation(); };
    view.addEventListener('click', swallow, true);
    view.setTimeout(() => view.removeEventListener('click', swallow, true), 0);
    end(true);
  };
  const cancel = () => end(false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  };
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', cancel);
  view.addEventListener('keydown', key, true);
  return () => end(false);
}
