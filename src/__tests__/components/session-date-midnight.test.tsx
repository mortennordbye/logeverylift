// @vitest-environment jsdom
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { toDateStr } from "@/lib/utils/cycle-position";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The date a new workout session is logged on, near midnight. It must be the
 * day in the user's stored zone, the same day the server calls today
 * (src/lib/utils/user-date.ts); with no zone, the phone's own day as before.
 */

const createWorkoutSession = vi.fn();
vi.mock("@/lib/actions/workout-sessions", () => ({
  createWorkoutSession: (...a: unknown[]) => createWorkoutSession(...a),
  isSessionResumable: vi.fn(),
}));
vi.mock("@/lib/actions/workout-sets", () => ({
  getActiveSessionCompletedProgramSetIds: vi.fn(),
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

const NOW = new Date("2026-11-02T23:30:00Z"); // Monday 23:30 UTC, Tuesday 00:30 in Oslo

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  createWorkoutSession.mockReset();
  createWorkoutSession.mockResolvedValue({ success: true, data: { id: 1 } });
});

afterEach(() => {
  vi.useRealTimers();
});

async function startedDate(timeZone: string | null): Promise<string> {
  await act(async () => {
    render(<WorkoutSessionInitializer programId={7} timeZone={timeZone} planVersion={null} />);
  });
  expect(createWorkoutSession).toHaveBeenCalledTimes(1);
  return createWorkoutSession.mock.calls[0][0].date;
}

describe("the date a workout starts on, near midnight", () => {
  it("is the next day for a user in Oslo at 23:30 UTC", async () => {
    expect(await startedDate("Europe/Oslo")).toBe("2026-11-03");
  });

  it("is the same day for a user in New York", async () => {
    expect(await startedDate("America/New_York")).toBe("2026-11-02");
  });

  it("is the phone's own day when no zone is stored", async () => {
    expect(await startedDate(null)).toBe(toDateStr(NOW));
  });
});
