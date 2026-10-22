import { describe, expect, it } from "vitest";
import { weightOptionsFor, withCustomOption } from "@/lib/utils/picker-options";

const PRESETS = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];

describe("withCustomOption", () => {
  it("returns the presets untouched when the value is already one", () => {
    expect(withCustomOption(PRESETS, 17.5)).toBe(PRESETS);
  });

  it("inserts a custom value in sorted position", () => {
    expect(withCustomOption(PRESETS, 18)).toEqual([
      0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 18, 20,
    ]);
  });

  it("appends a value above the top preset", () => {
    expect(withCustomOption(PRESETS, 25)).toEqual([...PRESETS, 25]);
  });

  it("inserts a value below the lowest non-zero preset", () => {
    expect(withCustomOption(PRESETS, 1)).toEqual([0, 1, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  });

  it("ignores negative and non-finite values", () => {
    expect(withCustomOption(PRESETS, -5)).toBe(PRESETS);
    expect(withCustomOption(PRESETS, NaN)).toBe(PRESETS);
  });
});

describe("weightOptionsFor", () => {
  const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

  it("starts every ladder at 0 and keeps it ascending", () => {
    for (const eq of ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "other", null] as const) {
      const ladder = weightOptionsFor(eq);
      expect(ladder[0]).toBe(0);
      expect(ascending(ladder)).toBe(true);
    }
  });

  it("offers dumbbells in 1 kg steps to 10, 2 kg steps to 50, then 2.5 kg to 80", () => {
    const ladder = weightOptionsFor("dumbbell");
    expect(ladder).toEqual(expect.arrayContaining([1, 3, 9, 10, 12, 18, 22, 50, 52.5, 80]));
    expect(ladder).not.toContain(17.5);
    expect(ladder.at(-1)).toBe(80);
  });

  it("offers the standard kettlebell sizes and nothing between them", () => {
    expect(weightOptionsFor("kettlebell")).toEqual([0, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48]);
  });

  it("offers barbells in 2.5 kg steps to 250", () => {
    const ladder = weightOptionsFor("barbell");
    expect(ladder).toContain(102.5);
    expect(ladder.at(-1)).toBe(250);
    expect(ladder).toHaveLength(101);
  });

  it("offers machines and cables in 1.25 kg steps to 20, then 2.5 kg to 150", () => {
    for (const eq of ["machine", "cable"] as const) {
      const ladder = weightOptionsFor(eq);
      expect(ladder).toEqual(expect.arrayContaining([1.25, 3.75, 18.75, 20, 22.5, 150]));
      expect(ladder).not.toContain(21.25);
      expect(ladder.at(-1)).toBe(150);
    }
  });

  it("falls back to the 2.5 kg ladder to 150 for everything else", () => {
    const fallback = [0, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 2.5)];
    for (const eq of ["bodyweight", "bands", "other", null, undefined] as const) {
      expect(weightOptionsFor(eq)).toEqual(fallback);
    }
  });
});
