import { HomeGrid } from "@/components/features/home/HomeGrid";
import { Notices } from "@/components/features/home/Notices";
import { StartBar } from "@/components/features/home/StartBar";
import type { Renderer } from "@/components/features/home/define-widget";
import { renderCoreWidget, renderStreamedWidget } from "@/components/features/home/render-widget";
import { RENDERERS } from "@/components/features/home/widgets";
import { closeStaleOpenSessions } from "@/lib/actions/workout-sessions";
import { needsTermsConsent } from "@/lib/consent";
import { garminAllowed } from "@/lib/garmin/access";
import { activeCycle, loadHomeCore, type HomeContext } from "@/lib/home/core";
import { parseStoredLayout, resolveLayout } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { getUserSettings } from "@/lib/user-settings";
import { requireSession } from "@/lib/utils/session";
import { todayIn } from "@/lib/utils/user-date";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The home screen, built from the user's widget layout
 * (docs/home-widgets-audit.md, 6.4). Every write runs here, in order, before
 * any Suspense boundary; streamed widgets below only read. Without a saved
 * layout the user sees the default for their type, which renders the same
 * parts in the same order as the page before widgets (e2e/home-default.spec.ts).
 */
export default async function Home() {
  const session = await requireSession();
  // New accounts and anyone behind on the terms accept them first. Asked here,
  // not on every route, so it never interrupts a workout in progress.
  if (await needsTermsConsent(session)) redirect("/consent");

  // -- writes, before any Suspense, in this order --
  // Failsafe: close out any workout left open for >10h before rendering.
  await closeStaleOpenSessions();
  // Today and this week in the user's zone (src/lib/utils/user-date.ts). The
  // same read carries the home layout.
  const settings = await getUserSettings(session.user.id);
  const today = todayIn(settings.timeZone, new Date());
  // The cycle next: it can start or end a block and write auto sessions,
  // which the reads below must see.
  const cycleResult = await activeCycle();

  // -- reads (the week read in here can still make a cycle's sessions) --
  const core = await loadHomeCore(session, settings, today, cycleResult);
  const audience = { endurance: core.enduranceEnabled, garmin: garminAllowed(session.user.role) };
  const items = resolveLayout(parseStoredLayout(settings.homeLayout, session.user.id), audience);
  const ctx: HomeContext = { userId: session.user.id, role: session.user.role ?? null, today: core.todayStr };

  // Only visible widgets render; a hidden streamed widget runs no query.
  const renderers: Partial<Record<WidgetId, Renderer>> = RENDERERS;
  const slots: Partial<Record<WidgetId, ReactNode>> = {};
  for (const item of items) {
    const r = renderers[item.id];
    if (item.hidden || !r) continue;
    slots[item.id] =
      widgetDef(item.id).source === "core"
        ? renderCoreWidget(item.id, r, core, item.size, item.settings)
        : renderStreamedWidget(item.id, r, ctx, item.size, item.settings);
  }

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <HomeGrid
        items={items}
        title={slots.title}
        slots={slots}
        topNotices={<Notices slot="top" core={core} />}
        afterTraining={<Notices slot="afterTraining" core={core} />}
        startBar={core.info ? null : <StartBar />}
      />
      <Notices slot="end" core={core} />
    </div>
  );
}
