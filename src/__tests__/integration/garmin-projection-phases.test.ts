import { db } from "@/db";
import { seasonRaces, seasons, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { projectPmc } from "@/lib/garmin/analytics/projection";
import { SPORTS } from "@/lib/garmin/analytics/sport";
import type { LoadSeries } from "@/lib/garmin/charts/load";
import { getRaceProjection } from "@/lib/garmin/queries";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { describe, expect, it } from "vitest";
import { createProgram, createUser } from "./factories";

/**
 * The race projection across a season's phases (BACKLOG "Seasons: fitness
 * projection across phases"): each later phase with a program runs its own
 * curve from its timeline start; a phase with no program is skipped.
 */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));

/** Seven days of load ending today. */
function series(): LoadSeries {
  const dates = Array.from({ length: 7 }, (_, i) => day(i - 6));
  const track = { ctl: Array(7).fill(70), atl: Array(7).fill(75), tsb: Array(7).fill(-5) };
  return {
    dates,
    calibrating: Array(7).fill(false),
    tracks: { total: track } as LoadSeries["tracks"],
    loads: Object.fromEntries(SPORTS.map((s) => [s, Array(7).fill(s === "run" ? 75 : 0)])) as LoadSeries["loads"],
    bands: { low: [], mid: [], high: [] },
  };
}

describe("getRaceProjection in a season", () => {
  it("runs the later phases' curves, skipping a phase with no program", async () => {
    const me = (await createUser()).id;
    const today = day(0);
    const start = day(-14);
    const taperStart = day(-14 + 28 + 14);
    const raceDate = day(-14 + 28 + 14 + 10);
    const [season] = await db.insert(seasons).values({ userId: me, name: "Half", startDate: start, endDate: raceDate }).returning();
    await db.insert(seasonRaces).values({ seasonId: season.id, userId: me, name: "Half 70.3", raceDate, discipline: "triathlon", distance: "half", priority: "A" });
    const phase = { userId: me, seasonId: season.id, goal: "build" as const, athleteLevel: "intermediate" as const };
    const [active, empty, taper] = await db
      .insert(trainingCycles)
      .values([
        { ...phase, name: "Build", phaseOrder: 1, phaseType: "build" as const, durationWeeks: 4, status: "active" as const, startDate: start },
        { ...phase, name: "Base 2", phaseOrder: 2, phaseType: "base" as const, durationWeeks: 2, status: "draft" as const },
        { ...phase, name: "Taper", phaseOrder: 3, phaseType: "taper" as const, durationWeeks: 2, status: "draft" as const },
      ])
      .returning();
    const { program } = await createProgram(me, []);
    // The empty phase has a rest slot only; the active and the taper phase have a program.
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: active.id, dayOfWeek: 1, programId: program.id },
      { trainingCycleId: empty.id, dayOfWeek: 1, programId: null },
      { trainingCycleId: taper.id, dayOfWeek: 1, programId: program.id },
    ]);

    const s = series();
    const r = (await getRaceProjection(me, s, today))!;
    expect(r.race.raceDay).toBe(raceDate);

    const input = { today: s.dates[6], raceDay: raceDate, ctl: 70, atl: 75, last7: Array(7).fill(75), peakCtl: 70 };
    const cycle = { startDate: start, durationWeeks: 4, durationDays: null, goal: "build" as const, athleteLevel: "intermediate" as const, phaseType: "build" as const };
    const expected = projectPmc({ ...input, cycle, later: [{ ...cycle, startDate: taperStart, durationWeeks: 2, phaseType: "taper" }] });
    expect(r.projection).toEqual(expected);
    // The taper changes the answer against the active phase alone.
    expect(r.projection!.race.tsb).toBeGreaterThan(projectPmc({ ...input, cycle })!.race.tsb);
  });
});
