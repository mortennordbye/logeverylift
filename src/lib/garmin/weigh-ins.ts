/** Garmin weigh-ins as stored (weight_entries rows). Pure, so it is unit tested. */

type Json = Record<string, unknown>;

export type WeighIn = { at: Date; kg: number };

/** Garmin's weight_entries rows ({ items: [{ timestampGMT, weight in grams }] }) as weigh-ins, oldest first. */
export function garminWeighIns(rows: unknown[]): WeighIn[] {
  const out = new Map<number, WeighIn>();
  for (const row of rows) {
    for (const item of ((row as Json | null)?.items ?? []) as Json[]) {
      const at = typeof item.timestampGMT === "number" ? item.timestampGMT : typeof item.date === "number" ? item.date : null;
      const grams = typeof item.weight === "number" ? item.weight : null;
      if (at === null || grams === null || grams <= 0) continue;
      out.set(at, { at: new Date(at), kg: Math.round(grams / 100) / 10 });
    }
  }
  return [...out.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}
