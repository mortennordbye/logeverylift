// @vitest-environment jsdom
import { SetEditView } from "@/components/features/SetEditView";
import type { ProgramSet } from "@/types/workout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Correcting reps during a workout. The reps field records what was done and
 * the plan's target stands, so a short set reaches the engine as a miss. A
 * separate, explicit toggle covers the other case: the program itself is
 * wrong and its target should change.
 */

const setOverride = vi.fn();
const updateProgramSet = vi.fn();
vi.mock("@/contexts/workout-session-context", () => ({
  useOverridesReady: () => true,
  useWorkoutSession: () => ({
    sessionId: 1,
    overrides: {},
    completedSetIds: new Set<number>(),
    setOverride,
  }),
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(async () => ({ success: true })) }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({
  updateProgramSet: (...a: unknown[]) => updateProgramSet(...a),
  setProgramExerciseType: vi.fn(),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  updateWorkoutSetNotes: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/actions/custom-weights", () => ({ logCustomWeight: vi.fn() }));

const set = {
  id: 5,
  programExerciseId: 9,
  setNumber: 1,
  targetReps: 8,
  weightKg: "80.00",
  setType: "working",
  restTimeSeconds: 90,
  durationSeconds: null,
  distanceMeters: null,
  targetRir: null,
} as unknown as ProgramSet;

function mount() {
  render(<SetEditView set={set} isWorkout exerciseId={2} setNumber={1} />);
}

async function pickReps(n: number) {
  fireEvent.click(screen.getByRole("button", { name: /Reps done/ }));
  fireEvent.click(screen.getByRole("button", { name: String(n) }));
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

beforeEach(() => {
  // The pickers centre their selection on open; jsdom has no layout to scroll.
  Element.prototype.scrollTo = () => {};
  setOverride.mockReset();
  updateProgramSet.mockReset();
  updateProgramSet.mockResolvedValue({ success: true, data: {} });
});

describe("SetEditView — reps done during a workout", () => {
  it("records a short set against the target that stands, and leaves the plan alone", async () => {
    mount();
    await pickReps(6);
    await save();

    expect(setOverride).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ targetReps: 8, actualReps: 6 }),
    );
    expect(updateProgramSet).not.toHaveBeenCalled();
  });

  it("shows no target toggle while the reps match the plan", () => {
    mount();
    expect(screen.queryByRole("switch", { name: /change the program target/ })).toBeNull();
  });

  it("changes the program target too when asked to", async () => {
    mount();
    await pickReps(6);
    fireEvent.click(screen.getByRole("switch", { name: /change the program target to 6/ }));
    await save();

    expect(setOverride).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ targetReps: 6, actualReps: 6 }),
    );
    expect(updateProgramSet).toHaveBeenCalledWith({ id: 5, targetReps: 6 });
  });
});
