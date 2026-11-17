/**
 * Workout Exercise Sets Page
 */

import { BikeExercise } from "@/components/features/bike/BikeExercise";
import { RideMode } from "@/components/features/bike/RideMode";
import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { bikeExerciseView, rideOfExercise } from "@/lib/bike-exercise-view";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { syncActiveCyclePeriodization } from "@/lib/actions/training-cycles";
import { getProgressiveSuggestions } from "@/lib/actions/workout-sets";
import { stepLabels } from "@/lib/program-steps-view";
import type { StepRow } from "@/lib/utils/program-steps";
import { getUserSettings } from "@/lib/user-settings";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string; programExerciseId: string }>;
  searchParams: Promise<{ hand?: string; ride?: string }>;
};

export default async function WorkoutExerciseSetsPage({ params, searchParams }: Props) {
  const [{ id, programExerciseId }, { hand, ride }] = await Promise.all([params, searchParams]);
  const programId = Number(id);
  const peId = Number(programExerciseId);
  if (isNaN(programId) || isNaN(peId)) notFound();

  const { user } = await requireSession();
  // A PWA restored straight onto an exercise skips the workout page, so this
  // page runs the weekly sync before reading the sets too (PZ-29).
  await syncActiveCyclePeriodization();
  const [result, suggestionsResult, labels] = await Promise.all([
    getProgramWithExercises(programId),
    getProgressiveSuggestions(programId),
    stepLabels(user.id, peId),
  ]);
  if (!result.success) notFound();

  const program = result.data;
  const pe = program.programExercises.find((e) => e.id === peId);
  if (!pe) notFound();

  // A bike exercise of an endurance user is a ride (docs/plans/bike-ride-logger.md,
  // steps 2 and 3). "Log by hand" (?hand=1) keeps today's set list until step 4.
  // Ride mode (?ride=1) runs the user's ride of this exercise; with none, the bike screen shows.
  if (pe.exercise.discipline === "bike" && hand !== "1" && (await enduranceEnabledFor(user.id))) {
    const onlyExercise = program.programExercises.length === 1;
    if (ride === "1") {
      const [found, { units }] = await Promise.all([rideOfExercise(user.id, peId), getUserSettings(user.id)]);
      if (found) {
        const setNumbers = Object.fromEntries(pe.programSets.map((s) => [s.id, s.setNumber]));
        return (
          <RideMode
            exerciseId={pe.exercise.id}
            initial={found.view}
            setNumbers={setNumbers}
            onlyExercise={onlyExercise}
            sessionCompleted={found.sessionCompleted}
            units={units}
          />
        );
      }
    }
    const bike = await bikeExerciseView(user.id, peId, pe.exercise.name, pe.programSets as (StepRow & { id: number })[]);
    if (bike) return <BikeExercise programId={programId} programExerciseId={peId} exerciseName={pe.exercise.name} data={bike} onlyExercise={onlyExercise} />;
  }

  const suggestions = suggestionsResult.success ? suggestionsResult.data : {};

  return (
    <WorkoutSetsClient
      programId={programId}
      programExerciseId={peId}
      exerciseName={pe.exercise.name}
      exerciseId={pe.exercise.id}
      sets={pe.programSets}
      isWorkout={true}
      exerciseCategory={pe.exercise.category ?? undefined}
      exerciseIsTimed={pe.exercise.isTimed}
      exerciseDiscipline={pe.exercise.discipline}
      suggestions={suggestions}
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
      stepLabels={labels}
    />
  );
}
