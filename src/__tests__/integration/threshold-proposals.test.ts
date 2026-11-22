import { db } from "@/db";
import { athleteThresholds, garminActivities, garminActivityStreams, planRevisions, thresholdProposals, users } from "@/db/schema";
import { collectUserData } from "@/lib/account-data";
import { acceptThresholdProposal, addThresholdValue, declineThresholdProposal, getThresholdsData } from "@/lib/actions/athlete-profile";
import { syncGarminThreshold } from "@/lib/athlete-profile";
import { registerAthleteProfileTools } from "@/lib/mcp/tools/athlete-profile";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import { openProposalCount } from "@/lib/threshold-proposals";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/** Coach proposals: propose over MCP, accept or decline in the app (docs/plans/strict-targets.md, decisions 5, 6, 9, 11). */

let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
});

const coach = (userId: string) => mcpTools((s, u) => registerAthleteProfileTools(s, u, "client-coach"), userId);
const proposalsOf = (userId: string) => db.select().from(thresholdProposals).where(eq(thresholdProposals.userId, userId));
const thresholdsOf = (userId: string) => db.select().from(athleteThresholds).where(eq(athleteThresholds.userId, userId));

const FTP = {
  kind: "ftp",
  watts: 188,
  reason: "Best 20 min power 198 W on the ride of 12 Nov (Garmin) x 0.95",
  evidence: { dates: ["2026-11-12"], activityIds: [41], numbers: { best20minW: 198, factor: 0.95 } },
};

async function propose(userId: string, args: Record<string, unknown> = FTP) {
  const r = await coach(userId)("propose_threshold", args);
  expect(r.isError, r.raw).toBe(false);
  return r.data as { id: number; kind: string; value: number; replacedProposalId: number | null };
}

describe("propose_threshold", () => {
  it("stores an open proposal with its reason and evidence, and changes no threshold", async () => {
    const p = await propose(me);
    expect(p).toMatchObject({ proposed: true, kind: "ftp", value: 188, unit: "W", replacedProposalId: null });
    const [row] = await proposalsOf(me);
    expect(row).toMatchObject({ id: p.id, kind: "ftp", value: 188, reason: FTP.reason, evidence: FTP.evidence, status: "open", decidedAt: null, thresholdId: null });
    expect(await thresholdsOf(me)).toEqual([]);

    const read = await coach(me)("get_athlete_profile");
    expect(read.data.openProposals).toEqual([expect.objectContaining({ id: p.id, kind: "ftp", value: 188, reason: FTP.reason, evidence: FTP.evidence })]);
    expect(read.data.thresholds.ftp).toBeNull();
    expect(await openProposalCount(me)).toBe(1);
  });

  it("takes a cadence for the two cadence kinds", async () => {
    const bike = await propose(me, { kind: "bike_cadence", cadence: 88, reason: "Median cadence in Z2 over your last 8 rides (Garmin)" });
    expect(bike).toMatchObject({ value: 88, unit: "rpm" });
    const run = await propose(me, { kind: "run_cadence", cadence: 172, reason: "Median cadence on easy runs" });
    expect(run).toMatchObject({ value: 172, unit: "spm" });
  });

  it("refuses a value out of range, the wrong value field, and no value", async () => {
    const call = coach(me);
    const low = await call("propose_threshold", { kind: "run_cadence", cadence: 86, reason: "Per foot by mistake" });
    expect(low.isError).toBe(true);
    expect(low.raw).toContain("Run cadence must be between 120 spm and 230 spm");
    const wrong = await call("propose_threshold", { kind: "ftp", bpm: 160, reason: "x" });
    expect(wrong.raw).toContain("ftp takes watts, not bpm");
    const none = await call("propose_threshold", { kind: "ftp", reason: "x" });
    expect(none.isError).toBe(true);
    const longReason = await call("propose_threshold", { kind: "ftp", watts: 200, reason: "x".repeat(201) });
    expect(longReason.isError).toBe(true);
    expect(await proposalsOf(me)).toEqual([]);
  });

  it("a new proposal for a kind replaces its open one; other kinds stay", async () => {
    const first = await propose(me);
    const cadence = await propose(me, { kind: "bike_cadence", cadence: 88, reason: "Median cadence" });
    const second = await propose(me, { ...FTP, watts: 192, reason: "Newer ride" });
    expect(second.replacedProposalId).toBe(first.id);
    const rows = await proposalsOf(me);
    expect(rows.map((r) => [r.id, r.kind, r.value, r.status]).sort()).toEqual(
      [
        [cadence.id, "bike_cadence", 88, "open"],
        [second.id, "ftp", 192, "open"],
      ].sort(),
    );
    // The card of the replaced one can no longer be accepted.
    asUser(me);
    expect(await acceptThresholdProposal({ id: first.id })).toEqual({ success: false, error: "This proposal is no longer open" });
    expect(await thresholdsOf(me)).toEqual([]);
  });

  it("a proposal after an answered one opens a new one and keeps the answered", async () => {
    const first = await propose(me);
    asUser(me);
    await declineThresholdProposal({ id: first.id });
    const second = await propose(me);
    expect(second.replacedProposalId).toBeNull();
    expect((await proposalsOf(me)).map((r) => r.status).sort()).toEqual(["declined", "open"]);
  });
});

