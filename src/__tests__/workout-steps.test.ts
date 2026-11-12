import {
  describeWorkout,
  estimateWorkout,
  isHardWorkout,
  parseWorkout,
  resolveWorkout,
  type Workout,
  type WorkoutStep,
} from "@/lib/utils/workout-steps";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The workout schema, resolver and derived values (docs/plans/workouts-and-compliance.md, section 3). */

const DOC = readFileSync(path.join(process.cwd(), "docs/mcp/workout-steps.md"), "utf8");
const blocks = [...DOC.matchAll(/```(json(?: wrong)?)\n([\s\S]*?)```/g)].map((m) => ({ wrong: m[1] === "json wrong", json: m[2] }));
const examples = blocks.filter((b) => !b.wrong).map((b) => JSON.parse(b.json));
const byName = (name: string) => {
  const r = parseWorkout(examples.find((e) => e.name === name));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
};

function errorsOf(input: unknown): { path: string; message: string }[] {
  const r = parseWorkout(input);
  if (r.ok) throw new Error("expected the schema to refuse it");
  return r.errors;
}

const run = (steps: unknown[], extra: Record<string, unknown> = {}) => ({ v: 1, sport: "run", name: "Test", steps, ...extra });
const work = (extra: Record<string, unknown> = {}) => ({ type: "work", end: { type: "time", seconds: 600 }, ...extra });

describe("the resource doc", () => {
  it("has the examples and the wrong examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(4);
    expect(blocks.filter((b) => b.wrong).length).toBeGreaterThanOrEqual(3);
  });

  it.each(blocks.map((b, i) => [i, b]))("block %i parses, or is refused when marked wrong", (_i, b) => {
    const r = parseWorkout(JSON.parse(b.json));
    expect(r.ok).toBe(!b.wrong);
  });
});

describe("parseWorkout: the rules", () => {
  it("fills missing ids and keeps given ones", () => {
    const r = parseWorkout(run([work({ id: "s1" }), { type: "repeat", count: 2, steps: [work(), work({ id: "fast" })] }]));
    if (!r.ok) throw new Error();
    const [a, rep] = r.workout.steps;
    expect(a.id).toBe("s1");
    expect(rep.id).toBe("s2");
    if (rep.type !== "repeat") throw new Error();
    expect(rep.steps.map((s) => s.id)).toEqual(["s3", "fast"]);
  });

  it("refuses an id used twice", () => {
    expect(errorsOf(run([work({ id: "a" }), work({ id: "a" })]))).toContainEqual({ path: "steps[1].id", message: 'id "a" is used twice' });
  });

  it("refuses a repeat inside a repeat", () => {
    const errors = errorsOf(run([{ type: "repeat", count: 2, steps: [{ type: "repeat", count: 2, steps: [work()] }] }]));
    expect(errors[0].path).toMatch(/^steps\[0\]\.steps\[0\]/);
  });

  it("refuses low over high with the path", () => {
    const errors = errorsOf(run([work({ target: { metric: "hr", anchor: "lthr", low: 95, high: 90 } })]));
    expect(errors).toContainEqual({ path: "steps[0].target.low", message: "must be at most high" });
  });

  it("refuses an anchor on the wrong sport", () => {
    const errors = errorsOf(run([work({ target: { metric: "power", anchor: "ftp", low: 90, high: 95 } })]));
    expect(errors.map((e) => e.path)).toContain("steps[0].target.anchor");
    expect(errorsOf({ v: 1, sport: "bike", name: "x", steps: [work({ target: { metric: "pace", anchor: "css", low: 90, high: 95 } })] })[0].path).toBe(
      "steps[0].target.anchor",
    );
  });

  it("needs exactly one target form, and checks zones and offsets", () => {
    expect(errorsOf(run([work({ target: { metric: "hr", anchor: "lthr", low: 80, high: 85, zone: 2 } })]))[0].message).toMatch(/exactly one/);
    expect(errorsOf(run([work({ target: { metric: "hr", anchor: "lthr", zone: 6 } })]))[0].path).toBe("steps[0].target.zone");
    expect(errorsOf(run([work({ target: { metric: "hr", anchor: "max_hr", zone: 2 } })]))[0].path).toBe("steps[0].target.zone");
    expect(errorsOf(run([work({ target: { metric: "pace", anchor: "threshold_pace", offsetLow: 1, offsetHigh: 2 } })]))[0].message).toMatch(/only for pace with anchor css/);
  });

  it("refuses values out of range", () => {
    expect(errorsOf(run([work({ target: { metric: "pace", anchor: "threshold_pace", low: 40, high: 90 } })]))[0].path).toBe("steps[0].target.low");
    expect(errorsOf(run([{ type: "work", end: { type: "time", seconds: 2 } }]))[0].path).toBe("steps[0].end.seconds");
    expect(errorsOf(run([work({ cadence: { low: 10, high: 90 } })]))[0].path).toBe("steps[0].cadence.low");
  });

  it("refuses unknown keys, so a typo is never a lost field", () => {
    expect(errorsOf(run([work({ targt: { metric: "hr" } })])).length).toBeGreaterThan(0);
    expect(errorsOf(run([work()], { colour: "red" })).length).toBeGreaterThan(0);
  });

  it("refuses swim fields on other sports, and cadence on a swim", () => {
    expect(errorsOf(run([work({ stroke: "free" })]))[0].path).toBe("steps[0].stroke");
    expect(errorsOf(run([work()], { poolLengthM: 25 }))[0].path).toBe("poolLengthM");
    expect(errorsOf({ v: 1, sport: "swim", name: "x", steps: [work({ cadence: { low: 30, high: 40 } })] })[0].path).toBe("steps[0].cadence");
  });

  it("checks pool lengths and send-offs", () => {
    const swim = (steps: unknown[], pool: number | undefined = 25) => ({ v: 1, sport: "swim", name: "x", poolLengthM: pool, steps });
    const lengths = (m: number) => ({ type: "work", end: { type: "distance", meters: m } });
    expect(errorsOf(swim([lengths(110)]))[0].path).toBe("steps[0].end.meters");
    expect(parseWorkout({ v: 1, sport: "swim", name: "x", steps: [lengths(110)] }).ok).toBe(true); // open water
    expect(parseWorkout(swim([lengths(91.44)], 22.86)).ok).toBe(true); // 100 yd in a 25 yd pool
    expect(errorsOf(swim([{ ...lengths(100), sendOffSeconds: 120 }]))[0].message).toMatch(/inside a repeat/);
    expect(
      errorsOf(swim([{ type: "repeat", count: 4, steps: [{ ...lengths(100), sendOffSeconds: 120 }, { type: "rest", end: { type: "time", seconds: 20 } }] }]))[0]
        .message,
    ).toMatch(/no rest step/);
  });

  it("caps the steps once repeats are expanded", () => {
    const big = { type: "repeat", count: 50, steps: Array.from({ length: 9 }, () => work()) };
    expect(errorsOf(run([big]))).toContainEqual({ path: "steps", message: "450 steps once repeats are expanded; at most 400" });
  });
});

