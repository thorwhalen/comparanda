/**
 * The suggestions panel (#256, the view half of #113): every open suggestion,
 * with accept and decline, and "accept all / decline all from" a proposer.
 *
 * Decisions are **staged**, not written: each staged one can be undone on its
 * own until the reader writes them, together, through the source
 * (`SuggestionWrites`, which `mountMatrix` supplies like the thread writes).
 * A refused decision is shown refused, with the affordance's reason, never as
 * a button that silently does nothing. Status is said in words ("Staged:
 * accept"), never by colour alone, and every control is a button.
 *
 * The words are core's (`describeOpenSuggestions`), which also decides
 * whether a round lets this reader know who proposed a suggestion.
 */
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Analysis } from '../core/schema/analysis.js';
import type { Affordances, SuggestionDecision } from '../core/affordances.js';
import type { ViewerContext } from '../core/schema/redaction.js';
import type { Vouched } from '../core/identity.js';
import { describeOpenSuggestions, type OpenSuggestion } from '../core/suggestion-list.js';
import { capitalise } from './words.js';

export interface SuggestionChoice { suggestionId: string; decision: SuggestionDecision }

/** Write staged decisions, in order, as one change; rejects with the reason when the source or document refuses. */
export interface SuggestionWrites {
  decide(choices: readonly SuggestionChoice[]): Promise<void>;
}

const DID: Readonly<Record<SuggestionDecision, string>> = { accept: 'accept', decline: 'decline' };
/** Why a decision the document allows is still refused: the host mounted the matrix without suggestion writes. */
export const NO_WRITES = 'this matrix was not given a way to write decisions on suggestions, so it can only list them.';
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function SuggestionsPanel({ analysis, affordances, writes, viewer, vouched }: {
  analysis: Analysis; affordances: Affordances; writes?: SuggestionWrites | undefined;
  viewer?: ViewerContext | undefined; vouched?: Vouched | undefined;
}) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const focusNext = useRef<string | undefined>(undefined);
  const [staged, setStaged] = useState<SuggestionChoice[]>([]);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    if (focusNext.current) root.current?.querySelector<HTMLElement>(focusNext.current)?.focus();
    focusNext.current = undefined;
  });
  const open = describeOpenSuggestions(analysis, { viewer, vouched });
  // A suggestion decided elsewhere meanwhile is no longer staged here.
  const live = staged.filter((c) => open.some((o) => o.id === c.suggestionId));
  if (open.length === 0 && said === '') return null;

  const refusal = (sid: string, d: SuggestionDecision): string | undefined => {
    const may = affordances.decideSuggestion(sid, d);
    if (!may.enabled) return may.reason || 'not possible here.';
    return writes ? undefined : NO_WRITES;
  };
  const stage = (choices: SuggestionChoice[], sentence: string) => {
    setStaged([...live.filter((c) => !choices.some((x) => x.suggestionId === c.suggestionId)), ...choices]);
    setSaid(sentence);
  };
  const undo = (sid: string) => {
    setStaged(live.filter((c) => c.suggestionId !== sid));
    setSaid('Undone; nothing was written.');
    focusNext.current = `[data-suggestion="${sid}"] button`;
  };
  const write = () => {
    if (!writes || live.length === 0) return;
    const n = live.length;
    setBusy(true);
    writes.decide(live).then(
      () => { setStaged([]); setSaid(`Wrote ${plural(n, 'decision')}.`); },
      (e: unknown) => setSaid(`Nothing was written: ${e instanceof Error ? e.message : String(e)}`),
    ).finally(() => setBusy(false));
  };

  const act = (o: OpenSuggestion, d: SuggestionDecision) => {
    const why = refusal(o.id, d);
    const label = `${d === 'accept' ? 'Accept' : 'Decline'}`;
    return why === undefined
      ? <button type="button" onClick={() => { focusNext.current = `[data-suggestion="${o.id}"] [data-undo]`; stage([{ suggestionId: o.id, decision: d }], `Staged: ${DID[d]} the suggestion on ${o.about}. Not written yet.`); }}>{label}</button>
      : (
        <>
          <button type="button" aria-disabled="true" aria-describedby={`${id}-${o.id}-${d}`}>{label}</button>
          {' '}<span class="comparanda-reason" id={`${id}-${o.id}-${d}`}>{capitalise(why)}</span>
        </>
      );
  };

  // "From <proposer>": only for proposers this reader may name, with more than one open suggestion.
  const byProposer = new Map<string, OpenSuggestion[]>();
  for (const o of open) if (o.proposerId !== undefined) byProposer.set(o.proposerId, [...(byProposer.get(o.proposerId) ?? []), o]);
  const bulk = [...byProposer.values()].filter((list) => list.length > 1);
  const stageAll = (list: OpenSuggestion[], d: SuggestionDecision) => {
    const allowed = list.filter((o) => refusal(o.id, d) === undefined);
    const skipped = list.length - allowed.length;
    stage(allowed.map((o) => ({ suggestionId: o.id, decision: d })),
      `Staged: ${DID[d]} ${plural(allowed.length, 'suggestion')} from ${list[0]!.who}${skipped ? `; ${skipped} refused, left open` : ''}. Not written yet.`);
  };

  return (
    <section class="comparanda-suggestions" ref={root} aria-labelledby={id} data-suggestions={String(open.length)}>
      <h2 id={id}>{`Open suggestions (${open.length})`}</h2>
      <p class="comparanda-panel-hint">Accepting writes the proposed value into its cell as its proposer&apos;s; declining records only the decision. Decisions are staged here, each undoable, and written together.</p>
      <ol class="comparanda-thread-list">
        {open.map((o) => {
          const choice = live.find((c) => c.suggestionId === o.id);
          return (
            <li key={o.id} data-suggestion={o.id} data-staged={choice?.decision}>
              <p>{`${o.who} suggests ${o.proposes} for ${o.about}.`}{o.rationale && ` “${o.rationale}”`}</p>
              <p>
                {choice
                  ? <><strong>{`Staged: ${DID[choice.decision]}.`}</strong>{' '}<button type="button" data-undo="" onClick={() => undo(o.id)}>Undo</button></>
                  : <>{act(o, 'accept')}{' '}{act(o, 'decline')}</>}
              </p>
            </li>
          );
        })}
      </ol>
      {bulk.map((list) => (
        <p key={list[0]!.proposerId} data-bulk={list[0]!.proposerId}>
          {`From ${list[0]!.who}: `}
          <button type="button" onClick={() => stageAll(list, 'accept')}>{`Accept all ${list.length}`}</button>{' '}
          <button type="button" onClick={() => stageAll(list, 'decline')}>{`Decline all ${list.length}`}</button>
        </p>
      ))}
      {live.length > 0 && (
        <p>
          <button type="button" data-write="" disabled={busy || !writes} onClick={write}>{`Write ${plural(live.length, 'decision')}`}</button>{' '}
          <button type="button" onClick={() => { setStaged([]); setSaid('Every staged decision undone; nothing was written.'); }}>Undo all</button>
        </p>
      )}
      <p class="comparanda-panel-hint" role="status" aria-live="polite" data-said="">{said}</p>
    </section>
  );
}
