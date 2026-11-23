/**
 * DOM lookups that must answer the same inside a shadow root as in a document.
 *
 * The matrix mounts into either (ADR-0013: the host owns the element). Read
 * from `ownerDocument`, the focused element and the element under a point are
 * retargeted to the shadow *host*, which no node inside the matrix contains --
 * so a check like "is focus still in the grid" says no while focus never left.
 * Ask the node's own root instead.
 */

/**
 * The document or shadow root `node` is rendered in. Take it while `node` is
 * in the tree, and keep it: a node removed since (a re-render that re-parents
 * it) is the root of its own detached subtree, which is neither, so this then
 * falls back to the node's document -- right outside a shadow root, and never
 * a crash inside one.
 */
export function treeOf(node: Node): Document | ShadowRoot {
  const root = node.getRootNode();
  if (root.nodeType === root.DOCUMENT_NODE || (root as ShadowRoot).host !== undefined) return root as Document | ShadowRoot;
  return node.ownerDocument ?? (root as Document);
}

/** The element that has focus in the tree `node` belongs to. */
export function activeElementOf(node: Node): Element | null {
  return treeOf(node).activeElement ?? null;
}

/**
 * Mirror `<html data-theme>` onto `el` while `el` is in a shadow root, where the
 * stylesheet's `:root` rules cannot see the page (#208), and keep it current;
 * returns the stop. A theme `el` says itself wins: one present at mount, or one
 * the host sets later, ends the mirroring and is left as it is. In a document,
 * or where there is no `MutationObserver`, it does nothing.
 */
export function mirrorPageTheme(el: Element): () => void {
  const T = 'data-theme';
  const html = el.ownerDocument.documentElement;
  const Observer = globalThis.MutationObserver;
  if (!Observer || !(treeOf(el) as ShadowRoot).host) return () => {};
  let said: string | null = null;
  const copy = () => {
    if (el.getAttribute(T) !== said) return observer.disconnect();
    said = html.getAttribute(T);
    if (said === null) el.removeAttribute(T); else el.setAttribute(T, said);
  };
  const observer = new Observer(copy);
  observer.observe(html, { attributeFilter: [T] });
  copy();
  return () => {
    observer.disconnect();
    if (said !== null && el.getAttribute(T) === said) el.removeAttribute(T);
  };
}

/** What a thrown value says: an `Error`'s message, else the value as text. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A press on the control that already has focus keeps focus there (#371).
 *
 * WebKit (Safari) does not make buttons mouse-focusable: pressing the button that
 * has focus moves focus from it to the page. Every control whose activation
 * keeps focus on it (a busy write stays announced on its button, #197; an
 * action leaves focus where it was) then lost it in Safari only. Cancelling the
 * press's default on the focused control keeps focus where it is; a press on any
 * other control is left alone, so Chromium and Firefox still focus what is
 * clicked, and Safari still does not. Buttons and menu items only, for the
 * standalone byte budget (ADR-0017): a focused checkbox, radio or summary still
 * loses focus to a press in Safari. In Firefox a cancelled press shows no
 * `:active` state on the focused control. Bound once, as a capture handler on
 * the view's root.
 */
export const keepFocusOnPress = (event: MouseEvent): void => {
  const control = (event.target as Element).closest?.('button,[role=menuitem]');
  if (control && control === activeElementOf(control)) event.preventDefault();
};
