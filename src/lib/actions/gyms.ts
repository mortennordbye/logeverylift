"use server";

import { db } from "@/db";
import { friendships, gyms, users } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  displayName,
  listableParents,
  metresBetween,
  nameMatches,
  parseKartverket,
  parseRegisterUnits,
  type RegisterUnit,
} from "@/lib/utils/brreg-gyms";
import { OSM_HEADERS, parseNominatim, parseOverpass, roundCoordinate, type GymResult } from "@/lib/utils/osm-gyms";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult, UserSearchResult } from "@/types/workout";
import { and, between, count, eq, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const NEAR_ME_RADIUS_M = 3000;
const NEAR_ME_BUSY = "Finding gyms near you isn't working right now. Try again later, or search by name.";

const searchGymsSchema = z.union([
  z.object({ query: z.string().trim().min(2).max(100) }),
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
]);

// An OpenStreetMap element, or "brreg/<orgnr>" for a gym only the business register has.
const setPrimaryGymSchema = z.object({ osmRef: z.string().regex(/^((node|way|relation)\/\d+|brreg\/\d{9})$/).nullable() });

const gymMembersSchema = z.object({ gymId: z.number().int().positive() });

export type GymPin = { id: number; name: string; lat: number; lng: number; address: string | null; memberCount: number };
export type GymMember = Pick<UserSearchResult, "id" | "name" | "image" | "friendshipStatus"> & { isMe: boolean };

// Nominatim allows one request a second from the whole app and asks for
// repeated queries to be cached. Overpass has no such limit.
const NOMINATIM_LIMIT = { windowMs: 1_000, max: 1 };
const SEARCH_CACHE_MS = 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const searchCache = new Map<string, { at: number; data: GymResult[] }>();
// Every gym a search returned, by osmRef: these came from OpenStreetMap or the
// business register through this server, so picking one needs no second lookup.
const foundGyms = new Map<string, { at: number; gym: GymResult }>();

function remember(results: GymResult[]) {
  const now = Date.now();
  for (const gym of results) {
    if (foundGyms.size >= SEARCH_CACHE_MAX * 20) foundGyms.delete(foundGyms.keys().next().value!);
    foundGyms.set(gym.osmRef, { at: now, gym });
  }
}

/** Take the shared Nominatim slot, waiting out the rest of the second if it's in use. */
async function nominatimSlot(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!checkRateLimit("gyms:nominatim", NOMINATIM_LIMIT)) return true;
    await new Promise((r) => setTimeout(r, NOMINATIM_LIMIT.windowMs));
  }
  return false;
}

