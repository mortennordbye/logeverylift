// @vitest-environment jsdom
import { GuidedPlayer } from "@/components/features/guided/GuidedPlayer";
import { toPlaySteps, type PlayerSession, type PlayerStepView } from "@/components/features/guided/types";
import { PLAYER_STORAGE_KEY, finish, initialState, serializePlayerState, start } from "@/lib/utils/workout-player";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guided player (docs/plans/endurance-app.md, 3), a timer like the rest
 * and exercise timers: fake timers drive the clock, the audio and wake lock
 * modules are mocked, and every assertion is on what the user sees.
 */

const playCue = vi.fn();
const unlockAudio = vi.fn();
vi.mock("@/lib/audio-cues", () => ({
  playCue: (k: string) => playCue(k),
  unlockAudio: () => unlockAudio(),
}));
const release = vi.fn();
const requestWakeLock = vi.fn();
let wakeLockSupported = true;
vi.mock("@/lib/wake-lock", () => ({
  wakeLockSupported: () => wakeLockSupported,
  requestWakeLock: () => requestWakeLock(),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const T0 = Date.parse("2027-03-01T07:00:00Z");

function step(key: string, type: PlayerStepView["type"], seconds: number | null, text: string, target: string | null = null): PlayerStepView {
  return {
    key,
    type,
    round: null,
    seconds,
    text,
    targetText: target,
    targetLow: null,
    targetHigh: null,
    targetUnit: null,
    plannedMeters: null,
    distanceText: null,
    note: null,
    stroke: null,
    sendOff: false,
  };
}

const session: PlayerSession = {
  plannedSessionId: 41,
  workoutHash: "abc12345",
  name: "Short ride",
  sport: "bike",
  poolLengthM: null,
  steps: [
    step("s1", "warmup", 10, "10 s warm-up", "125-175 W"),
    step("s2", "work", 5, "5 s 88-93% FTP", "220-233 W"),
    step("s3", "cooldown", null, "to lap cool-down"),
  ],
};

const time = () => screen.getByTestId("player-time").textContent;
const stepCount = () => screen.getByTestId("player-step-count").textContent;

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function startPlayer() {
  render(<GuidedPlayer session={session} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  playCue.mockReset().mockReturnValue(true);
  unlockAudio.mockReset().mockReturnValue(true);
  release.mockReset().mockResolvedValue(undefined);
  // A new handle on each request, as the browser gives.
  requestWakeLock.mockReset().mockImplementation(async () => ({ release }));
  wakeLockSupported = true;
  push.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GuidedPlayer", () => {
  it("shows the ready screen, and Start unlocks sound in the tap and asks for the wake lock", async () => {
    await startPlayer();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    expect(stepCount()).toBe("Step 1 of 3");
    expect(time()).toBe("00:10");
    expect(screen.getByTestId("player-target").textContent).toBe("125-175 W");
    expect(screen.getByTestId("player-next").textContent).toContain("5 s 88-93% FTP");
  });

  it("counts down with one beep each at 3, 2 and 1, and the next step starts exactly on time with a work cue", async () => {
    await startPlayer();
    await advance(7_000);
    expect(time()).toBe("00:03");
    await advance(2_000);
    expect(time()).toBe("00:01");
    expect(playCue.mock.calls.filter(([k]) => k === "count")).toHaveLength(3);
    await advance(750);
    expect(time()).toBe("00:01");
    expect(playCue.mock.calls.filter(([k]) => k === "count")).toHaveLength(3);
    // The step ends on time: the next one shows at the end, no hold on 00:00.
    await advance(250);
    expect(stepCount()).toBe("Step 2 of 3");
    expect(time()).toBe("00:05");
    expect(playCue).toHaveBeenLastCalledWith("work");
    expect(screen.getByTestId("player-announce").textContent).toBe("Work: 5 s 88-93% FTP, 220-233 W");
  });

  it("pause freezes the time; resume goes on from there", async () => {
    await startPlayer();
    await advance(4_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(60_000);
    expect(time()).toBe("00:06");
    expect(stepCount()).toBe("Step 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await advance(3_000);
    expect(time()).toBe("00:03");
  });

  it("+30 s adds time and Skip moves on", async () => {
    await startPlayer();
    fireEvent.click(screen.getByRole("button", { name: "+30 s" }));
    await advance(300);
    expect(time()).toBe("00:40");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await advance(300);
    expect(stepCount()).toBe("Step 2 of 3");
  });

  it("a lap step counts up and waits for Lap; the last Lap finishes and opens the results", async () => {
    await startPlayer();
    await advance(15_000);
    expect(stepCount()).toBe("Step 3 of 3");
    expect(screen.queryByRole("button", { name: "+30 s" })).toBeNull();
    await advance(20_000);
    expect(time()).toBe("00:20");
    fireEvent.click(screen.getByRole("button", { name: "Lap" }));
    await act(async () => {});
    expect(push).toHaveBeenCalledWith("/planned/41/results?from=player");
    expect(release).toHaveBeenCalled();
    const saved = JSON.parse(localStorage.getItem(PLAYER_STORAGE_KEY)!);
    expect(saved.status).toBe("finished");
    expect(saved.runs.map((r: { key: string; activeSeconds: number }) => [r.key, r.activeSeconds])).toEqual([
      ["s1", 10],
      ["s2", 5],
      ["s3", 20],
    ]);
  });

  it("after the app was suspended, a visibilitychange catches up and says how many steps passed", async () => {
    await startPlayer();
    // iOS suspends timers: move the wall clock without running them.
    vi.setSystemTime(T0 + 16_000);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(stepCount()).toBe("Step 3 of 3");
    expect(screen.getByTestId("steps-passed").textContent).toBe("2 steps passed while the app was closed");
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    // One cue for the change, no countdown beeps replayed.
    expect(playCue.mock.calls.filter(([k]) => k === "count")).toHaveLength(0);
  });

  it("shows the hint when there is no wake lock, and the sound bar when a cue cannot play", async () => {
    wakeLockSupported = false;
    playCue.mockReturnValue(false);
    await startPlayer();
    expect(screen.getByTestId("wake-lock-hint")).toBeTruthy();
    await advance(10_500);
    expect(screen.getByTestId("sound-off")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sound-off"));
    expect(unlockAudio).toHaveBeenCalledTimes(2);
  });

  it("a reload resumes the saved run at the right time", async () => {
    const steps = toPlaySteps(session.steps);
    const s = start(initialState({ plannedSessionId: 41, workoutHash: "abc12345", clientKey: "key12345" }), steps, T0 - 12_000);
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
    render(<GuidedPlayer session={session} />);
    await act(async () => {});
    await advance(300);
    expect(stepCount()).toBe("Step 2 of 3");
    expect(time()).toBe("00:03");
  });

  // Review fix 10: a finished, unsaved run is never replaced by a new Start without an explicit Discard.
  it("a finished, unsaved run of another session blocks Start until it is saved or discarded", async () => {
    const steps = toPlaySteps(session.steps);
    let other = start(initialState({ plannedSessionId: 77, workoutHash: "zzz00000", clientKey: "key77777" }), steps, T0 - 60_000);
    other = finish(other, steps, T0 - 30_000);
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(other));
    render(<GuidedPlayer session={session} />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: "Save its results" }).getAttribute("href")).toBe("/planned/77/results?from=player");
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    // Re-review 1: one tap only asks; the run goes on the confirm.
    fireEvent.click(screen.getByRole("button", { name: "Discard it" }));
    expect(localStorage.getItem(PLAYER_STORAGE_KEY)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("button", { name: "Discard the run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard it" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard the run" }));
    expect(localStorage.getItem(PLAYER_STORAGE_KEY)).toBeNull();
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a finished, unsaved run of this session's older workout routes to its results", async () => {
    const steps = toPlaySteps(session.steps);
    let s = start(initialState({ plannedSessionId: 41, workoutHash: "old00000", clientKey: "key12345" }), steps, T0 - 60_000);
    s = finish(s, steps, T0 - 30_000);
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
    render(<GuidedPlayer session={session} />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: "Save its results" }).getAttribute("href")).toBe("/planned/41/results?from=player");
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Review fix 12: one wake lock at a time.
  it("releases the old wake lock on each resync, releases a late one after finish, and asks again after a reload", async () => {
    await startPlayer();
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    expect(requestWakeLock).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledTimes(3);

    // A request that resolves after the run finished is released at once.
    let resolveLate: (h: { release: () => Promise<void> }) => void = () => {};
    const lateRelease = vi.fn().mockResolvedValue(undefined);
    requestWakeLock.mockImplementationOnce(() => new Promise((r) => (resolveLate = r)));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Finish" }));
    expect(push).toHaveBeenCalledWith("/planned/41/results?from=player");
    await act(async () => {
      resolveLate({ release: lateRelease });
    });
    expect(lateRelease).toHaveBeenCalledTimes(1);
  });

  it("asks for the wake lock after a reload during a run", async () => {
    const steps = toPlaySteps(session.steps);
    const s = start(initialState({ plannedSessionId: 41, workoutHash: "abc12345", clientKey: "key12345" }), steps, T0 - 2_000);
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
    render(<GuidedPlayer session={session} />);
    await act(async () => {});
    expect(requestWakeLock).toHaveBeenCalledTimes(1);
  });

  // Review fix 13: a double tap closes one step.
  it("a double tap on Skip skips one step", async () => {
    await startPlayer();
    const skip = screen.getByRole("button", { name: "Skip" });
    // Two taps before React renders again: both run the handler of the same screen.
    await act(async () => {
      skip.click();
      skip.click();
    });
    expect(stepCount()).toBe("Step 2 of 3");
  });

  // Review fix 14: a step that ended before Pause still cues.
  it("Pause after a step ended plays the change cue", async () => {
    await startPlayer();
    playCue.mockClear();
    vi.setSystemTime(T0 + 10_100);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => {});
    expect(stepCount()).toBe("Step 2 of 3");
    expect(playCue).toHaveBeenCalledWith("work");
  });

  it("a saved run of an older workout is not resumed, and says so", async () => {
    const steps = toPlaySteps(session.steps);
    const s = start(initialState({ plannedSessionId: 41, workoutHash: "old00000", clientKey: "key12345" }), steps, T0 - 2_000);
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
    render(<GuidedPlayer session={session} />);
    await act(async () => {});
    expect(screen.getByTestId("player-ready").textContent).toContain("older version of this workout");
  });
});
