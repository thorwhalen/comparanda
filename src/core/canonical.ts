/**
 * A canonical JSON form, for telling a changed value from a reordered one.
 *
 * Internal to `core`: the write-path guards compare stored records with it.
 */

/** JSON with sorted keys, so a reordered object is not mistaken for a changed one. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x) ?? 'undefined';
}
