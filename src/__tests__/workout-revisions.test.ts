import { diffSnapshots, snapshotName, type PlanSnapshot } from "@/lib/utils/plan-revisions";
import { describe, expect, it } from "vitest";

/** History text for workouts, sick periods and the new planned-session fields (docs/plans/workouts-and-compliance.md, 4.5). */

const workout = (over: Record<string, unknown> = {}): PlanSnapshot => ({ v: 1, workout: { id: 1, name: "Tempo", workout: { steps: [1] }, priority: null, deletedAt: null, ...over } });
const illness = (over: Record<string, unknown> = {}): PlanSnapshot => ({ v: 1, illness: { id: 2, startedOn: "2026-11-02", endedOn: null, severity: "mild", notes: null, deletedAt: null, ...over } });
const session = (over: Record<string, unknown> = {}): PlanSnapshot => ({
  v: 1,
  programName: null,
  session: { id: 3, date: "2026-11-10", position: 1, programId: null, label: null, notes: null, status: "planned", workout: null, priority: null, brickParentId: null, garminActivityId: null, missedReason: null, deletedAt: null, touchedAt: null, ...over },
});

describe("revision text", () => {
  it("names and diffs a library workout", () => {
    expect(snapshotName(workout())).toBe("Workout: Tempo");
    expect(diffSnapshots(null, workout())).toEqual(['Added workout "Tempo"']);
    expect(diffSnapshots(workout(), workout({ name: "Threshold", workout: { steps: [2] }, priority: "key" }))).toEqual([
      "Name Tempo → Threshold",
      "Steps changed",
      "Priority default → key",
    ]);
    expect(diffSnapshots(workout(), workout({ deletedAt: "2026-11-05T00:00:00.000Z" }))).toEqual(["Deleted"]);
  });

  it("names and diffs a sick period", () => {
    expect(snapshotName(illness())).toBe("Sick period from 2026-11-02");
    expect(diffSnapshots(null, illness())).toEqual(["Sick period 2026-11-02 to now"]);
    expect(diffSnapshots(illness(), illness({ endedOn: "2026-11-04", severity: "moderate" }))).toEqual([
      "Sick period 2026-11-02 to now → 2026-11-02 to 2026-11-04",
      "Severity mild → moderate",
    ]);
  });

  it("describes workouts, priority, bricks, picks and misses on a dated session", () => {
    expect(diffSnapshots(session(), session({ workout: { name: "Long run" }, priority: "key", brickParentId: 9 }))).toEqual([
      "Workout set: Long run",
      "Priority default → key",
      "Linked as a brick",
    ]);
    expect(diffSnapshots(session({ workout: { name: "A" } }), session({ workout: { name: "B" } }))).toEqual(["Workout changed: A → B"]);
    expect(diffSnapshots(session(), session({ status: "missed", missedReason: "Work" }))).toEqual(["Confirmed missed: Work"]);
    expect(diffSnapshots(session(), session({ garminActivityId: 4 }))).toEqual(["Garmin activity picked"]);
  });
});
