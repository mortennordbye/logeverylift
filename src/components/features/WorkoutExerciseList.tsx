"use client";

import { useWorkoutSession } from "@/contexts/workout-session-context";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
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
import { Check, ChevronRightIcon, Dumbbell, GripVertical, Minus } from "lucide-react";
import Link from "next/link";

type Exercise = {
  id: number;
  exerciseId: number;
  name: string;
  sets: ProgramSet[];
  isTimed?: boolean;
  isRunning?: boolean;
  discipline?: Discipline | null;
};

type Props = {
  programId: number;
  exercises: Exercise[];
  isEditing?: boolean;
  onDeleteExercise?: (id: number) => void;
  onReorderExercises?: (orderedIds: number[]) => void;
};


export function WorkoutExerciseList({
  programId,
  exercises,
  isEditing = false,
  onDeleteExercise,
  onReorderExercises,
}: Props) {
  const workoutSession = useWorkoutSession();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = exercises.findIndex((e) => e.id === active.id);
    const newIndex = exercises.findIndex((e) => e.id === over.id);
    const reordered = arrayMove(exercises, oldIndex, newIndex);
    onReorderExercises?.(reordered.map((e) => e.id));
  }

  function isExerciseCompleted(exercise: Exercise): boolean {
    if (!workoutSession || exercise.sets.length === 0) return false;
    return exercise.sets.every((s) => workoutSession.completedSetIds.has(s.id));
  }

  async function toggleExercise(exercise: Exercise) {
    if (!workoutSession) return;
    if (isExerciseCompleted(exercise)) {
      exercise.sets.forEach((s) => workoutSession.removeCompletedSet(s.id));
    } else {
      const { sessionId } = workoutSession;
      const setsToLog = exercise.sets.filter(
        (s) => !workoutSession.completedSetIds.has(s.id),
      );
      exercise.sets.forEach((s) => workoutSession.addCompletedSet(s.id));
      if (sessionId != null) {
        await Promise.all(
          setsToLog.map((s) =>
            exercise.isRunning
              ? logWorkoutSet({
                  sessionId,
                  exerciseId: exercise.exerciseId,
                  setNumber: exercise.sets.indexOf(s) + 1,
                  actualReps: 0,
                  weightKg: 0,
                  distanceMeters: s.distanceMeters ?? undefined,
                  durationSeconds: s.durationSeconds ?? undefined,
                  rpe: 7,
                  restTimeSeconds: s.restTimeSeconds ?? 0,
                  isCompleted: true,
                })
              : logWorkoutSet({
                  sessionId,
                  exerciseId: exercise.exerciseId,
                  setNumber: exercise.sets.indexOf(s) + 1,
                  targetReps: s.targetReps ?? undefined,
                  actualReps: s.targetReps ?? 0,
                  weightKg: Number(s.weightKg ?? 0),
                  durationSeconds: s.durationSeconds ?? undefined,
                  rpe: 7,
                  restTimeSeconds: s.restTimeSeconds ?? 0,
                  isCompleted: true,
                }),
          ),
        );
      }
    }
  }

  if (exercises.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 pt-16 text-center">
        <Dumbbell className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-muted-foreground text-sm">
          No exercises yet. Tap + to add one.
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={exercises.map((e) => e.id)}
        strategy={verticalListSortingStrategy}
      >
        {exercises.map((exercise) => (
          <SortableExerciseRow
            key={exercise.id}
            exercise={exercise}
            programId={programId}
            isEditing={isEditing}
            isCompleted={isExerciseCompleted(exercise)}
            summary={
              exercise.isRunning
                ? buildRunSetSummary(exercise.sets, exercise.discipline)
                : buildSetSummary(
                    exercise.sets.map((s) => {
                      const ov = workoutSession?.overrides[s.id];
                      if (!ov) return s;
                      const hasDuration = exercise.isTimed || s.durationSeconds != null;
                      return hasDuration
                        ? { ...s, durationSeconds: ov.durationSeconds ?? s.durationSeconds }
                        : { ...s, targetReps: ov.targetReps, weightKg: String(ov.weightKg) };
                    }),
                    exercise.isTimed,
                  )
            }
            onToggle={() => { void toggleExercise(exercise); }}
            onDelete={() => onDeleteExercise?.(exercise.id)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableExerciseRow({
  exercise,
  programId,
  isEditing,
  isCompleted,
  summary,
  onToggle,
  onDelete,
}: {
  exercise: Exercise;
  programId: number;
  isEditing: boolean;
  isCompleted: boolean;
  summary: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exercise.id, disabled: !isEditing });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-3 py-3.5 border-b border-border"
    >
      {isEditing && (
        <button
          type="button"
          onClick={onDelete}
          className="w-7 h-7 rounded-full bg-destructive flex items-center justify-center shrink-0"
        >
          <Minus className="w-4 h-4 text-white" />
        </button>
      )}

      {isEditing ? (
        <div className="w-7 h-7 rounded-full border-2 border-muted-foreground/30 shrink-0" />
      ) : exercise.isRunning ? (
        // Running exercises: non-interactive circle — must log per-set via LogRunModal
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isCompleted ? "bg-primary" : "border-2 border-muted-foreground/30"
        }`}>
          {isCompleted && <Check className="w-4 h-4 text-primary-foreground" />}
        </div>
      ) : (
        <button
          onClick={onToggle}
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
            isCompleted ? "bg-primary" : "border-2 border-muted-foreground/30"
          }`}
        >
          {isCompleted && <Check className="w-4 h-4 text-primary-foreground" />}
        </button>
      )}

      {isEditing ? (
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium">{exercise.name}</p>
          {summary && (
            <p className="text-xs text-muted-foreground truncate mt-1">
              {summary}
            </p>
          )}
        </div>
      ) : (
        <Link
          href={`/programs/${programId}/workout/exercises/${exercise.id}`}
          className="flex-1 min-w-0"
        >
          <p className="text-base font-medium">{exercise.name}</p>
          {summary && (
            <p className="text-xs text-muted-foreground truncate mt-1">
              {summary}
            </p>
          )}
        </Link>
      )}

      {isEditing ? (
        <button
          {...attributes}
          {...listeners}
          className="w-10 h-10 flex items-center justify-center shrink-0 text-muted-foreground touch-none"
        >
          <GripVertical className="h-5 w-5" />
        </button>
      ) : (
        <ChevronRightIcon className="h-5 w-5 text-muted-foreground shrink-0" />
      )}
    </div>
  );
}
