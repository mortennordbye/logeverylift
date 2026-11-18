import { describe, expect, it } from "vitest";
import {
  AUTO_END_AFTER_MS,
  buildRidePlan,
  eventTime,
  rideTimeline,
  type RideEventInput,
  type TimelineStep,
} from "@/lib/utils/ride-timeline";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";

/** The ride mode rules of docs/plans/bike-ride-logger.md, 4.3 and 4.4. */

const MIN = 60;
const T0 = Date.UTC(2026, 10, 17, 17, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;

/** The mockup ride: 15, 15, 5, 15 and 15 minutes, every step with power. */
const step = (i: number, seconds: number | null, power = true): TimelineStep => ({
  key: `s${i}`,
  programSetId: 100 + i,
  seconds,
  power: power ? { from: 120, to: 130 } : null,
});
const tempo = { steps: [step(1, 15 * MIN), step(2, 15 * MIN), step(3, 5 * MIN), step(4, 15 * MIN), step(5, 15 * MIN)] };

let seq = 0;
const ev = (kind: RideEventInput["kind"], seconds: number, value?: number): RideEventInput => ({ seq: ++seq, kind, at: at(seconds), ...(value !== undefined && { value }) });
const start = () => ev("start", 0);

describe("rideTimeline", () => {
  it("is ready with no start, and runs the steps by the clock", () => {
    expect(rideTimeline(tempo, [], at(10)).status).toBe("ready");
    const t = rideTimeline(tempo, [start()], at(20 * MIN));
    expect(t.status).toBe("running");
    expect(t.steps.map((s) => [s.key, s.status, s.activeSeconds, s.endedAt])).toEqual([["s1", "done", 900, at(900)]]);
    expect(t.current).toMatchObject({ index: 1, activeSeconds: 300, remainingSeconds: 600, endsAt: at(1800) });
    expect(t.plannedSeconds).toBe(65 * MIN);
    expect(t.openSteps).toBe(0);
  });

  it("finishes when the last step ends, and saves all five", () => {
    const t = rideTimeline(tempo, [start()], at(70 * MIN));
    expect(t.status).toBe("finished");
    expect(t.endedAt).toBe(at(65 * MIN));
    expect(t.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(t.current).toBeNull();
    expect(t.activeSeconds).toBe(65 * MIN);
  });

  it("pause stops the step clock and resume moves the step end", () => {
    const events = [start(), ev("pause", 600), ev("resume", 720)];
    const paused = rideTimeline(tempo, events.slice(0, 2), at(700));
    expect(paused.status).toBe("paused");
    expect(paused.current).toMatchObject({ activeSeconds: 600, remainingSeconds: 300, endsAt: null });
    const t = rideTimeline(tempo, events, at(1100));
    expect(t.steps[0]).toMatchObject({ status: "done", activeSeconds: 900, endedAt: at(1020) });
    expect(t.current).toMatchObject({ index: 1, activeSeconds: 80 });
  });

  it("a pause while paused, a resume while running and events before the start change nothing", () => {
    const t = rideTimeline(tempo, [ev("pause", -5), start(), ev("resume", 10), ev("pause", 100), ev("pause", 200), ev("resume", 300)], at(400));
    expect(t.current).toMatchObject({ index: 0, activeSeconds: 200 });
  });

  it("skip saves the step as skipped and starts the next at once", () => {
    const t = rideTimeline(tempo, [start(), ev("skip", 120)], at(180));
    expect(t.steps[0]).toMatchObject({ status: "skipped", activeSeconds: 120, endedAt: at(120) });
    expect(t.current).toMatchObject({ index: 1, activeSeconds: 60, startedAt: at(120) });
  });

  it("unskip undoes the latest skip: the step goes on as if never skipped", () => {
    const t = rideTimeline(tempo, [start(), ev("skip", 120), ev("unskip", 123)], at(180));
    expect(t.steps).toEqual([]);
    expect(t.current).toMatchObject({ index: 0, activeSeconds: 180 });
  });

  it("a skip while paused starts the next step paused", () => {
    const t = rideTimeline(tempo, [start(), ev("pause", 100), ev("skip", 150), ev("resume", 200)], at(260));
    expect(t.steps[0]).toMatchObject({ status: "skipped", activeSeconds: 100 });
    expect(t.current).toMatchObject({ index: 1, activeSeconds: 60 });
  });

  it("extend adds a minute, an opposite extend takes it back, and the step saves its extension", () => {
    const more = rideTimeline(tempo, [start(), ev("extend", 60, 60)], at(15 * MIN));
    expect(more.current).toMatchObject({ index: 0, remainingSeconds: 60, extendedSeconds: 60 });
    expect(more.plannedSeconds).toBe(66 * MIN);
    const done = rideTimeline(tempo, [start(), ev("extend", 60, 60)], at(17 * MIN));
    expect(done.steps[0]).toMatchObject({ activeSeconds: 960, extendedSeconds: 60 });
    const undone = rideTimeline(tempo, [start(), ev("extend", 60, 60), ev("extend", 62, -60), ev("extend", 63, -60)], at(100));
    expect(undone.current).toMatchObject({ extendedSeconds: 0, remainingSeconds: 800 });
  });

  it("a recovery takes +1 min too", () => {
    const rec = { steps: [step(1, 60, false)] };
    expect(rideTimeline(rec, [start(), ev("extend", 30)], at(40)).current).toMatchObject({ remainingSeconds: 80, extendedSeconds: 60 });
  });

  it("nudge moves the step's target by 5 W, capped at 50 W, and the next step starts at the plan", () => {
    const taps = Array.from({ length: 12 }, (_, i) => ev("nudge", 10 + i, 5));
    const up = rideTimeline(tempo, [start(), ...taps], at(100));
    expect(up.current?.offsetW).toBe(50);
    const down = rideTimeline(tempo, [start(), ...Array.from({ length: 12 }, (_, i) => ev("nudge", 10 + i, -5))], at(100));
    expect(down.current?.offsetW).toBe(-50);
    const t = rideTimeline(tempo, [start(), ev("nudge", 10, 5), ev("nudge", 11, 5), ev("nudge", 12, -5)], at(16 * MIN));
    expect(t.steps[0].offsetW).toBe(5);
    expect(t.current?.offsetW).toBe(0);
  });

  it("nudge does nothing on a step with no power", () => {
    const free = { steps: [step(1, 600, false)] };
    expect(rideTimeline(free, [start(), ev("nudge", 10, 5)], at(20)).current?.offsetW).toBe(0);
  });

  it("a lap step has no end time, waits for lap and saves as done", () => {
    const plan = { steps: [step(1, 600), step(2, null), step(3, 300)] };
    const waiting = rideTimeline(plan, [start()], at(5000));
    expect(waiting.current).toMatchObject({ index: 1, remainingSeconds: null, endsAt: null });
    expect(waiting.plannedSeconds).toBe(900);
    expect(waiting.openSteps).toBe(1);
    const t = rideTimeline(plan, [start(), ev("lap", 1500)], at(1600));
    expect(t.steps[1]).toMatchObject({ status: "done", activeSeconds: 900 });
    expect(t.current).toMatchObject({ index: 2, activeSeconds: 100 });
  });

  it("lap on a time step ends it as partial", () => {
    const t = rideTimeline(tempo, [start(), ev("lap", 400)], at(410));
    expect(t.steps[0]).toMatchObject({ status: "partial", activeSeconds: 400 });
  });

  it("end before the last step ends the ride early; done steps stay, the current one is partial", () => {
    const t = rideTimeline(tempo, [start(), ev("pause", 20 * MIN), ev("end", 21 * MIN)], at(30 * MIN));
    expect(t.status).toBe("ended_early");
    expect(t.endedAt).toBe(at(21 * MIN));
    expect(t.steps.map((s) => [s.status, s.activeSeconds])).toEqual([
      ["done", 900],
      ["partial", 300],
    ]);
    expect(t.current).toBeNull();
  });

  it("end on the last step finishes the ride", () => {
    const t = rideTimeline(tempo, [start(), ev("pause", 60 * MIN), ev("end", 61 * MIN)], at(62 * MIN));
    expect(t.status).toBe("finished");
    expect(t.steps).toHaveLength(5);
    expect(t.steps[4]).toMatchObject({ status: "partial", activeSeconds: 600 });
  });

  it("end at the first second of a step leaves that step out", () => {
    const t = rideTimeline(tempo, [start(), ev("end", 15 * MIN)], at(16 * MIN));
    expect(t.steps.map((s) => s.status)).toEqual(["done"]);
    expect(t.status).toBe("ended_early");
  });

  it("events after the end change nothing", () => {
    const t = rideTimeline(tempo, [start(), ev("end", 100), ev("start", 200), ev("resume", 300), ev("skip", 400)], at(500));
    expect(t.status).toBe("ended_early");
    expect(t.steps).toHaveLength(1);
  });

  it("ends on its own 2 hours after the planned end, at the last ended step", () => {
    const plan = { steps: [step(1, 600), step(2, null)] };
    const before = rideTimeline(plan, [start()], at(600) + AUTO_END_AFTER_MS - 1000);
    expect(before.status).toBe("running");
    const t = rideTimeline(plan, [start()], at(600) + AUTO_END_AFTER_MS);
    expect(t).toMatchObject({ status: "ended_early", autoEnded: true, endedAt: at(600) });
    expect(t.steps.map((s) => s.key)).toEqual(["s1"]);
    expect(t.current).toBeNull();
  });

  it("an open pause counts toward the auto end, a pause that is over does not", () => {
    const plan = { steps: [step(1, 600), step(2, null)] };
    const over = rideTimeline(plan, [start(), ev("pause", 60), ev("resume", 60 + 3600)], at(600 + 3600) + AUTO_END_AFTER_MS - 1000);
    expect(over.status).toBe("running");
    const open = rideTimeline(plan, [start(), ev("pause", 60)], at(600) + AUTO_END_AFTER_MS);
    expect(open).toMatchObject({ status: "ended_early", autoEnded: true, endedAt: at(0) });
    expect(open.steps).toEqual([]);
  });

  it("an event that arrives after the auto end changes nothing", () => {
    const plan = { steps: [step(1, null)] };
    const t = rideTimeline(plan, [start(), ev("lap", AUTO_END_AFTER_MS / 1000 + 10)], at(AUTO_END_AFTER_MS / 1000 + 20));
    expect(t).toMatchObject({ status: "ended_early", autoEnded: true });
    expect(t.steps).toEqual([]);
  });

  it("offline events replay in time order, whatever order they arrive in", () => {
    // The phone was offline: skip at 2 min and pause at 3 min reach the server late, out of order.
    const pause = ev("pause", 180);
    const skip = ev("skip", 120);
    const t = rideTimeline(tempo, [start(), pause, skip], at(600));
    expect(t.steps[0]).toMatchObject({ status: "skipped", endedAt: at(120) });
    expect(t).toMatchObject({ status: "paused" });
    expect(t.current).toMatchObject({ index: 1, activeSeconds: 60 });
  });
});

describe("review fixes", () => {
  const open = (i: number, estSeconds: number): TimelineStep => ({ ...step(i, null), estSeconds });

  it("a ride of open steps someone still uses does not end on its own", () => {
    const plan = { steps: [open(1, 3600), open(2, 3600)] };
    // 3 hours in, a heartbeat 10 s ago: the visible app is riding.
    const used = rideTimeline(plan, [start()], at(3 * 3600), { heartbeatAt: at(3 * 3600 - 10) });
    expect(used.status).toBe("running");
    // The same ride left alone ends 2 hours after its estimated end.
    expect(rideTimeline(plan, [start()], at(2 * 3600) + AUTO_END_AFTER_MS - 1000).status).toBe("running");
    expect(rideTimeline(plan, [start()], at(2 * 3600) + AUTO_END_AFTER_MS)).toMatchObject({ status: "ended_early", autoEnded: true });
  });

  it("the last event keeps a ride with no estimates alive", () => {
    const plan = { steps: [step(1, null), step(2, null)] };
    const t = rideTimeline(plan, [start(), ev("lap", 5400)], at(2 * 3600 + 1));
    expect(t.status).toBe("running");
    expect(t.steps.map((r) => r.status)).toEqual(["done"]);
  });

  it("an extend taken back after the step's time is up ends the step then", () => {
    const plan = { steps: [step(1, 60), step(2, 600)] };
    const t = rideTimeline(plan, [start(), ev("extend", 30, 60), ev("nudge", 80, 5), ev("extend", 90, -60)], at(100));
    expect(t.steps[0]).toMatchObject({ status: "done", endedAt: at(90), offsetW: 5 });
    expect(t.current).toMatchObject({ index: 1, startedAt: at(90), offsetW: 0 });
  });
});

describe("eventTime", () => {
  const startedAt = at(0);
  const now = at(600);
  it("keeps a client time inside the ride", () => {
    expect(eventTime(at(120), startedAt, now)).toBe(at(120));
    expect(eventTime(startedAt, startedAt, now)).toBe(startedAt);
  });
  it("uses the server time for no client time, one before the start or one in the future", () => {
    expect(eventTime(null, startedAt, now)).toBe(now);
    expect(eventTime(at(-1), startedAt, now)).toBe(now);
    expect(eventTime(at(601), startedAt, now)).toBe(now);
  });
  it("never goes before what the server already has: the last event or heartbeat", () => {
    expect(eventTime(at(120), startedAt, now, at(300))).toBe(at(300));
    expect(eventTime(at(400), startedAt, now, at(300))).toBe(at(400));
  });
});

describe("buildRidePlan", () => {
  const parsed = parseWorkout({
    v: 2,
    sport: "bike",
    name: "Over-unders",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 75 }, outdoor: { metric: "hr", anchor: "lthr", low: 70, high: 81 } },
      {
        type: "repeat",
        count: 3,
        steps: [
          { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", low: 88, high: 93 } },
          { type: "recovery", end: { type: "time", seconds: 120 }, free: true },
        ],
      },
      { type: "cooldown", end: { type: "distance", meters: 5000 } },
      { type: "work", end: { type: "lap" }, target: { metric: "power", anchor: "absolute", low: 200, high: 210 } },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const w: Workout = parsed.workout;
  const setIds = [11, 12, 13, 14, 15, 16, 17, 18, 19];

  it("drops the recovery after the last round and keeps each step's program set", () => {
    const plan = buildRidePlan(w, setIds, { ftp: 200 }, "indoor");
    expect(plan.steps.map((s) => [s.key, s.programSetId])).toEqual([
      ["s1", 11],
      ["s3#1", 12],
      ["s4#1", 13],
      ["s3#2", 14],
      ["s4#2", 15],
      ["s3#3", 16],
      ["s5", 18],
      ["s6", 19],
    ]);
  });

  it("freezes watts from the FTP: a ramp from its from to its to, a range, absolute watts", () => {
    const plan = buildRidePlan(w, setIds, { ftp: 200 }, "indoor");
    expect(plan.steps[0].power).toEqual({ from: 100, to: 150 });
    expect(plan.steps[0].target?.text).toBe("100 to 150 W");
    // A written heart rate target with no bike LTHR becomes the derived effort (4.2).
    expect(plan.steps[0].outdoor).toMatchObject({ unit: "RPE", text: "Effort 2", missing: null });
    expect(plan.steps[1].power).toEqual({ from: 176, to: 186 });
    expect(plan.steps[2].power).toBeNull();
    expect(plan.steps[7].power).toEqual({ from: 200, to: 210 });
  });

  it("without an FTP a percent target has no watts", () => {
    const plan = buildRidePlan(w, setIds, {}, "indoor");
    expect(plan.steps[0].power).toBeNull();
    expect(plan.steps[0].target?.text).toBe("ramp 50 to 75% FTP (no ftp set)");
    expect(plan.steps[7].power).toEqual({ from: 200, to: 210 });
  });

  it("a distance step with no speed estimate and a lap step have no end time; time steps keep theirs", () => {
    for (const mode of ["indoor", "outdoor"] as const) {
      const plan = buildRidePlan(w, setIds, { ftp: 200 }, mode);
      expect(plan.mode).toBe(mode);
      expect(plan.steps.map((s) => s.seconds)).toEqual([600, 300, 120, 300, 120, 300, null, null]);
    }
  });

  it("indoors a distance step runs for the plan's estimated time; outdoors it ends on lap", () => {
    const p = parseWorkout({ v: 2, sport: "bike", name: "Fixed", steps: [{ type: "work", end: { type: "distance", meters: 5000 }, target: { metric: "pace", anchor: "absolute", low: 9, high: 11 } }] });
    if (!p.ok) throw new Error(JSON.stringify(p.errors));
    expect(buildRidePlan(p.workout, [1], {}, "indoor").steps[0].seconds).toBe(500);
    expect(buildRidePlan(p.workout, [1], {}, "outdoor").steps[0].seconds).toBeNull();
  });

  it("gives open steps an estimate for the auto end: distance at 25 km/h, a lap step 10 min", () => {
    const plan = buildRidePlan(w, setIds, { ftp: 200 }, "outdoor");
    expect(plan.steps.map((s) => s.estSeconds)).toEqual([600, 300, 120, 300, 120, 300, 720, 600]);
  });

  it("refuses set ids that do not match the steps", () => {
    expect(() => buildRidePlan(w, setIds.slice(1), {}, "indoor")).toThrow(RangeError);
  });
});
