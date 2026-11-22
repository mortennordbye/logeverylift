import type { CheckMatch } from "@/lib/session-check";

/**
 * The line under the step page's title that says where the numbers come from
 * (docs/plans/session-check.md, decision 4): "Matched to Garmin · Indoor
 * Cycling · steps split by Garmin laps". One small component, so the match
 * data of the planned session can take its place later.
 */
export function checkMatchText(m: CheckMatch): string {
  if (m.kind === "app") return "Logged in the app";
  const how =
    m.split === "laps" ? "steps split by Garmin laps" : m.split === "time" ? (m.watchOnly ? "steps split by the planned times" : "steps split by time") : m.watchOnly ? "no Garmin streams yet" : null;
  return ["Matched to Garmin", m.name, how].filter(Boolean).join(" · ");
}

export function CheckMatchLine({ match }: { match: CheckMatch }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="check-match">
      {checkMatchText(match)}
    </p>
  );
}
