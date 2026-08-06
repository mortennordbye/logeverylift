import { describe, expect, it } from "vitest";
import { withCustomOption } from "@/lib/utils/picker-options";

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
