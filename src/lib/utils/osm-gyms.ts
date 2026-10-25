/**
 * Turn OpenStreetMap search results into gyms. The fetching lives in
 * src/lib/actions/gyms.ts; these only read the responses, so they can be
 * tested on recorded ones.
 */

export type GymResult = {
  osmRef: string; // "node/123", "way/456", "relation/789"
  name: string;
  lat: number;
  lng: number;
  address: string | null;
};

const GYM_TYPES = new Set(["fitness_centre", "sports_centre"]);

/** Nominatim `format=jsonv2` search results, gyms only. */
export function parseNominatim(json: unknown): GymResult[] {
  if (!Array.isArray(json)) return [];
  const gyms: GymResult[] = [];
  for (const r of json) {
    if (r?.category !== "leisure" || !GYM_TYPES.has(r?.type) || !r?.name) continue;
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // display_name starts with the name; the next few parts are the address.
    const parts = String(r.display_name ?? "").split(", ").slice(1, 4);
    gyms.push({
      osmRef: `${r.osm_type}/${r.osm_id}`,
      name: String(r.name),
      lat,
      lng,
      address: parts.length > 0 ? parts.join(", ") : null,
    });
  }
  return gyms;
}

/** Overpass `out center` elements, named ones only. */
export function parseOverpass(json: unknown): GymResult[] {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const gyms: GymResult[] = [];
  type Element = {
    type?: string;
    id?: number;
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  };
  for (const el of elements as Element[]) {
    const tags = el?.tags ?? {};
    if (!tags.name) continue;
    const lat = Number(el.lat ?? el.center?.lat);
    const lng = Number(el.lon ?? el.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    const address = [street, tags["addr:city"]].filter(Boolean).join(", ");
    gyms.push({ osmRef: `${el.type}/${el.id}`, name: String(tags.name), lat, lng, address: address || null });
  }
  return gyms;
}

/**
 * Two decimals is about a kilometre: enough to list gyms nearby, and all the
 * map services ever learn about where the user is.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}
