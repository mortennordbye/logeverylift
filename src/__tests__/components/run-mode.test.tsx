// @vitest-environment jsdom
import { RunMode } from "@/components/features/run/RunMode";
import { armRide } from "@/components/features/bike/useRide";
import type { RideView } from "@/lib/actions/rides";
import { rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Run mode (docs/plans/run-logger.md, 4.3 to 4.6, section 5 "Run mode"):
 * fake timers drive the clock and a small fake server answers, as in
 * ride-mode.test.tsx. Each assertion is on what the runner sees and what is sent.
 */

vi.mock("@/lib/audio-cues", () => ({ playCue: () => true, unlockAudio: () => true }));
vi.mock("@/lib/wake-lock", () => ({ wakeLockSupported: () => true, requestWakeLock: async () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/programs/1/workout/exercises/2" }));
const logWithRetry = vi.fn();
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry, unlogWithRetry: vi.fn() }),
  usePendingQueue: () => ({ enqueue: vi.fn() }),
}));
vi.mock("@/contexts/workout-session-context", () => ({ useWorkoutSession: () => ({ sessionId: 7, clearActiveWorkout: vi.fn(), addCompletedSet: vi.fn() }) }));
const sendRideEvent = vi.fn();
const getRide = vi.fn();
vi.mock("@/lib/actions/rides", () => ({ sendRideEvent: (d: unknown) => sendRideEvent(d), getRide: (d: unknown) => getRide(d) }));
vi.mock("@/lib/actions/workout-sessions", () => ({ completeWorkoutSession: vi.fn() }));
vi.mock("@/lib/push-client", () => ({ detectStepAlerts: vi.fn(), turnOnStepAlerts: vi.fn() }));

const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
const OWNER = { run_threshold_pace: 1000 / 339, lthr_run: 180 };

