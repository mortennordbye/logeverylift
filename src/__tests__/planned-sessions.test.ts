import { findDayOfWeekMissed, parseDateStr, projectRotation, resolveRotation, walkRotation } from "@/lib/utils/cycle-position";
import { diffSnapshots, snapshotName, type PlannedSessionSnapshot } from "@/lib/utils/plan-revisions";
import {
  addDaysStr,
  daySlotProblem,
  dowOf,
  generateWeekday,
  matchPlanned,
  mondayOf,
  regenerationPlan,
  type ExistingRow,
  type GeneratedSession,
  type TemplateSlot,
} from "@/lib/utils/planned-sessions";
import { describe, expect, it } from "vitest";

/** Dated sessions (docs/plans/sessions.md, 3.4 and 4.1), as pure functions. */

const slot = (id: number, dayOfWeek: number, programId: number | null, daySlot = 1, extra: Partial<TemplateSlot> = {}): TemplateSlot => ({
  id,
  dayOfWeek,
  daySlot,
  programId,
  label: null,
  notes: null,
  autoComplete: false,
  ...extra,
});

describe("dates", () => {
  it("adds days across a month and finds weekdays and Mondays", () => {
    expect(addDaysStr("2026-10-30", 3)).toBe("2026-11-02");
    expect(dowOf("2026-11-02")).toBe(1);
    expect(dowOf("2026-11-08")).toBe(7);
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  });
});

describe("generateWeekday", () => {
  // Mon 2026-11-02: Mon strength, Wed strength and a run, Sat rest.
  const slots = [slot(1, 1, 10), slot(2, 3, 10), slot(3, 3, 20, 2, { autoComplete: true, label: "Run" }), slot(4, 6, null)];

  it("makes one session per program slot per day, none on a rest day", () => {
    const out = generateWeekday("2026-11-02", 7, slots);
    expect(out.map((g) => [g.date, g.position, g.programId])).toEqual([
      ["2026-11-02", 1, 10],
      ["2026-11-04", 1, 10],
      ["2026-11-04", 2, 20],
    ]);
    expect(out[2]).toMatchObject({ slotId: 3, templateDate: "2026-11-04", label: "Run", autoComplete: true });
  });

  it("covers the whole block, and a block in days ends on its last day", () => {
    expect(generateWeekday("2026-11-02", 28, slots)).toHaveLength(12);
    // 10 days from Monday: two Mondays and two Wednesdays.
    expect(generateWeekday("2026-11-02", 10, slots).map((g) => g.date)).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-04",
      "2026-11-09",
      "2026-11-11",
      "2026-11-11",
    ]);
  });
});

describe("daySlotProblem", () => {
  it("keeps a rest day alone, at most three sessions, and no gaps", () => {
    expect(daySlotProblem({ daySlot: 1, programId: 5, others: [] })).toBeNull();
    expect(daySlotProblem({ daySlot: 2, programId: 5, others: [{ daySlot: 1, programId: 4 }] })).toBeNull();
    expect(daySlotProblem({ daySlot: 1, programId: null, others: [{ daySlot: 2, programId: 4 }] })).toMatch(/rest day holds no other/);
    expect(daySlotProblem({ daySlot: 2, programId: 5, others: [{ daySlot: 1, programId: null }] })).toMatch(/is a rest day/);
    expect(daySlotProblem({ daySlot: 3, programId: 5, others: [{ daySlot: 1, programId: 4 }] })).toMatch(/Add session 2/);
    expect(daySlotProblem({ daySlot: 4, programId: 5, others: [] })).toMatch(/at most 3/);
  });
});

const gen = (slotId: number, date: string, programId = 10, position = 1): GeneratedSession => ({
  slotId,
  templateDate: date,
  date,
  position,
  programId,
  label: null,
  notes: null,
  autoComplete: false,
});
const row = (id: number, slotId: number, date: string, extra: Partial<ExistingRow> = {}): ExistingRow => ({
  id,
  slotId,
  templateDate: date,
  date,
  position: 1,
  programId: 10,
  label: null,
  notes: null,
  autoComplete: false,
  touched: false,
  done: false,
  ...extra,
});

