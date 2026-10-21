/**
 * The one-week check-in: when it is asked, how each answer becomes a revised
 * plan, and that the actions only ever touch the signed-in user's rows.
 */

import { aiSetupPlans, trainingCycles } from "@/db/schema";
import { checkinDue, revisionFor } from "@/lib/utils/ai-checkin";
import type { TemplateParams } from "@/lib/utils/plan-templates";
import { checkinAnswerSchema } from "@/lib/validators/ai-setup";
import { beforeEach, describe, expect, it, vi } from "vitest";

const today = new Date(2026, 9, 21, 15, 30);
const pending = { checkinStatus: "pending" };

describe("checkinDue", () => {
  it("asks once an active cycle has run seven days", () => {
    expect(checkinDue(pending, { status: "active", startDate: "2026-10-14" }, today)).toBe(true);
    expect(checkinDue(pending, { status: "active", startDate: "2026-10-01" }, today)).toBe(true);
    expect(checkinDue(pending, { status: "active", startDate: "2026-10-15" }, today)).toBe(false);
  });

  it("never asks about a draft, finished or deleted cycle, or an answered plan", () => {
    expect(checkinDue(pending, { status: "draft", startDate: null }, today)).toBe(false);
    expect(checkinDue(pending, { status: "completed", startDate: "2026-09-01" }, today)).toBe(false);
    expect(checkinDue(pending, null, today)).toBe(false);
    expect(checkinDue({ checkinStatus: "dismissed" }, { status: "active", startDate: "2026-09-01" }, today)).toBe(false);
  });
});

const picks: TemplateParams = { goal: "muscle_gain", level: "intermediate", daysPerWeek: 4, equipment: "full_gym", weeks: 8, sessionMinutes: 60 };

describe("revisionFor", () => {
  it("fixes length and difficulty with picks, at no AI cost", () => {
    const r = revisionFor({ picks, edit: null }, ["too_long", "too_hard"], "");
    expect(r.picks).toMatchObject({ sessionMinutes: 45, level: "beginner" });
    expect(r.request).toBeNull();
    expect(r.repick).toBeNull();
    expect(r.changes).toEqual(["Sessions shortened to 45 minutes", "Experience set to beginner"]);
  });

  it("asks the AI when a pick is already at its limit", () => {
    const r = revisionFor({ picks: { ...picks, sessionMinutes: 30, level: "advanced" }, edit: null }, ["too_long", "too_easy"], "");
    expect(r.picks).toMatchObject({ sessionMinutes: 30, level: "advanced" });
    expect(r.request).toEqual({ chips: [], text: "Make each session shorter. Make the plan more challenging" });
  });

  it("sends disliked exercises to the AI with the note, keeping the original edit", () => {
    const r = revisionFor(
      { picks, edit: { chips: ["cardio_finisher"], text: "more calves" } },
      ["dislike_exercises"],
      "  no lunges  ",
    );
    expect(r.request).toEqual({ chips: ["cardio_finisher", "swap_named"], text: "more calves. no lunges" });
  });

  it("carries the original edit even when only picks change", () => {
    const r = revisionFor({ picks, edit: { chips: ["prefer_machines"], text: "" } }, ["too_long"], "");
    expect(r.request).toEqual({ chips: ["prefer_machines"], text: "" });
  });

  it("hands days and equipment back to the athlete, days first", () => {
    expect(revisionFor({ picks, edit: null }, ["equipment"], "").repick).toBe("equipment");
    expect(revisionFor({ picks, edit: null }, ["equipment", "wrong_days"], "").repick).toBe("daysPerWeek");
  });

  it("keeps the AI text within the edit limit", () => {
    const r = revisionFor({ picks, edit: { chips: [], text: "x".repeat(150) } }, ["other"], "y".repeat(150));
    expect(r.request!.text.length).toBe(200);
  });
});

describe("checkinAnswerSchema", () => {
  it("needs at least one issue for doesn't fit, and caps the note", () => {
    expect(checkinAnswerSchema.safeParse({ id: 1, status: "does_not_fit", issues: [] }).success).toBe(false);
    expect(checkinAnswerSchema.safeParse({ id: 1, status: "does_not_fit", issues: ["too_long"] }).success).toBe(true);
    expect(checkinAnswerSchema.safeParse({ id: 1, status: "fits" }).success).toBe(true);
    expect(checkinAnswerSchema.safeParse({ id: 1, status: "does_not_fit", issues: ["too_long"], note: "x".repeat(301) }).success).toBe(false);
    expect(checkinAnswerSchema.safeParse({ id: 1, status: "pending" }).success).toBe(false);
  });
});