function workout(steps: unknown[]) {
  const p = parseWorkout({ v: 2, sport: "run", name: "Run", steps });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.workout;
}
const treadmillRun = workout([
  { type: "warmup", end: { type: "time", seconds: 600 }, belt: 7.5 },
  { type: "work", end: { type: "time", seconds: 600 }, belt: 8 },
]);
const outdoorRun = workout([
  { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
  { type: "recovery", end: { type: "time", seconds: 60 } },
]);

type Ev = RideView["events"][number];
let events: Ev[];
let seq: number;
let plan: RidePlan;
/** When the run's clock starts: after T0 for a run that is still in its 5 s count. */
let startAt = T0;

function view(): RideView {
  const now = Date.now();
  const t = rideTimeline(plan, events, now);
  return {
    ride: { id: 5, sessionId: 7, programExerciseId: 2, sport: "run", mode: plan.mode, surface: null, endReason: null, brickRideId: null, status: t.status, seq, startedAt: startAt, endedAt: t.endedAt, heartbeatAt: null },
    plan,
    events: [...events],
    serverNow: now,
  };
}

function serve(p: RidePlan) {
  plan = p;
  seq = 1;
  events = [{ seq: 1, kind: "start", value: null, at: startAt, clientId: "start" }];
  sendRideEvent.mockImplementation(async (d: { kind: Ev["kind"] | "heartbeat"; clientId: string; value?: number; clientAt?: number; stepKey?: string }) => {
    if (d.kind !== "heartbeat" && !events.some((e) => e.clientId === d.clientId)) {
      events.push({ seq: ++seq, kind: d.kind as Ev["kind"], value: d.value ?? null, at: Math.min(d.clientAt ?? Date.now(), Date.now()), clientId: d.clientId, stepKey: d.stepKey ?? null });
    }
    return { success: true, data: view() };
  });
  getRide.mockImplementation(async () => ({ success: true, data: view() }));
}

async function open(armed = true) {
  if (armed) armRide();
  render(<RunMode exerciseId={3} initial={view()} setNumbers={{}} onlyExercise={false} sessionCompleted={false} workoutHref="/programs/1/workout" brick={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  startAt = T0;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(T0 + 30_000);
  localStorage.clear();
  sendRideEvent.mockReset();
  getRide.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("run mode on a treadmill", () => {
  it("two belt taps within 2 s send one event with the last value; Undo in the burst sends nothing", async () => {
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.5 km/h" }));
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.5 km/h" }));
    expect(screen.getByTestId("run-belt").textContent).toBe("8.5");
    expect(screen.getByTestId("ride-toast").textContent).toBe("Belt 8.5 km/hUndo");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(events.filter((e) => e.kind === "belt").map((e) => [e.value, e.stepKey])).toEqual([[85, plan.steps[0].key]]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Belt down 0.5 km/h" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(events.filter((e) => e.kind === "belt").map((e) => e.value)).toEqual([85]);
    expect(screen.getByTestId("run-belt").textContent).toBe("8.5");
  });

  it("the pace follows the belt on screen while a burst is still open", async () => {
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open();
    expect(screen.getByTestId("run-second").textContent).toContain("8:00 /km");
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.5 km/h" }));
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.5 km/h" }));
    expect(screen.getByTestId("run-second").textContent).toContain("7:03 /km");
  });

  it("the incline buttons are 64 px controls, as the belt's are", async () => {
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open();
    for (const name of ["Incline down 0.5%", "Incline up 0.5%", "Belt down 0.5 km/h", "Belt up 0.5 km/h"]) expect(screen.getByRole("button", { name }).className).toContain("min-h-16");
  });

  it("the Next card keeps its grey in the last minute: the accent is for the cue only", async () => {
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    vi.setSystemTime(T0 + 560_000);
    await open();
    expect(screen.getByTestId("ride-next").className).not.toContain("bg-brand");
  });

  it("a belt set by feel has nothing to go back to: its toast has no Undo once the burst is sent", async () => {
    const byFeel = workout([{ type: "work", end: { type: "time", seconds: 600 } }]);
    serve(buildRunPlan(byFeel, [11], OWNER, "indoor"));
    await open();
    expect(screen.getByTestId("run-belt").textContent).toBe("By feel");
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.5 km/h" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(events.filter((e) => e.kind === "belt").map((e) => e.value)).toEqual([80]);
    expect(screen.getByTestId("ride-toast").textContent).toBe("Belt 8.0 km/h");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo of an incline that was not known sends 0%, the incline the screen showed", async () => {
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Incline up 0.5%" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(events.filter((e) => e.kind === "incline").map((e) => e.value)).toEqual([5, 0]);
    expect(screen.getByTestId("run-incline").textContent).toBe("Incline 0%");
  });

  it("opened again during the 5 s count: the count shows, not Resume or End at the last step", async () => {
    vi.setSystemTime(T0 + 10_000_000);
    startAt = Date.now() + 3_000;
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open(false);
    expect(screen.getByTestId("run-count")).toBeTruthy();
    expect(screen.queryByTestId("ride-prompt")).toBeNull();
  });

  it("a step with no incline shows Incline 0%, not a blank", async () => {
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open();
    expect(screen.getByTestId("run-incline").textContent).toBe("Incline 0%");
  });

  it("offline: Saved on this phone is a line of its own, and the total stays in the header", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    serve(buildRunPlan(treadmillRun, [11, 12], OWNER, "indoor"));
    await open();
    expect(screen.getByTestId("ride-offline").textContent).toBe("Saved on this phone");
    expect(screen.getByTestId("ride-total").textContent).toMatch(/^0:30 of 20:00$/);
  });
});

describe("run mode in a strides block", () => {
  it("hold to skip names the strides, as it skips the rest of the block", async () => {
    const strides = workout([{ type: "repeat", count: 2, steps: [{ type: "work", end: { type: "time", seconds: 20 }, belt: 13 }, { type: "recovery", end: { type: "time", seconds: 40 }, belt: 7 }] }]);
    serve(buildRunPlan(strides, [11, 12, 13, 14], OWNER, "indoor"));
    vi.setSystemTime(T0 + 5_000);
    await open();
    expect(screen.getByRole("button", { name: "Hold to skip the strides" }).textContent).toBe("Hold to skipstrides");
  });
});

describe("run mode outdoors", () => {
  it("with Lap, +1 min sits in a row of its own, so the bottom row holds three controls", async () => {
    serve(buildRunPlan(outdoorRun, [11, 12], OWNER, "outdoor"));
    await open();
    const bottom = screen.getByRole("button", { name: "Pause" }).parentElement!;
    expect(within(bottom).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Hold to skip step 1", "Pause", "Lap"]);
    expect(screen.getByRole("button", { name: "Add 1 min" })).toBeTruthy();
  });

  it("a target in words wraps in a smaller size, so Easy jog or walk fits a 320 px phone", async () => {
    serve(buildRunPlan(outdoorRun, [11, 12], OWNER, "outdoor"));
    vi.setSystemTime(T0 + 610_000);
    await open();
    const value = screen.getByTestId("run-target-value");
    expect(value.textContent).toBe("Easy jog or walk");
    expect(value.parentElement!.className).not.toContain("whitespace-nowrap");
  });

  it("locks the controls 10 s after the last tap, and a hold unlocks them", async () => {
    serve(buildRunPlan(outdoorRun, [11, 12], OWNER, "outdoor"));
    await open();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("run-lock")).toBeTruthy();
    const unlock = screen.getByRole("button", { name: "Hold to unlock the controls" });
    fireEvent.pointerDown(unlock);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(screen.queryByTestId("run-lock")).toBeNull();
  });
});
