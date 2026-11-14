import {
  badgeAccent,
  dateRange,
  heroLabel,
  pastRow,
  phaseDeleteWarning,
  nextPhaseBadge,
  phaseBarTone,
  rotationChips,
  runningEnd,
  seasonCard,
  startsLabel,
  upNextRow,
  weekDays,
  weekSummary,
  type WeekSession,
} from "@/lib/utils/plan-list";
import type { PhaseLike } from "@/lib/utils/seasons";
import { describe, expect, it } from "vitest";

const TODAY = "2026-11-14"; // a Saturday

const phase = (id: number, name: string, phaseType: PhaseLike["phaseType"], len: { w?: number; d?: number }, extra: Partial<PhaseLike> = {}): PhaseLike => ({
  id,
  name,
  phaseOrder: id,
  phaseType,
  durationWeeks: len.w ?? Math.ceil((len.d ?? 7) / 7),
  durationDays: len.d ?? null,
  status: "draft",
  startDate: null,
  scheduledStartDate: null,
  ...extra,
});

/** The Jevnaker season of the spec (docs/design/plan-redesign/spec.md). */
const jevnakerPhases = [
  phase(1, "Aerobic base + strength", "general", { w: 8 }, { scheduledStartDate: "2026-11-16" }),
  phase(2, "Longer ride and run", "base", { w: 12 }),
  phase(3, "Swim, intervals, bricks", "build", { w: 12 }),
  phase(4, "Race pace + open water", "build", { d: 53 }),
  phase(5, "Taper", "taper", { d: 10 }),
];
const jevnaker = seasonCard(
  { id: 9, name: "Jevnaker Half 2027", startDate: "2026-11-16", endDate: "2027-08-29", replanFlaggedAt: null },
  jevnakerPhases,
  { name: "Jevnaker Halv Full Distanse", raceDate: "2027-08-29" },
  TODAY,
);

describe("plan list words", () => {
  it("writes date ranges and start days as the spec does", () => {
    expect(dateRange("2026-11-16", "2027-01-10")).toBe("16 Nov – 10 Jan");
    expect(dateRange("2027-08-20", "2027-08-29")).toBe("20 – 29 Aug");
    // A day inside the week names its date too (J4-17).
    expect(startsLabel(TODAY, "2026-11-16")).toBe("Starts Mon 16 Nov");
    expect(startsLabel(TODAY, "2026-12-21")).toBe("Starts 21 Dec");
    expect(startsLabel(TODAY, TODAY)).toBe("Starts today");
  });

  it("gives the running block's last day, cut by another block's scheduled start (J4-18)", () => {
    expect(runningEnd("2026-11-09", "2026-12-27", "2026-11-16")).toBe("2026-11-15");
    expect(runningEnd("2026-11-09", "2026-12-27", "2026-12-28")).toBe("2026-12-27");
    expect(runningEnd("2026-11-09", "2026-12-27", null)).toBe("2026-12-27");
  });

  it("a season row shows the length a phase runs when a scheduled start cuts it (fix round 7)", () => {
    const card = seasonCard(
      { id: 9, name: "Winter", startDate: "2026-11-09", endDate: "2027-03-01", replanFlaggedAt: null },
      [phase(1, "Base", "base", { w: 7 }, { status: "active", startDate: "2026-11-09" }), phase(2, "Build", "build", { d: 10 })],
      null,
      TODAY,
      "2026-11-16",
    );
    expect(card.phases[0].sub).toBe("Base · 1 wk · 9 – 15 Nov");
    expect(card.phases[1].sub).toBe("Build · 10 days · 16 – 25 Nov");
  });

  it("labels the hero of a running and of a scheduled block", () => {
    const rotation = { id: 1, name: "UL", durationWeeks: 6, durationDays: null, scheduleType: "rotation" as const, startDate: "2026-11-02", scheduledStartDate: null };
    expect(heroLabel(rotation, TODAY, true)).toBe("Week 2 of 6 · Rotation");
    const next = { ...rotation, scheduleType: "day_of_week" as const, durationWeeks: 8, startDate: null, scheduledStartDate: "2026-11-16" };
    expect(heroLabel(next, TODAY, false)).toBe("Starts Mon 16 Nov · Week 1 of 8");
  });

  it("counts the hero's weeks to the day a scheduled start cuts the running block (fix round 7)", () => {
    const running = { id: 1, name: "Base", durationWeeks: 7, durationDays: null, scheduleType: "day_of_week" as const, startDate: "2026-11-09", scheduledStartDate: null };
    expect(heroLabel(running, TODAY, true, "2026-11-16")).toBe("Week 1 of 1 · Same days each week");
    expect(heroLabel(running, TODAY, true, "2026-11-24")).toBe("Week 1 of 3 · Same days each week");
    expect(heroLabel(running, TODAY, true, null)).toBe("Week 1 of 7 · Same days each week");
  });

  it("writes up-next and past rows", () => {
    const c = { id: 2, name: "Strength peak", durationWeeks: 4, durationDays: null, scheduleType: "day_of_week" as const, startDate: null, scheduledStartDate: "2026-12-21" };
    expect(upNextRow(c, TODAY)).toEqual({ id: 2, name: "Strength peak", sub: "4 weeks · Same days each week", starts: "Starts 21 Dec", startsAccent: true });
    const past = { ...c, name: "Strength 5×5", durationWeeks: 8, startDate: "2026-09-14", scheduledStartDate: null };
    expect(pastRow(past, TODAY).sub).toBe("8 weeks · ended 8 Nov");
    // Ended early: the block ended no later than today.
    expect(pastRow({ ...past, startDate: "2026-11-01" }, TODAY).sub).toBe("8 weeks · ended 14 Nov");
  });

  it("says a draft with no start date has not started", () => {
    const c = { id: 3, name: "Hypertrophy", durationWeeks: 6, durationDays: null, scheduleType: "rotation" as const, startDate: null, scheduledStartDate: null };
    expect(upNextRow(c, TODAY)).toMatchObject({ starts: "Not started", startsAccent: false });
    expect(upNextRow({ ...c, scheduledStartDate: "2026-12-21" }, TODAY)).toMatchObject({ starts: "Starts 21 Dec", startsAccent: true });
  });
});

