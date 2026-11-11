import { DEFAULT_SPEED_MPS, byGap, demandsChecklist, findBricks, meanSpeeds, plannedHours, weeklyVolume, type VolumeActivity } from "@/lib/garmin/analytics/demands";
import { mondayOf } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const today = "2026-11-11"; // a Wednesday
let next = 1;
function act(p: Partial<VolumeActivity> & Pick<VolumeActivity, "sport" | "day" | "durationS">): VolumeActivity {
  return { id: next++, startMs: null, endMs: null, distanceM: null, indoor: false, ...p };
}
const at = (day: string, hh: number, mm = 0) => Date.parse(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);

describe("mondayOf", () => {
  it("gives the Monday on or before the date", () => {
    expect(mondayOf("2026-11-11")).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
  });
});

describe("weeklyVolume", () => {
  it("sums hours per sport per week, keeps empty weeks, and keeps the longest session per sport", () => {
    const acts = [
      act({ sport: "bike", day: "2026-11-10", durationS: 3600 }),
      act({ sport: "bike", day: "2026-11-11", durationS: 7200, distanceM: 60000 }),
      act({ sport: "swim", day: "2026-11-10", durationS: 1800, distanceM: 1500 }),
      act({ sport: "swim", day: "2026-11-11", durationS: 2400, distanceM: 1200 }),
      act({ sport: "strength", day: "2026-10-27", durationS: 1800 }),
    ];
    const w = weeklyVolume(acts, "2026-10-26", today);
    expect(w.map((x) => x.weekStart)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(w[0].hours.strength).toBe(0.5);
    expect(w[1].totalHours).toBe(0);
    expect(w[2].hours.bike).toBe(3);
    expect(w[2].longest.bike?.durationS).toBe(7200);
    // A swim's length is its distance, not its time.
    expect(w[2].longest.swim?.distanceM).toBe(1500);
  });
});

describe("findBricks", () => {
  it("pairs a run that starts within 15 minutes of a ride ending, and nothing later", () => {
    const ride = act({ sport: "bike", day: today, durationS: 7200, startMs: at(today, 8), endMs: at(today, 10) });
    const run = act({ sport: "run", day: today, durationS: 1800, startMs: at(today, 10, 6) });
    const late = act({ sport: "run", day: today, durationS: 1800, startMs: at(today, 11) });
    const b = findBricks([ride, run, late]);
    expect(b).toEqual([{ rideId: ride.id, runId: run.id, day: today, gapMin: 6, runDurationS: 1800 }]);
  });
});

describe("demandsChecklist", () => {
  const base = [
    act({ sport: "bike", day: "2026-11-01", durationS: 2.1 * 3600 }),
    act({ sport: "bike", day: "2026-08-01", durationS: 6 * 3600 }), // outside 8 weeks
    act({ sport: "run", day: "2026-11-05", durationS: 3 * 3600 }),
    act({ sport: "swim", day: "2026-10-20", durationS: 1200, distanceM: 700 }),
  ];

  it("checks the longest session per leg in 8 weeks against the race targets", () => {
    const rows = demandsChecklist({ activities: base, distance: "full", today, ramps: [3, 9, null] });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.bike).toMatchObject({ met: false, best: "2:06 h", target: "4:30 h" });
    expect(by.bike.progress).toBeCloseTo(2.1 / 4.5);
    expect(by.bike.next).toBe("2:36 h");
    expect(by.run).toMatchObject({ met: true, next: null });
    expect(by.swim).toMatchObject({ met: false, best: "0.7 km", next: "1.1 km" });
    expect(by.brick).toMatchObject({ met: false, best: "none" });
    expect(by.ramp).toMatchObject({ met: false, best: "max 9.0/wk" });
  });

  it("uses smaller targets for a 70.3, and ranks the largest gap first", () => {
    const rows = demandsChecklist({ activities: base, distance: "half", today, ramps: [2] });
    expect(rows.find((r) => r.key === "swim")?.target).toBe("1.9 km");
    expect(byGap(rows)[0].key).toBe("brick");
    expect(rows.find((r) => r.key === "ramp")?.met).toBe(true);
  });

  it("steps the next swim from the longest of the last 4 weeks, not past the target", () => {
    const rows = demandsChecklist({ activities: [act({ sport: "swim", day: "2026-11-08", durationS: 3600, distanceM: 2800 })], distance: "full", today, ramps: [] });
    expect(rows.find((r) => r.key === "swim")?.next).toBe("3.0 km");
    expect(rows.find((r) => r.key === "ramp")).toMatchObject({ met: false, best: "no data" });
  });
});

describe("plannedHours", () => {
  it("adds timed sets and turns distance sets into time with the user's speed or the default", () => {
    const h = plannedHours(
      [
        { discipline: "bike", durationS: 5400, distanceM: null },
        { discipline: "run", durationS: null, distanceM: 10000 },
        { discipline: "swim", durationS: null, distanceM: 1350 },
      ],
      { run: 10000 / 3600 },
    );
    expect(h!.bike).toBe(1.5);
    expect(h!.run).toBeCloseTo(1);
    expect(h!.swim).toBeCloseTo(1350 / DEFAULT_SPEED_MPS.swim / 3600);
  });

  it("is null when the week plans nothing", () => {
    expect(plannedHours([])).toBeNull();
    expect(plannedHours([{ discipline: "run", durationS: null, distanceM: null }])).toBeNull();
  });

  it("takes the mean speed from three or more outdoor sessions", () => {
    const runs = [1, 2, 3].map(() => act({ sport: "run", day: today, durationS: 3600, distanceM: 12000 }));
    expect(meanSpeeds([...runs, act({ sport: "run", day: today, durationS: 3600, distanceM: 1000, indoor: true })]).run).toBeCloseTo(12000 / 3600);
    expect(meanSpeeds(runs.slice(0, 2)).run).toBeUndefined();
  });
});
