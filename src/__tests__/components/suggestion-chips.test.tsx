// @vitest-environment jsdom
import { WorkoutSetsList } from "@/components/features/WorkoutSetsList";
import type { ProgressionScope } from "@/lib/utils/progression";
import type { ProgramSet, SetSuggestion } from "@/types/workout";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the set rows say about a suggestion, and which set the effort prompt
 * asks about. The engine's verdicts are unit-tested; this is the layer that
 * turns them into words a lifter acts on.
 */

let completedSetIds = new Set<number>();
vi.mock("@/contexts/workout-session-context", () => ({
  useWorkoutSession: () => ({
    sessionId: 1,
    overrides: {},
    completedSetIds,
    restTimerEnds: {},
    setOverride: vi.fn(),
    addCompletedSet: vi.fn(),
    removeCompletedSet: vi.fn(),
    setRestTimerEnd: vi.fn(),
    clearRestTimerEnd: vi.fn(),
  }),
  useRenderedOverrides: () => ({}),
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(), unlogWithRetry: vi.fn() }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({ reorderProgramSets: vi.fn(), updateProgramSet: vi.fn() }));
vi.mock("@/lib/actions/workout-sets", () => ({}));

function makeSet(id: number, overrides: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id,
    programExerciseId: 9,
    setNumber: id,
    targetReps: 8,
    weightKg: "80.00",
    setType: "working",
    restTimeSeconds: 0,
    durationSeconds: null,
    distanceMeters: null,
    targetRir: null,
    ...overrides,
  } as unknown as ProgramSet;
}

function suggestion(overrides: Partial<SetSuggestion> = {}): SetSuggestion {
  return {
    suggestedWeightKg: 82.5,
    basedOnWeightKg: 80,
    basedOnReps: 8,
    basedOnFeeling: "Good",
    basedOnDate: "2026-10-20",
    reason: "progressed",
    hitsAchieved: 2,
    hitsRequired: 2,
    sessionsUntilDeload: null,
    estimated1RM: null,
    readinessModulated: false,
    ...overrides,
  };
}

function mount(
  sets: ProgramSet[],
  suggestions: Record<number, SetSuggestion> = {},
  progressionScope: ProgressionScope = "all",
) {
  render(
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
      progressionScope={progressionScope}
    />,
  );
}

beforeEach(() => {
  completedSetIds = new Set();
});

describe("suggestion chips", () => {
  it("offers a bump with an up arrow", () => {
    mount([makeSet(1)], { 1: suggestion() });
    expect(screen.getByText(/↑ 82\.5kg/)).toBeTruthy();
  });

  it("names a back-off after misses as a back-off", () => {
    mount([makeSet(1)], { 1: suggestion({ reason: "deload", suggestedWeightKg: 72.5 }) });
    expect(screen.getByText(/72\.5kg — back off/)).toBeTruthy();
  });

  it("names a low-readiness cut as today only, not as a back-off", () => {
    mount([makeSet(1)], {
      1: suggestion({ reason: "deload", suggestedWeightKg: 72.5, readinessModulated: true }),
    });
    expect(screen.getByText(/72\.5kg — lighter today/)).toBeTruthy();
    expect(screen.queryByText(/back off/)).toBeNull();
  });

  it("says a low-readiness hold is a hold, not a reduction", () => {
    mount([makeSet(1)], {
      1: suggestion({ reason: "held-readiness", suggestedWeightKg: 80, readinessModulated: true }),
    });
    expect(screen.getByText("Holding today for low readiness")).toBeTruthy();
    expect(screen.queryByText(/reduced|adjusted/)).toBeNull();
  });

  it("ticks a re-approach once it has been taken, like every other chip", () => {
    mount([makeSet(1, { weightKg: "72.50" })], {
      1: suggestion({ reason: "re-approach", suggestedWeightKg: 72.5 }),
    });
    expect(screen.getByText(/✓ 72\.5kg — back after a break/)).toBeTruthy();
  });

  it("reads last time's effort back as reps in reserve", () => {
    mount([makeSet(1)], { 1: suggestion({ basedOnRpe: 8 }) });
    expect(screen.getByText("Last: 80kg (Good, 2 RIR)")).toBeTruthy();
  });

  it("labels the one-miss-from-back-off marker", () => {
    mount([makeSet(1)], { 1: suggestion({ reason: "held", sessionsUntilDeload: 1 }) });
    expect(screen.getByRole("img", { name: "One more miss backs off the weight" })).toBeTruthy();
  });
});

describe("effort prompt", () => {
  const capped = () => [1, 2, 3].map((id) => makeSet(id, { targetRir: 2 }));

  it("asks about set 1 under scope first, as soon as it is logged", () => {
    completedSetIds = new Set([1]);
    mount(capped(), {}, "first");
    expect(screen.getByText("Set 1 — how much was left?")).toBeTruthy();
  });

  it("waits for the last working set under scope all", () => {
    completedSetIds = new Set([1]);
    mount(capped(), {}, "all");
    expect(screen.queryByText(/how much was left/)).toBeNull();
  });

  it("asks about the last working set under scope all once it is logged", () => {
    completedSetIds = new Set([1, 2, 3]);
    mount(capped(), {}, "all");
    expect(screen.getByText("Set 3 — how much was left?")).toBeTruthy();
  });
});
