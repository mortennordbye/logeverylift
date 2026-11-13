import { RacePlanClient, type RacePlanView } from "@/components/features/nutrition/RacePlanClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getRacePlan } from "@/lib/race-plans";
import { getUserSettings } from "@/lib/user-settings";
import { minSec, paceUnitLabel, paceUnitMeters, speedToPace } from "@/lib/utils/thresholds";
import { requireSession } from "@/lib/utils/session";
import { shortDay } from "@/lib/utils/seasons";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

/** A race-day plan (docs/plans/nutrition-and-race-day.md, 6): timeline, pacing per leg, fuel schedule. */
export default async function RacePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raceId = Number(id);
  if (!Number.isInteger(raceId) || raceId <= 0) notFound();
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/more");
  const [p, settings] = await Promise.all([getRacePlan(user.id, raceId), getUserSettings(user.id)]);
  if (!p) notFound();

  const pace = (speed: number | null, measure: "runPace" | "swimPace") =>
    speed ? `${minSec(speedToPace(speed, paceUnitMeters(measure, settings.units)))} ${paceUnitLabel(measure, settings.units)}` : null;

  const view: RacePlanView = p.distance
    ? {
        supported: true,
        raceId,
        version: p.version,
        inputs: p.inputs,
        timeline: p.plan.timeline,
        totalMinutes: p.plan.totalMinutes,
        swim: { pace: pace(p.plan.swim.speed, "swimPace"), text: p.plan.swim.text, evidence: p.plan.swim.evidence, leg: p.plan.swim.leg },
        bike: { watts: p.plan.bike.watts, ifRange: p.plan.bike.ifRange, hrCeiling: p.plan.bike.hrCeiling, text: p.plan.bike.text, evidence: p.plan.bike.evidence, leg: p.plan.bike.leg },
        run: {
          pace: p.plan.run.speed ? `${pace(p.plan.run.speed[1], "runPace")} to ${pace(p.plan.run.speed[0], "runPace")}` : null,
          hrCeiling: p.plan.run.hrCeiling,
          text: p.plan.run.text,
          evidence: p.plan.run.evidence,
          leg: p.plan.run.leg,
        },
        transitions: p.plan.transitions,
        fuel: p.fuel,
        raceMorning: p.raceMorning,
        safety: [...p.safety],
      }
    : { supported: false, raceId, message: p.unsupported };

  return (
    <div className="min-h-[100dvh] pb-nav-safe bg-background">
      <div className="flex items-center px-4 pt-6 pb-2">
        <Link href={`/seasons/${p.race.seasonId}`} className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Season</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Race plan</h1>
        <p className="text-sm text-muted-foreground">
          {p.race.name} · {shortDay(p.race.raceDate)} {p.race.raceDate.slice(0, 4)}
        </p>
      </div>
      <RacePlanClient plan={view} />
    </div>
  );
}
