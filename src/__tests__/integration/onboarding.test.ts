import { db } from "@/db";
import { users } from "@/db/schema";
import { isSharePromptDue, markSharePromptSeen } from "@/lib/actions/onboarding";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, createUser } from "./factories";
import { asUser } from "./setup";

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  userId = (await createUser({ tutorialDismissedAt: new Date() })).id;
  otherUserId = (await createUser({ tutorialDismissedAt: new Date() })).id;
  asUser(userId);
});

async function completeSessions(uid: string, n: number, source: "app" | "auto" = "app") {
  for (let i = 0; i < n; i++) {
    await createSession(uid, null, { isCompleted: true, source, date: `2026-10-${String(i + 1).padStart(2, "0")}` });
  }
}

describe("isSharePromptDue", () => {
  it("is due after five completed app workouts", async () => {
    await completeSessions(userId, 4);
    expect(await isSharePromptDue()).toBe(false);
    await completeSessions(userId, 1);
    expect(await isSharePromptDue()).toBe(true);
  });

  it("does not count auto sessions, open sessions or other users' workouts", async () => {
    await completeSessions(userId, 2);
    await completeSessions(userId, 5, "auto");
    await createSession(userId, null, { isCompleted: false });
    await completeSessions(otherUserId, 5);
    expect(await isSharePromptDue()).toBe(false);
  });
});

describe("markSharePromptSeen", () => {
  it("quiets the prompt for the caller only", async () => {
    await completeSessions(userId, 5);
    await completeSessions(otherUserId, 5);

    expect((await markSharePromptSeen()).success).toBe(true);
    expect(await isSharePromptDue()).toBe(false);

    const [other] = await db.select().from(users).where(eq(users.id, otherUserId));
    expect(other.sharePromptAt).toBeNull();
    asUser(otherUserId);
    expect(await isSharePromptDue()).toBe(true);
  });
});
