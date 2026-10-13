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
import { describeMove, moveByMenu, movingBlock, moveTo, reportOverShown, type MenuMove, type MoveRoute } from '../core/reorder.js';
import { applyOrder, type ViewState } from '../core/view-state.js';
import { activeElementOf } from './dom.js';

/** A step any route can ask for. `earlier` and `later` are by the entries shown. */
export type Step = 'earlier' | 'later' | 'to-start' | 'to-end' | { kind: 'before' | 'after'; id: string };

export interface ReorderContext {
  analysis: Analysis;
  view: ViewState;
  /** Who is moving things, for the order's provenance: asked at the moment of the move. */
  actor: () => string;
  /** The new view state and the sentence to announce; an unchanged state with a sentence for a refusal. */
  onReorder(state: ViewState, said: string): void;
}

const ORDER_KEY = { alternatives: 'alternativeOrder', criteria: 'criterionOrder' } as const;

/**
 * Resolve a step and move: the same for every route, and so the same result and the same sentence.
 *
 * `scope` is the entries the step is taken among, in shown order: the axis as
 * shown, or on a banded axis the band the handle is in, where a move between
 * bands would change nothing a reader can see. A step goes around whole
 * locked blocks -- the handle's own and its neighbour's -- so a run moves as
 * one and is never stopped at its own edge. What is said is counted over the
 * scope, never over hidden entries.
 */
export function commitMove(ctx: ReorderContext, axis: Axis, id: string, step: Step, route: MoveRoute, scope: readonly string[]): void {
  let v = ctx.view;
  const key = ORDER_KEY[axis];
  // An entry the view state does not order yet is shown after the ordered ones; order it there first.
  for (const x of scope) if (!v[key].order.includes(x)) v = applyOrder(v, axis, [...v[key].order, x], v[key].provenance);
  const order = v[key].order;
  const from = order.indexOf(id);
  const mine = movingBlock(v, axis, id).filter((x) => scope.includes(x));
  const first = scope.indexOf(mine[0] ?? id);
  const last = scope.indexOf(mine[mine.length - 1] ?? id);
  const neighbour = step === 'earlier' ? scope[first - 1] : step === 'later' ? scope[last + 1] : undefined;
  const theirs = neighbour === undefined ? [] : movingBlock(v, axis, neighbour).filter((x) => scope.includes(x));
  const move: MenuMove | undefined = typeof step === 'object' ? step
    : step === 'to-start' ? (scope[0] === undefined || scope[0] === mine[0] ? undefined : { kind: 'before', id: scope[0] })
      : step === 'to-end' ? (scope.at(-1) === undefined || scope.at(-1) === mine.at(-1) ? undefined : { kind: 'after', id: scope.at(-1)! })
        : neighbour === undefined ? undefined
          : step === 'earlier' ? { kind: 'before', id: theirs[0] ?? neighbour } : { kind: 'after', id: theirs.at(-1) ?? neighbour };
  const label = (ctx.analysis[axis === 'alternatives' ? 'alternatives' : 'criteria']).find((x) => x.id === id)?.label ?? id;
  try {
    // Nowhere to go within the scope: asking for the same place says where it already is.
    const { state, report } = move === undefined || ('id' in move && mine.includes(move.id))
      ? moveTo(v, axis, from, from, { by: ctx.actor(), route })
      : moveByMenu(v, axis, from, move, { by: ctx.actor(), route });
    ctx.onReorder(state, describeMove(ctx.analysis, reportOverShown(report, state, scope)));
  } catch {
    ctx.onReorder(ctx.view, `${label} was not moved: that would split entries locked together.`);
  }
}

/** The menu's entries, in words, each with the step it asks for. */
function entriesOf(scope: readonly string[], id: string, label: (id: string) => string): { text: string; step: Step }[] {
  const at = scope.indexOf(id);
  return [
    { text: 'Move to start', step: 'to-start' },
    { text: 'Move earlier', step: 'earlier' },
    { text: 'Move later', step: 'later' },
    { text: 'Move to end', step: 'to-end' },
    // "Before X" for every other shown entry but the one it already precedes.
    ...scope.filter((x, i) => x !== id && i !== at + 1).map((x) => ({ text: `Move before ${label(x)}`, step: { kind: 'before', id: x } as Step })),
  ];
}

/** Focus the first item when the menu appears: a ref, so the component keeps no effect. */
const focusFirst = (menu: HTMLElement | null) => {
  if (menu && !menu.contains(activeElementOf(menu))) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
};

/**
 * The move menu (ADR-0027): normative under SC 2.5.7, and there for pointer
 * users too. A real `role="menu"` of `menuitem`s: arrows, Home and End move
 * within it; Enter or Space chooses; Escape or Tab closes it, back to the
 * header. Its keys never reach the grid around it.
 */
export function MoveMenu({ ctx, axis, id, scope, label, labelledBy, onClose }: {
  ctx: ReorderContext; axis: Axis; id: string; scope: readonly string[]; label: (id: string) => string; labelledBy: string;
  /** `refocus`: put focus back on the header -- after a choice, Escape or Tab, never when focus left for elsewhere. */
  onClose(refocus: boolean): void;
}) {
  const entries = entriesOf(scope, id, label);
  const choose = (step: Step) => {
    onClose(true);
    commitMove(ctx, axis, id, step, 'menu', scope);
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
    } else if (event.key === 'Escape' || event.key === 'Tab') onClose(true);
    else return;
    event.preventDefault();
  };
  return (
    <ul
      role="menu" class="comparanda-menu" aria-labelledby={labelledBy} ref={focusFirst} onKeyDown={onKeyDown}
      onClick={(event: MouseEvent) => event.stopPropagation()}
      onFocusOut={(event: FocusEvent) => {
        const to = event.relatedTarget as Node | null;
        if (!to || !(event.currentTarget as HTMLElement).contains(to)) onClose(false);
      }}
    >
      {entries.map((e) => (
        <li key={e.text} role="menuitem" tabIndex={-1} onClick={() => choose(e.step)}>{e.text}</li>
      ))}
    </ul>
  );
}
