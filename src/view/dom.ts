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
 * in the tree: a node that has since been removed is its own root.
 */
export function treeOf(node: Node): Document | ShadowRoot {
  return node.getRootNode() as Document | ShadowRoot;
}

/** The element that has focus in the tree `node` belongs to. */
export function activeElementOf(node: Node): Element | null {
  return treeOf(node).activeElement ?? null;
}

/** The topmost element at a viewport point, as seen from inside the tree `node` belongs to. */
export function elementAt(node: Node, x: number, y: number): Element | null {
  return treeOf(node).elementFromPoint(x, y);
}
