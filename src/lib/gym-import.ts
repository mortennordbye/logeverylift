import { db } from "@/db";
import { gyms, users } from "@/db/schema";
import { OSM_HEADERS, parseOverpass } from "@/lib/utils/osm-gyms";
import { and, isNotNull, lt, max, notExists, sql } from "drizzle-orm";

const IMPORT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Copy every named gym in these countries (ISO 3166-1 codes) from OpenStreetMap
 * into the gyms table, so "Gyms near me" is a local query instead of a wait on
 * the public Overpass server. No user data is sent: it's one query per run, for
 * the whole country. Gyms OpenStreetMap no longer has are dropped, unless
 * someone picked one. Returns how many gyms were imported.
 */
export async function importGyms(countries: string[]): Promise<number> {
  const startedAt = new Date();
  const areas = countries.map((c) => `area["ISO3166-1"="${c}"][admin_level=2];`).join("");
  const query = `[out:json][timeout:600];(${areas})->.a;nwr["leisure"~"^(fitness_centre|sports_centre)$"](area.a);out center tags;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { ...OSM_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(660_000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = await res.json();
  // A query that runs out of time or memory still answers 200, with a remark
  // and some or none of the elements. Pruning on that would empty the table.
  if (typeof json?.remark === "string" && json.remark.includes("error")) throw new Error("overpass incomplete");
  const found = [...new Map(parseOverpass(json).map((g) => [g.osmRef, g])).values()];

  await db.transaction(async (tx) => {
    for (let i = 0; i < found.length; i += 500) {
      await tx
        .insert(gyms)
        .values(found.slice(i, i + 500).map((g) => ({ ...g, importedAt: startedAt })))
        .onConflictDoUpdate({
          target: gyms.osmRef,
          set: {
            name: sql`excluded.name`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            address: sql`excluded.address`,
            importedAt: startedAt,
          },
        });
    }
    await tx
      .delete(gyms)
      .where(
        and(
          lt(gyms.importedAt, startedAt),
          notExists(tx.select({ id: users.id }).from(users).where(sql`${users.primaryGymId} = ${gyms.id}`)),
        ),
      );
  });
  return found.length;
}

/** Import again when the last import is a week old, or there has been none. */
export async function importGymsIfStale(countries: string[]): Promise<void> {
  const [row] = await db.select({ last: max(gyms.importedAt) }).from(gyms).where(isNotNull(gyms.importedAt));
  if (row?.last && Date.now() - row.last.getTime() < IMPORT_EVERY_MS) return;
  const count = await importGyms(countries);
  console.log("[importGyms] done", { count });
}
