import { blockWeeks, canBackToTemplate, cycleSubLine, dayLabels, dayNotes, doneLabel, rotationRows, rowAction, sessionSub, setsShort, weekIndexOf, weekRangeLabel } from "@/lib/utils/cycle-detail";
import { describe, expect, it } from "vitest";

describe("cycleSubLine", () => {
  it("puts the length first, as the Plan list row does (J2-13)", () => {
    expect(cycleSubLine("rotation", "8 weeks", null, 8)).toBe("8 weeks · Rotation");
    expect(cycleSubLine("rotation", "6 weeks", 3, 6)).toBe("6 weeks · Rotation · Week 3 of 6");
    expect(cycleSubLine("day_of_week", "10 days", 1, 2)).toBe("10 days · Same days each week");
  });
});

/** The cycle detail's pure parts (docs/plans/plan-tab-redesign.md, P2). */

describe("blockWeeks", () => {
  it("cuts a block into weeks of 7 days from its first day", () => {
    expect(blockWeeks("2026-11-16", 14)).toEqual([
      { from: "2026-11-16", to: "2026-11-22" },
      { from: "2026-11-23", to: "2026-11-29" },
    ]);
  });

  it("ends the last week on the block's last day", () => {
    expect(blockWeeks("2026-08-20", 10)).toEqual([
      { from: "2026-08-20", to: "2026-08-26" },
      { from: "2026-08-27", to: "2026-08-29" },
    ]);
  });

  it("finds the week of a day, the first before the block and the last after it", () => {
    const weeks = blockWeeks("2026-11-16", 21);
    expect(weekIndexOf(weeks, "2026-11-24")).toBe(1);
    expect(weekIndexOf(weeks, "2026-11-01")).toBe(0);
    expect(weekIndexOf(weeks, "2027-01-01")).toBe(2);
  });
});

describe("date words", () => {
  it("writes a week inside one month and across two", () => {
    expect(weekRangeLabel({ from: "2026-11-16", to: "2026-11-22" })).toBe("16–22 Nov");
    expect(weekRangeLabel({ from: "2026-11-30", to: "2026-12-06" })).toBe("30 Nov – 6 Dec");
  });

  it("names a recent done day by its weekday, an older one by its date", () => {
    expect(doneLabel("2026-11-17", "2026-11-19")).toBe("Done Tue");
    expect(doneLabel("2026-11-09", "2026-11-19")).toBe("Done 9 Nov");
  });
});

describe("setsShort", () => {
  it("writes equal sets as count × reps or range, and differing sets as a count", () => {
    const set = (o: object) => ({ targetReps: null, repRangeMin: null, repRangeMax: null, durationSeconds: null, ...o });
    expect(setsShort([set({ repRangeMin: 6, repRangeMax: 8 }), set({ repRangeMin: 6, repRangeMax: 8 })])).toBe("2 × 6–8");
    expect(setsShort([set({ targetReps: 8 }), set({ targetReps: 8 }), set({ targetReps: 8 })])).toBe("3 × 8");
    expect(setsShort([set({ durationSeconds: 45 })])).toBe("1 × 0:45");
    expect(setsShort([set({ targetReps: 8 }), set({ targetReps: 6 })])).toBe("2 sets");
  });
});

describe("rowAction and sessionSub", () => {
  const base = { summary: null, exercises: "Squat, Row", answer: null, date: "2026-11-20", touched: false, templateDate: "2026-11-20" };
  it("opens the sheet for a coming or missed session, nothing for a done one or a past skip", () => {
    expect(rowAction({ status: "planned", date: "2026-11-20", answer: null }, "2026-11-19")).toBe("sheet");
    expect(rowAction({ status: "missed", date: "2026-11-18", answer: null }, "2026-11-19")).toBe("sheet");
    expect(rowAction({ status: "done", date: "2026-11-18", answer: null }, "2026-11-19")).toBeNull();
    expect(rowAction({ status: "skipped", date: "2026-11-18", answer: null }, "2026-11-19")).toBeNull();
    expect(rowAction({ status: "skipped", date: "2026-11-20", answer: null }, "2026-11-19")).toBe("sheet");
  });

  it("asks Did you do it? for an unanswered past session", () => {
    const answer = { id: 1, date: "2026-11-18", name: "Run", summary: null, sport: "run" as const };
    expect(rowAction({ status: "missed", date: "2026-11-18", answer }, "2026-11-19")).toBe("answer");
    expect(sessionSub({ ...base, status: "missed", answer })).toBe("Did you do it? · Squat, Row");
  });

  it("puts the state before what the session holds", () => {
    expect(sessionSub({ ...base, status: "planned" })).toBe("Squat, Row");
    expect(sessionSub({ ...base, status: "done" })).toBe("Done · Squat, Row");
    expect(sessionSub({ ...base, summary: "60 min", status: "skipped" })).toBe("Skipped · 60 min");
  });

  it("does not call a session Changed because the user answered Missed (J5-16)", () => {
    // The miss answer touches the row, as a skip does; Missed says enough.
    expect(sessionSub({ ...base, status: "missed", touched: true })).toBe("Missed · Squat, Row");
    // A missed session moved off its day still says where it came from.
    expect(sessionSub({ ...base, status: "missed", touched: true, templateDate: "2026-11-17" })).toBe("Missed · Moved from Tue · Squat, Row");
  });

  it("marks a session moved from its template day, or changed on its own day", () => {
    expect(sessionSub({ ...base, status: "planned", touched: true, templateDate: "2026-11-17" })).toBe("Moved from Tue · Squat, Row");
    expect(sessionSub({ ...base, status: "planned", touched: true })).toBe("Changed · Squat, Row");
    // A skip touches the row too; Skipped says enough.
    expect(sessionSub({ ...base, status: "skipped", touched: true })).toBe("Skipped · Squat, Row");
    // A session added by hand has no template day and is not a change.
    expect(sessionSub({ ...base, status: "planned", touched: true, templateDate: null })).toBe("Squat, Row");
  });
});

