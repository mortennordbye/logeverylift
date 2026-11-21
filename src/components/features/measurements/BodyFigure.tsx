import { MAP_FIGURES } from "@/lib/exercise-art/muscle-map";
import { MUSCLE_FILL } from "@/lib/exercise-art/scene";
import type { Rule, Tape } from "@/lib/utils/body-measurement-parts";

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

/** A length's measuring line, with end ticks, dotted lines back to the body and the floor. */
function RuleLine({ rule }: { rule: Rule }) {
  const { x, y1, y2, ends, floor } = rule;
  return (
    <g style={{ stroke: "var(--primary)", fill: "none" }} strokeLinecap="round">
      {ends && (
        <g style={{ stroke: "var(--muted-foreground)" }} strokeWidth={0.8} strokeDasharray="2 2">
          {ends[0] > 0 && <path d={`M${x} ${y1}L${ends[0]} ${y1}`} />}
          {ends[1] > 0 && <path d={`M${x} ${y2}L${ends[1]} ${y2}`} />}
        </g>
      )}
      {floor && <path d={`M20 ${y2}L184 ${y2}`} style={{ stroke: "var(--muted-foreground)" }} strokeWidth={1} />}
      <path d={`M${x} ${y1}L${x} ${y2}M${x - 5} ${y1}L${x + 5} ${y1}M${x - 5} ${y2}L${x + 5} ${y2}`} strokeWidth={2.2} />
    </g>
  );
}

/**
 * The whole front body with one place lit up: the tape of a circumference
 * (with a soft glow so it reads at a small size) or the line of a length.
 * `className` sets the size; the figure keeps its shape and is centred.
 */
export function PartFigure({ tape, rule, name, className }: { tape: Tape | null; rule: Rule | null; name: string; className?: string }) {
  const rx = tape ? (tape.x2 - tape.x1) / 2 + 4 : 0;
  return (
    <svg viewBox="4 0 192 392" className={className} role="img" aria-label={`Where to measure the ${name.toLowerCase()}`}>
      <FrontFigure />
      {tape && (
        <>
          <ellipse cx={(tape.x1 + tape.x2) / 2} cy={tape.y} rx={rx} ry={Math.max(6, rx * 0.3)} style={{ fill: "var(--primary)" }} opacity={0.22} />
          <TapeBand tape={tape} width={2.6} />
        </>
      )}
      {rule && <RuleLine rule={rule} />}
    </svg>
  );
}
