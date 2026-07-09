/**
 * Best-effort in-memory rate limiter for MCP requests, keyed by userId.
 *
 * This is a failsafe against a runaway client (e.g. an LLM stuck in a loop)
 * hammering the tools. It is process-local, which is correct for a single app
 * instance. If the app is ever scaled to multiple instances, move this to a
 * shared store (Redis) — see BACKLOG.md.
 */

const WINDOW_MS = 60_000;
// Generous for legitimate bursty AI use (~2/sec sustained); a runaway loop
// would blow far past this.
const MAX_PER_WINDOW = 120;

const hits = new Map<string, number[]>();
let lastSweep = 0;

/** Drop entries whose timestamps have all aged out, so the map can't grow
 * without bound as distinct users come and go. */
function sweep(now: number) {
  for (const [key, arr] of hits) {
    const live = arr.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
  lastSweep = now;
}

/**
 * Records a request for `userId` and returns false if it exceeds the per-minute
 * budget. Timestamps outside the window are pruned on each call.
 */
export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  if (now - lastSweep > WINDOW_MS) sweep(now);

  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return false;
  }

  recent.push(now);
  hits.set(userId, recent);
  return true;
}
