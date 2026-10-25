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

const gymSchema = z.object({
  osmRef: z.string().regex(/^(node|way|relation)\/\d+$/),
  name: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(300).nullable(),
});

const setPrimaryGymSchema = z.object({ gym: gymSchema.nullable() });

const gymMembersSchema = z.object({ gymId: z.number().int().positive() });

export type GymPin = { id: number; name: string; lat: number; lng: number; address: string | null; memberCount: number };
export type GymMember = Pick<UserSearchResult, "id" | "name" | "image" | "friendshipStatus"> & { isMe: boolean };

/**
 * Find gyms on OpenStreetMap by name (Nominatim) or near a point (Overpass).
 * The request goes from the server, so OSM never sees the user's IP, and a
 * point is rounded to about a kilometre first. Nothing here is stored.
 */
export async function searchGyms(data: unknown): Promise<ActionResult<GymResult[]>> {
  const auth = await requireSession();
  const parsed = searchGymsSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid search" };

  // Per user, and Nominatim's limit of one request a second for the whole app.
  if (
    checkRateLimit(`gyms:${auth.user.id}`, { windowMs: 60_000, max: 10 }) ||
    checkRateLimit("gyms:osm", { windowMs: 1_000, max: 1 })
  ) {
    return { success: false, error: "Too many searches. Try again in a moment." };
  }

  try {
    if ("query" in parsed.data) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.search = new URLSearchParams({ format: "jsonv2", q: parsed.data.query, limit: "20" }).toString();
      const res = await fetch(url, { headers: OSM_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      return { success: true, data: parseNominatim(await res.json()) };
    }

    const lat = roundCoordinate(parsed.data.lat);
    const lng = roundCoordinate(parsed.data.lng);
    const query = `[out:json][timeout:10];nwr["leisure"="fitness_centre"](around:${NEAR_ME_RADIUS_M},${lat},${lng});out center 30;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { ...OSM_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    return { success: true, data: parseOverpass(await res.json()) };
  } catch (e) {
    console.error("[searchGyms] failed", e instanceof Error ? e.message : "unknown");
    return { success: false, error: "Gym search is unavailable right now" };
  }
}

/** Set (opt in) or clear (opt out) the gym the user is listed under on the map. */
export async function setPrimaryGym(data: unknown): Promise<ActionResult<void>> {
  const auth = await requireSession();
  const parsed = setPrimaryGymSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid gym" };

  try {
    let gymId: number | null = null;
    if (parsed.data.gym) {
      const { osmRef, name, lat, lng, address } = parsed.data.gym;
      const [row] = await db
        .insert(gyms)
        .values({ osmRef, name, lat, lng, address })
        .onConflictDoUpdate({ target: gyms.osmRef, set: { name, lat, lng, address } })
        .returning({ id: gyms.id });
      gymId = row.id;
    }
    await db.update(users).set({ primaryGymId: gymId }).where(eq(users.id, auth.user.id));
    revalidatePath("/more/gyms");
    revalidatePath("/more/account");
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[setPrimaryGym] failed", e);
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