describe("regenerationPlan (T7)", () => {
  const block = { start: "2026-11-02", end: "2026-11-30" };
  const today = "2026-11-10";

  it("updates an untouched future session in place, keeping its id", () => {
    const plan = regenerationPlan({ existing: [row(1, 7, "2026-11-11")], generated: [gen(7, "2026-11-11", 99)], today, block, includePast: false });
    expect(plan).toEqual({ update: [{ id: 1, fields: { programId: 99 } }], insert: [], remove: [] });
  });

  it("never changes a past or a done session, and keeps a touched or added one", () => {
    const existing = [
      row(1, 7, "2026-11-04"), // past, untouched
      row(2, 7, "2026-11-10", { done: true }), // today, done
      row(3, 7, "2026-11-11", { touched: true, date: "2026-11-12" }), // moved
      row(4, 0, "2026-11-13", { slotId: null, templateDate: null }), // added by hand
    ];
    const plan = regenerationPlan({ existing, generated: [], today, block, includePast: false });
    expect(plan).toEqual({ update: [], insert: [], remove: [] });
  });

  it("removes an untouched future session the template no longer has, and adds new ones from today on", () => {
    const plan = regenerationPlan({
      existing: [row(1, 7, "2026-11-11")],
      generated: [gen(8, "2026-11-04"), gen(8, "2026-11-11"), gen(8, "2026-11-18")],
      today,
      block,
      includePast: false,
    });
    expect(plan.remove).toEqual([1]);
    expect(plan.insert.map((g) => g.date)).toEqual(["2026-11-11", "2026-11-18"]);
  });

  it("makes the past only on the first generation or a new start", () => {
    const plan = regenerationPlan({ existing: [], generated: [gen(8, "2026-11-04"), gen(8, "2026-11-11")], today, block, includePast: true });
    expect(plan.insert.map((g) => g.date)).toEqual(["2026-11-04", "2026-11-11"]);
  });

  it("drops a touched session the new dates no longer hold, and a past one before a new start", () => {
    const later = { start: "2026-11-09", end: "2026-11-16" };
    const plan = regenerationPlan({
      existing: [row(1, 7, "2026-11-20", { touched: true }), row(2, 7, "2026-11-03")],
      generated: [],
      today,
      block: later,
      includePast: true,
    });
    expect(plan.remove.sort()).toEqual([1, 2]);
  });

  it("with no dates any more, removes the sessions from today on and keeps the past", () => {
    const plan = regenerationPlan({
      existing: [row(1, 7, "2026-11-04"), row(2, 7, "2026-11-10"), row(3, 7, "2026-11-11", { touched: true }), row(4, 7, "2026-11-10", { done: true })],
      generated: [gen(7, "2026-11-11")],
      today,
      block: null,
      includePast: false,
    });
    expect(plan).toEqual({ update: [], insert: [], remove: [2, 3] });
  });
});

describe("matchPlanned (4.1)", () => {
  const p = (id: number, date: string, programId: number, position = 1) => ({ id, date, position, programId });
  const s = (id: number, date: string, programId: number | null, extra: { intendedDate?: string; plannedSessionId?: number } = {}) => ({
    id,
    date,
    programId,
    intendedDate: extra.intendedDate ?? null,
    plannedSessionId: extra.plannedSessionId ?? null,
  });

  it("links the workout started for a session first, then one of its program, then any", () => {
    const m = matchPlanned(
      [p(1, "2026-11-04", 10, 1), p(2, "2026-11-04", 20, 2)],
      [s(100, "2026-11-04", 20)],
    );
    // Session 2's program is matched before session 1 takes any workout.
    expect([...m]).toEqual([[2, { sessionId: 100, step: 2 }]]);
    const linked = matchPlanned([p(1, "2026-11-04", 10), p(2, "2026-11-04", 10, 2)], [s(100, "2026-11-04", 10, { plannedSessionId: 2 })]);
    expect(linked.get(2)).toEqual({ sessionId: 100, step: 1 });
    expect(linked.has(1)).toBe(false);
    const any = matchPlanned([p(1, "2026-11-04", 10)], [s(100, "2026-11-04", null)]);
    expect(any.get(1)).toEqual({ sessionId: 100, step: 3 });
  });

  it("uses a workout once a day, and a make-up on both its days", () => {
    const m = matchPlanned(
      [p(1, "2026-11-02", 10), p(2, "2026-11-04", 10), p(3, "2026-11-04", 20, 2)],
      [s(100, "2026-11-04", 10, { intendedDate: "2026-11-02" })],
    );
    expect(m.get(1)?.sessionId).toBe(100);
    expect(m.get(2)?.sessionId).toBe(100);
    expect(m.has(3)).toBe(false);
  });

  it("with one session a day, misses exactly what the template rule missed", () => {
    // A seeded walk over random weeks: the property that keeps one-slot lifters unchanged.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 200; round++) {
      const today = addDaysStr("2026-11-02", Math.floor(rand() * 20));
      const start = addDaysStr(today, -Math.floor(rand() * 15));
      const slots = [1, 2, 3, 4, 5, 6, 7]
        .filter(() => rand() < 0.6)
        .map((d) => slot(d, d, rand() < 0.2 ? null : 10 + d));
      const sessions = Array.from({ length: Math.floor(rand() * 6) }, (_, i) => {
        const date = addDaysStr(today, -Math.floor(rand() * 9));
        return s(500 + i, date, rand() < 0.5 ? 11 : null, rand() < 0.2 ? { intendedDate: addDaysStr(date, -2) } : {});
      });
      const from = addDaysStr(today, -7) < start ? start : addDaysStr(today, -7);
      const generated = generateWeekday(start, 60, slots).filter((g) => g.date >= from && g.date < today);
      const m = matchPlanned(generated.map((g, i) => ({ id: i + 1, date: g.date, position: 1, programId: g.programId })), sessions);
      const viaRows = generated.filter((_, i) => !m.has(i + 1)).map((g) => g.date);
      const completed = new Set(sessions.flatMap((x) => [x.date, ...(x.intendedDate ? [x.intendedDate] : [])]));
      const viaTemplate = findDayOfWeekMissed(parseDateStr(start), slots.map((x) => ({ ...x, orderIndex: null })), completed, parseDateStr(today), 7).map((x) => x.date);
      expect(viaRows).toEqual(viaTemplate);
    }
  });
});

