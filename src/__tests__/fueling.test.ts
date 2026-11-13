import {
  CARB_CEILING_G_H,
  caffeinePlan,
  carbTarget,
  carbsPerHour,
  fluidPlan,
  gutTraining,
  itemTotals,
  raceMorning,
  sodiumPlan,
  sweatRate,
  sweatTestError,
  fuelLogError,
} from "@/lib/utils/fueling";
import { describe, expect, it } from "vitest";

const min = (m: number) => m * 60;

describe("carbTarget", () => {
  it("needs no target under 90 minutes", () => {
    expect(carbTarget(min(89)).kind).toBe("none");
  });
  it("is optional from 90 minutes to 2 hours", () => {
    expect(carbTarget(min(90)).kind).toBe("optional");
    expect(carbTarget(min(120)).kind).toBe("optional");
  });
  it("asks for race fueling over 2 hours, inside the untrained band", () => {
    const t = carbTarget(min(121));
    expect(t.kind).toBe("practise");
    expect(t.bike).toEqual([60, 80]);
    expect(t.run).toEqual([50, 70]);
    expect(t.ceiling).toBe(CARB_CEILING_G_H);
  });
  it("allows 90 g/h only over 2.5 hours with a gut proved at 90", () => {
    expect(carbTarget(min(150), 90).bike).toEqual([60, 80]);
    expect(carbTarget(min(151), 90).bike).toEqual([60, 90]);
    expect(carbTarget(min(151), 80).bike).toEqual([60, 80]);
  });
  it("never goes above 90 g/h without a proved tolerance above 90", () => {
    expect(carbTarget(min(300)).ceiling).toBe(90);
    const t = carbTarget(min(300), 100);
    expect(t.ceiling).toBe(100);
    expect(t.bike).toEqual([60, 100]);
    expect(t.text).toContain("no clear performance gain");
  });
});

describe("gutTraining", () => {
  const log = (carbsG: number, minutes: number, giScore: number | null, day = "2026-11-01") => ({ carbsG, durationS: min(minutes), giScore, day });

  it("starts at 60 g/h with nothing proved", () => {
    const g = gutTraining([]);
    expect(g.proved).toBeNull();
    expect(g.next).toBe(60);
    expect(g.raceTarget).toBeNull();
  });
  it("counts only 90 min+ sessions with a GI score under 4", () => {
    const g = gutTraining([log(150, 120, 3, "2026-11-01"), log(200, 120, 4, "2026-10-01"), log(200, 120, null, "2026-10-02"), log(200, 80, 0, "2026-10-03")]);
    expect(g.proved).toBe(75);
  });
  it("steps up 10 g/h and races at 80 % of proved", () => {
    const g = gutTraining([log(140, 120, 1)]);
    expect(g.proved).toBe(70);
    expect(g.next).toBe(80);
    expect(g.raceTarget).toBe(55);
  });
  it("holds after a session with symptoms", () => {
    const g = gutTraining([log(140, 120, 1, "2026-11-01"), log(160, 120, 6, "2026-11-05")]);
    expect(g.lastHadSymptoms).toBe(true);
    expect(g.next).toBe(70);
  });
  it("does not step past 90 g/h", () => {
    expect(gutTraining([log(170, 120, 0)]).next).toBe(90);
    expect(gutTraining([log(200, 120, 0)]).next).toBe(90);
  });
  it("gives no carbs per hour without a duration", () => {
    expect(carbsPerHour({ carbsG: 50, durationS: null })).toBeNull();
  });
});

describe("sweat test", () => {
  const base = { durationS: min(60), preKg: 70, postKg: 69, fluidMl: 500, urineMl: 0 };
  it("computes (pre - post + fluid - urine) / hours", () => {
    expect(sweatRate(base).mlPerHour).toBe(1500);
    expect(sweatRate({ ...base, urineMl: 200, durationS: min(120) }).mlPerHour).toBe(650);
    expect(sweatRate(base).massChangePct).toBe(-1.4);
  });
  it("flags a weight gain as over-drinking", () => {
    expect(sweatRate({ ...base, postKg: 70.2, fluidMl: 1500 }).flags[0]).toContain("red flag");
  });
  it("refuses likely typos", () => {
    expect(sweatTestError(base)).toBeNull();
    expect(sweatTestError({ ...base, durationS: min(20) })).toContain("30 to 240");
    expect(sweatTestError({ ...base, postKg: 60 })).toContain("5 %");
    expect(sweatTestError({ ...base, preKg: 20, postKg: 20 })).toContain("30 to 250");
    expect(sweatTestError({ ...base, postKg: 70.5, fluidMl: 0 })).toContain("0 to 4,000");
  });
});

