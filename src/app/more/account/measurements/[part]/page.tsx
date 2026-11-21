import { PartClient } from "@/components/features/measurements/PartClient";
import { BackLink } from "@/components/ui/BackLink";
import { partOf } from "@/lib/utils/body-measurement-parts";
import { notFound } from "next/navigation";
import { loadMeasurements } from "../load";

/** One body part: guide, chart and history (docs/plans/body-measurements.md). */
export default async function MeasurementPartPage({ params }: { params: Promise<{ part: string }> }) {
  const part = partOf((await params).part);
  if (!part) notFound();
  const { rows, error, today } = await loadMeasurements();
  return (
    <div className="h-[100dvh] w-full max-w-md mx-auto pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/account/measurements", label: "Measurements" }} />
      </div>
      <div className="px-4 pt-2 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">{part.name}</h1>
        {part.sides && <p className="text-sm text-muted-foreground mt-1">Left and right</p>}
      </div>
      {error && <p className="px-4 text-sm text-destructive">{error}</p>}
      <PartClient part={part} rows={rows.filter((r) => r.site === part.site)} today={today} />
    </div>
  );
}
