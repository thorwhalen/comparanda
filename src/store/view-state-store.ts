/**
 * The view-state provider: a fallback chain, cross-tab sync, and a loud quota failure (ADR-0006, #73).
 *
 * View state (order, grouping, selection, encoding) is per-user, per-device and
 * changes constantly, so it is the one thing here where last-write-wins is
 * right. The resolution order is ADR-0006's:
 *
 * 1. a caller-provided `DataProvider`, untouched;
 * 2. `localStorage`, **only if a write succeeds** -- private browsing modes
 *    expose the API and then throw, so the API's presence proves nothing;
 * 3. memory, with a `notice` the host must show. Silently discarding someone's
 *    arrangement is the worst available outcome, and it happens on exactly the
 *    platforms where nobody tests.
 *
 * A write the storage refuses (quota) is never swallowed: `update` rejects with
 * a `StorageQuotaError` whose message is written for the person, the stored
 * copy keeps its last good value, and `status().notice` says what happened.
 *
 * **Cross-tab sync is for view state only, and is structurally unreachable from
 * the analysis**: it lives in this provider, which holds a `ViewState` and
 * refuses anything else. The analysis goes through `inMemoryAnalysisSource` (or
 * a host's provider), where ADR-0011 clause 6 forbids last-write-wins.
 *
 * Headless, like the rest of the store: it reports a notice; the view renders it.
 */
import type { DataProvider } from '@zodal/store';

import { parseViewState, serializeViewState, ViewState } from '../core/view-state.js';
import {
  ambient, resolveStorage, statusChannel, StorageQuotaError, writeOrSay, type StorageBacking, type StorageStatus,
} from './browser-storage.js';
import { oneItemProvider, type IdentityStorage } from './index.js';

/** The document a view-state provider holds: the state, under a fixed id. */
export interface ViewStateRecord {
  id: string;
  state: ViewState;
}

export const VIEW_STATE_RECORD_ID = 'view-state';

/** Where the state is actually kept. */
export type ViewStateBacking = StorageBacking;

export type ViewStateStatus = StorageStatus;

export { StorageQuotaError };

const MEMORY_NOTICE =
  'This browser is not letting the page save anything, so your arrangement will be lost when this tab closes.';

/** The slice of an event target the `storage` event arrives on. */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (event: { key: string | null; newValue: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (event: { key: string | null; newValue: string | null }) => void): void;
}

export interface ViewStateProviderOptions {
  /** Step 1: used as is, and `status()` says `provided`. */
  provider?: DataProvider<ViewStateRecord>;
  /** Step 2's storage. Default: the browser's `localStorage`, when there is one. */
  storage?: IdentityStorage;
  /** The key the state is kept under. */
  key?: string;
  /** Where the `storage` event arrives. Default: `window`, when there is one. Pass `null` for no sync. */
  events?: StorageEvents | null;
}

export interface ViewStateProvider {
  provider: DataProvider<ViewStateRecord>;
  status(): ViewStateStatus;
  /** Tell the store the person has seen the notice. It returns on the next failure. */
  acknowledge(): void;
  /** Hear `status()` change. Returns the unsubscribe. */
  onStatus(listener: (status: ViewStateStatus) => void): () => void;
  /** Stop listening for other tabs. */
  dispose(): void;
}

/**
 * Resolve the chain and return the provider with its status.
 *
 * `initial` is what a first visit starts from (`initialViewState(analysis)`);
 * anything already stored, once migrated and validated, wins over it, and
 * anything malformed is ignored rather than half-read.
 */
export function viewStateProvider(
  initial: ViewState,
  { provider, storage, key = 'comparanda.view-state', events }: ViewStateProviderOptions = {},
): ViewStateProvider {
  const channel = statusChannel({ backing: 'provided' });
  const handle = (p: DataProvider<ViewStateRecord>, stop: () => void = () => {}): ViewStateProvider => ({
    provider: p,
    status: channel.status,
    acknowledge: channel.acknowledge,
    onStatus: channel.onStatus,
    dispose: stop,
  });
  if (provider) return handle(provider);

  const store = resolveStorage(storage, key);
  channel.set(store ? { backing: 'local-storage' } : { backing: 'memory', notice: MEMORY_NOTICE });

  const stored = (raw: string | null): ViewState | undefined => {
    if (raw === null) return undefined;
    try {
      return parseViewState(raw).state;
    } catch {
      return undefined;
    }
  };
  const start = store ? stored(ambient(() => store.getItem(key) ?? null) ?? null) ?? initial : initial;
  const inner = oneItemProvider<ViewStateRecord>({ id: VIEW_STATE_RECORD_ID, state: start });

  const wrapped: DataProvider<ViewStateRecord> = {
    ...inner,
    update: async (id, data) => {
      if (data.state !== undefined) {
        const checked = ViewState.safeParse(data.state);
        if (!checked.success) throw new Error('a view-state provider holds view state only; this is not one.');
        if (store) writeOrSay(store, key, serializeViewState(checked.data), channel);
      }
      return inner.update(id, data);
    },
  };

  // Last-write-wins: another tab's write replaces ours. Only this key, only valid state.
  const target = events === undefined ? ambient(() => (globalThis as { window?: StorageEvents }).window) : events ?? undefined;
  const hear = (event: { key: string | null; newValue: string | null }) => {
    if (event.key !== key) return;
    const state = stored(event.newValue);
    if (state) void inner.update(VIEW_STATE_RECORD_ID, { state });
  };
  if (store && target) target.addEventListener('storage', hear);
  return handle(wrapped, () => target?.removeEventListener('storage', hear));
}
