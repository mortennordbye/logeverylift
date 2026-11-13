"use client";

import type { ResolvedItem } from "@/lib/home/layout";
import { movableItems } from "@/lib/home/layout-reducer";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL, type WidgetSize } from "@/lib/home/widgets/types";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { Minus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

/**
 * The home in edit mode, as the iPhone home screen does it (owner decision,
 * 2026-11-13): the real grid, two columns (S one column, M and L both), the
 * widgets jiggle, and a widget is dragged where it should go. Widget content
 * is `inert`, so no link inside a widget can fire. A "−" badge hides a widget
 * that may be hidden; a tap opens its sheet (size, Move up and down, Hide).
 *
 * While a widget is dragged the grid itself reorders under it (no sliding
 * transforms), so S, M and L widgets keep a stable, honest layout; the widget
 * follows the pointer in an overlay. The drop is one undoable change.
 */

export type Previews = Partial<Record<WidgetId, Partial<Record<WidgetSize, ReactNode>>>>;

/** Mouse and pen: drag after 8 px. Touch goes to the TouchSensor, which waits a moment first. */
class MousePenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: e }: React.PointerEvent) => e.pointerType !== "touch" && e.isPrimary && e.button === 0,
    },
  ];
}

/** The clock clicks are compared on; read only in event handlers. */
const now = () => performance.now();

const SPAN: Record<WidgetSize, string> = { s: "col-span-1", m: "col-span-2", l: "col-span-2" };

/** Pointer inside a widget first; else the nearest one, for gaps and the keyboard. */
const collision: CollisionDetection = (args) => {
  const inside = pointerWithin(args);
  return inside.length > 0 ? inside : closestCenter(args);
};

type Props = {
  items: ResolvedItem[];
  /** What a widget shows at a size: the real content at the saved size, else its static preview. */
  content: (item: ResolvedItem) => ReactNode;
  onOpen: (id: WidgetId) => void;
  onHide: (id: WidgetId) => void;
  onMoveTo: (id: WidgetId, index: number) => void;
  /** Ignore a click at this time (performance.now()), just after a long-press. */
  clickBlocked: (now: number) => boolean;
};

const titleOf = (id: unknown) => widgetDef(id as WidgetId).title;

function Badge({ item, onHide }: { item: ResolvedItem; onHide: (id: WidgetId) => void }) {
  if (widgetDef(item.id).critical) return null;
  return (
    <button
      type="button"
      aria-label={`Hide ${titleOf(item.id)}`}
      data-control="hide"
      onClick={() => onHide(item.id)}
      className="absolute -top-3 -left-3 z-10 h-11 w-11 flex items-center justify-center active:opacity-60 focus-visible:outline-none group"
    >
      <span className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center shadow group-focus-visible:ring-2 group-focus-visible:ring-primary">
        <Minus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
      </span>
    </button>
  );
}

/** The tile's own body: the button that opens the sheet, with the widget inside, inert. */
function TileBody({ item, children, ...rest }: { item: ResolvedItem; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      data-control="tile"
      aria-label={`${titleOf(item.id)}, ${SIZE_LABEL[item.size].toLowerCase()}. Enter for options.`}
      className="block w-full rounded-2xl text-left cursor-grab touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div inert className="pointer-events-none select-none">
        {children}
      </div>
    </div>
  );
}

function SortableTile({ item, index, props }: { item: ResolvedItem; index: number; props: Props }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className={`relative ${SPAN[item.size]}`}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      data-testid="edit-tile"
      data-edit-tile={item.id}
    >
      <div className="home-jiggle" style={{ animationDelay: `${-(index % 3) * 0.09}s` }}>
        <TileBody
          item={item}
          {...attributes}
          {...listeners}
          onClick={() => {
            if (!props.clickBlocked(now())) props.onOpen(item.id);
          }}
          onKeyDown={(e) => {
            // Space picks the widget up (the keyboard drag); Enter opens its sheet.
            if (e.key === "Enter") {
              e.preventDefault();
              props.onOpen(item.id);
              return;
            }
            listeners?.onKeyDown?.(e);
          }}
        >
          {props.content(item)}
        </TileBody>
      </div>
      <Badge item={item} onHide={props.onHide} />
    </div>
  );
}