// ─── Actions ─────────────────────────────────────────────────────────────────

const rows = new Map<unknown, unknown[]>();
const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
const updates: { table: unknown; values: Record<string, unknown> }[] = [];

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const result = () => {
          const p = Promise.resolve(rows.get(table) ?? []);
          return Object.assign(p, { orderBy: () => p });
        };
        const chain = { innerJoin: () => chain, where: result };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { returning: async () => [{ id: 99 }] };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }),
  },
}));
vi.mock("@/lib/utils/session", () => {
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requireSession: async () => ({ user: { id: "me", role: "user" } }),
    assertOwner: (resource: { userId: string } | undefined, userId: string) => {
      if (!resource) throw new ForbiddenError("Not found");
      if (resource.userId !== userId) throw new ForbiddenError("Forbidden");
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { answerCheckin, getPendingCheckin, getRevision, recordAiSetupImport } = await import("@/lib/actions/ai-checkin");

beforeEach(() => {
  rows.clear();
  inserts.length = 0;
  updates.length = 0;
});

describe("check-in actions", () => {
  it("records an import only for the user's own cycle", async () => {
    rows.set(trainingCycles, [{ userId: "me" }]);
    const ok = await recordAiSetupImport({ cycleId: 5, picks, edit: null, revisionOf: null });
    expect(ok).toEqual({ success: true, data: { id: 99 } });
    expect(inserts[0].values).toMatchObject({ userId: "me", cycleId: 5, revisionOf: null });

    rows.set(trainingCycles, [{ userId: "someone-else" }]);
    inserts.length = 0;
    const forbidden = await recordAiSetupImport({ cycleId: 6, picks, edit: null, revisionOf: null });
    expect(forbidden.success).toBe(false);
    expect(inserts).toEqual([]);
  });

  it("won't answer another user's check-in", async () => {
    rows.set(aiSetupPlans, [{ userId: "someone-else" }]);
    const result = await answerCheckin({ id: 3, status: "fits" });
    expect(result.success).toBe(false);
    expect(updates).toEqual([]);
  });

  it("stores issues and note only for doesn't fit", async () => {
    rows.set(aiSetupPlans, [{ userId: "me" }]);
    await answerCheckin({ id: 3, status: "does_not_fit", issues: ["too_long"], note: " shorter please " });
    expect(updates[0].values).toMatchObject({ checkinStatus: "does_not_fit", checkinIssues: ["too_long"], checkinNote: "shorter please" });
    await answerCheckin({ id: 3, status: "dismissed", issues: ["too_long"], note: "x" });
    expect(updates[1].values).toMatchObject({ checkinStatus: "dismissed", checkinIssues: null, checkinNote: null });
  });

  it("returns the newest plan that is due, and nothing when none is", async () => {
    rows.set(aiSetupPlans, [
      { id: 8, checkinStatus: "pending", cycleName: "New", status: "active", startDate: "2099-01-01" },
      { id: 7, checkinStatus: "pending", cycleName: "Old", status: "active", startDate: "2020-01-01" },
    ]);
    expect(await getPendingCheckin()).toEqual({ success: true, data: { id: 7, cycleName: "Old" } });
    rows.set(aiSetupPlans, [{ id: 8, checkinStatus: "pending", cycleName: "New", status: "draft", startDate: null }]);
    expect(await getPendingCheckin()).toEqual({ success: true, data: null });
  });

  it("builds a revision only from the user's own doesn't-fit answer", async () => {
    rows.set(aiSetupPlans, [
      { userId: "me", picks, edit: null, checkinStatus: "does_not_fit", checkinIssues: ["too_long"], checkinNote: null },
    ]);
    const result = await getRevision(3);
    expect(result).toMatchObject({ success: true, data: { revisionOf: 3, picks: { sessionMinutes: 45 }, request: null } });

    rows.set(aiSetupPlans, [{ userId: "me", picks, edit: null, checkinStatus: "fits", checkinIssues: null, checkinNote: null }]);
    expect((await getRevision(3)).success).toBe(false);
    rows.set(aiSetupPlans, [{ userId: "someone-else", picks, edit: null, checkinStatus: "does_not_fit", checkinIssues: ["too_long"], checkinNote: null }]);
    expect((await getRevision(3)).success).toBe(false);
  });
});
