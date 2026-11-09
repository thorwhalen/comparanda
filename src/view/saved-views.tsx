/**
 * The saved-views panel (#117, ADR-0007): save the working arrangement as a
 * named view, list the views, show one whole, save over it, rename it, delete
 * it, and lock or unlock a shared one.
 *
 * It decides nothing about what may be done. Every control asks the port,
 * which asks the store (`SavedViewStore.affordances` / `.saveAffordance`):
 * the provider that keeps the view first (`getCapabilities`), then its mode and
 * the host. A refused control stays in place, `aria-disabled` and described by
 * its reason, which is shown beside it in words, never only by colour. In the
 * standalone page this is what says that shared and locked views are not
 * available there: its shared provider takes nothing, so the store refuses
 * them with that provider's reason.
 *
 * Nothing is saved unless the reader asks (no autosave), and a reader who
 * saves nothing is never asked to. Once a view is shown, the marker beside its
 * name says which dimensions the arrangement has moved on in since
 * (`viewMarker`), with "Save over" and "Revert" where the marker is.
 *
 * Showing a view goes through `mountMatrix`'s session overlay (the port's
 * `apply`), so the matrix, `onViewChange` and a persisted arrangement all see
 * the same whole `ViewState`.
 *
 * Focus is the panel's own while its list changes: a deleted view's controls
 * leave with it, and focus lands on the heading (`data-panel-heading`), as it
 * does in the suggestions panel; a form opened or closed hands focus to the
 * control that follows.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Affordance } from '../core/affordances.js';
import type { Analysis } from '../core/schema/analysis.js';
import { aliasesOf } from '../core/schema/structure.js';
import { viewMarker, type SavedView, type SavedViewMode } from '../core/saved-views.js';
import type { Dimension, ViewState } from '../core/view-state.js';
import type { SavedViewAffordances } from '../store/index.js';
import { capitalise } from './words.js';
import { refusedField, sentenceOf, useSend } from './send.js';

/** The modes a view can be saved in: a lock is an act of its own, on a shared view. */
export type NewViewMode = Exclude<SavedViewMode, 'locked'>;

/**
 * What the panel reads and writes through, supplied by `mountMatrix` from its
 * `savedViews` prop: the store, asked as the matrix's identity, about the
 * working arrangement as shown.
 */
export interface SavedViewsPort {
  /** The views of this analysis the reader may see. */
  list(): Promise<SavedView[]>;
  /** What may be done to `view`, each refusal with its reason. */
  affordances(view: SavedView): SavedViewAffordances;
  /** Whether the working arrangement may be saved as a new view of `mode`. */
  saveAffordance(mode: NewViewMode): Affordance;
  save(name: string, mode: NewViewMode): Promise<SavedView>;
  /** Save the working arrangement over `id`. */
  update(id: string): Promise<SavedView>;
  rename(id: string, name: string): Promise<SavedView>;
  delete(id: string): Promise<void>;
  lock(id: string): Promise<SavedView>;
  unlock(id: string): Promise<SavedView>;
  /** Show `view` whole, the reader's position kept. */
  apply(view: SavedView): void;
  /** What the storage behind the views has to tell the reader (it keeps nothing past this tab), if anything. */
  notice(): string | undefined;
}

const MODE_SAID: Readonly<Record<SavedViewMode, string>> = { personal: 'personal', shared: 'shared', locked: 'shared, locked' };
/** What a shared view's lock control does, by its mode now. */
const LOCK_ACT = { shared: 'lock', locked: 'unlock' } as const;
const SAVE_LABEL: Readonly<Record<NewViewMode, string>> = { personal: 'Save as a personal view', shared: 'Save as a shared view' };

/** How each dimension is named in the marker, with the analysis's own words for its axes. */
function dimensionWords(analysis: Analysis): Readonly<Record<Dimension, string>> {
  const w = aliasesOf(analysis);
  return {
    alternativeOrder: `the order of the ${w.alternatives}`,
    criterionOrder: `the order of the ${w.criteria}`,
    grouping: 'the grouping',
    selection: 'the selection',
    encoding: 'the encoding',
    sort: 'the sort',
    filter: 'what is hidden',
    transposed: 'the orientation',
  };
}

/**
 * A control the store may refuse: a button when allowed (a form's submit, without `onPress`), else the same button
 * `aria-disabled`, described by its reason beside it, and never a submit: a click on it does nothing.
 */
