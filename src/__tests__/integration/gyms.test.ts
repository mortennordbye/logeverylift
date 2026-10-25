import { db } from "@/db";
import { gyms, users } from "@/db/schema";
import { getGymMap, getGymMembers, searchGyms, setPrimaryGym } from "@/lib/actions/gyms";
import { importGyms, importGymsIfStale } from "@/lib/gym-import";
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
const callsTo = (host: string) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(host));

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
    expect(callsTo("nominatim")).toHaveLength(1);
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
  it("answers near me from the imported gyms, nearest first, without asking Overpass", async () => {
    const importedAt = new Date();
    await db.insert(gyms).values([
      { osmRef: "node/1", name: "Far", lat: 59.95, lng: 10.71, address: null, importedAt },
      { osmRef: "node/2", name: "Near", lat: 59.931, lng: 10.711, address: "Kirkeveien 1", importedAt },
      { osmRef: "node/3", name: "Other town", lat: 60.39, lng: 5.32, address: null, importedAt },
    ]);
    asUser((await createUser()).id);

    const result = await searchGyms({ lat: 59.93, lng: 10.71 });
    expect(result.success && result.data.map((g) => g.name)).toEqual(["Near", "Far"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Overpass where nothing is imported, even next to a gym someone picked", async () => {
    await db.insert(gyms).values({ osmRef: "node/7", name: "Picked abroad", lat: 52.52, lng: 13.4, address: null });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] })));
    asUser((await createUser()).id);

    expect(await searchGyms({ lat: 52.52, lng: 13.4 })).toEqual({ success: true, data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

  it("retries a busy Overpass once, then says to search by name", async () => {
    asUser((await createUser()).id);
    fetchMock
      .mockResolvedValueOnce(new Response("at capacity", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ type: "node", id: 9, lat: 59.93, lon: 10.71, tags: { name: "3T" } }] })),
      );
    const first = await searchGyms({ lat: 59.93, lng: 10.71 });
    expect(first.success && first.data.map((g) => g.name)).toEqual(["3T"]);

    vi.setSystemTime((clock += 2_000));
    fetchMock
      .mockResolvedValueOnce(new Response("at capacity", { status: 502 }))
      .mockResolvedValueOnce(new Response("at capacity", { status: 504 }));
    const second = await searchGyms({ lat: 59.93, lng: 10.71 });
    expect(second).toEqual({ success: false, error: expect.stringContaining("search by name") });
  });

  it("searches Nominatim by name, and answers a repeat from cache", async () => {
    asUser((await createUser()).id);
    expect(await searchGyms({ query: "SATS" })).toEqual({ success: true, data: [] });
    vi.setSystemTime((clock += 2_000));
    expect(await searchGyms({ query: "sats " })).toEqual({ success: true, data: [] });
    expect(callsTo("nominatim")).toHaveLength(1);
    expect(callsTo("data.brreg.no/enhetsregisteret/api/underenheter")).toHaveLength(1);
    const url = String(callsTo("nominatim")[0][0]);
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

describe("importGyms", () => {
  const overpass = (elements: unknown[]) => new Response(JSON.stringify({ elements }));

  it("upserts every named gym in the country and drops ones OSM no longer has, unless picked", async () => {
    const old = new Date(clock - 30 * 86_400_000);
    await db.insert(gyms).values([
      { osmRef: "node/1", name: "Old name", lat: 59.9, lng: 10.7, address: null, importedAt: old },
      { osmRef: "node/2", name: "Closed", lat: 59.9, lng: 10.7, address: null, importedAt: old },
      { osmRef: "node/3", name: "Closed but picked", lat: 59.9, lng: 10.7, address: null, importedAt: old },
    ]);
    const [picked] = await db.select({ id: gyms.id }).from(gyms).where(eq(gyms.osmRef, "node/3"));
    const u = await createUser();
    await db.update(users).set({ primaryGymId: picked.id }).where(eq(users.id, u.id));
    fetchMock.mockResolvedValueOnce(
      overpass([
        { type: "node", id: 1, lat: 59.91, lon: 10.71, tags: { name: "New name" } },
        { type: "way", id: 5, center: { lat: 60.39, lon: 5.32 }, tags: { name: "Bergen gym" } },
        { type: "node", id: 6, lat: 60, lon: 10, tags: {} },
      ]),
    );

    expect(await importGyms(["NO"])).toBe(2);
    const body = decodeURIComponent(String(fetchMock.mock.calls[0][1].body));
    expect(body).toContain('"ISO3166-1"="NO"');

    const rows = await db.select().from(gyms).orderBy(gyms.osmRef);
    expect(rows.map((r) => [r.osmRef, r.name])).toEqual([
      ["node/1", "New name"],
      ["node/3", "Closed but picked"],
      ["way/5", "Bergen gym"],
    ]);
    expect(rows[0].importedAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("leaves the gyms alone when Overpass fails", async () => {
    await db.insert(gyms).values({ osmRef: "node/1", name: "Kept", lat: 59.9, lng: 10.7, address: null, importedAt: new Date(0) });
    fetchMock.mockResolvedValueOnce(new Response("at capacity", { status: 504 }));
    await expect(importGyms(["NO"])).rejects.toThrow("overpass 504");
    expect(await db.select().from(gyms)).toHaveLength(1);
  });

  it("runs only when the last import is a week old", async () => {
    await db.insert(gyms).values({ osmRef: "node/1", name: "Fresh", lat: 59.9, lng: 10.7, address: null, importedAt: new Date(clock - 86_400_000) });
    await importGymsIfStale(["NO"]);
    expect(fetchMock).not.toHaveBeenCalled();

    await db.update(gyms).set({ importedAt: new Date(clock - 8 * 86_400_000) });
    fetchMock.mockResolvedValueOnce(overpass([]));
    await importGymsIfStale(["NO"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("business register gyms", () => {
  // What data.brreg.no and Kartverket answer, by URL.
  const regUnit = (orgnr: string, navn: string, parent: string, street: string) => ({
    organisasjonsnummer: orgnr,
    overordnetEnhet: parent,
    navn,
    naeringskode1: { kode: "86.210" },
    beliggenhetsadresse: { adresse: [street], poststed: "OSLO", kommunenummer: "0301" },
  });
  const nydalen = regUnit("934609050", "STERK HELSE OG TRENING NYDALEN AS", "834391422", "Maridalsveien 323");
  const loren = regUnit("995016141", "STERK HELSE OG TRENING LØREN AS", "834391422", "Lørenveien 44");
  const soleTrader = regUnit("900000001", "STERK TRENING KARI", "900000002", "Hjemmeveien 1");
  const points: Record<string, { lat: number; lon: number }> = {
    "Maridalsveien 323": { lat: 59.9543, lon: 10.7612 },
    "Lørenveien 44": { lat: 59.9305, lon: 10.7929 },
    "Hjemmeveien 1": { lat: 59.9, lon: 10.8 },
  };

  function serveRegister(osm: unknown[] = []) {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.host.includes("nominatim")) return new Response(JSON.stringify(osm));
      if (u.pathname.endsWith("/underenheter")) return new Response(JSON.stringify({ _embedded: { underenheter: [nydalen, loren, soleTrader] } }));
      if (u.pathname.endsWith("/underenheter/934609050")) return new Response(JSON.stringify(nydalen));
      if (u.pathname.endsWith("/underenheter/900000001")) return new Response(JSON.stringify(soleTrader));
      if (u.pathname.endsWith("/enheter"))
        return new Response(
          JSON.stringify({
            _embedded: {
              enheter: [
                { organisasjonsnummer: "834391422", organisasjonsform: { kode: "AS" } },
                { organisasjonsnummer: "900000002", organisasjonsform: { kode: "ENK" } },
              ],
            },
          }),
        );
      if (u.host === "ws.geonorge.no") {
        const p = points[u.searchParams.get("sok")!];
        return new Response(JSON.stringify({ adresser: p ? [{ representasjonspunkt: p }] : [] }));
      }
      return new Response("[]");
    });
  }

  it("finds a gym OpenStreetMap lacks by name, but not one OSM already has or a sole trader", async () => {
    // OSM has the Løren gym, a few metres from the register's address for it.
    serveRegister([{ ...satsLookup, osm_id: 77, name: "Sterk", lat: "59.9304", lon: "10.7928", display_name: "Sterk, Lørenveien, Oslo" }]);
    asUser((await createUser()).id);

    const result = await searchGyms({ query: "sterk" });
    expect(result.success && result.data).toEqual([
      { osmRef: "node/77", name: "Sterk", lat: 59.9304, lng: 10.7928, address: "Lørenveien, Oslo" },
      { osmRef: "brreg/934609050", name: "Sterk Helse og Trening Nydalen", lat: 59.9543, lng: 10.7612, address: "Maridalsveien 323, Oslo" },
    ]);
    // Kartverket only ever sees the gyms' addresses.
    expect(callsTo("geonorge").map((c) => new URL(String(c[0])).searchParams.get("sok")).sort()).toEqual([
      "Lørenveien 44",
      "Maridalsveien 323",
    ]);

    expect(await setPrimaryGym({ osmRef: "brreg/934609050" })).toEqual({ success: true, data: undefined });
    const [row] = await db.select().from(gyms).where(eq(gyms.osmRef, "brreg/934609050"));
    expect(row).toMatchObject({ name: "Sterk Helse og Trening Nydalen", lat: 59.9543, lng: 10.7612 });
  });

  it("filters the register's answer for the rarest word of a multi-word search", async () => {
    serveRegister();
    const serve = fetchMock.getMockImplementation() as (url: string | URL) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = new URL(String(url));
      if (!u.pathname.endsWith("/underenheter")) return serve(url);
      // "nydalen" is the common word here; its first page holds no Sterk.
      const word = u.searchParams.get("navn");
      expect(u.searchParams.get("navnMetodeForSoek")).toBe("FORTLOEPENDE");
      const units = word === "sterk" ? [nydalen, loren] : [];
      return new Response(JSON.stringify({ _embedded: { underenheter: units }, page: { totalElements: word === "sterk" ? 97 : 201 } }));
    });
    asUser((await createUser()).id);
    const result = await searchGyms({ query: "Sterk Nydalen" });
    expect(result.success && result.data.map((g) => g.osmRef)).toEqual(["brreg/934609050"]);
  });

  it("looks a register gym up again when picked without a search, and refuses a sole trader", async () => {
    serveRegister();
    asUser((await createUser()).id);
    expect(await setPrimaryGym({ osmRef: "brreg/934609050" })).toEqual({ success: true, data: undefined });
    expect((await setPrimaryGym({ osmRef: "brreg/900000001" })).success).toBe(false);
    expect(await db.select({ ref: gyms.osmRef }).from(gyms)).toEqual([{ ref: "brreg/934609050" }]);
  });

  it("still answers from OpenStreetMap when the register is down", async () => {
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes("nominatim") ? new Response(JSON.stringify([satsLookup])) : new Response("down", { status: 503 }),
    );
    asUser((await createUser()).id);
    const result = await searchGyms({ query: "sats majorstuen" });
    expect(result.success && result.data.map((g) => g.osmRef)).toEqual(["node/123"]);
  });
});
