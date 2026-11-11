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
  constructor(readonly tag: string) {
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
  if (res.status === 429) throw new GarminError(`rate_limited:${tag}`);
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

async function getJson<T>(token: string, path: string, schema: z.ZodType<T>, tag: string): Promise<T> {
  const res = await call(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, tag);
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new GarminError(`bad_shape:${tag}`);
  return parsed.data;
}

const record = z.record(z.string(), z.unknown());
const dayRecord = record.and(z.object({ calendarDate: z.string().nullable().optional() }));
const activityRecord = record.and(
  z.object({
    activityId: z.number(),
    startTimeLocal: z.string(),
    activityType: z.object({ typeKey: z.string() }).passthrough(),
  }),
);

export type GarminDayRecord = z.infer<typeof dayRecord>;
export type GarminActivityRecord = z.infer<typeof activityRecord>;

export type GarminRange = {
  hrv: GarminDayRecord[];
  sleep: GarminDayRecord[];
  daily: GarminDayRecord[];
  activities: GarminActivityRecord[];
};

const ACTIVITY_PAGE = 100;

/** Everything the Garmin tab uses for start..end (YYYY-MM-DD, inclusive). */
export async function fetchGarminRange(token: string, start: string, end: string): Promise<GarminRange> {
  const [hrv, sleep, daily] = await Promise.all([
    getJson(token, `/hrv-service/hrv/daily/${start}/${end}`, z.object({ hrvSummaries: z.array(dayRecord) }), "hrv"),
    getJson(
      token,
      `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${start}&endDate=${end}`,
      z.array(dayRecord),
      "sleep",
    ),
    getJson(token, `/usersummary-service/v2/dailysummaries?startDate=${start}&endDate=${end}`, z.object({ data: z.array(dayRecord) }), "daily"),
  ]);

  const activities: GarminActivityRecord[] = [];
  for (let offset = 0; ; offset += ACTIVITY_PAGE) {
    const page = await getJson(
      token,
      `/activitylist-service/activities/search/activities?start=${offset}&limit=${ACTIVITY_PAGE}&startDate=${start}&endDate=${end}`,
      z.array(activityRecord),
      "activities",
    );
    activities.push(...page);
    if (page.length < ACTIVITY_PAGE) break;
  }

  return { hrv: hrv.hrvSummaries, sleep, daily: daily.data, activities };
}
