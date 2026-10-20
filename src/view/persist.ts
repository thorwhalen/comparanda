/**
 * `mountPersistedMatrix` -- `mountMatrix` with the view state kept (ADR-0006, #224).
 *
 * Wires `viewStateProvider` (the fallback chain: provider, `localStorage`,
 * memory) to the mount: the stored arrangement is read before the first draw,
 * every `onViewChange` is written back, and the provider's notice -- memory
 * fallback, or a write the storage refused -- is shown in the view as an alert
 * the person must acknowledge. The provider's `status()` stays the single
 * source of what is wrong; this only carries it to the screen.
 */
import { initialViewState } from '../core/view-state.js';
import { VIEW_STATE_RECORD_ID, viewStateProvider, type ViewStateProvider, type ViewStateProviderOptions } from '../store/index.js';
import { mountMatrix, type MatrixHandle } from './mount.js';
import type { MountMatrixProps } from './props.js';

export interface PersistedMatrixHandle extends MatrixHandle {
  /** The provider behind the mount, for a host that wants its `status()`. */
  viewState: ViewStateProvider;
}

export async function mountPersistedMatrix(
  el: HTMLElement,
  props: MountMatrixProps,
  options: ViewStateProviderOptions = {},
): Promise<PersistedMatrixHandle> {
  const vs = viewStateProvider(props.view ?? initialViewState(props.analysis), {
    // One key per analysis: pages served from the same origin must not share an arrangement.
    key: `comparanda.view-state.${props.analysis.id}`,
    ...options,
  });
  const record = await vs.provider.getOne(VIEW_STATE_RECORD_ID);
  const noticeOf = (): MountMatrixProps['notice'] => {
    const message = vs.status().notice;
    return message === undefined ? undefined : { message, onAcknowledge: vs.acknowledge };
  };
  const handle = mountMatrix(el, {
    ...props,
    ...(record ? { view: record.state } : {}),
    ...(noticeOf() ? { notice: noticeOf()! } : {}),
    onViewChange: (view) => {
      props.onViewChange?.(view);
      // A refused write is not lost: it is in `status().notice`, which the view shows.
      vs.provider.update(VIEW_STATE_RECORD_ID, { state: view }).catch(() => undefined);
    },
  });
  const off = vs.onStatus(() => handle.update({ notice: noticeOf() }));
  return {
    ...handle,
    viewState: vs,
    destroy: () => {
      off();
      vs.dispose();
      handle.destroy();
    },
  };
}
