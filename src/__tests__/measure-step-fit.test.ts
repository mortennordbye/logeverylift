import { FIT_GAP_PX, MIN_FIGURE_PX, fitMeasureStep } from "@/lib/utils/measure-step-fit";
import { describe, expect, it } from "vitest";

describe("fitMeasureStep", () => {
  it("leaves the figures at full size when the step fits with the keypad closed", () => {
    // 390 x 844: the step ends at 760 with 339 px figures.
    const fit = fitMeasureStep({ visible: 844, bottom: 760, figure: 339 });
    expect(fit.figure).toBeGreaterThanOrEqual(339);
    expect(fit.scrollBy).toBe(0);
  });

  it("makes the figures smaller so Next is above the keypad", () => {
    // The keypad covers the bottom 300 px of 844.
    const fit = fitMeasureStep({ visible: 544, bottom: 760, figure: 339 });
    expect(fit.figure).toBe(339 - (760 - (544 - FIT_GAP_PX)));
    expect(fit.scrollBy).toBe(0);
  });

  it("caps the figures on a small screen with no keypad", () => {
    const fit = fitMeasureStep({ visible: 568, bottom: 700, figure: 265 });
    expect(fit.figure).toBe(265 - (700 - (568 - FIT_GAP_PX)));
    expect(fit.scrollBy).toBe(0);
  });

  it("gives the figures back their room when the keypad closes", () => {
    const capped = fitMeasureStep({ visible: 544, bottom: 760, figure: 339 }).figure;
    const after = fitMeasureStep({ visible: 844, bottom: 760 - (339 - capped), figure: capped });
    expect(after.figure).toBeGreaterThanOrEqual(339);
  });

  it("stays the same once it fits, so measuring again changes nothing", () => {
    const first = fitMeasureStep({ visible: 544, bottom: 760, figure: 339 });
    const again = fitMeasureStep({ visible: 544, bottom: 760 - (339 - first.figure), figure: first.figure });
    expect(again).toEqual(first);
  });

  it("scrolls Next above the keypad when even the smallest figures do not fit", () => {
    // 320 x 568 with a 260 px keypad: 308 px to show the step in.
    // First the figures go to their smallest, with no scroll yet.
    expect(fitMeasureStep({ visible: 308, bottom: 640, figure: 265 })).toEqual({ figure: MIN_FIGURE_PX, scrollBy: 0 });
    // Measured again at the smallest size, the step scrolls by what is still under the keypad.
    const bottom = 640 - (265 - MIN_FIGURE_PX);
    expect(fitMeasureStep({ visible: 308, bottom, figure: MIN_FIGURE_PX })).toEqual({ figure: MIN_FIGURE_PX, scrollBy: bottom - (308 - FIT_GAP_PX) });
    // After the scroll the step measures as fitting and does not scroll again.
    const again = fitMeasureStep({ visible: 308, bottom: 308 - FIT_GAP_PX, figure: MIN_FIGURE_PX });
    expect(again).toEqual({ figure: MIN_FIGURE_PX, scrollBy: 0 });
  });
});
