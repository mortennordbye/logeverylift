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
let overrides: Record<number, object> = {};
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
  overrides = {};
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

describe("progress dots once the advance is taken", () => {
  const label = () =>
    screen.getByRole("button", { name: /^Progress/ }).getAttribute("aria-label");

  it("still shows the run that earned the bump while it is on offer", () => {
    mount([makeSet(1)], { 1: suggestion() });
    expect(label()).toBe("Progress: 2 of 2 sessions");
  });

  it("starts the count again once the bump is taken", () => {
    // The clears at 80kg do not count at 82.5kg (SI-11), so the run is empty.
    mount([makeSet(1, { weightKg: "82.50" })], { 1: suggestion() });
    expect(label()).toBe("Progress: 0 of 2 sessions since the increase");
  });

  it("starts the count again once a rep climb is taken", () => {
    mount([makeSet(1, { targetReps: 9 })], {
      1: suggestion({ reason: "progressed-reps", suggestedWeightKg: 80, suggestedReps: 9 }),
    });
    expect(label()).toBe("Progress: 0 of 2 sessions since the increase");
  });
});

describe("one chip per exercise", () => {
  const three = () => [makeSet(1), makeSet(2), makeSet(3)];
  const same = () => ({ 1: suggestion(), 2: suggestion(), 3: suggestion() });

  it("shows a shared bump once, on the first set, for all of them", () => {
    mount(three(), same());
    const chips = screen.getAllByRole("button", { name: /82\.5kg/ });
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("↑ 82.5kg · all 3 sets");
    // Each set still says what it did last time.
    expect(screen.getAllByText("Last: 80kg (Good)")).toHaveLength(3);
  });

  it("keeps one chip per set when the sets disagree", () => {
    mount(three(), { ...same(), 3: suggestion({ suggestedWeightKg: 85 }) });
    expect(screen.getAllByRole("button", { name: /↑ 82\.5kg$/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /↑ 85kg$/ })).toBeTruthy();
  });

  it("stays live after its own set is logged while another set can still take it", () => {
    completedSetIds = new Set([1]);
    mount(three(), same());
    const chip = screen.getByRole("button", { name: /82\.5kg · all 3 sets/ });
    expect(chip.getAttribute("aria-disabled")).toBe("false");
  });

  it("ticks once every set it covers carries the bump", () => {
    mount(
      [makeSet(1, { weightKg: "82.50" }), makeSet(2, { weightKg: "82.50" }), makeSet(3, { weightKg: "82.50" })],
      same(),
    );
    const chip = screen.getByRole("button", { name: /82\.5kg · all 3 sets/ });
    expect(chip.textContent).toBe("✓ 82.5kg · all 3 sets");
    expect(chip.getAttribute("aria-disabled")).toBe("true");
  });

  it("gives a set edited away from the bump its own chip, and does not wait on it", () => {
    // Set 2 was changed to 81 kg in the set editor: the shared tap will not
    // overwrite it, so the shared chip covers sets 1 and 3 and can tick.
    overrides = { 2: { weightKg: 81 } };
    mount(
      [makeSet(1, { weightKg: "82.50" }), makeSet(2, { weightKg: "81.00" }), makeSet(3, { weightKg: "82.50" })],
      same(),
    );
    expect(screen.getByRole("button", { name: /82\.5kg · all 2 sets/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: /^↑ 82\.5kg$/ })).toBeTruthy();
  });

  it("leaves held sets alone, since there is nothing to apply", () => {
    const held = suggestion({ reason: "held", suggestedWeightKg: 80 });
    mount(three(), { 1: held, 2: held, 3: held });
    expect(screen.getAllByRole("button", { name: /^Progress/ })).toHaveLength(3);
  });
});
