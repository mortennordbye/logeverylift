import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";
import { and, count, gt, isNull } from "drizzle-orm";

const handlers = toNextJsHandler(auth);

const SIGN_IN_LIMIT = { windowMs: 15 * 60_000, max: 10 };
const SIGN_UP_LIMIT = { windowMs: 60 * 60_000, max: 5 };
const SIGN_UP_DAILY_LIMIT = { windowMs: 24 * 60 * 60_000, max: 10 };
// Site-wide cap on open signups. Counted in the database so it survives
// restarts and can't be dodged by rotating IPs. Invite and admin-created
// accounts carry invited_by_id, so they don't use it up.
const OPEN_SIGN_UPS_PER_HOUR = 20;

async function openSignUpsLastHour(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(isNull(users.invitedById), gt(users.createdAt, new Date(Date.now() - 60 * 60_000))));
  return row?.n ?? 0;
}

export const GET = handlers.GET;

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // better-auth paths: /api/auth/sign-in/email, /api/auth/sign-up/email,
  // /api/auth/sign-out, /api/auth/forget-password, etc. Only gate the ones
  // that accept credentials.
  const path = url.pathname;
  const ip = clientIp(req);

  if (path.includes("/sign-in")) {
    const blocked = checkRateLimit(`sign-in:${ip}`, SIGN_IN_LIMIT);
    if (blocked) {
      console.warn("[auth] rate_limited sign-in", { ip, retry: blocked.retryAfterSeconds });
      return tooManyRequests(blocked.retryAfterSeconds);
    }
  } else if (path.includes("/sign-up")) {
    const blocked =
      checkRateLimit(`sign-up:${ip}`, SIGN_UP_LIMIT) ??
      checkRateLimit(`sign-up-day:${ip}`, SIGN_UP_DAILY_LIMIT);
    if (blocked) {
      console.warn("[auth] rate_limited sign-up", { ip, retry: blocked.retryAfterSeconds });
      return tooManyRequests(blocked.retryAfterSeconds);
    }
    if ((await openSignUpsLastHour()) >= OPEN_SIGN_UPS_PER_HOUR) {
      console.warn("[auth] rate_limited sign-up sitewide", { ip });
      return tooManyRequests(15 * 60);
    }
  } else if (path.includes("/forget-password") || path.includes("/reset-password")) {
    const blocked = checkRateLimit(`pw-reset:${ip}`, SIGN_UP_LIMIT);
    if (blocked) {
      console.warn("[auth] rate_limited pw-reset", { ip, retry: blocked.retryAfterSeconds });
      return tooManyRequests(blocked.retryAfterSeconds);
    }
  }

  return handlers.POST(req);
}
