import { MUSCLE_FILL } from "@/lib/exercise-art/scene";
import type { Muscle } from "@/lib/exercise-art/skeleton";

export type MuscleRoles = Partial<Record<Muscle, "primary" | "secondary">>;

/** Left-side shapes of each view; the right side is the same set mirrored. */
const FRONT_SIDE: [Muscle | null, string][] = [
  ["back", "M92 60 L74 70 L92 70 Z"],
  ["shoulders", "M72 68 C58 68 50 80 50 98 C56 96 64 94 70 96 C76 86 78 76 72 68 Z"],
  ["chest", "M97 72 L78 72 C72 80 70 94 72 106 C82 114 94 113 97 108 Z"],
  ["biceps", "M52 102 C48 114 48 130 52 144 C58 145 64 140 66 128 C67 114 63 105 57 100 Z"],
  ["forearms", "M50 150 C44 164 42 184 44 198 L52 199 C58 184 62 166 63 150 C59 148 54 148 50 150 Z"],
  [null, "M40 210a7 10 0 1 0 14 0a7 10 0 1 0 -14 0Z"],
  ["abs", "M76 114 C72 130 74 156 82 178 L86 180 L86 116 Z"],
  ["quads", "M84 206 C72 220 68 252 70 284 C76 290 86 290 92 282 C96 256 98 228 97 210 Z"],
  [null, "M73 296a8 6 0 1 0 16 0a8 6 0 1 0 -16 0Z"],
  ["calves", "M73 306 C68 324 68 348 72 380 L80 381 C84 352 86 326 84 306 Z"],
  [null, "M69 392a9 6 0 1 0 18 0a9 6 0 1 0 -18 0Z"],
];
const FRONT_CENTER: [Muscle | null, string][] = [
  [null, "M83 30a17 21 0 1 0 34 0a17 21 0 1 0 -34 0Z"],
  [null, "M92 52h16v10h-16Z"],
  [null, "M86 186 L114 186 L112 202 L100 208 L88 202 Z"],
  ["abs", "M88 116 L112 116 L111 178 C108 184 92 184 89 178 Z"],
];
const BACK_SIDE: [Muscle | null, string][] = [
  ["shoulders", "M74 70 C60 70 52 80 50 98 C58 94 66 94 72 96 C78 86 80 76 74 70 Z"],
  ["back", "M80 98 C72 112 74 136 84 154 L97 158 L97 124 L90 100 Z"],
  ["triceps", "M52 102 C48 114 48 130 52 144 C58 145 64 140 66 128 C67 114 63 105 57 100 Z"],
  ["forearms", "M50 150 C44 164 42 184 44 198 L52 199 C58 184 62 166 63 150 C59 148 54 148 50 150 Z"],
  [null, "M40 210a7 10 0 1 0 14 0a7 10 0 1 0 -14 0Z"],
  ["glutes", "M98 186 L80 188 C70 202 72 222 84 228 C92 230 98 224 99 216 Z"],
  ["hamstrings", "M80 234 C72 250 70 272 72 290 C80 294 90 292 94 286 C96 266 96 248 94 234 Z"],
  [null, "M74 300a8 5 0 1 0 16 0a8 5 0 1 0 -16 0Z"],
  ["calves", "M73 308 C64 324 66 348 74 368 L82 368 C88 346 88 326 84 308 Z"],
  [null, "M70 390a8 10 0 1 0 16 0a8 10 0 1 0 -16 0Z"],
];
const BACK_CENTER: [Muscle | null, string][] = [
  [null, "M83 30a17 21 0 1 0 34 0a17 21 0 1 0 -34 0Z"],
  [null, "M92 48h16v10h-16Z"],
  ["back", "M100 54 L78 70 L90 94 L100 120 L110 94 L122 70 Z"],
  ["lower_back", "M86 160 L114 160 L114 182 L86 182 Z"],
];

/**
 * Front and back body outline with the exercise's muscles in the user's
 * accent: primary at full strength, secondary mixed toward the card.
 */
export function MuscleMap({ roles, className }: { roles: MuscleRoles; className?: string }) {
  const fill = (m: Muscle | null) => (m === null ? MUSCLE_FILL.body : MUSCLE_FILL[roles[m] ?? "none"]);
  const paths = (list: [Muscle | null, string][]) =>
    list.map(([m, d]) => <path key={d} d={d} style={{ fill: fill(m) }} />);
  const worked = (Object.keys(roles) as Muscle[]).map((m) => m.replace("_", " "));

  return (
    <svg viewBox="0 0 420 410" className={className} role="img" aria-label={`Muscles worked: ${worked.join(", ")}`}>
      <g>
        {paths(FRONT_CENTER)}
        <path d="M99.3 118h1.4v62h-1.4ZM89 136h22v1.4h-22ZM89 157h22v1.4h-22Z" style={{ fill: MUSCLE_FILL.gap }} />
        {paths(FRONT_SIDE)}
        <g transform="matrix(-1 0 0 1 200 0)">{paths(FRONT_SIDE)}</g>
      </g>
      <g transform="translate(220 0)">
        {paths(BACK_CENTER)}
        <path d="M99.3 160h1.4v22h-1.4Z" style={{ fill: MUSCLE_FILL.gap }} />
        {paths(BACK_SIDE)}
        <g transform="matrix(-1 0 0 1 200 0)">{paths(BACK_SIDE)}</g>
      </g>
    </svg>
  );
}
