/**
 * Workout Exercise Sets Page
 */

import { BikeExercise } from "@/components/features/bike/BikeExercise";
import { RideMode } from "@/components/features/bike/RideMode";
import { RideResults } from "@/components/features/bike/RideResults";
import { RideSummary } from "@/components/features/bike/RideSummary";
import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { bikeExerciseView, handResultsView, rideAfterView, rideOfExercise } from "@/lib/bike-exercise-view";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { syncActiveCyclePeriodization } from "@/lib/actions/training-cycles";
import { getProgressiveSuggestions } from "@/lib/actions/workout-sets";
import { stepLabels } from "@/lib/program-steps-view";
import type { StepRow } from "@/lib/utils/program-steps";
import { resultSteps, rideSummary } from "@/lib/utils/ride-results";
import { pushPublicKey } from "@/lib/push";
import { getUserSettings } from "@/lib/user-settings";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string; programExerciseId: string }>;
  searchParams: Promise<{ hand?: string; ride?: string; results?: string; mode?: string }>;
};

export default async function WorkoutExerciseSetsPage({ params, searchParams }: Props) {
  const [{ id, programExerciseId }, { hand, ride, results, mode }] = await Promise.all([params, searchParams]);
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
  // steps 2 to 4). Ride mode (?ride=1) runs the user's ride of this exercise;
  // with none, the bike screen shows. After a ride the screen is its summary,
  // and ?results=1 its results table. "Log by hand" (?hand=1) is the results
  // table with no ride.
  if (pe.exercise.discipline === "bike" && (await enduranceEnabledFor(user.id))) {
    const onlyExercise = program.programExercises.length === 1;
    const setNumbers = Object.fromEntries(pe.programSets.map((s) => [s.id, s.setNumber]));
    const sets = pe.programSets as (StepRow & { id: number })[];
    const doneHref = onlyExercise ? "/" : `/programs/${programId}/workout`;
    const [found, { units, timeZone }] = await Promise.all([ride === "1" ? rideOfExercise(user.id, peId) : null, getUserSettings(user.id)]);
    if (found) {
      return (
        <RideMode
          exerciseId={pe.exercise.id}
          initial={found.view}
          setNumbers={setNumbers}
          onlyExercise={onlyExercise}
          sessionCompleted={found.sessionCompleted}
          units={units}
          pushPublicKey={pushPublicKey()}
        />
      );
    }
    const bike = await bikeExerciseView(user.id, peId, pe.exercise.name, sets, pe.rideTest);
    if (bike && hand === "1" && !bike.liveRide) {
      const byHand = await handResultsView(user.id, programId, pe.exercise.name, sets, mode === "outdoor" || mode === "indoor" ? mode : bike.defaultMode);
      if (byHand) {
        return (
          <RideResults
            programId={programId}
            exerciseId={pe.exercise.id}
            steps={resultSteps(byHand.plan, byHand.logs, units)}
            mode={byHand.plan.mode}
            setNumbers={setNumbers}
            sessionId={byHand.sessionId}
            sessionStart={byHand.sessionStart}
            hand
            garminWaiting={false}
            laterHref={doneHref}
            units={units}
          />
        );
      }
    }
    const after = bike?.doneRide ? await rideAfterView(user.id, peId) : null;
    if (after) {
      // Later and Done leave for home or the workout; a workout the ride could not finish yet goes back to the summary's Save the ride.
      const leave = onlyExercise && after.sessionOpen ? `/programs/${programId}/workout/exercises/${peId}` : doneHref;
      if (results === "1") {
        return (
          <RideResults
            programId={programId}
            exerciseId={pe.exercise.id}
            steps={resultSteps(after.plan, after.logs, units)}
            mode={after.plan.mode}
            setNumbers={setNumbers}
            sessionId={after.sessionId}
            hand={false}
            garminWaiting={after.garminWaiting}
            laterHref={leave}
            units={units}
          />
        );
      }
      return (
        <RideSummary
          programId={programId}
          exerciseName={pe.exercise.name}
          doneLine={after.doneLine}
          summary={rideSummary(after.plan, after.logs, units, after.garmin.stream)}
          rideId={after.rideId}
          garmin={{ state: after.garmin.state, candidates: after.garmin.candidates }}
          timeZone={timeZone}
          ftpTest={after.ftpTest}
          doneHref={doneHref}
          saveTheRide={onlyExercise && after.sessionOpen}
        />
      );
    }
    if (bike) return <BikeExercise programId={programId} programExerciseId={peId} exerciseName={pe.exercise.name} data={bike} pushPublicKey={pushPublicKey()} />;
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
