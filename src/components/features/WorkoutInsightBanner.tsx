import type { ExerciseInsight, WorkoutInsight } from "@/lib/actions/workout-sets";

const BORDER: Record<WorkoutInsight["type"], string> = {
  progressing:        "border-l-4 border-primary",
  fatigued:           "border-l-4 border-yellow-500",
  stagnating:         "border-l-4 border-yellow-500",
  first_session:      "border-l-4 border-muted-foreground/40",
  on_track:           "border-l-4 border-muted-foreground/40",
  readiness_low:      "border-l-4 border-amber-500",
  plateau_warning:    "border-l-4 border-amber-500",
  pr_streak:          "border-l-4 border-primary",
  deload_recommended: "border-l-4 border-rose-500",
};

const PILL_COLORS: Record<ExerciseInsight["status"], string> = {
  progressing: "bg-emerald-500/15 text-emerald-600",
  held:        "bg-muted text-muted-foreground",
  near_deload: "bg-amber-500/15 text-amber-600",
  deloading:   "bg-red-500/15 text-red-500",
};

const PILL_ICON: Record<ExerciseInsight["status"], string> = {
  progressing: "↑",
  held:        "→",
  near_deload: "⚠",
  deloading:   "↓",
};

export function WorkoutInsightBanner({ insight }: { insight: WorkoutInsight }) {
  const allExercises = insight.exerciseInsights ?? [];
  const notable = allExercises.filter((ex) => ex.status !== "held");
  const heldCount = allExercises.length - notable.length;
  const visiblePills = notable.slice(0, 5);
  const overflowCount = notable.length - visiblePills.length;

  return (
    <div className={`bg-card rounded-2xl p-4 mb-4 ${BORDER[insight.type]}`}>
      <p className="text-sm font-semibold text-foreground leading-snug">
        {insight.headline}
      </p>
      {insight.detail && (
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          {insight.detail}
        </p>
      )}
      {visiblePills.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {visiblePills.map((ex) => (
            <span
              key={ex.exerciseName}
              className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 ${PILL_COLORS[ex.status]}`}
            >
              {PILL_ICON[ex.status]} {ex.exerciseName}
            </span>
          ))}
          {overflowCount > 0 && (
            <span className="text-[10px] text-muted-foreground self-center">+{overflowCount} more</span>
          )}
        </div>
      )}
      {heldCount > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1">{heldCount} on track</p>
      )}
    </div>
  );
}
