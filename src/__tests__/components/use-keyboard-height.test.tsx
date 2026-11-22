// @vitest-environment jsdom
import { useKeyboardHeight } from "@/components/ui/use-keyboard-height";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The measurement log step focuses its field as the page opens (autoFocus),
 * before the hook's effect listens for focusin. On iOS the first keypad open
 * fires the visual viewport resize before the keypad is fully up, so the hook
 * read a short height and the step did not shrink: the keypad covered Next.
 */

let vvHeight = 800;
const vv = new EventTarget();
Object.defineProperty(vv, "height", { get: () => vvHeight });

function Probe() {
  return <output data-testid="kb">{useKeyboardHeight(true)}</output>;
}

describe("useKeyboardHeight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vvHeight = 800;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("reads the final height when the field was focused before the hook mounted", () => {
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();

    const { getByTestId } = render(<Probe />);

    // iOS: the resize fires during the keypad animation, with a height that is not final.
    act(() => {
      vvHeight = 700;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(getByTestId("kb").textContent).toBe("100");

    // The keypad finishes opening with no further resize event.
    vvHeight = 420;
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(getByTestId("kb").textContent).toBe("380");
  });
});
