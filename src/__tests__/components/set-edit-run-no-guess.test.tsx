// @vitest-environment jsdom
import { NewSetView } from "@/components/features/NewSetView";
import { SetEditView } from "@/components/features/SetEditView";
import type { ProgramSet } from "@/types/workout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Set editing without the 5 km guess (docs/plans/run-logger.md, step 1): a
 * run set with no distance once opened on 5 km, so a 75 min set read as
 * 15:00 /km. A run set with neither distance nor time now opens on time, and
 * the distance field starts empty.
 */

const updateProgramSet = vi.fn();
const addProgramSet = vi.fn();
vi.mock("@/contexts/user-settings-context", () => ({ useUnits: () => ({ distance: "km", swim: "m" }) }));
vi.mock("@/contexts/workout-session-context", () => ({
  useOverridesReady: () => true,
  useWorkoutSession: () => null,
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(async () => ({ success: true })) }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({
  updateProgramSet: (...a: unknown[]) => updateProgramSet(...a),
  addProgramSet: (...a: unknown[]) => addProgramSet(...a),
  setProgramExerciseType: vi.fn(),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  updateWorkoutSetNotes: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/actions/custom-weights", () => ({ logCustomWeight: vi.fn() }));

const emptyRun = {
  id: 7,
  programExerciseId: 9,
  setNumber: 1,
  targetReps: null,
  weightKg: "0",
  setType: "working",
  restTimeSeconds: 0,
  durationSeconds: null,
  distanceMeters: null,
  peakDistanceMeters: null,
  peakDurationSeconds: null,
  inclinePercent: null,
  targetHeartRateZone: null,
  targetRir: null,
} as unknown as ProgramSet;

beforeEach(() => {
  Element.prototype.scrollTo = () => {};
  updateProgramSet.mockReset();
  updateProgramSet.mockResolvedValue({ success: true, data: {} });
  addProgramSet.mockReset();
  addProgramSet.mockResolvedValue({ success: true, data: {} });
});

describe("SetEditView for a run set with no distance and no time", () => {
  it("opens on time, and the distance field starts empty, so nothing saves a guessed 5 km", async () => {
    render(<SetEditView back={{ href: "/programs/1/exercises/9", label: "Sets" }} set={emptyRun} isRunning discipline="run" />);
    expect(screen.queryByLabelText("Distance in km")).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Distance" }));
    expect((screen.getByLabelText("Distance in km") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Distance in km"), { target: { value: "8" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(updateProgramSet.mock.calls[0][0].distanceMeters).toBe(8000);
  });

  it("a run set with a distance still opens on it", () => {
    render(<SetEditView back={{ href: "/programs/1/exercises/9", label: "Sets" }} set={{ ...emptyRun, distanceMeters: 10000 } as ProgramSet} isRunning discipline="run" />);
    expect((screen.getByLabelText("Distance in km") as HTMLInputElement).value).toBe("10");
  });
});

describe("NewSetView for the first run set", () => {
  it("opens on time, and the distance field starts empty", () => {
    render(<NewSetView programId={1} programExerciseId={9} exerciseId={3} nextSetNumber={1} isRunning discipline="run" />);
    const values = () => (screen.queryAllByRole("textbox") as HTMLInputElement[]).map((i) => i.value);
    expect(values()).not.toContain("5");
    fireEvent.click(screen.getByRole("button", { name: "Distance" }));
    expect(values()).toContain("");
    expect(values()).not.toContain("5");
  });
});
