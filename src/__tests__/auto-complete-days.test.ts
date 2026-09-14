import { describe, expect, it } from "vitest";
import { autoCompleteDue, autoDayKey } from "@/lib/utils/cycle-position";
import { buildTriathlonPlan } from "@/lib/utils/triathlon-plan";

type Slot = {
  id: number;
  dayOfWeek: number | null;
  orderIndex: number | null;
  programId: number | null;
  autoComplete: boolean;
};

function dowSlot(id: number, dayOfWeek: number, programId: number | null, autoComplete: boolean): Slot {
  return { id, dayOfWeek, orderIndex: null, programId, autoComplete };
}

function rotationSlot(id: number, orderIndex: number, programId: number | null, autoComplete: boolean): Slot {
  return { id, dayOfWeek: null, orderIndex, programId, autoComplete };
}

// Local-time midnight for a YYYY-MM-DD string.
function d(dateStr: string): Date {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day);
}

describe("autoCompleteDue: day-of-week", () => {
  // Mon strength (not auto), Tue run (auto), Wed rest flagged auto, Sat long run (auto).
  const slots: Slot[] = [
    dowSlot(1, 1, 101, false),
    dowSlot(2, 2, 102, true),
    dowSlot(3, 3, null, true),
    dowSlot(6, 6, 106, true),
  ];
  const base = {
    scheduleType: "day_of_week" as const,
    slots,
    todaySlotId: null,
    loggedKeys: new Set<string>(),
    skippedDates: new Set<string>(),
  };

  it("returns past and today's auto days, skipping non-auto and rest slots", () => {
    // 2026-05-04 is a Monday.
    expect(autoCompleteDue({ ...base, startDate: d("2026-05-04"), today: d("2026-05-06") })).toEqual([
      { date: "2026-05-05", programId: 102 },
    ]);
  });

  it("includes today", () => {
    expect(autoCompleteDue({ ...base, startDate: d("2026-05-04"), today: d("2026-05-05") })).toEqual([
      { date: "2026-05-05", programId: 102 },
    ]);
  });

  it("never goes before the cycle start date", () => {
    expect(autoCompleteDue({ ...base, startDate: d("2026-05-06"), today: d("2026-05-06") })).toEqual([]);
  });

  it("only looks back lookbackDays, oldest first", () => {
    expect(autoCompleteDue({ ...base, startDate: d("2026-05-04"), today: d("2026-05-18") })).toEqual([
      { date: "2026-05-12", programId: 102 },
      { date: "2026-05-16", programId: 106 },
    ]);
  });

  it("skips a day already logged for the same program, not for a different one", () => {
    const logged = autoCompleteDue({
      ...base,
      loggedKeys: new Set([autoDayKey(102, "2026-05-05")]),
      startDate: d("2026-05-04"),
      today: d("2026-05-06"),
    });
    expect(logged).toEqual([]);

    const other = autoCompleteDue({
      ...base,
      loggedKeys: new Set([autoDayKey(101, "2026-05-05")]),
      startDate: d("2026-05-04"),
      today: d("2026-05-06"),
    });
    expect(other).toEqual([{ date: "2026-05-05", programId: 102 }]);
  });

  it("skips a dismissed date", () => {
    expect(
      autoCompleteDue({
        ...base,
        skippedDates: new Set(["2026-05-05"]),
        startDate: d("2026-05-04"),
        today: d("2026-05-06"),
      }),
    ).toEqual([]);
  });
});

describe("autoCompleteDue: rotation", () => {
  const slots: Slot[] = [rotationSlot(1, 1, 201, true), rotationSlot(2, 2, 202, false)];
  const base = {
    scheduleType: "rotation" as const,
    slots,
    loggedKeys: new Set<string>(),
    skippedDates: new Set<string>(),
    startDate: d("2026-05-01"),
    today: d("2026-05-03"),
  };

  it("only completes today's slot when it is auto", () => {
    expect(autoCompleteDue({ ...base, todaySlotId: 1 })).toEqual([{ date: "2026-05-03", programId: 201 }]);
    expect(autoCompleteDue({ ...base, todaySlotId: 2 })).toEqual([]);
  });

  it("skips today when already logged or dismissed", () => {
    expect(
      autoCompleteDue({ ...base, todaySlotId: 1, loggedKeys: new Set([autoDayKey(201, "2026-05-03")]) }),
    ).toEqual([]);
    expect(autoCompleteDue({ ...base, todaySlotId: 1, skippedDates: new Set(["2026-05-03"]) })).toEqual([]);
  });
});

describe("buildTriathlonPlan autoComplete", () => {
  it("turns it on for swim/bike/run-only days and off for strength days", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    expect(plan.days.map((day) => day.autoComplete)).toEqual([false, true, true, false, true, true, true]);
  });

  it("is off on rest days, and follows a relocated endurance session", () => {
    // Fri+Sat rest: the long run moves onto Tuesday.
    const plan = buildTriathlonPlan({ weeks: 12, restDays: [5, 6] });
    expect(plan.days.map((day) => day.autoComplete)).toEqual([false, true, true, false, false, false, true]);
  });
});