describe("rotation overrides (4.3)", () => {
  const slots = [
    { id: 1, dayOfWeek: null, orderIndex: 1, programId: 101 },
    { id: 2, dayOfWeek: null, orderIndex: 2, programId: 102 },
    { id: 3, dayOfWeek: null, orderIndex: 3, programId: null },
  ];
  const d = (s: string) => parseDateStr(s);

  it("a skipped position uses its day as if done", () => {
    // Nothing logged; position 0 skipped on Mon 4: Tue 5 waits on slot 2.
    const r = resolveRotation(d("2026-05-04"), slots, [], d("2026-05-06"), new Set([0]));
    expect(r.todaySlotId).toBe(2);
    expect(r.todayPosition).toBe(1);
    expect(r.missed.map((m) => m.date)).toEqual(["2026-05-05"]);
    expect(walkRotation(d("2026-05-04"), slots, [], d("2026-05-06")).position).toBe(0);
  });

  it("projects the walk: done and missed in the past, planned from today on", () => {
    const days = projectRotation(d("2026-05-04"), slots, ["2026-05-04"], d("2026-05-06"), d("2026-05-09"));
    expect(days.map((x) => [x.date, x.position, x.programId, x.status])).toEqual([
      ["2026-05-04", 0, 101, "done"],
      ["2026-05-05", 1, 102, "missed"],
      ["2026-05-06", 1, 102, "planned"],
      // 07 is the rest slot (position 2): no entry.
      ["2026-05-08", 3, 101, "planned"],
      ["2026-05-09", 4, 102, "planned"],
    ]);
  });

  it("matches the walk's missed days when nothing is overridden", () => {
    const sessions = ["2026-05-04", "2026-05-07"];
    const days = projectRotation(d("2026-05-04"), slots, sessions, d("2026-05-10"), d("2026-05-09"));
    const walk = walkRotation(d("2026-05-04"), slots, sessions, d("2026-05-10"));
    expect(days.filter((x) => x.status === "missed").map((x) => x.date)).toEqual(walk.missed.map((m) => m.date));
  });
});

describe("planned session revisions", () => {
  const snap = (session: Record<string, unknown>, programName: string | null = "Squat day"): PlannedSessionSnapshot => ({
    v: 1,
    session: { id: 5, date: "2026-11-04", position: 1, programId: 10, label: null, notes: null, status: "planned", skipReason: null, touchedAt: null, deletedAt: null, ...session },
    programName,
  });

  it("names the session and says what changed", () => {
    expect(snapshotName(snap({}))).toBe("Squat day on 2026-11-04");
    expect(diffSnapshots(snap({}), snap({ date: "2026-11-06", touchedAt: "x" }))).toEqual(["Moved from 2026-11-04 to 2026-11-06"]);
    expect(diffSnapshots(snap({}), snap({ status: "skipped", skipReason: "Travel", touchedAt: "x" }))).toEqual(["Skipped: Travel"]);
    expect(diffSnapshots(snap({ touchedAt: "x", programId: 11 }, "Run"), snap({}))).toEqual(["Program Run → Squat day", "Back to the template"]);
    expect(diffSnapshots(null, snap({}))).toEqual(["Added Squat day on 2026-11-04"]);
  });
});

