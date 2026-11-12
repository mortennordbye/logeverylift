/**
 * The offline write queue's retry rules, kept apart from the provider
 * (src/contexts/pending-queue-context.tsx) so they can be tested without a
 * browser. The queue is what stops a set logged in a gym basement from being
 * lost, so these rules decide whether a user's sets survive a bad connection.
 */

export type Retryable = { id: string; attempts?: number; nextAttemptAt?: number };

// Wait this long before retrying an item, indexed by attempts already made.
// Without a delay the attempts are spent in a fraction of a second: a failed
// replay bumps `attempts`, which used to re-trigger the replay, which failed
// again — so a server blip lasting seconds (pods restarting mid-deploy)
// drained the whole budget and dropped the user's sets while the device was
// still online. Spread this way the budget lasts ~17 minutes, which outlives a
// rolling deploy.
export const BACKOFF_MS = [5_000, 30_000, 120_000, 300_000, 600_000];

// Drop a queued mutation after this many failed replays. Permanent failures
// (validation errors, unique violations the server can't recover from) would
// otherwise loop on every `online` event forever. One more than the backoff
// steps, so every step is waited out: at 5 the drop came on the failure that
// should have started the last 10-minute wait, and the budget was ~7.5 minutes.
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

/** Items whose backoff has elapsed, in queue order. */
export function dueItems<T extends Retryable>(queue: T[], now: number): T[] {
  return queue.filter((m) => (m.nextAttemptAt ?? 0) <= now);
}

/**
 * What a failed replay does to an item: back it off, or drop it once it has
 * used its attempts.
 */
export function afterFailedReplay<T extends Retryable>(
  item: T,
  now: number,
): { dropped: true } | { dropped: false; item: T } {
  const attempts = (item.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) return { dropped: true };
  const delay = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return { dropped: false, item: { ...item, attempts, nextAttemptAt: now + delay } };
}

// How long a write that hit a stale bundle waits before it is sent again,
// when the page can't reload yet (src/lib/utils/stale-bundle.ts).
export const STALE_BUNDLE_RETRY_MS = 30_000;

/**
 * What a stale-bundle failure does to an item: wait, but spend no attempt.
 * The write itself is fine and goes through once the new bundle has loaded, so
 * it must never count towards MAX_ATTEMPTS. Counting it is what dropped sets
 * after a deploy.
 */
export function afterStaleBundle<T extends Retryable>(item: T, now: number): T {
  return { ...item, nextAttemptAt: now + STALE_BUNDLE_RETRY_MS };
}

/**
 * The queue after a replay pass: replayed items leave unless they were kept
 * (failed, backed off), and anything enqueued while the pass ran stays where
 * it is.
 */
export function mergeReplayed<T extends Retryable>(current: T[], replayed: T[], kept: T[]): T[] {
  const keptById = new Map(kept.map((m) => [m.id, m]));
  const replayedIds = new Set(replayed.map((m) => m.id));
  return current.flatMap((m) => {
    if (!replayedIds.has(m.id)) return [m];
    const updated = keptById.get(m.id);
    return updated ? [updated] : [];
  });
}

/**
 * What a replayed write's result means for its queue item. A conflict is
 * final: the plan changed since the write was based on it, the server kept
 * the newer plan and recorded the change in the history, so sending it again
 * can never succeed and must not count towards a drop. Only plan writes from
 * the finish flush can conflict; logged sets never do
 * (docs/plans/revisions.md, 2.7).
 */
export function replayOutcome(result: { success: boolean; conflict?: unknown }): "done" | "conflict" | "retry" {
  if (result.success) return "done";
  if (!result.success && result.conflict) return "conflict";
  return "retry";
}

/** "now" if something is due, else ms until the soonest item is, else null. */
export function nextReplayIn(queue: Retryable[], now: number): "now" | number | null {
  if (queue.length === 0) return null;
  if (dueItems(queue, now).length > 0) return "now";
  return Math.min(...queue.map((m) => m.nextAttemptAt ?? 0)) - now;
}
