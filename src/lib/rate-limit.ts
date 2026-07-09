/**
 * Lightweight in-memory rate limiter (sliding window).
 *
 * Single-instance only — works because we run as one Next.js standalone
 * container behind the load balancer. If we ever scale horizontally, swap
 * the Map for Redis (interface stays the same).
 */

import type { NextRequest } from "next/server";

type Window = {
  windowMs: number;
  max: number;
  /** Optional friendly label for logging. */
  label?: string;
};

const buckets = new Map<string, number[]>();

export function clientIp(req: Request | NextRequest): string {
  const headers = req.headers;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return (
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/**
 * Returns `null` when allowed, or `{ retryAfterSeconds }` when blocked.
 * Mutates the bucket — call once per request.
 */
export function checkRateLimit(
  key: string,
  window: Window,
): { retryAfterSeconds: number } | null {
  const now = Date.now();
  const cutoff = now - window.windowMs;

  const existing = buckets.get(key);
  // Drop expired timestamps in-place.
  const recent = existing ? existing.filter((t) => t > cutoff) : [];

  if (recent.length >= window.max) {
    const oldest = recent[0];
    const retryMs = Math.max(0, oldest + window.windowMs - now);
    buckets.set(key, recent);
    return { retryAfterSeconds: Math.ceil(retryMs / 1000) };
  }

  recent.push(now);
  buckets.set(key, recent);

  // Opportunistic GC: every ~1024 calls, prune empty buckets.
  if (Math.random() < 1 / 1024) {
    for (const [k, v] of buckets) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) buckets.delete(k);
      else if (live.length < v.length) buckets.set(k, live);
    }
  }

  return null;
}

/** Convenience wrapper — returns a 429 Response if the bucket is full. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
