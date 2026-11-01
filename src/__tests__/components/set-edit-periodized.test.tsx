// @vitest-environment jsdom
import { SetEditView } from "@/components/features/SetEditView";
import type { ProgramSet } from "@/types/workout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving a periodized endurance set from the program editor asks the server to
 * re-anchor its peak from the value saved (PZ-36), instead of leaving the peak
 * for the next weekly sync to overwrite the edit with.
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

const run = (o: Record<string, unknown>) =>
  ({
    id: 7,
    programExerciseId: 9,
    setNumber: 1,
    targetReps: null,
    weightKg: "0",
    setType: "working",
    restTimeSeconds: 0,
    durationSeconds: null,
    distanceMeters: 4000,
    peakDistanceMeters: 5000,
    peakDurationSeconds: null,
    inclinePercent: null,
    targetHeartRateZone: null,
    targetRir: null,
    ...o,
  }) as unknown as ProgramSet;

beforeEach(() => {
  Element.prototype.scrollTo = () => {};
  updateProgramSet.mockReset();
  updateProgramSet.mockResolvedValue({ success: true, data: {} });
});

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

describe("SetEditView — a periodized endurance set", () => {
  it("asks for the distance peak to be re-derived from the saved distance", async () => {
    render(<SetEditView set={run({})} isRunning />);
    await save();
    expect(updateProgramSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, distanceMeters: 4000, anchor: "distance" }),
    );
    expect(updateProgramSet.mock.calls[0][0]).not.toHaveProperty("peakDistanceMeters");
  });

  it("sends no anchor for a set that is not periodized", async () => {
    render(<SetEditView set={run({ peakDistanceMeters: null })} isRunning />);
    await save();
    expect(updateProgramSet.mock.calls[0][0]).not.toHaveProperty("anchor");
  });
});
