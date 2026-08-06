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
