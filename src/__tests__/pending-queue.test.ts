import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  STALE_BUNDLE_RETRY_MS,
  afterFailedReplay,
  afterStaleBundle,
  dueItems,
  mergeReplayed,
  nextReplayIn,
  type Retryable,
} from "@/lib/utils/pending-queue";
import { describe, expect, it } from "vitest";

const item = (id: string, extra: Partial<Retryable> = {}): Retryable => ({ id, ...extra });

describe("offline queue retry rules", () => {
  it("a fresh item is due at once; a backed-off one when its time comes", () => {
    const queue = [item("a"), item("b", { nextAttemptAt: 1_000 })];
    expect(dueItems(queue, 999).map((m) => m.id)).toEqual(["a"]);
    expect(dueItems(queue, 1_000).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("keeps failing items through the whole schedule before dropping them", () => {
    // A server blip during a rolling deploy must not cost the lifter their
    // sets: every step of the backoff is waited out first.
    let current: Retryable = item("a");
    let now = 0;
    const waits: number[] = [];
    for (;;) {
      const next = afterFailedReplay(current, now);
      if (next.dropped) break;
      waits.push(next.item.nextAttemptAt! - now);
      now = next.item.nextAttemptAt!;
      current = next.item;
    }
    expect(waits).toEqual(BACKOFF_MS);
    expect(current.attempts).toBe(MAX_ATTEMPTS - 1);
    // ~17 minutes of retrying before giving up.
    expect(now).toBe(BACKOFF_MS.reduce((a, b) => a + b, 0));
    expect(now).toBeGreaterThan(15 * 60_000);
  });

  it("after a pass: succeeded items leave, failed ones stay backed off, new ones are untouched", () => {
    const replayed = [item("ok"), item("fail")];
    const kept = [item("fail", { attempts: 1, nextAttemptAt: 5_000 })];
    const current = [item("ok"), item("fail"), item("new")];
    expect(mergeReplayed(current, replayed, kept)).toEqual([
      item("fail", { attempts: 1, nextAttemptAt: 5_000 }),
      item("new"),
    ]);
  });

  it("an item that was dropped during the pass leaves the queue", () => {
    expect(mergeReplayed([item("gone"), item("new")], [item("gone")], [])).toEqual([item("new")]);
  });

  it("wakes for the soonest backed-off item, or at once when one is due", () => {
    expect(nextReplayIn([], 0)).toBeNull();
    expect(nextReplayIn([item("a")], 0)).toBe("now");
    expect(nextReplayIn([item("a", { nextAttemptAt: 30_000 }), item("b", { nextAttemptAt: 5_000 })], 1_000)).toBe(4_000);
  });

  it("a stale bundle costs no attempt and never drops the item, however often it happens", () => {
    // After a deploy the old bundle's action IDs are unknown to the server.
    // That is not the write's fault, and the write succeeds once the new
    // bundle loads, so it must survive any number of these.
    let current: Retryable = item("a", { attempts: 2 });
    for (let i = 0; i < MAX_ATTEMPTS * 3; i++) current = afterStaleBundle(current, i * 1_000);
    expect(current.attempts).toBe(2);
    const last = (MAX_ATTEMPTS * 3 - 1) * 1_000;
    expect(current.nextAttemptAt).toBe(last + STALE_BUNDLE_RETRY_MS);
  });
});
