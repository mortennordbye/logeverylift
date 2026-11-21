/** The figures never get smaller than this. Below it the step scrolls instead. */
export const MIN_FIGURE_PX = 72;
/** Room kept between Next and the keypad (or the bottom of the screen). */
export const FIT_GAP_PX = 12;

/**
 * How tall a log step's figures may be, so the step down to Next fits in the
 * visible height: the visual viewport, which the keypad makes smaller. Measured
 * now, from the top of the screen: `bottom` is the bottom of the Skip and Next
 * row and `figure` the figures' height. The figures take the room that is
 * left; a cap above their full size has no effect, so with room to spare they
 * stay as big as the card width lets them. When even the smallest figures do
 * not fit, `scrollBy` is how far to scroll the step so Next is above the keypad.
 * It scrolls only once the figures are at their smallest, so a measure taken
 * before the cap took effect never leaves the step scrolled.
 */
export function fitMeasureStep({ visible, bottom, figure }: { visible: number; bottom: number; figure: number }): {
  figure: number;
  scrollBy: number;
} {
  const limit = visible - FIT_GAP_PX;
  const capped = Math.max(MIN_FIGURE_PX, Math.floor(figure + limit - bottom));
  const overflow = figure <= MIN_FIGURE_PX ? bottom - limit : 0;
  return { figure: capped, scrollBy: Math.max(0, Math.ceil(overflow)) };
}
