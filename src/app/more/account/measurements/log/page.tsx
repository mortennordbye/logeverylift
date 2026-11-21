import { MeasureLogClient } from "@/components/features/measurements/MeasureLogClient";
import { loadMeasurements } from "../load";

/** The step flow that logs body measurements, one part per screen (docs/plans/body-measurements.md, 9). */
export default async function MeasureLogPage() {
  const { rows, today } = await loadMeasurements();
  return <MeasureLogClient rows={rows} today={today} />;
}
