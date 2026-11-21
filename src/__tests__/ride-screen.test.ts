import { describe, expect, it } from "vitest";
import type { RideView } from "@/lib/actions/rides";
import { keptStepsText, pausedSince, pausedText, rideClock, rideScreen, stepLogPayload, stepSignature, stepsToSave, withQueued } from "@/lib/utils/ride-screen";
import { buildRidePlan, rideTimeline, type RideEventInput } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";

/** What ride mode shows and saves (docs/plans/bike-ride-logger.md, section 5 "Ride mode", 4.4, 4.5). */

const T0 = Date.UTC(2026, 10, 17, 17, 0, 0);
const at = (s: number) => T0 + s * 1000;

const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Upper endurance",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 }, cadence: { low: 85, high: 95 } },
        { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
      ],
    },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
    { type: "cooldown", end: { type: "lap" } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const ids = [11, 12, 13, 14, 15, 16, 17];
const thresholds = { ftp: 180, lthr_bike: 171 };
const indoor = buildRidePlan(parsed.workout, ids, thresholds, "indoor");
const outdoor = buildRidePlan(parsed.workout, ids, thresholds, "outdoor");

let seq = 0;
const ev = (kind: RideEventInput["kind"], s: number, value?: number): RideEventInput => ({ seq: ++seq, kind, at: at(s), value: value ?? null });

describe("rideClock", () => {
  it("shows minutes and seconds, as the mockup", () => {
    expect(rideClock(702)).toBe("11:42");
    expect(rideClock(48)).toBe("0:48");
    expect(rideClock(3900)).toBe("65:00");
    expect(rideClock(-3)).toBe("0:00");
  });
});

describe("rideScreen", () => {
  it("indoors: header, total, step title, clock, watts, cadence and HR, and the next step", () => {
    const t = rideTimeline(indoor, [ev("start", 0)], at(900 + 198));
    const s = rideScreen(indoor, t)!;
    expect(s.header).toBe("Indoor · step 2 of 6");
    expect(s.total).toBe("18:18 of 65:00 + open");
    expect(s.title).toBe("Work · 1 of 2");
    expect(s.clock).toBe("11:42");
    expect(s.target).toEqual({ value: "135-146", unit: "W" });
    expect(s.second).toEqual([
      { label: "Cadence", value: "85-95" },
      { label: "HR", value: "139-152" },
    ]);
    expect(s.next).toEqual({ title: "Easy · 5 min", target: "under 97 W" });
    expect(s.lastMinute).toBe(false);
    expect([s.power, s.canLower, s.canRaise, s.canExtend, s.lap]).toEqual([true, true, true, true, false]);
    // The marker sits 198 s into the 900 s bar of step 2.
    const bar = s.profile.bars[1];
    expect(bar.current).toBe(true);
    expect(s.profile.markerX).toBeCloseTo(bar.x + (bar.w * 198) / 900, 1);
  });

  it("+1 min widens the step's bar in the mini profile, as the total grows", () => {
    // +1 min on step 2 (900 s) at 910 s; 198 s into it.
    const t = rideTimeline(indoor, [ev("start", 0), ev("extend", 910, 60)], at(900 + 198));
    const s = rideScreen(indoor, t)!;
    expect(s.total).toBe("18:18 of 66:00 + open");
    const [warm, work] = s.profile.bars;
    expect(work.w / warm.w).toBeCloseTo(960 / 900, 2);
    expect(s.profile.markerX).toBeCloseTo(work.x + (work.w * 198) / 960, 1);
  });

  it("±5 W moves the watts; at ±50 W the button stops", () => {
    const events = [ev("start", 0), ...Array.from({ length: 10 }, (_, i) => ev("nudge", 910 + i, 5))];
    const s = rideScreen(indoor, rideTimeline(indoor, events, at(930)))!;
    expect(s.target).toEqual({ value: "185-196", unit: "W" });
    expect([s.canLower, s.canRaise]).toEqual([true, false]);
  });

  it("the Next card turns accent in the last minute, and the last step's next is Finish", () => {
    const last = rideTimeline(indoor, [ev("start", 0)], at(900 - 59));
    expect(rideScreen(indoor, last)!.lastMinute).toBe(true);
    const cool = rideTimeline(indoor, [ev("start", 0)], at(3900 + 30));
    const s = rideScreen(indoor, cool)!;
    expect(s.title).toBe("Cool-down");
    expect(s.next).toEqual({ title: "Finish", target: null });
    // A lap step counts up and has Lap, no +1 min.
    expect([s.remaining, s.clock, s.lap, s.canExtend]).toEqual([null, "0:30", true, false]);
  });

  it("outdoors: heart rate as the big number, the power meter as the second line, Lap on every step", () => {
    const s = rideScreen(outdoor, rideTimeline(outdoor, [ev("start", 0)], at(1000)))!;
    expect(s.header).toBe("Outdoor · step 2 of 6");
    expect(s.target).toEqual({ value: "139-152", unit: "bpm" });
    expect(s.second).toEqual([{ label: "Power meter", value: "135-146 W" }]);
    expect(s.next).toEqual({ title: "Easy · 5 min", target: "Effort 2" });
    expect(s.lap).toBe(true);
  });

  it("outdoors on an effort 2 step: Effort 2 big, and easy spin on the line below (4.2)", () => {
    const s = rideScreen(outdoor, rideTimeline(outdoor, [ev("start", 0)], at(1900)))!;
    expect(s.title).toBe("Easy");
    expect(s.target).toEqual({ value: "Effort 2", unit: null });
    expect(s.second).toContainEqual({ label: "Easy spin", value: "" });
  });

  it("is null before the start and after the end", () => {
    expect(rideScreen(indoor, rideTimeline(indoor, [], at(0)))).toBeNull();
    expect(rideScreen(indoor, rideTimeline(indoor, [ev("start", 0), ev("end", 10)], at(20)))).toBeNull();
  });
});

describe("keptStepsText", () => {
  it("names the steps ending now keeps: the ended ones but skipped, and the current one once ridden", () => {
    expect(keptStepsText(rideTimeline(indoor, [ev("start", 0)], at(0)))).toBe("No step is ridden yet. Ending now saves nothing.");
    expect(keptStepsText(rideTimeline(indoor, [ev("start", 0)], at(10)))).toBe("Step 1 is saved. Ending now keeps it.");
    expect(keptStepsText(rideTimeline(indoor, [ev("start", 0)], at(1000)))).toBe("Steps 1 and 2 are saved. Ending now keeps them.");
    expect(keptStepsText(rideTimeline(indoor, [ev("start", 0), ev("skip", 1000)], at(1100)))).toBe("Steps 1 and 3 are saved. Ending now keeps them.");
    expect(keptStepsText(rideTimeline(indoor, [ev("start", 0)], at(3010)))).toBe("Steps 1 to 5 are saved. Ending now keeps them.");
  });
});

describe("paused", () => {
  it("says how long the ride is paused", () => {
    const events = [ev("start", 0), ev("pause", 60), ev("resume", 90), ev("pause", 200)];
    expect(pausedSince(events)).toBe(at(200));
    expect(pausedText(at(200), at(230))).toBe("Paused under 1 min");
    expect(pausedText(at(200), at(200 + 150))).toBe("Paused 2 min");
  });
});

describe("saving steps", () => {
  it("a step saves its time, status, offset and extension, with the clock as the time's source", () => {
    const t = rideTimeline(indoor, [ev("start", 0), ev("nudge", 100, -5), ev("extend", 200, 60), ev("skip", 960 + 30)], at(2000));
    const [first, second] = t.steps;
    expect(stepLogPayload(first, { sessionId: 7, exerciseId: 3, setNumber: 1 })).toEqual({
      sessionId: 7,
      exerciseId: 3,
      setNumber: 1,
      programSetId: 11,
      actualReps: 0,
      weightKg: 0,
      durationSeconds: 960,
      restTimeSeconds: 0,
      isCompleted: true,
      stepStatus: "done",
      targetOffsetW: -5,
      extendedSeconds: 60,
      sources: { durationSeconds: "clock" },
    });
    expect(stepLogPayload(second, { sessionId: 7, exerciseId: 3, setNumber: 2 })).toMatchObject({ programSetId: 12, isCompleted: false, stepStatus: "skipped", durationSeconds: 30, targetOffsetW: 0 });
  });

  it("saves a step once, and again only when its values change", () => {
    const t = rideTimeline(indoor, [ev("start", 0), ev("skip", 30)], at(40));
    expect(stepsToSave(t.steps, {}).map((r) => r.programSetId)).toEqual([11]);
    const saved = { "11": stepSignature(t.steps[0]) };
    expect(stepsToSave(t.steps, saved)).toEqual([]);
    // Undo of the skip: the step runs on and saves again as done when it ends.
    const undone = rideTimeline(indoor, [ev("start", 0), ev("skip", 30), ev("unskip", 32)], at(950));
    expect(stepsToSave(undone.steps, saved).map((r) => [r.programSetId, r.status])).toEqual([[11, "done"]]);
  });
});

describe("withQueued", () => {
  it("times a queued tap as the server will: after the last event or heartbeat, never in the future", () => {
    const view = {
      ride: { id: 1, sessionId: 1, programExerciseId: 1, mode: "indoor", status: "running", seq: 2, startedAt: at(0), endedAt: null, heartbeatAt: at(50) },
      plan: indoor,
      events: [
        { seq: 1, kind: "start", value: null, at: at(0), clientId: "a" },
        { seq: 2, kind: "pause", value: null, at: at(20), clientId: "b" },
      ],
      serverNow: at(60),
    } as RideView;
    const out = withQueued(
      view,
      [
        { clientId: "b", kind: "pause", clientAt: at(20) },
        { clientId: "c", kind: "resume", clientAt: at(40) },
        { clientId: "d", kind: "skip", clientAt: at(500) },
      ],
      at(70),
    );
    // "b" is stored already; "c" goes to the heartbeat; "d" from the future goes to now.
    expect(out.map((e) => [e.seq, e.kind, e.at])).toEqual([
      [1, "start", at(0)],
      [2, "pause", at(20)],
      [3, "resume", at(50)],
      [4, "skip", at(70)],
    ]);
  });
});
