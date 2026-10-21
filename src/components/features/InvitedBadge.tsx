import { Ticket } from "lucide-react";

/** Marks an account that came in on a founder invite (users.invitedById set). */
export function InvitedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 font-semibold text-amber-700 dark:text-amber-400 ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-sm"
      }`}
    >
      <Ticket className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden="true" />
      Invited by founder
    </span>
  );
}
