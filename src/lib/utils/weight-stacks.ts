/**
 * The weight patterns cable and machine stacks commonly follow.
 *
 * Gyms differ, so the engine cannot know a stack from the equipment type alone.
 * When a lifter logs a weight the app's ladder doesn't have, the first pattern
 * here containing it is remembered on that exercise in that program.
 *
 * **Order is the guess.** Plate sizes come from manufacturer listings, but no
 * source ranks how common they are, so most common first is a judgement. Rows
 * store the id, so this list can change without a migration; an id that leaves
 * it reads as no pattern.
 */

const KG_PER_LB = 0.45359237;
const TOP_KG = 500;

/** Stacks are labelled to one decimal in kg; the plates are whole pounds. */
const lb = (pounds: number) => Math.round(pounds * KG_PER_LB * 10) / 10;

/** `start`, `start + step`, ... up to the top of any real stack. */
function ladder(step: number, toKg: (n: number) => number = (n) => n, start = step): number[] {
  const rungs: number[] = [];
  for (let n = start; toKg(n) <= TOP_KG; n += step) rungs.push(toKg(n));
  return rungs;
}

export const WEIGHT_STACKS: readonly { id: string; label: string; rungs: number[] }[] = [
  { id: "kg5", label: "5 kg steps", rungs: ladder(5) },
  { id: "kg2_5", label: "2.5 kg steps", rungs: ladder(2.5) },
  { id: "kg4_5", label: "4.5 kg steps", rungs: ladder(4.5) },
  { id: "lb10", label: "10 lb steps", rungs: ladder(10, lb) },
  { id: "lb15_top10", label: "15 lb steps", rungs: ladder(15, lb, 10) },
  { id: "kg1_25", label: "1.25 kg steps", rungs: ladder(1.25) },
  { id: "lb5", label: "5 lb steps", rungs: ladder(5, lb) },
  { id: "kg3", label: "3 kg steps", rungs: ladder(3) },
  { id: "kg2", label: "2 kg steps", rungs: ladder(2) },
  { id: "kg1", label: "1 kg steps", rungs: ladder(1) },
];

const find = (id: string | null | undefined) => WEIGHT_STACKS.find((stack) => stack.id === id);

const onRung = (rungs: number[], kg: number) => rungs.some((rung) => Math.abs(rung - kg) < 0.001);

/** The pattern's weights, ascending, or null for no pattern or a retired one. */
export function stackRungs(id: string | null | undefined): number[] | null {
  return find(id)?.rungs ?? null;
}

export function stackLabel(id: string | null | undefined): string | null {
  return find(id)?.label ?? null;
}

/** The most common pattern containing every weight, or null if none does. */
export function pickStack(weights: number[]): string | null {
  if (weights.length === 0) return null;
  return WEIGHT_STACKS.find(({ rungs }) => weights.every((kg) => onRung(rungs, kg)))?.id ?? null;
}

/** Whether a weight is one of the rungs. */
export function isOnStack(kg: number, rungs: number[]): boolean {
  return onRung(rungs, kg);
}

/**
 * The most common pattern containing every weight, in which `toKg` is the very
 * next weight after `fromKg`. A lifter moves up a stack one pin at a time; a
 * bigger gap could be any stack.
 */
export function pickStackForStep(fromKg: number, toKg: number, weights: number[]): string | null {
  return (
    WEIGHT_STACKS.find(
      ({ id, rungs }) =>
        [fromKg, ...weights].every((kg) => onRung(rungs, kg)) &&
        Math.abs(gapAbove(fromKg, id) - (toKg - fromKg)) < 0.001,
    )?.id ?? null
  );
}

/**
 * The closest weight on a known pattern; a tie goes up. A load above the top of
 * the list stays as it is, because snapping would cut it.
 */
export function nearestRung(kg: number, id: string): number {
  const rungs = stackRungs(id) ?? [];
  if (rungs.length > 0 && kg > rungs[rungs.length - 1]) return kg;
  return rungs.reduce(
    (best, rung) => (Math.abs(rung - kg) <= Math.abs(best - kg) ? rung : best),
    rungs[0] ?? kg,
  );
}

/** The next weight down on a known pattern, or the lowest if there is none. */
export function rungBelow(kg: number, id: string): number {
  const rungs = stackRungs(id) ?? [];
  return rungs.filter((rung) => rung < kg - 0.001).at(-1) ?? rungs[0] ?? kg;
}

/** Distance from `kg` to the next weight up on a known pattern. */
export function gapAbove(kg: number, id: string): number {
  const rungs = stackRungs(id) ?? [];
  const next = rungs.find((rung) => rung > kg + 0.001);
  if (next != null) return next - kg;
  return rungs.length > 1 ? rungs[rungs.length - 1] - rungs[rungs.length - 2] : 0;
}
