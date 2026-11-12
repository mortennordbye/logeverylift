// @vitest-environment jsdom
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workout keeps the program version it started on (docs/plans/revisions.md,
 * 2.7). The finish flush sends it, so the server can tell the plan changed
 * under the workout. A resumed workout must keep the old version, not take
 * today's, or a change made during the workout would look like the base.
 */

const createWorkoutSession = vi.fn();
const isSessionResumable = vi.fn();
vi.mock("@/lib/actions/workout-sessions", () => ({
  createWorkoutSession: (...a: unknown[]) => createWorkoutSession(...a),
  isSessionResumable: (...a: unknown[]) => isSessionResumable(...a),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  getActiveSessionCompletedProgramSetIds: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));
const setActiveWorkout = vi.fn();
vi.mock("@/contexts/workout-session-context", () => ({
  ACTIVE_WORKOUT_TTL_MS: 12 * 60 * 60 * 1000,
  useWorkoutSession: () => ({
    sessionId: null,
    programId: null,
    setActiveWorkout,
    hydrateCompletedSetIds: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  localStorage.clear();
  setActiveWorkout.mockReset();
  createWorkoutSession.mockReset();
  createWorkoutSession.mockResolvedValue({ success: true, data: { id: 11 } });
  isSessionResumable.mockReset();
  isSessionResumable.mockResolvedValue({ success: true, data: true });
});

describe("WorkoutSessionInitializer and the plan version", () => {
  it("starts a new workout on the program's current version", async () => {
    await act(async () => {
      render(<WorkoutSessionInitializer programId={7} timeZone={null} planVersion={4} />);
    });
    expect(setActiveWorkout).toHaveBeenCalledWith(7, expect.any(String), 11, 4);
  });

  it("resumes a workout on the version it started on, not today's", async () => {
    localStorage.setItem(
      "activeWorkout",
      JSON.stringify({ programId: 7, startTime: new Date().toISOString(), sessionId: 11, planVersion: 2 }),
    );
    await act(async () => {
      render(<WorkoutSessionInitializer programId={7} timeZone={null} planVersion={5} />);
    });
    expect(setActiveWorkout).toHaveBeenCalledWith(7, expect.any(String), 11, 2);
    expect(createWorkoutSession).not.toHaveBeenCalled();
  });
});
