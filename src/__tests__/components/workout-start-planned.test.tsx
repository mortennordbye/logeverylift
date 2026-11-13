// @vitest-environment jsdom
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting a workout for one of several sessions of a day
 * (docs/plans/sessions.md, 3.3): the Start link carries ?planned=<id>, and
 * the new session names it. Without the parameter, or with a make-up, the
 * request is the same as before C2.
 */

const createWorkoutSession = vi.fn();
vi.mock("@/lib/actions/workout-sessions", () => ({
  createWorkoutSession: (...a: unknown[]) => createWorkoutSession(...a),
  isSessionResumable: vi.fn().mockResolvedValue({ success: true, data: true }),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  getActiveSessionCompletedProgramSetIds: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));
vi.mock("@/contexts/workout-session-context", () => ({
  ACTIVE_WORKOUT_TTL_MS: 12 * 60 * 60 * 1000,
  useWorkoutSession: () => ({ sessionId: null, programId: null, setActiveWorkout: vi.fn(), hydrateCompletedSetIds: vi.fn() }),
}));
let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));

beforeEach(() => {
  localStorage.clear();
  createWorkoutSession.mockReset();
  createWorkoutSession.mockResolvedValue({ success: true, data: { id: 11 } });
});

async function start() {
  await act(async () => {
    render(<WorkoutSessionInitializer programId={7} timeZone={null} planVersion={1} />);
  });
  return createWorkoutSession.mock.calls[0][0] as Record<string, unknown>;
}

describe("WorkoutSessionInitializer and planned sessions", () => {
  it("sends the planned session from the link", async () => {
    search = "planned=42";
    expect(await start()).toMatchObject({ programId: 7, plannedSessionId: 42 });
  });

  it("sends no planned session without the parameter, as before", async () => {
    search = "";
    const payload = await start();
    expect(Object.keys(payload).sort()).toEqual(["date", "intendedDate", "programId", "startTime"]);
  });

  it("ignores a planned parameter that is not a number, and keeps a make-up's date", async () => {
    search = "planned=abc&makeup=2026-11-02";
    const payload = await start();
    expect(payload.plannedSessionId).toBeUndefined();
    expect(payload.intendedDate).toBe("2026-11-02");
  });
});
