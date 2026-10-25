"use server";

import { db } from "@/db";
import { friendships, gyms, users } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseNominatim, parseOverpass, roundCoordinate, type GymResult } from "@/lib/utils/osm-gyms";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult, UserSearchResult } from "@/types/workout";
import { and, count, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// Nominatim and Overpass ask for an identifying User-Agent.
const OSM_HEADERS = { "User-Agent": "LogEveryLift (+https://logeverylift.com)", Accept: "application/json" };
const NEAR_ME_RADIUS_M = 3000;

const searchGymsSchema = z.union([
  z.object({ query: z.string().trim().min(2).max(100) }),
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
]);

const setPrimaryGymSchema = z.object({ osmRef: z.string().regex(/^(node|way|relation)\/\d+$/).nullable() });

const gymMembersSchema = z.object({ gymId: z.number().int().positive() });

export type GymPin = { id: number; name: string; lat: number; lng: number; address: string | null; memberCount: number };
export type GymMember = Pick<UserSearchResult, "id" | "name" | "image" | "friendshipStatus"> & { isMe: boolean };

// Nominatim allows one request a second from the whole app and asks for
// repeated queries to be cached. Overpass has no such limit.
const NOMINATIM_LIMIT = { windowMs: 1_000, max: 1 };
const SEARCH_CACHE_MS = 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const searchCache = new Map<string, { at: number; data: GymResult[] }>();
// Every gym a search returned, by osmRef: these came from OpenStreetMap through
// this server, so picking one needs no second lookup.
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

/**
 * Find gyms on OpenStreetMap by name (Nominatim) or near a point (Overpass).
 * The request goes from the server, so OSM never sees the user's IP, and a
 * point is rounded to about a kilometre first. Nothing here is stored.
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
      const results = await nominatim("search", { q: key, limit: "20" });
      remember(results);
      if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value!);
      searchCache.set(key, { at: Date.now(), data: results });
      return { success: true, data: results };
    }

    const { lat, lng } = parsed.data as { lat: number; lng: number };
    const query = `[out:json][timeout:10];nwr["leisure"~"^(fitness_centre|sports_centre)$"](around:${NEAR_ME_RADIUS_M},${roundCoordinate(lat)},${roundCoordinate(lng)});out center 30;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { ...OSM_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const results = parseOverpass(await res.json());
    remember(results);
    return { success: true, data: results };
  } catch (e) {
    console.error("[searchGyms] failed", e instanceof Error ? e.message : "unknown");
    return { success: false, error: "Gym search is unavailable right now" };
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
        if (!found) {
          if (!(await nominatimSlot())) return { success: false, error: "Too many searches. Try again in a moment." };
          // "node/123" → "N123"
          const [type, id] = osmRef.split("/");
          found = (await nominatim("lookup", { osm_ids: `${type[0].toUpperCase()}${id}` })).find(
            (g) => g.osmRef === osmRef,
          );
        }
        if (!found) return { success: false, error: "That place isn't a gym on OpenStreetMap" };
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
