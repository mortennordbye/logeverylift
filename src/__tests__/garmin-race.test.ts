import { compareBricks, pacingGuide, sweatModel, taperStart, type FuelSession } from "@/lib/garmin/analytics/race";
import { describe, expect, it } from "vitest";

describe("taperStart", () => {
  it("starts after the ramp and peak weeks", () => {
    // 24 weeks: 3 taper, 2 peak, 19 ramp.
    expect(taperStart("2026-09-07", 24)).toBe("2027-02-01");
  });
});

describe("pacingGuide", () => {
  it("gives a lower intensity for a full distance than for a 70.3", () => {
    const base = { ftp: 200, cs: 4, lthrBike: 160, lthrRun: 170 };
    const full = pacingGuide({ distance: "full", ...base });
    const half = pacingGuide({ distance: "half", ...base });
    expect(full.bikeWatts).toEqual([136, 150]);
    expect(half.bikeWatts).toEqual([150, 164]);
    expect(full.runSpeed![1]).toBeCloseTo(3.4);
    expect(full.bikeHrCeiling).toBe(136);
    expect(full.runHrCeiling).toBe(145);
    expect(pacingGuide({ distance: "full", ftp: null, cs: null, lthrBike: null, lthrRun: null })).toEqual({ bikeWatts: null, bikeHrCeiling: null, runSpeed: null, runHrCeiling: null });
  });
});

describe("compareBricks", () => {
  it("compares a brick run with fresh runs at the same heart rate", () => {
    const brick = { id: 1, day: "2026-11-01", speed: 2.7, hr: 150, durationS: 1800 };
    const fresh = [
      { id: 2, day: "2026-10-20", speed: 3.0, hr: 152, durationS: 2400 },
      { id: 3, day: "2026-10-25", speed: 3.0, hr: 148, durationS: 2400 },
      { id: 4, day: "2026-10-26", speed: 4.0, hr: 170, durationS: 2400 },
    ];
    const [c] = compareBricks([brick], fresh);
    expect(c.freshCount).toBe(2);
    expect(c.diffPct).toBeCloseTo(-10);
    expect(compareBricks([brick], [])[0].diffPct).toBeNull();
  });
});

describe("sweatModel", () => {
  const s = (temperature: number, mlPerHour: number, i: number): FuelSession => ({ id: i, day: "2026-11-01", name: "Ride", sport: "bike", durationS: 7200, sweatMl: mlPerHour * 2, temperature, carbsG: null, fluidMl: null });

  it("fits sweat loss per hour against temperature", () => {
    const m = sweatModel([10, 14, 18, 22, 26].map((t, i) => s(t, 300 + 25 * t, i)))!;
    expect(m.slope).toBeCloseTo(25);
    expect(m.at.find((a) => a.temperature === 20)?.mlPerHour).toBe(800);
  });

  it("waits for five sessions and a 4 °C spread", () => {
    expect(sweatModel([10, 14, 18, 22].map((t, i) => s(t, 600, i)))).toBeNull();
    expect(sweatModel([15, 15, 16, 16, 17].map((t, i) => s(t, 600, i)))).toBeNull();
  });
});
