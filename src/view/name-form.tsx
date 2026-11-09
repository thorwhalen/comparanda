/**
 * The name a local identity writes under, asked for once (#193, ADR-0012
 * default 2), wherever the matrix can write as that identity: the detail
 * panel's discussion and the suggestions panel (#274). One component, so the
 * field reads, refuses and is described the same way in both.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';

import { refusedField, useSend } from './send.js';

/**
 * Give the writer a name before their first write. Offered, as a `name` on a
 * panel's writes, only while the identity is one that takes a typed name
 * (`localIdentity()`) and has none; absent, the panel asks for no name.
 */
export type TakeName = (typed: string) => Promise<void>;

/**
 * It says where the name is kept and that others see it as unverified,
 * because both are true and neither is obvious.
 */
export function NameForm({ name, idBase, onHold }: {
  name: TakeName; idBase: string;
  /**
   * Told `true` as soon as the reader has typed something, and `false` when the field loses focus empty or the form
   * leaves the tree (the name was taken): a host that would otherwise take the form away, because nothing it is for
   * is left, keeps it while it is held (#321). Not released on emptying the box, which would drop focus out from under them.
   */
  onHold?: (held: boolean) => void;
}) {
  // Once the name is taken the form leaves the tree, and the matrix puts focus on its region's heading (#275).
  const { draft, setDraft, error, busy, submit } = useSend(name, 'type a name first.');
  // The latest callback, so the unmount cleanup is not the first render's. Layout effects: the hold is in place before a source update can land.
  const hold = useRef(onHold);
  hold.current = onHold;
  const typed = draft !== '';
  useLayoutEffect(() => { if (typed) hold.current?.(true); }, [typed]);
  useLayoutEffect(() => () => hold.current?.(false), []);
  return (
    <form class="comparanda-compose" onSubmit={submit} data-detail="name">
      <label for={`${idBase}-name`}>Your name</label>
      <input
        id={`${idBase}-name`} type="text" autocomplete="name" {...refusedField(error, `${idBase}-name-error`, `${idBase}-name-hint`)} value={draft}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => { if (!typed) hold.current?.(false); }}
      />
      <p id={`${idBase}-name-hint`} class="comparanda-panel-hint">
        Saved on this device, not in an account. It is shown beside what you write, marked unverified: nobody checks it.
      </p>
      <button type="submit" aria-disabled={busy}>Use this name</button>
      {error && <p role="alert" id={`${idBase}-name-error`} key={error.attempt}>{`Name not kept: ${error.text}`}</p>}
    </form>
  );
}
