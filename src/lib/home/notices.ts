/**
 * Home notices (docs/home-widgets-audit.md, 3): cards that ask the user to act.
 * They are not widgets. They render in a fixed slot when they have something
 * to say, the layout cannot hide or move them, and each keeps its own dismiss
 * path. The order inside a slot is the order here.
 *
 * - `top`: under the header.
 * - `afterTraining`: after the later of Today and Endurance today in the
 *   user's order.
 * - `end`: after everything (the share prompt).
 *
 * Rendered by src/components/features/home/Notices.tsx.
 */

export type NoticeSlot = "top" | "afterTraining" | "end";

export const NOTICES = [
  { id: "policy", slot: "top" },
  { id: "checkin", slot: "top" },
  { id: "illness", slot: "top" },
  { id: "readinessSwap", slot: "afterTraining" },
  { id: "didYouDoIt", slot: "afterTraining" },
  { id: "missed", slot: "afterTraining" },
  { id: "share", slot: "end" },
] as const satisfies readonly { id: string; slot: NoticeSlot }[];

export type NoticeId = (typeof NOTICES)[number]["id"];

export function noticesIn(slot: NoticeSlot): NoticeId[] {
  return NOTICES.filter((n) => n.slot === slot).map((n) => n.id);
}

/** The widgets the `afterTraining` slot follows. */
export const TRAINING_WIDGETS = ["today", "enduranceToday"] as const;
