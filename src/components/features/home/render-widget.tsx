import type { Renderer } from "@/components/features/home/define-widget";
import { WidgetErrorBoundary } from "@/components/features/home/WidgetErrorBoundary";
import { WidgetError } from "@/components/features/home/widget-ui";
import type { HomeContext, HomeCore } from "@/lib/home/core";
import { safeLoad } from "@/lib/home/safe-load";
import type { WidgetSize } from "@/lib/home/widgets/types";
import { Suspense, type ReactNode } from "react";

/**
 * How the page turns a widget into what it renders (docs/home-widgets-audit.md,
 * 6.4 and 6.5). A failure in one widget shows that widget's error state and
 * leaves the rest of the home alone.
 */

function errorOf(r: Renderer, size: WidgetSize): ReactNode {
  return r.Error ? r.Error({ size }) : <WidgetError />;
}

/**
 * A core widget, from the page's data: no Suspense, no skeleton, so Today's
 * start button is in the first HTML. A throwing `select` or view shows the
 * widget's error state (Today's still links to /new-workout); a client part
 * that throws later is caught by the boundary.
 */
export function renderCoreWidget(id: string, r: Renderer, core: HomeCore, size: WidgetSize, settings?: unknown): ReactNode {
  const fallback = errorOf(r, size);
  let body: ReactNode;
  try {
    const data = r.select!(core);
    body = data === null ? r.Empty({ size }) : r.View({ data, size, settings });
  } catch (e) {
    console.error("[homeWidget] render_failed", { id, error: e instanceof Error ? e.name : "unknown" });
    body = fallback;
  }
  // Nothing to show (Endurance today with no session): no row at all, as before.
  if (body === null) return null;
  // A server component deeper in the view that throws is not caught above.
  // The Suspense boundary lets the server send the error state in its place
  // instead of failing the page; on the client the boundary shows it. Nothing
  // here suspends, so the fallback never shows otherwise.
  return (
    <WidgetErrorBoundary id={id} fallback={fallback}>
      <Suspense fallback={fallback}>{body}</Suspense>
    </WidgetErrorBoundary>
  );
}

/** What a streamed widget shows once its loader settles: the view, the empty state, or the error state. */
export async function streamedContent(id: string, r: Renderer, ctx: HomeContext, size: WidgetSize, settings?: unknown): Promise<ReactNode> {
  const loaded = await safeLoad(id, () => r.load!(ctx));
  if (!loaded.ok) return errorOf(r, size);
  return loaded.data === null ? r.Empty({ size }) : r.View({ data: loaded.data, size, settings });
}

async function Streamed({ id, r, ctx, size, settings }: { id: string; r: Renderer; ctx: HomeContext; size: WidgetSize; settings?: unknown }) {
  return streamedContent(id, r, ctx, size, settings);
}

/** A streamed widget: its own Suspense (the skeleton) and error boundary. Its loader only reads. */
export function renderStreamedWidget(id: string, r: Renderer, ctx: HomeContext, size: WidgetSize, settings?: unknown): ReactNode {
  return (
    <WidgetErrorBoundary id={id} fallback={errorOf(r, size)}>
      <Suspense fallback={r.Skeleton({ size })}>
        <Streamed id={id} r={r} ctx={ctx} size={size} settings={settings} />
      </Suspense>
    </WidgetErrorBoundary>
  );
}
