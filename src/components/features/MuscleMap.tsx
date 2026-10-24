import { MAP_FIGURES, MAP_VIEWBOX } from "@/lib/exercise-art/muscle-map";
import { HEAT_FILL, MUSCLE_FILL } from "@/lib/exercise-art/scene";
import type { Muscle } from "@/lib/exercise-art/skeleton";

export type MuscleRoles = Partial<Record<Muscle, "primary" | "secondary">>;
/** Heat level per muscle, 1 (light) to 4 (strong); muscles left out are untrained. */
export type MuscleHeat = Partial<Record<Muscle, 1 | 2 | 3 | 4>>;

/**
 * Front and back body with the exercise's muscles in the user's accent:
 * primary at full strength, secondary mixed toward the card. Given `heat`
 * instead, it is a heat map: each muscle shaded by its level, the rest faint.
 */
export function MuscleMap({ roles = {}, heat, className }: { roles?: MuscleRoles; heat?: MuscleHeat; className?: string }) {
  const fill = (m: Muscle | null) => {
    if (m === null) return MUSCLE_FILL.body;
    if (heat) return heat[m] ? HEAT_FILL[heat[m] - 1] : MUSCLE_FILL.body;
    return MUSCLE_FILL[roles[m] ?? "none"];
  };
  const worked = (Object.keys(heat ?? roles) as Muscle[]).map((m) => m.replace("_", " "));

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
