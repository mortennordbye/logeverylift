// @vitest-environment jsdom
import { RideMode } from "@/components/features/bike/RideMode";
import { armRide } from "@/components/features/bike/useRide";
import type { RideView } from "@/lib/actions/rides";
import { RIDE_QUEUE_KEY } from "@/components/features/bike/useRide";
import { buildRidePlan, rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ride mode (docs/plans/bike-ride-logger.md, section 5 "Ride mode", 4.4,
 * 4.5): a timer screen like the guided player, so fake timers drive the
 * clock, the server actions are a small fake server, and every assertion is
 * on what the rider sees and what is sent.
 */

const playCue = vi.fn();
vi.mock("@/lib/audio-cues", () => ({ playCue: (k: string) => playCue(k), unlockAudio: () => true }));
const requestWakeLock = vi.fn();
vi.mock("@/lib/wake-lock", () => ({ wakeLockSupported: () => true, requestWakeLock: () => requestWakeLock() }));
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }), usePathname: () => "/programs/1/workout/exercises/2" }));
const logWithRetry = vi.fn();
const unlogWithRetry = vi.fn();
const enqueue = vi.fn();
vi.mock("@/contexts/pending-queue-context", () => ({
  useWorkoutSetWriter: () => ({ logWithRetry, unlogWithRetry }),
  usePendingQueue: () => ({ enqueue }),
}));
const clearActiveWorkout = vi.fn();
const addCompletedSet = vi.fn();
vi.mock("@/contexts/workout-session-context", () => ({ useWorkoutSession: () => ({ sessionId: 7, clearActiveWorkout, addCompletedSet }) }));
const sendRideEvent = vi.fn();
const getRide = vi.fn();
vi.mock("@/lib/actions/rides", () => ({ sendRideEvent: (d: unknown) => sendRideEvent(d), getRide: (d: unknown) => getRide(d) }));
const completeWorkoutSession = vi.fn();
const detectStepAlerts = vi.fn();
vi.mock("@/lib/push-client", () => ({ detectStepAlerts: (k: string | null) => detectStepAlerts(k), turnOnStepAlerts: vi.fn() }));
vi.mock("@/lib/actions/workout-sessions", () => ({ completeWorkoutSession: (d: unknown) => completeWorkoutSession(d) }));

const T0 = Date.UTC(2026, 10, 17, 17, 0, 0);

const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Upper endurance",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 }, cadence: { low: 85, high: 95 } },
    { type: "recovery", end: { type: "time", seconds: 300 }, free: true },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const workout = parsed.workout;
const plans = {
  indoor: buildRidePlan(workout, [11, 12, 13], { ftp: 180, lthr_bike: 171 }, "indoor"),
  outdoor: buildRidePlan(workout, [11, 12, 13], { ftp: 180, lthr_bike: 171 }, "outdoor"),
};

type Ev = RideView["events"][number];
/** When the ride started: a test far from the others' Start ride taps opens without one. */
let T = T0;
let events: Ev[];
let seq: number;
let plan: RidePlan;

/** The server: stores events with their client time, never in the future, and answers with the ride. */
function view(): RideView {
  const now = Date.now();
  const t = rideTimeline(plan, events, now);
  return {
    ride: { id: 5, sessionId: 7, programExerciseId: 2, mode: plan.mode, status: t.status, seq, startedAt: T, endedAt: t.endedAt, heartbeatAt: null },
    plan,
    events: [...events],
    serverNow: now,
  };
}

function serve(mode: "indoor" | "outdoor" = "indoor") {
  plan = plans[mode];
  seq = 1;
  events = [{ seq: 1, kind: "start", value: null, at: T, clientId: "start" }];
  sendRideEvent.mockImplementation(async (d: { kind: Ev["kind"] | "heartbeat"; clientId: string; value?: number; clientAt?: number }) => {
    if (d.kind !== "heartbeat" && !events.some((e) => e.clientId === d.clientId)) {
      events.push({ seq: ++seq, kind: d.kind as Ev["kind"], value: d.value ?? null, at: Math.min(d.clientAt ?? Date.now(), Date.now()), clientId: d.clientId });
    }
    return { success: true, data: view() };
  });
  getRide.mockImplementation(async () => ({ success: true, data: view() }));
}

/** Time passes one repaint at a time, as in the browser, so each tick renders. */
async function advance(ms: number) {
  let left = ms;
  do {
    const step = Math.min(250, left);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    left -= step;
  } while (left > 0);
}

