import { db } from "@/db";
import { gyms, users } from "@/db/schema";
import { getGymMap, getGymMembers, searchGyms, setPrimaryGym } from "@/lib/actions/gyms";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

const sats = { osmRef: "node/123", name: "SATS Majorstuen", lat: 59.93, lng: 10.71, address: "Kirkeveien 12" };

async function pick(userId: string, gym: typeof sats | null) {
  asUser(userId);
  const result = await setPrimaryGym({ gym });
  if (!result.success) throw new Error(result.error);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("setPrimaryGym", () => {
  it("stores the gym once and points every member at it, and clearing opts out", async () => {
    const a = await createUser();
    const b = await createUser();
    await pick(a.id, sats);
    await pick(b.id, { ...sats, name: "SATS Majorstuen (renamed)" });

    const rows = await db.select().from(gyms);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("SATS Majorstuen (renamed)");

    await pick(a.id, null);
    const [row] = await db.select({ gym: users.primaryGymId }).from(users).where(eq(users.id, a.id));
    expect(row.gym).toBeNull();
  });

  it("rejects a gym that isn't an OpenStreetMap element", async () => {
    asUser((await createUser()).id);
    expect((await setPrimaryGym({ gym: { ...sats, osmRef: "1; drop table" } })).success).toBe(false);
  });
});

describe("gym map", () => {
  it("counts only users who picked the gym, and lists them without email", async () => {
    const me = await createUser({ name: "Me" });
    const kari = await createUser({ name: "Kari", email: "kari@example.com" });
    await createUser({ name: "Not there" });
    await pick(kari.id, sats);
    await pick(me.id, sats);

    const map = await getGymMap();
    if (!map.success) throw new Error(map.error);
    expect(map.data).toEqual([expect.objectContaining({ name: "SATS Majorstuen", memberCount: 2 })]);

    const members = await getGymMembers({ gymId: map.data[0].id });
    if (!members.success) throw new Error(members.error);
    expect(members.data.map((m) => [m.name, m.isMe, m.friendshipStatus])).toEqual([
      ["Kari", false, "none"],
      ["Me", true, "none"],
    ]);
    expect(JSON.stringify(members.data)).not.toContain("kari@example.com");
  });

  it("leaves a gym off the map once its last member leaves", async () => {
    const me = await createUser();
    await pick(me.id, sats);
    await pick(me.id, null);
    const map = await getGymMap();
    expect(map.success && map.data).toEqual([]);
  });
});

describe("searchGyms", () => {
  it("sends Overpass only a rounded position and returns named gyms", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 59.93, lon: 10.71, tags: { name: "3T" } }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    asUser((await createUser()).id);

    const result = await searchGyms({ lat: 59.929612, lng: 10.714612 });
    expect(result).toEqual({
      success: true,
      data: [{ osmRef: "node/1", name: "3T", lat: 59.93, lng: 10.71, address: null }],
    });
    const body = decodeURIComponent(String(fetchMock.mock.calls[0][1].body));
    expect(body).toContain("around:3000,59.93,10.71");
    expect(body).not.toContain("59.9296");
  });

  it("searches Nominatim by name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:01:00Z"));
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    asUser((await createUser()).id);

    expect(await searchGyms({ query: "SATS" })).toEqual({ success: true, data: [] });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("q=SATS");
  });
});
