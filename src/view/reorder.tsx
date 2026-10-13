/**
 * Reordering in the view (#92, ADR-0008, ADR-0027): the move menu, and the one
 * function every route commits through.
 *
 * Three routes -- the move menu, keyboard grab mode, pointer drag -- each name
 * a step ("earlier", "before Berlin", "to the end") and hand it to
 * `commitMove`, which resolves it against the entries *shown* (a hidden
 * neighbour is not a place a reader can see to move past), moves through core's
 * `moveByMenu` -> `moveTo`, and says what happened with core's `describeMove`.
 * So the routes cannot differ in result or in words: there is one path.
 */
import type { Axis } from '../core/schema/groups.js';
import type { Analysis } from '../core/schema/analysis.js';
import { describeMove, moveByMenu, type MenuMove, type MoveRoute } from '../core/reorder.js';
import { applyOrder, type ViewState } from '../core/view-state.js';

/** A step any route can ask for. `earlier` and `later` are by the entries shown. */
export type Step = 'earlier' | 'later' | 'to-start' | 'to-end' | { kind: 'before' | 'after'; id: string };

export interface ReorderContext {
  analysis: Analysis;
  view: ViewState;
  /** Who is moving things, for the order's provenance: asked at the moment of the move. */
  actor: () => string;
  /** The ids shown on each axis, in shown order, each once. */
  shown: Readonly<Record<Axis, readonly string[]>>;
  /** The new view state and the sentence to announce; an unchanged state with a sentence for a refusal. */
  onReorder(state: ViewState, said: string): void;
}

const ORDER_KEY = { alternatives: 'alternativeOrder', criteria: 'criterionOrder' } as const;

/** Resolve a step and move: the same for every route, and so the same result and the same sentence. */
export function commitMove(ctx: ReorderContext, axis: Axis, id: string, step: Step, route: MoveRoute): void {
  let v = ctx.view;
  const key = ORDER_KEY[axis];
  // An entry the view state does not order yet is shown after the ordered ones; order it there first.
  if (!v[key].order.includes(id)) v = applyOrder(v, axis, [...v[key].order, id], v[key].provenance);
  const order = v[key].order;
  const from = order.indexOf(id);
  const shown = ctx.shown[axis];
  const at = shown.indexOf(id);
  const neighbour = step === 'earlier' ? shown[at - 1] : step === 'later' ? shown[at + 1] : undefined;
  const move: MenuMove = typeof step === 'object' ? step
    : step === 'to-start' ? { kind: 'to-start' }
      : step === 'to-end' ? { kind: 'to-end' }
        // At the shown edge there is nowhere to go: asking for the same place says so.
        : neighbour === undefined ? { kind: 'before', id: order[from + 1] ?? id }
          : { kind: step === 'earlier' ? 'before' : 'after', id: neighbour };
  try {
    const { state, report } = move.kind === 'before' && move.id === id
      ? moveByMenu(v, axis, from, { kind: 'to-end' }, { by: ctx.actor(), route }) // already last of all
      : moveByMenu(v, axis, from, move, { by: ctx.actor(), route });
    ctx.onReorder(state, describeMove(ctx.analysis, report));
  } catch (error) {
    ctx.onReorder(ctx.view, `Not moved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The menu's entries, in words, each with the step it asks for. */
function entriesOf(ctx: ReorderContext, axis: Axis, id: string, label: (id: string) => string): { text: string; step: Step }[] {
  const shown = ctx.shown[axis];
  const at = shown.indexOf(id);
  return [
    { text: 'Move to start', step: 'to-start' },
    { text: 'Move earlier', step: 'earlier' },
    { text: 'Move later', step: 'later' },
    { text: 'Move to end', step: 'to-end' },
    // "Before X" for every other shown entry but the one it already precedes.
    ...shown.filter((x, i) => x !== id && i !== at + 1).map((x) => ({ text: `Move before ${label(x)}`, step: { kind: 'before', id: x } as Step })),
  ];
}

/** Focus the first item when the menu appears: a ref, so the component keeps no effect. */
const focusFirst = (menu: HTMLElement | null) => {
  if (menu && !menu.contains(menu.ownerDocument.activeElement)) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
};

/**
 * The move menu (ADR-0027): normative under SC 2.5.7, and there for pointer
 * users too. A real `role="menu"` of `menuitem`s: arrows, Home and End move
 * within it; Enter or Space chooses; Escape or Tab closes it, back to the
 * header. Its keys never reach the grid around it.
 */
export function MoveMenu({ ctx, axis, id, label, labelledBy, onClose }: {
  ctx: ReorderContext; axis: Axis; id: string; label: (id: string) => string; labelledBy: string; onClose(): void;
}) {
  const entries = entriesOf(ctx, axis, id, label);
  const choose = (step: Step) => {
    onClose();
    commitMove(ctx, axis, id, step, 'menu');
  };
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = items.indexOf(event.target as HTMLElement);
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') go(i + 1);
    else if (event.key === 'ArrowUp') go(i - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (i >= 0) choose(entries[i]!.step);
    } else if (event.key === 'Escape' || event.key === 'Tab') onClose();
    else return;
    event.preventDefault();
  };
  return (
    <ul
      role="menu" class="comparanda-menu" aria-labelledby={labelledBy} ref={focusFirst} onKeyDown={onKeyDown}
      onClick={(event: MouseEvent) => event.stopPropagation()}
      onFocusOut={(event: FocusEvent) => {
        const to = event.relatedTarget as Node | null;
        if (!to || !(event.currentTarget as HTMLElement).contains(to)) onClose();
      }}
    >
      {entries.map((e) => (
        <li key={e.text} role="menuitem" tabIndex={-1} onClick={() => choose(e.step)}>{e.text}</li>
      ))}
    </ul>
  );
}
