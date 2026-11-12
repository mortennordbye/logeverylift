// @vitest-environment jsdom
import { PendingQueueProvider, usePendingQueue, useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import { ToastProvider } from "@/contexts/toast-context";
import { BACKOFF_MS, MAX_ATTEMPTS } from "@/lib/utils/pending-queue";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The provider calls these Server Actions; the tests decide what they do.
const logWorkoutSet = vi.fn();
const unlogWorkoutSet = vi.fn();
vi.mock("@/lib/actions/workout-sets", () => ({
  logWorkoutSet: (...a: unknown[]) => logWorkoutSet(...a),
  unlogWorkoutSet: (...a: unknown[]) => unlogWorkoutSet(...a),
}));
vi.mock("@/lib/actions/workout-sessions", () => ({ completeWorkoutSession: vi.fn() }));
vi.mock("@/lib/actions/programs", () => ({ updateProgramSet: vi.fn() }));

// jsdom cannot reload, so the reload is faked; detection stays real.
// `reloadReturns` is what reloadForFreshBundle reports: true when it starts a
// reload, false when it holds off because the page itself was just reloaded.
const reloadForFreshBundle = vi.fn();
let reloadReturns = true;
let reloadPending = false;
vi.mock("@/lib/utils/stale-bundle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/stale-bundle")>()),
  reloadForFreshBundle: () => {
    reloadForFreshBundle();
    if (reloadReturns) reloadPending = true;
    return reloadReturns;
  },
  isReloadPending: () => reloadPending,
}));

// What the Next 16 client throws for an action ID the server doesn't know.
const staleError = () =>
  new UnrecognizedActionError(
    'Server Action "40c1d2e3f4" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
  );
const UPDATING = "Updating app. Your sets are saved on this phone.";

const payload = {
  sessionId: 1,
  exerciseId: 2,
  setNumber: 1,
  programSetId: 3,
  actualReps: 8,
  weightKg: 80,
  restTimeSeconds: 90,
};
const ok = { success: true, data: { set: {}, newPRs: [] } };
const stored = () => JSON.parse(localStorage.getItem("pendingMutationQueue") ?? "[]") as { attempts?: number }[];

function Harness({ onWriter }: { onWriter?: (w: ReturnType<typeof useWorkoutSetWriter>) => void }) {
  const writer = useWorkoutSetWriter();
  const { count } = usePendingQueue();
  onWriter?.(writer);
  return <p data-testid="count">{count}</p>;
}

function mount(onWriter?: (w: ReturnType<typeof useWorkoutSetWriter>) => void) {
  return render(
    <ToastProvider>
      <PendingQueueProvider>
        <Harness onWriter={onWriter} />
      </PendingQueueProvider>
    </ToastProvider>,
  );
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  logWorkoutSet.mockReset();
  unlogWorkoutSet.mockReset();
  reloadForFreshBundle.mockReset();
  reloadReturns = true;
  reloadPending = false;
});
afterEach(() => vi.useRealTimers());

describe("PendingQueueProvider", () => {
  it("replays a queue left in storage on a cold open, without waiting for an online event", async () => {
    localStorage.setItem(
      "pendingMutationQueue",
      JSON.stringify([{ id: "x", kind: "logWorkoutSet", payload, queuedAt: 0 }]),
    );
    logWorkoutSet.mockResolvedValue(ok);
    mount();
    await flush();
    await flush();
    expect(logWorkoutSet).toHaveBeenCalledWith(payload);
    expect(localStorage.getItem("pendingMutationQueue")).toBeNull();
  });

  it("backs a failing write off instead of spending its attempts at once, then saves it", async () => {
    localStorage.setItem(
      "pendingMutationQueue",
      JSON.stringify([{ id: "x", kind: "logWorkoutSet", payload, queuedAt: 0 }]),
    );
    logWorkoutSet.mockRejectedValue(new TypeError("Load failed"));
    mount();
    await flush();
    await flush();
    expect(logWorkoutSet).toHaveBeenCalledTimes(1);
    expect(stored()[0].attempts).toBe(1);

    // Nothing more until the first backoff step has passed.
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 100); });
    expect(logWorkoutSet).toHaveBeenCalledTimes(1);

    logWorkoutSet.mockResolvedValue(ok);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    expect(logWorkoutSet).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("pendingMutationQueue")).toBeNull();
  });
});

