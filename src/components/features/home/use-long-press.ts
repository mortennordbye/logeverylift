"use client";

import { useEffect, useRef } from "react";

/**
 * Long-press on a home widget enters edit mode, as on the iPhone home screen
 * (owner decision, 2026-11-13). The press counts only on an element inside
 * `[data-widget]`, only after `ms` without moving more than `tolerance` px,
 * and never while the page scrolls. A tap stays a tap: links and buttons in a
 * widget work as before. After a long-press the click that the release would
 * send is swallowed, so it does not follow a link or open anything.
 *
 * Home only: the workout pages' drag and drop never sees these handlers.
 */
export function useLongPress(onLongPress: () => void, { ms = 500, tolerance = 8 } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => {
    callback.current = onLongPress;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    onPointerDown(e: React.PointerEvent) {
      if (e.button > 0 || !(e.target as Element).closest("[data-widget]")) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        callback.current();
      }, ms);
    },
    onPointerMove(e: React.PointerEvent) {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > tolerance) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onScroll: cancel,
    onClickCapture(e: React.MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu(e: React.MouseEvent) {
      // Android and desktop show a menu on a long press; the press is ours here.
      if (start.current || fired.current) e.preventDefault();
    },
  };
}
