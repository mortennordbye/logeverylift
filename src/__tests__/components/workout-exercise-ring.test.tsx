// @vitest-environment jsdom
import { WorkoutExerciseList } from "@/components/features/WorkoutExerciseList";
import type { ProgramSet } from "@/types/workout";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The exercise ring on the workout page (docs/plans/bike-ride-logger.md, step 4
 * review): a ride's bike exercise opens the exercise; the ring of a lift logs
 * and un-logs its sets in bulk, which the server guards for step rows.
 */

const logWithRetry = vi.fn();
const unlogWithRetry = vi.fn();
vi.mock("@/contexts/pending-queue-context", () => ({ useWorkoutSetWriter: () => ({ logWithRetry, unlogWithRetry }) }));
let completed = new Set<number>();
const addCompletedSet = vi.fn((id: number) => completed.add(id));
const removeCompletedSet = vi.fn();
vi.mock("@/contexts/workout-session-context", () => ({
  useWorkoutSession: () => ({ sessionId: 7, completedSetIds: completed, overrides: {}, addCompletedSet, removeCompletedSet }),
  useRenderedOverrides: () => ({}),
}));
vi.mock("@/contexts/user-settings-context", () => ({ useUnits: () => ({ distance: "km", swim: "m" }) }));

const set = (id: number, extra: Partial<ProgramSet> = {}) =>
  ({ id, setNumber: id, targetReps: 5, weightKg: "100", restTimeSeconds: 90, durationSeconds: null, distanceMeters: null, stepKind: null, ...extra }) as unknown as ProgramSet;

beforeEach(() => {
  vi.clearAllMocks();
  completed = new Set();
  logWithRetry.mockResolvedValue({ success: true, data: {} });
});

describe("WorkoutExerciseList ring", () => {
  it("a ride's bike exercise: the ring opens the exercise and logs nothing", () => {
    completed = new Set([1, 2]);
    render(
      <WorkoutExerciseList
        programId={4}
        exercises={[{ id: 9, exerciseId: 3, name: "Bike", isRunning: true, discipline: "bike", opensExercise: true, sets: [set(1, { stepKind: "work" }), set(2, { stepKind: "recovery" })], stepSummary: "2 steps" }]}
      />,
    );
    const ring = screen.getByRole("link", { name: "Open Bike" });
    expect(ring.getAttribute("href")).toBe("/programs/4/workout/exercises/9");
    fireEvent.click(ring);
    expect(logWithRetry).not.toHaveBeenCalled();
    expect(unlogWithRetry).not.toHaveBeenCalled();
  });

  it("a lift: the ring logs its sets in bulk, so the server leaves step rows alone", () => {
    render(<WorkoutExerciseList programId={4} exercises={[{ id: 8, exerciseId: 2, name: "Squat", sets: [set(1), set(2)] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Squat as done" }));
    expect(logWithRetry).toHaveBeenCalledTimes(2);
    expect(logWithRetry.mock.calls.every((c) => c[0].bulk === true)).toBe(true);
  });
});
