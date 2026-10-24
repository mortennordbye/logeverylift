"use client";

import type { ArtThumb } from "@/lib/exercise-art/load";
import { useId } from "react";

/**
 * A still of the exercise for a list row. Each copy gets its own gradient ids,
 * since one exercise can appear in several rows on the same page.
 */
export function ExerciseThumb({ thumb, label, className }: { thumb: ArtThumb; label: string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      viewBox={thumb.viewBox}
      className={className}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: thumb.svg.replaceAll("__ID__", id) }}
    />
  );
}
