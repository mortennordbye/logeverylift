/** GPS and place fields Garmin puts on an activity summary. The summary is stored without them; the FIT streams keep the route. */
const LOCATION_KEYS = new Set([
  "startLatitude",
  "startLongitude",
  "endLatitude",
  "endLongitude",
  "locationName",
  "geoPolylineDTO",
  "polyline",
]);

export function stripActivityLocation<T extends Record<string, unknown>>(activity: T): T {
  return Object.fromEntries(Object.entries(activity).filter(([k]) => !LOCATION_KEYS.has(k))) as T;
}
