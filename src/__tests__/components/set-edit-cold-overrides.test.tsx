// @vitest-environment jsdom
import { SetEditView } from "@/components/features/SetEditView";
import { WorkoutSessionProvider } from "@/contexts/workout-session-context";
import type { ProgramSet } from "@/types/workout";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A cold load of a set's edit URL: the provider restores the overrides from
 * localStorage in its mount effect, which runs after the editor's state
 * initialisers. The editor must still show the corrected values, not the plan.
 */

vi.mock("@/lib/actions/workout-sessions", () => ({ setSessionReadiness: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ requestNotificationPermission: vi.fn(), scheduleRestNotification: vi.fn() }));
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry: vi.fn(async () => ({ success: true })) }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/programs", () => ({ updateProgramSet: vi.fn(), setProgramExerciseType: vi.fn() }));
vi.mock("@/lib/actions/workout-sets", () => ({ updateWorkoutSetNotes: vi.fn(async () => ({ success: true })) }));
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

beforeEach(() => {
  localStorage.clear();
  // What the session stored after the lifter corrected this set.
  localStorage.setItem(
    "workoutOverrides",
    JSON.stringify({ [set.id]: { targetReps: 8, weightKg: 82.5, actualReps: 6, notes: "belt on" } }),
  );
});

describe("SetEditView on a cold load", () => {
  it("shows the stored override, not the plan", async () => {
    render(
      <WorkoutSessionProvider>
        <SetEditView back={{ href: "/programs/1/workout/exercises/9", label: "Sets" }} set={set} isWorkout exerciseId={2} setNumber={1} />
      </WorkoutSessionProvider>,
    );
    expect(await screen.findByRole("button", { name: /^Weight \(kg\)\s*82\.5(\s|$)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Reps done\s*6$/ })).toBeTruthy();
    expect(screen.getByDisplayValue("belt on")).toBeTruthy();
  });
});
