import { sendFinishFlush } from "@/lib/utils/finish-flush";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The online finish flush (docs/plans/revisions.md, 2.7). A flush whose
 * request never completes (a stale bundle after a deploy, a dropped
 * connection) must go into the offline queue, not be lost: it is the
 * lifter's next starting weights.
 */

const payload = { programId: 7, baseVersion: 2, sets: [{ id: 3, targetReps: 8, weightKg: 62.5 }] };
const enqueue = vi.fn();

beforeEach(() => {
  enqueue.mockReset();
});

describe("sendFinishFlush", () => {
  it("reports the conflicts of a flush that reached the server", async () => {
    const send = vi.fn().mockResolvedValue({ success: true, data: { applied: 0, conflicts: 1 } });
    expect(await sendFinishFlush(payload, send, enqueue)).toEqual({ conflicts: 1, queued: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  // callAction also starts the reload for a stale bundle (call-action.test.ts).
  it("queues the flush on a stale bundle", async () => {
    const send = vi.fn().mockRejectedValue(new UnrecognizedActionError('Server Action "x" was not found on the server.'));
    expect(await sendFinishFlush(payload, send, enqueue)).toEqual({ conflicts: 0, queued: true });
    expect(enqueue).toHaveBeenCalledWith(payload);
  });

  it("queues the flush when the request never completes", async () => {
    const send = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    expect(await sendFinishFlush(payload, send, enqueue)).toEqual({ conflicts: 0, queued: true });
    expect(enqueue).toHaveBeenCalledWith(payload);
  });

  it("does not queue a flush the server refused", async () => {
    const send = vi.fn().mockResolvedValue({ success: false, error: "Program not found" });
    expect(await sendFinishFlush(payload, send, enqueue)).toEqual({ conflicts: 0, queued: false });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
