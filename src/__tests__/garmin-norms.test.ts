import { isGap, rateSignal, vo2Rating, type Rating, type RatingContext } from "@/lib/garmin/analytics/norms";
import { describe, expect, it } from "vitest";

const ctx: RatingContext = { sex: "male", age: 23, hrvBaseline: null, bodyFat: null, bmi: null, chronologicalAge: null, sleepRanges: null };
const rate = (key: Parameters<typeof rateSignal>[0], v: number, over: Partial<RatingContext> = {}) => rateSignal(key, v, { ...ctx, ...over }) as Rating;
const label = (r: Rating) => r.bands[r.index].label;

describe("vo2Rating (Cooper Institute table in Garmin's manuals)", () => {
  it("rates a 23-year-old man's 51.0 as Good, 0.1 under Excellent", () => {
    const r = vo2Rating(51.0, "male", 23);
    expect(label(r)).toBe("Good");
    expect(r.next).toEqual({ label: "Excellent", gap: 0.1, dir: "up" });
    expect(r.compare).toBe("Good for men aged 20–29: better than 60 to 80 % of them.");
  });

  it("starts each band at its printed value", () => {
    expect(label(vo2Rating(51.1, "male", 29))).toBe("Excellent");
    expect(label(vo2Rating(55.4, "male", 25))).toBe("Superior");
    expect(label(vo2Rating(41.6, "male", 25))).toBe("Poor");
    expect(label(vo2Rating(39.5, "female", 25))).toBe("Good");
    expect(label(vo2Rating(39.4, "female", 25))).toBe("Fair");
  });

  it("uses the nearest decade outside 20 to 79", () => {
    expect(vo2Rating(50, "male", 17).compare).toContain("aged 20–29");
    expect(vo2Rating(50, "female", 85).compare).toContain("women aged 70–79");
    expect(vo2Rating(55, "female", 85).next).toBeNull();
  });
});

describe("rateSignal", () => {
  it("asks for sex or age when the scale depends on them", () => {
    expect(rateSignal("vo2max", 50, { ...ctx, sex: null })).toEqual({ needs: "sex" });
    expect(rateSignal("vo2max", 50, { ...ctx, age: null })).toEqual({ needs: "age" });
    expect(isGap(rateSignal("vo2max", 50, { ...ctx, sex: null }))).toBe(true);
  });

  it("uses Garmin's sleep score and body battery bands", () => {
    expect(label(rate("sleepScore", 81))).toBe("Good");
    expect(rate("sleepScore", 81).next).toEqual({ label: "Excellent", gap: 9, dir: "up" });
    expect(label(rate("sleepScore", 59))).toBe("Poor");
    expect(label(rate("bodyBattery", 91))).toBe("High");
    expect(label(rate("bodyBattery", 50))).toBe("Low");
  });

  it("treats 9 h of sleep as recommended and points a short sleeper up", () => {
    expect(label(rate("sleep", 9))).toBe("Recommended");
    expect(label(rate("sleep", 6.5))).toBe("Short");
    expect(rate("sleep", 6.5).next).toEqual({ label: "Recommended", gap: 0.5, dir: "up" });
    expect(label(rate("sleep", 10.5))).toBe("Long");
    expect(label(rate("sleep", 10.5, { age: 40 }))).toBe("Too long");
  });

  it("rates resting HR both ways, with athletic as the best band", () => {
    expect(label(rate("restingHr", 48))).toBe("Athletic");
    expect(rate("restingHr", 48).next).toBeNull();
    expect(rate("restingHr", 70).next).toEqual({ label: "Athletic", gap: 10, dir: "down" });
    expect(label(rate("restingHr", 100))).toBe("Normal");
    expect(label(rate("restingHr", 38))).toBe("Very low");
    expect(rate("restingHr", 70).bands[3].edge).toBe(100);
  });

  it("rates HRV's 7-day average against Garmin's baseline, as Garmin's status does", () => {
    const hrvBaseline = { lowUpper: 76, balancedLow: 82, balancedUpper: 109, weeklyAvg: 89 };
    expect(label(rate("hrv", 75, { hrvBaseline }))).toBe("Balanced");
    expect(label(rate("hrv", 75, { hrvBaseline: { ...hrvBaseline, weeklyAvg: 78 } }))).toBe("Unbalanced");
    expect(label(rate("hrv", 75, { hrvBaseline: { ...hrvBaseline, weeklyAvg: 70 } }))).toBe("Low");
    expect(rateSignal("hrv", 75, ctx)).toBeNull();
  });

  it("rates fitness age against the user's own age, lower being better", () => {
    expect(label(rate("fitnessAge", 18, { chronologicalAge: 23 }))).toBe("Much younger");
    expect(rate("fitnessAge", 18, { chronologicalAge: 23 }).compare).toBe("5 years younger than your age, 23.");
    expect(label(rate("fitnessAge", 23, { chronologicalAge: 23 }))).toBe("Your age");
    expect(rate("fitnessAge", 23, { chronologicalAge: 23 }).next?.dir).toBe("down");
    expect(rateSignal("fitnessAge", 30, { ...ctx, age: null })).toEqual({ needs: "age" });
  });

  it("rates weight by body fat when sex is known, else by BMI", () => {
    expect(label(rate("weight", 89.7, { bodyFat: 20.4 }))).toBe("Average");
    expect(rate("weight", 89.7, { bodyFat: 20.4 }).next).toEqual({ label: "Fitness", gap: 2.4, dir: "down" });
    expect(label(rate("weight", 70, { bodyFat: 22, sex: "female" }))).toBe("Fitness");
    expect(label(rate("weight", 89.7, { sex: null, bodyFat: 20.4, bmi: 25.9 }))).toBe("Overweight");
    expect(rateSignal("weight", 89.7, { ...ctx, sex: null, bodyFat: 20.4 })).toEqual({ needs: "sex" });
    expect(rateSignal("weight", 89.7, ctx)).toBeNull();
  });

  it("rates breathing against the adult resting range", () => {
    expect(label(rate("respiration", 15))).toBe("Normal");
    expect(label(rate("respiration", 20.4))).toBe("Normal");
    expect(label(rate("respiration", 22))).toBe("High");
  });

  it("places the marker inside its band", () => {
    expect(rate("sleepScore", 85).within).toBeCloseTo(0.5);
    expect(rate("bodyBattery", 100).within).toBeGreaterThan(0.9);
    expect(rate("restingHr", 30).within).toBe(0.5);
  });
});

