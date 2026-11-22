// @vitest-environment jsdom
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A page that only shows a finished ride or run (its summary, its results
 * table) starts no workout. Ride mode finishes the workout but leaves it
 * stored on the phone, so opening the summary later found a done session and
 * started a new, empty one: the Workout tab then showed a workout in progress.
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
const clearActiveWorkout = vi.fn();
vi.mock("@/contexts/workout-session-context", () => ({
  ACTIVE_WORKOUT_TTL_MS: 12 * 60 * 60 * 1000,
  useWorkoutSession: () => ({ sessionId: null, programId: null, setActiveWorkout, clearActiveWorkout, hydrateCompletedSetIds: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  localStorage.clear();
  setActiveWorkout.mockReset();
  clearActiveWorkout.mockReset();
  createWorkoutSession.mockReset();
  createWorkoutSession.mockResolvedValue({ success: true, data: { id: 12 } });
  isSessionResumable.mockReset();
});

const store = (sessionId: number) =>
  localStorage.setItem("activeWorkout", JSON.stringify({ programId: 7, startTime: new Date().toISOString(), sessionId, planVersion: 1 }));

async function mount(startNew: boolean) {
  await act(async () => {
    render(<WorkoutSessionInitializer programId={7} timeZone={null} planVersion={1} startNew={startNew} />);
  });
}

describe("WorkoutSessionInitializer on a page that only shows a finished workout", () => {
  it("starts no workout when the stored one is done, and clears it", async () => {
    store(101);
    isSessionResumable.mockResolvedValue({ success: true, data: false });
    await mount(false);
    expect(createWorkoutSession).not.toHaveBeenCalled();
    expect(setActiveWorkout).not.toHaveBeenCalled();
    expect(clearActiveWorkout).toHaveBeenCalled();
  });

  it("starts no workout when none is stored", async () => {
    await mount(false);
    expect(createWorkoutSession).not.toHaveBeenCalled();
    expect(setActiveWorkout).not.toHaveBeenCalled();
  });

  it("still resumes a workout that is open", async () => {
    store(102);
    isSessionResumable.mockResolvedValue({ success: true, data: true });
    await mount(false);
    expect(setActiveWorkout).toHaveBeenCalledWith(7, expect.any(String), 102, 1);
    expect(createWorkoutSession).not.toHaveBeenCalled();
  });

  it("a workout page still replaces a done workout with a new one", async () => {
    store(103);
    isSessionResumable.mockResolvedValue({ success: true, data: false });
    await mount(true);
    expect(createWorkoutSession).toHaveBeenCalledTimes(1);
  });
});

describe("WorkoutSessionInitializer on each workout page", () => {
  it("a page opened while the first create is in flight starts no second session", async () => {
    let answer!: (v: unknown) => void;
    createWorkoutSession.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const first = render(<WorkoutSessionInitializer programId={8} timeZone={null} planVersion={1} />);
    first.unmount();
    render(<WorkoutSessionInitializer programId={8} timeZone={null} planVersion={1} />);
    await act(async () => answer({ success: true, data: { id: 13 } }));
    expect(createWorkoutSession.mock.calls.filter(([p]) => (p as { programId: number }).programId === 8)).toHaveLength(1);
  });
});