describe("useWorkoutSetWriter", () => {
  it("queues a write whose request fails, and resolves rather than throwing", async () => {
    let writer!: ReturnType<typeof useWorkoutSetWriter>;
    mount((w) => (writer = w));
    logWorkoutSet.mockRejectedValue(new TypeError("Load failed"));

    let result: unknown;
    await act(async () => { result = await writer.logWithRetry(payload); });
    expect(result).toMatchObject({ success: false });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("Retry replays the queued write rather than queueing it a second time", async () => {
    let writer!: ReturnType<typeof useWorkoutSetWriter>;
    mount((w) => (writer = w));
    logWorkoutSet.mockRejectedValue(new TypeError("Load failed"));
    await act(async () => { await writer.logWithRetry(payload); });
    await flush();
    const callsBefore = logWorkoutSet.mock.calls.length;

    // Still failing when the lifter taps Retry.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await flush();
    expect(screen.getByTestId("count").textContent).toBe("1");

    // And once the server is back, it is saved exactly once.
    logWorkoutSet.mockResolvedValue(ok);
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] + 1_000); });
    await flush();
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(logWorkoutSet.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe("after a deploy (stale bundle)", () => {
  it("queues a live write instead of losing it, says so, and reloads", async () => {
    let writer!: ReturnType<typeof useWorkoutSetWriter>;
    mount((w) => (writer = w));
    logWorkoutSet.mockRejectedValue(staleError());

    await act(async () => { await writer.logWithRetry(payload); });
    await flush();
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(stored()[0].attempts ?? 0).toBe(0);
    expect(screen.getByText(UPDATING)).toBeTruthy();
    expect(reloadForFreshBundle).toHaveBeenCalled();

    // While the reload is under way the old bundle sends nothing more.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(logWorkoutSet).toHaveBeenCalledTimes(1);
  });

  it("never spends attempts or drops queued sets, and saves them once the new bundle is in", async () => {
    localStorage.setItem(
      "pendingMutationQueue",
      JSON.stringify([
        { id: "a", kind: "logWorkoutSet", payload, queuedAt: 0 },
        { id: "b", kind: "logWorkoutSet", payload: { ...payload, setNumber: 2 }, queuedAt: 0 },
      ]),
    );
    // The page was just reloaded, so no second reload: the queue must wait
    // and retry on its own instead.
    reloadReturns = false;
    logWorkoutSet.mockRejectedValue(staleError());
    mount();
    await flush();
    await flush();

    // Far longer than the whole retry budget of an ordinary failure.
    for (let i = 0; i < MAX_ATTEMPTS * 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    }
    expect(logWorkoutSet.mock.calls.length).toBeGreaterThan(MAX_ATTEMPTS);
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(stored().map((m) => m.attempts ?? 0)).toEqual([0, 0]);
    expect(screen.queryByText(/dropped/)).toBeNull();

    // The new bundle: the same payloads now go through.
    logWorkoutSet.mockResolvedValue(ok);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(localStorage.getItem("pendingMutationQueue")).toBeNull();
  });

  it("does not replay a set twice that was saved before the stale error in the same pass", async () => {
    localStorage.setItem(
      "pendingMutationQueue",
      JSON.stringify([
        { id: "a", kind: "logWorkoutSet", payload, queuedAt: 0 },
        { id: "b", kind: "logWorkoutSet", payload: { ...payload, setNumber: 2 }, queuedAt: 0 },
      ]),
    );
    logWorkoutSet.mockResolvedValueOnce(ok).mockRejectedValue(staleError());
    mount();
    await flush();
    await flush();
    expect(stored().map((m) => (m as { id?: string }).id)).toEqual(["b"]);
    expect(reloadForFreshBundle).toHaveBeenCalled();
  });
});
