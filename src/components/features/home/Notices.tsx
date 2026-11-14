import { AiCheckinCard } from "@/components/features/AiCheckinCard";
import { DeclineMakeupButton } from "@/components/features/DeclineMakeupButton";
import { DidYouDoItCard, IllnessBanner } from "@/components/features/DidYouDoIt";
import { PolicyUpdateNotice } from "@/components/features/PolicyUpdateNotice";
import { ReadinessSwapCard } from "@/components/features/ReadinessSwapCard";
import { SharePromptLoader } from "@/components/features/SharePromptLoader";
import type { HomeCore } from "@/lib/home/core";
import { noticesIn, type NoticeId, type NoticeSlot } from "@/lib/home/notices";
import { CalendarX2 } from "lucide-react";
import Link from "next/link";
import { Fragment, Suspense, type ReactNode } from "react";

/**
 * The home notices in one slot (src/lib/home/notices.ts). Each renders as it
 * did on the old page, only when it has something, and keeps its own dismiss
 * path. The layout cannot hide or move them.
 */

const DAY_LABELS_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dowLabel(dateStr: string): string {
  // dateStr is YYYY-MM-DD; build a local Date to avoid TZ shifts.
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const jsDay = date.getDay();
  const dow = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon … 6=Sun
  return DAY_LABELS_FULL[dow];
}

function MissedThisWeek({ core }: { core: HomeCore }) {
  const dowMissed = core.dowMissed;
  if (dowMissed.length === 0) return null;
  return (
    <div className="rounded-widget bg-widget ring-1 ring-inset ring-hairline p-3.5 shrink-0" data-testid="missed-week">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground mb-1">
        <CalendarX2 className="h-[15px] w-[15px]" aria-hidden />
        Missed this week
      </h2>
      <ul className="flex flex-col">
        {dowMissed.map((m) =>
          m.slot.program ? (
            <li key={`${m.date}-${m.plannedSessionId ?? m.slot.id}`} className="flex items-center justify-between gap-2 py-1.5 border-t border-hairline first:border-t-0">
              <span className="text-sm min-w-0">
                <span className="text-muted-foreground">{dowLabel(m.date)}: </span>
                <span className="font-semibold">{m.slot.program.name}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/programs/${m.slot.program.id}/workout?makeup=${m.date}`}
                  prefetch={true}
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-fill px-4 text-[13px] font-bold text-white active:scale-[0.95] transition-transform"
                >
                  Make up
                </Link>
                <DeclineMakeupButton date={m.date} plannedSessionId={m.plannedSessionId} />
              </div>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

function notice(id: NoticeId, core: HomeCore): ReactNode {
  const { endurance, todayStr } = core;
  switch (id) {
    case "policy":
      return core.policyNotice ? <PolicyUpdateNotice /> : null;
    case "checkin":
      return core.checkin ? <AiCheckinCard id={core.checkin.id} cycleName={core.checkin.cycleName} /> : null;
    case "illness":
      return endurance ? <IllnessBanner sick={endurance.sick} returning={endurance.returning} today={todayStr} /> : null;
    case "readinessSwap":
      return endurance?.readinessSwap ? <ReadinessSwapCard swap={endurance.readinessSwap} /> : null;
    case "didYouDoIt":
      return endurance ? <DidYouDoItCard unconfirmed={endurance.unconfirmed} missedKey={endurance.missedKey} today={todayStr} /> : null;
    case "missed":
      return <MissedThisWeek core={core} />;
    case "share":
      return (
        <Suspense fallback={null}>
          <SharePromptLoader />
        </Suspense>
      );
  }
}

export function Notices({ slot, core }: { slot: NoticeSlot; core: HomeCore }) {
  return noticesIn(slot).map((id) => <Fragment key={id}>{notice(id, core)}</Fragment>);
}
