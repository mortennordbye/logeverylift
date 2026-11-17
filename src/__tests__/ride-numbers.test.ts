import { POWER_COVERAGE_MIN, doneRideNumbers } from "@/lib/utils/ride-numbers";
import { describe, expect, it } from "vitest";

/** The mockup ride (docs/plans/bike-ride-logger.md, 4.6): step averages over 15, 15, 5, 15, 15 min. */
const MOCKUP = [
  { seconds: 900, avgPower: 124 },
  { seconds: 900, avgPower: 141 },
  { seconds: 300, avgPower: 92 },
  { seconds: 900, avgPower: 131 },
  { seconds: 900, avgPower: 118 },
];

describe("doneRideNumbers", () => {
  it("gives the mockup numbers: avg 126 W, estimated NP 127 W, estimated load 54, 490 kJ", () => {
    const n = doneRideNumbers(MOCKUP, { ftp: 180, rpe: 6 });
    expect(n.seconds).toBe(3900);
    expect(Math.round(n.avgPower!)).toBe(126);
    expect(Math.round(n.npEstimate!)).toBe(127);
    expect(n.load).toMatchObject({ method: "power", estimated: true });
    expect(Math.round(n.load!.value)).toBe(54);
    expect(n.kj).toBe(490);
    expect(n.powerCoverage).toBe(1);
    // NP and IF come from a stream only (step 7).
    expect(n.np).toBeNull();
    expect(n.intensityFactor).toBeNull();
  });

  it("puts each step's time in the zone of its average", () => {
    // FTP 180: 124 W is 69% (Z2), 141 W 78% (Z3), 92 W 51% (Z1), 131 W 73% (Z2), 118 W 66% (Z2).
    const n = doneRideNumbers(MOCKUP, { ftp: 180, rpe: null });
    expect(n.zoneMinutes).toEqual([5, 45, 15, 0, 0, 0, 0]);
  });

  it("without an FTP: avg power and kJ, no zones, the effort load", () => {
    const n = doneRideNumbers(MOCKUP, { ftp: null, rpe: 6 });
    expect(Math.round(n.avgPower!)).toBe(126);
    expect(n.kj).toBe(490);
    expect(n.npEstimate).toBeNull();
    expect(n.zoneMinutes.every((m) => m === 0)).toBe(true);
    // 65 min x 6 x 0.22
    expect(n.load).toMatchObject({ method: "effort", estimated: true });
    expect(n.load!.value).toBeCloseTo(65 * 6 * 0.22);
  });

  it("without an FTP and without effort: no load", () => {
    expect(doneRideNumbers(MOCKUP, { ftp: null, rpe: null }).load).toBeNull();
  });

  it("power on under 90% of the time: avg power of those steps, no kJ, the effort load", () => {
    const partial = MOCKUP.map((s, i) => (i === 4 ? { ...s, avgPower: null } : s));
    const n = doneRideNumbers(partial, { ftp: 180, rpe: 5 });
    expect(n.powerCoverage).toBeLessThan(POWER_COVERAGE_MIN);
    expect(Math.round(n.avgPower!)).toBe(Math.round((124 * 900 + 141 * 900 + 92 * 300 + 131 * 900) / 3000));
    expect(n.kj).toBeNull();
    expect(n.load?.method).toBe("effort");
  });

  it("power on 90% of the time or more still gives the power load", () => {
    const steps = [
      { seconds: 900, avgPower: 150 },
      { seconds: 100, avgPower: null },
    ];
    const n = doneRideNumbers(steps, { ftp: 200, rpe: null });
    expect(n.powerCoverage).toBeCloseTo(0.9);
    expect(n.load?.method).toBe("power");
    // Hours of the whole ride.
    expect(n.load!.value).toBeCloseTo((1000 / 3600) * 0.75 ** 2 * 100);
  });

  it("no steps: nothing", () => {
    const n = doneRideNumbers([], { ftp: 180, rpe: 7 });
    expect(n).toMatchObject({ seconds: 0, avgPower: null, kj: null, load: null, powerCoverage: 0 });
  });

  it("an ended-early ride counts only the steps given (the ridden ones)", () => {
    const n = doneRideNumbers(MOCKUP.slice(0, 2), { ftp: 180, rpe: null });
    expect(n.seconds).toBe(1800);
    expect(Math.round(n.avgPower!)).toBe(133);
    expect(n.kj).toBe(Math.round((132.5 * 1800) / 1000));
  });

  it("time only and no effort: no load, listed as missing", () => {
    const n = doneRideNumbers(MOCKUP.map((s) => ({ ...s, avgPower: null })), { ftp: 180, rpe: null });
    expect(n.avgPower).toBeNull();
    expect(n.load).toBeNull();
  });
});