describe("resolveWorkout", () => {
  it("resolves the bike example from FTP", () => {
    const { steps, missingAnchors } = resolveWorkout(byName("3 × 10 min sweet spot"), { ftp: 250, lthr_bike: 160 });
    expect(missingAnchors).toEqual([]);
    const rep = steps[1];
    if (!("count" in rep)) throw new Error();
    expect(rep.steps[0].resolved?.text).toBe("220-233 W");
    expect(rep.steps[1].resolved?.text).toBe("up to 135 W"); // Z1 is under 55% FTP
    const cooldown = steps[2] as WorkoutStep & { resolved: { text: string } };
    expect(cooldown.resolved.text).toBe("up to 128 bpm"); // bike Z1 is under 81% LTHR
  });

  it("resolves CSS offsets to swim pace, fastest first", () => {
    const { steps } = resolveWorkout(byName("10 × 100 on 2:00"), { swim_css: 100 / 105 });
    const main = steps[2];
    if (!("count" in main)) throw new Error();
    expect(main.steps[0].resolved?.text).toBe("1:47-1:50/100m");
  });

  it("resolves threshold pace as a percent of speed, in km or miles", () => {
    const w = byName("20 min off the bike");
    const speed = 1000 / 240; // 4:00 per km
    expect((resolveWorkout(w, { run_threshold_pace: speed }).steps[0] as { resolved: { text: string } }).resolved.text).toBe("4:27-4:42/km");
    expect(
      (resolveWorkout(w, { run_threshold_pace: speed }, { distance: "mi", swim: "m" }).steps[0] as { resolved: { text: string } }).resolved.text,
    ).toBe("7:09-7:34/mi");
  });

  it("lists the anchors a workout needs that the user has not set", () => {
    const r = resolveWorkout(byName("3 × 10 min sweet spot"), {});
    expect(r.missingAnchors.sort()).toEqual(["ftp", "lthr_bike"]);
    expect((r.steps[0] as { resolved: { text: string; low: number | null } }).resolved).toMatchObject({ low: null, text: "50-70% FTP (no ftp set)" });
  });

  it("uses the run LTHR on a run and passes absolute targets through", () => {
    const r = parseWorkout(run([work({ target: { metric: "hr", anchor: "lthr", zone: 2 } }), work({ target: { metric: "hr", anchor: "absolute", low: 140, high: 150 } })]));
    if (!r.ok) throw new Error();
    const [z2, abs] = resolveWorkout(r.workout, { lthr_run: 170, lthr_bike: 150 }).steps as { resolved: { text: string } }[];
    expect(z2.resolved.text).toBe("145-151 bpm");
    expect(abs.resolved.text).toBe("140-150 bpm");
  });
});

