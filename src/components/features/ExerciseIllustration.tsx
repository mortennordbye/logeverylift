"use client";

import type { ArtSpec } from "@/lib/exercise-art/schema";
import { VIEWBOX, cycleAt, renderSvg } from "@/lib/exercise-art/scene";
import { VIEWS } from "@/lib/exercise-art/skeleton";
import { Pause, Play } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

const LABELS = { front: "Front", top: "Top", angled: "Angle", behind: "Behind", side: "Side" } as const;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Front and side view of an exercise, moving through its range of motion.
 * Starts paused on the top of the movement when the system asks for reduced
 * motion. Frames are painted straight into the SVGs, not through React state,
 * so the loop does not re-render the page every frame.
 */
export function ExerciseIllustration({ spec }: { spec: ArtSpec }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgs = useRef<Record<string, SVGSVGElement | null>>({});
  const elapsed = useRef(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
  // null until the user taps play/pause; until then the system setting decides.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const playing = chosen ?? !reducedMotion;
  const [phase, setPhase] = useState<0 | 1>(0);

  useEffect(() => {
    const paint = (t: number, phase: 0 | 1) => {
      for (const v of VIEWS) {
        const svg = svgs.current[v];
        if (svg) svg.innerHTML = renderSvg(spec, v, t, `${id}${v}`, phase);
      }
    };
    if (!playing) {
      const at = elapsed.current === 0 ? { t: 1, phase: 0 as const } : cycleAt(elapsed.current);
      paint(at.t, at.phase);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const at = cycleAt(elapsed.current);
      paint(at.t, at.phase);
      setPhase(at.phase);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spec, playing, id]);

  return (
    <section aria-label="How to do it" className="bg-card rounded-2xl px-4 pt-2 pb-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {playing ? spec.phases[phase] : "Paused"}
        </span>
        <button
          type="button"
          onClick={() => setChosen(!playing)}
          aria-label={playing ? "Pause movement" : "Play movement"}
          className="-mr-3 flex h-11 w-11 items-center justify-center text-primary active:opacity-60"
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
      </div>
      <div className="flex gap-2">
        {VIEWS.map((v) => (
          <figure key={v} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <svg
              ref={(el) => { svgs.current[v] = el; }}
              viewBox={VIEWBOX}
              className="block h-56 w-full"
              role="img"
              aria-label={`${spec.name}, ${LABELS[v === "front" ? spec.camera : v].toLowerCase()} view`}
            />
            <figcaption className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{LABELS[v === "front" ? spec.camera : v]}</figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{spec.cue}</p>
    </section>
  );
}
