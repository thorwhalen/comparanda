/**
 * The browser-storage chain the store's local providers share (ADR-0006, #73, #117).
 *
 * `viewStateProvider` and `localCollectionProvider` keep their records the same
 * way, so the chain is written once, here:
 *
 * 1. the caller's storage, or the browser's `localStorage`, **only if a write
 *    succeeds** -- private browsing modes expose the API and then throw, so the
 *    API's presence proves nothing;
 * 2. otherwise memory, with a notice the host must show.
 *
 * A write the storage refuses is never swallowed: it rejects, with a
 * `StorageQuotaError` whose message is written for the person when the storage
 * is full, and the status's notice says what happened.
 *
 * Headless: it reports a notice; the view renders it.
 */
import type { IdentityStorage } from './index.js';

/** Where a provider's records are actually kept. */
export type StorageBacking = 'provided' | 'local-storage' | 'memory';

export interface StorageStatus {
  backing: StorageBacking;
  /** Words for the person, present while there is something they must be told; cleared by `acknowledge`. */
  notice?: string;
}

export const QUOTA_NOTICE =
  'This browser\'s storage is full, so your latest change was NOT saved. Export your analysis, or free space, before closing this tab.';

export const SAVE_FAILED_NOTICE =
  'This browser refused to save your latest change, so it was NOT saved. Export your analysis before closing this tab.';

/** A write the storage refused for lack of room. The message is for the person. */
export class StorageQuotaError extends Error {
  constructor(message = QUOTA_NOTICE) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

const isQuota = (e: unknown): boolean => {
  const { name, code } = (e ?? {}) as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
};

/** A value read from the environment, or `undefined` where reading it throws (site data blocked). */
export const ambient = <T>(read: () => T | undefined): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

/** The test of step 1: a write that works, then is undone. */
function writable(storage: IdentityStorage | undefined, key: string): storage is IdentityStorage {
  if (!storage) return false;
  try {
    const probe = `${key}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Step 1 of the chain: `storage`, else the browser's `localStorage`, if a write to it under `key` succeeds; else nothing. */
export function resolveStorage(storage: IdentityStorage | undefined, key: string): IdentityStorage | undefined {
  const candidate = storage ?? ambient(() => (globalThis as { localStorage?: IdentityStorage }).localStorage);
  return writable(candidate, key) ? candidate : undefined;
}

/** Step 2's storage: a map that lasts as long as the page. */
export function memoryStorage(): IdentityStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** A status that can be read, changed, acknowledged and listened to: what a local provider hands its host. */
export interface StatusChannel {
  status(): StorageStatus;
  set(next: StorageStatus): void;
  /** The person has seen the notice. It returns on the next failure. */
  acknowledge(): void;
  /** Hear the status change. Returns the unsubscribe. */
  onStatus(listener: (status: StorageStatus) => void): () => void;
}

export function statusChannel(initial: StorageStatus): StatusChannel {
  let current = { ...initial };
  const listeners = new Set<(status: StorageStatus) => void>();
  const set = (next: StorageStatus) => {
    current = { ...next };
    for (const l of [...listeners]) l({ ...next });
  };
  return {
    status: () => ({ ...current }),
    set,
    acknowledge: () => set({ backing: current.backing }),
    onStatus: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

/**
 * Write `value` under `key`, or say why not: the channel's notice is set and the
 * write rejects -- with a `StorageQuotaError` when the storage is full, with the
 * storage's own error otherwise. What was stored before is left as it was.
 */
export function writeOrSay(store: IdentityStorage, key: string, value: string, channel: StatusChannel): void {
  try {
    store.setItem(key, value);
  } catch (e) {
    const backing = channel.status().backing;
    if (!isQuota(e)) {
      channel.set({ backing, notice: SAVE_FAILED_NOTICE });
      throw e;
    }
    channel.set({ backing, notice: QUOTA_NOTICE });
    throw new StorageQuotaError();
  }
}
