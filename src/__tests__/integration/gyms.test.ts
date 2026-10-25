import { db } from "@/db";
import { gyms, users } from "@/db/schema";
import { getGymMap, getGymMembers, searchGyms, setPrimaryGym } from "@/lib/actions/gyms";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

// What Nominatim's /lookup answers for a gym, and for a place that isn't one.
const satsLookup = {
  osm_type: "node",
  osm_id: 123,
  lat: "59.93",
  lon: "10.71",
  category: "leisure",
  type: "fitness_centre",
  name: "SATS Majorstuen",
  display_name: "SATS Majorstuen, 12, Kirkeveien, Majorstuen, Oslo",
};
const cafeLookup = { ...satsLookup, osm_id: 124, category: "amenity", type: "cafe", name: "Cafe" };

let clock = new Date("2030-01-01T00:00:00Z").getTime();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Each test starts clear of the in-memory rate limits and search cache.
  clock += 3_600_000;
  // Date only, moving with real time, so the code's own waits still let it advance.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(clock);
  fetchMock = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/lookup")) {
      const ids = new URL(u).searchParams.get("osm_ids");
      return new Response(JSON.stringify(ids === "N123" ? [satsLookup] : ids === "N124" ? [cafeLookup] : []));
    }
    return new Response("[]");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function pick(userId: string, osmRef: string | null) {
  asUser(userId);
  vi.setSystemTime((clock += 2_000)); // past the shared one-a-second OSM limit
  const result = await setPrimaryGym({ osmRef });
  if (!result.success) throw new Error(result.error);
}

describe("setPrimaryGym", () => {
  it("stores the gym as OpenStreetMap has it, once, and clearing opts out", async () => {
    const a = await createUser();
    const b = await createUser();
    await pick(a.id, "node/123");
    await pick(b.id, "node/123");

    const rows = await db.select().from(gyms);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "SATS Majorstuen", lat: 59.93, lng: 10.71 });

    await pick(a.id, null);
    const [row] = await db.select({ gym: users.primaryGymId }).from(users).where(eq(users.id, a.id));
    expect(row.gym).toBeNull();
  });

  it("ignores a name or position sent by the client", async () => {
    asUser((await createUser()).id);
    await setPrimaryGym({ osmRef: "node/123", name: "Vandalised", lat: 1, lng: 1 });
    const [row] = await db.select().from(gyms);
    expect(row).toMatchObject({ name: "SATS Majorstuen", lat: 59.93 });
  });

  it("saves a gym picked from search results straight away, without looking it up again", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ ...satsLookup, osm_id: 555 }])));
    asUser((await createUser()).id);
    await searchGyms({ query: "sats majorstuen" });
    // Same second as the search, which holds the shared Nominatim slot.
    expect(await setPrimaryGym({ osmRef: "node/555" })).toEqual({ success: true, data: undefined });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("waits out the shared Nominatim slot instead of refusing a pick", async () => {
    asUser((await createUser()).id);
    await searchGyms({ query: "something else" });
    expect((await setPrimaryGym({ osmRef: "node/123" })).success).toBe(true);
  });

  it("refuses a place that isn't a gym, or doesn't exist", async () => {
    asUser((await createUser()).id);
    expect((await setPrimaryGym({ osmRef: "node/124" })).success).toBe(false);
    vi.setSystemTime((clock += 2_000));
    expect((await setPrimaryGym({ osmRef: "node/999" })).success).toBe(false);
    expect(await db.select().from(gyms)).toHaveLength(0);
  });

  it("rejects a reference that isn't an OpenStreetMap element", async () => {
    asUser((await createUser()).id);
    expect((await setPrimaryGym({ osmRef: "1; drop table" })).success).toBe(false);
  });
});

describe("gym map", () => {
  it("counts only users who picked the gym, and lists them without email", async () => {
    const me = await createUser({ name: "Me" });
    const kari = await createUser({ name: "Kari", email: "kari@example.com" });
    await createUser({ name: "Not there" });
    await pick(kari.id, "node/123");
    await pick(me.id, "node/123");

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
    await pick(me.id, "node/123");
    await pick(me.id, null);
    const map = await getGymMap();
    expect(map.success && map.data).toEqual([]);
  });
});

describe("searchGyms", () => {
  it("sends Overpass only a rounded position, for gyms and sports centres", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 59.93, lon: 10.71, tags: { name: "3T" } }] })),
    );
    asUser((await createUser()).id);

    const result = await searchGyms({ lat: 59.929612, lng: 10.714612 });
    expect(result).toEqual({
      success: true,
      data: [{ osmRef: "node/1", name: "3T", lat: 59.93, lng: 10.71, address: null }],
    });
    const body = decodeURIComponent(String(fetchMock.mock.calls[0][1].body));
    expect(body).toContain("around:3000,59.93,10.71");
    expect(body).toContain("sports_centre");
    expect(body).not.toContain("59.9296");
  });

  it("searches Nominatim by name, and answers a repeat from cache", async () => {
    asUser((await createUser()).id);
    expect(await searchGyms({ query: "SATS" })).toEqual({ success: true, data: [] });
    vi.setSystemTime((clock += 2_000));
    expect(await searchGyms({ query: "sats " })).toEqual({ success: true, data: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("q=sats");
  });

  it("limits each user to 10 searches a minute", async () => {
    asUser((await createUser()).id);
    const results = [];
    for (let i = 0; i < 11; i++) {
      vi.setSystemTime((clock += 1_500));
      results.push((await searchGyms({ query: `gym ${i}` })).success);
    }
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
  });

  it("lets a second user through when one search is turned away by the shared limit", async () => {
    asUser((await createUser()).id);
    await searchGyms({ query: "first" });
    // Same second: the shared Nominatim limit refuses, but "near me" uses
    // Overpass and must not be held to it.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] })));
    asUser((await createUser()).id);
    expect((await searchGyms({ lat: 59.9, lng: 10.7 })).success).toBe(true);
  });
});
