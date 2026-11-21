"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useKeyboardHeight } from "@/components/ui/use-keyboard-height";
import { createContext, useContext, useEffect, useRef } from "react";

const SheetCloseContext = createContext<(() => void) | undefined>(undefined);

/** The open sheet's close function, for a close button inside it; undefined outside a sheet. */
export const useSheetClose = () => useContext(SheetCloseContext);

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

/**
 * A closed sheet stays mounted while it animates out, and looks gone well before
 * that ends, so it lets go of the screen early or a tap on what is behind it does
 * nothing. Not at once: the second tap of a double tap on Done would land there.
 */
const RELEASE_TAPS_MS = 150;

export function BottomSheet({ open, onClose, children, blur = false }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const setPointerEvents = (value: string) => {
      for (const el of [backdropRef.current, panelRef.current]) {
        if (el) el.style.pointerEvents = value;
      }
    };
    if (open) {
      // Reopened mid-close, these are the same elements.
      setPointerEvents("");
      return;
    }
    const timer = setTimeout(() => setPointerEvents("none"), RELEASE_TAPS_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape closes the sheet, as a tap on the backdrop does.
  useEffect(() => {
    if (!open || !onClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The sheet lifts above the keyboard.
  const kbHeight = useKeyboardHeight(open);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            ref={backdropRef}
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
            ref={panelRef}
            className="fixed inset-x-0 bottom-0 z-50"
            style={{ marginBottom: kbHeight }}
            role="dialog"
            aria-modal="true"
          >
            <SheetCloseContext.Provider value={onClose}>{children}</SheetCloseContext.Provider>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
