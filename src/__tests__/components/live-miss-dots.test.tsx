// @vitest-environment jsdom
import { WorkoutSetsList } from "@/components/features/WorkoutSetsList";
import type { ProgressionScope } from "@/lib/utils/progression";
import type { ProgramSet, SetSuggestion } from "@/types/workout";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A set logged short mid-workout has to show on the dots at once. The engine
 * only sees completed sessions, so before this the dots stayed full until the
 * next workout and the lifter was told nothing when it happened.
 */

type Override = { targetReps: number; weightKg: number; actualReps?: number; rir?: number };
let completedSetIds = new Set<number>();
let overrides: Record<number, Override> = {};
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("@/contexts/workout-session-context", () => ({
  useWorkoutSession: () => ({
    sessionId: 1,
    overrides,
    completedSetIds,
    restTimerEnds: {},
    setOverride: vi.fn(),
    addCompletedSet: vi.fn(),
    removeCompletedSet: vi.fn(),
    setRestTimerEnd: vi.fn(),
    clearRestTimerEnd: vi.fn(),
  }),
  useRenderedOverrides: () => overrides,
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(), unlogWithRetry: vi.fn() }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({ reorderProgramSets: vi.fn(), updateProgramSet: vi.fn() }));
vi.mock("@/lib/actions/workout-sets", () => ({}));

function makeSet(id: number): ProgramSet {
  return {
    id,
    programExerciseId: 9,
    setNumber: id,
    targetReps: 8,
    weightKg: "20.00",
    setType: "working",
    restTimeSeconds: 0,
    durationSeconds: null,
    distanceMeters: null,
    targetRir: null,
  } as unknown as ProgramSet;
}

const suggestion: SetSuggestion = {
  suggestedWeightKg: 22.5,
  basedOnWeightKg: 20,
  basedOnReps: 8,
  basedOnFeeling: "Good",
  basedOnDate: "2026-10-20",
  reason: "progressed",
  hitsAchieved: 2,
  hitsRequired: 2,
  sessionsUntilDeload: null,
  estimated1RM: null,
  readinessModulated: false,
};

const sets = [makeSet(1), makeSet(2), makeSet(3)];
const suggestions = { 1: suggestion, 2: suggestion, 3: suggestion };

function ui(scope: ProgressionScope = "all") {
  return (
    <WorkoutSetsList
      sets={sets}
      programId={1}
      programExerciseId={9}
      isWorkout
      exerciseId={2}
      sessionId={1}
      suggestions={suggestions}
      onApplySuggestion={vi.fn()}
      onApplyRepSuggestion={vi.fn()}
      progressionScope={scope}
    />
  );
}

function progressLabels() {
  return screen.getAllByRole("button", { name: /^Progress|count starts over/ }).map(
    (b) => b.getAttribute("aria-label"),
  );
}

beforeEach(() => {
  completedSetIds = new Set();
  overrides = {};
  showToast.mockClear();
});

describe("live miss on the progress dots", () => {
  it("keeps the banked count while every logged set met its target", () => {
    completedSetIds = new Set([1, 2]);
    render(ui());
    expect(progressLabels()).toEqual(Array(3).fill("Progress: 2 of 2 sessions"));
  });

  it("empties every set's dots once one set is logged short, and says why", () => {
    const { rerender } = render(ui());
    expect(showToast).not.toHaveBeenCalled();

    completedSetIds = new Set([1, 2, 3]);
    overrides = { 3: { targetReps: 8, weightKg: 20, actualReps: 7 } };
    rerender(ui());

    expect(progressLabels()).toEqual(
      Array(3).fill("Missed this session: count starts over, 0 of 2 sessions"),
    );
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0].message).toBe(
      "Set 3: 7 of 8. Count starts over. Stay at 20kg until every set hits its target in 2 sessions in a row.",
    );
  });

  it("restores the dots when the short set is un-logged, without another toast", () => {
    completedSetIds = new Set([3]);
    overrides = { 3: { targetReps: 8, weightKg: 20, actualReps: 7 } };
    const { rerender } = render(ui());
    // Mounting on a miss that already happened is not news.
    expect(showToast).not.toHaveBeenCalled();

    completedSetIds = new Set();
    rerender(ui());
    expect(progressLabels()).toEqual(Array(3).fill("Progress: 2 of 2 sessions"));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("under scope set, only the set that missed loses its dots", () => {
    completedSetIds = new Set([2]);
    overrides = { 2: { targetReps: 8, weightKg: 20, actualReps: 5 } };
    render(ui("set"));
    expect(progressLabels()).toEqual([
      "Progress: 2 of 2 sessions",
      "Missed this session: count starts over, 0 of 2 sessions",
      "Progress: 2 of 2 sessions",
    ]);
  });
});
