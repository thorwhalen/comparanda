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
