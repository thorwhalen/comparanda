/**
 * Focus handed on after a render (#117, #256, #290): a panel whose control leaves
 * the tree with its own press (staged, deleted, a form closed) says where focus
 * goes next, and it is moved there once the component that owns `root` has
 * rendered.
 *
 * Focus is never dropped on the page. A selector that matches nothing (the
 * control it named left too) falls back to the focus home's heading. And a
 * control that leaves without anyone naming where focus goes next (another
 * reader's write, read back, removed the view it was in) takes focus with it:
 * when the element focus was last on inside `root` is gone and focus is nowhere,
 * it goes to the heading too.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';

/** Where focus goes when where it was asked to go, or where it was, is gone: the focus home's heading. */
const FALLBACK = '[data-panel-heading]';

/**
 * Set `.current` to a selector; after the next render, focus moves to its first match inside `root`, or, when there
 * is none, to the heading of the focus home (`[data-focus-home]`) that holds `root`. Written tersely: it ships in
 * the standalone page, whose byte budget is tight.
 */
export function useFocusNext(root: { current: HTMLElement | null }) {
  const next = useRef<string | undefined>(undefined);
  /** The element focus was last on inside `root`: `root` lives as long as the component, and its listener with it. */
  const last = useRef<Element | null>(null);
  useLayoutEffect(() => root.current?.addEventListener('focusin', (e) => { last.current = e.target as Element; }), []);
  useLayoutEffect(() => {
    const el = root.current;
    const wanted = next.current;
    next.current = undefined;
    if (!el) return;
    const active = (el.getRootNode() as Document).activeElement;
    // Asked for somewhere, or focus left with the element it was on and is now nowhere.
    if (wanted || ((!active || active === el.ownerDocument.body) && last.current?.isConnected === false)) {
      ((wanted && el.querySelector<HTMLElement>(wanted)) || (el.closest('[data-focus-home]') ?? el).querySelector<HTMLElement>(FALLBACK))?.focus();
    }
  });
  return next;
}
