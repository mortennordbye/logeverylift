import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  cycleWeek,
  findDayOfWeekMissed,
  parseDateStr,
  resolveRotation,
  toDateStr,
  walkRotation,
  wouldEndActiveCycle,
} from "@/lib/utils/cycle-position";

// One timezone ahead of UTC, one behind, and UTC itself. Node applies a changed
// process.env.TZ to every Date created afterwards.
describe.each(["Europe/Oslo", "America/New_York", "UTC"])("cycle week arithmetic in %s", (tz) => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // A 24-week block from Mon 2 Mar 2026: 168 days, last day Sun 16 Aug. Both US
  // (8 Mar) and EU (29 Mar) DST changes fall inside it.
  const weeks = 24;

  it("a new length ends an active cycle once the days it covers have passed, across a DST change", () => {
    // 23 Mar to 30 Mar 2026 is 7 days; the EU clocks change on 29 Mar.
    const active = { status: "active", startDate: "2026-03-23", durationWeeks: 4, durationDays: null };
    expect(wouldEndActiveCycle(active, 1, parseDateStr("2026-03-30"))).toBe(true);
    expect(wouldEndActiveCycle(active, 1, parseDateStr("2026-03-29"))).toBe(false);
    expect(wouldEndActiveCycle(active, 2, parseDateStr("2026-03-30"))).toBe(false);
    // An unchanged length keeps its days (T8): 10 days end on day 10.
    expect(wouldEndActiveCycle({ ...active, durationWeeks: 2, durationDays: 10 }, 2, parseDateStr("2026-04-02"))).toBe(true);
    expect(wouldEndActiveCycle({ ...active, status: "draft" }, 1, parseDateStr("2026-03-30"))).toBe(false);
  });

  it("reads a date column as that calendar day at local midnight", () => {
    const start = parseDateStr("2026-03-02");
    expect(toDateStr(start)).toBe("2026-03-02");
    expect(start.getHours()).toBe(0);
  });

  it("is week 1 on the start day, whatever the time", () => {
    const start = parseDateStr("2026-03-02");
    expect(cycleWeek(start, weeks, parseDateStr("2026-03-02"))).toMatchObject({
      currentWeek: 1,
      elapsedDays: 0,
      isOver: false,
    });
    expect(cycleWeek(start, weeks, new Date(2026, 2, 2, 23, 30)).currentWeek).toBe(1);
  });

  it("starts week 2 on day 7, across a DST change", () => {
    const start = parseDateStr("2026-03-02");
    expect(cycleWeek(start, weeks, parseDateStr("2026-03-08")).currentWeek).toBe(1);
    expect(cycleWeek(start, weeks, parseDateStr("2026-03-09")).currentWeek).toBe(2);
    expect(cycleWeek(start, weeks, parseDateStr("2026-03-30")).currentWeek).toBe(5);
  });

  it("is the final week, not over, on the last day", () => {
    const start = parseDateStr("2026-03-02");
    expect(cycleWeek(start, weeks, parseDateStr("2026-08-16"))).toMatchObject({
      currentWeek: 24,
      elapsedDays: 167,
      isOver: false,
    });
  });

  it("is over on the day after, and never reports a week past the block", () => {
    const start = parseDateStr("2026-03-02");
    const result = cycleWeek(start, weeks, parseDateStr("2026-08-17"));
    expect(result.isOver).toBe(true);
    expect(result.currentWeek).toBe(24);
    expect(toDateStr(result.endDate)).toBe("2026-08-17");
  });

  it("never reports week 0 before the start", () => {
    const start = parseDateStr("2026-03-02");
    expect(cycleWeek(start, weeks, addDays(start, -1)).currentWeek).toBe(1);
  });
});

// Slots are minimal SlotLike objects matching the helper signature.
type Slot = {
  id: number;
  dayOfWeek: number | null;
  orderIndex: number | null;
  programId: number | null;
};

function rotationSlot(
  id: number,
  orderIndex: number,
  programId: number | null,
): Slot {
  return { id, dayOfWeek: null, orderIndex, programId };
}

function dowSlot(id: number, dayOfWeek: number, programId: number | null): Slot {
  return { id, dayOfWeek, orderIndex: null, programId };
}

// Build a local-time Date at midnight for a YYYY-MM-DD string.
function d(dateStr: string): Date {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day);
}

