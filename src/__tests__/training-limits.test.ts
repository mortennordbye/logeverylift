import {
  HARD_SESSIONS_LIMIT,
  hardSessionsPerWeek,
  isHardSession,
  longRunCap,
  longestRuns,
  overrideLine,
  plannedRun,
  remainingAfterOverride,
  type RunHistory,
} from "@/lib/utils/training-limits";
import { describe, expect, it } from "vitest";

const MIN = 60;
const none = { durationS: 0, distanceM: 0 };
const history: RunHistory = {
  longestDuration: { s: 80 * MIN, day: "2026-11-02" },
  longestDistance: { m: 14_000, day: "2026-11-02" },
};

describe("plannedRun", () => {
  it("sums only run sets, duration and distance apart", () => {
    expect(
      plannedRun([
        { discipline: "run", durationSeconds: 600, distanceMeters: null },
        { discipline: "run", durationSeconds: 1200, distanceMeters: 3000 },
        { discipline: "bike", durationSeconds: 3600, distanceMeters: 30_000 },
        { discipline: null, durationSeconds: 60, distanceMeters: null },
      ]),
    ).toEqual({ durationS: 1800, distanceM: 3000 });
  });
});

describe("longestRuns", () => {
  it("counts indoor runs for time but not for distance", () => {
    const h = longestRuns([
      { day: "2026-11-01", durationS: 3000, distanceM: 9000, indoor: false },
      { day: "2026-11-03", durationS: 4000, distanceM: 12_000, indoor: true },
    ]);
    expect(h.longestDuration).toEqual({ s: 4000, day: "2026-11-03" });
    expect(h.longestDistance).toEqual({ m: 9000, day: "2026-11-01" });
  });

  it("is empty with no runs", () => {
    expect(longestRuns([])).toEqual({ longestDuration: null, longestDistance: null });
  });
});

describe("longRunCap", () => {
  it("passes a run at exactly 1.10x", () => {
    expect(longRunCap([{ label: "Run", before: none, after: { durationS: 88 * MIN, distanceM: 0 } }], history)).toBeNull();
  });

  it("refuses a run over 1.10x with the numbers", () => {
    const broken = longRunCap([{ label: "Run", before: none, after: { durationS: 105 * MIN, distanceM: 0 } }], history)!;
    expect(broken.rule).toBe("long_run_cap");
    expect(broken.message).toBe(
      "Run 1:45 h is 1.31x your longest run in the last 30 days (1:20 h on 2026-11-02). Limit 1.10x, so at most 1:28 h.",
    );
    expect(broken.evidence).toBe("Study (large cohort)");
    expect(broken.numbers).toEqual({
      runs: [{ session: "Run", measure: "duration", planned: 6300, longest: 4800, longestDay: "2026-11-02", ratio: 1.31, limit: 1.1, max: 5280 }],
    });
  });

  it("checks distance against the longest distance", () => {
    const broken = longRunCap([{ label: "Long run", before: none, after: { durationS: 0, distanceM: 18_000 } }], history)!;
    expect(broken.message).toContain("Long run 18.0 km is 1.29x your longest run");
    expect(broken.message).toContain("at most 15.4 km");
  });

  it("does not block a session that did not grow, even over the cap", () => {
    const over = { durationS: 120 * MIN, distanceM: 0 };
    expect(longRunCap([{ label: "Run", before: over, after: over }], history)).toBeNull();
    expect(longRunCap([{ label: "Run", before: over, after: { durationS: 110 * MIN, distanceM: 0 } }], history)).toBeNull();
  });

  it("treats no run in 30 days as over the cap", () => {
    const broken = longRunCap(
      [{ label: "Run", before: none, after: { durationS: 30 * MIN, distanceM: 0 } }],
      { longestDuration: null, longestDistance: null },
    )!;
    expect(broken.message).toContain("no run in the last 30 days");
    expect(broken.numbers).toMatchObject({ runs: [{ longest: null, ratio: null }] });
  });

  it("joins several sessions into one result for the rule", () => {
    const broken = longRunCap(
      [
        { label: "Tue", before: none, after: { durationS: 100 * MIN, distanceM: 0 } },
        { label: "Sun", before: none, after: { durationS: 0, distanceM: 20_000 } },
        { label: "Thu", before: none, after: { durationS: 40 * MIN, distanceM: 0 } },
      ],
      history,
    )!;
    expect((broken.numbers.runs as unknown[]).length).toBe(2);
  });

  it("ignores programs with no run", () => {
    expect(longRunCap([{ label: "Bench", before: none, after: none }], history)).toBeNull();
  });
});