async function nominatim(path: "search" | "lookup", params: Record<string, string>): Promise<GymResult[]> {
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
  url.search = new URLSearchParams({ format: "jsonv2", ...params }).toString();
  const res = await fetch(url, { headers: OSM_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return parseNominatim(await res.json());
}

const REGISTER_HEADERS = { Accept: "application/json" };
// A register gym this close to an OpenStreetMap one is the same gym. Not by
// name: chains share one, and their branches can be a few hundred metres apart.
const SAME_GYM_M = 150;

/**
 * Gyms from the Brønnøysund business register, placed by Kartverket's address
 * search. Only the units' business addresses are sent to Kartverket.
 */
async function registerGyms(units: RegisterUnit[]): Promise<GymResult[]> {
  if (units.length === 0) return [];
  const parents = [...new Set(units.map((u) => u.parent).filter((p): p is string => p !== null))];
  const res = await fetch(
    `https://data.brreg.no/enhetsregisteret/api/enheter?organisasjonsnummer=${parents.join(",")}&size=${parents.length}`,
    { headers: REGISTER_HEADERS, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`brreg ${res.status}`);
  const listable = listableParents(await res.json());

  const placed = await Promise.all(
    units
      .filter((u) => u.parent !== null && listable.has(u.parent))
      .slice(0, 15)
      .map(async (u): Promise<GymResult | null> => {
        const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
        url.search = new URLSearchParams({ sok: u.street, kommunenummer: u.municipality, treffPerSide: "1" }).toString();
        const geo = await fetch(url, { headers: REGISTER_HEADERS, signal: AbortSignal.timeout(8000) });
        const point = geo.ok ? parseKartverket(await geo.json()) : null;
        if (!point) return null;
        const town = u.postalTown && displayName(u.postalTown);
        return { osmRef: `brreg/${u.orgnr}`, name: displayName(u.name), ...point, address: [u.street, town].filter(Boolean).join(", ") };
      }),
  );
  return placed.filter((g): g is GymResult => g !== null);
}

/**
 * Register gyms whose name holds every word of the search, at most 15. The
 * register's word search takes one word and pages alphabetically, so ask for
 * each word and filter the answer with the fewest hits.
 */
async function registerSearch(query: string): Promise<GymResult[]> {
  const words = query.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
  const pages = await Promise.all(
    words.map(async (word) => {
      const url = new URL("https://data.brreg.no/enhetsregisteret/api/underenheter");
      url.search = new URLSearchParams({ navn: word, navnMetodeForSoek: "FORTLOEPENDE", size: "200" }).toString();
      const res = await fetch(url, { headers: REGISTER_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`brreg ${res.status}`);
      const json = await res.json();
      return { json, total: Number(json?.page?.totalElements ?? Infinity) };
    }),
  );
  const fewest = pages.sort((a, b) => a.total - b.total)[0];
  if (!fewest) return [];
  const units = parseRegisterUnits(fewest.json).filter((u) => nameMatches(u.name, query));
  return registerGyms(units.slice(0, 50));
}

/** Imported gyms within NEAR_ME_RADIUS_M of the point, nearest first, at most 30. */
async function importedGymsNear(lat: number, lng: number): Promise<GymResult[]> {
  const dLat = NEAR_ME_RADIUS_M / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const rows = await db
    .select({ osmRef: gyms.osmRef, name: gyms.name, lat: gyms.lat, lng: gyms.lng, address: gyms.address })
    .from(gyms)
    .where(and(isNotNull(gyms.importedAt), between(gyms.lat, lat - dLat, lat + dLat), between(gyms.lng, lng - dLng, lng + dLng)));
  return rows
    .map((g) => ({ g, d: metresBetween({ lat, lng }, g) }))
    .filter((r) => r.d <= NEAR_ME_RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 30)
    .map((r) => r.g);
}

/**
 * Find gyms by name (Nominatim, plus the Norwegian business register for gyms
 * OpenStreetMap lacks) or near a point (the imported gyms, or Overpass where
 * none are imported). The request goes from the
 * server, so OSM never sees the user's IP, and a point is rounded to about a
 * kilometre before it is sent. Nothing here is stored.
 */
export async function searchGyms(data: unknown): Promise<ActionResult<GymResult[]>> {
  const auth = await requireSession();
  const parsed = searchGymsSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid search" };
  const busy = { success: false as const, error: "Too many searches. Try again in a moment." };

  const key = "query" in parsed.data ? parsed.data.query.toLowerCase() : null;
  const cached = key !== null ? searchCache.get(key) : undefined;
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return { success: true, data: cached.data };

  // The shared limit first, so a search it turns away doesn't use one of the user's.
  if (key !== null && checkRateLimit("gyms:nominatim", NOMINATIM_LIMIT)) return busy;
  if (checkRateLimit(`gyms:${auth.user.id}`, { windowMs: 60_000, max: 10 })) return busy;

  try {
    if (key !== null) {
      // The register is a second source, so name search still works without it.
      const [osm, register] = await Promise.all([
        nominatim("search", { q: key, limit: "20" }),
        registerSearch(key).catch((e) => {
          console.error("[searchGyms] register_failed", e instanceof Error ? e.message : "unknown");
          return [];
        }),
      ]);
      const results = [
        ...osm,
        ...register.filter((r) => !osm.some((o) => metresBetween(o, r) < SAME_GYM_M)),
      ];
      remember(results);
      if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value!);
      searchCache.set(key, { at: Date.now(), data: results });
      return { success: true, data: results };
    }

    const { lat, lng } = parsed.data as { lat: number; lng: number };
    // Where gyms are imported (src/lib/gym-import.ts), answer from the database.
    const nearby = await importedGymsNear(lat, lng);
    if (nearby.length > 0) return { success: true, data: nearby };

    const query = `[out:json][timeout:25];nwr["leisure"~"^(fitness_centre|sports_centre)$"](around:${NEAR_ME_RADIUS_M},${roundCoordinate(lat)},${roundCoordinate(lng)});out center 30;`;
    // The public Overpass server is often at capacity: it answers 502/504 at
    // once, or takes 20-40 s. Retry a busy answer once, then point at name
    // search, which runs on Nominatim and stays fast.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { ...OSM_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const results = parseOverpass(await res.json());
        remember(results);
        return { success: true, data: results };
      }
      console.error("[searchGyms] overpass_busy", res.status);
      if (res.status !== 502 && res.status !== 504 && res.status !== 429) break;
    }
    return { success: false, error: NEAR_ME_BUSY };
  } catch (e) {
    console.error("[searchGyms] failed", e instanceof Error ? e.message : "unknown");
    return { success: false, error: key === null ? NEAR_ME_BUSY : "Gym search is unavailable right now" };
  }
}

/**
 * Set (opt in) or clear (opt out) the gym the user is listed under on the map.
 * Takes only the OpenStreetMap reference: a gym new to the app is looked up on
 * OpenStreetMap and stored as it is there, so no user can name or place a pin.
 */
export async function setPrimaryGym(data: unknown): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const parsed = setPrimaryGymSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid gym" };
  const { osmRef } = parsed.data;

  try {
    let gymId: number | null = null;
    if (osmRef) {
      const [known] = await db.select({ id: gyms.id }).from(gyms).where(eq(gyms.osmRef, osmRef));
      if (known) gymId = known.id;
      else {
        const recent = foundGyms.get(osmRef);
        let found = recent && Date.now() - recent.at < SEARCH_CACHE_MS ? recent.gym : undefined;
        if (!found && osmRef.startsWith("brreg/")) {
          const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/underenheter/${osmRef.slice(6)}`, {
            headers: REGISTER_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) [found] = await registerGyms(parseRegisterUnits(await res.json()));
        } else if (!found) {
          if (!(await nominatimSlot())) return { success: false, error: "Too many searches. Try again in a moment." };
          // "node/123" → "N123"
          const [type, id] = osmRef.split("/");
          found = (await nominatim("lookup", { osm_ids: `${type[0].toUpperCase()}${id}` })).find(
            (g) => g.osmRef === osmRef,
          );
        }
        if (!found) return { success: false, error: "That place isn't a gym we can find" };
        await db.insert(gyms).values(found).onConflictDoNothing({ target: gyms.osmRef });
        const [row] = await db.select({ id: gyms.id }).from(gyms).where(eq(gyms.osmRef, osmRef));
        gymId = row.id;
      }
    }
    await db.update(users).set({ primaryGymId: gymId }).where(eq(users.id, auth.user.id));
    revalidatePath("/more/gyms");
    revalidatePath("/more/account");
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[setPrimaryGym] failed", e instanceof Error ? e.message : "unknown");
    return { success: false, error: "Failed to save gym" };
  }
}

/** Every gym someone has picked, with how many users train there. */
export async function getGymMap(): Promise<ActionResult<GymPin[]>> {
  await requireSession();
  try {
    const rows = await db
      .select({
        id: gyms.id,
        name: gyms.name,
        lat: gyms.lat,
        lng: gyms.lng,
        address: gyms.address,
        memberCount: count(users.id),
      })
      .from(gyms)
      .innerJoin(users, eq(users.primaryGymId, gyms.id))
      .groupBy(gyms.id);
    return { success: true, data: rows };
  } catch (e) {
    console.error("[getGymMap] failed", e);
    return { success: false, error: "Failed to load the gym map" };
  }
}

/** Who has picked this gym: name, avatar and where they stand with me. */
export async function getGymMembers(data: unknown): Promise<ActionResult<GymMember[]>> {
  const auth = await requireSession();
  const me = auth.user.id;
  const parsed = gymMembersSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid gym" };

  try {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
        friendshipStatus: friendships.status,
        requesterId: friendships.requesterId,
      })
      .from(users)
      .leftJoin(
        friendships,
        or(
          and(eq(friendships.requesterId, me), eq(friendships.addresseeId, users.id)),
          and(eq(friendships.addresseeId, me), eq(friendships.requesterId, users.id)),
        ),
      )
      .where(eq(users.primaryGymId, parsed.data.gymId))
      .orderBy(users.name);

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        image: r.image,
        isMe: r.id === me,
        friendshipStatus:
          r.friendshipStatus === "accepted"
            ? "accepted"
            : r.friendshipStatus === "pending"
              ? r.requesterId === me
                ? "pending_sent"
                : "pending_received"
              : "none",
      })),
    };
  } catch (e) {
    console.error("[getGymMembers] failed", e);
    return { success: false, error: "Failed to load gym members" };
  }
}
