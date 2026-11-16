/**
 * A form's submission and its refusal, shared by every form the view draws
 * (the discussion's, the name field, #193/#274): the text typed, refused while
 * empty, sent once at a time, kept when the send fails, and the failure said
 * as a new alert each attempt, on the field as well as beside it (#276).
 */
import { useRef, useState } from 'preact/hooks';

import { messageOf } from './dom.js';

/** A failure as the alert shows it: its sentence, and which attempt raised it. */
export interface Failure { text: string; attempt: number }

/**
 * The last failure, re-keyed on every attempt so the alert is a new element
 * and the same reason twice is announced twice.
 */
export function useFailure(): [Failure | undefined, (text: string | undefined) => void] {
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const set = (text: string | undefined) =>
    setFailure((was) => (text === undefined ? undefined : { text, attempt: (was?.attempt ?? 0) + 1 }));
  return [failure, set];
}

/** A rejection's reason as a sentence. */
export function sentenceOf(e: unknown): string {
  return messageOf(e).replace(/\.?$/, '.');
}

/**
 * A form's submission: the text typed, refused while empty, sent once at a
 * time, kept when the send fails, and the failure said.
 */
export function useSend(send: (text: string) => Promise<void>, empty: string, initial = '', done?: () => void) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useFailure();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (sending.current) return;
    if (draft.trim() === '') {
      setError(empty);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await send(draft);
      if (done) done();
      else setDraft('');
    } catch (e) {
      setError(sentenceOf(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return { draft, setDraft, error, busy, submit };
}

/**
 * A field's refusal, on the field itself (#276): marked invalid, and described
 * by the reason as well as by whatever else describes it, so a reader who
 * comes back to it hears why. Cleared with the error, on the next send.
 */
export function refusedField(error: unknown, errorId: string, ...describedBy: string[]) {
  const ids = [...describedBy, ...(error ? [errorId] : [])].join(' ');
  return { 'aria-invalid': error ? 'true' as const : undefined, 'aria-describedby': ids || undefined };
}
