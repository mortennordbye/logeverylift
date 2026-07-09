"use client";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useRef } from "react";

type Direction = "forward" | "back" | "none";

function getDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function getDirection(from: string, to: string): Direction {
  if (from === to) return "none";
  const d1 = getDepth(from);
  const d2 = getDepth(to);
  // Both at tab level (depth 0 or 1) → instant switch, no animation
  if (d1 <= 1 && d2 <= 1) return "none";
  if (d2 > d1) return "forward";
  if (d2 < d1) return "back";
  return "none";
}

const SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  const dirRef = useRef<Direction>("none");
  const nodeRef = useRef<HTMLDivElement>(null);

  // Compute direction synchronously during render so the animation is
  // correct when the motion.div mounts with the new key. Using refs (not
  // state) here is intentional — state would force an extra render before
  // the new direction can be picked up.
  /* eslint-disable react-hooks/refs */
  if (prevPathRef.current !== pathname) {
    dirRef.current = getDirection(prevPathRef.current, pathname);
    prevPathRef.current = pathname;
  }

  const dir = dirRef.current;
  /* eslint-enable react-hooks/refs */

  return (
    // overflow-hidden clips the incoming page while it slides into view
    <div className="overflow-hidden">
      <motion.div
        ref={nodeRef}
        key={pathname}
        // initial={false} → render immediately at final position (no animation)
        // for tab switches; for push/pop use the off-screen position.
        initial={
          dir === "forward" ? { x: "100%" } :
          dir === "back"    ? { x: "-100%" } :
          false
        }
        animate={{ x: 0 }}
        transition={
          dir === "none"
            ? { duration: 0 }
            : { duration: 0.3, ease: SPRING }
        }
        onAnimationComplete={() => {
          // After the slide-in finishes, remove the inline transform so that
          // position:fixed children (bottom sheets) use the viewport as their
          // containing block again instead of this transformed element.
          if (nodeRef.current) {
            nodeRef.current.style.transform = "";
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
