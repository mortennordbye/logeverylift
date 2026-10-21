import type { PrFeedEntry } from "@/lib/actions/metrics";
import { disciplineConfig } from "@/lib/utils/discipline";
import { formatEnduranceDistance, formatEndurancePace } from "@/lib/utils/format";
import { Trophy } from "lucide-react";

const PR_TYPE_LABEL: Record<string, string> = {
  weight: "Heaviest set",
  estimated_1rm: "Estimated 1RM",
  reps_at_weight: "Reps at weight",
};

/** Subtitle describing what kind of record this is. */
function prTypeLabel(pr: PrFeedEntry): string {
  if (pr.prType === "distance") {
    return `Longest ${disciplineConfig(pr.discipline).label.toLowerCase()}`;
  }
  if (pr.prType === "pace") {
    return pr.bracket ? `Best ${pr.bracket} pace` : "Best pace";
  }
  return PR_TYPE_LABEL[pr.prType] ?? pr.prType;
}

function formatPrValue(pr: PrFeedEntry): string {
  const { prType, value, weightKg } = pr;
  if (prType === "weight") return `${value} kg`;
  if (prType === "estimated_1rm") return `~${Math.round(value)} kg 1RM`;
  if (prType === "reps_at_weight") {
    return weightKg != null ? `${value} reps @ ${weightKg} kg` : `${value} reps`;
  }
  const cfg = disciplineConfig(pr.discipline);
  if (prType === "distance") {
    // value = meters
    return formatEnduranceDistance(cfg.inputUnit, value);
  }
  // pace: value = duration seconds, distanceMeters = the effort's distance
  return pr.distanceMeters != null
    ? formatEndurancePace(cfg.paceFormatter, value, pr.distanceMeters)
    : "—";
}

function formatAchievedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Every PR the user has broken, newest first. The Records tab on Progress. */
export function PrFeedList({ prs }: { prs: PrFeedEntry[] }) {
  if (prs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center pt-16 gap-4">
        <Trophy className="w-12 h-12 text-muted-foreground" />
        <p className="text-muted-foreground text-center text-sm">
          No PRs yet. Once you beat a previous max, it&apos;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground px-1 mb-3">
        {`${prs.length} PR${prs.length === 1 ? "" : "s"} broken, newest first`}
      </p>
      <ul className="space-y-2">
        {prs.map((pr) => (
          <li
            key={pr.id}
            className="flex items-center gap-3 bg-card rounded-2xl px-4 py-3"
          >
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                pr.isCurrent
                  ? "bg-yellow-500/15 text-yellow-600"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Trophy className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{pr.exerciseName}</p>
              <p className="text-xs text-muted-foreground">
                {prTypeLabel(pr)} · {formatAchievedAt(pr.achievedAt)}
              </p>
              {/* D-10: this record was computed from reps that were claimed
                  by a tap rather than reported, because it predates honest
                  rep logging. It is kept and it still counts — the point is
                  that a record you cannot beat has a visible reason instead
                  of reading as a plateau. */}
              {pr.unverified && (
                <p className="text-[10px] text-muted-foreground/70">
                  Set before reps were logged individually
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="font-semibold tabular-nums">
                {formatPrValue(pr)}
              </p>
              {!pr.isCurrent && (
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  Beaten
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
