import { SkipAutoDayButton } from "@/components/features/SkipAutoDayButton";
import type { TodaySession } from "@/types/workout";
import Link from "next/link";

/**
 * Today's planned sessions on the home card when a day holds more than one
 * (docs/plans/sessions.md, 5): one row per session, in order, each with its
 * own Start button. A day with one session keeps the card as it was.
 */
export function TodaySessionsList({ sessions }: { sessions: TodaySession[] }) {
  return (
    <ul className="flex flex-col gap-2 mb-3" aria-label="Today's sessions">
      {sessions.map((s) => {
        const program = s.slot.program;
        const name = program?.name ?? s.slot.label ?? "Session";
        return (
          <li key={s.plannedSessionId} data-testid="today-session" className="flex items-center justify-between gap-2 min-h-[44px]">
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-base font-semibold truncate">{name}</span>
              {s.done && (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/15 px-2 py-0.5 rounded-full shrink-0">
                  {s.autoSessionId != null ? "Done · automatic" : "Done"}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {s.autoSessionId != null && <SkipAutoDayButton sessionId={s.autoSessionId} />}
              {program && (
                <Link
                  href={`/programs/${program.id}/workout?planned=${s.plannedSessionId}`}
                  prefetch={true}
                  aria-label={`${s.done ? "Do again" : "Start"} ${name}`}
                  className={
                    s.done
                      ? "inline-flex items-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
                      : "inline-flex items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80"
                  }
                >
                  {s.done ? "Do again" : "Start"}
                </Link>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
