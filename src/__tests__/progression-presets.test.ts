import { describe, expect, it } from "vitest";
import {
  PROGRESSION_PRESETS,
  matchPreset,
  presetLabel,
  toAxes,
} from "@/lib/utils/progression-presets";

/** The raw column values an exercise with nothing configured carries. */
const defaults = {
  advance: "manual" as string | null,
  scope: "all" as string | null,
  requiredHits: null as number | null,
  regress: "backoff" as string | null,
  backoffPct: 10 as number | null,
  backoffAfter: 3 as number | null,
  readiness: "hold" as string | null,
  hasRange: false,
  hasEffortCap: false,
};

describe("progression presets", () => {
  it("every preset matches its own axis values", () => {
    // The preset is derived, never stored, so a preset the matcher cannot find
    // its way back to is a preset the sheet would label Custom the moment it
    // was picked.
    for (const preset of PROGRESSION_PRESETS) {
      const axes = toAxes({
        ...defaults,
        ...preset.axes,
        requiredHits: preset.axes.requiredHits,
        hasRange: preset.requiresRange === true,
        hasEffortCap: preset.requiresEffortCap === true,
      });
      expect(matchPreset(axes)?.id).toBe(preset.id);
    }
  });

  it("labels an exercise Custom when nothing matches", () => {
    const axes = toAxes({ ...defaults, advance: "load", requiredHits: 4 });
    expect(presetLabel(axes)).toBe("Custom");
  });

  it("separates the two load presets on the gate alone", () => {
    expect(presetLabel(toAxes({ ...defaults, advance: "load", requiredHits: 1 }))).toBe(
      "Linear load",
    );
    expect(presetLabel(toAxes({ ...defaults, advance: "load", requiredHits: 2 }))).toBe(
      "Load, confirmed",
    );
  });

  it("an effort cap is what tells Autoregulated from Load, confirmed", () => {
    // Same axes; the cap is the difference, which is why it is matched and not
    // just written. Without it the sheet would show the wrong name for a scheme
    // whose whole point is the cap.
    expect(
      presetLabel(
        toAxes({ ...defaults, advance: "load", requiredHits: 2, hasEffortCap: true }),
      ),
    ).toBe("Autoregulated");
  });

  it("double progression without a range is Custom, not Double progression", () => {
    // The scheme has nothing to climb without one, and claiming the name for a
    // configuration that behaves as plain load progression would be a lie the
    // sentence underneath it would then contradict.
    expect(
      presetLabel(toAxes({ ...defaults, advance: "double", requiredHits: 1 })),
    ).toBe("Custom");
    expect(
      presetLabel(
        toAxes({ ...defaults, advance: "double", requiredHits: 1, hasRange: true }),
      ),
    ).toBe("Double progression");
  });

  it("matches Manual and Off on the advance alone", () => {
    // Everything under them describes a rule that never runs, so stale values
    // there must not relabel the exercise Custom.
    expect(
      presetLabel(toAxes({ ...defaults, advance: "manual", requiredHits: 5, scope: "set" })),
    ).toBe("Manual");
    expect(presetLabel(toAxes({ ...defaults, advance: "none", backoffPct: 25 }))).toBe(
      "Off",
    );
  });

  it("a changed back-off makes an otherwise-standard scheme Custom", () => {
    expect(
      presetLabel(
        toAxes({ ...defaults, advance: "load", requiredHits: 1, backoffPct: 20 }),
      ),
    ).toBe("Custom");
  });
});
