import type { equipmentEnum } from "@/db/schema/exercises";
import { isOnStack, stackRungs } from "@/lib/utils/weight-stacks";

/**
 * Insert a manually typed value into a preset list as its own option.
 *
 * The weight pickers used to highlight the *closest* preset when a value was
 * typed in — type 18 and the 17.5 circle lit up, so the picker disagreed with
 * the number in the input and there was nothing on screen showing 18. Giving
 * the typed value its own circle (in sorted position) keeps the selection
 * honest.
 *
 * `options` must be ascending. Returns the original array when the value is
 * already a preset, so the common case allocates nothing.
 */
export function withCustomOption(options: number[], value: number): number[] {
  if (!Number.isFinite(value) || value < 0 || options.includes(value)) {
    return options;
  }
  const index = options.findIndex((option) => option > value);
  const next = [...options];
  next.splice(index === -1 ? next.length : index, 0, value);
  return next;
}

export type Equipment = (typeof equipmentEnum)[number];

/** `count` values from `start`, `step` apart. */
function steps(start: number, step: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * step);
}

const DEFAULT_LADDER = [0, ...steps(2.5, 2.5, 60)]; // 0–150

/**
 * Preset weights for an exercise's equipment, as gyms commonly stock them, so
 * an 18 kg dumbbell or a 24 kg kettlebell is a circle rather than a typed-in
 * custom weight. Bodyweight keeps the default ladder for added load (weighted
 * pull-ups, dips). Every ladder starts at 0 and is ascending.
 */
const LADDERS: Partial<Record<Equipment, number[]>> = {
  dumbbell: [0, ...steps(1, 1, 10), ...steps(12, 2, 20), ...steps(52.5, 2.5, 12)], // 0–80
  kettlebell: [0, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48],
  barbell: [0, ...steps(2.5, 2.5, 100)], // 0–250
  machine: [0, ...steps(1.25, 1.25, 16), ...steps(22.5, 2.5, 52)], // 0–150
  cable: [0, ...steps(1.25, 1.25, 16), ...steps(22.5, 2.5, 52)],
};

/**
 * A learned stack pattern, when the exercise has one, replaces the equipment's
 * ladder: those are the weights this machine actually has.
 */
export function weightOptionsFor(
  equipment: Equipment | null | undefined,
  weightStack?: string | null,
): number[] {
  const rungs = stackRungs(weightStack);
  if (rungs) return [0, ...rungs];
  return (equipment && LADDERS[equipment]) || DEFAULT_LADDER;
}

/**
 * Whether a logged weight tells us something about the stack.
 *
 * With no pattern, multiples of 1.25 never count: the engine suggests them on
 * every cable and machine, including ones the ladder lacks above 20 kg (41.25),
 * so accepting its own suggestion must not read as the lifter's stack.
 */
export function isCustomWeight(
  kg: number,
  weightStack: string | null | undefined,
  equipment: Equipment | null | undefined,
): boolean {
  const rungs = stackRungs(weightStack);
  if (rungs) return !isOnStack(kg, rungs);
  return !weightOptionsFor(equipment).includes(kg) && !Number.isInteger(kg / 1.25);
}
