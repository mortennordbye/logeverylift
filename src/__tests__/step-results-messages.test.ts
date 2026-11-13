import { DuplicateSession } from "@/lib/logged-sessions";
import { PlanStateError } from "@/lib/plan-revisions";
import { StepResultsError, appErrorMessage } from "@/lib/step-results";
import { describe, expect, it, vi } from "vitest";

// The modules import `@/db`, which validates env vars at import time; nothing here queries.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/garmin/access", () => ({ garminAllowedFor: async () => false, garminAllowed: () => false }));

/** Review fix 14: the app shows a message written for the user, not the one for the MCP assistant. */
describe("appErrorMessage", () => {
  it("turns a duplicate session into a user-facing line", () => {
    const msg = appErrorMessage(new DuplicateSession(12));
    expect(msg).toBe("This session is already logged for that day. Open it in History to change it.");
    expect(msg).not.toContain("recent_workouts");
  });
  it("passes the plain refusals through, and nothing else", () => {
    expect(appErrorMessage(new PlanStateError("No time recorded for this session"))).toBe("No time recorded for this session");
    expect(appErrorMessage(new StepResultsError([{ path: "0.key", message: "x" }]))).toBe("Step results refused: 0.key: x");
    expect(appErrorMessage(new Error("boom"))).toBeNull();
  });
});
