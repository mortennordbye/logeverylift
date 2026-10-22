// @vitest-environment jsdom
import { SetEditView } from "@/components/features/SetEditView";
import type { ProgramSet } from "@/types/workout";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The weight sheet offers the weights the exercise's equipment comes in, so a
 * 18 kg dumbbell or a 24 kg kettlebell is a preset, not a typed-in custom value.
 */

vi.mock("@/contexts/workout-session-context", () => ({
  useOverridesReady: () => true,
  useWorkoutSession: () => ({
    sessionId: 1,
    overrides: {},
    completedSetIds: new Set<number>(),
    setOverride: vi.fn(),
  }),
}));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(async () => ({ success: true })) }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({
  updateProgramSet: vi.fn(),
  setProgramExerciseType: vi.fn(),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  updateWorkoutSetNotes: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/actions/custom-weights", () => ({ logCustomWeight: vi.fn() }));

function setWith(weightKg: string) {
  return {
    id: 5,
    programExerciseId: 9,
    setNumber: 1,
    targetReps: 8,
    weightKg,
    setType: "working",
    restTimeSeconds: 90,
    durationSeconds: null,
    distanceMeters: null,
    targetRir: null,
  } as unknown as ProgramSet;
}

function openWeightSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Weight \(kg\)/ }));
}

/** The circle for `kg`, and whether it carries the "custom" caption. */
function circle(kg: number) {
  const button = screen.getAllByRole("button").find((b) => b.textContent?.startsWith(String(kg)) && /kg|custom/.test(b.textContent));
  if (!button) throw new Error(`no ${kg} circle`);
  return { custom: within(button).queryByText("custom") !== null };
}

beforeEach(() => {
  Element.prototype.scrollTo = () => {};
});

describe("SetEditView — weight presets follow the equipment", () => {
  it("offers 18 kg as a dumbbell preset", () => {
    render(<SetEditView set={setWith("18")} isWorkout exerciseId={2} setNumber={1} equipment="dumbbell" />);
    openWeightSheet();
    expect(circle(18).custom).toBe(false);
  });

  it("offers 24 kg as a kettlebell preset", () => {
    render(<SetEditView set={setWith("24")} isWorkout exerciseId={2} setNumber={1} equipment="kettlebell" />);
    openWeightSheet();
    expect(circle(24).custom).toBe(false);
  });

  it("still marks a weight off the equipment's ladder as custom", () => {
    render(<SetEditView set={setWith("17.5")} isWorkout exerciseId={2} setNumber={1} equipment="kettlebell" />);
    openWeightSheet();
    expect(circle(17.5).custom).toBe(true);
  });
});
