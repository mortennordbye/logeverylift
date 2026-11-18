import { ridePushSchedule, ridePushTag, ridePushUrl } from "@/lib/utils/ride-pushes";
import { buildRidePlan, rideTimeline, type RideEventInput } from "@/lib/utils/ride-timeline";
import { flattenWorkout } from "@/lib/utils/workout-player";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The push alerts of a running ride (docs/plans/bike-ride-logger.md, D7 and 4.7). */

const T = Date.UTC(2026, 10, 17, 17, 0, 0);
const s = (n: number) => T + n * 1000;

const STEPS = [
  { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
  { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } },
  { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
];

function plan(steps: unknown[] = STEPS, mode: "indoor" | "outdoor" = "indoor") {
  const parsed = parseWorkout({ v: 2, sport: "bike", name: "Bike", steps });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const ids = flattenWorkout(parsed.workout).map((_, i) => i + 1);
  return buildRidePlan(parsed.workout, ids, { ftp: 180, lthr_bike: 171 }, mode);
}

let seq = 0;
const ev = (kind: RideEventInput["kind"], at: number, value?: number): RideEventInput => ({ seq: ++seq, kind, at, value: value ?? null });

function schedule(p: ReturnType<typeof plan>, events: RideEventInput[], now: number) {
  return ridePushSchedule(p, rideTimeline(p, events, now), now).map((r) => ({ ...r, sendAt: (r.sendAt - T) / 1000 }));
}

describe("ridePushSchedule", () => {
  it("one alert per step change and one a minute before each step ends, target first, and the ride's end", () => {
    const p = plan();
    expect(schedule(p, [ev("start", T)], s(100))).toEqual([
      { sendAt: 840, kind: "minute_left", title: "1 min left · next Work 135-146 W", body: "Step 1 of 3 · Warm-up", stepIndex: 0 },
      { sendAt: 900, kind: "step", title: "Work · 135-146 W · 15 min", body: "Step 2 of 3 · Warm-up done", stepIndex: 1 },
      { sendAt: 1740, kind: "minute_left", title: "1 min left · next Easy under 97 W", body: "Step 2 of 3 · Work", stepIndex: 1 },
      { sendAt: 1800, kind: "step", title: "Easy · under 97 W · 5 min", body: "Step 3 of 3 · Work done", stepIndex: 2 },
      { sendAt: 2040, kind: "minute_left", title: "1 min left · last step", body: "Step 3 of 3 · Easy", stepIndex: 2 },
      { sendAt: 2100, kind: "done", title: "Ride done", body: "Step 3 of 3 · Easy done", stepIndex: 2 },
    ]);
  });

  it("only alerts still to come: in the last minute of a step, its minute alert is gone", () => {
    const rows = schedule(plan(), [ev("start", T)], s(870));
    expect(rows[0]).toMatchObject({ sendAt: 900, kind: "step" });
    expect(rows.every((r) => r.sendAt > 870)).toBe(true);
  });

  it("moves with the ride: +1 min and a pause that is over shift every later alert", () => {
    const p = plan();
    const rows = schedule(p, [ev("start", T), ev("extend", s(100), 60), ev("pause", s(200)), ev("resume", s(320))], s(400));
    expect(rows.map((r) => r.sendAt)).toEqual([1020, 1080, 1920, 1980, 2220, 2280]);
  });

  it("none while paused, none after the end", () => {
    const p = plan();
    expect(schedule(p, [ev("start", T), ev("pause", s(100))], s(150))).toEqual([]);
    expect(schedule(p, [ev("start", T), ev("end", s(100))], s(150))).toEqual([]);
    expect(schedule(p, [ev("start", T)], s(2200))).toEqual([]);
    expect(schedule(p, [], T)).toEqual([]);
  });

  it("a lap step has no end time: its start is the last alert, and on a lap step there is none", () => {
    const steps = [STEPS[0], { type: "work", end: { type: "lap" }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } }, STEPS[2]];
    const p = plan(steps);
    const rows = schedule(p, [ev("start", T)], s(100));
    expect(rows.map((r) => [r.sendAt, r.kind])).toEqual([
      [840, "minute_left"],
      [900, "step"],
    ]);
    expect(rows[1].title).toBe("Work · 135-146 W · to lap");
    expect(schedule(p, [ev("start", T)], s(1000))).toEqual([]);
  });

  it("an open distance step outdoors ends on the lap button: no alert after its start", () => {
    const steps = [STEPS[0], { type: "work", end: { type: "distance", meters: 10000 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } }, STEPS[2]];
    const rows = schedule(plan(steps, "outdoor"), [ev("start", T)], s(100));
    expect(rows.map((r) => r.kind)).toEqual(["minute_left", "step"]);
    expect(rows[1].title).toBe("Work · HR 139-152 · 10 km");
  });

  it("outdoors: the outdoor target in place of the watts", () => {
    const rows = schedule(plan(STEPS, "outdoor"), [ev("start", T)], s(100));
    expect(rows[0].title).toBe("1 min left · next Work HR 139-152");
    expect(rows[1].title).toBe("Work · HR 139-152 · 15 min");
    expect(rows[3].title).toBe("Easy · Effort 2 · 5 min");
  });

  it("a repeat names the round; a time that is not whole minutes has no colon", () => {
    const steps: unknown[] = [
      STEPS[0],
      {
        type: "repeat",
        count: 2,
        steps: [
          { type: "work", end: { type: "time", seconds: 90 }, target: { metric: "power", anchor: "ftp", low: 105, high: 110 } },
          { type: "recovery", end: { type: "time", seconds: 45 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
        ],
      },
    ];
    const rows = schedule(plan(steps), [ev("start", T)], s(100));
    expect(rows[1].title).toBe("Work · 1 of 2 · 189-198 W · 1 min 30 s");
    expect(rows.find((r) => r.kind === "step" && r.stepIndex === 2)?.title).toBe("Easy · under 97 W · 45 s");
    // A 45 s step has no minute alert of its own; the 90 s one does.
    expect(rows.filter((r) => r.kind === "minute_left").map((r) => r.stepIndex)).toEqual([0, 1, 3]);
    for (const r of rows) {
      expect(`${r.title} ${r.body}`).not.toMatch(/[:—]/);
    }
  });

  it("no colons or em dashes in any alert of the plans above", () => {
    for (const mode of ["indoor", "outdoor"] as const) {
      for (const r of schedule(plan(STEPS, mode), [ev("start", T)], s(1))) expect(`${r.title} ${r.body}`).not.toMatch(/[:—]/);
    }
  });
});

describe("tag and link", () => {
  it("one tag per ride, and the link opens the bike exercise in ride mode", () => {
    expect(ridePushTag(42)).toBe("ride-42");
    expect(ridePushUrl(5, 9)).toBe("/programs/5/workout/exercises/9?ride=1");
  });
});