function Offered({ may, label, onPress, reasonId, ...data }: {
  may: Affordance; label: string; onPress?: () => void; reasonId: string; [data: `data-${string}`]: string;
}) {
  if (may.enabled) return <button type={onPress ? 'button' : 'submit'} {...data} onClick={onPress}>{label}</button>;
  return (
    <>
      <button type="button" {...data} aria-disabled="true" aria-describedby={reasonId}>{label}</button>
      {' '}<span class="comparanda-reason" id={reasonId}>{capitalise(may.reason || 'not possible here.')}</span>
    </>
  );
}

export function SavedViewsPanel({ port, analysis, view }: { port: SavedViewsPort; analysis: Analysis; view: ViewState }) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const focusNext = useRef<string | undefined>(undefined);
  const [views, setViews] = useState<SavedView[] | undefined>(undefined);
  const [unreadable, setUnreadable] = useState<string | undefined>(undefined);
  const [shownId, setShownId] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState('');
  const mode = useRef<NewViewMode>('personal');

  const refresh = () => port.list().then(
    (list) => { setViews(list); setUnreadable(undefined); },
    (e: unknown) => setUnreadable(sentenceOf(e)),
  );
  useEffect(() => { void refresh(); }, [port]);
  useLayoutEffect(() => {
    if (focusNext.current) root.current?.querySelector<HTMLElement>(focusNext.current)?.focus();
    focusNext.current = undefined;
  });

  /** A write, said either way; on success the list is read again, and focus goes where `then` says. */
  const write = (run: () => Promise<unknown>, done: string, failed: string, then?: string) => {
    run().then(
      async () => { await refresh(); setSaid(done); focusNext.current = then; },
      (e: unknown) => setSaid(`${failed}: ${sentenceOf(e)}`),
    );
  };

  const save = useSend(async (name) => {
    const chosen = mode.current;
    const v = await port.save(name.trim(), chosen);
    await refresh();
    setShownId(v.id);
    setSaid(`Saved the current arrangement as the ${MODE_SAID[v.mode]} view “${v.name}”.`);
  }, 'type a name for the view first.');

  const shown = views?.find((v) => v.id === shownId);
  const marker = viewMarker(view, shown);
  const words = dimensionWords(analysis);
  const notice = port.notice();
  const reasonId = (what: string, viewId = '') => `${id}-${viewId}-${what}`;
  const item = (viewId: string) => `[data-saved-view="${CSS.escape(viewId)}"]`;

  const showView = (v: SavedView) => {
    port.apply(v);
    setShownId(v.id);
    setSaid(`Showing the view “${v.name}”.`);
  };

  return (
    <section class="comparanda-saved-views" ref={root} aria-labelledby={id} data-saved-views={String(views?.length ?? 0)} data-focus-home="saved-views">
      <h2 id={id} tabIndex={-1} data-panel-heading="">{`Saved views${views ? ` (${views.length})` : ''}`}</h2>
      <p class="comparanda-panel-hint">
        Save this arrangement under a name, to show it again. A personal view is yours alone; a shared view lives beside the analysis, for everyone who reads it.
      </p>
      {notice && <p class="comparanda-reason" role="note" data-saved-views-notice="">{notice}</p>}
      {unreadable && <p class="comparanda-reason" role="alert">{`The saved views could not be read: ${unreadable}`}</p>}

      {shown && (
        <div data-shown-view={shown.id}>
          <p>
            <strong>{`Showing “${shown.name}”`}</strong>
            {marker.modified ? `: modified since, in ${marker.dimensions.map((d) => words[d]).join(', ')}.` : ', as saved.'}
          </p>
          {marker.modified && (
            <p>
              <Offered
                may={port.affordances(shown).update} label={`Save over “${shown.name}”`} reasonId={reasonId('update', shown.id)} data-save-over=""
                onPress={() => write(() => port.update(shown.id), `Saved the current arrangement over “${shown.name}”.`, 'Not saved')}
              />{' '}
              <button type="button" data-revert="" onClick={() => showView(shown)}>{`Revert to “${shown.name}”`}</button>
            </p>
          )}
        </div>
      )}

      <form
        class="comparanda-compose" data-save-view=""
        onSubmit={(e) => {
          const by = (e as SubmitEvent).submitter?.getAttribute('data-mode');
          mode.current = by === 'shared' ? 'shared' : 'personal';
          void save.submit(e);
        }}
      >
        <NameField label="Name for the current arrangement" idBase={`${id}-name`} send={save} failed="Not saved" />
        <p>
          {(['personal', 'shared'] as const).map((m) => (
            <span key={m}><Offered may={port.saveAffordance(m)} label={SAVE_LABEL[m]} reasonId={reasonId(`save-${m}`)} data-mode={m} />{' '}</span>
          ))}
        </p>
      </form>

      {views && views.length > 0 && (
        <ul class="comparanda-thread-list">
          {views.map((v) => {
            const may = port.affordances(v);
            return (
              <li key={v.id} data-saved-view={v.id} data-mode={v.mode}>
                <p>
                  <strong>{v.name}</strong>{` (${MODE_SAID[v.mode]})`}{v.id === shownId && ' — shown now'}
                </p>
                {renaming === v.id
                  ? <RenameForm
                    view={v} idBase={`${id}-${v.id}`}
                    rename={async (name) => {
                      await port.rename(v.id, name.trim());
                      await refresh();
                      setRenaming(undefined);
                      setSaid(`Renamed the view to “${name.trim()}”.`);
                      focusNext.current = `${item(v.id)} [data-rename]`;
                    }}
                    cancel={() => { setRenaming(undefined); focusNext.current = `${item(v.id)} [data-rename]`; }}
                  />
                  : deleting === v.id
                    ? (
                      <p role="group" aria-label={`Delete “${v.name}”?`}>
                        {`Delete “${v.name}”? This cannot be undone. `}
                        <button
                          type="button" data-confirm-delete=""
                          onClick={() => { setDeleting(undefined); write(() => port.delete(v.id), `Deleted the view “${v.name}”.`, 'Not deleted', '[data-panel-heading]'); if (shownId === v.id) setShownId(undefined); }}
                        >Delete it</button>{' '}
                        <button type="button" data-keep="" onClick={() => { setDeleting(undefined); focusNext.current = `${item(v.id)} [data-delete]`; }}>Keep it</button>
                      </p>
                    )
                    : (
                      <p>
                        <button type="button" data-show="" onClick={() => showView(v)}>{`Show “${v.name}”`}</button>{' '}
                        <Offered
                          may={may.rename} label="Rename" reasonId={reasonId('rename', v.id)} data-rename=""
                          onPress={() => { setRenaming(v.id); focusNext.current = `${item(v.id)} input`; }}
                        />{' '}
                        <Offered
                          may={may.delete} label="Delete" reasonId={reasonId('delete', v.id)} data-delete=""
                          onPress={() => { setDeleting(v.id); focusNext.current = `${item(v.id)} [data-keep]`; }}
                        />
                        {/* A lock is for a shared view; a personal one has nobody else to protect it from. */}
                        {v.mode !== 'personal' && (() => {
                          const a = LOCK_ACT[v.mode];
                          return <>{' '}<Offered
                            may={may[a]} label={capitalise(a)} reasonId={reasonId(a, v.id)} data-lock={a}
                            onPress={() => write(() => port[a](v.id), `${capitalise(a)}ed the view “${v.name}”.`, `Not ${a}ed`, `${item(v.id)} [data-lock]`)}
                          /></>;
                        })()}
                      </p>
                    )}
              </li>
            );
          })}
        </ul>
      )}
      <p class="comparanda-panel-hint" role="status" aria-live="polite" data-said="">{said}</p>
    </section>
  );
}