describe("accept and decline in the app", () => {
  it("accept writes a threshold with source coach, by the user, and closes the proposal", async () => {
    await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 180, measuredOn: "2026-10-01", source: "manual" });
    const p = await propose(me);
    asUser(me);
    const page = await getThresholdsData();
    expect(page.success && page.data.proposals.map((x) => x.id)).toEqual([p.id]);

    const r = await acceptThresholdProposal({ id: p.id });
    expect(r.success, JSON.stringify(r)).toBe(true);
    if (!r.success) return;
    const [t] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, r.data.id));
    expect(t).toMatchObject({ userId: me, kind: "ftp", value: 188, source: "coach", notes: FTP.reason, measuredOn: toDateStr(await userToday(me)) });
    const [closed] = await proposalsOf(me);
    expect(closed).toMatchObject({ status: "accepted", thresholdId: t.id });
    expect(closed.decidedAt).toBeInstanceOf(Date);

    const revs = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "threshold"), eq(planRevisions.objectId, t.id)));
    expect(revs.map((x) => [x.action, x.writer])).toEqual([["create", "user"]]);

    const read = await coach(me)("get_athlete_profile");
    expect(read.data.thresholds.ftp).toMatchObject({ value: 188, source: "coach" });
    expect(read.data.openProposals).toEqual([]);
    expect(await openProposalCount(me)).toBe(0);

    // A second tap adds nothing.
    expect(await acceptThresholdProposal({ id: p.id })).toEqual({ success: false, error: "This proposal is no longer open" });
    expect(await thresholdsOf(me)).toHaveLength(2);
  });

  it("the Garmin sync does not write over an accepted coach value", async () => {
    const p = await propose(me);
    asUser(me);
    await acceptThresholdProposal({ id: p.id });
    await syncGarminThreshold(me, "ftp", 250, toDateStr(await userToday(me)));
    expect((await thresholdsOf(me)).map((t) => [t.value, t.source])).toEqual([[188, "coach"]]);
  });

  it("decline closes it and writes no threshold", async () => {
    const p = await propose(me);
    asUser(me);
    expect(await declineThresholdProposal({ id: p.id })).toEqual({ success: true, data: undefined });
    const [row] = await proposalsOf(me);
    expect(row.status).toBe("declined");
    expect(row.decidedAt).toBeInstanceOf(Date);
    expect(await thresholdsOf(me)).toEqual([]);
    expect(await acceptThresholdProposal({ id: p.id })).toEqual({ success: false, error: "This proposal is no longer open" });
    expect(await declineThresholdProposal({ id: p.id })).toEqual({ success: false, error: "This proposal is no longer open" });
  });

  it("only the owner can answer a proposal or see it", async () => {
    const p = await propose(me);
    asUser(other);
    expect(await acceptThresholdProposal({ id: p.id })).toEqual({ success: false, error: "This proposal is no longer open" });
    expect(await declineThresholdProposal({ id: p.id })).toEqual({ success: false, error: "This proposal is no longer open" });
    const page = await getThresholdsData();
    expect(page.success && page.data.proposals).toEqual([]);
    expect((await coach(other)("get_athlete_profile")).data.openProposals).toEqual([]);
    expect(await thresholdsOf(other)).toEqual([]);
    expect((await proposalsOf(me))[0].status).toBe("open");
  });

  it("refuses a coach value typed in the app", async () => {
    asUser(me);
    expect(await addThresholdValue({ kind: "ftp", value: 200, source: "coach" })).toEqual({
      success: false,
      error: "A coach value comes only from accepting a coach proposal",
    });
    expect(await thresholdsOf(me)).toEqual([]);
  });
});

describe("export and account deletion", () => {
  it("the export holds the user's proposals only, and deleting the account removes them", async () => {
    const mine = await propose(me);
    await propose(other);
    const data = await collectUserData(me);
    expect(data.threshold_proposals.map((r) => r.id)).toEqual([mine.id]);

    await db.delete(users).where(eq(users.id, me));
    expect(await proposalsOf(me)).toEqual([]);
    expect(await proposalsOf(other)).toHaveLength(1);
  });
});

describe("Garmin cadence for the coach", () => {
  it("lists average cadence per activity and per lap, a run's doubled to steps per minute", async () => {
    await db.insert(garminActivities).values([
      { userId: me, garminActivityId: 51, startTimeLocal: new Date(Date.now() - 86_400_000), activityType: "treadmill_running", data: { activityName: "Run", averageRunningCadenceInStepsPerMinute: 154.7 } },
      { userId: me, garminActivityId: 52, startTimeLocal: new Date(Date.now() - 2 * 86_400_000), activityType: "indoor_cycling", data: { activityName: "Ride", averageBikingCadenceInRevPerMinute: 81 } },
    ]);
    await db.insert(garminActivityStreams).values({
      userId: me,
      garminActivityId: 51,
      parserVersion: 4,
      sport: "running",
      streams: {},
      laps: [{ totalTimerTime: 600, avgHeartRate: 140, avgCadence: 77, avgFractionalCadence: 0.04 }],
      sets: [],
      timeInZone: [],
    });
    const garmin = mcpTools(registerGarminTools, me);
    const list = await garmin("list_garmin_activities", {});
    expect(list.data.map((a: { id: number; avgCadence: number | null }) => [a.id, a.avgCadence])).toEqual([
      [51, 155],
      [52, 81],
    ]);
    const run = await garmin("get_garmin_activity", { id: 51 });
    expect(run.data).toMatchObject({ sport: "run", avgCadence: 155, laps: [{ n: 1, avgHr: 140, avgCadence: 154 }] });
  });
});
