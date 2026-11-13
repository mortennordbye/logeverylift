/**
 * The render side of a home widget (docs/home-widgets-audit.md, 6.5). A core
 * widget has `select`, which picks its data from the page's `HomeCore`; a
 * streamed widget has `load`, which only reads. `null` from either renders
 * `Empty`. Views are Server Components; client parts get formatted strings.
 */

import type { HomeContext, HomeCore } from "@/lib/home/core";
import type { WidgetSize } from "@/lib/home/widgets/types";
import type { ReactNode } from "react";

export type SizeProps = { size: WidgetSize };

/*
 * Method syntax on purpose: it lets RENDERERS hold widgets of different data
 * types as `Renderer` (method parameters are checked bivariantly).
 */
export interface Renderer<D = unknown> {
  select?(core: HomeCore): D | null;
  load?(ctx: HomeContext): Promise<D | null>;
  View(p: { data: D; size: WidgetSize; settings?: unknown }): ReactNode;
  Empty(p: SizeProps): ReactNode;
  Skeleton(p: SizeProps): ReactNode;
  /** Static, for edit mode and the gallery. Never reads data. */
  Preview(p: SizeProps): ReactNode;
  /** Default: "Couldn't load this." */
  Error?(p: SizeProps): ReactNode;
}

export function defineWidget<D>(w: Renderer<D>): Renderer<D> {
  return w;
}
