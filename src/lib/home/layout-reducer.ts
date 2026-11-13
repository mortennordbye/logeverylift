/**
 * Edit-mode state for the home layout (docs/home-widgets-audit.md, 6.9). Pure,
 * for `useReducer`. `items` holds every available widget, visible and hidden,
 * in order: hiding a widget keeps its place and size, so showing it again puts
 * it back where it was. Every change that does something pushes the previous
 * items on the undo stack; a refused change returns the same state.
 */

import type { ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import type { WidgetSize } from "@/lib/home/widgets/types";

export type EditState = { items: ResolvedItem[]; past: ResolvedItem[][] };

export type EditAction =
  | { type: "move"; id: WidgetId; overId: WidgetId }
  | { type: "moveUp"; id: WidgetId }
  | { type: "moveDown"; id: WidgetId }
  | { type: "resize"; id: WidgetId; size: WidgetSize }
  | { type: "hide"; id: WidgetId }
  | { type: "show"; id: WidgetId }
  | { type: "add"; id: WidgetId }
  | { type: "reset"; items: ResolvedItem[] }
  | { type: "undo" }
  /** Start over from these items with an empty undo stack (entering edit mode, Cancel). */
  | { type: "load"; items: ResolvedItem[] };

export function initEdit(items: ResolvedItem[]): EditState {
  return { items, past: [] };
}

/** The visible widgets, the header included, in order. */
export function visibleItems(items: ResolvedItem[]): ResolvedItem[] {
  return items.filter((i) => !i.hidden);
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

/** Swap with the previous (-1) or next (+1) visible widget. */
function step(state: EditState, id: WidgetId, dir: -1 | 1): EditState {
  const visible = movableItems(state.items);
  const v = visible.findIndex((i) => i.id === id);
  const target = visible[v + dir];
  if (v < 0 || !target) return state;
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
  switch (action.type) {
    case "move": {
      const from = state.items.findIndex((i) => i.id === action.id);
      const to = state.items.findIndex((i) => i.id === action.overId);
      if (from < 0 || to < 0 || from === to) return state;
      if (widgetDef(action.id).kind !== "widget" || widgetDef(action.overId).kind !== "widget") return state;
      return commit(state, moveIndex(state.items, from, to));
    }
    case "moveUp":
      return step(state, action.id, -1);
    case "moveDown":
      return step(state, action.id, 1);
    case "resize": {
      if (!current || current.size === action.size) return state;
      if (!(widgetDef(action.id).sizes as readonly string[]).includes(action.size)) return state;
      return update(state, action.id, { size: action.size });
    }
    case "hide":
      if (!current || current.hidden || widgetDef(action.id).critical) return state;
      return update(state, action.id, { hidden: true });
    case "show":
      if (!current || !current.hidden) return state;
      return update(state, action.id, { hidden: false });
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
