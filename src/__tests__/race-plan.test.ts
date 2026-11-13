import { addClock, bikeGuide, fuelRates, fuelSchedule, fuelTotals, hoursMinutes, racePlan, runGuide, swimGuide } from "@/lib/utils/race-plan";
import { describe, expect, it } from "vitest";

const none = { ftp: null, lthrRun: null, lthrBike: null, runSpeed: null, swimCss: null };

describe("addClock", () => {
  it("adds minutes and wraps past midnight", () => {
    expect(addClock("07:00", 95)).toBe("08:35");
    expect(addClock("23:30", 45)).toBe("00:15");
    expect(hoursMinutes(125)).toBe("2:05");
  });
});

describe("bikeGuide", () => {
  it("follows the TSS-cap formula inside the full band", () => {
    // 6 h, cap 250-300: IF 0.645-0.707; the band floor lifts the low end to 0.65.
    const g = bikeGuide("full", 6, 200, null, false);
    expect(g.ifRange).toEqual([0.65, 0.7]);
    expect(g.watts).toEqual([130, 140]);
  });
  it("keeps a first-timer inside 0.65-0.70 on a full", () => {
    expect(bikeGuide("full", 5, 200, null, true).ifRange).toEqual([0.7, 0.7]);
  });
  it("keeps a half inside 0.75-0.85, and 0.70-0.75 for a first-timer", () => {
    expect(bikeGuide("half", 2.5, 250, 160, false).ifRange).toEqual([0.82, 0.84]);
    expect(bikeGuide("half", 3, 250, 160, true).ifRange).toEqual([0.75, 0.75]);
    expect(bikeGuide("half", 3, 250, 160, true).hrCeiling).toBe(149);
  });
  it("gives no watts without FTP", () => {
    const g = bikeGuide("half", 3, null, null, false);
    expect(g.watts).toBeNull();
    expect(g.text).toContain("Add your FTP");
  });
});

describe("run and swim guides", () => {
  it("labels the run pace as inference and gives an HR ceiling", () => {
    const r = runGuide("half", 4, 170);
    expect(r.speed![0]).toBeCloseTo(3.4);
    expect(r.hrCeiling).toBe(160);
    expect(r.evidence).toContain("Inference");
  });
  it("adds the offset to CSS pace", () => {
    // CSS 1:40/100 m (1 m/s) + 5 s = 1:45/100 m.
    expect(swimGuide(1, 5).speed).toBeCloseTo(100 / 105);
    expect(swimGuide(null, 5).speed).toBeNull();
  });
});

describe("racePlan", () => {
  it("builds the timeline with transitions and a finish time", () => {
    const p = racePlan("half", { startTime: "07:00", swimMinutes: 40, bikeMinutes: 180, runMinutes: 120 }, none, true);
    expect(p.timeline.map((r) => [r.leg, r.start])).toEqual([
      ["swim", "07:00"],
      ["t1", "07:40"],
      ["bike", "07:45"],
      ["t2", "10:45"],
      ["run", "10:48"],
      ["finish", "12:48"],
    ]);
    expect(p.totalMinutes).toBe(348);
  });
  it("marks assumed leg times when there are no thresholds and no overrides", () => {
    const p = racePlan("full", {}, none, false);
    expect(p.swim.leg.source).toBe("assumed");
    expect(p.bike.leg.minutes).toBe(Math.round(180000 / (28 / 3.6) / 60));
  });
  it("takes the swim and run times from the thresholds", () => {
    const p = racePlan("half", {}, { ...none, swimCss: 1, runSpeed: 4 }, false);
    expect(p.swim.leg).toEqual({ minutes: Math.round(1900 / (100 / 105) / 60), source: "from your thresholds" });
    expect(p.run.leg.source).toBe("from your thresholds");
  });
});

describe("fuel schedule", () => {
  it("sets the bike rate from the race target and the run 10 g/h lower", () => {
    expect(fuelRates(null, null)).toEqual({ bike: 60, run: 50 });
    expect(fuelRates(70, 90)).toEqual({ bike: 70, run: 60 });
    expect(fuelRates(120, 90)).toEqual({ bike: 90, run: 70 });
  });
  it("gives one row per interval on the bike and run, none in the swim", () => {
    const p = racePlan("half", { startTime: "07:00", swimMinutes: 40, bikeMinutes: 60, runMinutes: 40 }, none, false);
    const rows = fuelSchedule(p.timeline, 20, { carbs: { bike: 60, run: 50 }, fluid: [400, 800], sodium: [300, 600] });
    expect(rows.map((r) => [r.clock, r.leg, r.carbsG])).toEqual([
      ["08:05", "bike", 20],
      ["08:25", "bike", 20],
      ["08:45", "bike", 20],
      ["09:08", "run", 17],
      ["09:28", "run", 17],
    ]);
    expect(rows[0].fluidMl).toBe(200);
    expect(rows[0].sodiumMg).toBe(150);
  });
});

describe("review fixes: TSS cap, carbs and HR ceilings", () => {
  const tss = (hours: number, ifv: number) => hours * ifv * ifv * 100;

  it("never puts the top of the bike IF over the TSS cap at 6, 7 and 8 h", () => {
    expect(bikeGuide("full", 6, 200, null, false).ifRange).toEqual([0.65, 0.7]);
    expect(bikeGuide("full", 7, 200, null, false).ifRange).toEqual([0.65, 0.65]);
    const slow = bikeGuide("full", 8, 200, null, false);
    expect(slow.ifRange).toEqual([0.55, 0.61]);
    expect(slow.text).toContain("TSS cap");
    for (const h of [6, 7, 8]) expect(tss(h, bikeGuide("full", h, 200, null, false).ifRange[1])).toBeLessThanOrEqual(300);
  });

  it("never lifts race carbs above a low proved tolerance", () => {
    expect(fuelRates(30, 40)).toEqual({ bike: 30, run: 20 });
    expect(fuelRates(55, 70)).toEqual({ bike: 55, run: 45 });
  });

  it("sets the heart-rate ceiling per distance: a half rides and runs at zone 3", () => {
    expect(bikeGuide("half", 3, 250, 160, false).hrCeiling).toBe(149);
    expect(runGuide("half", 4, 170).hrCeiling).toBe(160);
    expect(bikeGuide("full", 6, 250, 160, false).hrCeiling).toBe(136);
    expect(runGuide("full", 4, 170).hrCeiling).toBe(145);
  });

  it("totals the fuel schedule per leg", () => {
    const p = racePlan("half", { startTime: "07:00", swimMinutes: 40, bikeMinutes: 60, runMinutes: 40 }, none, false);
    const rows = fuelSchedule(p.timeline, 20, { carbs: { bike: 60, run: 50 }, fluid: [400, 800], sodium: [300, 600] });
    expect(fuelTotals(rows)).toEqual({ bike: { carbsG: 60, fluidMl: 600, sodiumMg: 450 }, run: { carbsG: 34, fluidMl: 400, sodiumMg: 300 } });
  });
});
