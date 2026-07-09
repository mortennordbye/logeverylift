"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  blur?: boolean;
};

const SHEET_TRANSITION = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
};

export function BottomSheet({ open, onClose, children, blur = false }: Props) {
  const [kbHeight, setKbHeight] = useState(0);

  // Track keyboard height so the sheet lifts above the keyboard.
  // With interactiveWidget="resizes-visual" the visual viewport shrinks when
  // the keyboard appears, so window.innerHeight - vv.height = keyboard height.
  //
  // Two-path detection handles a first-open timing quirk on iOS:
  // 1. vv.resize  — fires during the keyboard animation; works reliably after
  //    the first keyboard interaction in a session.
  // 2. focusin + 300 ms fallback — on the very first keyboard open iOS may fire
  //    vv.resize before the keyboard is fully shown (height not yet final).
  //    Re-reading after 300 ms (≥ keyboard animation duration) guarantees the
  //    correct value regardless of vv.resize timing.
  useEffect(() => {
    if (!open) return;

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
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`fixed inset-0 z-50 ${
              blur ? "bg-background/80 backdrop-blur-sm" : "bg-black/50"
            }`}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SHEET_TRANSITION}
            className="fixed inset-x-0 bottom-0 z-50"
            style={{ marginBottom: kbHeight }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
