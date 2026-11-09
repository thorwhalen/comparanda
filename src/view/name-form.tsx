/**
 * The name a local identity writes under, asked for once (#193, ADR-0012
 * default 2), wherever the matrix can write as that identity: the detail
 * panel's discussion and the suggestions panel (#274). One component, so the
 * field reads, refuses and is described the same way in both.
 */
import { useLayoutEffect } from 'preact/hooks';

import { refusedField, useSend } from './send.js';

/**
 * Give the writer a name before their first write. Offered, as a `name` on a
 * panel's writes, only while the identity is one that takes a typed name
 * (`localIdentity()`) and has none; absent, the panel asks for no name.
 */
export type TakeName = (typed: string) => Promise<void>;

/**
 * The name being typed, held by the matrix rather than by its field (#328), so a field drawn again (the panel closed
 * and reopened, the other panel's field) starts from it, and a panel reads from it whether a draft is held (#321).
 * `undefined` holds nothing; `''` is a field emptied but not yet left, still held, so the panel is not pulled out from
 * under the reader. Typing redraws nothing; only letting a hold go does, so a panel kept for it alone can close.
 */
export interface NameDraft { get(): string | undefined; set(typed: string | undefined): void }

/** What a panel that signs its writes is given to ask for a name: the matrix's `mountMatrix` supplies both while one is asked for. */
export interface NameWrites {
  /** Give the writer a name before their first write (#193, #274); see `TakeName` for when it is present. */
  name?: TakeName;
  /** The draft of that name; absent, the field keeps its own and nothing is held. */
  nameDraft?: NameDraft;
}

/**
 * It says where the name is kept and that others see it as unverified,
 * because both are true and neither is obvious.
 */
export function NameForm({ name, idBase, held }: { name: TakeName; idBase: string; held?: NameDraft | undefined }) {
  // Once the name is taken the form leaves the tree, and the matrix puts focus on its region's heading (#275).
  const { draft, setDraft, error, busy, submit } = useSend(name, 'type a name first.', held?.get());
  // Left empty, by focus or by leaving the tree, the hold goes; never on emptying the box, which would drop focus out from under the reader.
  const release = () => { if (held?.get() === '') held.set(undefined); };
  useLayoutEffect(() => release, []);
  return (
    <form class="comparanda-compose" onSubmit={submit} data-detail="name">
      <label for={`${idBase}-name`}>Your name</label>
      <input
        id={`${idBase}-name`} type="text" autocomplete="name" {...refusedField(error, `${idBase}-name-error`, `${idBase}-name-hint`)} value={draft}
        onInput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; setDraft(v); held?.set(v); }}
        // The other panel's field may have been typed in since this one was drawn.
        onFocus={() => setDraft(held?.get() ?? draft)}
        onBlur={release}
      />
      <p id={`${idBase}-name-hint`} class="comparanda-panel-hint">
        Saved on this device, not in an account. It is shown beside what you write, marked unverified: nobody checks it.
      </p>
      <button type="submit" aria-disabled={busy}>Use this name</button>
      {error && <p role="alert" id={`${idBase}-name-error`} key={error.attempt}>{`Name not kept: ${error.text}`}</p>}
    </form>
  );
}
