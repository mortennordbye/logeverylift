import { db } from "@/db";
import { coachMemory, planRevisions } from "@/db/schema";
import {
  addCoachMemoryEntry,
  deleteCoachMemoryEntry,
  getCoachMemory,
  restoreCoachMemoryEntry,
  updateCoachMemoryEntry,
} from "@/lib/actions/coach-memory";
import { COACH_MEMORY_MAX } from "@/lib/coach-memory";
import { registerCoachMemoryTools } from "@/lib/mcp/tools/coach-memory";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { listAssistantChangeSets, purgePlanRevisions, restoreChangeSet } from "@/lib/plan-revisions";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/** Coach memory in the app and over MCP (docs/plans/ai-coach.md, 2.5), revisioned as object type memory. */

let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
});

const rowOf = async (id: number) => (await db.select().from(coachMemory).where(eq(coachMemory.id, id)))[0];
const revisionsOf = (id: number) =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "memory"), eq(planRevisions.objectId, id)))
    .orderBy(asc(planRevisions.id));

describe("over MCP", () => {
  it("adds, reads, changes, deactivates and deletes, each a revision by the assistant", async () => {
    const call = mcpTools(registerCoachMemoryTools, me);
    const added = await call("manage_coach_memory", { operation: "add", kind: "preference", text: "Long rides on Saturday", reason: "Told me today" });
    expect(added.isError, added.raw).toBe(false);
    const id = added.data.id;
    expect(added.data.version).toBe(1);

    const read = await call("get_coach_memory");
    expect(read.data.entries).toEqual([expect.objectContaining({ id, kind: "preference", text: "Long rides on Saturday", active: true, version: 1 })]);

    const updated = await call("manage_coach_memory", { operation: "update", id, text: "Long rides on Sunday", reason: "Moved", expectedVersion: 1 });
    expect(updated.data.version).toBe(2);
    await call("manage_coach_memory", { operation: "deactivate", id, reason: "Off season", expectedVersion: 2 });
    expect((await call("get_coach_memory")).data.entries).toEqual([]);
    expect((await call("get_coach_memory", { includeInactive: true })).data.entries[0]).toMatchObject({ active: false, version: 3 });

    const deleted = await call("manage_coach_memory", { operation: "delete", id, reason: "No longer true", expectedVersion: 3 });
    expect(deleted.isError, deleted.raw).toBe(false);
    expect((await rowOf(id)).deletedAt).not.toBeNull();

    const revs = await revisionsOf(id);
    expect(revs.map((r) => [r.action, r.writer])).toEqual([
      ["create", "assistant"],
      ["update", "assistant"],
      ["update", "assistant"],
      ["delete", "assistant"],
    ]);
    expect(revs[1].reason).toBe("Moved");
  });

  it("refuses a stale version and changes nothing", async () => {
    const call = mcpTools(registerCoachMemoryTools, me);
    const { id } = (await call("manage_coach_memory", { operation: "add", kind: "limit", text: "Travels every other week", reason: "x" })).data;
    await call("manage_coach_memory", { operation: "update", id, text: "Travels weekly", reason: "x", expectedVersion: 1 });
    const stale = await call("manage_coach_memory", { operation: "update", id, text: "Never travels", reason: "x", expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.raw).toContain("Conflict");
    expect((await rowOf(id)).text).toBe("Travels weekly");
  });

  it("never reads or changes another user's entries", async () => {
    const { id } = (await mcpTools(registerCoachMemoryTools, other)("manage_coach_memory", { operation: "add", kind: "observation", text: "Their knee", reason: "x" })).data;
    const call = mcpTools(registerCoachMemoryTools, me);
    expect((await call("get_coach_memory", { includeInactive: true })).data.entries).toEqual([]);
    const result = await call("manage_coach_memory", { operation: "delete", id, reason: "x", expectedVersion: 1 });
    expect(result).toMatchObject({ isError: true, raw: "Error: Memory entry not found" });
    expect((await rowOf(id)).deletedAt).toBeNull();
  });

  it("caps the live entries", async () => {
    await db.insert(coachMemory).values(
      Array.from({ length: COACH_MEMORY_MAX }, (_, i) => ({ userId: me, kind: "observation" as const, text: `Note ${i}`, entryDate: "2026-11-01" })),
    );
    const result = await mcpTools(registerCoachMemoryTools, me)("manage_coach_memory", { operation: "add", kind: "decision", text: "One more", reason: "x" });
    expect(result.isError).toBe(true);
    expect(result.raw).toContain("full");
  });

  it("joins the assistant's change set, which the user can undo in one step", async () => {
    const call = mcpTools(registerCoachMemoryTools, me);
    const { id } = (await call("manage_coach_memory", { operation: "add", kind: "decision", text: "Strength stays 2x in build", reason: "Agreed" })).data;
    const [set] = await listAssistantChangeSets(me);
    expect(set.objects).toEqual([expect.objectContaining({ type: "memory", id, changes: ['Added decision "Strength stays 2x in build"'] })]);

    await restoreChangeSet({ userId: me, writer: "user" }, set.changeSetId);
    expect((await rowOf(id)).deletedAt).not.toBeNull();
  });

  it("restores a deleted entry from its revision", async () => {
    const call = mcpTools(registerCoachMemoryTools, me);
    const { id } = (await call("manage_coach_memory", { operation: "add", kind: "preference", text: "Swims in the morning", reason: "x" })).data;
    await call("manage_coach_memory", { operation: "delete", id, reason: "x", expectedVersion: 1 });
    const [created] = await revisionsOf(id);
    const restored = await mcpTools(registerProgramTools, me)("restore_revision", { revisionId: created.id, reason: "Deleted by mistake" });
    expect(restored.isError, restored.raw).toBe(false);
    expect(await rowOf(id)).toMatchObject({ deletedAt: null, text: "Swims in the morning" });
  });
});

describe("in the app", () => {
  it("adds, edits, switches off and deletes as the user", async () => {
    asUser(me);
    const added = await addCoachMemoryEntry({ kind: "limit", text: "Hotel gym only on trips" });
    expect(added.success).toBe(true);
    const id = added.success ? added.data.id : 0;
    expect((await updateCoachMemoryEntry({ id, text: "Hotel gym or bands on trips", active: false })).success).toBe(true);
    expect(await rowOf(id)).toMatchObject({ text: "Hotel gym or bands on trips", active: false });
    const list = await getCoachMemory();
    expect(list.success && list.data.entries.map((e) => [e.id, e.lastWriter])).toEqual([[id, "user"]]);
    expect((await deleteCoachMemoryEntry({ id })).success).toBe(true);
    expect((await revisionsOf(id)).map((r) => r.writer)).toEqual(["user", "user", "user"]);
  });

  it("refuses another user's entry and bad input", async () => {
    asUser(other);
    const theirs = await addCoachMemoryEntry({ kind: "preference", text: "Theirs" });
    const id = theirs.success ? theirs.data.id : 0;
    asUser(me);
    expect(await updateCoachMemoryEntry({ id, text: "Mine now" })).toMatchObject({ success: false, error: "Memory entry not found" });
    expect(await deleteCoachMemoryEntry({ id })).toMatchObject({ success: false });
    expect((await addCoachMemoryEntry({ kind: "goal", text: "x" })).success).toBe(false);
    expect((await rowOf(id)).text).toBe("Theirs");
  });
});

describe("retention", () => {
  it("deletes for good an entry deleted more than 90 days ago, with its revisions", async () => {
    asUser(me);
    const added = await addCoachMemoryEntry({ kind: "preference", text: "Old" });
    const id = added.success ? added.data.id : 0;
    await deleteCoachMemoryEntry({ id });
    await db.update(coachMemory).set({ deletedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(coachMemory.id, id));
    await purgePlanRevisions();
    expect(await db.select().from(coachMemory).where(eq(coachMemory.id, id))).toEqual([]);
    expect(await revisionsOf(id)).toEqual([]);
  });
});

describe("review fixes", () => {
  it("lists a memory entry's revisions over MCP", async () => {
    const { id } = (await mcpTools(registerCoachMemoryTools, me)("manage_coach_memory", { operation: "add", kind: "preference", text: "Swims at 7", reason: "x" })).data;
    const list = await mcpTools(registerProgramTools, me)("list_revisions", { objectType: "memory", objectId: id });
    expect(list.isError, list.raw).toBe(false);
    expect(list.data.map((r: { action: string }) => r.action)).toEqual(["create"]);
  });

  it("restores a deleted entry in the app, and shows it under recently deleted until then", async () => {
    asUser(me);
    const added = await addCoachMemoryEntry({ kind: "observation", text: "Knee sore after 90 min runs" });
    const id = added.success ? added.data.id : 0;
    await deleteCoachMemoryEntry({ id });
    const listed = await getCoachMemory();
    expect(listed.success && listed.data.deleted.map((e) => e.id)).toEqual([id]);

    expect((await restoreCoachMemoryEntry({ id })).success).toBe(true);
    expect(await rowOf(id)).toMatchObject({ deletedAt: null, text: "Knee sore after 90 min runs" });
    expect((await restoreCoachMemoryEntry({ id })).success).toBe(false);
  });

  it("refuses to restore past the cap", async () => {
    asUser(me);
    const added = await addCoachMemoryEntry({ kind: "preference", text: "Gone" });
    const id = added.success ? added.data.id : 0;
    await deleteCoachMemoryEntry({ id });
    await db.insert(coachMemory).values(
      Array.from({ length: COACH_MEMORY_MAX }, (_, i) => ({ userId: me, kind: "observation" as const, text: `Note ${i}`, entryDate: "2026-11-01" })),
    );
    const result = await restoreCoachMemoryEntry({ id });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("full") });
    expect((await rowOf(id)).deletedAt).not.toBeNull();
  });

  it("keeps the cap when two adds race", async () => {
    await db.insert(coachMemory).values(
      Array.from({ length: COACH_MEMORY_MAX - 1 }, (_, i) => ({ userId: me, kind: "observation" as const, text: `Note ${i}`, entryDate: "2026-11-01" })),
    );
    const call = mcpTools(registerCoachMemoryTools, me);
    const results = await Promise.all([
      call("manage_coach_memory", { operation: "add", kind: "decision", text: "A", reason: "x" }),
      call("manage_coach_memory", { operation: "add", kind: "decision", text: "B", reason: "x" }),
    ]);
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    expect(await db.select().from(coachMemory).where(eq(coachMemory.userId, me))).toHaveLength(COACH_MEMORY_MAX);
  });

  it("does nothing for an update with nothing in it", async () => {
    const call = mcpTools(registerCoachMemoryTools, me);
    const { id } = (await call("manage_coach_memory", { operation: "add", kind: "preference", text: "Same", reason: "x" })).data;
    const result = await call("manage_coach_memory", { operation: "update", id, reason: "Nothing", expectedVersion: 1 });
    expect(result.data.version).toBe(1);
    expect(await revisionsOf(id)).toHaveLength(1);
  });
});

describe("restoring deleted entries, ownership and age", () => {
  it("never restores or lists another user's deleted entry", async () => {
    asUser(other);
    const theirs = await addCoachMemoryEntry({ kind: "observation", text: "Their knee" });
    const id = theirs.success ? theirs.data.id : 0;
    await deleteCoachMemoryEntry({ id });

    asUser(me);
    const listed = await getCoachMemory();
    expect(listed.success && listed.data.deleted).toEqual([]);
    expect((await restoreCoachMemoryEntry({ id })).success).toBe(false);
    expect((await rowOf(id)).deletedAt).not.toBeNull();
  });

  it("does not restore an entry deleted more than 90 days ago", async () => {
    asUser(me);
    const added = await addCoachMemoryEntry({ kind: "preference", text: "Old one" });
    const id = added.success ? added.data.id : 0;
    await deleteCoachMemoryEntry({ id });
    await db.update(coachMemory).set({ deletedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(coachMemory.id, id));
    expect((await restoreCoachMemoryEntry({ id })).success).toBe(false);
    expect((await rowOf(id)).deletedAt).not.toBeNull();
  });
});

