import { lastChangeLines } from "@/lib/utils/coach-hub";
import { describe, expect, it } from "vitest";

describe("lastChangeLines", () => {
  it("names the program a change is in, but not a note whose change line already quotes it", () => {
    const lines = lastChangeLines([
      { type: "memory", name: "Deload every fourth week", changes: ['Added decision "Deload every fourth week"'] },
      { type: "program", name: "Upper A", changes: ["Bench Press, set 1, weight 80 kg → 82.5 kg"] },
    ]);
    expect(lines).toEqual(['Added decision "Deload every fourth week"', "Upper A · Bench Press, set 1, weight 80 kg → 82.5 kg"]);
  });

  it("keeps at most two lines", () => {
    const changes = ["set 1", "set 2", "set 3"];
    expect(lastChangeLines([{ type: "program", name: "Upper A", changes }])).toEqual(["Upper A · set 1", "Upper A · set 2"]);
  });
});
