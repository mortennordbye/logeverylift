"use client";

import { useEffect, useState } from "react";

/**
 * The height of the on-screen keyboard while `active`, 0 when it is closed.
 * With interactiveWidget="resizes-visual" the visual viewport shrinks when
 * the keyboard appears, so window.innerHeight - vv.height = keyboard height.
 *
 * On the first keyboard open iOS can fire vv.resize before the keyboard is
 * fully up, and then no more. So every resize and every field focus also
 * reads the height again after 300 ms (longer than the keyboard animation).
 * A field that already has the focus when this starts (autoFocus, which runs
 * before effects) counts as a focus.
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

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    function settle() {
      sync();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(sync, 300);
    }

    const isField = (el: Element | null) => el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
    function onFocusIn(e: FocusEvent) {
      if (isField(e.target as Element)) settle();
    }

    if (isField(document.activeElement)) settle();
    else sync(); // the keyboard may already be open
    vv.addEventListener("resize", settle);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      vv.removeEventListener("resize", settle);
      document.removeEventListener("focusin", onFocusIn);
      if (settleTimer) clearTimeout(settleTimer);
      setKbHeight(0);
    };
  }, [active]);

  return kbHeight;
}
