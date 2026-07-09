import { auth } from "@/lib/auth";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

const SIGN_IN_LIMIT = { windowMs: 15 * 60_000, max: 10 };
const SIGN_UP_LIMIT = { windowMs: 60 * 60_000, max: 5 };

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
    const blocked = checkRateLimit(`sign-up:${ip}`, SIGN_UP_LIMIT);
    if (blocked) {
      console.warn("[auth] rate_limited sign-up", { ip, retry: blocked.retryAfterSeconds });
      return tooManyRequests(blocked.retryAfterSeconds);
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
