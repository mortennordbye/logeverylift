import { db } from "@/db";
import { oauthAccessTokens, oauthClients, oauthConsents, oauthRefreshTokens } from "@/db/schema";
import { disconnectAssistant } from "@/lib/actions/assistants";
import { connectionAccess } from "@/lib/mcp/access";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createOAuthClient, createOAuthConnection, createUser } from "./factories";
import { asUser } from "./setup";

/** More → Connected assistants: disconnect ends access at once and only for the caller. */

const FULL = ["openid", "offline_access", "mcp:read", "mcp:write"];

let me: string;
let other: string;
let clientId: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
  clientId = (await createOAuthClient()).clientId;
});

describe("disconnectAssistant", () => {
  it("deletes the consent, revokes the tokens and ends access on the next request", async () => {
    const mine = await createOAuthConnection(me, clientId, FULL);
    const theirs = await createOAuthConnection(other, clientId, FULL);
    expect(await connectionAccess(me, clientId, FULL.join(" "))).toEqual({ kind: "ok", access: "write" });

    asUser(me);
    expect(await disconnectAssistant({ id: mine.consent.id })).toEqual({ success: true, data: null });

    expect(await connectionAccess(me, clientId, FULL.join(" "))).toEqual({ kind: "revoked" });
    expect(await db.select().from(oauthConsents).where(eq(oauthConsents.id, mine.consent.id))).toEqual([]);
    const [refresh] = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, mine.refresh.id));
    const [access] = await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.id, mine.access.id));
    expect(refresh.revoked).not.toBeNull();
    expect(access.revoked).not.toBeNull();

    // The other user of the same client keeps everything, and the client row stays.
    expect(await connectionAccess(other, clientId, FULL.join(" "))).toEqual({ kind: "ok", access: "write" });
    const [theirRefresh] = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, theirs.refresh.id));
    expect(theirRefresh.revoked).toBeNull();
    expect(await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId))).toHaveLength(1);
  });

  it("refuses another user's consent and leaves it alone", async () => {
    const theirs = await createOAuthConnection(other, clientId, FULL);
    asUser(me);
    expect(await disconnectAssistant({ id: theirs.consent.id })).toMatchObject({ success: false });
    expect(await db.select().from(oauthConsents).where(eq(oauthConsents.id, theirs.consent.id))).toHaveLength(1);
    expect(await connectionAccess(other, clientId, FULL.join(" "))).toEqual({ kind: "ok", access: "write" });
  });

  it("refuses an unknown id and bad input", async () => {
    asUser(me);
    expect(await disconnectAssistant({ id: "nope" })).toMatchObject({ success: false, error: "Not found" });
    expect(await disconnectAssistant({})).toMatchObject({ success: false, error: "Invalid input" });
  });
});
