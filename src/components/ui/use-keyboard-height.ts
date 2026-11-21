"use client";

import { useEffect, useState } from "react";

/**
 * The height of the on-screen keyboard while `active`, 0 when it is closed.
 * With interactiveWidget="resizes-visual" the visual viewport shrinks when
 * the keyboard appears, so window.innerHeight - vv.height = keyboard height.
 *
 * Two-path detection handles a first-open timing quirk on iOS:
 * 1. vv.resize  — fires during the keyboard animation; works reliably after
 *    the first keyboard interaction in a session.
 * 2. focusin + 300 ms fallback — on the very first keyboard open iOS may fire
 *    vv.resize before the keyboard is fully shown (height not yet final).
 *    Re-reading after 300 ms (≥ keyboard animation duration) guarantees the
 *    correct value regardless of vv.resize timing.
 */
export function useKeyboardHeight(active: boolean): number {
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    if (!active) return;

    const vv = window.visualViewport;
    if (!vv) return;

    function sync() {
      setKbHeight(Math.max(0, window.innerHeight - vv!.height));
    }

    sync(); // read immediately (keyboard may already be open)
    vv.addEventListener("resize", sync);

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") return;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(sync, 300);
    }

    document.addEventListener("focusin", onFocusIn);

    return () => {
      vv.removeEventListener("resize", sync);
      document.removeEventListener("focusin", onFocusIn);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      setKbHeight(0);
    };
  }, [active]);

  return kbHeight;
}
