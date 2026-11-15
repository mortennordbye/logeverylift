import { STEP_WORD } from "@/components/features/guided/types";
import { bigTarget, cadenceText, gradeText, hrChip, minutesText, powerSub, stepLength, type ResolvedGroup } from "@/lib/utils/bike-view";
import { powerZoneOf } from "@/lib/utils/workout-profile";
import type { ResolvedNode, ResolvedStep } from "@/lib/utils/workout-steps";

/** "15" over "min", or "to Lap" alone. */
function Duration({ step }: { step: ResolvedStep }) {
  const [value, ...unit] = step.end.type === "lap" ? ["Lap"] : stepLength(step).split(" ");
  const hard = step.type === "work";
  return (
    <div className="w-14 shrink-0">
      <p className="home-display text-[26px] leading-none tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">
        {unit.join(" ")}
        {hard ? " · hard" : ""}
      </p>
    </div>
  );
}

function Chip({ children, hr = false }: { children: React.ReactNode; hr?: boolean }) {
  return (
    <span className="mr-1 mt-1 inline-flex items-center gap-1 rounded-full bg-widget-2 px-2.5 py-0.5 text-xs">
      {hr && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />}
      {children}
    </span>
  );
}

/** Zone of the left border: the power zone the resolver gives, else from the % FTP. */
function zoneOf(s: ResolvedStep): number | null {
  const f = s.resolved?.forms;
  if (f?.powerZone) return f.powerZone;
  const pct = f?.pctFtp;
  if (pct && (pct.low !== null || pct.high !== null)) return powerZoneOf(((pct.low ?? pct.high!) + (pct.high ?? pct.low!)) / 2);
  return null;
}

function StepCard({ step }: { step: ResolvedStep }) {
  const big = bigTarget(step.resolved);
  const sub = powerSub(step.resolved);
  const hr = hrChip(step);
  const cadence = cadenceText(step);
  const grade = gradeText(step);
  const zone = zoneOf(step);
  return (
    <li
      className="flex gap-3 rounded-2xl border-l-4 bg-widget p-3"
      style={{ borderLeftColor: zone ? `var(--viz-zone-${zone})` : "var(--border)" }}
      data-testid="step-card"
    >
      <Duration step={step} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{STEP_WORD[step.type]}</p>
        {big && (
          <p className="text-xl font-bold tabular-nums" data-testid="step-target">
            {big.value} {big.unit && <small className="text-[13px] font-medium text-muted-foreground">{big.unit}</small>}
          </p>
        )}
        {sub && <p className="text-xs text-muted-foreground" data-testid="step-power-sub">{sub}</p>}
        {(hr || cadence || grade) && (
          <div>
            {hr && <Chip hr>HR {hr}</Chip>}
            {cadence && <Chip>{cadence}</Chip>}
            {grade && <Chip>{grade}</Chip>}
          </div>
        )}
        {step.note && <p className="mt-1 text-[13px]">{step.note}</p>}
      </div>
    </li>
  );
}

function Node({ node }: { node: ResolvedNode }) {
  if (!("count" in node)) return <StepCard step={node as ResolvedStep} />;
  return (
    <li className="rounded-[18px] bg-widget-2/60 p-2" data-testid="step-repeat">
      <p className="mx-1 mb-2 mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="rounded-lg bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">{node.count} x</span>
        {node.steps.length === 1 ? "Repeat this step" : `Repeat these ${node.steps.length} steps`}
      </p>
      <ol className="flex flex-col gap-2">
        {node.steps.map((s, i) => (
          <StepCard key={i} step={s} />
        ))}
      </ol>
    </li>
  );
}

/** The steps grouped into warm-up, main set and cool-down (5.2). */
export function StepCards({ groups }: { groups: ResolvedGroup[] }) {
  return (
    <div data-testid="planned-steps">
      {groups.map((g, gi) => (
        <section key={gi} aria-label={g.label}>
          <h2 className="mx-0.5 mb-2 mt-4 flex justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span>{g.label}</span>
            <span>{minutesText(g.seconds)}</span>
          </h2>
          <ol className="flex flex-col gap-2">
            {g.nodes.map((n, i) => (
              <Node key={i} node={n} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
