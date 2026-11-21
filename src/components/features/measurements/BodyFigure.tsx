import { MAP_FIGURES } from "@/lib/exercise-art/muscle-map";
import { MUSCLE_FILL } from "@/lib/exercise-art/scene";
import type { Tape } from "@/lib/utils/body-measurement-parts";

const FRONT = MAP_FIGURES[0];

/** The front body figure that MuscleMap draws, in its 200 x 400 coordinates. */
export function FrontFigure() {
  return (
    <g>
      {FRONT.shapes.map((s, i) => <path key={i} d={s.d} style={{ fill: s.muscle ? MUSCLE_FILL.none : MUSCLE_FILL.body }} />)}
      {FRONT.lines.map((d) => <path key={d} d={d} style={{ fill: "none", stroke: MUSCLE_FILL.line, strokeWidth: 1.2 }} />)}
    </g>
  );
}

/** A tape around the body: full at the front, dashed at the back. */
export function TapeBand({ tape, width = 1.8 }: { tape: Pick<Tape, "x1" | "x2" | "y">; width?: number }) {
  const { x1, x2, y } = tape;
  const rx = (x2 - x1) / 2 + 0.6;
  const ry = Math.max(2, rx * 0.12);
  const from = `M${x1 - 0.6} ${y}`;
  const to = `${x2 + 0.6} ${y}`;
  return (
    <g style={{ stroke: "var(--primary)", fill: "none" }}>
      <path d={`${from}A${rx} ${ry} 0 0 1 ${to}`} strokeWidth={width * 0.6} strokeDasharray="2 2" opacity={0.8} />
      <path d={`${from}A${rx} ${ry} 0 0 0 ${to}`} strokeWidth={width} strokeLinecap="round" />
    </g>
  );
}

/**
 * The figure around one part, with its tape line; `className` sets the box height and colour.
 * The crop is centred and fills the box height; a wide box shows more of the body at the sides.
 */
export function TapeCrop({ tape, name, className }: { tape: Tape; name: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl ${className ?? ""}`}>
      <svg
        viewBox={tape.crop.join(" ")}
        className="w-full h-full"
        role="img"
        aria-label={`Where to measure the ${name.toLowerCase()}`}
      >
        <FrontFigure />
        <TapeBand tape={tape} width={1.6} />
      </svg>
    </div>
  );
}
