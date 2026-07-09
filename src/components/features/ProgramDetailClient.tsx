"use client";

import {
  exportProgram,
  removeExerciseFromProgram,
  reorderProgramExercises,
  updateProgram,
} from "@/lib/actions/programs";
import { buildRunSetSummary, buildSetSummary } from "@/lib/utils/format";
import type { Discipline } from "@/lib/utils/discipline";
import type { ProgramSet } from "@/types/workout";
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
import { ProgramShareButton } from "@/components/features/ProgramShareButton";
import type { FriendWithActivity } from "@/types/workout";
import { ChevronLeft, ChevronRight, GripVertical, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ProgramExItem = {
  id: number;
  name: string;
  isTimed: boolean;
  isRunning?: boolean;
  discipline?: Discipline | null;
  sets: ProgramSet[];
};

type LastSession = {
  feeling: string | null;
  notes: string | null;
  date: string;
  durationMinutes: number;
};

const FEELING_COLORS: Record<string, string> = {
  Tired: "bg-red-500/20 text-red-500",
  OK: "bg-yellow-500/20 text-yellow-500",
  Good: "bg-green-500/20 text-green-500",
  Awesome: "bg-blue-500/20 text-blue-500",
};

type Props = {
  programId: number;
  programName: string;
  exercises: ProgramExItem[];
  initialEditing?: boolean;
  lastSession?: LastSession | null;
  friends?: FriendWithActivity[];
};


function SortableExerciseRow({
  exercise,
  programId,
  isEditing,
  onDelete,
  onOpen,
}: {
  exercise: ProgramExItem;
  programId: number;
  isEditing: boolean;
  onDelete: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exercise.id, disabled: !isEditing });

  const summary = exercise.isRunning
    ? buildRunSetSummary(exercise.sets, exercise.discipline)
    : buildSetSummary(exercise.sets, exercise.isTimed);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-3 py-4 border-b border-border last:border-0"
    >
      {/* Left: red minus in edit, decorative circle in view — identical size, no layout shift */}
      {isEditing ? (
        <button
          type="button"
          onClick={() => onDelete(exercise.id)}
          className="w-7 h-7 rounded-full bg-destructive flex items-center justify-center shrink-0"
          aria-label="Remove exercise"
        >
          <Minus className="w-4 h-4 text-white" />
        </button>
      ) : (
        <div className="w-7 h-7 rounded-full border-2 border-muted-foreground/30 shrink-0" />
      )}

      {/* Exercise info — drills into the exercise's sets in both view and edit mode.
          In edit mode we intercept to commit staged changes first (see onOpen). */}
      <Link
        href={`/programs/${programId}/exercises/${exercise.id}`}
        className="flex-1 min-w-0"
        onClick={(e) => { if (isEditing) { e.preventDefault(); onOpen(exercise.id); } }}
      >
        <p className="text-base font-medium">{exercise.name}</p>
        {summary && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {summary}
          </p>
        )}
      </Link>

      {/* Right: fixed w-10 container in both modes — chevron in view, grip in edit, no layout shift */}
      {isEditing ? (
        <button
          {...attributes}
          {...listeners}
          className="w-10 h-10 flex items-center justify-center shrink-0 text-muted-foreground touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-5 h-5" />
        </button>
      ) : (
        <div className="w-10 h-10 flex items-center justify-center shrink-0">
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export function ProgramDetailClient({
  programId,
  programName,
  exercises: initial,
  initialEditing = false,
  lastSession = null,
  friends = [],
}: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exercises, setExercises] = useState(initial);
  // Snapshot of exercise order when entering edit mode — used for Cancel
  const [preEditExercises, setPreEditExercises] = useState<ProgramExItem[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());
  const [name, setName] = useState(programName);
  const [preEditName, setPreEditName] = useState(programName);

  // Sync when server data refreshes (e.g. after AddExerciseForm adds a new exercise)
  useEffect(() => {
    if (!isEditing) {
      setExercises(initial);
    }
  }, [initial, isEditing]);

  // Strip ?editing=true from URL after mounting so refresh doesn't re-trigger edit mode
  useEffect(() => {
    if (initialEditing) {
      setPreEditExercises(initial);
      setPreEditName(programName);
      router.replace(`/programs/${programId}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function startEditing() {
    setPreEditExercises(exercises);
    setPreEditName(name);
    setPendingDeleteIds(new Set());
    setIsEditing(true);
  }

  function cancelEditing() {
    setExercises(preEditExercises);
    setName(preEditName);
    setPendingDeleteIds(new Set());
    setIsEditing(false);
  }

  // Commit the staged edit-mode changes (rename / deletes / reorder) to the DB.
  async function commitEdits() {
    // Rename if changed
    if (name.trim() !== preEditName) {
      await updateProgram({ id: programId, name: name.trim() });
    }
    // Apply deletions
    for (const peId of pendingDeleteIds) {
      await removeExerciseFromProgram(peId, programId);
    }
    // Apply reorder on the surviving exercises
    const surviving = exercises.filter((e) => !pendingDeleteIds.has(e.id));
    if (surviving.length > 1) {
      await reorderProgramExercises(programId, surviving.map((e) => e.id));
    }
  }

  async function saveEditing() {
    setSaving(true);
    await commitEdits();
    setSaving(false);
    setIsEditing(false);
    router.refresh();
  }

  // Drilling into an exercise's sets leaves this screen and unmounts it, which
  // would discard staged edit-mode changes. Commit them first so nothing is lost,
  // then navigate. (Pending-deleted rows are already hidden, so the target exists.)
  async function openExercise(peId: number) {
    if (isEditing) {
      setSaving(true);
      await commitEdits();
      // Carry edit mode into the exercise's set list so the flow is continuous.
      router.push(`/programs/${programId}/exercises/${peId}?edit=true`);
      return;
    }
    router.push(`/programs/${programId}/exercises/${peId}`);
  }

  async function handleExport() {
    setExporting(true);
    const result = await exportProgram(programId);
    setExporting(false);
    if (!result.success) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "-").toLowerCase()}-program.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = exercises.findIndex((e) => e.id === active.id);
    const newIndex = exercises.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    // Only update local state — persisted on Save
    setExercises(arrayMove(exercises, oldIndex, newIndex));
  }

  function handleDeleteExercise(peId: number) {
    // Mark as pending delete and hide from list — persisted on Save
    setPendingDeleteIds((prev) => new Set(prev).add(peId));
    setExercises((prev) => prev.filter((e) => e.id !== peId));
  }

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 pt-6 pb-4 shrink-0">
        <div className="w-20 shrink-0">
          {isEditing ? (
            <button
              type="button"
              onClick={cancelEditing}
              disabled={saving}
              className="text-muted-foreground text-sm font-medium disabled:opacity-40"
            >
              Cancel
            </button>
          ) : (
            <Link href="/programs" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
              <ChevronLeft className="h-5 w-5" />
              <span className="text-sm font-medium">Back</span>
            </Link>
          )}
        </div>
        <div className="flex-1" />
        <div className="shrink-0 flex items-center gap-3">
          {!isEditing && (
            <ProgramShareButton
              programId={programId}
              friends={friends}
              onExport={handleExport}
              exporting={exporting}
            />
          )}
          {isEditing ? (
            <button
              type="button"
              onClick={saveEditing}
              disabled={saving || !name.trim()}
              className="text-primary text-sm font-semibold disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="text-primary text-sm font-medium"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Program title */}
      <div className="px-4 pb-4 shrink-0">
        {isEditing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-3xl font-bold tracking-tight w-full bg-transparent outline-none border-b-2 border-primary pb-1"
          />
        ) : (
          <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
        )}
      </div>

      {/* Last session card */}
      {lastSession && !isEditing && (
        <div className="px-4 pb-3 shrink-0">
          <div className="bg-card rounded-2xl px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Last session
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {new Date(lastSession.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                {lastSession.durationMinutes > 0 && ` · ${lastSession.durationMinutes}m`}
              </span>
              {lastSession.feeling && FEELING_COLORS[lastSession.feeling] && (
                <span className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${FEELING_COLORS[lastSession.feeling]}`}>
                  {lastSession.feeling}
                </span>
              )}
            </div>
            {lastSession.notes && (
              <p className="text-sm text-foreground/80 line-clamp-3">{lastSession.notes}</p>
            )}
          </div>
        </div>
      )}

      {/* Exercises — scrollable */}
      <div className="flex-1 overflow-y-auto px-4">
        {exercises.length === 0 && !isEditing && (
          <div className="flex flex-col items-center gap-3 pt-16 text-center">
            <p className="text-muted-foreground text-sm">
              No exercises yet. Tap Edit to add one.
            </p>
          </div>
        )}

        {exercises.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={exercises.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {exercises.map((ex) => (
                  <SortableExerciseRow
                    key={ex.id}
                    exercise={ex}
                    programId={programId}
                    isEditing={isEditing}
                    onDelete={handleDeleteExercise}
                    onOpen={openExercise}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}


      </div>

      {/* Add exercise button in edit mode */}
      {isEditing && (
        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border">
          <Link
            href={`/programs/${programId}/add-exercise`}
            className="flex items-center gap-2 text-primary text-sm font-medium"
          >
            <div className="w-7 h-7 rounded-full border-2 border-primary flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            Add exercise
          </Link>
        </div>
      )}
    </div>
  );
}