describe("review fixes (docs/plans/sessions.md, section 20)", () => {
  const block = { start: "2026-10-26", end: "2026-11-23" };
  const today = "2026-11-05"; // Thursday; this week starts Mon 2 Nov

  it("2-4. this week's past days follow the template; earlier weeks do not", () => {
    const plan = regenerationPlan({
      existing: [row(1, 7, "2026-11-04"), row(2, 7, "2026-10-28")],
      generated: [gen(7, "2026-11-04", 99), gen(7, "2026-10-28", 99), gen(8, "2026-11-03", 99), gen(8, "2026-10-27", 99)],
      today,
      block,
      includePast: false,
      editableFrom: "2026-11-02",
    });
    expect(plan.update).toEqual([{ id: 1, fields: { programId: 99 } }]);
    expect(plan.insert.map((g) => g.date)).toEqual(["2026-11-03"]);
    expect(plan.remove).toEqual([]);
  });

  it("13. a touched session that leaves the block does not come back on its template day", () => {
    const plan = regenerationPlan({
      existing: [row(1, 7, "2026-11-12", { touched: true, date: "2026-11-30" })],
      generated: [gen(7, "2026-11-12")],
      today,
      block,
      includePast: false,
    });
    expect(plan).toEqual({ update: [], insert: [], remove: [1] });
  });

  it("15. no day gets a fourth session; skipped ones keep no place", () => {
    const added = (id: number, skipped = false) => row(id, 0, "2026-11-09", { slotId: null, templateDate: null, skipped });
    const full = regenerationPlan({ existing: [added(1), added(2), added(3)], generated: [gen(7, "2026-11-09")], today, block, includePast: false });
    expect(full.insert).toEqual([]);
    const freed = regenerationPlan({ existing: [added(1), added(2), added(3, true)], generated: [gen(7, "2026-11-09")], today, block, includePast: false });
    expect(freed.insert.map((g) => g.date)).toEqual(["2026-11-09"]);
  });

  it("19. a session a workout was started for is never removed", () => {
    const plan = regenerationPlan({ existing: [row(1, 7, "2026-11-12", { linked: true })], generated: [], today, block, includePast: false });
    expect(plan.remove).toEqual([]);
    expect(regenerationPlan({ existing: [row(1, 7, "2026-11-12", { linked: true })], generated: [], today, block: null, includePast: false }).remove).toEqual([]);
  });

  describe("18. the matcher with several sessions a day and links", () => {
    const p = (id: number, date: string, programId: number, position: number) => ({ id, date, position, programId });
    const s = (id: number, date: string, programId: number | null, plannedSessionId: number | null = null) => ({
      id,
      date,
      programId,
      intendedDate: null,
      plannedSessionId,
    });

    it("a workout of an unrelated program marks only the first session done", () => {
      const m = matchPlanned([p(1, "2026-11-04", 10, 1), p(2, "2026-11-04", 20, 2)], [s(100, "2026-11-04", 99)]);
      expect([...m.keys()]).toEqual([1]);
      expect(m.get(1)?.step).toBe(3);
    });

    it("a link wins over a same-program workout on a day with the program twice", () => {
      const m = matchPlanned(
        [p(1, "2026-11-04", 10, 1), p(2, "2026-11-04", 10, 2)],
        [s(100, "2026-11-04", 10, 2), s(101, "2026-11-04", 10)],
      );
      expect(m.get(2)).toEqual({ sessionId: 100, step: 1 });
      expect(m.get(1)).toEqual({ sessionId: 101, step: 2 });
    });

    it("on random days with up to three sessions, each workout is used once a day, links hold, and programs come first", () => {
      let seed = 11;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed / 2 ** 31;
      };
      for (let round = 0; round < 300; round++) {
        const date = "2026-11-04";
        const planned = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => p(i + 1, date, 10 + Math.floor(rand() * 3), i + 1));
        const sessions = Array.from({ length: Math.floor(rand() * 4) }, (_, i) =>
          s(100 + i, date, rand() < 0.2 ? null : 10 + Math.floor(rand() * 4), rand() < 0.3 ? planned[Math.floor(rand() * planned.length)].id : null),
        );
        const m = matchPlanned(planned, sessions);
        const used = [...m.values()].map((x) => x.sessionId);
        expect(new Set(used).size).toBe(used.length);
        for (const ws of sessions) {
          // A linked workout always marks its own session, if no earlier link took it.
          if (ws.plannedSessionId != null && sessions.find((x) => x.plannedSessionId === ws.plannedSessionId)?.id === ws.id) {
            expect(m.get(ws.plannedSessionId)).toEqual({ sessionId: ws.id, step: 1 });
          }
        }
        // A session left without a workout means no workout that day was free.
        const free = sessions.filter((x) => !used.includes(x.id));
        if (planned.some((x) => !m.has(x.id))) expect(free).toEqual([]);
        // A program match is never lost to a fallback on the same day.
        for (const pl of planned) {
          const got = m.get(pl.id);
          if (got?.step === 3) {
            expect(free.some((x) => x.programId === pl.programId)).toBe(false);
          }
        }
      }
    });
  });
});