describe("walkRotation — push/pull/legs/rest/rest", () => {
  // Slots: [push(101), pull(102), legs(103), rest, rest]
  const slots: Slot[] = [
    rotationSlot(1, 1, 101),
    rotationSlot(2, 2, 102),
    rotationSlot(3, 3, 103),
    rotationSlot(4, 4, null),
    rotationSlot(5, 5, null),
  ];
  const start = d("2026-05-01");

  it("position is 0 on day 0 with no sessions (still push)", () => {
    const r = resolveRotation(start, slots, [], start);
    expect(r.todaySlotId).toBe(1);
    expect(r.missed).toHaveLength(0);
  });

  it("position stays on push next day with no sessions (active slot waits)", () => {
    const r = resolveRotation(start, slots, [], d("2026-05-02"));
    expect(r.todaySlotId).toBe(1);
    expect(r.missed).toEqual([
      { date: "2026-05-01", slotIndex: 0, slotId: 1 },
    ]);
  });

  it("advances to pull when push session is logged on day 0", () => {
    const r = resolveRotation(start, slots, ["2026-05-01"], d("2026-05-02"));
    expect(r.todaySlotId).toBe(2);
    expect(r.missed).toHaveLength(0);
  });

  it("auto-advances rest slots by calendar day after all active are done", () => {
    const sessions = ["2026-05-01", "2026-05-02", "2026-05-03"];
    expect(resolveRotation(start, slots, sessions, d("2026-05-04")).todaySlotId).toBe(4);
    expect(resolveRotation(start, slots, sessions, d("2026-05-05")).todaySlotId).toBe(5);
    expect(resolveRotation(start, slots, sessions, d("2026-05-06")).todaySlotId).toBe(1);
  });

  it("repeats slot semantics — sessions don't backfill missed slots", () => {
    const r = resolveRotation(start, slots, ["2026-05-03"], d("2026-05-04"));
    expect(r.todaySlotId).toBe(2);
    expect(r.missed.map((m) => m.date)).toEqual(["2026-05-01", "2026-05-02"]);
  });

  it("future startDate produces no missed and stays on first slot", () => {
    const r = resolveRotation(d("2026-06-01"), slots, [], d("2026-05-15"));
    expect(r.todaySlotId).toBe(1);
    expect(r.missed).toHaveLength(0);
  });

  it("empty slots produces null todaySlot", () => {
    const r = resolveRotation(start, [], [], d("2026-05-05"));
    expect(r.todaySlotId).toBeNull();
    expect(r.missed).toHaveLength(0);
  });
});

describe("walkRotation — position counter", () => {
  it("counts position correctly across many cycles", () => {
    const slots: Slot[] = [
      rotationSlot(1, 1, 101),
      rotationSlot(2, 2, null),
    ];
    const sessions = ["2026-05-01", "2026-05-03", "2026-05-05"];
    const result = walkRotation(d("2026-05-01"), slots, sessions, d("2026-05-06"));
    // Walk processes days 01..05 (today=06 is not consumed):
    //   01 push (logged)→pos1, 02 rest→pos2, 03 push (logged)→pos3,
    //   04 rest→pos4, 05 push (logged)→pos5.
    expect(result.position).toBe(5);
    expect(result.missed).toHaveLength(0);
  });
});

