import { NutritionClient } from "@/components/features/nutrition/NutritionClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { listProducts, nutritionSummary, sessionsForFuel } from "@/lib/nutrition";
import { plannableRaces } from "@/lib/race-plans";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * Nutrition (docs/plans/nutrition-and-race-day.md, 6): gut training, fluid and
 * sodium, fuel logs for recent sessions, sweat tests, products and the race
 * plans. Behind the endurance switch (D18); works without Garmin.
 */
export default async function NutritionPage() {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/more");
  const today = toDateStr(await userToday(user.id));
  const [summary, sessions, products, races] = await Promise.all([
    nutritionSummary(user.id),
    sessionsForFuel(user.id, today),
    listProducts(user.id),
    plannableRaces(user.id, today),
  ]);
  return (
    <div className="min-h-[100dvh] pb-nav-safe bg-background">
      <div className="flex items-center px-4 pt-6 pb-2">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Nutrition</h1>
      </div>
      <NutritionClient
        gut={summary.gut}
        fluid={summary.fluid}
        sodium={summary.sodium}
        sessions={sessions.map((s) => ({ id: s.id, date: s.date, name: s.name, durationS: s.durationS, log: s.log }))}
        tests={summary.tests.map((t) => ({
          id: t.id,
          testedOn: t.testedOn,
          durationS: t.durationS,
          temperatureC: t.temperatureC,
          mlPerHour: t.mlPerHour,
          massChangePct: t.massChangePct,
          flags: t.flags,
        }))}
        products={products.map((p) => ({ id: p.id, name: p.name, carbsG: p.carbsG, sodiumMg: p.sodiumMg, caffeineMg: p.caffeineMg, fluidMl: p.fluidMl }))}
        races={races.map((r) => ({ id: r.id, name: r.name, raceDate: r.raceDate, priority: r.priority, distance: r.distance }))}
      />
    </div>
  );
}