describe("isHardSession", () => {
  it("is hard for a work rep or zone 4-5 on an endurance set", () => {
    expect(isHardSession([{ discipline: "run", sessionRole: "work", targetHeartRateZone: 3 }])).toBe(true);
    expect(isHardSession([{ discipline: "bike", sessionRole: null, targetHeartRateZone: 4 }])).toBe(true);
    expect(isHardSession([{ discipline: "swim", sessionRole: null, targetHeartRateZone: 5 }])).toBe(true);
  });

  it("is easy for zone 1-3 with no role, and for strength", () => {
    expect(isHardSession([{ discipline: "run", sessionRole: null, targetHeartRateZone: 3 }])).toBe(false);
    expect(isHardSession([{ discipline: null, sessionRole: null, targetHeartRateZone: 5 }])).toBe(false);
    expect(isHardSession([])).toBe(false);
  });
});

describe("hardSessionsPerWeek", () => {
  const week = (...hardDays: number[]) => [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, hard: hardDays.includes(d) }));

  it("allows the limit", () => {
    expect(HARD_SESSIONS_LIMIT).toBe(3);
    expect(hardSessionsPerWeek(week(2), week(2, 4, 6))).toBeNull();
  });

  it("refuses a fourth hard session and names the days", () => {
    const broken = hardSessionsPerWeek(week(2, 4, 6), week(2, 4, 6, 7))!;
    expect(broken.message).toBe("This week would hold 4 hard sessions (Tue, Thu, Sat, Sun). Limit 3.");
    expect(broken.numbers).toEqual({ hardSessions: 4, days: [2, 4, 6, 7], limit: 3 });
  });

  it("counts a program on two days twice", () => {
    const after = [...week(2, 4, 6), { dayOfWeek: 6, hard: true }];
    expect(hardSessionsPerWeek(week(2, 4), after)?.numbers.hardSessions).toBe(4);
  });

  it("does not block a week that did not get harder", () => {
    expect(hardSessionsPerWeek(week(1, 2, 3, 4, 5), week(1, 2, 3, 4))).toBeNull();
  });
});

describe("remainingAfterOverride", () => {
  const cap = longRunCap([{ label: "Run", before: none, after: { durationS: 105 * MIN, distanceM: 0 } }], history)!;
  const hard = hardSessionsPerWeek([], [1, 2, 3, 4].map((d) => ({ dayOfWeek: d, hard: true })))!;

  it("leaves what was not overridden", () => {
    const r = remainingAfterOverride([cap, hard], ["long_run_cap"]);
    expect(r.remaining.map((b) => b.rule)).toEqual(["hard_sessions_per_week"]);
    expect(r.overridden.map((b) => b.rule)).toEqual(["long_run_cap"]);
    expect(r.unused).toEqual([]);
  });

  it("reports an override for a limit that was not broken", () => {
    const r = remainingAfterOverride([cap], ["long_run_cap", "hard_sessions_per_week"]);
    expect(r.remaining).toEqual([]);
    expect(r.unused).toEqual(["hard_sessions_per_week"]);
  });

  it("formats the line the user sees", () => {
    expect(overrideLine([cap], "Did a 1:40 h trail run on Sunday outside the app.")).toBe(
      `Went past a training limit: ${cap.message} Assistant's reason: Did a 1:40 h trail run on Sunday outside the app.`,
    );
  });
});