describe("dayLabels", () => {
  it("names a weekday whose only slots are labelled with no program, but not a plain Rest", () => {
    const labels = dayLabels([
      { dayOfWeek: 1, programId: 3, workoutId: null, label: "Strength" },
      { dayOfWeek: 5, programId: null, workoutId: null, label: "Mobility, stretching and the long drive home" },
      { dayOfWeek: 6, programId: null, workoutId: 8, label: "Long ride" },
      { dayOfWeek: 7, programId: null, workoutId: null, label: "Rest" },
      { dayOfWeek: 4, programId: null, workoutId: null, label: null },
    ]);
    expect(labels).toEqual({ 5: "Mobility, stretching and the long drive home" });
  });
});

describe("dayNotes (J5-11)", () => {
  it("gives the notes of the labelled days only", () => {
    const notes = dayNotes([
      { dayOfWeek: 1, programId: 3, workoutId: null, label: "Strength", notes: "Heavy" },
      { dayOfWeek: 5, programId: null, workoutId: null, label: "Mobility", notes: " Hips and back " },
      { dayOfWeek: 6, programId: null, workoutId: null, label: "Walk", notes: null },
      { dayOfWeek: 7, programId: null, workoutId: null, label: "Rest", notes: "Sleep in" },
    ]);
    expect(notes).toEqual({ 5: "Hips and back" });
  });
});

describe("rotationRows", () => {
  const slots = [
    { id: 1, orderIndex: 1, programId: 10, label: null, programName: "Upper A" },
    { id: 2, orderIndex: 2, programId: 20, label: null, programName: "Lower A" },
    { id: 3, orderIndex: 3, programId: null, label: null, programName: null },
  ];

  it("marks the next session, the last done day, and a rest slot", () => {
    const rows = rotationRows(
      slots,
      [
        { date: "2026-11-16", slotId: 1, rotationPosition: 0, programId: 10, programName: "Upper A", status: "done" },
        { date: "2026-11-17", slotId: 2, rotationPosition: 1, programId: 20, programName: "Lower A", status: "planned" },
        { date: "2026-11-19", slotId: 1, rotationPosition: 3, programId: 10, programName: "Upper A", status: "planned" },
      ],
      "2026-11-17",
    );
    expect(rows.map((r) => [r.n, r.name, r.mark, r.upcoming?.rotationPosition ?? null])).toEqual([
      [1, "Upper A", "done", 3],
      [2, "Lower A", "next", 1],
      [3, "Rest", null, null],
    ]);
    expect(rows[0].lastDone).toBe("2026-11-16");
  });

  it("shows a skipped coming session and a changed program", () => {
    const rows = rotationRows(
      slots,
      [
        { date: "2026-11-17", slotId: 1, rotationPosition: 3, programId: 10, programName: "Upper A", status: "skipped" },
        { date: "2026-11-18", slotId: 2, rotationPosition: 4, programId: 30, programName: "Full body", status: "planned" },
      ],
      "2026-11-17",
    );
    expect(rows[0]).toMatchObject({ mark: "skipped", upcoming: { rotationPosition: 3 } });
    expect(rows[1]).toMatchObject({ mark: "next", name: "Full body", programId: 30 });
  });

  it("marks a coming swapped session as swapped, not with the last done day of its slot", () => {
    const rows = rotationRows(
      slots,
      [
        { date: "2026-11-12", slotId: 2, rotationPosition: 1, programId: 20, programName: "Lower A", status: "done" },
        { date: "2026-11-17", slotId: 1, rotationPosition: 3, programId: 10, programName: "Upper A", status: "planned" },
        { date: "2026-11-18", slotId: 2, rotationPosition: 4, programId: 30, programName: "Full body", status: "planned" },
      ],
      "2026-11-17",
    );
    expect(rows[1]).toMatchObject({ mark: "swapped", name: "Full body", programId: 30, lastDone: "2026-11-12" });
  });
});

describe("canBackToTemplate (J5-08)", () => {
  const s = { status: "planned" as const, date: "2026-11-17", templateDate: "2026-11-17", touched: true };
  it("offers it for a changed day from today on", () => {
    expect(canBackToTemplate(s, "2026-11-14")).toBe(true);
    expect(canBackToTemplate({ ...s, touched: false }, "2026-11-14")).toBe(false);
    expect(canBackToTemplate(s, "2026-11-18")).toBe(false);
  });
  it("a skip alone is not a change: only Plan again undoes it", () => {
    expect(canBackToTemplate({ ...s, status: "skipped" }, "2026-11-14")).toBe(false);
  });
  it("a skipped session that was also moved can go back to its template day", () => {
    expect(canBackToTemplate({ ...s, status: "skipped", date: "2026-11-19" }, "2026-11-14")).toBe(true);
  });
});
