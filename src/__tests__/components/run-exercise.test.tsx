// @vitest-environment jsdom
import { RunExercise } from "@/components/features/run/RunExercise";
import type { RunExerciseData } from "@/lib/run-exercise-view";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { needsThresholdPace, plannedRunNumbers, runChart, runStepRows } from "@/lib/utils/run-view";
import { flattenWorkout } from "@/lib/utils/workout-player";
import { parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";
import { BASE_RUN, OWNER } from "@/__tests__/fixtures/base-run";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The run exercise screen (docs/plans/run-logger.md, section 5, step 2). */

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
vi.mock("@/contexts/workout-session-context", () => ({ useWorkoutSession: () => ({ sessionId: 7 }) }));
const startRide = vi.fn();
const getRide = vi.fn();
const sendRideEvent = vi.fn();
vi.mock("@/lib/actions/rides", () => ({ startRide: (d: unknown) => startRide(d), getRide: (d: unknown) => getRide(d), sendRideEvent: (d: unknown) => sendRideEvent(d) }));
vi.mock("@/lib/audio-cues", () => ({ playCue: () => true, unlockAudio: () => true }));
vi.mock("@/lib/push-client", () => ({ detectStepAlerts: async () => "off", turnOnStepAlerts: async () => ({ state: "on" }) }));
vi.mock("@/lib/wake-lock", () => ({ wakeLockSupported: () => true, requestWakeLock: async () => ({ release: async () => undefined }) }));

const parsed = parseWorkout(BASE_RUN);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const baseWorkout = parsed.workout;

function data(thresholds: ThresholdValues, p: Partial<RunExerciseData> = {}, workout: Workout = baseWorkout): RunExerciseData {
  const ids = flattenWorkout(workout).map((_, i) => i + 1);
  const view = (mode: "indoor" | "outdoor", surface: "road" | "trail" = "road") => {
    const plan = buildRunPlan(workout, ids, thresholds, mode, { surface });
    return { numbers: plannedRunNumbers(plan), chart: runChart(plan), rows: runStepRows(plan, surface) };
  };
  return {
    defaultMode: "indoor",
    treadmill: view("indoor"),
    road: view("outdoor"),
    trail: view("outdoor", "trail"),
    thresholdPace: thresholds.run_threshold_pace ?? null,
    lthr: thresholds.lthr_run ?? null,
    paceSteps: needsThresholdPace(workout),
    liveRun: false,
    otherLive: null,
    ...p,
  };
}

const screenOf = (d: RunExerciseData) => render(<RunExercise programId={1} programExerciseId={2} exerciseName="Run" data={d} pushPublicKey={null} />);
const details = () => screen.getAllByTestId("run-step-detail").map((t) => t.textContent);

beforeEach(() => {
  replace.mockReset();
  startRide.mockReset();
});

describe("RunExercise", () => {
  it("on a treadmill: the line under the title, the chart, the numbers and the belt on every step", () => {
    screenOf(data(OWNER));
    expect(screen.getByTestId("run-summary").textContent).toBe("75 min · load about 70 · threshold 5:39 /km");
    expect(screen.getByTestId("run-mode").textContent).toBe("Treadmill");
    expect(screen.getByTestId("ride-profile")).toBeTruthy();
    expect(screen.getByTestId("run-stats").textContent).toBe("10.1km est.70load50 minin Z2");
    expect(screen.getByTestId("run-zones")).toBeTruthy();
    expect(details()).toEqual(["Belt 7.5 km/h · incline 1%", "HR under 160 · start 8.2 km/h", "30 s · 13.0 km/h · 1:30 easy between", "Walk 5.5 km/h"]);
    expect(screen.queryByTestId("no-threshold-pace")).toBeNull();
    // A treadmill keeps the phone on the console: no alerts row (4.6 is outdoor).
    expect(screen.queryByTestId("step-alerts")).toBeNull();
  });

  describe("mode default (R4)", () => {
    it("opens in the mode the server chose, and Change opens a sheet with both modes", () => {
      screenOf(data(OWNER, { defaultMode: "outdoor" }));
      expect(screen.getByTestId("run-mode").textContent).toBe("Outdoor");
      expect(screen.getByTestId("run-summary").textContent).toBe("75 min · load about 70 · LTHR 180");
      expect(details()).toEqual(["HR under 151", "HR under 160", "30 s · Fast and relaxed · 1:30 easy between", "Effort 1-2"]);
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      const sheet = screen.getByTestId("run-mode-sheet");
      expect(sheet.querySelector("[aria-pressed=true]")!.textContent).toBe("Outdoor");
      fireEvent.click(screen.getByRole("button", { name: "Treadmill" }));
      expect(screen.getByTestId("run-mode").textContent).toBe("Treadmill");
      expect(details()[0]).toBe("Belt 7.5 km/h · incline 1%");
    });

    it("outdoors: the surface choice, Road first, and the alerts-off row with what to do (4.6)", () => {
      screenOf(data(OWNER, { defaultMode: "outdoor" }));
      expect(screen.getByRole("button", { name: "Road" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Trail or snow" }));
      expect(screen.getByRole("button", { name: "Trail or snow" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("step-alerts").textContent).toBe("Step alerts are off · Keep the screen on for beeps, or follow your watch");
    });

    it("Start run starts the run in the chosen mode and surface and opens run mode", async () => {
      startRide.mockResolvedValue({ success: true, data: {} });
      screenOf(data(OWNER, { defaultMode: "outdoor" }));
      fireEvent.click(screen.getByRole("button", { name: "Trail or snow" }));
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2?ride=1"));
      expect(startRide).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 7, programExerciseId: 2, mode: "outdoor", surface: "trail" }));
    });

    it("on a treadmill Start run sends no surface, and Log by hand opens the set list", async () => {
      startRide.mockResolvedValue({ success: false, error: "A ride is already running" });
      screenOf(data(OWNER));
      expect(screen.getByRole("link", { name: "Log by hand" }).getAttribute("href")).toBe("/programs/1/workout/exercises/2?hand=1");
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      expect((await screen.findByRole("alert")).textContent).toBe("A ride is already running");
      expect(startRide.mock.calls[0][0]).not.toHaveProperty("surface");
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe("no threshold pace", () => {
    it("on a treadmill: a way to set it, and a heart rate step with no start speed", () => {
      screenOf(data({ lthr_run: 180 }));
      expect(screen.getByTestId("no-threshold-pace").textContent).toBe("Set your threshold paceto see belt speedsSet pace".replace("paceto", "pace to"));
      expect(screen.getByRole("link", { name: "Set pace" }).getAttribute("href")).toBe("/more/account/training-numbers");
      expect(details()[1]).toBe("HR under 160 · set the belt by feel");
      expect(screen.getByTestId("run-summary").textContent).toBe("75 min · load about 70 · LTHR 180");
    });

    it("outdoors only when a step has a pace target", () => {
      const { unmount } = screenOf(data({ lthr_run: 180 }, { defaultMode: "outdoor" }));
      expect(screen.queryByTestId("no-threshold-pace")).toBeNull();
      unmount();
      const pct = parseWorkout({ v: 2, sport: "run", name: "Tempo", steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "threshold_pace", low: 95, high: 100 } }] });
      screenOf(data({ lthr_run: 180 }, { defaultMode: "outdoor" }, pct.ok ? pct.workout : baseWorkout));
      expect(screen.getByTestId("no-threshold-pace").textContent).toContain("Set your threshold pace to see paces");
    });

    it("outdoors a pace written in min/km needs no threshold pace", () => {
      const abs = parseWorkout({ v: 2, sport: "run", name: "Steady", steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "absolute", low: 2.9, high: 3.0 } }] });
      if (!abs.ok) throw new Error("bad workout");
      screenOf(data({ lthr_run: 180 }, { defaultMode: "outdoor" }, abs.workout));
      expect(screen.queryByTestId("no-threshold-pace")).toBeNull();
    });
  });

  it("no LTHR: effort in place of heart rate, and no zone bar", () => {
    screenOf(data({ run_threshold_pace: OWNER.run_threshold_pace }));
    expect(details()[1]).toBe("Effort 3 · start 8.2 km/h");
    expect(screen.queryByTestId("run-zones")).toBeNull();
  });

  it("with this run running: Run running and Resume, no Change and no Log by hand", () => {
    screenOf(data(OWNER, { liveRun: true }));
    expect(screen.getByTestId("run-running").textContent).toBe("Run running");
    expect(screen.getByRole("link", { name: "Resume" }).getAttribute("href")).toBe("/programs/1/workout/exercises/2?ride=1");
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Log by hand" })).toBeNull();
  });

  it("with the run running outdoors: no surface choice, the run keeps the one it started with", () => {
    screenOf(data(OWNER, { liveRun: true, defaultMode: "outdoor" }));
    expect(screen.queryByTestId("run-surface")).toBeNull();
    expect(screen.queryByTestId("step-alerts")).toBeNull();
  });

  it("with a ride running elsewhere: End ride and start run, with the mode still to choose and the way back to the ride", () => {
    screenOf(data(OWNER, { otherLive: { sport: "bike", href: "/programs/9/workout/exercises/8?ride=1", rideId: 8 } }));
    expect(screen.getByTestId("run-running").textContent).toBe("A ride is running");
    expect(screen.getByRole("button", { name: "End ride and start run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the ride" }).getAttribute("href")).toBe("/programs/9/workout/exercises/8?ride=1");
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
  });

  it("with another run running: Resume opens it", () => {
    screenOf(data(OWNER, { otherLive: { sport: "run", href: "/programs/9/workout/exercises/7?ride=1", rideId: 7 } }));
    expect(screen.getByTestId("run-running").textContent).toBe("Another run is running");
    expect(screen.getByRole("link", { name: "Resume" }).getAttribute("href")).toBe("/programs/9/workout/exercises/7?ride=1");
  });
});

describe("End ride and start run, on the phone", () => {
  it("a ride tap still on this phone that cannot be sent: no run starts, and the screen says why", async () => {
    localStorage.setItem("rideEventQueue", JSON.stringify({ 8: [{ clientId: "q1", kind: "pause", clientAt: Date.now() - 5000 }] }));
    getRide.mockResolvedValue({ success: true, data: { ride: { id: 8, seq: 1 }, events: [], plan: { steps: [] }, serverNow: Date.now() } });
    sendRideEvent.mockResolvedValue({ success: false, error: "Couldn't reach the server" });
    screenOf(data(OWNER, { otherLive: { sport: "bike", href: "/programs/9/workout/exercises/8?ride=1", rideId: 8 } }));
    fireEvent.click(screen.getByRole("button", { name: "End ride and start run" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The ride's taps are still on this phone. Go online to end the ride."));
    expect(sendRideEvent).toHaveBeenCalledTimes(1);
    expect(startRide).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("rideEventQueue")!)[8]).toHaveLength(1);
    localStorage.clear();
  });
});
