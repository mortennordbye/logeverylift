// @vitest-environment jsdom
import { SetEditView } from "@/components/features/SetEditView";
import type { ProgramSet } from "@/types/workout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A timed set can plan a load (a weighted hold), and saving it from the
 * program editor writes that load alongside the time.
 */

const updateProgramSet = vi.fn();
vi.mock("@/contexts/workout-session-context", () => ({
  useOverridesReady: () => true,
  useWorkoutSession: () => null,
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
  targetReps: null,
  weightKg: "20.00",
  setType: "working",
  restTimeSeconds: 60,
  durationSeconds: 30,
  startDelaySeconds: null,
  distanceMeters: null,
  targetRir: null,
} as unknown as ProgramSet;

beforeEach(() => {
  Element.prototype.scrollTo = () => {};
  updateProgramSet.mockReset();
  updateProgramSet.mockResolvedValue({ success: true, data: {} });
});

describe("SetEditView — a weighted timed set", () => {
  it("shows the load and writes it with the time", async () => {
    render(<SetEditView set={set} isTimed />);
    expect(screen.getByRole("button", { name: /Weight \(kg\)/ }).textContent).toContain("20");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(updateProgramSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, durationSeconds: 30, weightKg: 20 }),
    );
  });
});
