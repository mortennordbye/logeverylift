import { describe, expect, it } from "vitest";
import {
  findDayOfWeekMissed,
  resolveRotation,
  walkRotation,
} from "@/lib/utils/cycle-position";

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
