/**
 * Edit-mode state for the home layout (docs/home-widgets-audit.md, 6.9). Pure,
 * for `useReducer`. `items` holds every available widget, visible and hidden,
 * in order. Every change that does something pushes the previous items on the
 * undo stack; a refused change returns the same state.
 */

import type { ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import type { WidgetSize } from "@/lib/home/widgets/types";

export type EditState = { items: ResolvedItem[]; past: ResolvedItem[][] };

export type EditAction =
  /** Drop a dragged widget at `index` among the movable widgets. */
  | { type: "moveTo"; id: WidgetId; index: number }
  | { type: "moveUp"; id: WidgetId }
  | { type: "moveDown"; id: WidgetId }
  | { type: "resize"; id: WidgetId; size: WidgetSize }
  | { type: "hide"; id: WidgetId }
  | { type: "add"; id: WidgetId }
  | { type: "reset"; items: ResolvedItem[] }
  | { type: "undo" }
  /** Start over from these items with an empty undo stack (entering edit mode, Cancel). */
  | { type: "load"; items: ResolvedItem[] };

export function initEdit(items: ResolvedItem[]): EditState {
  return { items, past: [] };
}

function commit(state: EditState, items: ResolvedItem[]): EditState {
  return { items, past: [...state.past, state.items] };
}

/** Move the item at `from` to where the item at `to` is, in the full list. */
function moveIndex(items: ResolvedItem[], from: number, to: number): ResolvedItem[] {
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** The visible widgets the user can reorder: the header always stays first. */
export function movableItems(items: ResolvedItem[]): ResolvedItem[] {
  return items.filter((i) => !i.hidden && widgetDef(i.id).kind === "widget");
}

/** Move `id` to the place of the movable widget now at `index`. */
function moveToIndex(state: EditState, id: WidgetId, index: number): EditState {
  const movable = movableItems(state.items);
  const target = movable[index];
  if (!target || target.id === id || !movable.some((i) => i.id === id)) return state;
  const from = state.items.findIndex((i) => i.id === id);
  const to = state.items.findIndex((i) => i.id === target.id);
  return commit(state, moveIndex(state.items, from, to));
}

function update(state: EditState, id: WidgetId, patch: Partial<ResolvedItem>): EditState {
  return commit(
    state,
    state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  );
}

export function editReducer(state: EditState, action: EditAction): EditState {
  const current = "id" in action ? state.items.find((i) => i.id === action.id) : undefined;
  const position = "id" in action ? movableItems(state.items).findIndex((i) => i.id === action.id) : -1;
  switch (action.type) {
    case "moveTo":
      return moveToIndex(state, action.id, action.index);
    case "moveUp":
      return position > 0 ? moveToIndex(state, action.id, position - 1) : state;
    case "moveDown":
      return position >= 0 ? moveToIndex(state, action.id, position + 1) : state;
    case "resize": {
      if (!current || current.size === action.size) return state;
      if (!(widgetDef(action.id).sizes as readonly string[]).includes(action.size)) return state;
      return update(state, action.id, { size: action.size });
    }
    case "hide":
      if (!current || current.hidden || widgetDef(action.id).critical) return state;
      return update(state, action.id, { hidden: true });
    case "add": {
      if (!current || !current.hidden) return state;
      const rest = state.items.filter((i) => i.id !== action.id);
      return commit(state, [...rest, { ...current, hidden: false, size: widgetDef(action.id).defaultSize }]);
    }
    case "reset":
      return commit(state, action.items);
    case "load":
      return initEdit(action.items);
    case "undo": {
      const prev = state.past.at(-1);
      return prev ? { items: prev, past: state.past.slice(0, -1) } : state;
    }
  }
}
