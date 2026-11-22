import { CheckMatchLine } from "@/components/features/session-check/CheckMatchLine";
import { BackLink } from "@/components/ui/BackLink";
import type { BackTarget } from "@/lib/utils/back-nav";
import type { SessionCheckView } from "@/lib/session-check";
import { MARK_TEXT, type Mark, type StepCheck } from "@/lib/utils/session-check";

/** A mark as words and an arrow (decision 2): only over and under in the accent colour, everything else neutral. */
export function MarkChip({ mark }: { mark: Mark }) {
  const out = mark === "over" || mark === "under";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${out ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}
      data-testid="check-mark"
      data-mark={mark}
    >
      {MARK_TEXT[mark]}
    </span>
  );
}

function StepCard({ step }: { step: StepCheck }) {
  return (
    <li className="rounded-2xl bg-muted p-3 flex flex-col gap-1.5" data-testid="check-step">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold truncate">
          {step.n} · {step.title}
        </span>
        <span className="flex items-baseline gap-2 text-sm text-muted-foreground tabular-nums whitespace-nowrap">
          {step.time.value} · plan {step.time.plan}
          {step.time.mark !== "none" && <MarkChip mark={step.time.mark} />}
        </span>
      </div>
      {step.rows.map((r) => (
        <div key={r.metric} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-sm tabular-nums" data-testid="check-row">
          <span className="text-xs text-muted-foreground">{r.label}</span>
          <span className="font-semibold truncate">
            {r.value} <small className="text-xs font-normal text-muted-foreground">· {r.plan}</small>
          </span>
          <MarkChip mark={r.mark} />
        </div>
      ))}
    </li>
  );
}

/** The step page (docs/plans/session-check.md, decision 7): one card per step, each target the plan had against what was done. */
export function SessionCheckSteps({ view, back }: { view: SessionCheckView; back: BackTarget }) {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={back} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6 flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{view.title}</h1>
        {view.parts.length === 0 && (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground" data-testid="check-empty">
            No steps to show yet. They show once the session is done.
          </p>
        )}
        {view.parts.map((p) => (
          <section key={p.key} className="flex flex-col gap-2" data-testid="check-part">
            {view.parts.length > 1 && <h2 className="text-lg font-semibold">{p.name}</h2>}
            <CheckMatchLine match={p.match} />
            <ol className="flex flex-col gap-2.5">
              {p.steps.map((s) => (
                <StepCard key={s.key} step={s} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