describe("the hero", () => {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
  const s = (date: string, extra: Partial<WeekSession> = {}): WeekSession => ({ date, name: "Strength A", sport: null, sports: [], key: false, brick: false, skipped: false, durationSeconds: null, ...extra });
  const week = [
    s("2026-11-16"),
    s("2026-11-17", { name: "Bike tempo", sport: "bike", sports: ["bike"], durationSeconds: 3600 }),
    s("2026-11-18", { name: "Run aerobic", sport: "run", sports: ["run"], durationSeconds: 3900 }),
    s("2026-11-19", { name: "Strength B" }),
    s("2026-11-22", { name: "Long ride", sport: "bike", sports: ["bike"], key: true, durationSeconds: 8100 }),
    s("2026-11-22", { name: "Run off bike", sport: "run", sports: ["run"], brick: true, durationSeconds: 1200 }),
  ];

  it("makes a 7-day strip with rest days, sports, a brick and the key day", () => {
    const days = weekDays(dates, week, TODAY, true);
    expect(days.map((d) => d.short)).toEqual(["Lift", "Bike", "Run", "Lift", "Rest", "Rest", "Brick"]);
    expect(days.map((d) => d.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days[6].key).toBe(true);
    expect(days[6].names).toBe("Long ride, Run off bike");
  });

  it("names a day with no session by its own label, apart from Rest", () => {
    const days = weekDays(dates, week, TODAY, true, { 5: "Mobility, stretching and the long drive home" });
    expect(days[4]).toMatchObject({ short: "Mobility", rest: true, names: "Mobility, stretching and the long drive home" });
    expect(days[5]).toMatchObject({ short: "Rest", names: "Rest" });
  });

  it("never calls a session with an endurance sport a lift", () => {
    const mixed = s("2026-11-16", { name: "Bike + swim", sports: ["bike", "swim"] });
    const liftAndRun = s("2026-11-17", { name: "Legs and a jog", sports: ["run"] });
    const days = weekDays(dates, [mixed, liftAndRun, s("2026-11-18"), s("2026-11-18", { name: "Bike + swim", sports: ["bike", "swim"] })], TODAY, true);
    expect(days.slice(0, 3).map((d) => d.short)).toEqual(["Multi", "Multi", "Lift +1"]);
  });

  it("marks no key day without the endurance switch", () => {
    expect(weekDays(dates, week, TODAY, false).some((d) => d.key)).toBe(false);
  });

  it("counts the sessions, and gives the planned time only when every session has one", () => {
    const timed = week.filter((x) => x.durationSeconds != null);
    expect(weekSummary(timed)).toBe("4 sessions · about 5 h");
    expect(weekSummary([...timed, s("2026-11-19", { skipped: true })])).toBe("4 sessions · about 5 h");
    // A lift or a session planned by distance has no time: no partial sum.
    expect(weekSummary(week)).toBe("6 sessions");
    expect(weekSummary([s("2026-11-16", { durationSeconds: 1200 }), s("2026-11-17", { sport: "bike", sports: ["bike"] })])).toBe("2 sessions");
    expect(weekSummary([s("2026-11-16"), s("2026-11-17", { skipped: true })])).toBe("1 session");
  });

  it("marks the last session done, the next one and a skipped one in the rotation", () => {
    const row = (slotId: number, name: string, mark: "next" | "skipped" | "swapped" | "done" | null, lastDone: string | null = null) => ({ slotId, name, rest: name === "Rest", mark, lastDone });
    const chips = rotationChips([
      row(10, "Lower B", "done", "2026-11-09"),
      row(11, "Upper A", "done", "2026-11-12"),
      row(12, "Lower B", "next"),
      row(14, "Upper B", "skipped"),
      row(13, "Rest", null),
    ]);
    expect(rotationChips([row(11, "Full body express", "swapped", "2026-11-12")])).toEqual([{ id: 11, name: "Full body express", rest: false, tag: "Swapped" }]);
    expect(chips).toEqual([
      { id: 10, name: "Lower B", rest: false, tag: null },
      { id: 11, name: "Upper A", rest: false, tag: "Done" },
      { id: 12, name: "Lower B", rest: false, tag: "Next" },
      { id: 14, name: "Upper B", rest: false, tag: "Skipped" },
      { id: 13, name: "Rest", rest: true, tag: null },
    ]);
  });
});

describe("the season card", () => {
  it("counts down to the A race and lays out the phases", () => {
    expect(jevnaker.race).toEqual({ name: "Jevnaker Halv Full Distanse", when: "29 Aug", daysLeft: 288 });
    expect(jevnaker.phases.map((p) => p.sub)).toEqual([
      "General · 8 wk · 16 Nov – 10 Jan",
      "Base · 12 wk · 11 Jan – 4 Apr",
      "Build · 12 wk · 5 Apr – 27 Jun",
      "Build · 53 days · 28 Jun – 19 Aug",
      "Taper · 10 days · 20 – 29 Aug",
    ]);
    // Nothing runs yet: the next phase is the accent one.
    expect(jevnaker.phases[0]).toMatchObject({ badge: "Starts Mon 16 Nov", badgeAccent: true, mark: "accent" });
    // Nothing has started, so nothing is filled: the next phase is only outlined (J4-13).
    expect(jevnaker.bar.map((b) => b.tone)).toEqual(["next", "grey", "grey", "grey", "grey"]);
  });

  it("fills only the phases that have started (J4-13, J4-14, J6-02)", () => {
    // A paused chain: phase 1 ended, phase 2 is next and not started.
    const paused = seasonCard(
      { id: 3, name: "Winter run base", startDate: "2026-09-21", endDate: "2027-02-07", replanFlaggedAt: null },
      [
        phase(1, "Aerobic base", "base", { w: 8 }, { status: "completed", startDate: "2026-09-21" }),
        phase(2, "Run build", "build", { w: 4 }),
      ],
      null,
      TODAY,
    );
    expect(paused.bar.map((b) => b.tone)).toEqual(["accent", "next"]);
    // After Resume it is scheduled, and still not started.
    const resumed = seasonCard(
      { id: 3, name: "Winter run base", startDate: "2026-09-21", endDate: "2027-02-07", replanFlaggedAt: null },
      [
        phase(1, "Aerobic base", "base", { w: 8 }, { status: "completed", startDate: "2026-09-21" }),
        phase(2, "Run build", "build", { w: 4 }, { scheduledStartDate: "2026-11-23" }),
      ],
      null,
      TODAY,
    );
    expect(resumed.bar.map((b) => b.tone)).toEqual(["accent", "next"]);
    expect(phaseBarTone("done", false)).toBe("accent");
    expect(phaseBarTone("active", false)).toBe("current");
    expect(phaseBarTone("planned", true)).toBe("next");
    expect(phaseBarTone("planned", false)).toBe("grey");
  });

  it("gives the next phase one badge for the list and the season page (J8-12)", () => {
    const timeline = [{ state: "active" as const }, { state: "planned" as const }];
    expect(nextPhaseBadge({ scheduled: false, plannedStart: "2026-12-28" }, timeline, TODAY)).toBe("Paused");
    expect(nextPhaseBadge({ scheduled: true, plannedStart: "2026-12-28" }, timeline, TODAY)).toBe("Starts 28 Dec");
    expect(nextPhaseBadge({ scheduled: false, plannedStart: "2026-11-10" }, [{ state: "planned" as const }], TODAY)).toBe("Next");
  });

  it("outlines the running phase and greys the next one in a goal season", () => {
    const goal = seasonCard(
      { id: 3, name: "Bench 120 kg by February", startDate: "2026-11-09", endDate: "2027-02-07", replanFlaggedAt: null },
      [
        phase(1, "Upper / Lower hypertrophy", "build", { w: 6 }, { status: "active", startDate: "2026-11-09" }),
        phase(2, "Strength peak", "peak", { w: 4 }, { scheduledStartDate: "2026-12-21" }),
        phase(3, "Peak and test", "peak", { w: 3 }),
      ],
      null,
      TODAY,
    );
    expect(goal.race).toBeNull();
    expect(goal.goalBy).toBe("Goal by 7 Feb");
    // Days, as the season page counts (J6-01).
    expect(goal.daysLeft).toBe(85);
    expect(goal.bar.map((b) => b.tone)).toEqual(["current", "grey", "grey"]);
    expect(goal.phases.map((p) => [p.badge, p.badgeAccent])).toEqual([
      ["Now", true],
      // One rule with the season page: the accent marks now and next (J6-01).
      ["Starts 21 Dec", true],
      [null, false],
    ]);
  });

  it("colours a badge by one rule: Now, Next and Starts in the accent, Done and Paused grey (J8-01, J4-18)", () => {
    expect(["Now", "Next", "Starts 21 Dec", "Starts today", "Done", "Paused", null].map(badgeAccent)).toEqual([true, true, true, true, false, false, false]);
  });

  it("says Paused, as the season page does, when another block took the next phase's start (fix round 4)", () => {
    const paused = seasonCard(
      { id: 3, name: "Winter run base", startDate: "2026-11-02", endDate: "2027-02-07", replanFlaggedAt: null },
      [
        phase(1, "Base", "base", { w: 3 }, { status: "active", startDate: "2026-11-02" }),
        // Due 23 Nov, but not scheduled: the chain is paused (seasonPaused).
        phase(2, "Run build", "build", { w: 4 }),
      ],
      null,
      TODAY,
    );
    expect(paused.phases.map((p) => p.badge)).toEqual(["Now", "Paused"]);
  });

  it("says Next, not a start day, for a season not started whose first phase is due and not scheduled", () => {
    const due = seasonCard(
      { id: 4, name: "Spring", startDate: "2026-11-10", endDate: "2027-02-07", replanFlaggedAt: null },
      [phase(1, "General", "general", { w: 4 })],
      null,
      TODAY,
    );
    expect(due.phases[0].badge).toBe("Next");
  });

  it("writes a length in days that is whole weeks as weeks", () => {
    const fitted = seasonCard(
      { id: 5, name: "Fitted", startDate: "2026-11-16", endDate: "2027-08-29", replanFlaggedAt: null },
      [phase(1, "Build", "build", { d: 105 }, { scheduledStartDate: "2026-11-16" })],
      null,
      TODAY,
    );
    expect(fitted.phases[0].sub).toBe("Build · 15 wk · 16 Nov – 28 Feb");
  });
});

describe("the phase warning in select mode", () => {
  it("says the later phases move earlier and the taper ends before race day", () => {
    expect(phaseDeleteWarning([jevnaker], new Set([2, 3]))).toBe(
      "Both are phases of Jevnaker Half 2027. The later phases move 168 days earlier, so the taper will end before race day. You will need to re-plan.",
    );
  });

  it("says nothing when no phase is selected", () => {
    expect(phaseDeleteWarning([jevnaker], new Set([99]))).toBeNull();
  });

  it("names one phase, and says when the taper itself goes", () => {
    expect(phaseDeleteWarning([jevnaker], new Set([5]))).toBe(
      "“Taper” is a phase of Jevnaker Half 2027. The season will have no taper. You will need to re-plan.",
    );
  });

  it("counts the phases among other cycles", () => {
    expect(phaseDeleteWarning([jevnaker], new Set([4, 99, 98]))).toMatch(/^“Race pace \+ open water” is a phase of Jevnaker Half 2027\. The later phases move 53 days earlier, so the taper/);
    expect(phaseDeleteWarning([jevnaker], new Set([1, 2, 99]))).toMatch(/^2 of them are phases of Jevnaker Half 2027\./);
  });
});
