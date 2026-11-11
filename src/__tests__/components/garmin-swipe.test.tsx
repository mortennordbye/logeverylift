// @vitest-environment jsdom
import { useSwipe } from "@/components/features/garmin/use-swipe";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function Swipeable({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const swipe = useSwipe({ onLeft, onRight });
  return (
    <main data-testid="area" {...swipe.handlers} style={swipe.style}>
      <p>content</p>
      <div data-no-swipe data-testid="chart">
        chart
      </div>
    </main>
  );
}

function drag(el: Element, dx: number, dy = 0) {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 300 }] });
  for (let step = 1; step <= 5; step++) {
    fireEvent.touchMove(el, { touches: [{ clientX: 200 + (dx * step) / 5, clientY: 300 + (dy * step) / 5 }] });
  }
  fireEvent.touchEnd(el);
}

describe("useSwipe", () => {
  it("calls onLeft for a swipe to the left and onRight for one to the right", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    render(<Swipeable onLeft={onLeft} onRight={onRight} />);
    drag(screen.getByText("content"), -200);
    expect(onLeft).toHaveBeenCalledTimes(1);
    drag(screen.getByText("content"), 200);
    expect(onRight).toHaveBeenCalledTimes(1);
  });

  it("ignores a short drag and a vertical scroll", () => {
    const onLeft = vi.fn();
    render(<Swipeable onLeft={onLeft} />);
    drag(screen.getByText("content"), -40);
    drag(screen.getByText("content"), -60, 300);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("leaves a swipe that starts on a chart to the chart", () => {
    const onLeft = vi.fn();
    render(<Swipeable onLeft={onLeft} />);
    drag(screen.getByTestId("chart"), -200);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("springs back when there is no tab that way", () => {
    const onLeft = vi.fn();
    render(<Swipeable onLeft={onLeft} />);
    const area = screen.getByTestId("area");
    drag(area, 200);
    expect(onLeft).not.toHaveBeenCalled();
    expect(area.style.transform).toBe("");
  });
});
