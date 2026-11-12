import { bodyBatteryDay } from "@/lib/garmin/analytics/daily";
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

describe("bodyBatteryDay", () => {
  const HOUR = 3_600_000;
  it("reads the key levels in local time and the events with their impact", () => {
    const j = {
      bodyBatteryValuesArray: [[2 * HOUR, 97], [0, 49], [3 * HOUR, null]],
      bodyBatteryActivityEvent: [
        { eventType: "ACTIVITY", shortFeedback: "IMPROVING_AEROBIC_BASE", bodyBatteryImpact: -8, eventStartTimeGmt: "2026-11-11T14:49:21.0", durationInMilliseconds: 2_880_000, timezoneOffset: HOUR },
        { eventType: "SLEEP", shortFeedback: "NONE", bodyBatteryImpact: 70, eventStartTimeGmt: "2026-11-10T20:54:37.0", durationInMilliseconds: 30_960_000, timezoneOffset: HOUR },
      ],
    };
    const bb = bodyBatteryDay(j, HOUR)!;
    expect(bb.points).toEqual([{ t: HOUR, level: 49 }, { t: 3 * HOUR, level: 97 }]);
    expect(bb.events).toEqual([
      { type: "SLEEP", start: Date.parse("2026-11-10T21:54:37Z"), minutes: 516, impact: 70, feedback: null },
      { type: "ACTIVITY", start: Date.parse("2026-11-11T15:49:21Z"), minutes: 48, impact: -8, feedback: "IMPROVING_AEROBIC_BASE" },
    ]);
  });

  it("is null for a day with no levels yet", () => {
    expect(bodyBatteryDay({ bodyBatteryValuesArray: [[1, null]] }, 0)).toBeNull();
    expect(bodyBatteryDay(null, 0)).toBeNull();
  });
});
