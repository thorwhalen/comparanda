/**
 * Focus handed on after a render (#117, #256): a panel whose control leaves the
 * tree with its own press (staged, deleted, a form closed) says where focus goes
 * next, and it is moved there once the component that owns `root` has rendered.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';

/** Set `.current` to a selector; after the next render, focus moves to its first match inside `root`. */
export function useFocusNext(root: { current: HTMLElement | null }) {
  const next = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (next.current) root.current?.querySelector<HTMLElement>(next.current)?.focus();
    next.current = undefined;
  });
  return next;
}