/** Ride mode opened by the Start ride tap, `seconds` into the ride. */
async function open(seconds = 0, opts: { armed?: boolean; mode?: "indoor" | "outdoor"; pushKey?: string } = {}) {
  vi.setSystemTime(T + seconds * 1000);
  serve(opts.mode);
  if (opts.armed !== false) armRide();
  render(<RideMode exerciseId={3} initial={view()} setNumbers={{ 11: 1, 12: 2, 13: 3 }} onlyExercise sessionCompleted={false} units={{ distance: "km", swim: "m" }} pushPublicKey={opts.pushKey ?? null} workoutHref="/programs/1/workout" />);
  await advance(0);
}

const text = (id: string) => screen.getByTestId(id).textContent;
const sent = () => sendRideEvent.mock.calls.map(([d]) => d).filter((d) => d.kind !== "heartbeat");

beforeEach(() => {
  T = T0;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  detectStepAlerts.mockReset().mockResolvedValue("off");
  for (const f of [unlogWithRetry, playCue, replace, refresh, logWithRetry, enqueue, clearActiveWorkout, sendRideEvent, getRide, completeWorkoutSession]) f.mockReset();
  playCue.mockReturnValue(true);
  requestWakeLock.mockReset().mockResolvedValue({ release: async () => undefined });
  logWithRetry.mockResolvedValue({ success: true });
  completeWorkoutSession.mockResolvedValue({ success: true });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RideMode", () => {
  it("indoors: header, profile, step, clock, watts with cadence and heart rate, and the next step", async () => {
    await open(600 + 198);
    expect(text("ride-header")).toBe("Indoor · step 2 of 3" + "13:18 of 30:00");
    expect(screen.getByTestId("ride-mini-profile")).toBeTruthy();
    expect(text("ride-step-title")).toBe("Work");
    expect(text("ride-clock")).toBe("11:42");
    expect(text("ride-target-value")).toBe("135-146");
    expect(text("ride-second")).toBe("Cadence 85-95HR 139-152");
    expect(text("ride-next")).toContain("Easy · 5 min");
    expect(screen.queryByRole("button", { name: "Lap" })).toBeNull();
    expect(screen.queryByTestId("ride-prompt")).toBeNull();
  });

  it("±5 W changes the target with an undo for 5 s; Undo sends the opposite nudge", async () => {
    await open(700);
    fireEvent.click(screen.getByRole("button", { name: "Target up 5 W" }));
    await advance(0);
    expect(text("ride-target-value")).toBe("140-151");
    expect(text("ride-toast")).toBe("Target 140-151 WUndo");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await advance(0);
    expect(text("ride-target-value")).toBe("135-146");
    expect(sent().map((d) => [d.kind, d.value])).toEqual([
      ["nudge", 5],
      ["nudge", -5],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Target down 5 W" }));
    await advance(0);
    expect(text("ride-toast")).toBe("Target 130-141 WUndo");
    await advance(5_000);
    expect(screen.queryByTestId("ride-toast")).toBeNull();
  });

  it("the undo toast takes the Next card's place below the controls, so a second +5 W tap never lands on Undo", async () => {
    await open(700);
    const up = screen.getByRole("button", { name: "Target up 5 W" });
    fireEvent.click(up);
    await advance(0);
    const toast = screen.getByTestId("ride-toast");
    // Below the ±5 W row in the page, not between it and the target.
    expect(up.compareDocumentPosition(toast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("ride-next")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Target up 5 W" }));
    await advance(0);
    expect(text("ride-target-value")).toBe("145-156");
    await advance(5_000);
    expect(screen.getByTestId("ride-next")).toBeTruthy();
  });

  it("+1 min adds a minute with an undo", async () => {
    await open(700);
    expect(text("ride-clock")).toBe("13:20");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 min" }));
    await advance(0);
    expect(text("ride-clock")).toBe("14:20");
    expect(text("ride-toast")).toBe("+1 minUndo");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await advance(0);
    expect(text("ride-clock")).toBe("13:20");
    expect(sent().map((d) => [d.kind, d.value])).toEqual([
      ["extend", 60],
      ["extend", -60],
    ]);
  });

  it("a step without watts has no ±5 W", async () => {
    await open(1600);
    expect(text("ride-step-title")).toBe("Easy");
    expect(screen.queryByRole("button", { name: "Target up 5 W" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add 1 min" })).toBeTruthy();
  });

  it("skip needs a 600 ms hold, saves the step as skipped, and Undo takes it back", async () => {
    await open(700);
    const hold = screen.getByRole("button", { name: "Hold to skip step 2" });
    fireEvent.pointerDown(hold);
    await advance(400);
    fireEvent.pointerUp(hold);
    await advance(1000);
    expect(text("ride-step-title")).toBe("Work");
    expect(sent()).toEqual([]);

    fireEvent.pointerDown(hold);
    await advance(600);
    expect(text("ride-step-title")).toBe("Easy");
    expect(text("ride-toast")).toBe("SkippedUndo");
    expect(logWithRetry).toHaveBeenCalledWith(expect.objectContaining({ programSetId: 12, setNumber: 2, stepStatus: "skipped", isCompleted: false, durationSeconds: 102 }), { quietOffline: true });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await advance(0);
    expect(text("ride-step-title")).toBe("Work");
    expect(sent().map((d) => d.kind)).toEqual(["skip", "unskip"]);
  });

  it("a step that ends by time saves once as done, with a beep at 3, 2 and 1 and a cue at the change", async () => {
    await open(596);
    expect(logWithRetry).not.toHaveBeenCalled();
    await advance(4_000);
    expect(playCue.mock.calls.filter(([k]) => k === "count")).toHaveLength(3);
    expect(playCue).toHaveBeenLastCalledWith("work");
    expect(text("ride-step-title")).toBe("Work");
    expect(logWithRetry).toHaveBeenCalledTimes(1);
    expect(logWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 7, exerciseId: 3, programSetId: 11, stepStatus: "done", isCompleted: true, durationSeconds: 600, targetOffsetW: 0, extendedSeconds: 0, sources: { durationSeconds: "clock" } }),
      { quietOffline: true },
    );
    await advance(10_000);
    expect(logWithRetry).toHaveBeenCalledTimes(1);
  });

  it("the Next card turns accent in the last minute", async () => {
    await open(600 + 900 - 61);
    expect(screen.getByTestId("ride-next").dataset.lastMinute).toBeUndefined();
    await advance(1_500);
    expect(screen.getByTestId("ride-next").dataset.lastMinute).toBe("true");
  });

  it("paused: Resume, and End ride at the bottom says what it keeps; End ride ends early and finishes the workout", async () => {
    await open(700);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    expect(screen.getByTestId("ride-paused")).toBeTruthy();
    expect(text("ride-header")).toContain("Paused");
    expect(text("ride-kept")).toBe("Steps 1 and 2 are saved. Ending now keeps them.");
    await advance(120_000);
    expect(screen.getByText("Paused 2 min")).toBeTruthy();
    // Push off on the server: no word about alerts.
    expect(screen.queryByText(/alerts stopped/)).toBeNull();
    expect(text("ride-clock")).toBe("13:20");

    fireEvent.click(screen.getByRole("button", { name: "End ride" }));
    await advance(0);
    expect(screen.getByText("Ride ended early")).toBeTruthy();
    expect(logWithRetry).toHaveBeenCalledWith(expect.objectContaining({ programSetId: 12, stepStatus: "partial", durationSeconds: 100 }), { quietOffline: true });
    expect(completeWorkoutSession).toHaveBeenCalledWith({ sessionId: 7, endTime: new Date(T0 + 820_000).toISOString() });
    expect(clearActiveWorkout).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2?results=1");
    // The workout list reads the ridden steps as handled; step 3 was never reached.
    expect(addCompletedSet.mock.calls.map((c) => c[0]).sort()).toEqual([11, 12]);
  });

  it("paused with step alerts on: the line says the alerts stopped", async () => {
    detectStepAlerts.mockResolvedValue("on");
    await open(700, { pushKey: "key" });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    expect(screen.getByText("Paused under 1 min · alerts stopped")).toBeTruthy();
    expect(detectStepAlerts).toHaveBeenCalledWith("key");
  });

  it("outdoors: heart rate as the big number, the power meter below, and Lap", async () => {
    await open(700, { mode: "outdoor" });
    expect(text("ride-header")).toContain("Outdoor · step 2 of 3");
    expect(text("ride-target-value")).toBe("139-152");
    expect(text("ride-target")).toContain("bpm");
    expect(text("ride-second")).toBe("Power meter 135-146 W");
    expect(screen.queryByTestId("ride-mini-profile")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lap" }));
    await advance(0);
    expect(text("ride-step-title")).toBe("Easy");
    expect(logWithRetry).toHaveBeenCalledWith(expect.objectContaining({ programSetId: 12, stepStatus: "partial" }), { quietOffline: true });
  });

  it("offline: a tap applies on screen, says Saved on this phone, survives a reload and sends when online", async () => {
    await open(700);
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    expect(screen.getByTestId("ride-paused")).toBeTruthy();
    expect(text("ride-header")).toContain("Saved on this phone");
    expect(sent()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(RIDE_QUEUE_KEY)!)["5"]).toEqual([expect.objectContaining({ kind: "pause", clientAt: T0 + 700_000 })]);

    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent().map((d) => [d.kind, d.clientAt])).toEqual([["pause", T0 + 700_000]]);
    expect(localStorage.getItem(RIDE_QUEUE_KEY)).toBeNull();
    expect(text("ride-header")).not.toContain("Saved on this phone");
  });

  it("Ride done offline: Later goes to the workout and keeps the queue", async () => {
    await open(700);
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "End ride" }));
    await advance(0);
    expect(screen.getByTestId("ride-done")).toBeTruthy();
    const later = screen.getByRole("link", { name: "Later" });
    expect(later.getAttribute("href")).toBe("/programs/1/workout");
    // The taps stay on this phone; the next page that opens the ride sends them.
    expect(JSON.parse(localStorage.getItem(RIDE_QUEUE_KEY)!)["5"].map((e: { kind: string }) => e.kind)).toEqual(["pause", "end"]);
    // The screen says the steps wait on the phone; the step saves ask for no offline toast that says it again.
    expect(logWithRetry).toHaveBeenCalled();
    for (const call of logWithRetry.mock.calls) expect(call[1]).toEqual({ quietOffline: true });
    expect(completeWorkoutSession).not.toHaveBeenCalled();
  });

  it("Ride done with a tap still sending shows Later too; once all is sent there is none", async () => {
    await open(700);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    let answer: (v: unknown) => void = () => {};
    sendRideEvent.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    fireEvent.click(screen.getByRole("button", { name: "End ride" }));
    await advance(0);
    expect(screen.getByTestId("ride-done")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Later" })).toBeTruthy();
    events.push({ seq: ++seq, kind: "end", value: null, at: Date.now(), clientId: "end" });
    await act(async () => {
      answer({ success: true, data: view() });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("link", { name: "Later" })).toBeNull();
  });

  it("opened on a running ride without a tap (a reload): Resume or End at the last step", async () => {
    T = T0 + 10 * 3_600_000;
    await open(700, { armed: false });
    expect(screen.getByTestId("ride-prompt")).toBeTruthy();
    expect(text("ride-clock")).toBe("13:20");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await advance(0);
    expect(screen.getByTestId("ride-screen")).toBeTruthy();
    expect(requestWakeLock).toHaveBeenCalled();
  });

  it("End at the last step ends the ride at the step that ran", async () => {
    T = T0 + 10 * 3_600_000;
    await open(700, { armed: false });
    fireEvent.click(screen.getByRole("button", { name: "End at the last step" }));
    await advance(0);
    expect(sent()).toEqual([expect.objectContaining({ kind: "end", clientAt: T + 600_000 })]);
    expect(screen.getByText("Ride ended early")).toBeTruthy();
    // The step that ran is left out: only the warm-up is saved.
    expect(logWithRetry.mock.calls.map(([d]) => [d.programSetId, d.stepStatus])).toEqual([[11, "done"]]);
  });

  it("a heartbeat waits while taps are queued: the queued tap is sent first, at its own time", async () => {
    await open(700);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    // Back online with no online event: the heartbeat tick finds the queue.
    await advance(10_000);
    const kinds = sendRideEvent.mock.calls.map(([d]) => d.kind);
    expect(kinds[0]).toBe("pause");
    expect(sent()).toEqual([expect.objectContaining({ kind: "pause", clientAt: T + 700_000 })]);
  });

  it("a server error keeps the tap queued; only a refusal for good drops it", async () => {
    await open(700);
    sendRideEvent.mockResolvedValueOnce({ success: false, error: "Failed to save the ride" });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    expect(JSON.parse(localStorage.getItem(RIDE_QUEUE_KEY)!)["5"]).toEqual([expect.objectContaining({ kind: "pause" })]);
    expect(text("ride-header")).toContain("Saved on this phone");
    expect(screen.getByTestId("ride-paused")).toBeTruthy();

    // Four conflicts in a row: still kept.
    sendRideEvent.mockResolvedValue({ success: false, error: "The ride changed on another device" });
    await advance(30_000);
    expect(JSON.parse(localStorage.getItem(RIDE_QUEUE_KEY)!)["5"]).toHaveLength(1);

    // The ride has ended: dropped.
    sendRideEvent.mockResolvedValue({ success: false, error: "The ride has ended" });
    await advance(30_000);
    expect(localStorage.getItem(RIDE_QUEUE_KEY)).toBeNull();
  });

  it("the clock never steps back when a slow reply moves the offset, and each count beeps once", async () => {
    await open(596);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    // A reply that took 2 s says the server is 1 s behind this phone.
    getRide.mockImplementationOnce(async () => {
      const v = view();
      await new Promise((r) => setTimeout(r, 2_000));
      return { success: true, data: { ...v, serverNow: v.serverNow - 1_000 } };
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const seen: string[] = [];
    for (let i = 0; i < 16; i++) {
      await advance(250);
      seen.push(text("ride-clock")!);
    }
    const secs = seen.map((c) => Number(c.split(":")[1]) + Number(c.split(":")[0]) * 60);
    // Remaining time only goes down within the step (then the next step starts at 15:00).
    const warm = secs.filter((x) => x < 100);
    expect(warm).toEqual([...warm].sort((a, b) => b - a));
    const counts = playCue.mock.calls.filter(([k]) => k === "count");
    expect(counts).toHaveLength(3);
  });

  it("Undo of a skip on the last step brings the ride back before it is finished", async () => {
    await open(1700);
    expect(text("ride-step-title")).toBe("Easy");
    const hold = screen.getByRole("button", { name: "Hold to skip step 3" });
    fireEvent.pointerDown(hold);
    await advance(600);
    expect(screen.getByTestId("ride-done")).toBeTruthy();
    expect(text("ride-toast")).toBe("SkippedUndo");
    expect(completeWorkoutSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await advance(0);
    expect(text("ride-step-title")).toBe("Easy");
    expect(sent().map((d) => d.kind)).toEqual(["skip", "unskip"]);
    await advance(6_000);
    expect(completeWorkoutSession).not.toHaveBeenCalled();
  });

  it("without an undo, the ride finishes 5 s after a skip of the last step", async () => {
    await open(1700);
    const hold = screen.getByRole("button", { name: "Hold to skip step 3" });
    fireEvent.pointerDown(hold);
    await advance(600);
    expect(completeWorkoutSession).not.toHaveBeenCalled();
    await advance(5_000);
    expect(completeWorkoutSession).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2?results=1");
  });

  it("a skip taken back on another device removes the skipped row this phone saved", async () => {
    await open(700);
    const hold = screen.getByRole("button", { name: "Hold to skip step 2" });
    fireEvent.pointerDown(hold);
    await advance(600);
    expect(logWithRetry).toHaveBeenCalledWith(expect.objectContaining({ programSetId: 12, stepStatus: "skipped" }), { quietOffline: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await advance(0);
    expect(unlogWithRetry).toHaveBeenCalledWith({ sessionId: 7, exerciseId: 3, setNumber: 2, programSetId: 12 });
  });

  it("hold to skip stops when the finger slides off the button", async () => {
    await open(700);
    const hold = screen.getByRole("button", { name: "Hold to skip step 2" });
    hold.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(hold);
    // jsdom has no PointerEvent with coordinates: a mouse event of the same name carries them.
    act(() => {
      hold.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 300, clientY: 25 }));
    });
    await advance(1000);
    expect(text("ride-step-title")).toBe("Work");
  });

  it("two tabs: a write keeps the other tab's queued taps", async () => {
    await open(700);
    localStorage.setItem(RIDE_QUEUE_KEY, JSON.stringify({ 5: [{ clientId: "other-tab", kind: "nudge", value: 5, clientAt: T + 699_000 }] }));
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    const stored = JSON.parse(localStorage.getItem(RIDE_QUEUE_KEY)!)["5"].map((q: { clientId: string }) => q.clientId);
    expect(stored).toContain("other-tab");
    expect(stored).toHaveLength(2);
  });
  // Last: a stale bundle marks this module's page as reloading for good.
  it("a stale bundle keeps the tap queued for the next page", async () => {
    await open(700);
    sendRideEvent.mockRejectedValueOnce(Object.assign(new Error('Server Action "x" was not found on the server'), { name: "UnrecognizedActionError" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(0);
    expect(JSON.parse(localStorage.getItem(RIDE_QUEUE_KEY)!)["5"]).toEqual([expect.objectContaining({ kind: "pause" })]);
    expect(text("ride-header")).toContain("Saved on this phone");
  });
});