/** A name typed into a form, as `useSend` keeps it: the draft is never refused while typed, and a refusal is said on the field (#276). */
function NameField({ label, idBase, send, failed, onKeyDown }: {
  label: string; idBase: string; send: ReturnType<typeof useSend>; failed: string; onKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <>
      <label for={idBase}>{label}</label>
      <input
        id={idBase} type="text" value={send.draft} {...refusedField(send.error, `${idBase}-error`)} onKeyDown={onKeyDown}
        onInput={(e) => send.setDraft((e.currentTarget as HTMLInputElement).value)}
      />
      {send.error && <p role="alert" id={`${idBase}-error`} key={send.error.attempt}>{`${failed}: ${send.error.text}`}</p>}
    </>
  );
}

/** Rename one view: the field holds its name, Escape or Cancel leaves it as it was. */
function RenameForm({ view, idBase, rename, cancel }: {
  view: SavedView; idBase: string; rename: (name: string) => Promise<void>; cancel: () => void;
}) {
  const send = useSend(rename, 'a view needs a name.', view.name, () => undefined);
  return (
    <form class="comparanda-compose" data-rename-form="" onSubmit={send.submit}>
      <NameField
        label={`New name for “${view.name}”`} idBase={`${idBase}-rename`} send={send} failed="Not renamed"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
      />
      <p>
        <button type="submit">Rename</button>{' '}
        <button type="button" onClick={cancel}>Cancel</button>
      </p>
    </form>
  );
}
