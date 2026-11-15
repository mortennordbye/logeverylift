// @vitest-environment jsdom
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { WorkoutSessionProvider, useWorkoutSession } from "@/contexts/workout-session-context";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workout layout pulls the logged sets from the server and replaces the
 * toggles with its answer. The answer is what was saved when the pull ran, so
 * a set toggled while the pull was in flight is missing from it (or still in
 * it, for an un-log). Taking the answer as it is undid the tap on screen while
 * the write went through. e2e/log-set.spec.ts walks the same race in a browser.
 */

const pull = vi.fn();
vi.mock("@/lib/actions/workout-sets", () => ({
  getActiveSessionCompletedProgramSetIds: (...a: unknown[]) => pull(...a),
}));
vi.mock("@/lib/actions/workout-sessions", () => ({
  createWorkoutSession: vi.fn(),
  isSessionResumable: vi.fn().mockResolvedValue({ success: true, data: true }),
  setSessionReadiness: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

let session: ReturnType<typeof useWorkoutSession>;
function Probe() {
  session = useWorkoutSession();
  return <p data-testid="done">{[...(session?.completedSetIds ?? [])].sort((a, b) => a - b).join(",")}</p>;
}

function deferred() {
  let resolve!: (ids: number[]) => void;
  const promise = new Promise<{ success: true; data: number[] }>((r) => {
    resolve = (ids) => r({ success: true, data: ids });
  });
  return { promise, resolve };
}

async function mountWithPullInFlight(serverIds: number[]) {
  const first = deferred();
  pull.mockReturnValueOnce(first.promise);
  await act(async () => {
    render(
      <WorkoutSessionProvider>
        <WorkoutSessionInitializer programId={7} timeZone={null} planVersion={1} />
        <Probe />
      </WorkoutSessionProvider>,
    );
  });
  expect(pull).toHaveBeenCalledWith(11);
  return () => act(async () => first.resolve(serverIds));
}

beforeEach(() => {
  localStorage.clear();
  pull.mockReset();
  localStorage.setItem(
    "activeWorkout",
    JSON.stringify({ programId: 7, startTime: new Date().toISOString(), sessionId: 11, planVersion: 1 }),
  );
});

describe("the logged-sets pull", () => {
  it("keeps a set logged while it was in flight", async () => {
    const answer = await mountWithPullInFlight([1]);
    act(() => session!.addCompletedSet(2));
    await answer();
    expect(screen.getByTestId("done").textContent).toBe("1,2");
  });

  it("keeps a set un-logged while it was in flight", async () => {
    const answer = await mountWithPullInFlight([1, 2]);
    act(() => session!.removeCompletedSet(2));
    await answer();
    expect(screen.getByTestId("done").textContent).toBe("1");
  });

  it("takes the server's answer for sets nobody touched", async () => {
    const answer = await mountWithPullInFlight([3, 4]);
    await answer();
    expect(screen.getByTestId("done").textContent).toBe("3,4");
  });
});
