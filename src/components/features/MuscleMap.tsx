import { MAP_FIGURES, MAP_VIEWBOX } from "@/lib/exercise-art/muscle-map";
import { MUSCLE_FILL } from "@/lib/exercise-art/scene";
import type { Muscle } from "@/lib/exercise-art/skeleton";

export type MuscleRoles = Partial<Record<Muscle, "primary" | "secondary">>;

/**
 * Front and back body with the exercise's muscles in the user's accent:
 * primary at full strength, secondary mixed toward the card.
 */
export function MuscleMap({ roles, className }: { roles: MuscleRoles; className?: string }) {
  const fill = (m: Muscle | null) => (m === null ? MUSCLE_FILL.body : MUSCLE_FILL[roles[m] ?? "none"]);
  const worked = (Object.keys(roles) as Muscle[]).map((m) => m.replace("_", " "));

  return (
    <svg viewBox={MAP_VIEWBOX} className={className} role="img" aria-label={`Muscles worked: ${worked.join(", ")}`}>
      {MAP_FIGURES.map((fig) => (
        <g key={fig.label} transform={`translate(${fig.x} 0)`}>
          {fig.shapes.map((s, i) => <path key={i} d={s.d} style={{ fill: fill(s.muscle) }} />)}
          {fig.lines.map((d) => <path key={d} d={d} style={{ fill: "none", stroke: MUSCLE_FILL.line, strokeWidth: 1.2 }} />)}
        </g>
      ))}
    </svg>
  );
}