describe("rateSignal: sleep quality and day to day", () => {
  const sleepRanges = { deep: [16, 33] as [number, number], rem: [21, 31] as [number, number], awakeMax: 1 };

  it("rates deep and REM share on Garmin's range for the night, the top value inside it", () => {
    expect(label(rate("deepSleep", 17, { sleepRanges }))).toBe("Optimal");
    expect(label(rate("deepSleep", 33, { sleepRanges }))).toBe("Optimal");
    expect(label(rate("deepSleep", 34, { sleepRanges }))).toBe("Above optimal");
    expect(label(rate("remSleep", 18, { sleepRanges }))).toBe("Below optimal");
    expect(rate("remSleep", 18, { sleepRanges }).next).toEqual({ label: "Optimal", gap: 3, dir: "up" });
    expect(rate("deepSleep", 34, { sleepRanges }).bands[2].edge).toBe(33);
    expect(rateSignal("deepSleep", 17, ctx)).toBeNull();
  });

  it("rates awake periods against Garmin's optimal count", () => {
    expect(label(rate("awakeCount", 1, { sleepRanges }))).toBe("Optimal");
    expect(label(rate("awakeCount", 2, { sleepRanges }))).toBe("More than optimal");
  });

  it("uses Garmin's stress bands for sleep and day stress", () => {
    expect(label(rate("sleepStress", 19))).toBe("Rest");
    expect(label(rate("stress", 26))).toBe("Low");
    expect(label(rate("stress", 76))).toBe("High");
  });

  it("rates blood oxygen and steps", () => {
    expect(label(rate("spo2", 96))).toBe("Normal");
    expect(label(rate("spo2", 92))).toBe("Low");
    expect(label(rate("spo2", 88))).toBe("Very low");
    expect(label(rate("steps", 4999))).toBe("Sedentary");
    expect(label(rate("steps", 10000))).toBe("Active");
    expect(label(rate("steps", 12500))).toBe("Highly active");
  });

  it("has no population scale for sleeping HR, sitting time and muscle mass", () => {
    for (const key of ["sleepHr", "sedentary", "muscleMass"] as const) expect(rateSignal(key, 50, ctx)).toBeNull();
  });
});
