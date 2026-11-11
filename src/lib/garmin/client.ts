import { z } from "zod";

/**
 * Garmin Connect Personal API client. Read only.
 *
 * A Personal API key (made by the user at connect.garmin.com) is exchanged for
 * an access token that lasts 24 hours; there is no refresh token, so a new one
 * comes from the key each time. Data calls go to the same host with a Bearer
 * token. Endpoint paths match Garmin's own client,
 * github.com/garmin/connect-personal-api-python.
 */

const BASE = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const TIMEOUT_MS = 20_000;

/** A failed Garmin call, with a short tag that is safe to store and log. */
export class GarminError extends Error {
  /** For a 429: seconds Garmin says to wait (its "retryInSeconds"). */
  constructor(
    readonly tag: string,
    readonly retryInSeconds: number | null = null,
  ) {
    super(tag);
  }
}

export type GarminToken = { token: string; expiresAt: number };

/** Read `exp` from a JWT without checking its signature (Garmin checks it). */
function jwtExpiry(jwt: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function call(url: string, init: RequestInit, tag: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new GarminError(`network:${tag}`);
  }
  if (res.status === 401 || res.status === 403) throw new GarminError(tag === "token" ? "key_rejected" : `unauthorized:${tag}`);
  if (res.status === 429) {
    // Body seen: {"count":103,"limit":100,"retryInSeconds":27,...}
    const body = await res.json().catch(() => null);
    const retry = typeof body?.retryInSeconds === "number" ? body.retryInSeconds : null;
    throw new GarminError(`rate_limited:${tag}`, retry);
  }
  if (!res.ok) throw new GarminError(`http_${res.status}:${tag}`);
  return res;
}

/** Exchange a Personal API key for an access token. Throws "key_rejected" for a bad or expired key. */
export async function exchangeKey(apiKey: string): Promise<GarminToken> {
  const res = await call(`${BASE}${TOKEN_PATH}`, { method: "POST", headers: { Authorization: `ApiKey ${apiKey}` } }, "token");
  // The body is the bare JWT. Accept a JSON wrapper too, in case Garmin adds one.
  const body = (await res.text()).trim();
  let token = body;
  if (body.startsWith("{")) {
    const parsed = z.object({ access_token: z.string() }).safeParse(JSON.parse(body));
    if (!parsed.success) throw new GarminError("bad_token_response");
    token = parsed.data.access_token;
  }
  if (token.split(".").length !== 3) throw new GarminError("bad_token_response");
  return { token, expiresAt: jwtExpiry(token) ?? Date.now() + 23 * 3600_000 };
}

/** `empty` is what a 204 means: the HRV endpoint answers a range with no data that way. */
// Garmin allows 100 requests per key in a rolling window of about a minute
// (measured 2026-11-11: a 429 with {"count":103,"limit":100,"retryInSeconds":27}).
// Calls from this process are spaced at least garminPacing.gapMs apart, about
// 90 a minute, and a 429 pauses the user for Garmin's retryInSeconds.
// Tests set gapMs to 0.
export const garminPacing = { gapMs: 650 };
let nextSlot = 0;

async function pace() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + garminPacing.gapMs;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** GET a JSON endpoint. Null for Garmin's empty 204 answer. */
export async function garminGet(token: string, path: string, tag: string): Promise<unknown> {
  await pace();
  const res = await call(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, tag);
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    throw new GarminError(`bad_json:${tag}`);
  }
}

/** GET a file (the activity ZIP). */
export async function garminGetBytes(token: string, path: string, tag: string): Promise<Buffer> {
  await pace();
  const res = await call(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }, tag);
  return Buffer.from(await res.arrayBuffer());
}

const activityRecord = z
  .object({
    activityId: z.number(),
    startTimeLocal: z.string(),
    activityType: z.object({ typeKey: z.string() }).passthrough(),
  })
  .passthrough();

export type GarminActivityRecord = z.infer<typeof activityRecord>;

const ACTIVITY_PAGE = 100;

/** Every activity that started between start and end (YYYY-MM-DD, inclusive). */
export async function fetchActivityList(token: string, start: string, end: string): Promise<GarminActivityRecord[]> {
  const activities: GarminActivityRecord[] = [];
  for (let offset = 0; ; offset += ACTIVITY_PAGE) {
    const json = await garminGet(
      token,
      `/activitylist-service/activities/search/activities?start=${offset}&limit=${ACTIVITY_PAGE}&startDate=${start}&endDate=${end}`,
      "activities",
    );
    const page = z.array(activityRecord).safeParse(json ?? []);
    if (!page.success) throw new GarminError("bad_shape:activities");
    activities.push(...page.data);
    if (page.data.length < ACTIVITY_PAGE) break;
  }
  return activities;
}
