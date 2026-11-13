"use client";

import type { ResolvedItem } from "@/lib/home/layout";
import { movableItems, type EditAction } from "@/lib/home/layout-reducer";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL, type WidgetSize } from "@/lib/home/widgets/types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Lock, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The home in edit mode (docs/home-widgets-audit.md, 6.9): a vertical list of
 * full-width rows, one per visible widget, then the hidden ones. Each row has
 * a drag handle, the widget's static preview at its size, a size menu, Move up
 * and Move down (the single-pointer alternative to dragging, WCAG 2.5.7) and
 * hide. Widget content is not rendered here, so no link inside a widget can
 * fire. The title stays first: it can change size or hide, not move.
 */

export type Previews = Partial<Record<WidgetId, Partial<Record<WidgetSize, ReactNode>>>>;

/** A control a row can be asked to focus after a change. */
export type RowControl = "handle" | "up" | "down" | "size" | "hide" | "show";

type Props = {
  items: ResolvedItem[];
  previews: Previews;
  /** Dispatch, then focus `focus` (a row's control) and announce `say`. */
  act: (action: EditAction, focus?: { id: WidgetId; control: RowControl } | null, say?: string) => void;
};

const BTN =
  "h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground active:opacity-70 disabled:opacity-30";

function titleOf(id: WidgetId): string {
  return widgetDef(id).title;
}

function SizeMenu({ item, act }: { item: ResolvedItem; act: Props["act"] }) {
  const sizes = widgetDef(item.id).sizes;
  if (sizes.length < 2) return <span className="text-xs text-muted-foreground px-1">{SIZE_LABEL[item.size]}</span>;
  return (
    <select
      value={item.size}
      data-control="size"
      aria-label={`Size of ${titleOf(item.id)}`}
      onChange={(e) =>
        act({ type: "resize", id: item.id, size: e.target.value as WidgetSize }, { id: item.id, control: "size" }, `${titleOf(item.id)} is now ${SIZE_LABEL[e.target.value as WidgetSize].toLowerCase()}`)
      }
      className="h-11 min-w-11 rounded-xl border border-border bg-background px-2 text-sm"
    >
      {sizes.map((s) => (
        <option key={s} value={s}>
          {SIZE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function HideOrLock({ item, act, next }: { item: ResolvedItem; act: Props["act"]; next: WidgetId | null }) {
  if (widgetDef(item.id).critical) {
    return (
      <span className="h-11 shrink-0 inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground" data-testid="cant-hide">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Can&apos;t be hidden
      </span>
    );
  }
  return (
    <button
      type="button"
      data-control="hide"
      aria-label={`Hide ${titleOf(item.id)}`}
      onClick={() => act({ type: "hide", id: item.id }, next ? { id: next, control: "handle" } : null, `${titleOf(item.id)} hidden`)}
      className={`${BTN} text-destructive`}
    >
      <Minus className="h-4 w-4" aria-hidden />
    </button>
  );
}

function SortableRow({
  item,
  index,
  count,
  previews,
  act,
  next,
}: {
  item: ResolvedItem;
  index: number;
  count: number;
  previews: Previews;
  act: Props["act"];
  next: WidgetId | null;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const title = titleOf(item.id);
  const moved = (to: number) => `${title} moved to position ${to} of ${count}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="rounded-2xl border border-border bg-background p-2 space-y-2"
      data-testid="edit-row"
      data-edit-row={item.id}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-control="handle"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${title}`}
          className={`${BTN} touch-none border-transparent`}
        >
          <GripVertical className="h-5 w-5" aria-hidden />
        </button>
        <p className="flex-1 min-w-0 text-sm font-semibold truncate">{title}</p>
        <HideOrLock item={item} act={act} next={next} />
      </div>
      {/* The size and move controls on their own line, so the title keeps its room on a phone. */}
      <div className="flex items-center justify-end gap-1">
        <SizeMenu item={item} act={act} />
        <button
          type="button"
          data-control="up"
          aria-label={`Move ${title} up`}
          disabled={index === 0}
          onClick={() => act({ type: "moveUp", id: item.id }, { id: item.id, control: "up" }, moved(index))}
          className={BTN}
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          data-control="down"
          aria-label={`Move ${title} down`}
          disabled={index === count - 1}
          onClick={() => act({ type: "moveDown", id: item.id }, { id: item.id, control: "down" }, moved(index + 2))}
          className={BTN}
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {previews[item.id]?.[item.size]}
    </li>
  );
}

export function HomeEditList({ items, previews, act }: Props) {
  const movable = movableItems(items);
  const header = items.find((i) => widgetDef(i.id).kind === "header" && !i.hidden) ?? null;
  const hidden = items.filter((i) => i.hidden);
  const ids = movable.map((i) => i.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const position = (id: unknown) => ids.indexOf(id as WidgetId) + 1;
  const name = (id: unknown) => titleOf(id as WidgetId);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}, position ${position(active.id)} of ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over position ${position(over.id)} of ${ids.length}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} moved to position ${position(over.id)} of ${ids.length}.` : `${name(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} cancelled.`,
  };

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    act({ type: "move", id: e.active.id as WidgetId, overId: e.over.id as WidgetId }, { id: e.active.id as WidgetId, control: "handle" });
  }

  return (
    <div className="space-y-3" data-testid="home-edit-list">
      {header && (
        <div className="rounded-2xl border border-border bg-background p-2 space-y-2" data-testid="edit-row" data-edit-row={header.id}>
          <div className="flex items-center gap-1">
            <p className="flex-1 min-w-0 pl-2 text-sm font-semibold truncate">{titleOf(header.id)}</p>
            <SizeMenu item={header} act={act} />
            <HideOrLock item={header} act={act} next={ids[0] ?? null} />
          </div>
          {previews[header.id]?.[header.size]}
        </div>
      )}

      <DndContext
        id="home-edit"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: "To move a widget, press space or enter, use the arrow keys, then press space or enter again." },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-3" aria-label="Widgets on your home">
            {movable.map((item, n) => (
              <SortableRow
                key={item.id}
                item={item}
                index={n}
                count={movable.length}
                previews={previews}
                act={act}
                next={ids[n + 1] ?? ids[n - 1] ?? null}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {hidden.length > 0 && (
        <section aria-labelledby="home-hidden" className="space-y-2 pt-2">
          <h2 id="home-hidden" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Hidden
          </h2>
          <ul className="space-y-2">
            {hidden.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-1" data-testid="hidden-row" data-edit-row={item.id}>
                <p className="flex-1 min-w-0 text-sm truncate">{titleOf(item.id)}</p>
                <button
                  type="button"
                  data-control="show"
                  aria-label={`Show ${titleOf(item.id)}`}
                  onClick={() => act({ type: "show", id: item.id }, { id: item.id, control: "handle" }, `${titleOf(item.id)} shown`)}
                  className={BTN}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
