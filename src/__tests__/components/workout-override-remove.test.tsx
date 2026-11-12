// @vitest-environment jsdom
import { WorkoutSessionProvider, useWorkoutSession } from "@/contexts/workout-session-context";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A set deleted mid-workout drops its override, so the finish flush does not
 * write to a set that is gone (docs/plans/revisions.md, 2.7).
 */

vi.mock("@/lib/actions/workout-sessions", () => ({ setSessionReadiness: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ requestNotificationPermission: vi.fn(), scheduleRestNotification: vi.fn() }));

// The probe hands the context out through a ref object, the pattern the lint
// rule allows, so the test can call it.
const probe: { current: ReturnType<typeof useWorkoutSession> } = { current: null };
function Probe() {
  const value = useWorkoutSession();
  useEffect(() => {
    probe.current = value;
  });
  return null;
}

beforeEach(() => localStorage.clear());

describe("removeOverride", () => {
  it("forgets one set's override and keeps the others", async () => {
    render(
      <WorkoutSessionProvider>
        <Probe />
      </WorkoutSessionProvider>,
    );
    await act(async () => {
      probe.current!.setOverride(3, { targetReps: 8, weightKg: 65 });
      probe.current!.setOverride(4, { targetReps: 8, weightKg: 70 });
    });
    await act(async () => probe.current!.removeOverride(3));
    expect(Object.keys(probe.current!.overrides)).toEqual(["4"]);
    expect(Object.keys(JSON.parse(localStorage.getItem("workoutOverrides") ?? "{}"))).toEqual(["4"]);
  });
});
