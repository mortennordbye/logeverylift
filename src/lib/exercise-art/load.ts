import { artSpecSchema, slugify, type ArtSpec } from "./schema";
import { MUSCLES, type Muscle } from "./skeleton";
import { SPEC_LOADERS } from "./specs";

/** The illustration for a built-in exercise, or null when none is drawn yet. */
export async function loadArtSpec(name: string): Promise<ArtSpec | null> {
  const load = SPEC_LOADERS[slugify(name)];
  if (!load) return null;
  const parsed = artSpecSchema.safeParse(await load());
  return parsed.success ? parsed.data : null;
}

/**
 * Which muscles the map lights up. A drawn exercise knows its primary and
 * secondary muscles; any other exercise falls back to its single muscle group.
 * "full_body" lights everything as secondary; "cardio" and unknown get nothing.
 */
export function muscleRoles(
  muscleGroup: string | null,
  spec: Pick<ArtSpec, "primary" | "secondary"> | null,
): Partial<Record<Muscle, "primary" | "secondary">> {
  if (spec) {
    return { ...Object.fromEntries(spec.secondary.map((m) => [m, "secondary"])), [spec.primary]: "primary" };
  }
  if (muscleGroup === "full_body") return Object.fromEntries(MUSCLES.map((m) => [m, "secondary"]));
  if (muscleGroup && (MUSCLES as readonly string[]).includes(muscleGroup)) return { [muscleGroup as Muscle]: "primary" };
  return {};
}