describe("fluid and sodium", () => {
  it("gives 50-80 % of the sweat rate, never above it", () => {
    const f = fluidPlan(1000);
    expect([f.low, f.high]).toEqual([500, 800]);
    const small = fluidPlan(60);
    expect(small.high).toBeLessThanOrEqual(60);
    expect(f.text).toContain("Never drink more than you sweat");
  });
  it("uses the default band without a test", () => {
    const f = fluidPlan(null);
    expect([f.low, f.high]).toEqual([400, 900]);
  });
  it("scales sodium by a lab value and clamps it to 300-1,000 mg/h", () => {
    expect([sodiumPlan({ low: 400, high: 900 }).low, sodiumPlan({ low: 400, high: 900 }).high]).toEqual([300, 600]);
    const s = sodiumPlan({ low: 500, high: 800 }, 1000);
    expect([s.low, s.high]).toEqual([500, 800]);
    const big = sodiumPlan({ low: 800, high: 1200 }, 2000);
    expect(big.high).toBe(1000);
    expect(big.text).toContain("ask a professional");
    expect(sodiumPlan({ low: 100, high: 200 }, 300).low).toBe(300);
  });
});

describe("caffeine and race morning", () => {
  it("stays inside 3-6 mg/kg", () => {
    const c = caffeinePlan(70)!;
    expect(c.preMg).toBe(210);
    expect(c.lateMg).toEqual([70, 210]);
    expect(c.totalMaxMg).toBe(420);
    expect(caffeinePlan(null)).toBeNull();
  });
  it("gives grams from body weight", () => {
    expect(raceMorning(70)[1].text).toContain("70-210 g");
    expect(raceMorning(null)[1].text).not.toContain(" g)");
  });
});

describe("itemTotals", () => {
  it("sums products by count and keeps a field no product has as null", () => {
    expect(
      itemTotals([
        { productId: 1, name: "Gel", count: 3, carbsG: 25, sodiumMg: 50, caffeineMg: null, fluidMl: null },
        { productId: 2, name: "Drink", count: 2, carbsG: 40, sodiumMg: 300, caffeineMg: null, fluidMl: 500 },
      ]),
    ).toEqual({ carbsG: 155, sodiumMg: 750, caffeineMg: null, fluidMl: 1000 });
  });
});

describe("review fixes: carb caps and no-sweat tests", () => {
  const log = (carbsG: number, minutes: number, giScore: number | null, day = "2026-11-01") => ({ carbsG, durationS: min(minutes), giScore, day });

  it("never proves more than 120 g/h", () => {
    const g = gutTraining([log(300, 90, 1, "2026-11-01"), log(300, 90, 1, "2026-11-02")]);
    expect(g.proved).toBe(120);
    expect(g.raceTarget).toBe(95);
    expect(carbTarget(min(300), 200).ceiling).toBe(120);
  });

  it("needs more than one tolerated log above 90 g/h before the ceiling passes 90", () => {
    expect(gutTraining([log(200, 120, 0)]).proved).toBe(90);
    expect(gutTraining([log(200, 120, 0, "2026-11-01"), log(210, 120, 1, "2026-11-08")]).proved).toBe(105);
  });

  it("refuses a log above 150 g/h as a likely typo", () => {
    expect(fuelLogError({ carbsG: 300, durationS: min(90) })).toContain("150 g/h");
    expect(fuelLogError({ carbsG: 225, durationS: min(90) })).toBeNull();
    expect(fuelLogError({ carbsG: 300, durationS: null })).toBeNull();
  });

  it("treats a measured sweat rate of 0, or one too small to split, as its own case", () => {
    for (const rate of [0, 1, 31, -200]) {
      const f = fluidPlan(rate);
      expect(f.high).toBeLessThanOrEqual(Math.max(0, rate));
      expect(f.low).toBe(0);
      expect(f.text).toContain("Drink to thirst");
      expect(f.text).toContain("retest");
    }
    expect(fluidPlan(null).high).toBe(900);
  });

  it("rounds the fluid band down, so its top never passes 80 % of the sweat rate", () => {
    for (let rate = 100; rate <= 400; rate += 5) {
      const f = fluidPlan(rate);
      expect(f.high).toBeLessThanOrEqual(rate * 0.8);
      expect(f.low).toBeLessThanOrEqual(f.high);
    }
    expect([fluidPlan(1000).low, fluidPlan(1000).high]).toEqual([500, 800]);
  });
});
