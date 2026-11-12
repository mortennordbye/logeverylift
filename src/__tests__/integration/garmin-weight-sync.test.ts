import { db } from "@/db";
import { garminConnections, garminDays, users } from "@/db/schema";
import { userWeightEntries } from "@/db/schema/weight-history";
import { setGarminWeightSync } from "@/lib/actions/garmin";
import { deleteWeightEntry } from "@/lib/actions/profile";
import { syncGarminWeight } from "@/lib/garmin/weight-sync";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

/** The opt-in copy of Garmin weigh-ins into the profile's weight history, against a real database. */

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: { ...actual.env, GARMIN_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } };
});

const T1 = Date.UTC(2026, 10, 11, 6, 0);
const T2 = Date.UTC(2026, 10, 12, 6, 0);

async function garminUser() {
  const user = await createUser();
  await db.insert(garminConnections).values({ userId: user.id, encryptedKey: "v1.x.y.z" });
  await db.insert(garminDays).values([
    { userId: user.id, calendarDate: "2026-11-11", kind: "weight_entries", data: { items: [{ timestampGMT: T1, weight: 91500 }] } },
    { userId: user.id, calendarDate: "2026-11-12", kind: "weight_entries", data: { items: [{ timestampGMT: T2, weight: 89709 }] } },
  ]);
  return user;
}

const entries = (userId: string) =>
  db.select({ kg: userWeightEntries.weightKg, at: userWeightEntries.recordedAt }).from(userWeightEntries).where(eq(userWeightEntries.userId, userId)).orderBy(asc(userWeightEntries.recordedAt));

describe("setGarminWeightSync", () => {
  it("copies every weigh-in once when turned on and sets body weight to the newest", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");

    const on = await setGarminWeightSync({ enabled: true });
    expect(on).toEqual({ success: true, data: { added: 2, weightKg: 89.7 } });
    expect(await entries(user.id)).toEqual([
      { kg: 91.5, at: new Date(T1) },
      { kg: 89.7, at: new Date(T2) },
    ]);

    // The import runs it again after every sync: nothing is added twice.
    expect(await syncGarminWeight(user.id)).toBe(0);
    expect(await entries(user.id)).toHaveLength(2);
  });

  it("does not add back a copied weigh-in the user deleted, also after turning the sync off and on", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");
    await setGarminWeightSync({ enabled: true });
    const [old] = await db.select({ id: userWeightEntries.id }).from(userWeightEntries).where(and(eq(userWeightEntries.userId, user.id), eq(userWeightEntries.recordedAt, new Date(T1))));
    expect((await deleteWeightEntry(old.id)).success).toBe(true);

    expect(await syncGarminWeight(user.id)).toBe(0);
    await setGarminWeightSync({ enabled: false });
    await setGarminWeightSync({ enabled: true });
    expect((await entries(user.id)).map((e) => e.kg)).toEqual([89.7]);

    // A new weigh-in after the copied ones is still added.
    const T3 = T2 + 86_400_000;
    await db.insert(garminDays).values({ userId: user.id, calendarDate: "2026-11-13", kind: "weight_entries", data: { items: [{ timestampGMT: T3, weight: 89000 }] } });
    expect(await syncGarminWeight(user.id)).toBe(1);
  });

  it("still copies older weigh-ins the history import finds after the sync was turned on", async () => {
    const user = await garminUser();
    asUser(user.id, "admin");
    await setGarminWeightSync({ enabled: true });
    const T0 = T1 - 30 * 86_400_000;
    await db.insert(garminDays).values({ userId: user.id, calendarDate: "2026-10-12", kind: "weight_entries", data: { items: [{ timestampGMT: T0, weight: 93000 }] } });
    expect(await syncGarminWeight(user.id)).toBe(1);
    expect((await entries(user.id)).map((e) => e.kg)).toEqual([93, 91.5, 89.7]);
  });

  it("keeps a newer weight the user typed as the body weight", async () => {
    const user = await garminUser();
    await db.insert(userWeightEntries).values({ id: crypto.randomUUID(), userId: user.id, weightKg: 88, recordedAt: new Date(T2 + 3_600_000) });
    asUser(user.id, "admin");

    expect((await setGarminWeightSync({ enabled: true })).success).toBe(true);
    const [me] = await db.select({ weightKg: users.weightKg }).from(users).where(eq(users.id, user.id));
    expect(me.weightKg).toBe(88);
  });

  it("copies nothing while off, and refuses a user without Garmin", async () => {
    const user = await garminUser();
    expect(await syncGarminWeight(user.id)).toBe(0);
    asUser(user.id, "admin");
    expect(await setGarminWeightSync({ enabled: false })).toEqual({ success: true, data: { added: 0, weightKg: null } });
    expect(await entries(user.id)).toHaveLength(0);

    asUser((await createUser()).id, "admin");
    expect(await setGarminWeightSync({ enabled: true })).toEqual({ success: false, error: "Garmin is not connected" });
    expect((await setGarminWeightSync({ enabled: "yes" })).success).toBe(false);
  });

  it("is turned away for an account that is not allowed to use Garmin", async () => {
    const user = await garminUser();
    asUser(user.id, "user");
    expect(await setGarminWeightSync({ enabled: true })).toEqual({ success: false, error: "Garmin is not enabled for this account" });
  });

  it("only touches the signed-in user's own connection and history", async () => {
    const owner = await garminUser();
    const other = await garminUser();
    asUser(owner.id, "admin");
    await setGarminWeightSync({ enabled: true });

    const [otherConn] = await db.select({ syncWeight: garminConnections.syncWeight }).from(garminConnections).where(eq(garminConnections.userId, other.id));
    expect(otherConn.syncWeight).toBe(false);
    expect(await entries(other.id)).toHaveLength(0);
  });
});
