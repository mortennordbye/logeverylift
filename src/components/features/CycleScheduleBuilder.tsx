"use client";

/**
 * CycleScheduleBuilder
 *
 * Interactive schedule builder for training cycles.
 * - Day of week mode: 7-day grid, tap a day to assign a program
 * - Rotation mode: draggable ordered list, tap to change, [+] to add
 */

import {
  removeCycleSlot,
  reorderCycleSlots,
  upsertCycleSlot,
} from "@/lib/actions/training-cycles";
import type { Program, TrainingCycleWithSlots } from "@/types/workout";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, PlusIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Slot = TrainingCycleWithSlots["slots"][number];

// ─────────────────────────────────────────────────────────────────────────────
// Program picker bottom sheet
// ─────────────────────────────────────────────────────────────────────────────

function ProgramPicker({
  programs,
  onSelect,
  onRest,
  onCancel,
}: {
  programs: Program[];
  onSelect: (programId: number, label: string) => void;
  onRest: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <div className="bg-background rounded-t-3xl p-4 flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="font-semibold text-base">Choose program</span>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rest option */}
        <button
          onClick={onRest}
          className="flex items-center px-4 py-3 rounded-xl text-sm text-muted-foreground active:bg-muted transition-colors"
        >
          — Rest day
        </button>

        {/* Programs */}
        {programs.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id, p.name)}
            className="flex items-center px-4 py-3 rounded-xl text-sm font-medium active:bg-muted transition-colors"
          >
            {p.name}
          </button>
        ))}

        {programs.length === 0 && (
          <p className="text-xs text-muted-foreground px-4 pb-2">
            No programs yet. Create one in the Programs tab.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Day of week mode
// ─────────────────────────────────────────────────────────────────────────────

function DayOfWeekBuilder({
  cycle,
  programs,
}: {
  cycle: TrainingCycleWithSlots;
  programs: Program[];
}) {
  const router = useRouter();
  const [pickerDay, setPickerDay] = useState<number | null>(null);

  const slotByDay = Object.fromEntries(
    cycle.slots.map((s) => [s.dayOfWeek!, s]),
  );

  async function handleSelectProgram(programId: number, label: string) {
    if (pickerDay === null) return;
    await upsertCycleSlot({
      trainingCycleId: cycle.id,
      dayOfWeek: pickerDay,
      programId,
      label,
    });
    setPickerDay(null);
    router.refresh();
  }

  async function handleRest() {
    if (pickerDay === null) return;
    const existing = slotByDay[pickerDay];
    if (existing) {
      await removeCycleSlot(existing.id, cycle.id);
    }
    setPickerDay(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden">
        {DAY_LABELS.map((dayLabel, i) => {
          const dayOfWeek = i + 1; // 1=Mon…7=Sun
          const slot = slotByDay[dayOfWeek];
          return (
            <button
              key={dayOfWeek}
              onClick={() => setPickerDay(dayOfWeek)}
              className="flex items-center gap-4 px-4 py-3 active:bg-border transition-colors min-h-[52px]"
            >
              <span className="text-xs font-semibold text-muted-foreground w-8 text-left uppercase">
                {dayLabel}
              </span>
              <span
                className={`text-sm flex-1 text-left ${
                  slot?.program
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {slot?.program ? slot.program.name : "— Rest —"}
              </span>
            </button>
          );
        })}
      </div>

      {pickerDay !== null && (
        <ProgramPicker
          programs={programs}
          onSelect={handleSelectProgram}
          onRest={handleRest}
          onCancel={() => setPickerDay(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation mode — sortable row
// ─────────────────────────────────────────────────────────────────────────────

function SortableSlotRow({
  slot,
  onEdit,
  onRemove,
}: {
  slot: Slot;
  onEdit: (slot: Slot) => void;
  onRemove: (slot: Slot) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 bg-muted"
    >
      <button
        className="text-muted-foreground touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="text-xs font-semibold text-muted-foreground w-6 text-right shrink-0">
        {slot.orderIndex}
      </span>

      <button
        onClick={() => onEdit(slot)}
        className="flex-1 text-sm font-medium text-left py-1 active:opacity-70"
      >
        {slot.program ? slot.program.name : slot.label ?? "— Rest —"}
      </button>

      <button
        onClick={() => onRemove(slot)}
        className="w-7 h-7 flex items-center justify-center rounded-full bg-destructive/10 text-destructive active:bg-destructive/20"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function RotationBuilder({
  cycle,
  programs,
}: {
  cycle: TrainingCycleWithSlots;
  programs: Program[];
}) {
  const router = useRouter();
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const sortedSlots = [...cycle.slots].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  );
  const [localSlots, setLocalSlots] = useState(sortedSlots);

  // Sync local state when server returns updated props (add/remove/refresh).
  // Render-time ref + setState is the React-recommended pattern for "reset
  // local state when an external prop changes": https://react.dev/reference/react/useState#storing-information-from-previous-renders
  /* eslint-disable react-hooks/refs */
  const prevSlotIds = useRef(cycle.slots.map((s) => s.id).join(","));
  const incomingIds = cycle.slots.map((s) => s.id).join(",");
  if (prevSlotIds.current !== incomingIds) {
    prevSlotIds.current = incomingIds;
    setLocalSlots(sortedSlots);
  }
  /* eslint-enable react-hooks/refs */

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localSlots.findIndex((s) => s.id === active.id);
    const newIndex = localSlots.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(localSlots, oldIndex, newIndex);
    setLocalSlots(reordered);
    await reorderCycleSlots(
      cycle.id,
      reordered.map((s) => s.id),
    );
    router.refresh();
  }

  async function handleSelectProgram(programId: number, label: string) {
    if (!editingSlot) return;
    await upsertCycleSlot({
      trainingCycleId: cycle.id,
      orderIndex: editingSlot.orderIndex ?? undefined,
      programId,
      label,
    });
    setEditingSlot(null);
    router.refresh();
  }

  async function handleRest() {
    if (!editingSlot) return;
    await upsertCycleSlot({
      trainingCycleId: cycle.id,
      orderIndex: editingSlot.orderIndex ?? undefined,
      programId: null,
      label: "Rest",
    });
    setEditingSlot(null);
    router.refresh();
  }

  async function handleRemove(slot: Slot) {
    await removeCycleSlot(slot.id, cycle.id);
    router.refresh();
  }

  async function handleAddSlot() {
    const nextOrder = localSlots.length + 1;
    await upsertCycleSlot({
      trainingCycleId: cycle.id,
      orderIndex: nextOrder,
      label: `Day ${nextOrder}`,
    });
    router.refresh();
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localSlots.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col rounded-2xl overflow-hidden border border-border">
            {localSlots.map((slot) => (
              <SortableSlotRow
                key={slot.id}
                slot={slot}
                onEdit={setEditingSlot}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {localSlots.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-2">
          Repeats every {localSlots.length} session
          {localSlots.length !== 1 ? "s" : ""}
        </p>
      )}

      <button
        onClick={handleAddSlot}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm text-muted-foreground active:bg-muted mt-2"
      >
        <PlusIcon className="w-4 h-4" />
        Add slot
      </button>

      {editingSlot !== null && (
        <ProgramPicker
          programs={programs}
          onSelect={handleSelectProgram}
          onRest={handleRest}
          onCancel={() => setEditingSlot(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function CycleScheduleBuilder({
  cycle,
  programs,
}: {
  cycle: TrainingCycleWithSlots;
  programs: Program[];
}) {
  if (cycle.scheduleType === "rotation") {
    return <RotationBuilder cycle={cycle} programs={programs} />;
  }
  return <DayOfWeekBuilder cycle={cycle} programs={programs} />;
}
