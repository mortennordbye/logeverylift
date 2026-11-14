// @vitest-environment jsdom
import { SetEditView } from "@/components/features/SetEditView";
import type { Units } from "@/lib/utils/units";
import type { ProgramSet } from "@/types/workout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Display units (src/lib/utils/units.ts) in the set editor: the distance shows
 * and is typed in the user's units, and what reaches the server is meters.
 */

const updateProgramSet = vi.fn();
let units: Units = { distance: "mi", swim: "yd" };
vi.mock("@/contexts/user-settings-context", () => ({ useUnits: () => units }));
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
  setProgramExerciseType: vi.fn(),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  updateWorkoutSetNotes: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/actions/custom-weights", () => ({ logCustomWeight: vi.fn() }));

const run = (o: Record<string, unknown> = {}) =>
  ({
    id: 7,
    programExerciseId: 9,
    setNumber: 1,
    targetReps: null,
    weightKg: "0",
    setType: "working",
    restTimeSeconds: 0,
    durationSeconds: null,
    distanceMeters: 5000,
    peakDistanceMeters: null,
    peakDurationSeconds: null,
    inclinePercent: null,
    targetHeartRateZone: null,
    targetRir: null,
    ...o,
  }) as unknown as ProgramSet;

beforeEach(() => {
  Element.prototype.scrollTo = () => {};
  units = { distance: "mi", swim: "yd" };
  updateProgramSet.mockReset();
  updateProgramSet.mockResolvedValue({ success: true, data: {} });
});

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

describe("SetEditView in miles", () => {
  it("shows a 5 km run as 3.11 mi and saves it back unchanged as 5000 m", async () => {
    render(<SetEditView back={{ href: "/programs/1/workout/exercises/1", label: "Sets" }} set={run()} isRunning />);
    const field = screen.getByLabelText("Distance in mi") as HTMLInputElement;
    expect(field.value).toBe("3.11");
    await save();
    expect(updateProgramSet.mock.calls[0][0].distanceMeters).toBe(5000);
  });

  it("saves a typed distance in miles as meters", async () => {
    render(<SetEditView back={{ href: "/programs/1/workout/exercises/1", label: "Sets" }} set={run()} isRunning />);
    fireEvent.change(screen.getByLabelText("Distance in mi"), { target: { value: "6.2" } });
    await save();
    expect(updateProgramSet.mock.calls[0][0].distanceMeters).toBe(9978);
  });

  it("keeps kilometers for a user on metric units", async () => {
    units = { distance: "km", swim: "m" };
    render(<SetEditView back={{ href: "/programs/1/workout/exercises/1", label: "Sets" }} set={run()} isRunning />);
    expect((screen.getByLabelText("Distance in km") as HTMLInputElement).value).toBe("5");
    await save();
    expect(updateProgramSet.mock.calls[0][0].distanceMeters).toBe(5000);
  });
});
