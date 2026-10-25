/**
 * Barbell loading: which plates go on each side, and a warm-up ramp up to the
 * working weight. The bar and plate set are fixed until the app has per-user
 * equipment.
 */

export const BAR_KG = 20;
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

// Plate maths in hundredths of a kilo, so 1.25 and 2.5 subtract exactly.
const toHundredths = (kg: number) => Math.round(kg * 100);

/**
 * Largest plates first. `remainderKg` is what the plates can't make up across
 * both sides, so 61 kg reads as 20 per side with 1 kg left over. A total at or
 * below the bar takes no plates and leaves no remainder.
 */
export function platesPerSide(
  totalKg: number,
  barKg: number = BAR_KG,
  plates: readonly number[] = PLATES_KG,
): { perSide: number[]; remainderKg: number } {
  if (totalKg <= barKg) return { perSide: [], remainderKg: 0 };
  const toLoad = toHundredths(totalKg) - toHundredths(barKg);
  let side = Math.floor(toLoad / 2);
  const perSide: number[] = [];
  for (const plate of plates) {
    const p = toHundredths(plate);
    while (side >= p) {
      perSide.push(plate);
      side -= p;
    }
  }
  const loaded = 2 * perSide.reduce((sum, plate) => sum + toHundredths(plate), 0);
  return { perSide, remainderKg: (toLoad - loaded) / 100 };
}

/** "20 + 5 + 1.25 per side", or null when the weight is below the bar. */
export function formatPlates(totalKg: number): string | null {
  if (totalKg < BAR_KG) return null;
  const { perSide, remainderKg } = platesPerSide(totalKg);
  const line = perSide.length === 0 ? "Empty bar" : `${perSide.join(" + ")} per side`;
  return remainderKg > 0 ? `${line}, ${remainderKg} kg short` : line;
}

const RAMP = [
  { pct: 0.4, reps: 5 },
  { pct: 0.6, reps: 3 },
  { pct: 0.8, reps: 2 },
] as const;

/** Below this working weight the empty bar is the whole warm-up. */
const RAMP_MIN_WORKING_KG = 40;

/**
 * Empty bar ×10, then 40% ×5, 60% ×3 and 80% ×2 of the working weight, each
 * rounded to 2.5 kg. A step that lands below the bar, on the previous step's
 * weight or at the working weight is dropped. Nothing to ramp to at or below
 * the bar.
 */
export function warmupRamp(workingKg: number): { weightKg: number; reps: number }[] {
  if (workingKg <= BAR_KG) return [];
  const ramp = [{ weightKg: BAR_KG, reps: 10 }];
  if (workingKg < RAMP_MIN_WORKING_KG) return ramp;
  for (const { pct, reps } of RAMP) {
    const weightKg = Math.round((workingKg * pct) / 2.5) * 2.5;
    const previous = ramp[ramp.length - 1].weightKg;
    if (weightKg < BAR_KG || weightKg <= previous || weightKg >= workingKg) continue;
    ramp.push({ weightKg, reps });
  }
  return ramp;
}
