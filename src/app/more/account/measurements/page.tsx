import { MeasurementsClient } from "@/components/features/measurements/MeasurementsClient";
import { BackLink } from "@/components/ui/BackLink";
import { loadMeasurements } from "./load";

/** Body measurements (docs/plans/body-measurements.md): the map, ratios and a row per part. */
export default async function MeasurementsPage() {
  const { rows, error, today, gender, heightCm } = await loadMeasurements();
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/account/body-and-health", label: "Body and health" }} />
      </div>
      <div className="px-4 pt-2 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Measurements</h1>
      </div>
      {error && <p className="px-4 text-sm text-destructive">{error}</p>}
      <MeasurementsClient rows={rows} today={today} gender={gender} heightCm={heightCm} />
    </div>
  );
}
