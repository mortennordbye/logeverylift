import { bodySignal } from "@/lib/garmin/analytics/overview";
import { signalDays } from "@/lib/garmin/charts/body";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const today = "2026-11-12";

describe("signalDays", () => {
  it("has one slot per calendar day, a gap where a day has no value", () => {
    const s = bodySignal([{ date: addDays(today, -2), value: 50 }, { date: today, value: 52 }], today, { days: 90 });
    expect(signalDays(s)).toEqual({ dates: [addDays(today, -2), addDays(today, -1), today], values: [50, null, 52], mean7: null });
  });

  it("adds a 7-day mean for a daily signal, once 4 days are in the window", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ date: addDays(today, i - 29), value: i % 2 ? 60 : 40 }));
    const d = signalDays(bodySignal(points, today, { days: 90 }));
    expect(d.mean7![2]).toBeNull();
    expect(d.mean7![3]).toBe(50);
    expect(d.mean7!.at(-1)).toBeCloseTo((4 * 60 + 3 * 40) / 7);
  });

  it("is empty without points", () => {
    expect(signalDays(bodySignal([], today))).toEqual({ dates: [], values: [], mean7: null });
  });
});
