// @vitest-environment jsdom
import { ReadinessSheet } from "@/components/features/ReadinessSheet";
import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Let `ms` pass in small steps, each in its own act(): React applies state
 * updates when an act() ends, so the effect that schedules the next tick only
 * runs between steps, the way it does between real frames.
 */
async function advance(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(50, ms - t));
    });
  }
}

/**
 * The workout screen re-renders every second for its clock and hands the
 * sheet a fresh onConfirm each time. That used to restart the countdown's
 * tick on every render, so the auto-skip could stall indefinitely.
 */
function TickingParent({ onConfirm, tickMs }: { onConfirm: (n: number) => void; tickMs: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return <ReadinessSheet onConfirm={(level) => onConfirm(level)} />;
}

describe("ReadinessSheet", () => {
  it.each([1000, 500, 999])("auto-skips with a neutral 3 while the parent re-renders every %ims", async (tickMs) => {
    const onConfirm = vi.fn();
    render(<TickingParent onConfirm={onConfirm} tickMs={tickMs} />);
    await advance(300 + 4_000 + 100);
    expect(onConfirm).toHaveBeenCalledWith(3);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("counts down visibly", async () => {
    render(<ReadinessSheet onConfirm={() => {}} />);
    await advance(300);
    expect(screen.getByText(/Auto-skipping in 4s/)).toBeTruthy();
    await advance(2_000);
    expect(screen.getByText(/Auto-skipping in 2s/)).toBeTruthy();
  });
});
