"use client";

/**
 * CycleScheduleBuilder
 *
 * The template of a training cycle (docs/design/plan-redesign J2_RotationOrder,
 * J2_ProgramPicker, J4_WeekBuilder).
 * - Same days each week: one row a day, up to three sessions a day. Tap a
 *   session for its sheet (program, label and note, and with the endurance
 *   features on: key session, brick link, complete automatically).
 * - Rotation: an ordered list. Drag to reorder (or Move up / Move down in a
 *   row's options), add a session or a rest day.
 */

import { PlanSheetPanel } from "@/components/features/PlanSheetPanel";
import { ButtonReason, LABEL } from "@/components/features/season-ui";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createProgram } from "@/lib/actions/programs";
import {
  removeCycleSlot,
  reorderCycleSlots,
  upsertCycleSlot,
} from "@/lib/actions/training-cycles";
import { dayLabels } from "@/lib/utils/cycle-detail";
import { callAction } from "@/lib/utils/stale-bundle";
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
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Slot = TrainingCycleWithSlots["slots"][number];
/** A program, with its number of exercises when the page knows it ("6 exercises"). */
export type PickerProgram = Program & { exerciseCount?: number };
type WriteResult = Promise<{ success: boolean; error?: string }>;

const TINT = "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)]";
const PRIMARY =
  "h-[52px] w-full rounded-2xl bg-brand text-primary-foreground text-base font-semibold active:opacity-80 disabled:opacity-50";

/** What a slot runs, in words: its label (as the cycle page shows it), else its program, else Rest. */
function slotName(slot: Slot): string {
  return slot.label ?? slot.program?.name ?? (isRest(slot) ? "Rest" : "Workout");
}

