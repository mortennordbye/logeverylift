/**
 * Program Exercise Detail Page
 *
 * Shows all planned sets for a specific exercise within a program,
 * and allows adding or removing sets.
 */

import { StepsEditor } from "@/components/features/steps/StepsEditor";
import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { thresholdValues } from "@/lib/session-compliance";
import { getUserSettings } from "@/lib/user-settings";
import { buildWorkout, plainSetsToWorkout, type StepRow } from "@/lib/utils/program-steps";
import { requireSession } from "@/lib/utils/session";
import type { Workout } from "@/lib/utils/workout-steps";
import Link from "next/link";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { syncActiveCyclePeriodization } from "@/lib/actions/training-cycles";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string; programExerciseId: string }>;
  searchParams: Promise<{ edit?: string; steps?: string }>;
};

export default async function ProgramExerciseDetailPage({ params, searchParams }: Props) {
  const { id, programExerciseId } = await params;
  const { edit, steps } = await searchParams;
  const programId = Number(id);
  const peId = Number(programExerciseId);
  if (isNaN(programId) || isNaN(peId)) notFound();

  // Shows a periodized set's target, so this week's sync runs first (PZ-29).
  await syncActiveCyclePeriodization();

  const result = await getProgramWithExercises(programId);
  if (!result.success) notFound();

  const program = result.data;
  const pe = program.programExercises.find((e) => e.id === peId);
  if (!pe) notFound();

  // A swim, bike or run exercise is edited as steps (docs/plans/one-program-model.md,
  // step 4). Plain sets keep the set editor until the user turns them into steps.
  const { user } = await requireSession();
  const sport = pe.exercise.discipline;
  const plain = pe.programSets.some((s) => s.stepKind == null);
  if (sport && (await enduranceEnabledFor(user.id)) && (!plain || steps === "1")) {
    const meta = { sport, name: program.name, poolLengthM: pe.poolLengthM };
    let initial: Workout;
    if (plain) initial = plainSetsToWorkout(pe.programSets, meta);
    else if (pe.programSets.length === 0) initial = { v: 1, ...meta, poolLengthM: pe.poolLengthM ?? (sport === "swim" ? 25 : undefined), steps: [{ type: "work", end: sport === "swim" ? { type: "distance", meters: 100 } : { type: "time", seconds: 1800 } }] };
    else {
      const built = buildWorkout(pe.programSets as StepRow[], meta);
      initial = "workout" in built ? built.workout : plainSetsToWorkout([], meta);
    }
    if (initial.poolLengthM == null) delete initial.poolLengthM;
    const [thresholds, { units }] = await Promise.all([thresholdValues(user.id), getUserSettings(user.id)]);
    return (
      <StepsEditor
        programId={programId}
        programExerciseId={peId}
        exerciseName={pe.exercise.name}
        initial={initial}
        converted={plain}
        unsaved={plain || pe.programSets.length === 0}
        thresholds={thresholds}
        units={units}
      />
    );
  }

  return (
    <WorkoutSetsClient
      programId={programId}
      programExerciseId={peId}
      exerciseName={pe.exercise.name}
      exerciseCategory={pe.exercise.category ?? ""}
      exerciseIsTimed={pe.exercise.isTimed}
      exerciseDiscipline={pe.exercise.discipline}
      sets={pe.programSets}
      isWorkout={false}
      initialEditing={edit === "true"}
      overloadIncrementKg={pe.overloadIncrementKg != null ? Number(pe.overloadIncrementKg) : null}
      overloadIncrementReps={Number(pe.overloadIncrementReps ?? 0)}
      progressionAdvance={pe.progressionAdvance}
      progressionRequiredHits={pe.progressionRequiredHits}
      progressionScope={pe.progressionScope}
      progressionRegress={pe.progressionRegress}
      progressionBackoffPct={pe.progressionBackoffPct}
      progressionBackoffAfter={pe.progressionBackoffAfter}
      progressionReadiness={pe.progressionReadiness}
      progressionApplyToPlan={pe.progressionApplyToPlan}
      progressionSuppressEffortPrompt={pe.progressionSuppressEffortPrompt}
      exerciseTypeDefault={pe.exercise.exerciseType}
      notes={pe.notes}
      exerciseTypeOverride={pe.exerciseType}
      equipment={pe.exercise.equipment}
      weightStack={pe.weightStack}
      footer={
        sport && plain ? (
          <Link href={`/programs/${programId}/exercises/${peId}?steps=1`} className="mt-2 mb-4 block w-full min-h-11 rounded-xl bg-muted px-3 py-3 text-center text-sm font-semibold text-primary active:opacity-70" data-testid="edit-as-steps">
            Edit as steps
          </Link>
        ) : undefined
      }
    />
  );
}