describe("findDayOfWeekMissed", () => {
  const slots: Slot[] = [
    dowSlot(11, 1, 201), // Mon = push
    dowSlot(12, 2, 202), // Tue = pull
    dowSlot(13, 3, 203), // Wed = legs
    dowSlot(14, 4, null), // Thu = rest
  ];

  it("flags missed Mon/Tue when today is Wed and no sessions logged", () => {
    // 2026-05-04 is a Monday. Today is Wed 2026-05-06.
    const start = d("2026-05-04");
    const missed = findDayOfWeekMissed(start, slots, new Set(), d("2026-05-06"));
    expect(missed.map((m) => m.date)).toEqual(["2026-05-04", "2026-05-05"]);
    expect(missed.map((m) => m.slotId)).toEqual([11, 12]);
  });

  it("does not flag rest days", () => {
    // Today = Fri 2026-05-08. Window covers Mon..Thu.
    const start = d("2026-05-04");
    const missed = findDayOfWeekMissed(start, slots, new Set(), d("2026-05-08"));
    expect(missed.map((m) => m.slotId)).toEqual([11, 12, 13]);
  });

  it("excludes days with a completed session", () => {
    const start = d("2026-05-04");
    const completed = new Set(["2026-05-04"]);
    const missed = findDayOfWeekMissed(start, slots, completed, d("2026-05-06"));
    expect(missed.map((m) => m.date)).toEqual(["2026-05-05"]);
  });

  it("clears a missed day made up on a later date (intendedDate attribution)", () => {
    // Mon 2026-05-04 was missed; user makes it up Wed, logging a session whose
    // intendedDate is Mon. The caller folds intendedDate into the satisfied set,
    // so Mon must no longer be flagged — only Tue remains.
    const start = d("2026-05-04");
    const satisfied = new Set(["2026-05-04"]); // sourced from the make-up's intendedDate
    const missed = findDayOfWeekMissed(start, slots, satisfied, d("2026-05-06"));
    expect(missed.map((m) => m.date)).toEqual(["2026-05-05"]);
  });

  it("does not look before startDate", () => {
    const start = d("2026-05-06");
    const missed = findDayOfWeekMissed(start, slots, new Set(), d("2026-05-08"));
    expect(missed.map((m) => m.slotId)).toEqual([13]);
  });

  it("returns chronological order ascending", () => {
    const start = d("2026-05-04");
    const missed = findDayOfWeekMissed(start, slots, new Set(), d("2026-05-07"));
    const dates = missed.map((m) => m.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("handles a future startDate by returning nothing", () => {
    const missed = findDayOfWeekMissed(
      d("2026-06-01"),
      slots,
      new Set(),
      d("2026-05-15"),
    );
    expect(missed).toHaveLength(0);
  });
});

// Characterization tests for package C2 (docs/plans/sessions.md, 8.1, C1 and
// C2): what a lifter gets today. They pass on main before the session model
// changes, and their assertions must not change after it.
describe("C2 characterization: findDayOfWeekMissed (C1)", () => {
  // Mon = 201, Wed = 203, Sat = rest; Tue, Thu, Fri and Sun have no slot.
  const slots: Slot[] = [dowSlot(21, 1, 201), dowSlot(23, 3, 203), dowSlot(26, 6, null)];

  it("never flags a rest day or a day with no slot", () => {
    // Today Mon 2026-05-11; the window is Mon 4 to Sun 10.
    const missed = findDayOfWeekMissed(d("2026-05-04"), slots, new Set(), d("2026-05-11"));
    expect(missed).toEqual([
      { date: "2026-05-04", slotId: 21 },
      { date: "2026-05-06", slotId: 23 },
    ]);
  });

  it("looks back 7 days and no further, and never at today", () => {
    // Today Wed 2026-05-13: Mon 4 is 9 days back, Wed 6 is 7, Mon 11 is 2.
    const missed = findDayOfWeekMissed(d("2026-05-01"), slots, new Set(), d("2026-05-13"));
    expect(missed.map((m) => m.date)).toEqual(["2026-05-06", "2026-05-11"]);
  });

  it("is cleared by any date in the set: it does not know which program was done", () => {
    const missed = findDayOfWeekMissed(d("2026-05-04"), slots, new Set(["2026-05-06"]), d("2026-05-11"));
    expect(missed.map((m) => m.date)).toEqual(["2026-05-04"]);
  });
});

describe("C2 characterization: walkRotation (C2)", () => {
  const slots: Slot[] = [rotationSlot(1, 1, 101), rotationSlot(2, 2, 102), rotationSlot(3, 3, null)];
  const start = d("2026-05-04");

  it("advances one step for two sessions on one day (BACKLOG: two workouts in one day)", () => {
    const r = resolveRotation(start, slots, ["2026-05-04", "2026-05-04"], d("2026-05-06"));
    // 04: slot 1 done; 05: slot 2 waits and is missed; today 06 is still slot 2.
    expect(r.todaySlotId).toBe(2);
    expect(r.missed).toEqual([{ date: "2026-05-05", slotIndex: 1, slotId: 2 }]);
  });

  it("does not care which program a session was for", () => {
    // The dates are all it reads; the caller passes every completed session.
    const r = resolveRotation(start, slots, ["2026-05-04", "2026-05-05"], d("2026-05-07"));
    // 04 slot 1, 05 slot 2, 06 rest; today 07 is slot 1 again.
    expect(r.todaySlotId).toBe(1);
    expect(r.missed).toEqual([]);
  });

  it("ignores sessions before the start and on today", () => {
    const r = resolveRotation(start, slots, ["2026-05-03", "2026-05-05"], d("2026-05-05"));
    expect(r.todaySlotId).toBe(1);
    expect(r.missed).toEqual([{ date: "2026-05-04", slotIndex: 0, slotId: 1 }]);
  });
});
