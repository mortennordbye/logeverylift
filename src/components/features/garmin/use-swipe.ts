"use client";

import { useRef, useState } from "react";

/**
 * Horizontal swipe on a scrolling area. The content follows the finger with
 * resistance; past THRESHOLD px it calls onLeft or onRight. A swipe that
 * starts inside [data-no-swipe] (a chart, a map, a horizontal scroll row) is
 * ignored, so those keep their own drag. Vertical scrolling is never taken.
 */

const THRESHOLD = 70;
const DECIDE_AFTER = 8;

export function useSwipe({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);
  const [dx, setDx] = useState(0);

  const reset = () => {
    start.current = null;
    horizontal.current = null;
    setDx(0);
  };

  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-swipe]") || e.touches.length > 1) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      horizontal.current = null;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!start.current) return;
      const mx = e.touches[0].clientX - start.current.x;
      const my = e.touches[0].clientY - start.current.y;
      if (horizontal.current === null) {
        if (Math.abs(mx) < DECIDE_AFTER && Math.abs(my) < DECIDE_AFTER) return;
        horizontal.current = Math.abs(mx) > Math.abs(my) * 1.5;
      }
      if (!horizontal.current) return;
      // No neighbour that way: resist harder.
      const blocked = (mx < 0 && !onLeft) || (mx > 0 && !onRight);
      setDx(mx * (blocked ? 0.15 : 0.45));
    },
    onTouchEnd: () => {
      if (horizontal.current && Math.abs(dx) > THRESHOLD * 0.45) {
        if (dx < 0) onLeft?.();
        else onRight?.();
      }
      reset();
    },
    onTouchCancel: reset,
  };

  return {
    handlers,
    style: { transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform 200ms ease-out", touchAction: "pan-y" } as React.CSSProperties,
  };
}