/** A slot with no program and no workout: a rest day. */
function isRest(slot: Slot): boolean {
  return slot.programId == null && slot.workoutId == null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared parts
// ─────────────────────────────────────────────────────────────────────────────

function Switch({ title, sub, on, onChange }: { title: string; sub: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 min-h-[52px] border-b border-hairline">
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px]">{title}</span>
        <span className="text-[13px] text-muted-foreground">{sub}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={() => onChange(!on)}
        className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${on ? "bg-brand" : "bg-[#3a3a3e]"}`}
      >
        <span
          className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-[#f4f4f5] transition-[left] ${on ? "left-[22px]" : "left-[2px]"}`}
        />
      </button>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="py-2 text-sm text-[#ff6b5a]">
      {error}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Program picker (J2_ProgramPicker)
// ─────────────────────────────────────────────────────────────────────────────

export function ProgramPickerSheet({
  open,
  programs,
  selectedId,
  onPick,
  onRest,
  onClose,
  saveError,
}: {
  open: boolean;
  /** A refused write of the pick. */
  saveError?: string | null;
  programs: PickerProgram[];
  selectedId?: number | null;
  /** The picked program; a program made here comes with no exercises yet. */
  onPick: (program: { id: number; name: string }) => void;
  /** Offered on a rotation, where a position can be a rest day. */
  onRest?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = q ? programs.filter((p) => p.name.toLowerCase().includes(q)) : programs;

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    const result = await callAction(createProgram({ name: newName.trim() }));
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setNaming(false);
    setNewName("");
    setError(null);
    onPick({ id: result.data.id, name: result.data.name });
  }

  const row = "w-full flex items-center justify-between gap-3 px-4 py-2.5 min-h-14 text-left active:opacity-70";
  return (
    <BottomSheet open={open} onClose={onClose}>
      <PlanSheetPanel label="Pick a program" title="Pick a program">
        <label className="flex items-center gap-2.5 h-11 px-3 rounded-xl bg-widget-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="Search programs"
            placeholder="Search programs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
        <ul className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
          {onRest && !q && (
            <li className="border-b border-hairline">
              <button type="button" onClick={onRest} className={`${row} text-muted-foreground text-[15px]`}>
                Rest day
              </button>
            </li>
          )}
          {shown.map((p) => {
            const sel = p.id === selectedId;
            return (
              <li key={p.id} className="border-b border-hairline">
                <button type="button" onClick={() => onPick(p)} aria-pressed={sel} className={`${row} ${sel ? TINT : ""}`}>
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[15px] font-medium truncate">{p.name}</span>
                    {p.exerciseCount !== undefined && (
                      <span className="text-[13px] text-muted-foreground">
                        {p.exerciseCount} exercise{p.exerciseCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  {sel && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand shrink-0" role="img" aria-label="Selected">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground border-b border-hairline">
              {programs.length === 0 ? "No programs yet." : "No program has that name."}
            </li>
          )}
          <li>
            {naming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <input
                  autoFocus
                  aria-label="Program name"
                  placeholder="Program name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 h-11 px-3 rounded-xl bg-widget text-base outline-none"
                />
                <button type="submit" disabled={busy || !newName.trim()} aria-describedby={newName.trim() ? undefined : "program-name-reason"} className="h-11 px-4 rounded-xl bg-brand text-primary-foreground font-semibold disabled:opacity-50">
                  Create
                </button>
                {!newName.trim() && (
                  <div className="basis-full">
                    <ButtonReason id="program-name-reason" reason="Type a name for the program." />
                  </div>
                )}
              </form>
            ) : (
              <button type="button" onClick={() => setNaming(true)} className="w-full flex items-center px-4 min-h-[52px] text-[15px] font-medium text-brand active:opacity-70">
                + New program
              </button>
            )}
          </li>
        </ul>
        <ErrorLine error={error ?? saveError ?? null} />
      </PlanSheetPanel>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session sheet (J4_WeekBuilder): program, switches, label and note
// ─────────────────────────────────────────────────────────────────────────────

/** The fields a Done saves: only those the user changed. */
export type SlotChanges = {
  label?: string | null;
  notes?: string | null;
  autoComplete?: boolean;
  priority?: "key" | null;
  /** The brick link, stored on the session before (brickWithNext). */
  brick?: boolean;
};

function SlotSheet({
  title,
  slot,
  showAuto,
  showKey,
  brickWith,
  brickOn,
  onChangeProgram,
  onSave,
  onRemove,
  error,
  extra,
}: {
  title: string;
  slot: Slot;
  showAuto: boolean;
  showKey: boolean;
  /** The session before, when the brick link is offered. */
  brickWith: string | null;
  brickOn: boolean;
  onChangeProgram: () => void;
  onSave: (changes: SlotChanges) => void;
  onRemove: () => void;
  error: string | null;
  extra?: ReactNode;
}) {
  const [auto, setAuto] = useState(slot.autoComplete);
  const [key, setKey] = useState(slot.priority === "key");
  const [brick, setBrick] = useState(brickOn);
  const [label, setLabel] = useState(slot.label ?? "");
  const [notes, setNotes] = useState(slot.notes ?? "");
  const [labelOpen, setLabelOpen] = useState(false);

  function done() {
    const changes: SlotChanges = {};
    if (auto !== slot.autoComplete) changes.autoComplete = auto;
    if (key !== (slot.priority === "key")) changes.priority = key ? "key" : null;
    if (brick !== brickOn) changes.brick = brick;
    if (label.trim() !== (slot.label ?? "")) changes.label = label.trim() || null;
    if (notes.trim() !== (slot.notes ?? "")) changes.notes = notes.trim() || null;
    onSave(changes);
  }

  const input = "w-full rounded-xl bg-widget-2 px-3 py-2.5 text-base outline-none focus:ring-2 ring-brand";
  return (
    <PlanSheetPanel label={title} title={title}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between py-2 min-h-[52px] border-b border-hairline">
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className={LABEL}>Program</span>
            <span className="text-base font-medium truncate">{slot.program?.name ?? (isRest(slot) ? "Rest" : slot.label ?? "Workout")}</span>
          </span>
          <button type="button" onClick={onChangeProgram} className="h-11 px-3 text-[15px] font-medium text-brand active:opacity-70">
            Change
          </button>
        </div>
        {showKey && <Switch title="Key session" sub="A hard day. A missed one gets a new day." on={key} onChange={setKey} />}
        {brickWith && (
          <Switch title="Link to the session before (brick)" sub={`Run right after ${brickWith}`} on={brick} onChange={setBrick} />
        )}
        {showAuto && <Switch title="Complete automatically" sub="For days you track on Garmin" on={auto} onChange={setAuto} />}
        <button
          type="button"
          aria-expanded={labelOpen}
          onClick={() => setLabelOpen(!labelOpen)}
          className="flex items-center justify-between min-h-[52px] border-b border-hairline text-[15px] text-left"
        >
          <span>Label and note</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`text-muted-foreground transition-transform ${labelOpen ? "rotate-180" : ""}`} aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {labelOpen && (
          <div className="flex flex-col gap-3 py-3 border-b border-hairline">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Label</span>
              <input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Note</span>
              <textarea value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} className={`${input} resize-none`} />
            </label>
          </div>
        )}
        {extra}
        <ErrorLine error={error} />
        <button type="button" onClick={done} className={`mt-2 ${PRIMARY}`}>
          Done
        </button>
        {/* The destructive action goes at the bottom. */}
        <button type="button" onClick={onRemove} className="mt-1 min-h-11 text-[15px] font-medium text-[#ff6b5a] active:opacity-70">
          Remove session
        </button>
      </div>
    </PlanSheetPanel>
  );
}

/** Runs a slot write and refreshes the page; holds the error a refused write gives. */
function useSlotWrites() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  /** True when every write saved. Writes run in order and stop at the first refusal. */
  async function save(...writes: (() => WriteResult)[]) {
    for (const write of writes) {
      const result = await callAction(write());
      if (!result.success) {
        setError(result.error ?? "Could not save");
        router.refresh();
        return false;
      }
    }
    setError(null);
    router.refresh();
    return true;
  }
  return { error, setError, save };
}

// ─────────────────────────────────────────────────────────────────────────────
// Same days each week (J4_WeekBuilder)
// ─────────────────────────────────────────────────────────────────────────────

function DayOfWeekBuilder({
  cycle,
  programs,
  endurance,
}: {
  cycle: TrainingCycleWithSlots;
  programs: PickerProgram[];
  endurance: boolean;
}) {
  const { error, setError, save } = useSlotWrites();
  // The session being edited, by day (1=Mon) and its order in the day (1-3).
  const [editing, setEditing] = useState<{ day: number; daySlot: number } | null>(null);
  // The picker: a new session on a day, or a new program for the session being edited.
  const [picking, setPicking] = useState<{ day: number; daySlot: number } | null>(null);

  const slotsByDay = new Map<number, Slot[]>();
  for (const s of cycle.slots) {
    if (s.dayOfWeek == null) continue;
    slotsByDay.set(s.dayOfWeek, [...(slotsByDay.get(s.dayOfWeek) ?? []), s]);
  }
  for (const list of slotsByDay.values()) list.sort((a, b) => a.daySlot - b.daySlot);
  const labels = dayLabels(cycle.slots);
  const find = (day: number, daySlot: number) => (slotsByDay.get(day) ?? []).find((s) => s.daySlot === daySlot);
  const editSlot = editing ? find(editing.day, editing.daySlot) : undefined;
  const prevSlot = editing && editing.daySlot > 1 ? find(editing.day, editing.daySlot - 1) : undefined;

  async function pick(program: { id: number; name: string }) {
    if (!picking) return;
    const at = picking;
    const saved = await save(() =>
      upsertCycleSlot({ trainingCycleId: cycle.id, dayOfWeek: at.day, daySlot: at.daySlot, programId: program.id, label: program.name }),
    );
    if (saved) setPicking(null);
  }

  async function saveSheet(changes: SlotChanges) {
    if (!editing) return;
    const at = editing;
    const { brick, ...fields } = changes;
    const writes: (() => WriteResult)[] = [];
    if (Object.keys(fields).length) {
      writes.push(() => upsertCycleSlot({ trainingCycleId: cycle.id, dayOfWeek: at.day, daySlot: at.daySlot, ...fields }));
    }
    if (brick !== undefined) {
      writes.push(() => upsertCycleSlot({ trainingCycleId: cycle.id, dayOfWeek: at.day, daySlot: at.daySlot - 1, brickWithNext: brick }));
    }
    if (await save(...writes)) setEditing(null);
  }

  async function remove() {
    if (!editSlot) return;
    if (await save(() => removeCycleSlot(editSlot.id, cycle.id))) setEditing(null);
  }

  return (
    <>
      <div className="flex flex-col rounded-[20px] bg-widget overflow-hidden">
        {DAY_LABELS.map((dayLabel, i) => {
          const day = i + 1;
          const slots = slotsByDay.get(day) ?? [];
          const sessions = slots.filter((s) => !isRest(s));
          const full = sessions.length >= 3;
          // A day with only a rest slot gets its first session in that slot.
          const nextSlot = sessions.length === slots.length ? slots.length + 1 : (slots.find(isRest)?.daySlot ?? 1);
          return (
            <div key={day} className="flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 min-h-14 border-b border-hairline last:border-0">
              <span className="w-[34px] shrink-0 text-[13px] font-semibold text-muted-foreground">{dayLabel}</span>
              <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">
                {sessions.length === 0 && (
                  <span className={`inline-flex items-center h-11 max-w-full px-3 rounded-xl border border-[rgba(244,244,245,0.16)] text-sm font-medium ${labels[day] ? "text-foreground/80" : "text-muted-foreground"}`}>
                    <span className="truncate">{labels[day] ?? "Rest"}</span>
                  </span>
                )}
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setEditing({ day, daySlot: s.daySlot });
                    }}
                    className={`h-11 max-w-full truncate px-3 rounded-xl bg-widget-2 text-sm font-medium active:opacity-70 border ${
                      endurance && s.priority === "key" ? "border-brand" : "border-transparent"
                    }`}
                  >
                    {slotName(s)}
                  </button>
                ))}
              </div>
              {full ? (
                <span className="shrink-0 pr-1.5 text-xs text-muted-foreground">3 of 3</span>
              ) : (
                <button
                  type="button"
                  aria-label={`Add a session on ${dayLabel}`}
                  onClick={() => {
                    setError(null);
                    setPicking({ day, daySlot: nextSlot });
                  }}
                  className="h-11 w-11 shrink-0 rounded-full bg-widget-2 flex items-center justify-center active:opacity-70"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!editing && !picking && <ErrorLine error={error} />}

      <BottomSheet open={!!editSlot} onClose={() => setEditing(null)}>
        {editing && editSlot && (
          <SlotSheet
            key={editSlot.id}
            title={`${DAY_NAMES[editing.day - 1]} · session ${editing.daySlot}`}
            slot={editSlot}
            showAuto={endurance || editSlot.autoComplete}
            showKey={endurance}
            brickWith={endurance && prevSlot && !isRest(prevSlot) ? slotName(prevSlot) : null}
            brickOn={prevSlot?.brickWithNext ?? false}
            onChangeProgram={() => {
              setError(null);
              setPicking(editing);
            }}
            onSave={saveSheet}
            onRemove={remove}
            error={picking ? null : error}
          />
        )}
      </BottomSheet>
      <ProgramPickerSheet
        open={picking !== null}
        programs={programs}
        selectedId={picking ? find(picking.day, picking.daySlot)?.programId : null}
        onPick={pick}
        onClose={() => setPicking(null)}
        saveError={error}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation (J2_RotationOrder)
// ─────────────────────────────────────────────────────────────────────────────

function SortableSlotRow({ slot, position, onOptions }: { slot: Slot; position: number; onOptions: (slot: Slot) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slot.id });
  const name = slotName(slot);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-1 py-1 pr-1 min-h-14 bg-widget border-b border-hairline last:border-0"
    >
      <button
        type="button"
        className="h-11 w-11 shrink-0 flex items-center justify-center text-muted-foreground touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${name}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>
      <span className="w-6 shrink-0 text-sm text-muted-foreground">{position}</span>
      <span className={`flex-1 min-w-0 truncate text-base font-medium ${isRest(slot) ? "text-muted-foreground" : ""}`}>{name}</span>
      {slot.autoComplete && slot.program && <span className="shrink-0 text-xs text-muted-foreground">Auto</span>}
      <button
        type="button"
        onClick={() => onOptions(slot)}
        aria-label={`Options for ${name}`}
        className="h-11 w-11 shrink-0 flex items-center justify-center text-muted-foreground active:opacity-70"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
    </li>
  );
}

function RotationBuilder({
  cycle,
  programs,
  endurance,
}: {
  cycle: TrainingCycleWithSlots;
  programs: PickerProgram[];
  endurance: boolean;
}) {
  const { error, setError, save } = useSlotWrites();
  const [editingId, setEditingId] = useState<number | null>(null);
  // The picker: "add" for a new session, "edit" for the session being edited.
  const [picking, setPicking] = useState<"add" | "edit" | null>(null);
  const sortedSlots = [...cycle.slots].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const [localSlots, setLocalSlots] = useState(sortedSlots);

  // Sync local state when server returns updated props (add/remove/refresh).
  // Render-time ref + setState is the React-recommended pattern for "reset
  // local state when an external prop changes": https://react.dev/reference/react/useState#storing-information-from-previous-renders
  /* eslint-disable react-hooks/refs */
  const prevSlots = useRef(JSON.stringify(sortedSlots));
  const incoming = JSON.stringify(sortedSlots);
  if (prevSlots.current !== incoming) {
    prevSlots.current = incoming;
    setLocalSlots(sortedSlots);
  }
  /* eslint-enable react-hooks/refs */

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const editing = localSlots.find((s) => s.id === editingId);
  const editIndex = editing ? localSlots.indexOf(editing) : -1;

  async function reorder(from: number, to: number) {
    const before = localSlots;
    const reordered = arrayMove(localSlots, from, to);
    setLocalSlots(reordered);
    const saved = await save(() => reorderCycleSlots(cycle.id, reordered.map((s) => s.id)));
    if (!saved) setLocalSlots(before);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void reorder(
      localSlots.findIndex((s) => s.id === active.id),
      localSlots.findIndex((s) => s.id === over.id),
    );
  }

  // After the last position, not the count: a gap must never make it land on a slot.
  const nextOrder = Math.max(0, ...localSlots.map((s) => s.orderIndex ?? 0)) + 1;

  async function pick(program: { id: number; name: string }) {
    const orderIndex = picking === "edit" && editing ? (editing.orderIndex ?? nextOrder) : nextOrder;
    const saved = await save(() =>
      upsertCycleSlot({ trainingCycleId: cycle.id, orderIndex, programId: program.id, label: program.name }),
    );
    if (saved) setPicking(null);
  }

  async function pickRest() {
    if (!editing) return;
    const saved = await save(() =>
      upsertCycleSlot({ trainingCycleId: cycle.id, orderIndex: editing.orderIndex ?? undefined, programId: null, label: "Rest", autoComplete: false }),
    );
    if (saved) setPicking(null);
  }

  async function addRest() {
    setError(null);
    await save(() => upsertCycleSlot({ trainingCycleId: cycle.id, orderIndex: nextOrder, programId: null, label: "Rest" }));
  }

  async function saveSheet(changes: SlotChanges) {
    if (!editing) return;
    // A rotation has no key session or brick.
    const { label, notes, autoComplete } = changes;
    const fields = Object.fromEntries(Object.entries({ label, notes, autoComplete }).filter(([, v]) => v !== undefined));
    const writes: (() => WriteResult)[] = [];
    if (Object.keys(fields).length) {
      writes.push(() => upsertCycleSlot({ trainingCycleId: cycle.id, orderIndex: editing.orderIndex ?? undefined, ...fields }));
    }
    if (await save(...writes)) setEditingId(null);
  }

  async function remove() {
    if (!editing) return;
    if (await save(() => removeCycleSlot(editing.id, cycle.id))) setEditingId(null);
  }

  const outline = "flex-1 h-11 rounded-xl border border-[rgba(244,244,245,0.12)] text-[15px] font-medium active:opacity-70 disabled:opacity-40";
  return (
    <div className="flex flex-col gap-[18px]">
      <DndContext id="cycle-rotation" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localSlots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {localSlots.length > 0 && (
            <ol className="flex flex-col rounded-2xl bg-widget overflow-hidden">
              {localSlots.map((slot, i) => (
                <SortableSlotRow
                  key={slot.id}
                  slot={slot}
                  position={i + 1}
                  onOptions={(s) => {
                    setError(null);
                    setEditingId(s.id);
                  }}
                />
              ))}
            </ol>
          )}
        </SortableContext>
      </DndContext>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPicking("add");
          }}
          className={outline}
        >
          + Add session
        </button>
        <button type="button" onClick={addRest} className={outline}>
          + Add rest day
        </button>
      </div>
      {!editing && !picking && <ErrorLine error={error} />}

      {localSlots.length > 0 && (
        <p className="text-sm leading-5 text-muted-foreground">
          Repeats every {localSlots.length} day{localSlots.length === 1 ? "" : "s"}. A missed session waits for you. It does not skip.
        </p>
      )}

      <BottomSheet open={!!editing} onClose={() => setEditingId(null)}>
        {editing && (
          <SlotSheet
            key={editing.id}
            title={slotName(editing)}
            slot={editing}
            showAuto={!isRest(editing) && (endurance || editing.autoComplete)}
            showKey={false}
            brickWith={null}
            brickOn={false}
            onChangeProgram={() => {
              setError(null);
              setPicking("edit");
            }}
            onSave={saveSheet}
            onRemove={remove}
            error={picking ? null : error}
            extra={
              <div className="flex gap-2 py-2">
                <button type="button" disabled={editIndex <= 0} onClick={() => reorder(editIndex, editIndex - 1)} className={outline}>
                  Move up
                </button>
                <button type="button" disabled={editIndex >= localSlots.length - 1} onClick={() => reorder(editIndex, editIndex + 1)} className={outline}>
                  Move down
                </button>
              </div>
            }
          />
        )}
      </BottomSheet>
      <ProgramPickerSheet
        open={picking !== null}
        programs={programs}
        selectedId={picking === "edit" ? editing?.programId : null}
        onPick={pick}
        onRest={picking === "edit" && editing && !isRest(editing) ? pickRest : undefined}
        onClose={() => setPicking(null)}
        saveError={error}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function CycleScheduleBuilder({
  cycle,
  programs,
  endurance = false,
}: {
  cycle: TrainingCycleWithSlots;
  programs: PickerProgram[];
  /** The endurance switch: key session, brick link and complete automatically. */
  endurance?: boolean;
}) {
  if (cycle.scheduleType === "rotation") {
    return <RotationBuilder cycle={cycle} programs={programs} endurance={endurance} />;
  }
  return <DayOfWeekBuilder cycle={cycle} programs={programs} endurance={endurance} />;
}
