"use client";

import { haptics } from "@/lib/utils/haptics";
import { motion } from "framer-motion";
import Link from "next/link";

const SPRING = { type: "spring", stiffness: 400, damping: 20 } as const;

type Props = {
  programId: number;
  completedToday: boolean;
};

export function DashboardActionButtons({ programId, completedToday }: Props) {
  return (
    <div className="flex gap-2 flex-wrap">
      {completedToday ? (
        <motion.div whileTap={{ scale: 0.97 }} transition={SPRING}>
          <Link
            href={`/programs/${programId}/workout`}
            prefetch={true}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
          >
            Do Again
          </Link>
        </motion.div>
      ) : (
        <motion.div whileTap={{ scale: 0.97 }} transition={SPRING}>
          <Link
            href={`/programs/${programId}/workout`}
            prefetch={true}
            onClick={haptics.tap}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground ring-2 ring-primary/40 shadow-[0_0_16px_rgba(0,122,255,0.4)] active:opacity-80"
          >
            Start Today&apos;s Workout
          </Link>
        </motion.div>
      )}
      <motion.div whileTap={{ scale: 0.97 }} transition={SPRING}>
        <Link
          href="/new-workout"
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
        >
          Different Program
        </Link>
      </motion.div>
    </div>
  );
}