export function HomeEditGrid(props: Props) {
  const { items, content, onOpen, onHide, onMoveTo, clickBlocked } = props;
  const movable = movableItems(items);
  const header = items.find((i) => widgetDef(i.id).kind === "header" && !i.hidden) ?? null;
  const [dragIds, setDragIds] = useState<WidgetId[] | null>(null);
  const [activeId, setActiveId] = useState<WidgetId | null>(null);
  const shown = dragIds ? dragIds.map((id) => movable.find((i) => i.id === id)!).filter(Boolean) : movable;
  const ids = shown.map((i) => i.id);
  const lastDrop = useRef(Number.NEGATIVE_INFINITY);
  // The widget swapped with last. Widgets differ in size, so after a swap the
  // pointer can still be over it; swapping again would make the grid flicker
  // back and forth. It swaps again only after the pointer has left it.
  const lastSwap = useRef<WidgetId | null>(null);

  const sensors = useSensors(
    useSensor(MousePenSensor, { activationConstraint: { distance: 8 } }),
    // Touch: hold briefly first, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const position = (id: unknown) => ids.indexOf(id as WidgetId) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}, position ${position(active.id)} of ${ids.length}.`,
    onDragOver: ({ active }) => `${titleOf(active.id)} is at position ${position(active.id)} of ${ids.length}.`,
    onDragEnd: ({ active }) => `${titleOf(active.id)} moved to position ${position(active.id)} of ${ids.length}.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} cancelled.`,
  };

  function onDragStart(e: DragStartEvent) {
    lastSwap.current = null;
    setActiveId(e.active.id as WidgetId);
    setDragIds(movable.map((i) => i.id));
  }
  function onDragOver(e: DragOverEvent) {
    const over = e.over?.id as WidgetId | undefined;
    const active = e.active.id as WidgetId;
    if (over !== lastSwap.current) lastSwap.current = null;
    if (!over || over === active || over === lastSwap.current || !dragIds) return;
    const from = dragIds.indexOf(active);
    const to = dragIds.indexOf(over);
    if (from < 0 || to < 0) return;
    lastSwap.current = over;
    setDragIds(arrayMove(dragIds, from, to));
  }
  function onDragEnd(e: DragEndEvent) {
    const active = e.active.id as WidgetId;
    const index = dragIds?.indexOf(active) ?? -1;
    setDragIds(null);
    setActiveId(null);
    lastDrop.current = now();
    if (index >= 0) onMoveTo(active, index);
  }
  function onDragCancel() {
    setDragIds(null);
    setActiveId(null);
  }

  // A drop ends with a click on the widget under the pointer: that click must not open its sheet.
  const gridProps = { ...props, clickBlocked: (now: number) => clickBlocked(now) || now - lastDrop.current < 400 };
  const active = activeId ? movable.find((i) => i.id === activeId) : null;

  return (
    <div className="grid grid-cols-2 gap-3 pt-3" data-testid="home-edit-grid">
      {header && (
        <div className="relative col-span-2" data-testid="edit-tile" data-edit-tile={header.id}>
          <div className="home-jiggle">
            <TileBody
              item={header}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!gridProps.clickBlocked(now())) onOpen(header.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(header.id);
                }
              }}
            >
              <div className="rounded-2xl bg-muted py-2">{content(header)}</div>
            </TileBody>
          </div>
          <Badge item={header} onHide={onHide} />
        </div>
      )}
      <DndContext
        id="home-edit"
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Press Space to pick up the widget, the arrow keys to move it, Space to drop it. Press Enter for its size and more.",
          },
        }}
      >
        <SortableContext items={ids} strategy={() => null}>
          {shown.map((item, n) => (
            <SortableTile key={item.id} item={item} index={n} props={gridProps} />
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="rounded-2xl shadow-2xl scale-[1.03] opacity-95">
              <div inert className="pointer-events-none">{content(active)}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