describe("estimateWorkout", () => {
  it("adds time steps and marks a lap step as partial", () => {
    expect(estimateWorkout(byName("3 × 10 min sweet spot"))).toEqual({ durationSeconds: 3600, distanceMeters: 0, durationComplete: false, distanceComplete: false });
  });

  it("uses send-offs for time and counts every length", () => {
    const e = estimateWorkout(byName("10 × 100 on 2:00"));
    expect(e.distanceMeters).toBe(1800);
    expect(e.durationSeconds).toBe(1260); // 10 send-offs of 2:00 and 4 rests of 15 s
    expect(e.durationComplete).toBe(false); // the warm-up has no pace
  });

  it("gets distance from a resolved pace", () => {
    const e = estimateWorkout(byName("20 min off the bike"), { run_threshold_pace: 1000 / 240 });
    expect(e).toMatchObject({ durationSeconds: 1200, durationComplete: true, distanceComplete: true });
    expect(e.distanceMeters).toBe(4375); // 1200 s at 87.5% of 4.167 m/s
  });
});

describe("describeWorkout", () => {
  it("writes one line", () => {
    expect(describeWorkout(byName("3 × 10 min sweet spot"))).toBe(
      "15 min warm-up 50-70% FTP · 3 × (10 min 88-93% FTP, 5 min easy Z1 power) · to lap cool-down Z1 HR",
    );
    expect(describeWorkout(byName("10 × 100 on 2:00"))).toBe(
      "400 m warm-up choice · 4 × (50 m drill, 15 s rest) · 10 × 100 m CSS +2 to +5 s/100m on 2:00 · 200 m cool-down choice",
    );
  });

  it("follows the swim unit", () => {
    expect(describeWorkout(byName("10 × 100 on 2:00"), { distance: "km", swim: "yd" })).toMatch(/^437 yd warm-up/);
  });
});

describe("isHardWorkout", () => {
  const w = (steps: unknown[], sport = "run"): Workout => {
    const r = parseWorkout({ v: 1, sport, name: "x", steps });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.workout;
  };

  it("intervals are hard", () => {
    expect(isHardWorkout(byName("3 × 10 min sweet spot"))).toBe(true);
  });

  it("steady endurance and race-pace work below zone 4 are not", () => {
    const brick = examples.filter((e) => e.name.includes("endurance") || e.name.includes("off the bike"));
    for (const e of brick) {
      const r = parseWorkout(e);
      if (!r.ok) throw new Error();
      expect(isHardWorkout(r.workout)).toBe(false);
    }
  });

  it("a work step at zone 4 or above is hard, by each anchor", () => {
    expect(isHardWorkout(w([work({ target: { metric: "hr", anchor: "lthr", zone: 4 } })]))).toBe(true);
    expect(isHardWorkout(w([work({ target: { metric: "hr", anchor: "lthr", low: 95, high: 99 } })]))).toBe(true);
    expect(isHardWorkout(w([work({ target: { metric: "hr", anchor: "lthr", low: 94, high: 99 } })]))).toBe(false);
    expect(isHardWorkout(w([work({ target: { metric: "hr", anchor: "lthr", low: 94, high: 99 } })], "bike"))).toBe(true);
    expect(isHardWorkout(w([work({ target: { metric: "pace", anchor: "threshold_pace", low: 97, high: 102 } })]))).toBe(true);
    expect(isHardWorkout(w([work({ target: { metric: "power", anchor: "absolute", low: 230, high: 250 } })], "bike"), { ftp: 250 })).toBe(true);
    expect(isHardWorkout(w([work({ target: { metric: "power", anchor: "absolute", low: 230, high: 250 } })], "bike"))).toBe(false);
  });

  it("a hard target on a warm-up does not count", () => {
    expect(isHardWorkout(w([{ type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 4 } }]))).toBe(false);
  });
});
